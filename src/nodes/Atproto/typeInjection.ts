/**
 * F4: Nested $type injection for AT Protocol records.
 *
 * STATUS: Planned — not yet wired into the execute flow.
 *
 * PROBLEM
 * -------
 * When the resource mapper flattens refs/single-ref unions into dotted
 * fields (e.g. `theme.background.r`), `unflattenDottedKeys` reconstructs
 * nested objects — but those objects lack the `$type` discriminators that
 * AT Protocol requires for union-typed sub-objects.
 *
 * Currently sent:
 *   { "theme": { "background": { "r": 255, "g": 255, "b": 255 } } }
 *
 * Expected:
 *   { "theme": { "$type": "site.standard.theme.basic",
 *                "background": { "$type": "site.standard.theme.color#rgb",
 *                                "r": 255, "g": 255, "b": 255 } } }
 *
 * No special-casing for any value types — only plain objects get $type
 * injected. Strings, numbers, arrays, etc. pass through unchanged.
 *
 * APPROACH
 * -------
 * A new `injectNestedTypes()` function walks the unflattened record
 * alongside the resolved lexicon schema. For each nested object whose
 * schema property is a `ref` or single-ref `union`, it injects `$type`
 * with the ref target NSID, then recurses into the resolved ref's schema.
 *
 * This mirrors the recursive resolution in `flattenRefProperties` but
 * operates on values instead of field definitions.
 *
 * INTEGRATION POINT
 * -----------------
 * Called in the execute flow (Atproto.node.ts) after `applyBlobUploads`:
 *
 *   const record = buildRecordFromNodeParams(recordData);
 *   const schema = await resolveLexiconSchema(agent, collection);
 *   const withBlobs = await applyBlobUploads(record, schema, agent, i, this);
 *   const withTypes = await injectNestedTypes(withBlobs, schema, agent);
 *   // → use withTypes for createRecord/putRecord
 *
 * EDGE CASES
 * ----------
 * - User-provided $type is preserved (never overwritten)
 * - Array values are skipped (user provides full JSON for arrays of objects)
 * - Inline object properties (not from refs) don't get $type
 * - Recursion capped at MAX_REF_DEPTH (3) to match field generation
 * - Resolution failures are silently skipped (object works without $type
 *   on lenient PDS implementations)
 *
 * DEPENDENCIES
 * ------------
 * - `getResolvableRef()` — export from fieldMapping.ts (currently private)
 * - `resolveRefProperties()` + `resolveLexiconSchema()` from lexicon.ts
 * - Schema cache ensures no redundant network calls at runtime
 */

import type { Agent } from '@atproto/api';
import type { LexiconSchema } from './lexicon';
import { resolveLexiconSchema, resolveRefProperties } from './lexicon';
import { getResolvableRef } from './fieldMapping';

const MAX_REF_DEPTH = 3;

/**
 * Walk a record and inject `$type` on nested objects that correspond to
 * resolved refs or single-ref unions in the lexicon schema.
 *
 * @param record - The constructed record (after unflatten + blob uploads).
 * @param schema - The resolved lexicon schema (null → pass-through).
 * @param agent  - Authenticated agent (for cross-document ref resolution).
 * @returns A new record with `$type` injected on nested ref objects.
 */
export async function injectNestedTypes(
  record: Record<string, unknown>,
  schema: LexiconSchema | null,
  agent: Agent,
): Promise<Record<string, unknown>> {
  if (!schema) return record;
  return walkAndInject(record, schema.properties, schema, agent, 0);
}

/**
 * Recursive walker — for each property that is a ref/single-ref union,
 * inject `$type` on the value object and recurse into the resolved schema.
 */
async function walkAndInject(
  obj: Record<string, unknown>,
  properties: Record<string, import('./lexicon').LexiconProperty>,
  rootSchema: LexiconSchema,
  agent: Agent,
  depth: number,
): Promise<Record<string, unknown>> {
  if (depth >= MAX_REF_DEPTH) return obj;

  const result = { ...obj };

  for (const [key, value] of Object.entries(result)) {
    const propDef = properties[key];
    if (!propDef) continue;

    const refTarget = getResolvableRef(propDef);
    if (!refTarget) continue;

    // Only process plain objects (not arrays, primitives, null)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }

    const nested = { ...(value as Record<string, unknown>) };

    // Inject $type if user hasn't already provided one
    if (!nested['$type']) {
      nested['$type'] = refTarget;
    }

    // Resolve the ref to get sub-property definitions and recurse
    const resolved = await resolveRefProperties(
      refTarget,
      rootSchema,
      (nsid: string) => resolveLexiconSchema(agent, nsid),
    );

    if (resolved && Object.keys(resolved.properties).length > 0) {
      result[key] = await walkAndInject(
        nested,
        resolved.properties,
        rootSchema,
        agent,
        depth + 1,
      );
    } else {
      result[key] = nested;
    }
  }

  return result;
}
