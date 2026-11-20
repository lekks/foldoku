import { ap, compose, LINE, mirror, S } from './geometry.ts';
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
  const out: State = new Map();
  const lifted: { X: number; Y: number; layers: Layer[] }[] = [];
  for (const [key, { X, Y, stack }] of m) {
    if (!onSide(f, X, Y)) {
      out.set(key, { X, Y, stack: stack.slice() });
      continue;
    }
    const moving: Layer[] = [], staying: Layer[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const layer = stack[i]!;
      if (f.kind === 'full' || f.flap.has(layer.f)) moving.push(flipLayer(layer, r));
      else staying.push(layer);
    }
    if (!moving.length || staying.length) out.set(key, { X, Y, stack: staying.reverse() });
    if (moving.length) lifted.push({ X, Y, layers: moving });
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
    else for (const layer of L.layers) dst.stack.push(layer);
    out.set(key, dst);
  }
  return out;
}

/** Which positions of a step's diagram show something that moves. */
export function movesAt(f: Move, p: Position): boolean {
  if (!onSide(f, p.X, p.Y)) return false;
  return f.kind === 'full' || p.stack.some(e => f.flap.has(e.f));
}
