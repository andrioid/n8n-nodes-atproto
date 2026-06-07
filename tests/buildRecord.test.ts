/**
 * Tests for `buildRecordFromNodeParams` and `unflattenDottedKeys` from
 * the node execute path (Phase 2).
 *
 * These exercise the critical path from resourceMapper values back to
 * AT Protocol record shapes, including un-flattening dotted keys produced
 * by ref/object field flattening.
 */

import { describe, it, expect } from 'vitest';

import {
  buildRecordFromNodeParams,
  unflattenDottedKeys,
} from '../nodes/Atproto/Atproto.node';
import { applyConstValues } from '../nodes/Atproto/operations';
import { parseLexiconDoc } from '../nodes/Atproto/lexicon';
import { CONSTRAINED_SCHEMA } from './mockLexicons';

describe('unflattenDottedKeys', () => {
  it('passes through flat keys unchanged', () => {
    const flat = { text: 'hello', count: 42 };
    expect(unflattenDottedKeys(flat)).toEqual({ text: 'hello', count: 42 });
  });

  it('nests a single dotted key', () => {
    const flat = { 'reply.root': 'at://x' };
    expect(unflattenDottedKeys(flat)).toEqual({ reply: { root: 'at://x' } });
  });

  it('groups multiple dotted keys with the same prefix', () => {
    const flat = {
      'reply.root': 'at://root',
      'reply.parent': 'at://parent',
    };
    expect(unflattenDottedKeys(flat)).toEqual({
      reply: { root: 'at://root', parent: 'at://parent' },
    });
  });

  it('handles a mix of flat and dotted keys', () => {
    const flat = {
      text: 'hi',
      'reply.root': 'at://root',
      'reply.parent': 'at://parent',
      createdAt: '2024-01-01T00:00:00Z',
    };
    expect(unflattenDottedKeys(flat)).toEqual({
      text: 'hi',
      reply: { root: 'at://root', parent: 'at://parent' },
      createdAt: '2024-01-01T00:00:00Z',
    });
  });

  it('nests through multiple levels', () => {
    const flat = {
      'a.b.c': 1,
      'a.b.d': 2,
      'a.e': 3,
    };
    expect(unflattenDottedKeys(flat)).toEqual({
      a: { b: { c: 1, d: 2 }, e: 3 },
    });
  });

  it('skips undefined and empty string but preserves null', () => {
    const flat = {
      text: 'hi',
      'reply.root': '',
      'reply.parent': null,
      empty: undefined,
    };
    // null is preserved (Decision 26: nullable field support)
    // undefined and '' are stripped
    expect(unflattenDottedKeys(flat)).toEqual({
      text: 'hi',
      reply: { parent: null },
    });
  });

  it('preserves falsy non-empty values (0, false)', () => {
    const flat = {
      count: 0,
      enabled: false,
    };
    expect(unflattenDottedKeys(flat)).toEqual({ count: 0, enabled: false });
  });

  it('preserves nested object/array values at leaves', () => {
    const flat = {
      tags: ['a', 'b', 'c'],
      'meta.tags': ['x'],
    };
    expect(unflattenDottedKeys(flat)).toEqual({
      tags: ['a', 'b', 'c'],
      meta: { tags: ['x'] },
    });
  });

  it('handles empty input', () => {
    expect(unflattenDottedKeys({})).toEqual({});
  });
});

describe('buildRecordFromNodeParams', () => {
  describe('raw JSON string input (legacy fallback)', () => {
    it('parses a valid JSON string', () => {
      const json = '{"text":"hello","createdAt":"2024-01-01T00:00:00Z"}';
      expect(buildRecordFromNodeParams(json)).toEqual({
        text: 'hello',
        createdAt: '2024-01-01T00:00:00Z',
      });
    });

    it('returns empty object for invalid JSON', () => {
      expect(buildRecordFromNodeParams('{not json}')).toEqual({});
    });

    it('returns empty object for empty string', () => {
      expect(buildRecordFromNodeParams('')).toEqual({});
    });
  });

  describe('resourceMapper value input', () => {
    it('extracts value from defineBelow mode', () => {
      const input = {
        mappingMode: 'defineBelow',
        value: { text: 'hello', createdAt: '2024-01-01' },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({
        text: 'hello',
        createdAt: '2024-01-01',
      });
    });

    it('extracts value from autoMapInputData mode', () => {
      const input = {
        mappingMode: 'autoMapInputData',
        value: { text: 'auto' },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({ text: 'auto' });
    });

    it('returns empty object when value is null', () => {
      const input = { mappingMode: 'defineBelow', value: null };
      expect(buildRecordFromNodeParams(input)).toEqual({});
    });

    it('un-flattens dotted keys from ref-flattened fields', () => {
      // Mimics what resourceMapper returns when the user fills in
      // `reply.root` and `reply.parent` fields produced by ref flattening.
      const input = {
        mappingMode: 'defineBelow',
        value: {
          text: 'a reply',
          'reply.root': 'at://did:plc:abc/app.bsky.feed.post/x',
          'reply.parent': 'at://did:plc:abc/app.bsky.feed.post/y',
          createdAt: '2024-01-01T00:00:00Z',
        },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({
        text: 'a reply',
        reply: {
          root: 'at://did:plc:abc/app.bsky.feed.post/x',
          parent: 'at://did:plc:abc/app.bsky.feed.post/y',
        },
        createdAt: '2024-01-01T00:00:00Z',
      });
    });

    it('un-flattens deeply nested inline object keys', () => {
      const input = {
        mappingMode: 'defineBelow',
        value: {
          name: 'test',
          'metadata.source': 'api',
          'metadata.version': 2,
          'metadata.nested.deep': 'value',
        },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({
        name: 'test',
        metadata: {
          source: 'api',
          version: 2,
          nested: { deep: 'value' },
        },
      });
    });

    it('drops empty strings and undefined but preserves null', () => {
      // The user left several fields blank; empty strings and undefined
      // are stripped. Explicit null is preserved for nullable fields.
      const input = {
        mappingMode: 'defineBelow',
        value: {
          text: 'hi',
          'reply.root': '',
          'reply.parent': '',
          embed: null,
        },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({
        text: 'hi',
        embed: null,
      });
    });
  });

  describe('nullable handling', () => {
    it('preserves null values (not stripped by unflattenDottedKeys)', () => {
      // unflattenDottedKeys currently strips null. After Phase 5.5,
      // we stop stripping null to support nullable fields.
      const input = {
        mappingMode: 'defineBelow',
        value: {
          text: 'hi',
          nullableField: null,
        },
      };
      const result = buildRecordFromNodeParams(input);
      expect(result.text).toBe('hi');
      expect('nullableField' in result).toBe(true);
      expect(result.nullableField).toBeNull();
    });
  });

  describe('plain object input (from expression)', () => {
    it('returns the object as-is', () => {
      const obj = { text: 'from expression' };
      expect(buildRecordFromNodeParams(obj)).toEqual({ text: 'from expression' });
    });

    it('returns empty object for null/undefined', () => {
      expect(buildRecordFromNodeParams(null)).toEqual({});
      expect(buildRecordFromNodeParams(undefined)).toEqual({});
    });
  });
});

describe('applyConstValues (Phase 5.3)', () => {
  it('injects const value when field is missing', () => {
    const schema = parseLexiconDoc(CONSTRAINED_SCHEMA, 'io.example.constrained');
    const record: Record<string, unknown> = { visibility: 'public', score: 50 };
    applyConstValues(record, schema);
    expect(record.version).toBe(1);
    expect(record.locked).toBe(false);
  });

  it('preserves user-provided value even for const fields', () => {
    const schema = parseLexiconDoc(CONSTRAINED_SCHEMA, 'io.example.constrained');
    const record: Record<string, unknown> = { version: 1, score: 50 };
    applyConstValues(record, schema);
    expect(record.version).toBe(1);
  });

  it('does nothing when schema is null', () => {
    const record: Record<string, unknown> = { text: 'hello' };
    applyConstValues(record, null);
    expect(record).toEqual({ text: 'hello' });
  });
});
