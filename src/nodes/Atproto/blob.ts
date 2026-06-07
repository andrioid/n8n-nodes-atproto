/**
 * Blob upload support for AT Protocol nodes.
 *
 * After a record is built from node parameters, this module walks the record
 * looking for fields whose lexicon definition is `type: blob`. For each such
 * field, it reads the binary data from the n8n input item, uploads it via
 * `com.atproto.repo.uploadBlob`, and replaces the field value with the
 * returned blob reference.
 *
 * Only top-level blob fields are handled (not nested inside refs/objects).
 * This covers the common case — a record whose own schema declares a blob field.
 * For Bluesky embeds (images/video), the blob lives in the embed sub-record
 * (e.g. `app.bsky.embed.images`) which the user composes as a union/JSON value;
 * blob upload for those is currently outside scope.
 */

import type { Agent } from '@atproto/api';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { LexiconSchema } from './lexicon';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk a built record and upload any blob fields whose values name a binary
 * property on the input item.
 *
 * @param record          - The constructed record (from `buildRecordFromNodeParams`).
 * @param schema          - The resolved lexicon schema, or `null` if resolution
 *                          failed. When `null`, the record passes through unchanged
 *                          (blob fields remain as raw binary property name strings).
 * @param agent           - Authenticated AT Protocol agent.
 * @param itemIndex       - Index of the current input item in the execution loop.
 * @param executeFunctions - n8n execute functions (for `getBinaryDataBuffer`).
 * @returns A new record with blob fields replaced by blob references
 *          `{ $type: 'blob', ref: { $link: cid }, mimeType, size }`.
 * @throws If a binary property named by a blob field doesn't exist or fails to
 *         upload. Follows the "rollback" pattern — first failure stops processing.
 */
export async function applyBlobUploads(
  record: Record<string, unknown>,
  schema: LexiconSchema | null,
  agent: Agent,
  itemIndex: number,
  executeFunctions: IExecuteFunctions,
): Promise<Record<string, unknown>> {
  if (!schema) {
    // Lexicon unknown — can't determine which fields are blobs.
    // Leave the record as-is; the user may have provided a raw blob ref
    // via JSON mode, or the PDS will reject with a validation error.
    return record;
  }

  const result = { ...record };

  for (const [key, value] of Object.entries(result)) {
    const propDef = schema.properties[key];
    if (!propDef || propDef.type !== 'blob') {
      continue;
    }

    // The field value from resourceMapper is the binary property name.
    // Skip empty/unset fields (they were already dropped by unflattenDottedKeys
    // for empty strings, but guard against edge cases).
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }

    // Pre-upload validation: check accept + maxSize before uploading
    const items = executeFunctions.getInputData();
    const item = items[itemIndex];
    const binaryMeta = item?.binary?.[value];

    if (propDef.accept?.length) {
      const mimeType = binaryMeta?.mimeType ?? 'application/octet-stream';
      const accepted = propDef.accept.some(pattern => {
        if (pattern === '*/*') return true;
        if (pattern.endsWith('/*'))
          return mimeType.startsWith(pattern.slice(0, -1));
        return mimeType === pattern;
      });
      if (!accepted) {
        throw new Error(
          `'${key}' accepts ${propDef.accept.join(', ')} but got ${mimeType}`,
        );
      }
    }

    // Upload the blob and substitute the reference
    result[key] = await uploadBlobFromBinary(
      value,
      propDef,
      agent,
      itemIndex,
      executeFunctions,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Upload a blob from a named binary property on the current input item.
 *
 * Steps:
 *  1. Read the binary buffer via `getBinaryDataBuffer`.
 *  2. Determine MIME type from the binary item's metadata (falls back to
 *     `application/octet-stream`).
 *  3. Call `com.atproto.repo.uploadBlob` on the PDS.
 *  4. Return the blob reference object from the response.
 */
async function uploadBlobFromBinary(
  binaryPropertyName: string,
  propDef: import('./lexicon').LexiconProperty,
  agent: Agent,
  itemIndex: number,
  executeFunctions: IExecuteFunctions,
): Promise<Record<string, unknown>> {
  // 1. Read binary data
  const buffer = await executeFunctions.helpers.getBinaryDataBuffer(
    itemIndex,
    binaryPropertyName,
  );

  if (!buffer) {
    throw new Error(
      `Binary property "${binaryPropertyName}" not found on input item`,
    );
  }

  // 1b. Check maxSize before uploading (saves bandwidth)
  if (propDef.maxSize && buffer.length > propDef.maxSize) {
    throw new Error(
      `'${binaryPropertyName}' max size is ${propDef.maxSize} bytes, file is ${buffer.length} bytes`,
    );
  }

  // 2. Determine MIME type from binary metadata
  const items = executeFunctions.getInputData();
  const item = items[itemIndex];
  const binaryMeta = item?.binary?.[binaryPropertyName];
  const mimeType = binaryMeta?.mimeType ?? 'application/octet-stream';

  // 3. Upload to PDS
  // The typed XRPC client signature is `uploadBlob(data, opts)` where
  // `data` is the raw binary buffer and `opts.encoding` sets the
  // Content-Type header.
  const response = await agent.com.atproto.repo.uploadBlob(buffer, {
    encoding: mimeType,
  });

  // 4. Return the blob reference
  return response.data.blob as unknown as Record<string, unknown>;
}
