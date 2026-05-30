/**
 * Tests for lexicon resolution (Phase 2).
 *
 * Tests:
 * - Parsing realistic lexicon documents (app.bsky.feed.post)
 * - PDS endpoint resolution via mock agent
 * - Cache behavior
 * - Handling of non-record lexicons (query/procedure)
 * - Handling of unknown NSIDs
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import { resolveLexiconSchema, clearLexiconCache } from '../src/nodes/Atproto/lexicon';
import { server, PDS_URL, CID_1, CID_2, CID_3 } from './setup';
import { APP_BSKY_FEED_POST, QUERY_NOT_RECORD, INLINE_OBJECT, DEEPLY_NESTED } from './mockLexicons';
import { setMockResponse, clearMockResponses } from './setup';

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

describe('resolveLexiconSchema — PDS endpoint', () => {
  it('resolves app.bsky.feed.post and returns a valid schema', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');

    expect(schema).not.toBeNull();
    expect(schema!.nsid).toBe('app.bsky.feed.post');
    expect(schema!.properties).toHaveProperty('text');
    expect(schema!.properties).toHaveProperty('createdAt');
    expect(schema!.properties).toHaveProperty('reply');
    expect(schema!.properties).toHaveProperty('embed');
    expect(schema!.properties).toHaveProperty('tags');
    expect(schema!.required).toContain('text');
    expect(schema!.required).toContain('createdAt');
    expect(schema!.key).toBe('tid');
  });

  it('extracts property types correctly', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    expect(schema).not.toBeNull();

    expect(schema!.properties.text.type).toBe('string');
    expect(schema!.properties.createdAt.type).toBe('string');
    expect(schema!.properties.createdAt.format).toBe('datetime');
    expect(schema!.properties.reply.type).toBe('ref');
    expect(schema!.properties.reply.ref).toBe('app.bsky.feed.post#replyRef');
    expect(schema!.properties.embed.type).toBe('union');
    expect(schema!.properties.tags.type).toBe('array');
  });

  it('caches resolved schemas', async () => {
    const schema1 = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const schema2 = await resolveLexiconSchema(agent, 'app.bsky.feed.post');

    expect(schema1).toBe(schema2); // Same cached object
  });

  it('handles clearing cache', async () => {
    const schema1 = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    clearLexiconCache();
    const schema2 = await resolveLexiconSchema(agent, 'app.bsky.feed.post');

    expect(schema1).not.toBe(schema2); // Different objects after cache clear
  });

  it('returns null for unknown NSIDs', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.unknown.nsid');
    expect(schema).toBeNull();
  });

  it('returns null for query/procedure lexicons (not record)', async () => {
    // Override the resolveLexicon mock to return a query-type lexicon
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_2,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/query_test',
      schema: QUERY_NOT_RECORD,
    }));

    const schema = await resolveLexiconSchema(agent, 'com.atproto.repo.getRecord');
    expect(schema).toBeNull();
  });

  it('resolves with nullable fields', async () => {
    // Create a lexicon with nullable fields
    const lexiconWithNullable = {
      ...APP_BSKY_FEED_POST,
      defs: {
        ...APP_BSKY_FEED_POST.defs,
        main: {
          ...APP_BSKY_FEED_POST.defs.main,
          record: {
            ...APP_BSKY_FEED_POST.defs.main.record,
            nullable: ['tags', 'langs'],
          },
        },
      },
    };

    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_2,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/nullable_test',
      schema: lexiconWithNullable,
    }));

    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    expect(schema).not.toBeNull();
    expect(schema!.properties.tags.nullable).toBe(true);
    expect(schema!.properties.text.nullable).toBe(false);
  });
});

describe('resolveLexiconSchema — without agent', () => {
  it('returns null when no agent and lexicon not in cache', async () => {
    clearLexiconCache();
    const schema = await resolveLexiconSchema(null, 'app.bsky.feed.post');
    // Without agent, we'd need DNS resolution which won't work in tests
    expect(schema).toBeNull();
  });

  it('returns cached result when available', async () => {
    // First, populate the cache via agent
    const schema1 = await resolveLexiconSchema(agent, 'io.example.primitive');
    expect(schema1).not.toBeNull();

    // Now try without agent — should hit cache
    const schema2 = await resolveLexiconSchema(null, 'io.example.primitive');
    expect(schema2).not.toBeNull();
    expect(schema2!.properties.title.type).toBe('string');
  });
});

describe('resolveLexiconSchema — inline objects', () => {
  it('resolves lexicons with inline object properties', async () => {
    // Override the mock to return our inline object lexicon
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_3,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/inline_test',
      schema: INLINE_OBJECT,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.nested');
    expect(schema).not.toBeNull();
    expect(schema!.properties.name.type).toBe('string');
    expect(schema!.properties.metadata.type).toBe('object');
    expect(schema!.properties.metadata.properties).toBeDefined();
    expect(schema!.properties.metadata.properties!.source.type).toBe('string');
    expect(schema!.properties.metadata.properties!.version.type).toBe('integer');
  });
});

describe('resolveLexiconSchema — deeply nested refs', () => {
  it('resolves lexicons with deep ref chains', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_3,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/deep_test',
      schema: DEEPLY_NESTED,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.deep');
    expect(schema).not.toBeNull();
    expect(schema!.properties.level1.type).toBe('ref');
    expect(schema!.properties.level1.ref).toBe('io.example.deep#level1Ref');
  });
});
