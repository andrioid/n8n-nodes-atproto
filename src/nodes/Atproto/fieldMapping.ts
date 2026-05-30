/**
 * Maps a resolved AT Protocol lexicon schema to n8n `ResourceMapperField[]`.
 *
 * Handles:
 * - Type mapping from lexicon types → n8n FieldType
 * - Recursive `ref` resolution with dotted-path flattening (cap depth 3)
 * - Required vs optional fields
 * - `createdAt` auto-population as default match
 * - Array items hint (shown as `json` for complex, `string` for primitives)
 */

import type { ResourceMapperField } from 'n8n-workflow';
import type { Agent } from '@atproto/api';
import type { LexiconProperty, LexiconSchema, ResolvedRef } from './lexicon';
import { resolveLexiconSchema, resolveRefProperties } from './lexicon';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum recursion depth for resolving `ref` types. */
const MAX_REF_DEPTH = 3;

/** Field names that should be auto-populated with default expressions. */
const AUTO_DEFAULTS: Record<string, string> = {
  createdAt: '={{ $now }}',
};

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/**
 * Map a lexicon property type/format to an n8n FieldType.
 */
function lexiconTypeToFieldType(prop: LexiconProperty): string {
  switch (prop.type) {
    case 'string':
      if (prop.format === 'datetime') return 'dateTime';
      return 'string';
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'json';
    case 'object':
      // Inline object — flatten or treat as json
      if (prop.properties) return 'json';
      return 'json';
    case 'union':
      return 'json';
    case 'ref':
      return 'json'; // fallback — refs are flattened if resolvable
    case 'blob':
      return 'string';
    case 'cid-link':
      return 'string';
    case 'bytes':
      return 'string';
    case 'token':
      return 'string';
    default:
      return 'string';
  }
}

// ---------------------------------------------------------------------------
// Ref helpers
// ---------------------------------------------------------------------------

/**
 * Extract a resolvable ref target from a property.
 *
 * Returns the ref string for `ref` types and single-ref `union` types.
 * Single-ref unions are a common AT Protocol pattern for typed sub-objects
 * (e.g. `{ type: "union", refs: ["site.standard.theme.color#rgb"] }`).
 */
export function getResolvableRef(prop: LexiconProperty): string | null {
  if (prop.type === 'ref' && prop.ref) return prop.ref;
  if (prop.type === 'union' && prop.refs?.length === 1) return prop.refs[0];
  return null;
}

/**
 * Detect whether a resolved ref is an RGB(A) color object.
 *
 * Matches objects with exactly {r, g, b} or {r, g, b, a} integer properties
 * — the standard AT Protocol pattern for color values
 * (e.g. `site.standard.theme.color#rgb`).
 */
function isRgbColorDef(resolved: ResolvedRef): boolean {
  const keys = Object.keys(resolved.properties);
  const hasRGB = ['r', 'g', 'b'].every(
    (k) => resolved.properties[k]?.type === 'integer',
  );
  if (!hasRGB) return false;
  return (
    keys.length === 3 ||
    (keys.length === 4 && resolved.properties['a']?.type === 'integer')
  );
}

/**
 * Create a single hex-color string field instead of 3–4 separate number
 * fields for RGB(A) color refs.
 */
function makeColorField(
  name: string,
  prop: LexiconProperty,
  required: boolean,
): ResourceMapperField {
  const desc = prop.description?.replace(/\.\s*$/, '');
  const displayName = desc
    ? `${name} (${desc} — hex e.g. #3B82F6)`
    : `${name} (hex color e.g. #3B82F6)`;
  return {
    id: name,
    displayName,
    required,
    defaultMatch: false,
    display: true,
    type: 'string',
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Convert a resolved `LexiconSchema` to an array of `ResourceMapperField`.
 *
 * @param schema     - The resolved lexicon schema.
 * @param agent      - Authenticated agent (for resolving cross-document refs).
 * @param depth      - Current recursion depth for ref resolution (starts at 0).
 */
export async function lexiconToResourceMapperFields(
  schema: LexiconSchema,
  agent: Agent | null,
  depth: number = 0,
): Promise<ResourceMapperField[]> {
  const fields: ResourceMapperField[] = [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    const isRequired = schema.required.includes(name);
    const subFields = await propToFields(
      name,
      prop,
      isRequired,
      schema,
      agent,
      depth,
    );
    fields.push(...subFields);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Property → Field(s) conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single lexicon property to one or more `ResourceMapperField`s.
 *
 * Simple types produce a single field. `ref` types produce multiple
 * flattened dotted-path fields when the target schema is resolvable.
 */
async function propToFields(
  name: string,
  prop: LexiconProperty,
  required: boolean,
  parentSchema: LexiconSchema,
  agent: Agent | null,
  depth: number,
): Promise<ResourceMapperField[]> {
  // --- ref / single-ref union types: attempt recursive flattening ---
  const resolveTarget = getResolvableRef(prop);
  if (resolveTarget && depth < MAX_REF_DEPTH) {
    const resolved = await resolveRefProperties(
      resolveTarget,
      parentSchema,
      (nsid: string) => resolveLexiconSchema(agent, nsid),
    );

    if (resolved !== null && Object.keys(resolved.properties).length > 0) {
      // RGB color shortcut — single hex string field instead of r/g/b numbers
      if (isRgbColorDef(resolved)) {
        return [makeColorField(name, prop, required)];
      }

      // Flatten the resolved properties with a dotted prefix.
      // A sub-field is required iff the parent ref is required AND the
      // resolved schema lists it as required.
      return flattenRefProperties(
        name,
        resolved.properties,
        resolved.required,
        required,
        parentSchema,
        agent,
        depth + 1,
      );
    }

    // Resolution failed — fall back to object field
    const fallbackDisplay = prop.description
      ? `${name} (${prop.description})`
      : name;
    return [
      {
        id: name,
        displayName: fallbackDisplay,
        required,
        defaultMatch: false,
        display: true,
        type: 'object',
      },
    ];
  }

  // --- multi-ref union types: always object (too complex for flattening) ---
  if (prop.type === 'union') {
    const displayName = prop.description
      ? `${name} (${prop.description})`
      : name;
    return [
      {
        id: name,
        displayName,
        required,
        defaultMatch: false,
        display: true,
        type: 'object',
      },
    ];
  }

  // --- array types ---
  if (prop.type === 'array') {
    const itemType = prop.items
      ? lexiconTypeToFieldType(prop.items)
      : 'json';
    return [
      {
        id: name,
        displayName: name,
        required,
        defaultMatch: false,
        display: true,
        type: (itemType === 'json' ? 'object' : itemType) as ResourceMapperField['type'],
      },
    ];
  }

  // --- object types (inline) ---
  if (prop.type === 'object' && prop.properties) {
    // Flatten inline object properties with dotted prefix
    const fields: ResourceMapperField[] = [];
    const subRequired = prop.required ?? [];
    for (const [subName, subProp] of Object.entries(prop.properties)) {
      const isSubRequired = required && subRequired.includes(subName);
      const subFields = await propToFields(
        `${name}.${subName}`,
        subProp,
        isSubRequired,
        parentSchema,
        agent,
        depth,
      );
      fields.push(...subFields);
    }
    return fields;
  }

  // --- simple types ---
  const fieldType = lexiconTypeToFieldType(prop);
  const field: ResourceMapperField = {
    id: name,
    displayName: name,
    required,
    defaultMatch: false,
    display: true,
    type: fieldType as ResourceMapperField['type'],
  };

  // Attach optional description (with blob hint)
  if (prop.type === 'blob') {
    const desc = prop.description?.replace(/\.\s*$/, '');
    field.displayName = desc
      ? `${name} (${desc} — binary property name from input)`
      : `${name} (binary property name from input)`;
  } else if (prop.description) {
    field.displayName = `${name} (${prop.description})`;
  }

  // Apply auto-defaults for known fields
  if (AUTO_DEFAULTS[name] !== undefined) {
    field.defaultValue = AUTO_DEFAULTS[name];
    if (name === 'createdAt') {
      field.defaultMatch = true;
    }
  }

  return [field];
}

// ---------------------------------------------------------------------------
// Ref flattening
// ---------------------------------------------------------------------------

/**
 * Flatten a resolved ref's properties into dotted-path fields.
 *
 * E.g. `reply.root.uri`, `reply.root.cid` instead of a single `reply` json field.
 *
 * A sub-field is marked `required` iff the parent ref itself is required
 * (`parentRequired`) AND the resolved schema lists the sub-field as required
 * (`schemaRequired`). This avoids marking optional ref's sub-fields as required
 * just because the schema requires them when the ref is present.
 */
async function flattenRefProperties(
  prefix: string,
  properties: Record<string, LexiconProperty>,
  schemaRequired: string[],
  parentRequired: boolean,
  parentSchema: LexiconSchema,
  agent: Agent | null,
  depth: number,
): Promise<ResourceMapperField[]> {
  const fields: ResourceMapperField[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const dotted = `${prefix}.${name}`;
    const isRequired = parentRequired && schemaRequired.includes(name);

    // Recursively handle nested refs and single-ref unions
    const nestedRef = getResolvableRef(prop);
    if (nestedRef && depth < MAX_REF_DEPTH) {
      const resolved = await resolveRefProperties(
        nestedRef,
        parentSchema,
        (nsid: string) => resolveLexiconSchema(agent, nsid),
      );
      if (resolved !== null && Object.keys(resolved.properties).length > 0) {
        // RGB color shortcut — single hex string field instead of r/g/b numbers
        if (isRgbColorDef(resolved)) {
          fields.push(makeColorField(dotted, prop, isRequired));
          continue;
        }

        const nested = await flattenRefProperties(
          dotted,
          resolved.properties,
          resolved.required,
          isRequired,
          parentSchema,
          agent,
          depth + 1,
        );
        fields.push(...nested);
        continue;
      }
    }

    // For simple types or when refs can't be resolved further
    const fieldType = lexiconTypeToFieldType(prop);
    const displayName = prop.description
      ? `${dotted} (${prop.description})`
      : dotted;
    fields.push({
      id: dotted,
      displayName,
      required: isRequired,
      defaultMatch: false,
      display: true,
      type: (fieldType === 'json' ? 'object' : fieldType) as ResourceMapperField['type'],
    });
  }

  return fields;
}
