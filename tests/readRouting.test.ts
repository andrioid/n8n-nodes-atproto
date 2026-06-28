/**
 * Behaviour test for the read-routing fix.
 *
 * Repo-hosting reads (listRecords/getRecord/...) must be sent to the PDS that
 * hosts the *target* repo, resolved from its DID document — not the
 * authenticated session's PDS, which only serves its own repos and answers
 * "Could not find repo" for any other.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { Agent, CredentialSession } from '@atproto/api';

import { listRecords, getBlob } from '../nodes/Atproto/operations';
import { server, PDS_URL, CID_1 } from './setup';

const FOREIGN_PDS = 'https://foreign.host.example';
const FOREIGN_DID = 'did:plc:foreign-repo';

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

afterEach(() => {
  server.resetHandlers();
});

describe('read routing for foreign repos', () => {
  it('lists a foreign repo from the PDS named in its DID document', async () => {
    server.use(
      http.get(/plc\.directory/, () =>
        HttpResponse.json({
          service: [
            {
              id: '#atproto_pds',
              type: 'AtprotoPersonalDataServer',
              serviceEndpoint: FOREIGN_PDS,
            },
          ],
        }),
      ),
      http.get(`${FOREIGN_PDS}/xrpc/com.atproto.repo.listRecords`, () =>
        HttpResponse.json({
          records: [
            {
              uri: `at://${FOREIGN_DID}/site.standard.publication/abc`,
              cid: CID_1,
              value: { $type: 'site.standard.publication', name: 'Foreign' },
            },
          ],
        }),
      ),
    );

    const result = await listRecords(agent, {
      collection: 'site.standard.publication',
      repo: FOREIGN_DID,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].uri).toContain(FOREIGN_DID);
    expect(result.records[0].value.name).toBe('Foreign');
  });

  it('downloads a foreign blob from the hosting PDS', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    server.use(
      http.get(/plc\.directory/, () =>
        HttpResponse.json({
          service: [
            {
              id: '#atproto_pds',
              type: 'AtprotoPersonalDataServer',
              serviceEndpoint: FOREIGN_PDS,
            },
          ],
        }),
      ),
      http.get(
        `${FOREIGN_PDS}/xrpc/com.atproto.sync.getBlob`,
        () =>
          new HttpResponse(bytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      ),
    );

    const result = await getBlob(agent, { did: FOREIGN_DID, cid: CID_1 });

    expect(result.mimeType).toBe('image/png');
    expect(new Uint8Array(result.data)).toEqual(bytes);
  });

  it('surfaces a clear error when the DID document has no PDS', async () => {
    server.use(
      http.get(/plc\.directory/, () => HttpResponse.json({ service: [] })),
    );

    await expect(
      listRecords(agent, {
        collection: 'site.standard.publication',
        repo: FOREIGN_DID,
      }),
    ).rejects.toThrow(/No PDS endpoint/);
  });
});
