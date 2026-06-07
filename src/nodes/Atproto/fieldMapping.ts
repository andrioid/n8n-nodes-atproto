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

/**
 * Maximum recursion depth for resolving `ref` types in the UI.
 *
 * Set to 1 so that top-level refs are flattened into their immediate
 * properties, but sub-refs within those become single `object` fields
 * rather than being recursively exploded into many dotted sub-fields.
 *
 * This keeps the field count manageable (e.g. a theme with 4 color
 * refs becomes 4 object fields, not 12+ individual number fields).
 *
 * Note: $type injection (typeInjection.ts) and validation (validation.ts)
 * maintain their own depth limits (3) for full recursive processing
 * at execution time.
 */
const MAX_REF_DEPTH = 1;

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
      // Note: 'url' is not a valid ResourceMapperField type, so uri/at-uri
      // stay as 'string' with a format hint in displayName instead.
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
    case 'unknown':
      return 'object';
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
 * Format displayName for multi-ref union fields.
 *
 * Shows the possible `$type` values so users know what to put in the JSON.
 * E.g. `embed (set $type to one of: images, external, record)`
 */
function formatUnionDisplayName(
  name: string,
  prop: LexiconProperty,
): string {
  const desc = prop.description?.replace(/\.\s*$/, '');
  if (prop.refs?.length) {
    const shortNames = prop.refs.map((r) => {
      const frag = r.indexOf('#');
      if (frag >= 0) return r.slice(frag + 1);
      const parts = r.split('.');
      return parts[parts.length - 1];
    });
    const typeList =
      shortNames.length <= 3
        ? shortNames.join(', ')
        : `${shortNames.slice(0, 2).join(', ')}, …`;
    return desc
      ? `${name} (${desc} — set $type to: ${typeList})`
      : `${name} (set $type to: ${typeList})`;
  }
  return desc ? `${name} (${desc})` : name;
}

/**
 * Format displayName for array fields.
 *
 * Shows the item type and description.
 * E.g. `facets (JSON array of app.bsky.richtext.facet)`
 */
function formatArrayDisplayName(
  name: string,
  prop: LexiconProperty,
): string {
  const desc = prop.description?.replace(/\.\s*$/, '');
  const itemRef =
    prop.items?.ref ?? prop.items?.refs?.[0];
  const itemHint = itemRef
    ? `JSON array of ${itemRef}`
    : prop.items?.type === 'string'
      ? 'list of strings'
      : 'JSON array';
  return desc
    ? `${name} (${desc} — ${itemHint})`
    : `${name} (${itemHint})`;
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
  // --- const fields: fixed, immutable value → readOnly ---
  if (prop.const !== undefined) {
    const fieldType = lexiconTypeToFieldType(prop);
    const desc = prop.description?.replace(/\.\s*$/, '');
    return [{
      id: name,
      displayName: desc
        ? `${name} (${desc} — fixed: ${String(prop.const)})`
        : `${name} (fixed: ${String(prop.const)})`,
      required,
      defaultMatch: false,
      display: true,
      type: fieldType as ResourceMapperField['type'],
      readOnly: true,
      defaultValue: prop.const,
    }];
  }

  // --- enum: closed set → options dropdown ---
  if (prop.enum?.length && (prop.type === 'string' || prop.type === 'integer')) {
    const desc = prop.description?.replace(/\.\s*$/, '');
    return [{
      id: name,
      displayName: desc ? `${name} (${desc})` : name,
      required,
      defaultMatch: name === 'createdAt',
      display: true,
      type: 'options' as ResourceMapperField['type'],
      options: prop.enum.map(v => ({ name: String(v), value: v })),
      ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
    }];
  }

  // --- ref / single-ref union types: attempt recursive flattening ---
  const resolveTarget = getResolvableRef(prop);
  if (resolveTarget && depth < MAX_REF_DEPTH) {
    const resolved = await resolveRefProperties(
      resolveTarget,
      parentSchema,
      (nsid: string) => resolveLexiconSchema(agent, nsid),
    );

    if (resolved !== null && Object.keys(resolved.properties).length > 0) {
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

  // --- ref / single-ref union that hit the depth limit: show as object ---
  // Still resolve the ref to build a JSON template for the default value,
  // so the user sees the expected structure instead of an empty editor.
  if (resolveTarget) {
    const desc = prop.description?.replace(/\.\s*$/, '');
    let template: string | undefined;
    try {
      const resolved = await resolveRefProperties(
        resolveTarget,
        parentSchema,
        (nsid: string) => resolveLexiconSchema(agent, nsid),
      );
      if (resolved && Object.keys(resolved.properties).length > 0) {
        template = JSON.stringify(
          buildDefaultTemplate(resolved.properties),
          null,
          2,
        );
      }
    } catch {
      // Resolution failed — no template, user gets empty editor
    }
    return [
      {
        id: name,
        displayName: desc ? `${name} (${desc})` : name,
        required,
        defaultMatch: false,
        display: true,
        type: 'object',
        ...(template ? { defaultValue: template } : {}),
      },
    ];
  }

  // --- multi-ref union types: always object (too complex for flattening) ---
  if (prop.type === 'union') {
    const displayName = formatUnionDisplayName(name, prop);
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
  // Use type: 'array' — n8n's tryToParseArray() accepts JSON array strings.
  // Using 'object' would fail validation since [] is not a JSON object.
  if (prop.type === 'array') {
    const displayName = formatArrayDisplayName(name, prop);
    return [
      {
        id: name,
        displayName,
        required,
        defaultMatch: false,
        display: true,
        type: 'array' as ResourceMapperField['type'],
        defaultValue: '[]',
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

  // knownValues: open set → show suggestions in displayName
  if (prop.knownValues?.length) {
    const shortNames = prop.knownValues.map(v => {
      const hash = v.indexOf('#');
      return hash >= 0 ? v.slice(hash + 1) : v.split('.').pop() ?? v;
    });
    const hint = shortNames.length <= 4
      ? shortNames.join(', ')
      : `${shortNames.slice(0, 3).join(', ')}, …`;
    const desc = prop.description?.replace(/\.\s*$/, '');
    field.displayName = desc
      ? `${name} (${desc} — e.g. ${hint})`
      : `${name} (e.g. ${hint})`;
  }

  // String format hints (datetime is already mapped to dateTime type)
  if (prop.type === 'string' && prop.format && prop.format !== 'datetime') {
    field.displayName += ` (${prop.format})`;
  }

  // Constraint hints in displayName
  const hints: string[] = [];
  if (prop.maxGraphemes) hints.push(`max ${prop.maxGraphemes} chars`);
  else if (prop.maxLength && prop.type === 'string') hints.push(`max ${prop.maxLength} bytes`);
  if (prop.minimum !== undefined || prop.maximum !== undefined) {
    const parts: string[] = [];
    if (prop.minimum !== undefined) parts.push(`≥${prop.minimum}`);
    if (prop.maximum !== undefined) parts.push(`≤${prop.maximum}`);
    hints.push(parts.join(', '));
  }
  if (hints.length) {
    field.displayName += ` [${hints.join('; ')}]`;
  }

  // Apply auto-defaults for known fields, then schema defaults
  if (AUTO_DEFAULTS[name] !== undefined) {
    field.defaultValue = AUTO_DEFAULTS[name];
    if (name === 'createdAt') {
      field.defaultMatch = true;
    }
  } else if (prop.default !== undefined) {
    field.defaultValue = prop.default;
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
        (nsid) => resolveLexiconSchema(agent, nsid),
      );
      if (resolved !== null && Object.keys(resolved.properties).length > 0) {
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

    // For simple types or when refs can't be resolved further,
    // route through propToFields so the field gets all Phase 5 treatment
    // (defaults, enums, format hints, constraint hints).
    const subFields = await propToFields(
      dotted,
      prop,
      isRequired,
      parentSchema,
      agent,
      depth,
    );
    fields.push(...subFields);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Default template generation
// ---------------------------------------------------------------------------

/**
 * Build a JSON-serialisable default template from resolved schema properties.
 *
 * Used for object-type fields where the ref was resolved (for schema info)
 * but not flattened (due to depth limit). The template shows the expected
 * structure so the user isn't staring at an empty editor.
 *
 * E.g. for a color ref: `{ "r": 0, "g": 0, "b": 0 }`
 * E.g. for a strongRef:  `{ "uri": "", "cid": "" }`
 */
function buildDefaultTemplate(
  properties: Record<string, LexiconProperty>,
): Record<string, unknown> {
  const template: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(properties)) {
    template[name] = defaultForPropType(prop);
  }
  return template;
}

/** Derive a sensible default value for a single property. */
function defaultForPropType(prop: LexiconProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  if (prop.const !== undefined) return prop.const;
  switch (prop.type) {
    case 'string':
      return '';
    case 'integer':
      return prop.minimum ?? 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      if (prop.properties) {
        return buildDefaultTemplate(prop.properties);
      }
      return {};
    default:
      return null;
  }
}
