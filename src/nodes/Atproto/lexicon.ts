/**
 * Lexicon resolution for AT Protocol record schemas.
 *
 * Resolves a lexicon schema document from an NSID via two paths:
 *   1. PDS endpoint: `com.atproto.lexicon.resolveLexicon` (requires auth)
 *   2. Fallback: `@atproto/lexicon-resolver` DNS-based resolution (no auth)
 *
 * Results are cached in-memory (module-level Map) since calls originate
 * from the n8n editor (resourceMapperMethod), not during execution.
 */

import type { Agent } from '@atproto/api';

// ---------------------------------------------------------------------------
// Types — simplified view of what we extract from lexicon documents
// ---------------------------------------------------------------------------

/** A single property/field definition in a lexicon record. */
export interface LexiconProperty {
  type: string;
  format?: string;
  /** For `ref` types: the target NSID or #local-name. */
  ref?: string;
  /** For `union` types: the list of possible ref targets. */
  refs?: string[];
  /** For `array` types: the schema of array items. */
  items?: LexiconProperty;
  /** For `object` types: nested properties. */
  properties?: Record<string, LexiconProperty>;
  /** For `object` types: required sub-field names. */
  required?: string[];
  description?: string;
  /** Whether the field is nullable (from the `nullable` array). */
  nullable?: boolean;
}

/** Parsed record schema extracted from a lexicon document. */
export interface LexiconSchema {
  /** The record's property definitions (from `defs.main.record.properties`). */
  properties: Record<string, LexiconProperty>;
  /** Names of required fields (from `defs.main.record.required`). */
  required: string[];
  /** The record key strategy declared by the lexicon. */
  key?: 'tid' | 'any' | 'literal';
  /** When `key` is `literal`, the literal value (e.g. `self`). */
  literalKey?: string;
  /** The raw lexicon document defs (for local ref resolution like `#someName`). */
  rawDefs?: Record<string, unknown>;
  /** NSID of this lexicon schema. */
  nsid: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const schemaCache = new Map<string, LexiconSchema>();

/** Clear the in-memory cache (useful in tests). */
export function clearLexiconCache(): void {
  schemaCache.clear();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a lexicon schema for the given collection NSID.
 *
 * Resolution chain:
 *   1. Check module-level cache.
 *   2. Try PDS `com.atproto.lexicon.resolveLexicon` endpoint.
 *   3. If that fails, try `@atproto/lexicon-resolver` (DNS-based, dynamic import).
 *   4. If both fail, return `null` (triggers JSON fallback in n8n).
 *
 * @param agent - Authenticated AT Protocol agent (may be null if unavailable).
 * @param nsid  - The collection NSID to resolve (e.g. `app.bsky.feed.post`).
 */
export async function resolveLexiconSchema(
  agent: Agent | null,
  nsid: string,
): Promise<LexiconSchema | null> {
  const cached = schemaCache.get(nsid);
  if (cached) return cached;

  // Try path A: PDS endpoint.
  // The @atproto/api client's strict XRPC validation rejects `record` types
  // in the resolveLexicon response schema. We call the endpoint via the
  // typed client anyway and extract the response body from the error, which
  // is still populated even when validation fails.
  if (agent) {
    try {
      const response =
        await agent.com.atproto.lexicon.resolveLexicon({ nsid });
      const schema = parseRawLexiconDocument(
        response.data.schema as Record<string, unknown>,
        nsid,
      );
      if (schema) {
        schemaCache.set(nsid, schema);
        return schema;
      }
    } catch (err) {
      // The client throws XRPCInvalidResponseError when the response
      // doesn't match the schema. The response body is still available
      // on the error object.
      const errObj = err as Record<string, unknown>;
      const responseBody = errObj.responseBody as
        | Record<string, unknown>
        | undefined;
      if (responseBody?.schema) {
        const schema = parseRawLexiconDocument(
          responseBody.schema as Record<string, unknown>,
          nsid,
        );
        if (schema) {
          schemaCache.set(nsid, schema);
          return schema;
        }
      }
      // Fall through to path B
    }
  }

  // Try path B: @atproto/lexicon-resolver (DNS-based, no auth required).
  // Dynamic import to avoid CJS/ESM interop issues at module load time.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  try {
    const mod: { resolveLexicon: (nsid: string) => Promise<unknown> } =
      // @ts-expect-error Can't resolve package under current moduleResolution
      await import('@atproto/lexicon-resolver');
    const resolution = await mod.resolveLexicon(nsid);
    const lexicon = (resolution as Record<string, unknown>)
      .lexicon as Record<string, unknown>;
    const schema = parseLexiconDocumentRecord(lexicon, nsid);
    if (schema) {
      schemaCache.set(nsid, schema);
      return schema;
    }
  } catch {
    // Both paths failed — return null for JSON fallback
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsing helpers — exported for direct use in tests
// ---------------------------------------------------------------------------

/**
 * Parse a raw lexicon document (without $type or CID validation) into our
 * internal schema. Useful for tests that construct mock lexicons directly.
 */
export function parseLexiconDoc(
  doc: Record<string, unknown>,
  nsid: string,
): LexiconSchema | null {
  return parseRawLexiconDocument(doc, nsid);
}

/**
 * Parse a raw lexicon document (from PDS endpoint) into our internal schema.
 */
function parseRawLexiconDocument(
  doc: Record<string, unknown>,
  nsid: string,
): LexiconSchema | null {
  const defs = doc?.defs as Record<string, unknown> | undefined;
  if (!defs) return null;

  const mainDef = defs?.main as Record<string, unknown> | undefined;
  if (!mainDef) return null;

  return extractRecordSchema(mainDef, defs, nsid);
}

/**
 * Parse a LexiconDocumentRecord (from @atproto/lexicon-resolver) into our
 * internal schema.  The shape is the same as the raw document, just
 * wrapped in a typed container.
 */
function parseLexiconDocumentRecord(
  lexicon: Record<string, unknown>,
  nsid: string,
): LexiconSchema | null {
  const defs = lexicon?.defs as Record<string, unknown> | undefined;
  if (!defs) return null;

  const mainDef = defs?.main as Record<string, unknown> | undefined;
  if (!mainDef) return null;

  return extractRecordSchema(mainDef, defs, nsid);
}

/**
 * Extract the record schema from a `defs.main` definition that has
 * `type: "record"`.
 */
function extractRecordSchema(
  mainDef: Record<string, unknown>,
  defs: Record<string, unknown>,
  nsid: string,
): LexiconSchema | null {
  if (mainDef.type !== 'record') {
    // Some lexicons have query/procedure as main — not a record schema
    return null;
  }

  const record = mainDef.record as Record<string, unknown> | undefined;
  if (!record || record.type !== 'object') return null;

  const properties = (record.properties as Record<string, unknown>) ?? {};
  const required = (record.required as string[]) ?? [];
  const nullable = (record.nullable as string[]) ?? [];

  // Parse record key strategy
  const key = mainDef.key as string | undefined;
  let keyType: 'tid' | 'any' | 'literal' | undefined;
  let literalKey: string | undefined;

  if (key === 'tid') {
    keyType = 'tid';
  } else if (key === 'any') {
    keyType = 'any';
  } else if (key && key.startsWith('literal:')) {
    keyType = 'literal';
    literalKey = key.slice('literal:'.length);
  }

  // Convert raw properties to our internal representation
  const parsedProperties: Record<string, LexiconProperty> = {};
  for (const [name, raw] of Object.entries(properties)) {
    const prop = raw as Record<string, unknown>;
    parsedProperties[name] = {
      type: (prop.type as string) ?? 'unknown',
      format: prop.format as string | undefined,
      ref: prop.ref as string | undefined,
      refs: prop.refs as string[] | undefined,
      items: prop.items
        ? parseInlineProperty(prop.items as Record<string, unknown>)
        : undefined,
      properties: prop.properties
        ? parseInlineObjectProperties(
            prop.properties as Record<string, unknown>,
          )
        : undefined,
      required: prop.required as string[] | undefined,
      description: prop.description as string | undefined,
      nullable: nullable.includes(name),
    };
  }

  return {
    properties: parsedProperties,
    required,
    key: keyType,
    literalKey,
    rawDefs: defs,
    nsid,
  };
}

/**
 * Recursively parse a nested property definition (e.g. for `array` items
 * or inline `object` fields).
 *
 * Handles the AT Protocol shorthand where `type` is inferred from other
 * fields (e.g. `{ "ref": "..." }` implies `type: "ref"`).
 */
function parseInlineProperty(
  raw: Record<string, unknown>,
): LexiconProperty {
  // Infer type from other fields if not explicitly set
  let type = (raw.type as string) ?? 'unknown';
  if (!raw.type) {
    if (raw.ref) type = 'ref';
    else if (raw.refs) type = 'union';
    else if (raw.properties) type = 'object';
    else if (raw.items) type = 'array';
  }

  return {
    type,
    format: raw.format as string | undefined,
    ref: raw.ref as string | undefined,
    refs: raw.refs as string[] | undefined,
    items: raw.items
      ? parseInlineProperty(raw.items as Record<string, unknown>)
      : undefined,
    properties: raw.properties
      ? parseInlineObjectProperties(
          raw.properties as Record<string, unknown>,
        )
      : undefined,
    required: raw.required as string[] | undefined,
    description: raw.description as string | undefined,
  };
}

/**
 * Parse the `properties` map of an inline object definition.
 */
function parseInlineObjectProperties(
  raw: Record<string, unknown>,
): Record<string, LexiconProperty> {
  const result: Record<string, LexiconProperty> = {};
  for (const [name, value] of Object.entries(raw)) {
    result[name] = parseInlineProperty(value as Record<string, unknown>);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a local ref (`#someName`) or cross-document ref
 * (`app.bsky.richtext.facet` or `app.bsky.feed.post#replyRef`) to
 * its property definitions.
 *
 * For local refs, looks in the `rawDefs` of the given schema.
 * For cross-document refs, attempts to resolve the target NSID.
 *
 * @returns The resolved properties map, or `null` if resolution fails.
 */
export async function resolveRefProperties(
  ref: string,
  currentSchema: LexiconSchema,
  resolveExternal: (nsid: string) => Promise<LexiconSchema | null>,
): Promise<Record<string, LexiconProperty> | null> {
  if (ref.startsWith('#')) {
    // Local ref — look up in defs
    const localName = ref.slice(1);
    return resolveLocalDef(localName, currentSchema.rawDefs);
  }

  // Cross-document ref — may include a fragment like
  // `app.bsky.feed.post#replyRef`
  const hashIdx = ref.indexOf('#');
  const targetNsid = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
  const fragment = hashIdx >= 0 ? ref.slice(hashIdx + 1) : undefined;

  const resolved = await resolveExternal(targetNsid);
  if (!resolved) return null;

  if (fragment) {
    return resolveLocalDef(fragment, resolved.rawDefs);
  }

  // No fragment — return the record's top-level properties
  return resolved.properties;
}

/**
 * Look up a def by name in the raw defs map and extract its properties.
 */
function resolveLocalDef(
  name: string,
  rawDefs?: Record<string, unknown>,
): Record<string, LexiconProperty> | null {
  if (!rawDefs) return null;

  const def = rawDefs[name] as Record<string, unknown> | undefined;
  if (!def) return null;

  // Direct object definition
  if (def.type === 'object') {
    const properties = def.properties as Record<string, unknown> | undefined;
    if (!properties) return null;
    const required = (def.required as string[]) ?? [];
    const nullable = (def.nullable as string[]) ?? [];
    const result: Record<string, LexiconProperty> = {};
    for (const [k, v] of Object.entries(properties)) {
      const p = parseInlineProperty(v as Record<string, unknown>);
      p.nullable = nullable.includes(k);
      result[k] = p;
    }
    return result;
  }

  // Token — no properties
  if (def.type === 'token') {
    return {};
  }

  // Record — unwrap to get the inner object
  if (def.type === 'record') {
    const record = def.record as Record<string, unknown> | undefined;
    if (!record || record.type !== 'object') return null;
    const properties = record.properties as Record<string, unknown> | undefined;
    if (!properties) return null;
    const required = (record.required as string[]) ?? [];
    const nullable = (record.nullable as string[]) ?? [];
    const result: Record<string, LexiconProperty> = {};
    for (const [k, v] of Object.entries(properties)) {
      const p = parseInlineProperty(v as Record<string, unknown>);
      p.nullable = nullable.includes(k);
      result[k] = p;
    }
    return result;
  }

  return null;
}
