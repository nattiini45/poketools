/**
 * Seeded randomness for `seeded_rand(key)`. The result depends only on (seed, scope, key) and is
 * identical in Node and in browsers: a 32-bit string hash (xmur3 style, `Math.imul`) feeds one step
 * of mulberry32. The pinned vectors in rand.test.ts make any change to this file a deliberate break
 * of stored definitions.
 */

/** xmur3-style hash of `text` to an unsigned 32-bit integer. */
function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** One mulberry32 step from `seed`, as a float in [0, 1). */
function mulberryStep(seed: number): number {
  const a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic number in [0, 1) for (seed, scope, key). */
export function seededRand(seed: string, scope: string, key: string): number {
  return mulberryStep(hashString(`${seed}\u0000${scope}\u0000${key}`));
}
