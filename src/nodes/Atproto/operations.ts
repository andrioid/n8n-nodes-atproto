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

import type { Agent } from '@atproto/api';
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
  const repo = params.repo ?? getOwnDid(agent);

  const response = await agent.com.atproto.repo.getRecord({
    repo,
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
  const repo = params.repo ?? getOwnDid(agent);

  const response = await agent.com.atproto.repo.listRecords({
    repo,
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
