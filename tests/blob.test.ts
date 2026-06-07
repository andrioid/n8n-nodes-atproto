/**
 * Tests for blob upload support (Phase 3).
 *
 * Tests `applyBlobUploads` which walks a record, uploads binary data for
 * blob-typed fields, and substitutes blob references.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { applyBlobUploads } from '../nodes/Atproto/blob';
import { resolveLexiconSchema, clearLexiconCache, parseLexiconDoc } from '../nodes/Atproto/lexicon';
import { CONSTRAINED_SCHEMA } from './mockLexicons';
import {
  server,
  PDS_URL,
  CID_3,
  clearMockResponses,
  clearInterceptedRequests,
  clearUploadedBlobs,
  uploadedBlobs,
} from './setup';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a mock IExecuteFunctions with optional binary data. */
function mockExecuteFunctions(
  binaryData?: Record<string, { data: Buffer; mimeType: string }>,
): IExecuteFunctions {
  const inputData: INodeExecutionData[] = [
    {
      json: {},
      ...(binaryData
        ? {
            binary: Object.fromEntries(
              Object.entries(binaryData).map(([name, info]) => [
                name,
                { mimeType: info.mimeType },
              ]),
            ),
          }
        : {}),
    },
  ];

  return {
    helpers: {
      getBinaryDataBuffer: async (
        _itemIndex: number,
        binaryPropertyName: string,
      ) => {
        const entry = binaryData?.[binaryPropertyName];
        if (!entry) return null;
        return entry.data;
      },
    },
    getInputData: () => inputData,
  } as unknown as IExecuteFunctions;
}

/** Content of a mock image file (small valid JPEG-like buffer). */
const MOCK_IMAGE_DATA = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const MOCK_TEXT_DATA = Buffer.from('hello world');

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let agent: Agent;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });

  const session = new CredentialSession(new URL(PDS_URL));
  await session.login({
    identifier: 'test.bsky.social',
    password: 'xxxx-xxxx-xxxx-xxxx',
  });
  agent = new Agent(session);
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  clearLexiconCache();
  clearMockResponses();
  clearInterceptedRequests();
  clearUploadedBlobs();
});

// ---------------------------------------------------------------------------
// applyBlobUploads
// ---------------------------------------------------------------------------

describe('applyBlobUploads', () => {
  it('uploads a blob and replaces the field with a blob reference', async () => {
    // `io.example.primitive` has a `blob` field of type `blob`
    const record = { title: 'Test', blob: 'myImage' };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const executeFunctions = mockExecuteFunctions({
      myImage: { data: MOCK_IMAGE_DATA, mimeType: 'image/jpeg' },
    });

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      executeFunctions,
    );

    // The blob field should be replaced with a BlobRef (from @atproto/lexicon).
    // BlobRef is a class — check individual properties.
    const br = result.blob as Record<string, unknown>;
    expect(br.mimeType).toBe('image/jpeg');
    expect(br.size).toBe(MOCK_IMAGE_DATA.byteLength);
    expect((br.ref as { toString: () => string }).toString()).toBe(CID_3);

    // Non-blob fields should be unchanged
    expect(result.title).toBe('Test');

    // Should have made an upload call
    expect(uploadedBlobs).toHaveLength(1);
    expect(uploadedBlobs[0].mimeType).toBe('image/jpeg');
    expect(new Uint8Array(uploadedBlobs[0].data)).toEqual(
      new Uint8Array(MOCK_IMAGE_DATA),
    );
  });

  it('leaves non-blob fields untouched', async () => {
    const record = {
      title: 'Hello',
      count: 42,
      enabled: true,
    };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      mockExecuteFunctions(),
    );

    expect(result).toEqual(record);
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('passes through when schema is null (unresolvable lexicon)', async () => {
    const record = { image: 'myImage' };

    const result = await applyBlobUploads(
      record,
      null, // schema unknown
      agent,
      0,
      mockExecuteFunctions(),
    );

    // Record should pass through unchanged — can't know which fields are blobs
    expect(result).toEqual(record);
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('skips blob fields with empty string values', async () => {
    const record = {
      title: 'Test',
      blob: '', // left blank by user
    };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      mockExecuteFunctions(),
    );

    // Empty string blob field should remain as-is (wasn't uploaded)
    expect(result.blob).toBe('');
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('skips blob fields with non-string values', async () => {
    const record = {
      title: 'Test',
      blob: 123, // not a binary property name
    };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      mockExecuteFunctions(),
    );

    expect(result.blob).toBe(123);
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('throws when a named binary property does not exist', async () => {
    const record = { title: 'Test', blob: 'nonExistentImage' };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    await expect(
      applyBlobUploads(record, schema, agent, 0, mockExecuteFunctions()),
    ).rejects.toThrow('Binary property "nonExistentImage" not found');
  });

  it('uploads multiple blob fields in one record', async () => {
    const record = {
      title: 'Multi-blob test',
      blob: 'firstBlob',
      cid: 'some-cid',
      data: 'secondBlob',
    };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const executeFunctions = mockExecuteFunctions({
      firstBlob: { data: MOCK_IMAGE_DATA, mimeType: 'image/png' },
      secondBlob: { data: MOCK_TEXT_DATA, mimeType: 'text/plain' },
    });

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      executeFunctions,
    );

    // blob field should be replaced with a BlobRef
    const br = result.blob as Record<string, unknown>;
    expect(br.mimeType).toBe('image/png');
    expect(br.size).toBe(MOCK_IMAGE_DATA.byteLength);
    expect((br.ref as { toString: () => string }).toString()).toBe(CID_3);

    // data field (bytes type, not blob) should remain a string
    expect(result.data).toBe('secondBlob');

    // cid-link field should remain a string
    expect(result.cid).toBe('some-cid');

    expect(uploadedBlobs).toHaveLength(1); // only 'blob' is type:blob
  });

  it('uses application/octet-stream fallback when binary metadata has no mimeType', async () => {
    const record = { title: 'Test', blob: 'rawData' };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    // Binary data without mimeType
    const executeFunctions = {
      helpers: {
        getBinaryDataBuffer: async () => MOCK_TEXT_DATA,
      },
      getInputData: () => [
        {
          json: {},
          binary: {
            rawData: {
              // No mimeType property → should fall back
            },
          },
        },
      ],
    } as unknown as IExecuteFunctions;

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      executeFunctions,
    );

    const br = result.blob as Record<string, unknown>;
    expect(br.mimeType).toBe('application/octet-stream');
    expect(uploadedBlobs[0].mimeType).toBe('application/octet-stream');
  });

  it('uses the original record object without mutation', async () => {
    const record = { title: 'Test', blob: 'myImage' };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const executeFunctions = mockExecuteFunctions({
      myImage: { data: MOCK_IMAGE_DATA, mimeType: 'image/jpeg' },
    });

    const originalRecord = { ...record };

    await applyBlobUploads(record, schema, agent, 0, executeFunctions);

    // Original should not be mutated
    expect(record).toEqual(originalRecord);
  });

  it('handles empty record', async () => {
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');

    const result = await applyBlobUploads(
      {},
      schema,
      agent,
      0,
      mockExecuteFunctions(),
    );

    expect(result).toEqual({});
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('rejects blob with wrong MIME type vs accept constraint', async () => {
    const schema = parseLexiconDoc(CONSTRAINED_SCHEMA, 'io.example.constrained');
    // avatar accepts image/png, image/jpeg only
    const record = { visibility: 'public', score: 50, version: 1, avatar: 'myGif' };
    const executeFunctions = mockExecuteFunctions({
      myGif: { data: MOCK_IMAGE_DATA, mimeType: 'image/gif' },
    });

    await expect(
      applyBlobUploads(record, schema, agent, 0, executeFunctions),
    ).rejects.toThrow("'avatar' accepts image/png, image/jpeg but got image/gif");
    expect(uploadedBlobs).toHaveLength(0); // Should NOT have uploaded
  });

  it('rejects blob exceeding maxSize', async () => {
    const schema = parseLexiconDoc(CONSTRAINED_SCHEMA, 'io.example.constrained');
    // avatar has maxSize: 1000000
    const bigBuffer = Buffer.alloc(1000001);
    const record = { visibility: 'public', score: 50, version: 1, avatar: 'bigImage' };
    const executeFunctions = mockExecuteFunctions({
      bigImage: { data: bigBuffer, mimeType: 'image/png' },
    });

    await expect(
      applyBlobUploads(record, schema, agent, 0, executeFunctions),
    ).rejects.toThrow('max size is 1000000 bytes');
    expect(uploadedBlobs).toHaveLength(0);
  });

  it('allows blob with matching MIME and size under limit', async () => {
    const schema = parseLexiconDoc(CONSTRAINED_SCHEMA, 'io.example.constrained');
    const record = { visibility: 'public', score: 50, version: 1, avatar: 'goodImage' };
    const executeFunctions = mockExecuteFunctions({
      goodImage: { data: MOCK_IMAGE_DATA, mimeType: 'image/png' },
    });

    const result = await applyBlobUploads(record, schema, agent, 0, executeFunctions);
    const br = result.avatar as Record<string, unknown>;
    expect(br.mimeType).toBe('image/png');
    expect(uploadedBlobs).toHaveLength(1);
  });

  it('correctly identifies blob fields from the resolved schema', async () => {
    // The `io.example.primitive` lexicon has:
    //   blob (type: blob), cid (type: cid-link), data (type: bytes)
    // Only `blob` should be uploaded.
    const record = {
      blob: 'imageData',
      cid: 'some-cid',
      data: 'raw-bytes',
    };
    const schema = await resolveLexiconSchema(agent, 'io.example.primitive');
    const executeFunctions = mockExecuteFunctions({
      imageData: { data: MOCK_IMAGE_DATA, mimeType: 'image/webp' },
    });

    const result = await applyBlobUploads(
      record,
      schema,
      agent,
      0,
      executeFunctions,
    );

    // Only `blob` field should be replaced
    const br2 = result.blob as Record<string, unknown>;
    expect(br2.mimeType).toBe('image/webp');
    expect(br2.size).toBe(MOCK_IMAGE_DATA.byteLength);
    expect((br2.ref as { toString: () => string }).toString()).toBe(CID_3);
    expect(result.cid).toBe('some-cid');   // cid-link untouched
    expect(result.data).toBe('raw-bytes'); // bytes untouched
    expect(uploadedBlobs).toHaveLength(1);
  });
});
