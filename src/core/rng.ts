/** Seeded random source returning floats in [0, 1). */
export type Rng = () => number;

/** mulberry32: small, fast and deterministic across JS engines. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(R: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** A uniformly chosen element; the array must not be empty. */
export function pick<T>(R: Rng, arr: readonly T[]): T {
  return arr[Math.floor(R() * arr.length)]!;
}
