import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFold, bbox, initState, isValid, S } from '../src/core/index.ts';
import type { FullMove, State, TuckMove } from '../src/core/index.ts';

const full = (m: State, t: FullMove['t'], c: number, side: 1 | -1, dir: 'over' | 'under' = 'over'): State =>
  applyFold(m, { kind: 'full', t, c, side, dir, box: bbox(m) });

const facetsWhere = (m: State, pred: (X: number) => boolean): Set<number> => {
  const out = new Set<number>();
  for (const p of m.values()) if (pred(p.X)) for (const e of p.stack) out.add(e.f);
  return out;
};

test('the flat sheet is a valid flat fold', () => {
  assert.equal(isValid(initState()), true);
});

test('any sequence of full folds stays valid', () => {
  let m = initState();
  for (const [t, c, side] of [['v', 4, 1], ['h', 2, -1], ['d', 2, 1], ['v', 3, -1], ['a', 8, 1]] as const) {
    m = full(m, t, c, side);
    assert.equal(isValid(m), true, `after ${t}=${c}`);
  }
});

test('reordering the layers of one stack breaks the fold', () => {
  const m = full(full(initState(), 'v', 4, 1), 'h', 4, 1);
  const p = [...m.values()].find(q => q.stack.length === 4)!;
  p.stack = [p.stack[1]!, p.stack[0]!, p.stack[2]!, p.stack[3]!];
  assert.equal(isValid(m), false);
});

test('a folded half cannot be tucked between its own two layers', () => {
  const m = full(initState(), 'v', 4, -1);
  const all = facetsWhere(m, () => true);
  const tuck: TuckMove = { kind: 'tuck', t: 'v', c: 6, side: 1, dir: 'over', box: bbox(m), flap: all, partial: false, depth: 1 };
  assert.equal(isValid(applyFold(m, tuck)), false);
});

test('a flap wider than its pocket cannot be tucked in', () => {
  // Fold 6 columns over: the 2-column pocket on the right is closed by the crease at x = 6,
  // so tucking the 4-column overhang into it would push paper through that crease.
  const m = full(initState(), 'v', 6, -1);
  const overhang = facetsWhere(m, X => X > 8 * S);
  const tuck: TuckMove = { kind: 'tuck', t: 'v', c: 8, side: 1, dir: 'over', box: bbox(m), flap: overhang, partial: false, depth: 1 };
  assert.equal(isValid(applyFold(m, tuck)), false);
});
