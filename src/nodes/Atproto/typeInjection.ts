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

// ---------------------------------------------------------------------------
// Hex color helpers
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string into RGB channel values.
 *
 * Accepts `#RGB`, `#RRGGBB`, `RGB`, `RRGGBB` (case-insensitive).
 * Returns `null` for anything that doesn't look like a hex color.
 */
function parseHexColor(
  value: string,
): { r: number; g: number; b: number } | null {
  let hex = value.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);

  // Expand shorthand: #RGB → RRGGBB
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return null;

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

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

    // Hex color expansion: "#3B82F6" → { $type, r, g, b }
    if (typeof value === 'string') {
      const rgb = parseHexColor(value);
      if (rgb) {
        result[key] = { '$type': refTarget, ...rgb };
      }
      continue;
    }

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
