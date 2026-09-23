/**
 * Small, fast, deterministic PRNG (mulberry32). Used for reproducible
 * fixtures, seeds and mock training. Not for anything cryptographic.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic lowercase hex string of `length` characters. */
export function hexFrom(random: () => number, length: number): string {
  let out = "";
  while (out.length < length) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}
