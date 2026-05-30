/**
 * Tests for execution-time record validation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import { validateRecord } from '../src/nodes/Atproto/validation';
import { resolveLexiconSchema, clearLexiconCache } from '../src/nodes/Atproto/lexicon';
import {
  server,
  PDS_URL,
  CID_1,
  CID_2,
  CID_3,
  setMockResponse,
  clearMockResponses,
} from './setup';
import {
  PRIMITIVE_ONLY,
  SINGLE_REF_UNION,
  TYPE_ONLY_COLOR,
  PUBLICATION_WITH_THEME,
  APP_BSKY_FEED_POST,
} from './mockLexicons';

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
  clearLexiconCache();
  clearMockResponses();
});

describe('required field checks', () => {
  it('reports missing required fields', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord({}, schema, agent);

    expect(errors.some((e) => e.includes("'text'"))).toBe(true);
  });

  it('passes when all required fields are present', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      { text: 'Hello', createdAt: new Date().toISOString() },
      schema,
      agent,
    );

    expect(errors).toHaveLength(0);
  });

  it('skips auto-injected fields ($type, createdAt)', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    // Only text is required (createdAt is auto-injected)
    const errors = await validateRecord({ text: 'Hello' }, schema, agent);

    expect(errors.some((e) => e.includes('createdAt'))).toBe(false);
  });
});

describe('type checks', () => {
  it('catches wrong type — string where integer expected', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: PRIMITIVE_ONLY,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const errors = await validateRecord(
      { title: 'ok', count: 'not a number' },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'count'") && e.includes('integer'))).toBe(true);
  });

  it('catches wrong type — number where string expected', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      { text: 12345, createdAt: new Date().toISOString() },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'text'") && e.includes('string'))).toBe(true);
  });

  it('catches non-array where array expected', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      { text: 'Hello', tags: 'not-an-array' },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'tags'") && e.includes('array'))).toBe(true);
  });
});

describe('union $type checks', () => {
  it('reports missing $type on union objects', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      {
        text: 'Hello',
        embed: { url: 'https://example.com' },
      },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'embed'") && e.includes('$type'))).toBe(true);
  });

  it('reports invalid $type on union objects', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      {
        text: 'Hello',
        embed: { $type: 'com.invalid.type' },
      },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes('invalid $type'))).toBe(true);
  });

  it('passes with valid $type on union objects', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const errors = await validateRecord(
      {
        text: 'Hello',
        embed: { $type: 'app.bsky.embed.external', external: {} },
      },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'embed'"))).toBe(false);
  });
});

describe('nested validation', () => {
  it('validates required fields inside nested refs', async () => {
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
    const errors = await validateRecord(
      {
        name: 'My Blog',
        theme: {
          $type: 'io.example.theme',
          // missing background and accent (both required)
        },
      },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes('theme.background'))).toBe(true);
    expect(errors.some((e) => e.includes('theme.accent'))).toBe(true);
  });
});

describe('null schema', () => {
  it('returns empty errors when schema is null', async () => {
    const errors = await validateRecord({ anything: 'goes' }, null, agent);
    expect(errors).toHaveLength(0);
  });
});

describe('blob field checks', () => {
  it('reports unresolved blob fields (still a string after upload phase)', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: PRIMITIVE_ONLY,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const errors = await validateRecord(
      { title: 'ok', count: 1, blob: 'myBinaryProperty' },
      schema,
      agent,
    );

    expect(errors.some((e) => e.includes("'blob'") && e.includes('binary property'))).toBe(true);
  });
});
