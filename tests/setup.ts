/**
 * Test setup — mock XRPC server using msw (Mock Service Worker).
 *
 * Intercepts all HTTP requests to the PDS and returns fake responses,
 * allowing us to test the operations without needing a real AT Protocol server.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { APP_BSKY_FEED_POST, PRIMITIVE_ONLY } from './mockLexicons';

export const PDS_URL = 'https://bsky.social';

// Fake DID/handle for test identity
export const FAKE_DID = 'did:plc:fake-test-did';
export const FAKE_HANDLE = 'test.bsky.social';

// Valid CID strings (generated from multiformats for validation compatibility)
export const CID_1 = 'bafyreifbqyaaiix6vocxgkogqtu75ekbfmnf3meecaftpkmm7sk3mkvim4';
export const CID_2 = 'bafyreia6kxtrbvtvidixq34xtxcumy26ljyb7bpiz323cdm5v2lpw37fmi';
export const CID_3 = 'bafyreiequmvpbykj4mr36a4qfnsppnzh7o5p6xire2ljlmtk5m4smmfdke';

// Track intercepted request bodies for assertions
export const interceptedRequests: Array<{
  method: string;
  url: string;
  body?: unknown;
}> = [];

// Track blob uploads separately (binary body isn't JSON)
export const uploadedBlobs: Array<{
  mimeType: string;
  data: ArrayBuffer;
}> = [];

// Default mock responses keyed by XRPC method
interface MockResponses {
  [method: string]: (body?: unknown) => Record<string, unknown>;
}

const defaultResponses: MockResponses = {
  'com.atproto.server.createSession': () => ({
    accessJwt: 'fake-access-jwt',
    refreshJwt: 'fake-refresh-jwt',
    did: FAKE_DID,
    handle: FAKE_HANDLE,
  }),
  'com.atproto.repo.createRecord': (body) => ({
    uri: `at://${FAKE_DID}/${(body as any)?.collection ?? 'unknown'}/${(body as any)?.rkey ?? 'auto'}`,
    cid: CID_1,
  }),
  'com.atproto.repo.getRecord': () => ({
    uri: `at://${FAKE_DID}/app.bsky.feed.post/3jzfcijpj2z2a`,
    cid: CID_1,
    value: {
      $type: 'app.bsky.feed.post',
      text: 'Hello, world!',
      createdAt: new Date().toISOString(),
    },
  }),
  'com.atproto.repo.putRecord': (body) => ({
    uri: `at://${FAKE_DID}/${(body as any)?.collection ?? 'unknown'}/${(body as any)?.rkey ?? 'unknown'}`,
    cid: CID_2,
  }),
  'com.atproto.repo.deleteRecord': () => ({}),
  'com.atproto.sync.listBlobs': () => ({
    cids: [CID_1, CID_2, CID_3],
    cursor: 'next-blob-cursor',
  }),
  'com.atproto.identity.resolveHandle': () => ({
    did: FAKE_DID,
  }),
  'com.atproto.repo.listRecords': () => ({
    records: [
      {
        uri: `at://${FAKE_DID}/app.bsky.feed.post/3jzfcijpj2z2a`,
        cid: CID_1,
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Post 1',
          createdAt: new Date().toISOString(),
        },
      },
      {
        uri: `at://${FAKE_DID}/app.bsky.feed.post/3jzfcijpj2z2b`,
        cid: CID_2,
        value: {
          $type: 'app.bsky.feed.post',
          text: 'Post 2',
          createdAt: new Date().toISOString(),
        },
      },
    ],
    cursor: 'next-page-cursor',
  }),
  // Note: uploadBlob is handled by a dedicated handler below (binary body,
  // not JSON) so this entry is only reached via setMockResponse overrides.
};

// Allow tests to override specific responses
let responseOverrides: MockResponses = {};

export function setMockResponse(
  method: string,
  handler: (body?: unknown) => Record<string, unknown>,
): void {
  responseOverrides[method] = handler;
}

export function clearMockResponses(): void {
  responseOverrides = {};
}

export function clearInterceptedRequests(): void {
  interceptedRequests.length = 0;
}

export function clearUploadedBlobs(): void {
  uploadedBlobs.length = 0;
}

// Helper: match any XRPC request and extract the method name
function xrpcHandler(method: string, body?: unknown) {
  const handler = responseOverrides[method] ?? defaultResponses[method];
  if (handler) {
    return HttpResponse.json(handler(body));
  }
  return HttpResponse.json(
    { error: 'MethodNotFound', message: `No mock for ${method}` },
    { status: 404 },
  );
}

async function captureRequest(request: Request): Promise<unknown> {
  let body: unknown = undefined;
  if (request.body) {
    try {
      body = await request.clone().json();
    } catch {
      // Not JSON, ignore
    }
  }
  interceptedRequests.push({
    method: request.method,
    url: request.url,
    body,
  });
  return body;
}

/**
 * Build a regex that matches /xrpc/{methodName} under the PDS base URL,
 * allowing optional query params after the method name.
 */
function xrpcRegex(method: string): RegExp {
  const escaped = method.replace(/\./g, '\\.');
  return new RegExp(`^${PDS_URL.replace(/\./g, '\\.')}/xrpc/${escaped}(\\?.*)?$`);
}

// Default lexicon mock response — uses valid CID strings to pass format validation.
function defaultLexiconResponse(nsid: string) {
  if (nsid === 'app.bsky.feed.post') {
    return {
      cid: CID_1,
      uri: `at://${FAKE_DID}/com.atproto.lexicon.schema/${nsid.replace(/\./g, '_')}`,
      schema: APP_BSKY_FEED_POST,
    };
  }
  if (nsid === 'io.example.primitive') {
    return {
      cid: CID_2,
      uri: `at://${FAKE_DID}/com.atproto.lexicon.schema/${nsid.replace(/\./g, '_')}`,
      schema: PRIMITIVE_ONLY,
    };
  }
  throw Object.assign(new Error('LexiconNotFound'), { status: 404 });
}

export const server = setupServer(
  http.post(xrpcRegex('com.atproto.server.createSession'), async ({ request }) => {
    const body = await captureRequest(request);
    return xrpcHandler('com.atproto.server.createSession', body);
  }),

  http.post(xrpcRegex('com.atproto.repo.createRecord'), async ({ request }) => {
    const body = await captureRequest(request);
    return xrpcHandler('com.atproto.repo.createRecord', body);
  }),

  http.get(xrpcRegex('com.atproto.repo.getRecord'), async ({ request }) => {
    await captureRequest(request);
    return xrpcHandler('com.atproto.repo.getRecord');
  }),

  http.post(xrpcRegex('com.atproto.repo.putRecord'), async ({ request }) => {
    const body = await captureRequest(request);
    return xrpcHandler('com.atproto.repo.putRecord', body);
  }),

  http.post(xrpcRegex('com.atproto.repo.deleteRecord'), async ({ request }) => {
    const body = await captureRequest(request);
    return xrpcHandler('com.atproto.repo.deleteRecord', body);
  }),

  http.get(xrpcRegex('com.atproto.repo.listRecords'), async ({ request }) => {
    await captureRequest(request);
    return xrpcHandler('com.atproto.repo.listRecords');
  }),

  http.get(xrpcRegex('com.atproto.identity.resolveHandle'), async ({ request }) => {
    await captureRequest(request);
    return xrpcHandler('com.atproto.identity.resolveHandle');
  }),

  // Blob download — returns raw binary, not JSON. Tests can override the
  // body/Content-Type via setMockResponse('com.atproto.sync.getBlob', ...).
  http.get(xrpcRegex('com.atproto.sync.getBlob'), async ({ request }) => {
    await captureRequest(request);
    const handler = responseOverrides['com.atproto.sync.getBlob'];
    if (handler) {
      const fake = handler() as {
        body?: ArrayBuffer | Buffer | Uint8Array;
        contentType?: string;
        status?: number;
      };
      if (fake.status && fake.status !== 200) {
        return HttpResponse.json(
          { error: 'BlobNotFound', message: 'mock error' },
          { status: fake.status },
        );
      }
      const body =
        fake.body instanceof ArrayBuffer
          ? new Uint8Array(fake.body)
          : fake.body ?? new Uint8Array();
      return new HttpResponse(body, {
        status: 200,
        headers: {
          'content-type': fake.contentType ?? 'application/octet-stream',
        },
      });
    }
    // Default: return a tiny fake blob
    return new HttpResponse(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }),

  http.get(xrpcRegex('com.atproto.sync.listBlobs'), async ({ request }) => {
    await captureRequest(request);
    return xrpcHandler('com.atproto.sync.listBlobs');
  }),

  // Phase 2: Lexicon resolution
  // Phase 3: Blob upload — binary body, not JSON, so handle separately
  http.post(xrpcRegex('com.atproto.repo.uploadBlob'), async ({ request }) => {
    const encoding = request.headers.get('content-type') ?? 'application/octet-stream';
    const blobData = await request.clone().arrayBuffer();
    const mockBody = { data: blobData, encoding };

    // Still record for assertion tracking
    interceptedRequests.push({
      method: 'POST',
      url: request.url,
      body: { encoding, byteLength: blobData.byteLength },
    });

    uploadedBlobs.push({
      mimeType: encoding,
      data: blobData,
    });

    const handler = responseOverrides['com.atproto.repo.uploadBlob'];
    if (handler) {
      return HttpResponse.json(handler(mockBody));
    }

    return HttpResponse.json({
      blob: {
        $type: 'blob',
        ref: { $link: CID_3 },
        mimeType: encoding,
        size: blobData.byteLength,
      },
    });
  }),

  http.get(xrpcRegex('com.atproto.lexicon.resolveLexicon'), async ({ request }) => {
    const url = new URL(request.url);
    const nsid = url.searchParams.get('nsid') ?? '';
    await captureRequest(request);

    const handler = responseOverrides['com.atproto.lexicon.resolveLexicon'];
    if (handler) {
      return HttpResponse.json(handler({ nsid }));
    }

    // Default behavior: resolve known mock lexicons
    try {
      const result = defaultLexiconResponse(nsid);
      return HttpResponse.json(result);
    } catch {
      return HttpResponse.json(
        { error: 'LexiconNotFound', message: `No mock lexicon for ${nsid}` },
        { status: 404 },
      );
    }
  }),

  // DID document resolution (PLC directory) — point every repo at the mock
  // PDS so foreign-repo reads route back to these handlers.
  http.get(/plc\.directory/, () => {
    return HttpResponse.json({
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: PDS_URL,
        },
      ],
    });
  }),

  // Catch-all: bypass any unhandled request (DID resolution, etc.)
  // to avoid MSW errors when @atproto/api makes internal requests.
  http.all('*', async () => {
    return HttpResponse.json({}, { status: 200 });
  }),
);
