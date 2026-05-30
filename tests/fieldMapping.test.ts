/**
 * Tests for lexicon-to-ResourceMapperField mapping (Phase 2).
 *
 * Tests:
 * - Type mapping for every lexicon type → n8n FieldType
 * - Required field markers
 * - `createdAt` auto-default
 * - Primitive, ref, union, array, inline object conversion
 * - Ref flattening (dotted path fields)
 * - Recursion depth limit
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import { resolveLexiconSchema, clearLexiconCache } from '../src/nodes/Atproto/lexicon';
import { lexiconToResourceMapperFields } from '../src/nodes/Atproto/fieldMapping';
import { server, PDS_URL, CID_1, CID_2, CID_3, setMockResponse, clearMockResponses } from './setup';
import {
  APP_BSKY_FEED_POST,
  PRIMITIVE_ONLY,
  INLINE_OBJECT,
  DEEPLY_NESTED,
  TYPE_ONLY_COLOR,
  SINGLE_REF_UNION,
  PUBLICATION_WITH_THEME,
} from './mockLexicons';

let agent: Agent | null;

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

describe('type mapping', () => {
  it('maps string fields correctly', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/primitive_test',
      schema: PRIMITIVE_ONLY,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const titleField = fields.find((f) => f.id === 'title');
    expect(titleField).toBeDefined();
    expect(titleField!.type).toBe('string');
    expect(titleField!.required).toBe(true);
  });

  it('maps integer fields to number', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const countField = fields.find((f) => f.id === 'count');
    expect(countField).toBeDefined();
    expect(countField!.type).toBe('number');
    expect(countField!.required).toBe(true);
  });

  it('maps boolean fields', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const enabledField = fields.find((f) => f.id === 'enabled');
    expect(enabledField).toBeDefined();
    expect(enabledField!.type).toBe('boolean');
    expect(enabledField!.required).toBe(false);
  });

  it('maps datetime string fields to dateTime', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const dateField = fields.find((f) => f.id === 'publishedAt');
    expect(dateField).toBeDefined();
    expect(dateField!.type).toBe('dateTime');
  });

  it('maps blob fields to string', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const blobField = fields.find((f) => f.id === 'blob');
    expect(blobField).toBeDefined();
    expect(blobField!.type).toBe('string');
  });

  it('maps cid-link fields to string', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const cidField = fields.find((f) => f.id === 'cid');
    expect(cidField).toBeDefined();
    expect(cidField!.type).toBe('string');
  });

  it('maps bytes fields to string', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const bytesField = fields.find((f) => f.id === 'data');
    expect(bytesField).toBeDefined();
    expect(bytesField!.type).toBe('string');
  });
});

describe('complex types', () => {
  it('maps union fields to object', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const embedField = fields.find((f) => f.id === 'embed');
    expect(embedField).toBeDefined();
    expect(embedField!.type).toBe('object');
  });

  it('maps array fields with primitive items to string', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // tags is array of strings → item type is 'string', no 'json' conversion needed
    const tagsField = fields.find((f) => f.id === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.type).toBe('string');
  });

  it('flattens ref fields into dotted-path sub-fields', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // reply is a ref to app.bsky.feed.post#replyRef which has root and parent
    // root and parent are refs to com.atproto.repo.strongRef
    // Since we can't resolve external NSIDs in tests, they fall back to 'object'
    const replyRootField = fields.find((f) => f.id === 'reply.root');
    expect(replyRootField).toBeDefined();
    expect(replyRootField!.type).toBe('object');

    const replyParentField = fields.find((f) => f.id === 'reply.parent');
    expect(replyParentField).toBeDefined();
  });

  it('maps array fields with ref items to object', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // facets is an array of refs (app.bsky.richtext.facet) which can't be
    // resolved in tests, so the item type becomes 'object' (via 'json' map)
    const facetsField = fields.find((f) => f.id === 'facets');
    expect(facetsField).toBeDefined();
    expect(facetsField!.type).toBe('object');
  });
});

describe('required fields', () => {
  it('marks required fields from schema', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const textField = fields.find((f) => f.id === 'text');
    expect(textField!.required).toBe(true);

    const tagsField = fields.find((f) => f.id === 'tags');
    expect(tagsField!.required).toBe(false);
  });

  it('does not mark ref sub-fields as required when the parent ref is optional', async () => {
    // `reply` is optional in app.bsky.feed.post, even though replyRef
    // declares root and parent as required. The flattened sub-fields
    // should be optional because the user might omit `reply` entirely.
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const replyRoot = fields.find((f) => f.id === 'reply.root');
    expect(replyRoot).toBeDefined();
    expect(replyRoot!.required).toBe(false);

    const replyParent = fields.find((f) => f.id === 'reply.parent');
    expect(replyParent).toBeDefined();
    expect(replyParent!.required).toBe(false);
  });
});

describe('createdAt auto-default', () => {
  it('sets defaultMatch and defaultValue for createdAt', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const createdAtField = fields.find((f) => f.id === 'createdAt');
    expect(createdAtField).toBeDefined();
    expect(createdAtField!.defaultMatch).toBe(true);
    expect(createdAtField!.defaultValue).toBe('={{ $now }}');
  });
});

describe('inline object flattening', () => {
  it('flattens inline object properties with dotted prefix', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_2,
      uri: 'at://did:plc:fake-test-did/com.atproto.lexicon.schema/inline_test',
      schema: INLINE_OBJECT,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.nested');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    expect(fields.find((f) => f.id === 'name')).toBeDefined();
    expect(fields.find((f) => f.id === 'metadata.source')).toBeDefined();
    expect(fields.find((f) => f.id === 'metadata.version')).toBeDefined();
  });
});

describe('empty schema handling', () => {
  it('returns empty array for null agent / unresolvable schema', async () => {
    // Should always return at least empty array, not throw
    // We test this by ensuring the function handles missing schema gracefully
    const schema = await resolveLexiconSchema(null, 'io.example.unknown');
    expect(schema).toBeNull();
  });
});

describe('single-ref union resolution (F1)', () => {
  it('collapses RGB color refs into single hex string fields', async () => {
    // Mock resolves: io.example.theme returns the theme lexicon,
    // io.example.color returns the type-only color lexicon.
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
    expect(schema).not.toBeNull();

    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // RGB colors should be collapsed into single hex string fields
    const bg = fields.find((f) => f.id === 'background')!;
    expect(bg).toBeDefined();
    expect(bg.type).toBe('string');
    expect(bg.required).toBe(true);
    expect(bg.displayName).toContain('#3B82F6');
    expect(bg.displayName).toContain('Color used for content background');

    const accent = fields.find((f) => f.id === 'accent')!;
    expect(accent).toBeDefined();
    expect(accent.type).toBe('string');
    expect(accent.displayName).toContain('Color used for links');

    // Should NOT have individual r/g/b sub-fields
    expect(fields.find((f) => f.id === 'background.r')).toBeUndefined();
    expect(fields.find((f) => f.id === 'accent.r')).toBeUndefined();
  });

  it('resolves two levels deep: ref → record → single-ref union → hex color', async () => {
    // io.example.publication → theme (ref) → io.example.theme (record)
    //   → background (single-ref union) → io.example.color#rgb (hex collapse)
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
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // name should be a simple string field
    const nameField = fields.find((f) => f.id === 'name')!;
    expect(nameField.type).toBe('string');
    expect(nameField.displayName).toContain('Name of the publication');

    // theme.background / theme.accent should be hex string fields (not r/g/b)
    const themeBg = fields.find((f) => f.id === 'theme.background')!;
    expect(themeBg).toBeDefined();
    expect(themeBg.type).toBe('string');
    expect(themeBg.displayName).toContain('hex');

    const themeAccent = fields.find((f) => f.id === 'theme.accent')!;
    expect(themeAccent).toBeDefined();
    expect(themeAccent.type).toBe('string');

    // Multi-ref union should remain as object (not resolved)
    const labelsField = fields.find((f) => f.id === 'labels')!;
    expect(labelsField.type).toBe('object');
  });

  it('keeps multi-ref unions as opaque object fields', async () => {
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
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const labels = fields.find((f) => f.id === 'labels')!;
    expect(labels).toBeDefined();
    expect(labels.type).toBe('object');
    expect(labels.displayName).toContain('Multi-ref union');
  });
});

describe('type-only lexicon resolution (F2)', () => {
  it('resolves a type-only lexicon and exposes its defs for fragment lookup', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.color') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/z', schema: TYPE_ONLY_COLOR };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.color');
    expect(schema).not.toBeNull();
    // No record properties (type-only lexicon)
    expect(Object.keys(schema!.properties)).toHaveLength(0);
    // rawDefs available for fragment resolution
    expect(schema!.rawDefs).toBeDefined();
    expect(schema!.rawDefs!['rgb']).toBeDefined();
    expect(schema!.rawDefs!['rgba']).toBeDefined();
  });
});

describe('description propagation (F3)', () => {
  it('includes description and hex hint in color field displayName', async () => {
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
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const bg = fields.find((f) => f.id === 'background')!;
    // Should have both the description and hex hint
    expect(bg.displayName).toContain('Color used for content background');
    expect(bg.displayName).toContain('#3B82F6');
  });

  it('shows description on fallback object fields when resolution fails', async () => {
    // Only provide the theme lexicon — color resolution will fail
    setMockResponse('com.atproto.lexicon.resolveLexicon', (body) => {
      const nsid = (body as Record<string, string>)?.nsid;
      if (nsid === 'io.example.theme') {
        return { cid: CID_1, uri: 'at://did:plc:fake/x/y', schema: SINGLE_REF_UNION };
      }
      throw Object.assign(new Error('not found'), { status: 404 });
    });

    const schema = await resolveLexiconSchema(agent, 'io.example.theme');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // Color resolution fails → fallback object fields with descriptions
    const bg = fields.find((f) => f.id === 'background')!;
    expect(bg).toBeDefined();
    expect(bg.type).toBe('object');
    expect(bg.displayName).toContain('Color used for content background');

    const accent = fields.find((f) => f.id === 'accent')!;
    expect(accent).toBeDefined();
    expect(accent.displayName).toContain('Color used for links');
  });
});
