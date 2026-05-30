/**
 * Test setup — mock XRPC server using msw (Mock Service Worker).
 *
 * Intercepts all HTTP requests to the PDS and returns fake responses,
 * allowing us to test the operations without needing a real AT Protocol server.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

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
);
