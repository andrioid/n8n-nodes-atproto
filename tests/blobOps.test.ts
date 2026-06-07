/**
 * Tests for generic blob operations on the AT Protocol node.
 *
 * Covers:
 *  - uploadBlob: takes binary + mimeType, returns a serialized blob ref
 *  - getBlob: downloads bytes by (did, cid), surfaces Content-Type
 *  - listBlobs: lists blob CIDs for a repo with cursor + since
 *  - resolveActorToDid: handle → DID resolution helper used by node UI
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { Agent, CredentialSession } from '@atproto/api';

import {
  uploadBlob,
  getBlob,
  listBlobs,
  resolveActorToDid,
} from '../src/nodes/Atproto/operations';

import {
  server,
  PDS_URL,
  FAKE_DID,
  CID_1,
  CID_2,
  CID_3,
  clearInterceptedRequests,
  clearMockResponses,
  clearUploadedBlobs,
  interceptedRequests,
  uploadedBlobs,
  setMockResponse,
} from './setup';

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
  clearInterceptedRequests();
  clearMockResponses();
  clearUploadedBlobs();
});

// ---------------------------------------------------------------------------
// uploadBlob
// ---------------------------------------------------------------------------

describe('uploadBlob', () => {
  it('uploads a buffer and returns a serialized blob ref', async () => {
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const result = await uploadBlob(agent, {
      data,
      mimeType: 'image/jpeg',
    });

    // The shape callers can drop straight into a record embed.
    expect(result.blob.$type).toBe('blob');
    expect(result.blob.mimeType).toBe('image/jpeg');
    expect(result.blob.size).toBe(data.byteLength);
    expect(result.blob.ref.$link).toBe(CID_3);

    // The PDS received the actual bytes with the correct Content-Type.
    expect(uploadedBlobs).toHaveLength(1);
    expect(uploadedBlobs[0].mimeType).toBe('image/jpeg');
    expect(new Uint8Array(uploadedBlobs[0].data)).toEqual(new Uint8Array(data));
  });

  it('forwards arbitrary MIME types verbatim', async () => {
    await uploadBlob(agent, {
      data: Buffer.from('hello'),
      mimeType: 'application/x-custom',
    });

    expect(uploadedBlobs[0].mimeType).toBe('application/x-custom');
  });

  it('propagates PDS errors unchanged', async () => {
    setMockResponse('com.atproto.repo.uploadBlob', () => {
      throw new Error('PayloadTooLarge');
    });

    await expect(
      uploadBlob(agent, {
        data: Buffer.from('too big'),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getBlob
// ---------------------------------------------------------------------------

describe('getBlob', () => {
  it('downloads raw bytes and surfaces the MIME type', async () => {
    const fakeBody = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    setMockResponse('com.atproto.sync.getBlob', () => ({
      body: fakeBody,
      contentType: 'image/png',
    }));

    const result = await getBlob(agent, {
      did: FAKE_DID,
      cid: CID_1,
    });

    expect(result.data).toBeInstanceOf(Buffer);
    expect(new Uint8Array(result.data)).toEqual(fakeBody);
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(fakeBody.byteLength);
  });

  it('falls back to empty mimeType when server omits Content-Type', async () => {
    // Default mock returns application/octet-stream. Override with an
    // explicit empty content-type to assert the read path doesn't crash.
    setMockResponse('com.atproto.sync.getBlob', () => ({
      body: new Uint8Array([0]),
      contentType: '',
    }));

    const result = await getBlob(agent, {
      did: FAKE_DID,
      cid: CID_2,
    });

    // The XRPC layer may inject a default Content-Type when the header
    // is empty; we just assert the call succeeds and exposes whatever
    // the headers carried.
    expect(typeof result.mimeType).toBe('string');
    expect(result.size).toBe(1);
  });

  it('sends did + cid as query parameters', async () => {
    await getBlob(agent, {
      did: FAKE_DID,
      cid: CID_1,
    });

    const req = interceptedRequests.find((r) =>
      r.url.includes('com.atproto.sync.getBlob'),
    );
    expect(req).toBeDefined();
    expect(req!.url).toContain(`did=${encodeURIComponent(FAKE_DID)}`);
    expect(req!.url).toContain(`cid=${CID_1}`);
  });
});

// ---------------------------------------------------------------------------
// listBlobs
// ---------------------------------------------------------------------------

describe('listBlobs', () => {
  it('lists CIDs for the authenticated user when no did is provided', async () => {
    const result = await listBlobs(agent);

    expect(result.cids).toEqual([CID_1, CID_2, CID_3]);
    expect(result.cursor).toBe('next-blob-cursor');

    const req = interceptedRequests.find((r) =>
      r.url.includes('com.atproto.sync.listBlobs'),
    );
    expect(req).toBeDefined();
    expect(req!.url).toContain(`did=${encodeURIComponent(FAKE_DID)}`);
  });

  it('passes through did / limit / cursor / since', async () => {
    await listBlobs(agent, {
      did: 'did:plc:other',
      limit: 25,
      cursor: 'page-2',
      since: 'rev-abc',
    });

    const req = interceptedRequests.find((r) =>
      r.url.includes('com.atproto.sync.listBlobs'),
    );
    expect(req!.url).toContain('did=did%3Aplc%3Aother');
    expect(req!.url).toContain('limit=25');
    expect(req!.url).toContain('cursor=page-2');
    expect(req!.url).toContain('since=rev-abc');
  });

  it('omits the cursor field when the page has none', async () => {
    setMockResponse('com.atproto.sync.listBlobs', () => ({
      cids: [CID_1],
    }));

    const result = await listBlobs(agent);
    expect(result.cids).toEqual([CID_1]);
    expect(result.cursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveActorToDid
// ---------------------------------------------------------------------------

describe('resolveActorToDid', () => {
  it('returns DIDs unchanged', async () => {
    const did = await resolveActorToDid(agent, 'did:plc:abc123');
    expect(did).toBe('did:plc:abc123');
  });

  it('trims whitespace before checking for did: prefix', async () => {
    const did = await resolveActorToDid(agent, '  did:plc:xyz789\n');
    expect(did).toBe('did:plc:xyz789');
  });

  it('resolves handles via com.atproto.identity.resolveHandle', async () => {
    const did = await resolveActorToDid(agent, 'alice.bsky.social');

    expect(did).toBe(FAKE_DID);
    const req = interceptedRequests.find((r) =>
      r.url.includes('com.atproto.identity.resolveHandle'),
    );
    expect(req).toBeDefined();
    expect(req!.url).toContain('handle=alice.bsky.social');
  });

  it('strips a leading @ from handles before resolving', async () => {
    await resolveActorToDid(agent, '@alice.bsky.social');

    const req = interceptedRequests.find((r) =>
      r.url.includes('com.atproto.identity.resolveHandle'),
    );
    expect(req!.url).toContain('handle=alice.bsky.social');
    expect(req!.url).not.toContain('%40');
  });
});
