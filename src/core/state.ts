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

/** Copies positions and stacks; layers themselves are immutable and shared. */
export function cloneState(m: State): State {
  const out: State = new Map();
  for (const [k, p] of m) out.set(k, { X: p.X, Y: p.Y, stack: p.stack.slice() });
  return out;
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
export function isSquare(m: State): boolean {
  const b = bbox(m);
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
  const inSet = new Map<number, number>();
  for (const p of m.values()) if (pred(p)) for (const e of p.stack) inSet.set(e.f, -1);
  const comps: Set<number>[] = [];
  for (const f0 of inSet.keys()) {
    if (inSet.get(f0) !== -1) continue;
    const comp = new Set([f0]), todo = [f0];
    inSet.set(f0, comps.length);
    while (todo.length) {
      const f = todo.pop()!;
      for (const [g] of NB[f]!) {
        if (inSet.get(g) === -1) { inSet.set(g, comps.length); comp.add(g); todo.push(g); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/** A set of layers can be lifted off (or pulled from below) if nothing outside it lies above (below) it anywhere. */
export function isSegment(m: State, set: Set<number>, fromTop: boolean): boolean {
  for (const p of m.values()) {
    let inside = false;
    const st = fromTop ? p.stack : p.stack.slice().reverse();
    for (const e of st) {
      if (set.has(e.f)) inside = true;
      else if (inside) return false;
    }
  }
  return true;
}
