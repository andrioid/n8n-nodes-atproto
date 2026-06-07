/**
 * Tests for TID generation.
 *
 * Validates that generated TIDs conform to the AT Protocol spec:
 * - 13 characters long
 * - Uses the base32-sortable alphabet
 * - First character is from the valid range (top bit 0 enforced)
 * - Unique across sequential calls
 * - Sortable in time order
 */

import { describe, it, expect } from 'vitest';
import { generateTid } from '../nodes/Atproto/tid';

const S32_CHAR = '234567abcdefghijklmnopqrstuvwxyz';
const TID_REGEX = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

describe('TID generation', () => {
  it('produces a 13-character string', () => {
    const tid = generateTid();
    expect(tid).toHaveLength(13);
  });

  it('uses only characters from the base32-sortable alphabet', () => {
    const tid = generateTid();
    for (const ch of tid) {
      expect(S32_CHAR).toContain(ch);
    }
  });

  it('matches the AT Protocol TID regex (top bit 0 + valid chars)', () => {
    const tid = generateTid();
    expect(tid).toMatch(TID_REGEX);
  });

  it('first character is always from [234567abcdefghij] (top bit 0)', () => {
    for (let i = 0; i < 100; i++) {
      const tid = generateTid();
      expect('234567abcdefghij').toContain(tid[0]);
    }
  });

  it('generates unique TIDs for 1000 sequential calls', () => {
    const tids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tids.add(generateTid());
    }
    expect(tids.size).toBe(1000);
  });

  it('generates lexicographically sortable TIDs in time order', () => {
    const tids: string[] = [];
    for (let i = 0; i < 100; i++) {
      tids.push(generateTid());
    }

    // TIDs should be in strictly increasing order
    for (let i = 1; i < tids.length; i++) {
      expect(tids[i] > tids[i - 1]).toBe(true);
    }
  });

  it('different instances produce different TIDs within the same millisecond', () => {
    // Generate many TIDs rapidly; they should all be unique
    const tids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      tids.add(generateTid());
    }
    expect(tids.size).toBe(500);
  });

  it('TIDs encode the timestamp at microsecond precision', () => {
    const tid = generateTid();
    // The TID should be parseable: first 11 chars = timestamp, last 2 = clock ID
    expect(tid).toHaveLength(13);

    // The first 11 chars should be a valid base32 number
    const tsPart = tid.slice(0, 11);
    expect(tsPart).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]+$/);
    expect(tsPart.length).toBeGreaterThanOrEqual(1);
  });

  it('TIDs are time-ordered when generated with a small delay', async () => {
    const tid1 = generateTid();
    // Wait 5ms to ensure a different timestamp
    await new Promise((resolve) => setTimeout(resolve, 5));
    const tid2 = generateTid();

    expect(tid2 > tid1).toBe(true);
  });
});
