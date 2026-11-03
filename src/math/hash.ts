/**
 * FNV-1a 32-bit running hash over int32 words — the desync detector (LOG [003]).
 * Feed canonical integer fields in a fixed order; compare across peers.
 */

export const FNV_OFFSET = 0x811c9dc5 | 0;

export function hashInit(): number {
  return FNV_OFFSET;
}

/** Mix one int32 into the hash, byte by byte (canonical little-endian). */
export function hashInt(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
  return h | 0;
}
