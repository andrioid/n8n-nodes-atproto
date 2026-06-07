/**
 * Tests for parseBlobReference — the permissive input parser used by the
 * Download Blob operation. Accepts bare CIDs, BlobRef JSON, BlobRef objects,
 * and bsky CDN URLs.
 */

import { describe, it, expect } from 'vitest';

import { parseBlobReference } from '../src/nodes/Atproto/blobInput';

const CID = 'bafkreig5w6rxh4mxr5hlqlggbnsj4j4yfk5x5w5ojeyxnvxubrgyhcpkfa';
const DID = 'did:plc:abc123xyz';

describe('parseBlobReference', () => {
  describe('bare CID', () => {
    it('accepts a base32 CID string', () => {
      expect(parseBlobReference(CID)).toEqual({ cid: CID });
    });

    it('trims whitespace', () => {
      expect(parseBlobReference(`  ${CID}\n`)).toEqual({ cid: CID });
    });

    it('rejects empty input', () => {
      expect(() => parseBlobReference('')).toThrow(/empty/i);
      expect(() => parseBlobReference('   ')).toThrow(/empty/i);
    });

    it('rejects clearly bogus strings', () => {
      expect(() => parseBlobReference('not a cid')).toThrow(
        /Unrecognised|valid/i,
      );
      expect(() => parseBlobReference('bafk')).toThrow(/Unrecognised/i);
    });
  });

  describe('blob-ref JSON', () => {
    it('extracts $link from a flat ref', () => {
      const json = `{"$link":"${CID}"}`;
      expect(parseBlobReference(json)).toEqual({ cid: CID });
    });

    it('extracts ref.$link from a nested BlobRef', () => {
      const json = JSON.stringify({
        $type: 'blob',
        ref: { $link: CID },
        mimeType: 'image/jpeg',
        size: 1234,
      });
      expect(parseBlobReference(json)).toEqual({ cid: CID });
    });

    it('throws on JSON without a $link', () => {
      expect(() => parseBlobReference('{"foo":"bar"}')).toThrow(
        /Could not find a CID/,
      );
    });

    it('throws on malformed JSON-looking input', () => {
      expect(() => parseBlobReference('{not valid')).toThrow(
        /Could not find a CID/,
      );
    });
  });

  describe('blob-ref object (non-string input)', () => {
    it('accepts a BlobRef-shaped object directly', () => {
      const obj = {
        $type: 'blob',
        ref: { $link: CID },
        mimeType: 'image/png',
        size: 100,
      };
      expect(parseBlobReference(obj)).toEqual({ cid: CID });
    });

    it('accepts a flat { $link } object', () => {
      expect(parseBlobReference({ $link: CID })).toEqual({ cid: CID });
    });

    it('throws on an object without $link anywhere', () => {
      expect(() => parseBlobReference({ foo: 'bar' })).toThrow(
        /Could not find a CID/,
      );
    });
  });

  describe('bsky CDN URL', () => {
    it('extracts did + cid from a feed_thumbnail URL', () => {
      const url = `https://cdn.bsky.app/img/feed_thumbnail/plain/${DID}/${CID}@jpeg`;
      expect(parseBlobReference(url)).toEqual({ did: DID, cid: CID });
    });

    it('extracts from feed_fullsize without an @ext suffix', () => {
      const url = `https://cdn.bsky.app/img/feed_fullsize/plain/${DID}/${CID}`;
      expect(parseBlobReference(url)).toEqual({ did: DID, cid: CID });
    });

    it('handles a did:web with dots and colons', () => {
      const webDid = 'did:web:example.com';
      const url = `https://cdn.bsky.app/img/avatar/plain/${webDid}/${CID}@jpeg`;
      expect(parseBlobReference(url)).toEqual({ did: webDid, cid: CID });
    });

    it('rejects URLs that are not the bsky CDN shape', () => {
      expect(() =>
        parseBlobReference('https://example.com/blob/abc123'),
      ).toThrow(/not a recognised bsky CDN/i);
    });

    it('rejects malformed URLs', () => {
      expect(() => parseBlobReference('https://')).toThrow(
        /not a valid URL|not a recognised/i,
      );
    });
  });

  describe('input-type guards', () => {
    it('rejects numeric input', () => {
      // @ts-expect-error testing runtime guard
      expect(() => parseBlobReference(42)).toThrow(/must be a string/i);
    });

    it('rejects null', () => {
      expect(() => parseBlobReference(null)).toThrow(/must be a string/i);
    });
  });
});
