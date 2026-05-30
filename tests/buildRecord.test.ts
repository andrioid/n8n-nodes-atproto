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
} from '../src/nodes/Atproto/Atproto.node';

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

  it('skips empty values (null, undefined, empty string)', () => {
    const flat = {
      text: 'hi',
      'reply.root': '',
      'reply.parent': null,
      empty: undefined,
    };
    expect(unflattenDottedKeys(flat)).toEqual({ text: 'hi' });
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

    it('drops empty optional fields', () => {
      // The user left several fields blank; we shouldn't send them as
      // empty strings to the PDS (which would fail lexicon validation
      // for optional fields with format constraints).
      const input = {
        mappingMode: 'defineBelow',
        value: {
          text: 'hi',
          'reply.root': '',
          'reply.parent': '',
          embed: null,
        },
      };
      expect(buildRecordFromNodeParams(input)).toEqual({ text: 'hi' });
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
