/**
 * Tests for the Jetstream WebSocket client and event types.
 *
 * Covers: event flattening, zstd compression round-trip, filter logic,
 * cursor tracking.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { createRequire } from 'node:module';

// ws is a CJS package; use createRequire to access its Server class
const _require = createRequire(import.meta.url);
const { Server: WsServer } = _require('ws');

import { flattenEvent, JetstreamClient } from '../src/nodes/Atproto/jetstream';
import type { JetstreamEvent, FlattenedJetstreamEvent } from '../src/nodes/Atproto/jetstream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockCommitEvent(
  overrides: Partial<JetstreamEvent> = {},
): JetstreamEvent {
  return {
    did: 'did:plc:test',
    time_us: 1725911162329308,
    kind: 'commit',
    commit: {
      rev: '3l3qo2vutsw2b',
      operation: 'create',
      collection: 'app.bsky.feed.post',
      rkey: '3l3qo2vuowo2b',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'Hello!',
        createdAt: '2024-09-09T19:46:02.102Z',
      },
      cid: 'bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi',
    },
    ...overrides,
  };
}

function mockIdentityEvent(
  overrides: Partial<JetstreamEvent> = {},
): JetstreamEvent {
  return {
    did: 'did:plc:test',
    time_us: 1725516665234703,
    kind: 'identity',
    identity: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
      seq: 1409752997,
      time: '2024-09-05T06:11:04.870Z',
    },
    ...overrides,
  };
}

function mockAccountEvent(
  overrides: Partial<JetstreamEvent> = {},
): JetstreamEvent {
  return {
    did: 'did:plc:test',
    time_us: 1725516665333808,
    kind: 'account',
    account: {
      active: true,
      did: 'did:plc:test',
      seq: 1409753013,
      time: '2024-09-05T06:11:04.870Z',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// flattenEvent
// ---------------------------------------------------------------------------

describe('flattenEvent', () => {
  it('flattens a commit (create) event', () => {
    const flat = flattenEvent(mockCommitEvent());

    expect(flat.did).toBe('did:plc:test');
    expect(flat.timeUs).toBe(1725911162329308);
    expect(flat.kind).toBe('commit');
    expect(flat.operation).toBe('create');
    expect(flat.collection).toBe('app.bsky.feed.post');
    expect(flat.rkey).toBe('3l3qo2vuowo2b');
    expect(flat.rev).toBe('3l3qo2vutsw2b');
    expect(flat.cid).toBe(
      'bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi',
    );
    expect(flat.record).toEqual({
      $type: 'app.bsky.feed.post',
      text: 'Hello!',
      createdAt: '2024-09-09T19:46:02.102Z',
    });
    // Identity/account fields should be absent
    expect(flat.handle).toBeUndefined();
    expect(flat.active).toBeUndefined();
  });

  it('flattens a commit (delete) event with no record', () => {
    const flat = flattenEvent(
      mockCommitEvent({
        commit: {
          rev: '3l3qo2vutsw2b',
          operation: 'delete',
          collection: 'app.bsky.graph.follow',
          rkey: '3l3dn7tku762u',
        },
      }),
    );

    expect(flat.kind).toBe('commit');
    expect(flat.operation).toBe('delete');
    expect(flat.collection).toBe('app.bsky.graph.follow');
    expect(flat.rkey).toBe('3l3dn7tku762u');
    expect(flat.record).toBeUndefined();
  });

  it('flattens an identity event', () => {
    const flat = flattenEvent(mockIdentityEvent());

    expect(flat.kind).toBe('identity');
    expect(flat.handle).toBe('test.bsky.social');
    expect(flat.seq).toBe(1409752997);
    expect(flat.time).toBe('2024-09-05T06:11:04.870Z');
    // Commit fields should be absent
    expect(flat.operation).toBeUndefined();
    expect(flat.collection).toBeUndefined();
  });

  it('flattens an account event', () => {
    const flat = flattenEvent(mockAccountEvent());

    expect(flat.kind).toBe('account');
    expect(flat.active).toBe(true);
    expect(flat.status).toBeUndefined();
    expect(flat.seq).toBe(1409753013);
    expect(flat.time).toBe('2024-09-05T06:11:04.870Z');
  });

  it('flattens an account event with deactivated status', () => {
    const flat = flattenEvent(
      mockAccountEvent({
        account: {
          active: false,
          did: 'did:plc:test',
          seq: 1409753014,
          time: '2024-09-05T06:11:05.000Z',
          status: 'deactivated',
        },
      }),
    );

    expect(flat.active).toBe(false);
    expect(flat.status).toBe('deactivated');
  });
});

// ---------------------------------------------------------------------------
// Filtering logic (as done in the trigger node)
// ---------------------------------------------------------------------------

describe('event filtering', () => {
  it('filters by event kind', () => {
    const kindFilter = new Set(['commit']);
    const received: FlattenedJetstreamEvent[] = [];

    const handler = (event: FlattenedJetstreamEvent) => {
      if (!kindFilter.has(event.kind)) return;
      received.push(event);
    };

    handler(flattenEvent(mockCommitEvent()));
    handler(flattenEvent(mockIdentityEvent()));
    handler(flattenEvent(mockAccountEvent()));

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('commit');
  });

  it('filters multiple event kinds', () => {
    const kindFilter = new Set(['commit', 'identity']);
    const received: FlattenedJetstreamEvent[] = [];

    const handler = (event: FlattenedJetstreamEvent) => {
      if (!kindFilter.has(event.kind)) return;
      received.push(event);
    };

    handler(flattenEvent(mockCommitEvent()));
    handler(flattenEvent(mockIdentityEvent()));
    handler(flattenEvent(mockAccountEvent()));

    expect(received).toHaveLength(2);
    expect(received[0].kind).toBe('commit');
    expect(received[1].kind).toBe('identity');
  });

  it('filters by commit operation', () => {
    const operationFilter = new Set(['create', 'update']);
    const received: FlattenedJetstreamEvent[] = [];

    const handler = (event: FlattenedJetstreamEvent) => {
      if (event.kind !== 'commit') return;
      if (event.operation && !operationFilter.has(event.operation)) return;
      received.push(event);
    };

    handler(
      flattenEvent(
        mockCommitEvent({
          commit: { ...mockCommitEvent().commit!, operation: 'create' },
        }),
      ),
    );
    handler(
      flattenEvent(
        mockCommitEvent({
          commit: { ...mockCommitEvent().commit!, operation: 'update' },
        }),
      ),
    );
    handler(
      flattenEvent(
        mockCommitEvent({
          commit: { ...mockCommitEvent().commit!, operation: 'delete' },
        }),
      ),
    );

    expect(received).toHaveLength(2);
    expect(received[0].operation).toBe('create');
    expect(received[1].operation).toBe('update');
  });

  it('passes all operations when filter is empty', () => {
    const received: FlattenedJetstreamEvent[] = [];

    const handler = (event: FlattenedJetstreamEvent) => {
      if (event.kind !== 'commit') return;
      // No operation filter — pass all
      received.push(event);
    };

    handler(
      flattenEvent(
        mockCommitEvent({
          commit: { ...mockCommitEvent().commit!, operation: 'create' },
        }),
      ),
    );
    handler(
      flattenEvent(
        mockCommitEvent({
          commit: { ...mockCommitEvent().commit!, operation: 'delete' },
        }),
      ),
    );

    expect(received).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Cursor tracking
// ---------------------------------------------------------------------------

describe('cursor tracking', () => {
  it('starts with undefined cursor when none provided', () => {
    const client = new JetstreamClient(
      { endpoint: 'wss://example.com/subscribe' },
      { onEvent: () => {}, onError: () => {} },
    );
    expect(client.getCursor()).toBeUndefined();
  });

  it('accepts an initial cursor', () => {
    const client = new JetstreamClient(
      { endpoint: 'wss://example.com/subscribe', cursor: 1000 },
      { onEvent: () => {}, onError: () => {} },
    );
    expect(client.getCursor()).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Zstd dictionary round-trip
// ---------------------------------------------------------------------------

describe('zstd dictionary round-trip', () => {
  let dictionary: Buffer;

  beforeAll(() => {
    dictionary = readFileSync(
      resolve(__dirname, '../src/nodes/Atproto/zstd_dictionary'),
    );
  });

  it('compresses and decompresses a commit event using the Jetstream dictionary', async () => {
    const payload = JSON.stringify(mockCommitEvent());

    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zstdCompress(Buffer.from(payload), { dictionary }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(compressed.length).toBeLessThan(payload.length);

    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      zstdDecompress(compressed, { dictionary }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    expect(decompressed.toString()).toBe(payload);
  });

  it('decompressing without dictionary fails', async () => {
    const payload = JSON.stringify(mockCommitEvent());
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zstdCompress(Buffer.from(payload), { dictionary }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    await expect(
      new Promise<Buffer>((resolve, reject) => {
        zstdDecompress(compressed, {}, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebSocket integration (local WS server with ws library)
// ---------------------------------------------------------------------------

describe('JetstreamClient WebSocket integration', () => {
  let wss: import('ws').Server;
  let port: number;

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      const server = new WsServer({ port: 0, path: '/subscribe' });
      wss = server;
      server.on('listening', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(() => {
    wss?.close();
  });

  it('receives uncompressed JSON events over WebSocket', async () => {
    const received: FlattenedJetstreamEvent[] = [];
    const errors: Error[] = [];

    const client = new JetstreamClient(
      {
        endpoint: `ws://localhost:${port}/subscribe`,
        compression: false,
      },
      {
        onEvent: (e) => received.push(e),
        onError: (e) => errors.push(e),
      },
    );

    await client.connect();

    // Let the server know we connected
    await new Promise((r) => setTimeout(r, 50));

    // Send events from server to client
    const commitEvent = mockCommitEvent();
    wss.clients.forEach((ws) => {
      ws.send(JSON.stringify(commitEvent));
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('commit');
    expect(received[0].did).toBe('did:plc:test');
    expect(errors).toHaveLength(0);

    client.stop();
  });

  it('receives zstd-compressed binary events', async () => {
    const received: FlattenedJetstreamEvent[] = [];
    const errors: Error[] = [];

    const dictionary = readFileSync(
      resolve(__dirname, '../src/nodes/Atproto/zstd_dictionary'),
    );

    const client = new JetstreamClient(
      {
        endpoint: `ws://localhost:${port}/subscribe`,
        compression: true,
      },
      {
        onEvent: (e) => received.push(e),
        onError: (e) => errors.push(e),
      },
    );

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Send compressed event
    const payload = JSON.stringify(mockCommitEvent());
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zstdCompress(Buffer.from(payload), { dictionary }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    wss.clients.forEach((ws) => {
      ws.send(compressed);
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('commit');
    expect(received[0].record).toBeDefined();
    expect(
      (received[0].record as Record<string, unknown>)?.text,
    ).toBe('Hello!');
    expect(errors).toHaveLength(0);

    client.stop();
  });

  it('tracks cursor from received events', async () => {
    const client = new JetstreamClient(
      {
        endpoint: `ws://localhost:${port}/subscribe`,
        compression: false,
      },
      {
        onEvent: () => {},
        onError: () => {},
      },
    );

    await client.connect();
    await new Promise((r) => setTimeout(r, 50));

    // Send events with ascending timestamps
    const event1 = mockCommitEvent({ time_us: 1000 });
    const event2 = mockCommitEvent({ time_us: 2000 });

    wss.clients.forEach((ws) => {
      ws.send(JSON.stringify(event1));
      ws.send(JSON.stringify(event2));
    });

    await new Promise((r) => setTimeout(r, 100));

    // Cursor should track the latest event's time_us
    expect(client.getCursor()).toBe(2000);

    client.stop();
  });
});
