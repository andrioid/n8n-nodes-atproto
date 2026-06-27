/**
 * OpenGraph scraping for Bluesky external link-card embeds
 * (`app.bsky.embed.external`).
 *
 * A link card is built from a page's `og:*` (and `twitter:*`) meta tags.
 * We fetch the target HTML and extract title / description / image with a
 * small, dependency-free `<meta>` scanner — the package ships zero runtime
 * deps, so a full HTML parser is out of scope. This handles the `<head>`
 * meta tags every card relies on; it is not a general HTML parser.
 */

export interface ExternalMetadata {
  title: string;
  description: string;
  /** Absolute URL of the card thumbnail, if the page advertises one. */
  image?: string;
}

/** Minimal slice of the Fetch `Response` this module consumes. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}

export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

const USER_AGENT = 'n8n-nodes-atproto (link-card scraper)';

// Typed wrapper over the global fetch (Node >=22, see package.json engines).
// The wrapper form keeps the call site fully typed without an inline cast.
const defaultFetch: HttpFetch = (url, init) => fetch(url, init);

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and extract its link-card metadata. Throws if the page cannot
 * be retrieved (network error or non-2xx) — the caller treats a failed scrape
 * as a hard failure of the item.
 */
export async function fetchExternalMetadata(
  url: string,
  doFetch: HttpFetch = defaultFetch,
): Promise<ExternalMetadata> {
  let res: HttpResponse | undefined;
  let failure: string | undefined;
  try {
    res = await doFetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (err) {
    failure = errMessage(err);
  }
  if (failure !== undefined) {
    throw new Error(
      `Could not fetch ${url} for link-card metadata: ${failure}`,
    );
  }
  if (!res || !res.ok) {
    const detail = res ? `HTTP ${res.status} ${res.statusText}` : 'no response';
    throw new Error(
      `Could not fetch ${url} for link-card metadata: ${detail}`,
    );
  }
  return parseOpenGraph(await res.text(), url);
}

/**
 * Download a thumbnail image. Returns the raw bytes and the response's
 * content-type. Throws on a non-2xx response; the caller treats the thumbnail
 * as best-effort and posts without it on failure.
 */
export async function fetchThumbnail(
  url: string,
  doFetch: HttpFetch = defaultFetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await doFetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get('content-type');
  const mimeType = contentType
    ? contentType.split(';')[0].trim()
    : 'application/octet-stream';
  return { bytes, mimeType };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const META_TAG = /<meta\b[^>]*>/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1].toLowerCase() === 'x'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

/** Read an attribute value (double- or single-quoted) from a single tag. */
function getAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(
    tag,
  );
  if (!match) return undefined;
  return match[2] ?? match[3];
}

/**
 * Extract link-card metadata from page HTML.
 *
 * Precedence: `og:*` → `twitter:*` → `<title>` / `<meta name="description">`.
 * A relative `og:image` is resolved against `baseUrl`. Returns empty strings
 * for missing title/description (both are required by the lexicon).
 */
export function parseOpenGraph(html: string, baseUrl: string): ExternalMetadata {
  const props = new Map<string, string>();
  for (const tag of html.match(META_TAG) ?? []) {
    const key = getAttr(tag, 'property') ?? getAttr(tag, 'name');
    const content = getAttr(tag, 'content');
    if (key && content !== undefined && !props.has(key.toLowerCase())) {
      props.set(key.toLowerCase(), content);
    }
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = props.get(key);
      if (value !== undefined && value !== '') return value;
    }
    return undefined;
  };

  let title = pick('og:title', 'twitter:title');
  if (title === undefined) {
    const match = TITLE_TAG.exec(html);
    if (match) title = match[1].trim();
  }

  const description =
    pick('og:description', 'twitter:description', 'description') ?? '';

  const imageRaw = pick('og:image', 'og:image:url', 'twitter:image');
  let image: string | undefined;
  if (imageRaw) {
    try {
      image = new URL(decodeEntities(imageRaw), baseUrl).toString();
    } catch {
      image = undefined;
    }
  }

  return {
    title: decodeEntities(title ?? ''),
    description: decodeEntities(description),
    image,
  };
}
