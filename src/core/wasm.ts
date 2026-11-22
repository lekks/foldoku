import { hasShortSolution } from './short-solution.ts';
// All search and painting run inside WASM. This adapter reads the accepted puzzle.
import { NB, QS } from './geometry.ts';
import type { Affine, CellPaint, Level, Move, Paint, Puzzle, Side, Solid, State, Tech } from './types.ts';

import { foldRange } from './difficulty.ts';
const LINES = ['v', 'h', 'd', 'a'] as const;
const PAINT = ['N', 'B', 'W'] as const satisfies readonly Paint[];

interface Kernel {
  memory: WebAssembly.Memory;
  set_neighbor(facet: number, edge: number, neighbor: number, x: number, y: number): void;
  generate_puzzle(seed: number, lo: number, hi: number, decoy: number, diag: number, tech: number, single: number): number;
}

export function createGenerator(module: WebAssembly.Module) {
  if (NB.length !== 256) throw new Error('The WASM generator requires 256 facets');
  const kernel = new WebAssembly.Instance(module).exports as unknown as Kernel;
  NB.forEach((neighbors, facet) => {
    for (let edge = 0; edge < 3; edge++) {
      const [neighbor, x, y] = neighbors[edge] ?? [-1, 0, 0];
      kernel.set_neighbor(facet, edge, neighbor, x, y);
    }
  });
  return (seed: number, level: Level = 'mid', decoy = 0, diag = 0, tech: Tech = 0, singleSided = false): Puzzle | null => {
    const [lo, hi] = foldRange(level, diag, tech, singleSided);
    for (let retry = 0; retry < 32; retry++) {
      const ptr = kernel.generate_puzzle(seed + retry * 104729, lo, hi, decoy, diag, tech, +singleSided);
      if (!ptr) {
        if (level === 'hard' || diag > 0) continue;
        return null;
      }
      const data = new Int32Array(kernel.memory.buffer, ptr);
      let offset = 0;
      const take = () => data[offset++]!;
      const foldCount = take(), topColor = PAINT[take()] as Solid, decoys = take(), stars = take();
      const faces: CellPaint[] = [];
      const face = () => ({ n: PAINT[take()]!, e: PAINT[take()]!, s: PAINT[take()]!, w: PAINT[take()]! });
      for (let i = 0; i < NB.length / 4; i++) faces.push([face(), face()]);
      if (level === 'hard' && hasShortSolution(faces)) continue;
      const folds: Move[] = [];
      for (let i = 0; i < foldCount; i++) {
        const kind = take(), t = LINES[take()]!, c = take(), side = take() as Side;
        const dir = take() ? 'over' as const : 'under' as const;
        const partial = !!take(), depth = take();
        const x0 = take(), y0 = take(), x1 = take(), y1 = take();
        const move = { t, c, side, dir, box: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
        const size = take();
        if (kind === 0) {
          folds.push({ ...move, kind: 'full' });
        } else {
          const flap = new Set<number>();
          for (let f = 0; f < size; f++) flap.add(take());
          folds.push(kind === 1 ? { ...move, kind: 'flap', flap, partial: true }
            : { ...move, kind: 'tuck', flap, partial, depth });
        }
      }
      const states: State[] = [];
      for (let i = 0; i <= foldCount; i++) {
        const n = take(), state: State = new Map();
        for (let j = 0; j < n; j++) {
          const X = take(), Y = take(), size = take();
          const stack = [];
          for (let h = 0; h < size; h++) {
            const f = take(), up = take() as 0 | 1;
            const t: Affine = [take(), take(), take(), take(), take(), take()];
            stack.push({ f, id: f >>> 2, q: QS[f % 4]!, up, t });
          }
          state.set(`${X},${Y}`, { X, Y, stack });
        }
        states.push(state);
      }
      return { seed, level, decoy, diag, tech, ...(singleSided ? { singleSided } : {}), folds, states, faces, topColor, decoys, stars };
    }
    return null;
  };
}
