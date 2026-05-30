/**
 * TID (Timestamp Identifier) generation for AT Protocol.
 *
 * A TID is a 13-character base32-sortable string encoding a 64-bit value:
 *   - Top bit: always 0
 *   - Bits 62–10: 53-bit microsecond Unix timestamp
 *   - Bits 9–0: 10-bit random clock ID
 *
 * Characters use the alphabet `234567abcdefghijklmnopqrstuvwxyz`
 * (base32-sortable — no '1' to avoid confusion with 'l').
 */

const S32_CHAR = '234567abcdefghijklmnopqrstuvwxyz';

let clockId: number | null = null;
let counter = 0;
let lastTimestamp = 0;

/**
 * Encodes a non-negative integer to a base32-sortable string.
 * Returns empty string for 0.
 */
function s32encode(i: number): string {
  let s = '';
  while (i) {
    const c = i % 32;
    i = Math.floor(i / 32);
    s = S32_CHAR.charAt(c) + s;
  }
  return s;
}

/**
 * Returns the clock ID (10 bits), initialised once and reused.
 */
function getClockId(): number {
  if (clockId === null) {
    clockId = Math.floor(Math.random() * 1024); // 10 bits: 0–1023
  }
  return clockId;
}

/**
 * Generates a new TID string.
 *
 * The timestamp is derived from `Date.now()` in microseconds, with a
 * per-millisecond counter to guarantee uniqueness within the same ms.
 * The clock ID is a random 10-bit value generated on first call and
 * reused for subsequent TIDs from this process.
 *
 * @returns 13-character base32-sortable TID string.
 */
export function generateTid(): string {
  const now = Math.max(Date.now(), lastTimestamp);

  if (now === lastTimestamp) {
    counter++;
  } else {
    counter = 0;
  }
  lastTimestamp = now;

  // (now in ms) × 1000 + counter gives monotonic microsecond-like values
  const timestamp = now * 1000 + counter;

  // 53 bits needs up to 11 base32 chars
  const tsPart = s32encode(timestamp).padStart(11, S32_CHAR[0]);
  // 10 bits needs exactly 2 base32 chars
  const cidPart = s32encode(getClockId()).padStart(2, S32_CHAR[0]);

  return tsPart + cidPart;
}
