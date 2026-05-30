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
      }
      break;

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`'${path}' must be an integer, got ${describeType(value)}`);
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(
          `'${path}' must be true or false, got ${describeType(value)}`,
        );
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(
          `'${path}' must be a JSON array, got ${describeType(value)}`,
        );
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
          errors.push(
            `'${path}' has invalid $type '${obj['$type']}' — expected one of: ${prop.refs.join(', ')}`,
          );
        }
      }
      break;

    case 'ref':
    case 'object':
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
