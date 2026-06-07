/**
 * Jetstream WebSocket client — subscribes to the AT Protocol firehose
 * via Jetstream and emits flattened JSON events to n8n trigger pipelines.
 *
 * Uses Node 22+ built-in `WebSocket` and `node:zlib` zstd with Jetstream's
 * custom dictionary for decompression.
 */

import { zstdDecompress } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JetstreamCommit {
  rev: string;
  operation: 'create' | 'update' | 'delete';
  collection: string;
  rkey: string;
  record?: Record<string, unknown>;
  cid?: string;
}

export interface JetstreamIdentityEvent {
  did: string;
  handle: string;
  seq: number;
  time: string;
}

export interface JetstreamAccountEvent {
  active: boolean;
  did: string;
  seq: number;
  time: string;
  status?: string;
}

export interface JetstreamEvent {
  did: string;
  time_us: number;
  kind: 'commit' | 'identity' | 'account';
  commit?: JetstreamCommit;
  identity?: JetstreamIdentityEvent;
  account?: JetstreamAccountEvent;
}

/**
 * Flattened output — restructures the raw Jetstream JSON into a shape
 * that's ergonomic for n8n workflows. All event kinds share the top-level
 * `did`/`timeUs`/`kind` fields; kind-specific fields sit alongside them.
 */
export interface FlattenedJetstreamEvent {
  did: string;
  timeUs: number;
  kind: string;
  // Commit fields
  operation?: string;
  collection?: string;
  rkey?: string;
  rev?: string;
  cid?: string;
  record?: Record<string, unknown>;
  // Identity fields
  handle?: string;
  seq?: number;
  time?: string;
  // Account fields
  active?: boolean;
  status?: string;
}

export function flattenEvent(event: JetstreamEvent): FlattenedJetstreamEvent {
  const base: FlattenedJetstreamEvent = {
    did: event.did,
    timeUs: event.time_us,
    kind: event.kind,
  };

  if (event.kind === 'commit' && event.commit) {
    base.operation = event.commit.operation;
    base.collection = event.commit.collection;
    base.rkey = event.commit.rkey;
    base.rev = event.commit.rev;
    base.cid = event.commit.cid;
    base.record = event.commit.record as
      | Record<string, unknown>
      | undefined;
  } else if (event.kind === 'identity' && event.identity) {
    base.handle = event.identity.handle;
    base.seq = event.identity.seq;
    base.time = event.identity.time;
  } else if (event.kind === 'account' && event.account) {
    base.active = event.account.active;
    base.status = event.account.status;
    base.seq = event.account.seq;
    base.time = event.account.time;
  }

  return base;
}

export interface JetstreamOptions {
  endpoint: string;
  wantedCollections?: string[];
  wantedDids?: string[];
  cursor?: number;
  compression?: boolean;
  maxMessageSize?: number;
}

export interface JetstreamClientEvents {
  onEvent: (event: FlattenedJetstreamEvent) => void;
  onError: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Lazy-loaded zstd dictionary
// ---------------------------------------------------------------------------

let zstdDict: Buffer | null = null;

function loadZstdDictionary(): Buffer {
  if (!zstdDict) {
    zstdDict = readFileSync(resolve(__dirname, 'zstd_dictionary'));
  }
  return zstdDict;
}

// ---------------------------------------------------------------------------
// WebSocket client
// ---------------------------------------------------------------------------

/**
 * Connects to a Jetstream WebSocket endpoint and emits flattened events.
 *
 * Reconnection uses exponential backoff (1s → 2s → 4s … cap 30s) with a
 * 3s cursor rewind for gapless playback. The `stopped` flag is respected
 * by the reconnection loop — set via `stop()`.
 */
export class JetstreamClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private options: JetstreamOptions;
  private events: JetstreamClientEvents;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1_000;
  private cursor: number | undefined;

  constructor(options: JetstreamOptions, events: JetstreamClientEvents) {
    this.options = options;
    this.events = events;
    this.cursor = options.cursor;
  }

  private buildUrl(): string {
    const url = new URL(this.options.endpoint);

    if (this.options.wantedCollections?.length) {
      for (const nsid of this.options.wantedCollections) {
        url.searchParams.append('wantedCollections', nsid);
      }
    }

    if (this.options.wantedDids?.length) {
      for (const did of this.options.wantedDids) {
        url.searchParams.append('wantedDids', did);
      }
    }

    if (this.cursor) {
      url.searchParams.set('cursor', String(this.cursor));
    }

    if (this.options.compression) {
      url.searchParams.set('compress', 'true');
    }

    if (this.options.maxMessageSize && this.options.maxMessageSize > 0) {
      url.searchParams.set('maxMessageSizeBytes', String(this.options.maxMessageSize));
    }

    return url.toString();
  }

  /**
   * Open the WebSocket connection and start listening.
   * Returns a promise that resolves once the connection is established
   * (or rejects on failure).
   */
  async connect(): Promise<void> {
    if (this.stopped) return;

    const url = this.buildUrl();

    return new Promise<void>((resolvePromise, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this.scheduleReconnect();
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        this.backoff = 1_000;
        resolvePromise();
      };

      this.ws.onmessage = (msg: MessageEvent) => {
        this.handleMessage(msg).catch((err) =>
          this.events.onError(err instanceof Error ? err : new Error(String(err))),
        );
      };

      this.ws.onerror = () => {
        // onclose fires after onerror — handled there
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };
    });
  }

  private async handleMessage(msg: MessageEvent): Promise<void> {
    let data: Buffer;

    if (msg.data instanceof ArrayBuffer) {
      data = Buffer.from(msg.data);
    } else if (msg.data instanceof Blob) {
      data = Buffer.from(await msg.data.arrayBuffer());
    } else {
      // Text message — parse directly (shouldn't happen with compress=true)
      const event = JSON.parse(msg.data as string) as JetstreamEvent;
      this.processEvent(event);
      return;
    }

    // Binary message — decompress if compression is enabled
    if (this.options.compression) {
      const dict = loadZstdDictionary();
      data = await new Promise<Buffer>((resolvePromise, reject) => {
        zstdDecompress(data, { dictionary: dict }, (err, result) => {
          if (err) reject(err);
          else resolvePromise(result);
        });
      });
    }

    // Jetstream sends JSON objects — could be single or multiple per frame
    const text = data.toString('utf-8');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line) as JetstreamEvent;
      this.processEvent(event);
    }
  }

  private processEvent(event: JetstreamEvent): void {
    // Track cursor from latest event
    if (event.time_us) {
      this.cursor = event.time_us;
    }
    this.events.onEvent(flattenEvent(event));
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Rewind cursor ~3s for gapless playback
      if (this.cursor) {
        this.cursor = Math.max(0, this.cursor - 3_000_000);
      }
      this.connect().catch((err) =>
        this.events.onError(err instanceof Error ? err : new Error(String(err))),
      );
    }, this.backoff);

    // Exponential backoff: 1s → 2s → 4s … cap 30s
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  /** Tear down the connection and prevent reconnection. */
  stop(): void {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // Prevent onclose from triggering reconnect
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /** Get the most recent cursor value (for persisting to static data). */
  getCursor(): number | undefined {
    return this.cursor;
  }
}
