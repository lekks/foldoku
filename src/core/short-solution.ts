import { applyFold } from './fold.ts';
import { T } from './geometry.ts';
import { bbox, candidates, initState } from './state.ts';
import type { CellPaint, State } from './types.ts';

// Each pair identifies the original printed quarter and side visible above and below.
function enumerate(): Uint16Array[] {
  const patterns = new Map<string, Uint16Array>();
  function visit(state: State, remaining: number) {
    const box = bbox(state);
    if (box.w === T && box.h === T) {
      const pattern = [];
      for (const { stack } of state.values()) {
        const top = stack[stack.length - 1]!, bottom = stack[0]!;
        pattern.push(2 * top.f + top.up, 2 * bottom.f + 1 - bottom.up);
      }
      patterns.set(pattern.join(','), Uint16Array.from(pattern));
      return;
    }
    for (const t of ['v', 'h'] as const) {
      const vertical = t === 'v';
      const start = vertical ? box.x0 : box.y0;
      const size = vertical ? box.w : box.h;
      const other = vertical ? box.h : box.w;
      for (const c of candidates(state, t)) {
        const width = Math.max(c - start, size - (c - start));
        // A straight fold changes only one dimension, and both must reach T.
        if (width < T || Number(width > T) + Number(other > T) >= remaining) continue;
        for (const side of [1, -1] as const) for (const dir of ['over', 'under'] as const) {
          visit(applyFold(state, { kind: 'full', t, c, side, dir, box }), remaining - 1);
        }
      }
    }
  }
  visit(initState(), 3);
  return [...patterns.values()];
}

let patterns: Uint16Array[] | undefined;

export function hasShortSolution(faces: CellPaint[]): boolean {
  patterns ??= enumerate();
  const colors = faces.flatMap(cell => (['n', 'e', 's', 'w'] as const).flatMap(q => [cell[0][q], cell[1][q]]));
  return patterns.some(pattern => {
    const top = colors[pattern[0]!]!, bottom = colors[pattern[1]!]!;
    return top !== 'N' && bottom !== 'N' && top !== bottom &&
      pattern.every((index, i) => colors[index] === (i % 2 ? bottom : top));
  });
}

// Grid-line folds keep every printed cell intact, including flap folds and tucks.
// Each solid side would therefore need T*T whole cell faces of its colour.
export function requiresDiagonal(faces: CellPaint[]): boolean {
  let black = 0, white = 0;
  for (const cell of faces) for (const { n, e, s, w } of cell) {
    if (n !== e || n !== s || n !== w) continue;
    if (n === 'B') black++;
    if (n === 'W') white++;
  }
  return black < T * T || white < T * T;
}
