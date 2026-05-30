/**
 * Tests for $type and createdAt auto-injection.
 *
 * The node must:
 * - Auto-inject $type = collection NSID if not present
 * - Preserve user-provided $type if set
 * - Auto-inject createdAt as ISO string if not present
 * - Preserve user-provided createdAt if set
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import { createRecord, putRecord } from '../src/nodes/Atproto/operations';
import {
  server,
  PDS_URL,
  clearInterceptedRequests,
  clearMockResponses,
  interceptedRequests,
} from './setup';

let agent: Agent;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
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

function getLastRequestBody(method: string): Record<string, unknown> {
  const req = interceptedRequests.find(
    (r) => r.url.includes(method) && r.method === 'POST',
  );
  if (!req) throw new Error(`No intercepted request for ${method}`);
  return req!.body as Record<string, unknown>;
}

describe('$type auto-injection (createRecord)', () => {
  it('injects $type matching the collection NSID when absent', async () => {
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello' },
    });

    const body = getLastRequestBody('com.atproto.repo.createRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('app.bsky.feed.post');
  });

  it('does NOT override a user-provided $type', async () => {
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { $type: 'io.example.custom', text: 'Hello' },
    });

    const body = getLastRequestBody('com.atproto.repo.createRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('io.example.custom');
  });

  it('injects $type for different collection NSIDs', async () => {
    await createRecord(agent, {
      collection: 'com.atproto.repo.something',
      record: { name: 'test' },
    });

    const body = getLastRequestBody('com.atproto.repo.createRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('com.atproto.repo.something');
  });
});

describe('$type auto-injection (putRecord)', () => {
  it('injects $type when absent on put', async () => {
    await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { text: 'Updated' },
    });

    const body = getLastRequestBody('com.atproto.repo.putRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('app.bsky.feed.post');
  });

  it('preserves user $type on put', async () => {
    await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { $type: 'custom.override', text: 'Updated' },
    });

    const body = getLastRequestBody('com.atproto.repo.putRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['$type']).toBe('custom.override');
  });
});

describe('createdAt auto-injection', () => {
  it('injects createdAt as ISO timestamp when absent', async () => {
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello' },
    });

    const body = getLastRequestBody('com.atproto.repo.createRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['createdAt']).toBeDefined();
    expect(typeof record['createdAt']).toBe('string');
    // Should be a valid ISO 8601 datetime
    expect(() => new Date(record['createdAt'] as string)).not.toThrow();
  });

  it('preserves user-provided createdAt', async () => {
    const userDate = '2024-01-15T10:30:00.000Z';
    await createRecord(agent, {
      collection: 'app.bsky.feed.post',
      record: { text: 'Hello', createdAt: userDate },
    });

    const body = getLastRequestBody('com.atproto.repo.createRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['createdAt']).toBe(userDate);
  });

  it('injects createdAt on put as well', async () => {
    await putRecord(agent, {
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
      record: { text: 'Updated' },
    });

    const body = getLastRequestBody('com.atproto.repo.putRecord');
    const record = body?.record as Record<string, unknown>;
    expect(record['createdAt']).toBeDefined();
    expect(typeof record['createdAt']).toBe('string');
  });
});
