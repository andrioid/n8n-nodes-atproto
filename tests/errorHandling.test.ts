/**
 * Behaviour tests for user-facing error messages.
 *
 * The message must name *which* PDS failed — reads route to the target
 * repo's PDS, so a rate limit may come from a server other than the user's
 * own. Rate-limit timing is read from the standard atproto headers.
 */

import { describe, it, expect } from 'vitest';
import { friendlyError } from '../nodes/Atproto/Atproto.node';
function xrpcLikeError(
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(message), extra);
}

describe('friendlyError', () => {
  it('names the PDS host and computes the reset on a rate limit', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 42;
    const msg = friendlyError(
      xrpcLikeError('Rate Limit Exceeded', {
        status: 429,
        headers: { 'ratelimit-reset': String(resetEpoch) },
        pdsHost: 'auriporia.us-west.host.bsky.network',
      }),
    );

    expect(msg).toContain(
      'Rate limited by auriporia.us-west.host.bsky.network',
    );
    expect(msg).toMatch(/retry after (41|42)s/);
    expect(msg).toContain('resets at');
  });

  it('falls back to retry-after when no reset header is present', () => {
    const msg = friendlyError(
      xrpcLikeError('Rate Limit Exceeded', {
        status: 429,
        headers: { 'retry-after': '30' },
        pdsHost: 'pds.example',
      }),
    );

    expect(msg).toContain('Rate limited by pds.example — retry after 30s');
  });

  it('reports a rate limit without timing when headers are missing', () => {
    const msg = friendlyError(
      xrpcLikeError('Rate Limit Exceeded', { status: 429 }),
    );
    expect(msg).toBe('Rate limited — try again later');
  });

  it('names the host that could not be reached', () => {
    const msg = friendlyError(
      xrpcLikeError('fetch failed', { pdsHost: 'pds.example' }),
    );
    expect(msg).toBe('Could not reach pds.example');
  });

  it('appends the host to otherwise-unmapped errors', () => {
    const msg = friendlyError(
      xrpcLikeError('Could not find repo: did:plc:abc', {
        status: 400,
        pdsHost: 'shard.host.example',
      }),
    );
    expect(msg).toBe(
      'Could not find repo: did:plc:abc (via shard.host.example)',
    );
  });
});
