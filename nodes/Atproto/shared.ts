/**
 * Shared helpers used by both the CRUD action node and the Jetstream
 * trigger node — credential-to-Agent factory, resourceLocator value
 * extraction, and the `searchCollections` list-search implementation.
 */

import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodeListSearchResult,
} from 'n8n-workflow';
import { Agent, CredentialSession } from '@atproto/api';

// ---------------------------------------------------------------------------
// Create an authenticated AT Protocol Agent from node credentials
// ---------------------------------------------------------------------------

export async function createAgent(credentials: IDataObject): Promise<Agent> {
  const identifier = credentials.identifier as string;
  const appPassword = credentials.appPassword as string;
  const serviceUrl = (credentials.serviceUrl as string) || 'https://bsky.social';

  const session = new CredentialSession(new URL(serviceUrl));
  await session.login({ identifier, password: appPassword });
  return new Agent(session);
}

// ---------------------------------------------------------------------------
// Extract a plain NSID string from a resourceLocator value (or string)
// ---------------------------------------------------------------------------

/**
 * Handles both the plain string (legacy / expressions) and the
 * resourceLocator object `{ mode, value }` returned by the RLC widget.
 */
export function extractCollectionNsid(param: unknown): string {
  if (typeof param === 'string') return param;
  if (param && typeof param === 'object' && 'value' in param) {
    return String((param as { value: unknown }).value ?? '');
  }
  return '';
}

// ---------------------------------------------------------------------------
// listSearch: searchCollections
// ---------------------------------------------------------------------------

/**
 * Implementation of the `searchCollections` resourceLocator list method.
 *
 * Returns the collections in the authenticated user's repo, filtered by
 * the search term if provided. Both the CRUD node and the Jetstream
 * trigger register this under their own `methods.listSearch` so the
 * resourceLocator picker has a unified, searchable list of NSIDs.
 *
 * Errors fall through to an empty result rather than throwing — the
 * RLC still works in free-text "By NSID" mode if the user is offline
 * or the credentials are misconfigured.
 */
export async function searchCollections(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  try {
    const credentials = await this.getCredentials('atprotoApi');
    const agent = await createAgent(credentials as IDataObject);

    const response = await agent.com.atproto.repo.describeRepo({
      repo: agent.did!,
    });

    let collections =
      (response.data as { collections?: string[] }).collections ?? [];

    if (filter) {
      const q = filter.toLowerCase();
      collections = collections.filter((c) => c.toLowerCase().includes(q));
    }

    return {
      results: collections.sort().map((nsid) => ({ name: nsid, value: nsid })),
    };
  } catch {
    return { results: [] };
  }
}
