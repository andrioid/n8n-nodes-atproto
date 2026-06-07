/**
 * Parse a Bluesky post reference into its repo/collection/rkey parts.
 *
 * Accepts either an AT-URI or an HTTPS bsky.app URL:
 *   at://did:plc:abc.../app.bsky.feed.post/3jzfcijpj2z2a
 *   https://bsky.app/profile/handle.bsky.social/post/3jzfcijpj2z2a
 *
 * Returns `{ repo, collection, rkey }` where `repo` is a DID or handle.
 * For the HTTPS form, `repo` is the handle from the URL — call
 * `agent.com.atproto.identity.resolveHandle` if you need a DID.
 */

import type { Agent } from '@atproto/api';

export interface PostRef {
  repo: string;
  collection: string;
  rkey: string;
}

const AT_URI_RE = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;
const BSKY_URL_RE =
  /^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/;

export function parsePostUri(input: string): PostRef {
  const trimmed = input.trim();

  const atMatch = trimmed.match(AT_URI_RE);
  if (atMatch) {
    return { repo: atMatch[1], collection: atMatch[2], rkey: atMatch[3] };
  }

  const urlMatch = trimmed.match(BSKY_URL_RE);
  if (urlMatch) {
    return {
      repo: urlMatch[1],
      collection: 'app.bsky.feed.post',
      rkey: urlMatch[2],
    };
  }

  throw new Error(
    `Could not parse post reference '${input}'. Expected an at:// URI or a https://bsky.app/profile/.../post/... URL.`,
  );
}

/**
 * Resolve a `PostRef` to its actual `{ uri, cid }` by calling getRecord.
 * Handles the HTTPS-URL case where `repo` is a handle (resolves to DID first).
 */
export async function fetchPostRef(
  agent: Agent,
  ref: PostRef,
): Promise<{ uri: string; cid: string; value: Record<string, unknown> }> {
  let repo = ref.repo;
  if (!repo.startsWith('did:')) {
    const resolved = await agent.com.atproto.identity.resolveHandle({
      handle: repo,
    });
    repo = resolved.data.did;
  }

  const res = await agent.com.atproto.repo.getRecord({
    repo,
    collection: ref.collection,
    rkey: ref.rkey,
  });

  return {
    uri: res.data.uri,
    cid: res.data.cid ?? '',
    value: res.data.value as Record<string, unknown>,
  };
}
