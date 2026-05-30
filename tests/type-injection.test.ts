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
import { injectNestedTypes } from '../src/nodes/Atproto/typeInjection';
import { resolveLexiconSchema, clearLexiconCache } from '../src/nodes/Atproto/lexicon';
import { SINGLE_REF_UNION, TYPE_ONLY_COLOR, PUBLICATION_WITH_THEME } from './mockLexicons';
import {
  server,
  PDS_URL,
  CID_1,
  CID_2,
  CID_3,
  clearInterceptedRequests,
  clearMockResponses,
  setMockResponse,
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
  clearLexiconCache();
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

describe('hex color expansion (F4)', () => {
  it('expands #RRGGBB strings into { $type, r, g, b } objects', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.theme') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/y', schema: SINGLE_REF_UNION };
      }
      if (nsid === 'io.example.color') {
        return { cid: CID_2, uri: 'at://did:plc:fake/x/z', schema: TYPE_ONLY_COLOR };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.theme');
    const record = {
      background: '#3B82F6',
      accent: '#FF0000',
    };

    const result = await injectNestedTypes(record, schema, agent!);

    expect(result.background).toEqual({
      '$type': 'io.example.color#rgb',
      r: 59,
      g: 130,
      b: 246,
    });
    expect(result.accent).toEqual({
      '$type': 'io.example.color#rgb',
      r: 255,
      g: 0,
      b: 0,
    });
  });

  it('expands shorthand #RGB into { $type, r, g, b }', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.theme') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/y', schema: SINGLE_REF_UNION };
      }
      if (nsid === 'io.example.color') {
        return { cid: CID_2, uri: 'at://did:plc:fake/x/z', schema: TYPE_ONLY_COLOR };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.theme');
    const result = await injectNestedTypes(
      { background: '#FFF', accent: '#000' },
      schema,
      agent!,
    );

    expect(result.background).toEqual({
      '$type': 'io.example.color#rgb',
      r: 255, g: 255, b: 255,
    });
    expect(result.accent).toEqual({
      '$type': 'io.example.color#rgb',
      r: 0, g: 0, b: 0,
    });
  });

  it('leaves non-hex strings unchanged', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.theme') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/y', schema: SINGLE_REF_UNION };
      }
      if (nsid === 'io.example.color') {
        return { cid: CID_2, uri: 'at://did:plc:fake/x/z', schema: TYPE_ONLY_COLOR };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.theme');
    const result = await injectNestedTypes(
      { background: 'not-a-color', accent: '#3B82F6' },
      schema,
      agent!,
    );

    // Non-hex string passes through unchanged
    expect(result.background).toBe('not-a-color');
    // Valid hex is expanded
    expect(result.accent).toEqual({
      '$type': 'io.example.color#rgb',
      r: 59, g: 130, b: 246,
    });
  });

  it('injects $type on nested refs AND expands hex colors two levels deep', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.publication') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/a', schema: PUBLICATION_WITH_THEME };
      }
      if (nsid === 'io.example.theme') {
        return { cid: CID_2, uri: 'at://did:plc:fake/x/b', schema: SINGLE_REF_UNION };
      }
      if (nsid === 'io.example.color') {
        return { cid: CID_3, uri: 'at://did:plc:fake/x/c', schema: TYPE_ONLY_COLOR };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.publication');
    const record = {
      name: 'My Blog',
      theme: {
        background: '#FFFFFF',
        accent: '#3B82F6',
      },
    };

    const result = await injectNestedTypes(record, schema, agent!);

    // Top-level ref gets $type
    const theme = result.theme as Record<string, unknown>;
    expect(theme['$type']).toBe('io.example.theme');

    // Nested hex colors get expanded with $type
    expect(theme.background).toEqual({
      '$type': 'io.example.color#rgb',
      r: 255, g: 255, b: 255,
    });
    expect(theme.accent).toEqual({
      '$type': 'io.example.color#rgb',
      r: 59, g: 130, b: 246,
    });
  });
});
