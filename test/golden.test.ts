// Golden snapshots: a fixed set of inputs must keep producing exactly the same puzzles.
// A failure means the generator's output changed. If that was intended, bump the generator's major
// version (docs/roadmap.md §1.4) and refresh with `npm run test:update-golden`.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { caseName, digest, sampleCases } from './helpers.ts';
import { generate } from './wasm-generator.ts';

const file = new URL('./golden.json', import.meta.url);
const update = process.env['UPDATE_GOLDEN'] === '1';
const golden: Record<string, string> = update ? {} : JSON.parse(readFileSync(file, 'utf8'));

for (const c of sampleCases()) {
  const name = caseName(c);
  test(`golden: ${name}`, () => {
    const p = generate(c.seed, c.level, c.decoy, c.diag, c.tech, c.singleSided);
    assert.ok(p);
    if (update) golden[name] = digest(p);
    else assert.equal(digest(p), golden[name], 'output changed for this input');
  });
}

if (update) {
  test('write golden.json', () => { writeFileSync(file, JSON.stringify(golden, null, 2) + '\n'); });
}
