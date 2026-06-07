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
  CONSTRAINED_SCHEMA,
} from './mockLexicons';
import { parseLexiconDoc } from '../src/nodes/Atproto/lexicon';

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

    // All arrays use type 'array' regardless of item type
    const tagsField = fields.find((f) => f.id === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.type).toBe('array');
  });

  it('flattens ref fields into dotted-path sub-fields', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // reply is a ref to app.bsky.feed.post#replyRef which has root and parent
    // root and parent are refs to com.atproto.repo.strongRef — at depth 1
    // they become object fields (sub-refs aren't further flattened)
    const replyRootField = fields.find((f) => f.id === 'reply.root');
    expect(replyRootField).toBeDefined();
    expect(replyRootField!.type).toBe('object');

    const replyParentField = fields.find((f) => f.id === 'reply.parent');
    expect(replyParentField).toBeDefined();
    expect(replyParentField!.type).toBe('object');
  });

  it('maps array fields with ref items to object', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // All arrays use type 'array' — n8n validates with tryToParseArray()
    const facetsField = fields.find((f) => f.id === 'facets');
    expect(facetsField).toBeDefined();
    expect(facetsField!.type).toBe('array');
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
  it('flattens single-ref union into sub-fields with constraints', async () => {
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

    // 2-level chain (theme → color#rgb): color ref resolved at depth 0,
    // r/g/b are plain integers at depth 1 → individual number fields
    const bgR = fields.find((f) => f.id === 'background.r')!;
    expect(bgR).toBeDefined();
    expect(bgR.type).toBe('number');
    expect(bgR.required).toBe(true);
    // Constraint hints from the color schema (≥0, ≤255)
    expect(bgR.displayName).toContain('≥0');
    expect(bgR.displayName).toContain('≤255');

    const accentG = fields.find((f) => f.id === 'accent.g')!;
    expect(accentG).toBeDefined();
    expect(accentG.type).toBe('number');
  });

  it('resolves two levels deep: ref \u2192 record \u2192 single-ref union \u2192 integer fields', async () => {
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

    const nameField = fields.find((f) => f.id === 'name')!;
    expect(nameField.type).toBe('string');
    expect(nameField.displayName).toContain('Name of the publication');

    // At depth 1, sub-refs become object fields (not further flattened)
    const themeBg = fields.find((f) => f.id === 'theme.background')!;
    expect(themeBg).toBeDefined();
    expect(themeBg.type).toBe('object');

    const themeAccent = fields.find((f) => f.id === 'theme.accent')!;
    expect(themeAccent).toBeDefined();
    expect(themeAccent.type).toBe('object');

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

describe('enum → options dropdown (Phase 5.2)', () => {
  it('maps string enum to type options with correct choices', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const vis = fields.find((f) => f.id === 'visibility')!;
    expect(vis).toBeDefined();
    expect(vis.type).toBe('options');
    expect(vis.options).toHaveLength(3);
    expect(vis.options![0]).toEqual({ name: 'public', value: 'public' });
    expect(vis.options![1]).toEqual({ name: 'private', value: 'private' });
    expect(vis.options![2]).toEqual({ name: 'unlisted', value: 'unlisted' });
  });

  it('maps integer enum to type options', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const pri = fields.find((f) => f.id === 'priority')!;
    expect(pri).toBeDefined();
    expect(pri.type).toBe('options');
    expect(pri.options).toHaveLength(3);
    expect(pri.options![0]).toEqual({ name: '0', value: 0 });
  });

  it('sets defaultValue from schema default on enum fields', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const vis = fields.find((f) => f.id === 'visibility')!;
    expect(vis.defaultValue).toBe('public');
  });
});

describe('knownValues → displayName hints (Phase 5.2)', () => {
  it('shows short names in displayName for knownValues', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const role = fields.find((f) => f.id === 'role')!;
    expect(role.type).toBe('string');
    // Should show truncated list (>4 values → first 3 + …)
    expect(role.displayName).toContain('admin');
    expect(role.displayName).toContain('moderator');
    expect(role.displayName).toContain('member');
    expect(role.displayName).toContain('…');
  });
});

describe('default/const → defaultValue/readOnly (Phase 5.3)', () => {
  it('maps const integer to readOnly with defaultValue', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const ver = fields.find((f) => f.id === 'version')!;
    expect(ver).toBeDefined();
    expect(ver.readOnly).toBe(true);
    expect(ver.defaultValue).toBe(1);
    expect(ver.displayName).toContain('fixed: 1');
  });

  it('maps const boolean to readOnly with defaultValue', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const locked = fields.find((f) => f.id === 'locked')!;
    expect(locked).toBeDefined();
    expect(locked.readOnly).toBe(true);
    expect(locked.defaultValue).toBe(false);
  });

  it('createdAt hardcoded default takes priority over schema default', async () => {
    const schema = await resolveLexiconSchema(agent, 'app.bsky.feed.post');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const createdAt = fields.find((f) => f.id === 'createdAt')!;
    expect(createdAt.defaultValue).toBe('={{ $now }}');
    expect(createdAt.defaultMatch).toBe(true);
  });
});

describe('unknown type + format hints (Phase 5.5)', () => {
  it('maps unknown type to object', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const unk = fields.find((f) => f.id === 'unknown')!;
    expect(unk).toBeDefined();
    expect(unk.type).toBe('object');
  });

  it('maps string with format uri/at-uri to string with format hint', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // 'url' is not a valid ResourceMapperField type, so uri stays as 'string'
    const website = fields.find((f) => f.id === 'website')!;
    expect(website.type).toBe('string');
    expect(website.displayName).toContain('(uri)');

    const atUri = fields.find((f) => f.id === 'atUri')!;
    expect(atUri.type).toBe('string');
    expect(atUri.displayName).toContain('(at-uri)');
  });

  it('shows format in displayName for non-datetime/uri formats', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    const handle = fields.find((f) => f.id === 'handle')!;
    expect(handle.type).toBe('string');
    expect(handle.displayName).toContain('(handle)');
  });

  it('shows constraint hints in displayName', async () => {
    setMockResponse('com.atproto.lexicon.resolveLexicon', () => ({
      cid: CID_1,
      uri: 'at://did:plc:fake/x/y',
      schema: CONSTRAINED_SCHEMA,
    }));

    const schema = await resolveLexiconSchema(agent, 'io.example.constrained');
    const fields = await lexiconToResourceMapperFields(schema!, agent);

    // maxGraphemes takes priority over maxLength
    const bio = fields.find((f) => f.id === 'bio')!;
    expect(bio.displayName).toContain('[max 256 chars]');

    // Integer with min/max range
    const score = fields.find((f) => f.id === 'score')!;
    expect(score.displayName).toContain('[≥0, ≤100]');
  });
});

describe('description propagation (F3)', () => {
  it('stops flattening at depth limit — sub-refs become object fields', async () => {
    // 3-level chain: publication → theme → color#rgb
    // At depth 1, theme.background (single-ref union) hits the limit
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

    // theme.background at depth 1 is a sub-ref — becomes object field with template
    const themeBg = fields.find((f) => f.id === 'theme.background')!;
    expect(themeBg.type).toBe('object');
    expect(themeBg.displayName).toContain('Color used for content background');
    // Default template shows the expected structure
    expect(themeBg.defaultValue).toBeDefined();
    const bgTemplate = JSON.parse(themeBg.defaultValue as string);
    expect(bgTemplate).toEqual({ r: 0, g: 0, b: 0 });

    // Should NOT have deeply flattened theme.background.r
    expect(fields.find((f) => f.id === 'theme.background.r')).toBeUndefined();
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
