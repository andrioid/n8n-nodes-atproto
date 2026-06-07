/**
 * Tests for AT Protocol CRUD operations.
 *
 * Uses a mock XRPC server (msw) to simulate PDS responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import {
  createRecord,
  getRecord,
  putRecord,
  deleteRecord,
  listRecords,
} from '../nodes/Atproto/operations';

import {
  server,
  PDS_URL,
  FAKE_DID,
  clearInterceptedRequests,
  clearMockResponses,
  interceptedRequests,
  setMockResponse,
} from './setup';

let agent: Agent;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });

  // Authenticate a test agent against the mock server
  const session = new CredentialSession(new URL(PDS_URL));
  await session.login({
    identifier: 'test.bsky.social',
    password: 'xxxx-xxxx-xxxx-xxxx',
  });
  agent = new Agent(session);
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  clearInterceptedRequests();
  clearMockResponses();
});

describe('createRecord', () => {
  it('creates a record with minimal params', async () => {
    const result = await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello, world!' },
    });

    expect(result).toHaveProperty('uri');
    expect(result).toHaveProperty('cid');
    expect(result.uri).toContain(FAKE_DID);
  });

  it('auto-injects $type into the record body', async () => {
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello' },
    });

    // Find the createRecord request and check the body
    const req = interceptedRequests.find(
      (r) =>
        r.url.includes('com.atproto.repo.createRecord') && r.method === 'POST',
    );
    expect(req).toBeDefined();
    const body = req!.body as Record<string, unknown>;
    const record = body?.record as Record<string, unknown> | undefined;
    expect(record).toBeDefined();
    expect(record!['$type']).toBe('app.bsky.feed.post');
  });

  it('does not override existing $type in record data', async () => {
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { $type: 'custom.type', text: 'Hello' },
    });

    const req = interceptedRequests.find(
      (r) =>
        r.url.includes('com.atproto.repo.createRecord') && r.method === 'POST',
    );
    const body = req!.body as Record<string, unknown>;
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('custom.type');
  });

  it('accepts a custom rkey', async () => {
    const result = await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: 'my-custom-key',
      record: { text: 'Hello' },
    });

    expect(result.uri).toContain('my-custom-key');
  });

  it('accepts swapCommit for concurrency control', async () => {
    const result = await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello' },
      swapCommit: 'bafyreia-existing-cid',
    });

    expect(result).toHaveProperty('uri');
  });
});

describe('getRecord', () => {
  it('gets a record by collection and rkey', async () => {
    const result = await getRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
    });

    expect(result).toHaveProperty('uri');
    expect(result).toHaveProperty('cid');
    expect(result).toHaveProperty('value');
    expect(result.value).toHaveProperty('text');
  });

  it('optionally reads from a different repo', async () => {
    const result = await getRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      repo: 'did:plc:other-user',
    });

    expect(result).toHaveProperty('uri');
  });
});

describe('putRecord', () => {
  it('replaces a record completely', async () => {
    const result = await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { text: 'Updated content' },
    });

    expect(result).toHaveProperty('uri');
    expect(result).toHaveProperty('cid');
  });

  it('auto-injects $type on put as well', async () => {
    await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { text: 'Updated' },
    });

    const req = interceptedRequests.find(
      (r) =>
        r.url.includes('com.atproto.repo.putRecord') && r.method === 'POST',
    );
    const body = req!.body as Record<string, unknown>;
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('app.bsky.feed.post');
  });

  it('accepts swapCommit for optimistic concurrency', async () => {
    const result = await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { text: 'Updated' },
      swapCommit: 'bafyreia-current-cid',
    });

    expect(result).toHaveProperty('uri');
  });
});

describe('deleteRecord', () => {
  it('deletes a record by collection and rkey', async () => {
    const result = await deleteRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
    });

    expect(result).toBeDefined();
  });

  it('accepts optional swapCommit', async () => {
    const result = await deleteRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      swapCommit: 'bafyreia-current-cid',
    });

    expect(result).toBeDefined();
  });
});

describe('listRecords', () => {
  it('lists records in a collection', async () => {
    const result = await listRecords(agent, {
      collection: 'app.bsky.feed.post',
    });

    expect(result).toHaveProperty('records');
    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0]).toHaveProperty('uri');
    expect(result.records[0]).toHaveProperty('cid');
    expect(result.records[0]).toHaveProperty('value');
  });

  it('returns a cursor for pagination', async () => {
    const result = await listRecords(agent, {
      collection: 'app.bsky.feed.post',
      limit: 50,
    });

    expect(result).toHaveProperty('cursor');
    expect(result.cursor).toBe('next-page-cursor');
  });

  it('accepts limit parameter', async () => {
    const result = await listRecords(agent, {
      collection: 'app.bsky.feed.post',
      limit: 10,
    });

    expect(result.records.length).toBeGreaterThan(0);
  });

  it('accepts cursor parameter for pagination', async () => {
    const result = await listRecords(agent, {
      collection: 'app.bsky.feed.post',
      cursor: 'prev-page-cursor',
    });

    expect(result.records.length).toBeGreaterThan(0);
  });
});

describe('error handling', () => {
  it('throws on authentication failure', async () => {
    // Override createSession mock to return 401
    setMockResponse('com.atproto.server.createSession', () => {
      throw new Error('Authentication required');
    });

    const badSession = new CredentialSession(new URL(PDS_URL));
    await expect(
      badSession.login({
        identifier: 'bad@user.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow();
  });

  it('handles RecordNotFound gracefully', async () => {
    setMockResponse('com.atproto.repo.getRecord', () => {
      throw Object.assign(new Error('RecordNotFound'), {
        status: 404,
        error: 'RecordNotFound',
      });
    });

    await expect(
      getRecord(agent, {
        collection: 'app.bsky.feed.post',
        rkey: 'nonexistent',
      }),
    ).rejects.toThrow();
  });

  it('handles rate limiting', async () => {
    setMockResponse('com.atproto.repo.createRecord', () => {
      throw Object.assign(new Error('RateLimitExceeded: retry after 30s'), {
        status: 429,
        error: 'RateLimitExceeded',
      });
    });

    await expect(
      createRecord(agent, {
        collection: 'app.bsky.feed.post',
        record: { text: 'Hello' },
      }),
    ).rejects.toThrow();
  });
});
