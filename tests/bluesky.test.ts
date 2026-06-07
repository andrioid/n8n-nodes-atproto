/**
 * Tests for the Bluesky convenience node.
 *
 * Covers: post-URI parsing, language list normalization,
 * rich-text facet detection round-trip.
 */

import { describe, it, expect } from 'vitest';
import { RichText } from '@atproto/api';

import { parsePostUri } from '../src/nodes/Bluesky/postUri';

describe('parsePostUri', () => {
  it('parses a canonical at:// URI', () => {
    const ref = parsePostUri(
      'at://did:plc:abc123/app.bsky.feed.post/3jzfcijpj2z2a',
    );
    expect(ref).toEqual({
      repo: 'did:plc:abc123',
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
    });
  });

  it('parses a bsky.app URL', () => {
    const ref = parsePostUri(
      'https://bsky.app/profile/alice.bsky.social/post/3jzfcijpj2z2a',
    );
    expect(ref).toEqual({
      repo: 'alice.bsky.social',
      collection: 'app.bsky.feed.post',
      rkey: '3jzfcijpj2z2a',
    });
  });

  it('strips a trailing query string from bsky.app URLs', () => {
    const ref = parsePostUri(
      'https://bsky.app/profile/alice.bsky.social/post/3jzfcijpj2z2a?ref=foo',
    );
    expect(ref.rkey).toBe('3jzfcijpj2z2a');
  });

  it('trims whitespace from input', () => {
    const ref = parsePostUri(
      '   at://did:plc:abc123/app.bsky.feed.post/3jzfcijpj2z2a\n',
    );
    expect(ref.repo).toBe('did:plc:abc123');
  });

  it('throws on garbage input', () => {
    expect(() => parsePostUri('not a uri')).toThrow(/Could not parse/);
  });

  it('throws on a URL pointing to a non-bsky host', () => {
    expect(() =>
      parsePostUri('https://example.com/profile/x/post/y'),
    ).toThrow();
  });
});

describe('rich-text facet detection (without resolution)', () => {
  it('detects mentions, links and tags with correct byte offsets', () => {
    const rt = new RichText({
      text: 'Hello @alice.bsky.social check https://example.com #cool',
    });
    rt.detectFacetsWithoutResolution();

    const features = (rt.facets ?? [])
      .flatMap((f) => f.features.map((feat) => feat.$type))
      .sort();

    expect(features).toEqual([
      'app.bsky.richtext.facet#link',
      'app.bsky.richtext.facet#mention',
      'app.bsky.richtext.facet#tag',
    ]);

    // Verify offsets are byte-based, not character-based — emoji test
    const rt2 = new RichText({
      text: '\uD83D\uDE0E #vibes',  // 😎 is 4 UTF-8 bytes
    });
    rt2.detectFacetsWithoutResolution();
    const tag = rt2.facets?.[0];
    expect(tag?.index.byteStart).toBe(5); // 4 bytes for emoji + 1 space
  });

  it('returns empty facets for plain text', () => {
    const rt = new RichText({ text: 'Just some plain text.' });
    rt.detectFacetsWithoutResolution();
    expect(rt.facets ?? []).toHaveLength(0);
  });
});
