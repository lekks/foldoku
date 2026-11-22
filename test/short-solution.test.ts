import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, verify } from '../src/core/generate.ts';
import { hasShortSolution } from '../src/core/short-solution.ts';

test('a three-fold print is recognized and a hard print passes the shortcut filter', () => {
  const easy = generate(7, 'easy');
  assert.ok(easy && easy.folds.length === 3 && verify(easy));
  assert.ok(hasShortSolution(easy.faces));
  const hard = generate(7, 'hard');
  assert.ok(hard && verify(hard));
  assert.equal(hasShortSolution(hard.faces), false);
});
