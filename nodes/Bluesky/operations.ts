/**
 * Bluesky-specific operations. Thin wrappers around the AT Protocol
 * createRecord XRPC that handle the per-record-type ceremony:
 *
 *  - Post.create   → builds the rich-text record (auto-facet detection),
 *                    optional language tags, optional image embed
 *  - Post.reply    → walks parent → root and builds the reply ref
 *  - Post.quote    → builds an `app.bsky.embed.record` embed
 *  - Like.create   → fetches subject CID, creates `app.bsky.feed.like`
 *  - Repost.create → same shape as Like, in `app.bsky.feed.repost`
 *  - Follow.create → resolves handle → DID, creates `app.bsky.graph.follow`
 *
 * All operations return `{ uri, cid }` from the underlying createRecord
 * call so the workflow can chain on the new record.
 */

import type { Agent } from '@atproto/api';
import { RichText } from '@atproto/api';

import { fetchPostRef, parsePostUri } from './postUri';

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

type StrongRef = { uri: string; cid: string };

export interface CreateResult {
  uri: string;
  cid: string;
}

// ---------------------------------------------------------------------------
// Rich-text builder — used by Create / Reply / Quote
// ---------------------------------------------------------------------------

/**
 * Build the rich-text payload for a post: `{ text, facets }`.
 *
 * Uses `RichText.detectFacets(agent)` from @atproto/api, which finds
 * @mentions (and resolves them to DIDs via the PDS), URLs and #tags,
 * with correct byte offsets per the lexicon.
 */
async function buildRichText(
  agent: Agent,
  text: string,
): Promise<{ text: string; facets?: unknown[] }> {
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  return {
    text: rt.text,
    ...(rt.facets && rt.facets.length > 0 ? { facets: rt.facets } : {}),
  };
}

// ---------------------------------------------------------------------------
// Post — Create
// ---------------------------------------------------------------------------

export interface CreatePostParams {
  text: string;
  langs?: string[];
  /** Optional image embed: pre-uploaded blob + alt text */
  image?: { blob: unknown; alt: string };
}

export async function createPost(
  agent: Agent,
  params: CreatePostParams,
): Promise<CreateResult> {
  const rt = await buildRichText(agent, params.text);

  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    ...rt,
    langs: params.langs && params.langs.length > 0 ? params.langs : ['en'],
    createdAt: new Date().toISOString(),
  };

  if (params.image) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [{ alt: params.image.alt, image: params.image.blob }],
    };
  }

  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did!,
    collection: 'app.bsky.feed.post',
    record,
  });

  return { uri: res.data.uri, cid: res.data.cid };
}

// ---------------------------------------------------------------------------
// Post — Reply
// ---------------------------------------------------------------------------

export interface ReplyParams {
  parentUri: string;
  text: string;
  langs?: string[];
}

/**
 * Reply to a post. Walks the parent record to discover the thread root —
 * if the parent is itself a reply, we reuse its `reply.root`; otherwise
 * the parent IS the root.
 */
export async function replyToPost(
  agent: Agent,
  params: ReplyParams,
): Promise<CreateResult> {
  const parentRef = parsePostUri(params.parentUri);
  const parent = await fetchPostRef(agent, parentRef);

  const parentStrongRef: StrongRef = { uri: parent.uri, cid: parent.cid };
  const parentReply = (parent.value as { reply?: { root?: StrongRef } }).reply;
  const root: StrongRef = parentReply?.root ?? parentStrongRef;

  const rt = await buildRichText(agent, params.text);

  const record = {
    $type: 'app.bsky.feed.post',
    ...rt,
    langs:
      params.langs && params.langs.length > 0 ? params.langs : ['en'],
    reply: { root, parent: parentStrongRef },
    createdAt: new Date().toISOString(),
  };

  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did!,
    collection: 'app.bsky.feed.post',
    record,
  });

  return { uri: res.data.uri, cid: res.data.cid };
}

// ---------------------------------------------------------------------------
// Post — Quote
// ---------------------------------------------------------------------------

export interface QuoteParams {
  quotedUri: string;
  text: string;
  langs?: string[];
}

export async function quotePost(
  agent: Agent,
  params: QuoteParams,
): Promise<CreateResult> {
  const ref = parsePostUri(params.quotedUri);
  const subject = await fetchPostRef(agent, ref);

  const rt = await buildRichText(agent, params.text);

  const record = {
    $type: 'app.bsky.feed.post',
    ...rt,
    langs:
      params.langs && params.langs.length > 0 ? params.langs : ['en'],
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: subject.uri, cid: subject.cid },
    },
    createdAt: new Date().toISOString(),
  };

  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did!,
    collection: 'app.bsky.feed.post',
    record,
  });

  return { uri: res.data.uri, cid: res.data.cid };
}

// ---------------------------------------------------------------------------
// Engagement — Like / Repost
// ---------------------------------------------------------------------------

async function createSubjectRef(
  agent: Agent,
  postUri: string,
  collection: 'app.bsky.feed.like' | 'app.bsky.feed.repost',
): Promise<CreateResult> {
  const ref = parsePostUri(postUri);
  const subject = await fetchPostRef(agent, ref);

  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did!,
    collection,
    record: {
      $type: collection,
      subject: { uri: subject.uri, cid: subject.cid },
      createdAt: new Date().toISOString(),
    },
  });

  return { uri: res.data.uri, cid: res.data.cid };
}

export function likePost(
  agent: Agent,
  postUri: string,
): Promise<CreateResult> {
  return createSubjectRef(agent, postUri, 'app.bsky.feed.like');
}

export function repostPost(
  agent: Agent,
  postUri: string,
): Promise<CreateResult> {
  return createSubjectRef(agent, postUri, 'app.bsky.feed.repost');
}

// ---------------------------------------------------------------------------
// Graph — Follow
// ---------------------------------------------------------------------------

/**
 * Follow a user. Accepts either a handle (`alice.bsky.social`) or a DID.
 * Handles are resolved via `com.atproto.identity.resolveHandle` first.
 */
export async function followUser(
  agent: Agent,
  handleOrDid: string,
): Promise<CreateResult> {
  const trimmed = handleOrDid.trim();
  let did = trimmed;
  if (!did.startsWith('did:')) {
    // Strip leading @ if the user typed @alice.bsky.social
    const handle = did.startsWith('@') ? did.slice(1) : did;
    const resolved = await agent.com.atproto.identity.resolveHandle({
      handle,
    });
    did = resolved.data.did;
  }

  const res = await agent.com.atproto.repo.createRecord({
    repo: agent.did!,
    collection: 'app.bsky.graph.follow',
    record: {
      $type: 'app.bsky.graph.follow',
      subject: did,
      createdAt: new Date().toISOString(),
    },
  });

  return { uri: res.data.uri, cid: res.data.cid };
}
