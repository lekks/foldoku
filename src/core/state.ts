import { groupFacets } from './connectivity.ts';
import { IDENTITY, LINE, N, NB, QI, QOFF, QS, S, T } from './geometry.ts';
import type { Box, LineType, Position, State } from './types.ts';

/** The flat sheet, front face up. */
export function initState(): State {
  const m: State = new Map();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const q of QS) {
    const X = x * S + QOFF[q][0], Y = y * S + QOFF[q][1];
    m.set(X + ',' + Y, { X, Y, stack: [{ f: (y * N + x) * 4 + QI[q], id: y * N + x, q, up: 0, t: IDENTITY }] });
  }
  return m;
}

export function bbox(m: State): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of m.values()) {
    const cx = Math.floor(p.X / S), cy = Math.floor(p.Y / S);
    if (cx < x0) x0 = cx;
    if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy;
    if (cy > y1) y1 = cy;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The paper covers exactly a T×T square. */
export function isSquare(m: State, b = bbox(m)): boolean {
  return m.size === T * T * 4 && b.w === T && b.h === T;
}

/** Lines of a type that actually cut the current shape. */
export function candidates(m: State, t: LineType): number[] {
  let lo = Infinity, hi = -Infinity;
  for (const p of m.values()) {
    const v = LINE[t](p.X, p.Y);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const cs: number[] = [];
  for (let c = Math.ceil(lo / S); c * S < hi; c++) if (c * S > lo) cs.push(c);
  return cs;
}

/** Pieces of paper among the positions matching pred that stay connected without leaving them. */
export function components(m: State, pred: (p: Position) => boolean): Set<number>[] {
  const order = new Uint16Array(NB.length);
  let count = 0;
  for (const p of m.values()) if (pred(p)) for (const e of p.stack) order[count++] = e.f;
  const grouped = groupFacets(order, count);
  const comps: Set<number>[] = [];
  for (let i = 0; i < count; i++) {
    const facet = grouped[i]!;
    if (facet < 0) comps.push(new Set([~facet]));
    else comps[comps.length - 1]!.add(facet);
  }
  return comps;
}

/** A set of layers can be lifted off (or pulled from below) if nothing outside it lies above (below) it anywhere. */
export function isSegment(m: State, set: Set<number>, fromTop: boolean): boolean {
  for (const p of m.values()) {
    let inside = false;
    const { stack } = p;
    for (let i = 0; i < stack.length; i++) {
      const layer = stack[fromTop ? i : stack.length - 1 - i]!;
      if (set.has(layer.f)) inside = true;
      else if (inside) return false;
    }
  }
  return true;
}
