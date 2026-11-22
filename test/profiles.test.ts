import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCode, parseCode, profiles, puzzleCode } from '../src/web/profiles.ts';
import { generate } from './wasm-generator.ts';

test('puzzle codes preserve print mode and decoy percentage', () => {
  for (const value of ['D-122', 'D-122-15', '%D-122', '%D-122-15']) {
    const code = parseCode(value);
    assert.ok(code);
    assert.equal(formatCode(code), value);
    const { level, diag, tech } = profiles[code.profile];
    const p = generate(code.seed, level, code.decoyPercent / 100, diag, tech, !code.doubleSided);
    assert.ok(p);
    assert.equal(!!p.singleSided, !code.doubleSided);
    assert.equal(puzzleCode(p), value);
  }
});

test('earlier duplex codes normalize to the percent prefix', () => {
  const code = parseCode('D-122-15-2S');
  assert.ok(code);
  assert.equal(formatCode(code), '%D-122-15');
});
