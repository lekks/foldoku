import { ap, compose, LINE, mirror, S } from './geometry.ts';
import { cloneState } from './state.ts';
import type { Affine, Layer, Move, Position, State } from './types.ts';

/** Is the position on the side of the line that moves? */
export const onSide = (f: Pick<Move, 't' | 'c' | 'side'>, X: number, Y: number): boolean =>
  Math.sign(LINE[f.t](X, Y) - f.c * S) === f.side;

const flipLayer = (e: Layer, r: Affine): Layer => ({ f: e.f, id: e.id, q: e.q, up: e.up === 0 ? 1 : 0, t: compose(r, e.t) });

/**
 * Applies one move. 'full' folds the whole stack on the moving side; 'flap' folds only the layers in
 * f.flap (a top or bottom segment there); 'tuck' folds them and slides them in between layers at f.depth.
 * The moving layers flip and their order reverses.
 */
export function applyFold(m: State, f: Move): State {
  const r = mirror(f.t, f.c);
  const out = cloneState(m);
  const lifted: { X: number; Y: number; layers: Layer[] }[] = [];
  for (const [key, p] of out) {
    if (!onSide(f, p.X, p.Y)) continue;
    const go = f.kind === 'full' ? p.stack : p.stack.filter(e => f.flap.has(e.f));
    if (!go.length) continue;
    p.stack = f.kind === 'full' ? [] : p.stack.filter(e => !f.flap.has(e.f));
    if (!p.stack.length) out.delete(key);
    lifted.push({ X: p.X, Y: p.Y, layers: go.slice().reverse().map(e => flipLayer(e, r)) });
  }
  for (const L of lifted) {
    const [X, Y] = ap(r, L.X, L.Y);
    const key = X + ',' + Y;
    const dst: Position = out.get(key) ?? { X, Y, stack: [] };
    if (f.kind === 'tuck') {
      // Slide in under the top `depth` layers (from above) or over the bottom ones (from below).
      const n = dst.stack.length;
      const at = f.dir === 'over' ? Math.max(0, n - f.depth) : Math.min(n, f.depth);
      dst.stack = dst.stack.slice(0, at).concat(L.layers, dst.stack.slice(at));
    } else if (f.dir === 'under') dst.stack = L.layers.concat(dst.stack);
    else dst.stack = dst.stack.concat(L.layers);
    out.set(key, dst);
  }
  return out;
}

/** Which positions of a step's diagram show something that moves. */
export function movesAt(f: Move, p: Position): boolean {
  if (!onSide(f, p.X, p.Y)) return false;
  return f.kind === 'full' || p.stack.some(e => f.flap.has(e.f));
}
