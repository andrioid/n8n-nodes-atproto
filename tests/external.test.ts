/**
 * Tests for OpenGraph link-card scraping.
 *
 * Covers: meta-tag extraction (attribute order, twitter/<title> fallbacks,
 * relative image resolution, entity decoding) and the fetch wrappers'
 * success / failure behaviour with an injected fetch.
 */

import { describe, it, expect } from 'vitest';

import {
  parseOpenGraph,
  fetchExternalMetadata,
  fetchThumbnail,
  type HttpFetch,
  type HttpResponse,
} from '../nodes/Bluesky/external';

function htmlResponse(
  html: string,
  init: { ok?: boolean; status?: number } = {},
): HttpResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.status === 404 ? 'Not Found' : 'OK',
    text: async () => html,
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: () => null },
  };
}

describe('parseOpenGraph', () => {
  it('extracts og tags regardless of attribute order and decodes entities', () => {
    const html = `
      <meta property="og:title" content="Hello &amp; World">
      <meta content="A description" name="og:description">
      <meta property="og:image" content="/img/card.png">
    `;
    expect(parseOpenGraph(html, 'https://example.com/post')).toEqual({
      title: 'Hello & World',
      description: 'A description',
      image: 'https://example.com/img/card.png',
    });
  });

  it('falls back to twitter tags and <title>', () => {
    const html = `
      <title>Page Title</title>
      <meta name="twitter:description" content="tw desc">
      <meta name="twitter:image" content="https://cdn.example.com/x.jpg">
    `;
    expect(parseOpenGraph(html, 'https://example.com')).toEqual({
      title: 'Page Title',
      description: 'tw desc',
      image: 'https://cdn.example.com/x.jpg',
    });
  });

  it('prefers og over twitter when both are present', () => {
    const html = `
      <meta property="og:title" content="OG Title">
      <meta name="twitter:title" content="TW Title">
    `;
    expect(parseOpenGraph(html, 'https://example.com').title).toBe('OG Title');
  });

  it('decodes numeric character references', () => {
    const html = `<meta property="og:title" content="Tom&#39;s blog">`;
    expect(parseOpenGraph(html, 'https://example.com').title).toBe("Tom's blog");
  });

  it('returns empty strings and no image when nothing is found', () => {
    expect(parseOpenGraph('<html><body>hi</body></html>', 'https://x.com')).toEqual(
      { title: '', description: '', image: undefined },
    );
  });
});

describe('fetchExternalMetadata', () => {
  it('parses metadata from a successful response', async () => {
    const fetchImpl: HttpFetch = async () =>
      htmlResponse('<meta property="og:title" content="Hi">');
    const meta = await fetchExternalMetadata('https://example.com', fetchImpl);
    expect(meta.title).toBe('Hi');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl: HttpFetch = async () =>
      htmlResponse('', { ok: false, status: 404 });
    await expect(
      fetchExternalMetadata('https://example.com/missing', fetchImpl),
    ).rejects.toThrow(/404/);
  });

  it('throws on a network error', async () => {
    const fetchImpl: HttpFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(
      fetchExternalMetadata('https://example.com', fetchImpl),
    ).rejects.toThrow(/Could not fetch/);
  });
});

describe('fetchThumbnail', () => {
  it('returns bytes and mime type from content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl: HttpFetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      arrayBuffer: async () => bytes.buffer,
      headers: {
        get: (name) =>
          name.toLowerCase() === 'content-type' ? 'image/png; charset=binary' : null,
      },
    });
    const result = await fetchThumbnail('https://cdn.example.com/x.png', fetchImpl);
    expect(result.mimeType).toBe('image/png');
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl: HttpFetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: { get: () => null },
    });
    await expect(
      fetchThumbnail('https://cdn.example.com/x.png', fetchImpl),
    ).rejects.toThrow(/500/);
  });
});
