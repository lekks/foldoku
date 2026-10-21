import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, N } from '../src/core/index.ts';
import { backMatrix, calibrationPdf, CELL, PAPERS, puzzlePdf, sheetOrigin } from '../src/web/print.ts';
import type { Labeler, PrintOptions } from '../src/web/print.ts';

const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
const close = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

for (const paper of ['a4', 'letter'] as const) for (const flip of ['long', 'short'] as const) {
  test(`every back cell lies behind its front cell: ${paper}, ${flip} edge`, () => {
    const [W, H] = PAPERS[paper];
    const { x, y } = sheetOrigin(paper);
    const m = backMatrix({ paper, flip, dx: 0, dy: 0 });
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const fx = x + (cx + 0.5) * CELL, fy = y + (cy + 0.5) * CELL;
      // The back draws the cell in column N−1−cx of its frame.
      const page = apply(m, x + (N - 1 - cx + 0.5) * CELL, fy);
      // Where the printer puts what lies behind (fx, fy) when the paper turns over the given edge.
      const behind = flip === 'long' ? [W - fx, fy] : [fx, H - fy];
      assert.ok(close(page, behind), `cell ${cx},${cy}: ${page} vs ${behind}`);
    }
  });

  test(`the offset moves the back right and down as seen on the back: ${paper}, ${flip} edge`, () => {
    const o = { paper, flip, dx: 1.5, dy: -0.5 };
    const at = (dx: number, dy: number) => apply(backMatrix({ ...o, dx: 0, dy: 0 }), 40 + dx, 60 + dy);
    assert.ok(close(apply(backMatrix(o), 40, 60), at(1.5, -0.5)));
  });
}

const stub: Labeler = (text, size) => ({ image: { w: 2, h: 1, channels: 1, data: new Uint8Array([0, 255]) }, w: text.length * size * 0.5, h: size * 1.3 });
const options: PrintOptions = { paper: 'a4', flip: 'long', dx: 0.5, dy: -1, solution: true };

/** Checks the cross-reference table: every entry must point at its object. */
function assertWellFormed(pdf: Uint8Array, pages: number): void {
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.7'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)\n/.exec(text)![1]);
  assert.ok(text.startsWith('xref', start));
  const rows = text.slice(start).split('\n');
  const count = Number(rows[1]!.split(' ')[1]);
  for (let i = 1; i < count; i++) {
    const off = Number(rows[2 + i]!.slice(0, 10));
    assert.ok(text.startsWith(`${i} 0 obj`, off), `object ${i} is not at ${off}`);
  }
  assert.equal((text.match(/\/Type \/Page /g) ?? []).length, pages);
}

test('puzzle PDF: front, back and answers', async () => {
  const p = generate(101, 'hard', 0.2, 2, 2) ?? generate(101, 'mid', 0.2, 1, 2);
  assert.ok(p);
  assertWellFormed(await puzzlePdf(p, '#d9d23a', options, stub).bytes(), 3);
  assertWellFormed(await puzzlePdf(p, '#d9d23a', { ...options, solution: false }, stub).bytes(), 2);
});

test('calibration PDF: two pages', async () => {
  assertWellFormed(await calibrationPdf({ ...options, flip: 'short' }, stub).bytes(), 2);
});
