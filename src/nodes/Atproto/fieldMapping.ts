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
import type { LexiconProperty, LexiconSchema } from './lexicon';
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
  // --- ref types: attempt recursive flattening ---
  if (prop.type === 'ref' && prop.ref && depth < MAX_REF_DEPTH) {
    const resolved = await resolveRefProperties(
      prop.ref,
      parentSchema,
      (nsid: string) => resolveLexiconSchema(agent, nsid),
    );

    if (resolved !== null && Object.keys(resolved).length > 0) {
      // Flatten the resolved properties with a dotted prefix
      return flattenRefProperties(name, resolved, required, parentSchema, agent, depth + 1);
    }

    // Resolution failed — fall back to object field
    return [
      {
        id: name,
        displayName: name,
        required,
        defaultMatch: false,
        display: true,
        type: 'object',
      },
    ];
  }

  // --- union types: always object (too complex for flattening) ---
  if (prop.type === 'union') {
    return [
      {
        id: name,
        displayName: name,
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

  // Attach optional description
  if (prop.description) {
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
 */
async function flattenRefProperties(
  prefix: string,
  properties: Record<string, LexiconProperty>,
  required: boolean,
  parentSchema: LexiconSchema,
  agent: Agent | null,
  depth: number,
): Promise<ResourceMapperField[]> {
  const fields: ResourceMapperField[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const dotted = `${prefix}.${name}`;

    // Recursively handle nested refs
    if (prop.type === 'ref' && prop.ref && depth < MAX_REF_DEPTH) {
      const resolved = await resolveRefProperties(
        prop.ref,
        parentSchema,
        (nsid: string) => resolveLexiconSchema(agent, nsid),
      );
      if (resolved !== null && Object.keys(resolved).length > 0) {
        const nested = await flattenRefProperties(
          dotted,
          resolved,
          required,
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
    fields.push({
      id: dotted,
      displayName: dotted,
      required,
      defaultMatch: false,
      display: true,
      type: (fieldType === 'json' ? 'object' : fieldType) as ResourceMapperField['type'],
    });
  }

  return fields;
}
