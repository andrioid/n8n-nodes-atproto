/**
 * CRUD operations for AT Protocol records.
 *
 * Each function wraps an XRPC call via the authenticated Agent.
 * - `$type` is auto-injected from the collection NSID.
 * - `createdAt` is auto-injected as ISO string when the schema requires it
 *   (Phase 1: always inject; Phase 2 will make it schema-conditional).
 * - `repo` defaults to the authenticated user's DID for write operations.
 *   Get/List accept an optional `repo` to read other users' public records.
 */

import { Agent } from '@atproto/api';
import type { LexiconSchema } from './lexicon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRecordParams {
  collection: string;
  record: Record<string, unknown>;
  rkey?: string;
  swapCommit?: string;
  /** Defaults to authenticated user's DID */
  repo?: string;
}

export interface GetRecordParams {
  collection: string;
  rkey: string;
  /** Defaults to authenticated user's DID */
  repo?: string;
}

export interface PutRecordParams {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
  swapCommit?: string;
  /** Defaults to authenticated user's DID */
  repo?: string;
}

export interface DeleteRecordParams {
  collection: string;
  rkey: string;
  swapCommit?: string;
  /** Defaults to authenticated user's DID */
  repo?: string;
}

export interface ListRecordsParams {
  collection: string;
  cursor?: string;
  limit?: number;
  /** Defaults to authenticated user's DID */
  repo?: string;
}

export interface CreateRecordResult {
  uri: string;
  cid: string;
}

export interface GetRecordResult {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

export interface PutRecordResult {
  uri: string;
  cid: string;
}

export interface DeleteRecordResult {
  uri?: string;
  cid?: string;
}

export interface ListRecordsResult {
  records: Array<{
    uri: string;
    cid: string;
    value: Record<string, unknown>;
  }>;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Blob operation params / results
// ---------------------------------------------------------------------------

export interface UploadBlobParams {
  data: Buffer;
  mimeType: string;
}

export interface UploadBlobResult {
  blob: {
    $type: 'blob';
    ref: { $link: string };
    mimeType: string;
    size: number;
  };
}

export interface GetBlobParams {
  /** DID of the account that owns the blob. */
  did: string;
  /** CID of the blob to fetch. */
  cid: string;
}

export interface GetBlobResult {
  /** Raw blob bytes. */
  data: Buffer;
  /** MIME type reported by the server (from Content-Type), or empty string. */
  mimeType: string;
  /** Size of the returned buffer in bytes. */
  size: number;
}

export interface ListBlobsParams {
  /** DID of the repo to list blobs for. Defaults to authenticated user. */
  did?: string;
  cursor?: string;
  limit?: number;
  /** Optional repo revision — list only blobs added since this rev. */
  since?: string;
}

export interface ListBlobsResult {
  cids: string[];
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Injects `$type` if not already present.
 */
function ensure$type(record: Record<string, unknown>, collection: string): void {
  if (!record['$type']) {
    record['$type'] = collection;
  }
}

/**
 * Injects `createdAt` if not already present (ISO timestamp).
 * Phase 1: always inject. Phase 2 will check the lexicon schema.
 */
function ensureCreatedAt(record: Record<string, unknown>): void {
  if (!record['createdAt']) {
    record['createdAt'] = new Date().toISOString();
  }
}

/**
 * Returns the authenticated user's DID from the agent's session manager.
 */
function getOwnDid(agent: Agent): string {
  const did = agent.did;
  if (!did) {
    throw new Error('Not authenticated — no DID available');
  }
  return did;
}

/**
 * Resolve a handle to a DID if needed. Returns DIDs unchanged.
 * Strips a leading `@` from handles. Trims whitespace.
 */
async function resolveActorToDid(
  agent: Agent,
  actor: string,
): Promise<string> {
  const trimmed = actor.trim();
  if (trimmed.startsWith('did:')) return trimmed;
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const res = await agent.com.atproto.identity.resolveHandle({ handle });
  return res.data.did;
}

// ---------------------------------------------------------------------------
// Read routing — direct repo reads to the PDS that hosts the target repo
// ---------------------------------------------------------------------------

interface DidDocument {
  service?: Array<{ id: string; type: string; serviceEndpoint: unknown }>;
}

/**
 * Map a DID to the URL of its DID document. Supports did:plc (PLC directory)
 * and did:web.
 */
function didDocumentUrl(did: string): string {
  if (did.startsWith('did:plc:')) {
    return `https://plc.directory/${did}`;
  }
  if (did.startsWith('did:web:')) {
    const [host, ...path] = did
      .slice('did:web:'.length)
      .split(':')
      .map(decodeURIComponent);
    return path.length === 0
      ? `https://${host}/.well-known/did.json`
      : `https://${host}/${path.join('/')}/did.json`;
  }
  throw new Error(`Unsupported DID method: ${did}`);
}

/**
 * Resolve a DID's hosting PDS endpoint from its DID document.
 */
async function resolvePdsEndpoint(did: string): Promise<string> {
  const res = await fetch(didDocumentUrl(did));
  if (!res.ok) {
    throw new Error(`Failed to resolve DID ${did}: HTTP ${res.status}`);
  }
  const doc = (await res.json()) as DidDocument;
  const endpoint = doc.service?.find((s) =>
    s.id.endsWith('#atproto_pds'),
  )?.serviceEndpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error(`No PDS endpoint found in DID document for ${did}`);
  }
  return endpoint;
}

/**
 * Resolve the repo to read from into a DID plus an Agent pointed at the PDS
 * that hosts it. Repo-hosting reads (getRecord, listRecords, getBlob,
 * listBlobs) must hit that PDS — the authenticated session's PDS only serves
 * its own repos and answers "Could not find repo" for any other.
 *
 * The session agent is reused for the user's own repo (already on the correct
 * PDS); foreign repos get an unauthenticated Agent, since these reads are
 * public.
 */
async function resolveReadTarget(
  agent: Agent,
  actor?: string,
): Promise<{ did: string; agent: Agent }> {
  if (!actor || actor.trim() === '') {
    return { did: getOwnDid(agent), agent };
  }
  const did = await resolveActorToDid(agent, actor);
  if (did === agent.did) {
    return { did, agent };
  }
  return { did, agent: new Agent(await resolvePdsEndpoint(did)) };
}

// ---------------------------------------------------------------------------
// Const injection
// ---------------------------------------------------------------------------

/**
 * Walk schema properties and inject `const` values for any field the user
 * left empty. This ensures constant fields are always set correctly even if
 * the readOnly UI is bypassed (e.g. via JSON mode or expressions).
 */
export function applyConstValues(
  record: Record<string, unknown>,
  schema: LexiconSchema | null,
): void {
  if (!schema) return;
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.const !== undefined && (record[name] === undefined || record[name] === null || record[name] === '')) {
      record[name] = prop.const;
    }
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Creates a record in the specified collection.
 * Auto-generates a TID if no `rkey` is provided.
 * Auto-injects `$type` and `createdAt`.
 */
export async function createRecord(
  agent: Agent,
  params: CreateRecordParams,
): Promise<CreateRecordResult> {
  const repo = params.repo ?? getOwnDid(agent);

  const record = { ...params.record };
  ensure$type(record, params.collection);
  ensureCreatedAt(record);

  const response = await agent.com.atproto.repo.createRecord({
    repo,
    collection: params.collection,
    rkey: params.rkey,
    record,
    swapCommit: params.swapCommit,
  });

  const data = response.data;
  return { uri: data.uri, cid: data.cid };
}

/**
 * Gets a record by collection and record key.
 * Optionally reads from a different repo (defaults to self).
 */
export async function getRecord(
  agent: Agent,
  params: GetRecordParams,
): Promise<GetRecordResult> {
  const { did, agent: reader } = await resolveReadTarget(agent, params.repo);

  const response = await reader.com.atproto.repo.getRecord({
    repo: did,
    collection: params.collection,
    rkey: params.rkey,
  });

  const data = response.data as {
    uri: string;
    cid: string;
    value: Record<string, unknown>;
  };
  return { uri: data.uri, cid: data.cid, value: data.value };
}

/**
 * Full-replaces a record. Optional `swapCommit` for optimistic concurrency.
 * Auto-injects `$type` and `createdAt`.
 */
export async function putRecord(
  agent: Agent,
  params: PutRecordParams,
): Promise<PutRecordResult> {
  const repo = params.repo ?? getOwnDid(agent);

  const record = { ...params.record };
  ensure$type(record, params.collection);
  ensureCreatedAt(record);

  const response = await agent.com.atproto.repo.putRecord({
    repo,
    collection: params.collection,
    rkey: params.rkey,
    record,
    swapCommit: params.swapCommit,
  });

  const data = response.data;
  return { uri: data.uri, cid: data.cid };
}

/**
 * Deletes a record by collection and record key.
 */
export async function deleteRecord(
  agent: Agent,
  params: DeleteRecordParams,
): Promise<DeleteRecordResult> {
  const repo = params.repo ?? getOwnDid(agent);

  const response = await agent.com.atproto.repo.deleteRecord({
    repo,
    collection: params.collection,
    rkey: params.rkey,
    swapCommit: params.swapCommit,
  });

  return response.data as DeleteRecordResult;
}

/**
 * Lists records in a collection with optional pagination.
 * Returns one page per execution; chain nodes or loop to paginate.
 */
export async function listRecords(
  agent: Agent,
  params: ListRecordsParams,
): Promise<ListRecordsResult> {
  const { did, agent: reader } = await resolveReadTarget(agent, params.repo);

  const response = await reader.com.atproto.repo.listRecords({
    repo: did,
    collection: params.collection,
    limit: params.limit,
    cursor: params.cursor,
  });

  const data = response.data as {
    records: Array<{
      uri: string;
      cid: string;
      value: Record<string, unknown>;
    }>;
    cursor?: string;
  };

  return {
    records: data.records.map((r) => ({
      uri: r.uri,
      cid: r.cid,
      value: r.value,
    })),
    cursor: data.cursor,
  };
}

// ---------------------------------------------------------------------------
// Blob operations
// ---------------------------------------------------------------------------

/**
 * Upload a blob to the authenticated user's PDS.
 *
 * Returns the blob reference in the canonical AT Protocol shape, ready to
 * embed in a record:
 *
 *   { "$type": "blob", "ref": { "$link": "bafkrei..." }, "mimeType": "image/jpeg", "size": 12345 }
 *
 * The PDS may reject blobs over a service-defined size limit (commonly
 * ~1 MB on bsky.social). The error is propagated unchanged so the caller
 * can surface it to the user.
 */
export async function uploadBlob(
  agent: Agent,
  params: UploadBlobParams,
): Promise<UploadBlobResult> {
  const response = await agent.com.atproto.repo.uploadBlob(params.data, {
    encoding: params.mimeType,
  });

  // BlobRef serializes to the on-the-wire JSON shape via toJSON();
  // calling it explicitly gives us a plain object that's safe to return
  // through n8n's data pipeline.
  const ref = response.data.blob as unknown as { toJSON?: () => unknown };
  const serialized =
    typeof ref.toJSON === 'function'
      ? (ref.toJSON() as UploadBlobResult['blob'])
      : (response.data.blob as unknown as UploadBlobResult['blob']);

  return { blob: serialized };
}

/**
 * Download a blob by CID from a given repo.
 *
 * `did` is required by the XRPC method and must be a DID (callers should
 * resolve handles upfront). Returns the raw bytes plus the server-reported
 * MIME type (read from the response headers).
 */
export async function getBlob(
  agent: Agent,
  params: GetBlobParams,
): Promise<GetBlobResult> {
  const { did, agent: reader } = await resolveReadTarget(agent, params.did);

  const response = await reader.com.atproto.sync.getBlob({
    did,
    cid: params.cid,
  });

  // response.data is a Uint8Array — convert to Buffer for n8n's binary helpers.
  const buffer = Buffer.from(response.data);
  const mimeType =
    (response.headers as Record<string, string> | undefined)?.['content-type'] ??
    '';

  return {
    data: buffer,
    mimeType,
    size: buffer.length,
  };
}

/**
 * List blob CIDs in a repo. Paginated; pass `cursor` from a previous response
 * to fetch the next page. `since` filters to blobs added after a given repo
 * revision (rev) — useful for incremental sync.
 *
 * `did` defaults to the authenticated user.
 */
export async function listBlobs(
  agent: Agent,
  params: ListBlobsParams = {},
): Promise<ListBlobsResult> {
  const { did, agent: reader } = await resolveReadTarget(agent, params.did);

  const response = await reader.com.atproto.sync.listBlobs({
    did,
    limit: params.limit,
    cursor: params.cursor,
    since: params.since,
  });

  return {
    cids: response.data.cids,
    cursor: response.data.cursor,
  };
}

export { resolveActorToDid };
