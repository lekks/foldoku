import { ap, N, NB } from './geometry.ts';
import type { State } from './types.ts';

interface EdgeData {
  /** Creases per position index: [lower height, upper height]. */
  cre: Map<number, [number, number][]>;
  /** Layers crossing the edge: [position a, height in a, position b, height in b], a < b. */
  thr: [number, number, number, number][];
}

/**
 * Is this a real flat fold? On every edge of the folded pattern: creases on one side must nest, no layer that
 * carries on across the edge may sit inside a crease, and layers that cross the edge keep their order.
 * See docs/algorithm.md §5.
 */
export function isValid(m: State): boolean {
  const where = new Int32Array(N * N * 4 * 2);
  let ki = 0;
  for (const p of m.values()) {
    p.stack.forEach((e, h) => { where[e.f * 2] = ki; where[e.f * 2 + 1] = h; });
    ki++;
  }
  const edges = new Map<number, EdgeData>();
  ki = 0;
  for (const p of m.values()) {
    for (let h = 0; h < p.stack.length; h++) {
      const e = p.stack[h]!;
      for (const [g, mx, my] of NB[e.f]!) {
        if (g < e.f) continue;
        const gk = where[g * 2]!, gh = where[g * 2 + 1]!;
        const [X, Y] = ap(e.t, mx, my);
        const mk = X * 100003 + Y;
        let E = edges.get(mk);
        if (!E) { E = { cre: new Map(), thr: [] }; edges.set(mk, E); }
        if (gk === ki) {
          let list = E.cre.get(ki);
          if (!list) E.cre.set(ki, list = []);
          list.push(h < gh ? [h, gh] : [gh, h]);
        } else E.thr.push(ki < gk ? [ki, h, gk, gh] : [gk, gh, ki, h]);
      }
    }
    ki++;
  }
  for (const E of edges.values()) {
    const thr = E.thr;
    if (thr.length > 1) {
      thr.sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < thr.length; i++) if (thr[i]![3] < thr[i - 1]![3]) return false;
    }
    for (const [k, cr] of E.cre) {
      for (let i = 0; i < cr.length; i++) {
        const [a, b] = cr[i]!;
        for (let j = i + 1; j < cr.length; j++) {
          const [c, d] = cr[j]!;
          if ((a < c && c < b && b < d) || (c < a && a < d && d < b)) return false;
        }
        for (const t of thr) {
          const h = t[0] === k ? t[1] : t[3];
          if (a < h && h < b) return false;
        }
      }
    }
  }
  return true;
}
