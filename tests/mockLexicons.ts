/**
 * Mock lexicon documents used in Phase 2 tests.
 *
 * These represent real AT Protocol lexicon shapes but use simplified
 * content to keep tests focused on the mapping logic.
 */

/** A realistic `app.bsky.feed.post` lexicon with refs, unions, arrays. */
export const APP_BSKY_FEED_POST = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'app.bsky.feed.post',
  revision: 1,
  description: 'A post in a Bluesky feed.',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            maxLength: 3000,
            description: 'Post text',
          },
          createdAt: {
            type: 'string',
            format: 'datetime',
            description: 'Post creation date',
          },
          facets: {
            type: 'array',
            items: { ref: 'app.bsky.richtext.facet' },
          },
          reply: {
            type: 'ref',
            ref: 'app.bsky.feed.post#replyRef',
          },
          embed: {
            type: 'union',
            refs: [
              'app.bsky.embed.images',
              'app.bsky.embed.external',
              'app.bsky.embed.record',
              'app.bsky.embed.recordWithMedia',
            ],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
          langs: {
            type: 'array',
            items: { type: 'string' },
          },
          labels: {
            type: 'ref',
            ref: 'com.atproto.label.defs#selfLabels',
          },
        },
        required: ['text', 'createdAt'],
      },
    },
    replyRef: {
      type: 'object',
      required: ['root', 'parent'],
      properties: {
        root: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
        parent: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
      },
    },
  },
};

/** A lexicon with only primitive types. */
export const PRIMITIVE_ONLY = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.primitive',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A title' },
          count: { type: 'integer' },
          enabled: { type: 'boolean' },
          publishedAt: { type: 'string', format: 'datetime' },
          url: { type: 'string', format: 'uri' },
          blob: { type: 'blob' },
          cid: { type: 'cid-link' },
          data: { type: 'bytes' },
        },
        required: ['title', 'count'],
      },
    },
  },
};

/** A lexicon that uses query/procedure (not a record) — should fail parse. */
export const QUERY_NOT_RECORD = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'com.atproto.repo.getRecord',
  defs: {
    main: {
      type: 'query',
      parameters: {
        type: 'params',
        properties: {
          repo: { type: 'string' },
          collection: { type: 'string' },
          rkey: { type: 'string' },
        },
        required: ['repo', 'collection', 'rkey'],
      },
    },
  },
};

/** A lexicon with nested inline objects. */
export const INLINE_OBJECT = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.nested',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              version: { type: 'integer' },
            },
            required: ['source'],
          },
        },
        required: ['name'],
      },
    },
  },
};

/**
 * Type-only lexicon (no main record) — defines reusable types only.
 * Modeled on `site.standard.theme.color`.
 */
export const TYPE_ONLY_COLOR = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.color',
  defs: {
    rgb: {
      type: 'object',
      required: ['r', 'g', 'b'],
      properties: {
        r: { type: 'integer', minimum: 0, maximum: 255 },
        g: { type: 'integer', minimum: 0, maximum: 255 },
        b: { type: 'integer', minimum: 0, maximum: 255 },
      },
    },
    rgba: {
      type: 'object',
      required: ['r', 'g', 'b', 'a'],
      properties: {
        r: { type: 'integer', minimum: 0, maximum: 255 },
        g: { type: 'integer', minimum: 0, maximum: 255 },
        b: { type: 'integer', minimum: 0, maximum: 255 },
        a: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
  },
};

/**
 * Record lexicon with single-ref union properties.
 * Modeled on `site.standard.theme.basic` — each color property is a
 * single-ref union pointing to `io.example.color#rgb`.
 */
export const SINGLE_REF_UNION = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.theme',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        properties: {
          background: {
            type: 'union',
            refs: ['io.example.color#rgb'],
            description: 'Color used for content background.',
          },
          accent: {
            type: 'union',
            refs: ['io.example.color#rgb'],
            description: 'Color used for links.',
          },
        },
        required: ['background', 'accent'],
      },
    },
  },
};

/**
 * Record lexicon that references a single-ref union theme via ref.
 * Modeled on `site.standard.publication` → basicTheme.
 */
export const PUBLICATION_WITH_THEME = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.publication',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the publication.',
          },
          theme: {
            type: 'ref',
            ref: 'io.example.theme',
            description: 'Theme for the publication.',
          },
          labels: {
            type: 'union',
            refs: [
              'io.example.label#a',
              'io.example.label#b',
            ],
            description: 'Multi-ref union (should stay as object).',
          },
        },
        required: ['name'],
      },
    },
  },
};

/** A lexicon that demonstrates a deeply nested ref chain. */
export const DEEPLY_NESTED = {
  $type: 'com.atproto.lexicon.schema',
  lexicon: 1,
  id: 'io.example.deep',
  defs: {
    main: {
      type: 'record',
      key: 'tid',
      record: {
        type: 'object',
        properties: {
          level1: {
            type: 'ref',
            ref: 'io.example.deep#level1Ref',
          },
        },
        required: [],
      },
    },
    level1Ref: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        level2: {
          type: 'ref',
          ref: 'io.example.deep#level2Ref',
        },
      },
    },
    level2Ref: {
      type: 'object',
      properties: {
        value: { type: 'integer' },
        level3: {
          type: 'ref',
          ref: 'io.example.deep#level3Ref',
        },
      },
    },
    level3Ref: {
      type: 'object',
      properties: {
        deep: { type: 'string' },
      },
    },
  },
};
