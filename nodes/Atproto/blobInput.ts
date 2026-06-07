/**
 * Parse a user-supplied blob reference into a `{ cid, did? }` shape.
 *
 * The Download Blob operation needs a CID (and a DID for the repo). Users
 * paste this from many sources, so we accept whichever shape is convenient:
 *
 *   1. Bare CID            — `bafkreig...`
 *   2. Blob-ref JSON       — `{"$link":"bafkreig..."}` or the full BlobRef
 *                            object `{"$type":"blob","ref":{"$link":"..."}}`
 *                            (so they can paste the output of a previous op
 *                            or a `getRecord` result without drilling in).
 *   3. bsky CDN URL        — `https://cdn.bsky.app/img/<variant>/plain/<did>/<cid>@<ext>`
 *                            DID is extracted and returned so the Repo field
 *                            can be left empty in this case.
 *
 * Throws a descriptive error if nothing matches.
 */

export interface ParsedBlobReference {
  cid: string;
  /** Present only when the input embedded a DID (currently: bsky CDN URLs). */
  did?: string;
}

// A CID v1 base32 starts with `bafy` or `bafk` (most cases) but the alphabet
// is base32-lowercase, so we keep this loose. A stricter check would require
// the multibase + multihash libraries, which is overkill here.
const CID_LOOSE = /^[a-z0-9]{40,}$/i;

/**
 * Path shape: `/img/<variant>/plain/<did>/<cid>(@<ext>)?`
 * The DID is everything between `/plain/` and the next `/`; the CID is
 * everything between that `/` and either `@<ext>` or end of path.
 */
const BSKY_CDN_PATH = /\/img\/[^/]+\/plain\/([^/]+)\/([^/@?#]+)(?:@[^/?#]+)?/;

export function parseBlobReference(input: unknown): ParsedBlobReference {
  // n8n expression results may not always be strings — accept object inputs
  // (a pasted BlobRef expression) directly without round-tripping through JSON.
  if (input && typeof input === 'object') {
    const cid = extractLinkFromObject(input as Record<string, unknown>);
    if (cid) return { cid };
    throw new Error(
      'Could not find a CID in the provided object. Expected a BlobRef with `ref.$link` or `$link`.',
    );
  }

  if (typeof input !== 'string') {
    throw new Error('Blob reference must be a string, BlobRef object, or URL');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Blob reference is empty');
  }

  // 1. bsky CDN URL — try before bare-CID because the URL also contains
  //    CID-like strings inside it.
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = safeUrl(trimmed);
    if (!url) {
      throw new Error(`Not a valid URL: ${trimmed}`);
    }
    const match = url.pathname.match(BSKY_CDN_PATH);
    if (match) {
      return { did: decodeURIComponent(match[1]), cid: match[2] };
    }
    throw new Error(
      'URL is not a recognised bsky CDN blob URL (expected /img/<variant>/plain/<did>/<cid>)',
    );
  }

  // 2. JSON blob-ref pasted as a string
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const cid = extractLinkFromObject(parsed);
      if (cid) return { cid };
    } catch {
      // fall through to bare-CID check
    }
    throw new Error(
      'Could not find a CID in the pasted JSON. Expected `{"$link":"..."}` or a full BlobRef.',
    );
  }

  // 3. Bare CID
  if (CID_LOOSE.test(trimmed)) {
    return { cid: trimmed };
  }

  throw new Error(
    `Unrecognised blob reference: "${trimmed}". Expected a CID, a blob-ref JSON, or a bsky CDN URL.`,
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Pull a `$link` value out of common BlobRef shapes:
 *   - `{ $link: "..." }`
 *   - `{ ref: { $link: "..." } }`
 *   - `{ $type: "blob", ref: { $link: "..." }, mimeType, size }`
 */
function extractLinkFromObject(obj: Record<string, unknown>): string | null {
  const directLink = obj['$link'];
  if (typeof directLink === 'string' && directLink.length > 0) {
    return directLink;
  }
  const ref = obj['ref'];
  if (ref && typeof ref === 'object') {
    const nestedLink = (ref as Record<string, unknown>)['$link'];
    if (typeof nestedLink === 'string' && nestedLink.length > 0) {
      return nestedLink;
    }
  }
  return null;
}

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}
