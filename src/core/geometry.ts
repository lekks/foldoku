import type { Affine, LineType, Quarter } from './types.ts';

/** Sheet size and target size, in cells. */
export const N = 8, T = 4;
/**
 * Lattice units per cell. Every cell is cut by both diagonals into four quarters (n, e, s, w): these
 * triangles are the facets of the sheet. Positions are addressed by a facet's centroid on this lattice, so
 * folds along grid lines and 45° lines map centroids to centroids and edge midpoints to edge midpoints.
 */
export const S = 12;

export const QS: readonly Quarter[] = ['n', 'e', 's', 'w'];
export const QI: Readonly<Record<Quarter, number>> = { n: 0, e: 1, s: 2, w: 3 };
/** Centroid of each quarter inside its cell. */
export const QOFF: Readonly<Record<Quarter, readonly [number, number]>> = { n: [6, 2], e: [10, 6], s: [6, 10], w: [2, 6] };

export function decode(X: number, Y: number): { cx: number; cy: number; q: Quarter } {
  const cx = Math.floor(X / S), cy = Math.floor(Y / S);
  const rx = X - cx * S, ry = Y - cy * S;
  return { cx, cy, q: ry === 2 ? 'n' : ry === 10 ? 's' : rx === 2 ? 'w' : 'e' };
}

/**
 * NB[f] lists [neighbour facet, midpoint x, midpoint y] for every facet sharing an edge with facet f in the
 * flat sheet, midpoints in sheet coordinates. This is the only record of how the paper is connected.
 */
export const NB: readonly (readonly (readonly [number, number, number])[])[] = (() => {
  const nb: [number, number, number][][] = [];
  const inner: Record<Quarter, Partial<Record<Quarter, [number, number]>>> = {
    n: { e: [9, 3], w: [3, 3] }, e: { n: [9, 3], s: [9, 9] }, s: { e: [9, 9], w: [3, 9] }, w: { n: [3, 3], s: [3, 9] },
  };
  const outer: Record<Quarter, [number, number, Quarter, number, number]> = {
    n: [0, -1, 's', 6, 0], e: [1, 0, 'w', 12, 6], s: [0, 1, 'n', 6, 12], w: [-1, 0, 'e', 0, 6],
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const q of QS) {
    const list: [number, number, number][] = [];
    for (const [r, mid] of Object.entries(inner[q]) as [Quarter, [number, number]][]) {
      list.push([(y * N + x) * 4 + QI[r], x * S + mid[0], y * S + mid[1]]);
    }
    const [dx, dy, r, mx, my] = outer[q];
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < N && ny < N) list.push([(ny * N + nx) * 4 + QI[r], x * S + mx, y * S + my]);
    nb[(y * N + x) * 4 + QI[q]] = list;
  }
  return nb;
})();

/** The signed quantity each line type compares with c·S. */
export const LINE: Readonly<Record<LineType, (X: number, Y: number) => number>> = {
  v: (X) => X, h: (_X, Y) => Y, d: (X, Y) => X - Y, a: (X, Y) => X + Y,
};

/** Reflection across the line of type t at c. */
export function mirror(t: LineType, c: number): Affine {
  const k = c * S;
  if (t === 'v') return [-1, 0, 0, 1, 2 * k, 0];
  if (t === 'h') return [1, 0, 0, -1, 0, 2 * k];
  if (t === 'd') return [0, 1, 1, 0, k, -k];
  return [0, -1, -1, 0, k, k];
}

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const ap = (t: Affine, x: number, y: number): [number, number] =>
  [t[0] * x + t[1] * y + t[4], t[2] * x + t[3] * y + t[5]];

/** r ∘ t: first t, then r. */
export const compose = (r: Affine, t: Affine): Affine => [
  r[0] * t[0] + r[1] * t[2], r[0] * t[1] + r[1] * t[3], r[2] * t[0] + r[3] * t[2], r[2] * t[1] + r[3] * t[3],
  r[0] * t[4] + r[1] * t[5] + r[4], r[2] * t[4] + r[3] * t[5] + r[5],
];

export const isDiagonal = (t: LineType): boolean => t === 'd' || t === 'a';
