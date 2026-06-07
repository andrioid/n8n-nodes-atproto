/**
 * Execution-time record validation against the lexicon schema.
 *
 * Runs before the record is sent to the PDS, providing clear field-level
 * error messages instead of the PDS's opaque "InvalidRecord" rejections.
 *
 * Checks:
 * - Required fields are present
 * - Basic type correctness (string, integer, boolean, array, object)
 * - $type discriminator on union-typed sub-objects
 * - Recursion into nested refs (up to depth 3)
 */

import type { Agent } from '@atproto/api';
import type { LexiconProperty, LexiconSchema } from './lexicon';
import { resolveLexiconSchema, resolveRefProperties } from './lexicon';
import { getResolvableRef } from './fieldMapping';

const MAX_DEPTH = 3;

/** Auto-injected fields — skip required checks for these. */
const AUTO_INJECTED = new Set(['$type', 'createdAt']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a record against its lexicon schema.
 *
 * @returns An array of human-readable error strings. Empty = valid.
 */
export async function validateRecord(
  record: Record<string, unknown>,
  schema: LexiconSchema | null,
  agent: Agent,
): Promise<string[]> {
  if (!schema || Object.keys(schema.properties).length === 0) return [];

  return walkAndValidate(
    record,
    schema.properties,
    schema.required,
    schema,
    agent,
    '',
    0,
  );
}

// ---------------------------------------------------------------------------
// Recursive walker
// ---------------------------------------------------------------------------

async function walkAndValidate(
  obj: Record<string, unknown>,
  properties: Record<string, LexiconProperty>,
  required: string[],
  rootSchema: LexiconSchema,
  agent: Agent,
  prefix: string,
  depth: number,
): Promise<string[]> {
  const errors: string[] = [];

  // 1. Required fields
  for (const name of required) {
    if (AUTO_INJECTED.has(name)) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const value = obj[name];
    const prop = properties[name];
    // Nullable required fields accept explicit null
    if (value === null && prop?.nullable) continue;
    if (value === undefined || value === null || value === '') {
      errors.push(`Required field '${path}' is missing`);
    }
  }

  // 2. Type & structure checks on provided fields
  for (const [name, value] of Object.entries(obj)) {
    if (name === '$type') continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const prop = properties[name];
    if (!prop || value === undefined || value === null) continue;

    errors.push(...checkType(path, value, prop));

    // 3. Recurse into nested objects that came from refs/unions
    if (
      depth < MAX_DEPTH &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const refTarget = getResolvableRef(prop);
      if (refTarget) {
        const resolved = await resolveRefProperties(
          refTarget,
          rootSchema,
          (nsid: string) => resolveLexiconSchema(agent, nsid),
        );
        if (resolved && Object.keys(resolved.properties).length > 0) {
          const nested = await walkAndValidate(
            value as Record<string, unknown>,
            resolved.properties,
            resolved.required,
            rootSchema,
            agent,
            path,
            depth + 1,
          );
          errors.push(...nested);
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Type checks
// ---------------------------------------------------------------------------

function checkType(
  path: string,
  value: unknown,
  prop: LexiconProperty,
): string[] {
  const errors: string[] = [];

  switch (prop.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`'${path}' must be a string, got ${describeType(value)}`);
        break;
      }
      // UTF-8 byte length constraints
      if (prop.maxLength) {
        const byteLen = Buffer.byteLength(value, 'utf8');
        if (byteLen > prop.maxLength)
          errors.push(`'${path}' is ${byteLen} bytes (max ${prop.maxLength})`);
      }
      if (prop.minLength) {
        const byteLen = Buffer.byteLength(value, 'utf8');
        if (byteLen < prop.minLength)
          errors.push(`'${path}' is ${byteLen} bytes (min ${prop.minLength})`);
      }
      // Grapheme count (Intl.Segmenter, Node 16+)
      if (prop.maxGraphemes || prop.minGraphemes) {
        const segmenter = new Intl.Segmenter();
        const count = [...segmenter.segment(value)].length;
        if (prop.maxGraphemes && count > prop.maxGraphemes)
          errors.push(`'${path}' has ${count} graphemes (max ${prop.maxGraphemes})`);
        if (prop.minGraphemes && count < prop.minGraphemes)
          errors.push(`'${path}' has ${count} graphemes (min ${prop.minGraphemes})`);
      }
      // Closed enum
      if (prop.enum?.length && !prop.enum.includes(value))
        errors.push(`'${path}' must be one of: ${prop.enum.join(', ')}`);
      // Const
      if (prop.const !== undefined && value !== prop.const)
        errors.push(`'${path}' must be '${prop.const}'`);
      break;

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`'${path}' must be an integer, got ${describeType(value)}`);
        break;
      }
      if (prop.minimum !== undefined && value < prop.minimum)
        errors.push(`'${path}' must be ≥ ${prop.minimum}, got ${value}`);
      if (prop.maximum !== undefined && value > prop.maximum)
        errors.push(`'${path}' must be ≤ ${prop.maximum}, got ${value}`);
      if (prop.enum?.length && !prop.enum.includes(value))
        errors.push(`'${path}' must be one of: ${prop.enum.join(', ')}`);
      if (prop.const !== undefined && value !== prop.const)
        errors.push(`'${path}' must be ${prop.const}`);
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(
          `'${path}' must be true or false, got ${describeType(value)}`,
        );
        break;
      }
      if (prop.const !== undefined && value !== prop.const)
        errors.push(`'${path}' must be ${prop.const}`);
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(
          `'${path}' must be a JSON array, got ${describeType(value)}`,
        );
        break;
      }
      if (prop.maxLength !== undefined && value.length > prop.maxLength)
        errors.push(`'${path}' has ${value.length} items (max ${prop.maxLength})`);
      if (prop.minLength !== undefined && value.length < prop.minLength)
        errors.push(`'${path}' has ${value.length} items (min ${prop.minLength})`);
      // Array item validation
      if (prop.items && prop.items.type !== 'unknown') {
        for (let idx = 0; idx < value.length; idx++) {
          const itemErrors = checkType(`${path}[${idx}]`, value[idx], prop.items);
          errors.push(...itemErrors);
        }
      }
      break;

    case 'union':
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const obj = value as Record<string, unknown>;
        if (!obj['$type'] && prop.refs?.length) {
          errors.push(
            `'${path}' requires a $type property (one of: ${prop.refs.join(', ')})`,
          );
        } else if (
          prop.refs?.length &&
          obj['$type'] &&
          !prop.refs.includes(obj['$type'] as string)
        ) {
          // Closed unions: explicit error mentioning "closed union"
          if (prop.closed) {
            errors.push(
              `'${path}' has $type '${obj['$type']}' which is not allowed in this closed union (expected: ${prop.refs.join(', ')})`,
            );
          } else {
            errors.push(
              `'${path}' has invalid $type '${obj['$type']}' — expected one of: ${prop.refs.join(', ')}`,
            );
          }
        }
      }
      break;

    case 'ref':
    case 'object':
    case 'unknown':
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      ) {
        errors.push(
          `'${path}' must be a JSON object, got ${describeType(value)}`,
        );
      }
      break;

    case 'blob':
      // After applyBlobUploads, blobs should be { $type: 'blob', ref, ... }.
      // If it's still a string, the upload didn't happen (bad binary property name).
      if (typeof value === 'string') {
        errors.push(
          `'${path}' — binary property '${value}' was not found on the input. Attach a file via an HTTP Request or Read Binary File node.`,
        );
      }
      break;
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
