import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, verify } from '../src/core/index.ts';
import { canonical, caseName, sampleCases } from './helpers.ts';

for (const c of sampleCases()) {
  test(`solvable and well-formed: ${caseName(c)}`, () => {
    const p = generate(c.seed, c.level, c.decoy, c.diag, c.tech);
    assert.ok(p, 'generator gave up');
    assert.equal(verify(p), true);
    assert.equal(p.folds.filter(f => f.t === 'd' || f.t === 'a').length, c.diag);
    if (c.tech >= 1) assert.ok(p.folds.some(f => f.kind !== 'full'), 'expected a flap or a tuck');
    if (c.tech >= 2) assert.ok(p.folds.some(f => f.kind === 'tuck'), 'expected a tuck');

    // The square's two faces take exactly 4×4 cells, i.e. 64 quarters, of each colour; decoys add whole or half faces on top.
    const quarters = (col: 'B' | 'W') => p.faces.reduce((a, f) => a + f.reduce((t, face) => t + Object.values(face).filter(v => v === col).length, 0), 0);
    assert.ok(quarters('B') >= 64 && quarters('W') >= 64);
  });
}

test('the same input gives the same puzzle', () => {
  const a = generate(42, 'mid', 0.2, 1, 1), b = generate(42, 'mid', 0.2, 1, 1);
  assert.ok(a && b);
  assert.equal(canonical(a), canonical(b));
});

test('decoys change the print but not the solution', () => {
  const a = generate(42, 'mid', 0, 1, 1), b = generate(42, 'mid', 0.4, 1, 1);
  assert.ok(a && b);
  assert.deepEqual(a.folds.map(f => [f.t, f.c, f.side, f.dir, f.kind]), b.folds.map(f => [f.t, f.c, f.side, f.dir, f.kind]));
  assert.ok(b.decoys > a.decoys);
});

test('single-sided puzzles use the front for both colors and all decoys', () => {
  const clean = generate(101, 'mid', 0, 1, 0, true);
  const p = generate(101, 'mid', 0.5, 1, 0, true);
  assert.ok(clean && p?.singleSided);
  assert.equal(verify(p), true);
  assert.deepEqual(p.folds, clean.folds);
  assert.ok(p.decoys > 0);
  assert.ok(p.faces.every(([, back]) => Object.values(back).every(color => color === 'N')));
  p.faces[0]![1].n = 'B';
  assert.equal(verify(p), false);
});
