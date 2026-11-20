import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, N } from '../src/core/index.ts';
import { backMatrix, batchAnswersPdf, batchPdf, calibrationPdf, CELLS, PAPERS, puzzlePdf, sheetOrigin } from '../src/web/print.ts';
import type { Labeler, PrintOptions } from '../src/web/print.ts';
import { DEFAULT_INK, sheetInk, stepScene } from '../src/web/render.ts';

const appearance = { ...DEFAULT_INK, sheet: '#d9d23a' };

const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
const close = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);

for (const paper of ['a4', 'letter'] as const) for (const flip of ['long', 'short'] as const) {
  for (const CELL of CELLS) test(`every back cell lies behind its front cell: ${paper}, ${flip} edge, ${CELL} mm`, () => {
    const [W, H] = PAPERS[paper];
    const { x, y } = sheetOrigin(paper, CELL);
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
const options: PrintOptions = { paper: 'a4', flip: 'long', dx: 0.5, dy: -1, solution: true, cell: 16 };

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
  assertWellFormed(await puzzlePdf(p, appearance, options, stub).bytes(), 3);
  assertWellFormed(await puzzlePdf(p, appearance, { ...options, solution: false }, stub).bytes(), 2);
});

test('calibration PDF: two pages', async () => {
  assertWellFormed(await calibrationPdf({ ...options, flip: 'short' }, stub).bytes(), 2);
});

test('single-sided puzzle PDF: front and optional answers with simplex printing', async () => {
  const p = generate(101, 'mid', 0.15, 1, 0, true);
  assert.ok(p);
  const withSolution = await puzzlePdf(p, appearance, options, stub).bytes();
  assertWellFormed(withSolution, 2);
  assert.match(new TextDecoder().decode(withSolution), /\/Duplex \/Simplex\b/);
  assertWellFormed(await puzzlePdf(p, appearance, { ...options, solution: false }, stub).bytes(), 1);
});

test('PDF uses custom inks and neutral patterns follow the original cells', () => {
  const p = generate(101, 'mid', 0, 1, 0, true);
  assert.ok(p);
  const custom = { dark: '#333333', light: '#cccccc', sheet: '#999999', texture: 'checker' } as const;
  const front = puzzlePdf(p, custom, options, stub).pages[0]!;
  assert.ok(front.ops.includes('0.2 0.2 0.2 rg'));
  assert.ok(front.ops.includes('0.8 0.8 0.8 rg'));
  assert.ok(front.ops.includes('0.553 0.553 0.553 rg'));
  assert.equal(sheetInk(p.faces, 1, 0, 0, 'e', custom), '#8d8d8d');
  assert.equal(sheetInk(p.faces, 1, 1, 0, 'e', custom), '#999999');
  const blank = stepScene(p.states[0]!, p.faces, null, custom, 'bottom', 18, 2, 6, true);
  assert.ok(blank.polys.every(poly => poly.fill === '#ffffff'));
});

test('batch PDF fills rows in two columns and solutions use a separate PDF', async () => {
  const p = generate(101, 'mid', 0.15, 1, 0, true);
  assert.ok(p);
  const puzzles = Array.from({ length: 7 }, (_, i) => ({ ...p, seed: p.seed + i }));
  const color = () => appearance;
  const ids = (ops: string[]) => ops.flatMap(op => /\(#(\d+)\) Tj/.exec(op)?.[1] ?? []);
  const positions = (ops: string[]) => ops.flatMap(op => {
    const match = /^1 0 0 1 ([\d.]+) ([\d.]+) cm$/.exec(op);
    return match ? [[Number(match[1]), Number(match[2])]] : [];
  });
  const a4 = batchPdf(puzzles, color, { paper: 'a4', cell: 8 }, stub);
  assert.deepEqual(ids(a4.pages[0]!.ops), ['101', '102', '103', '104', '105', '106']);
  assert.deepEqual(ids(a4.pages[1]!.ops), ['107']);
  const origins = positions(a4.pages[0]!.ops);
  assert.equal(new Set(origins.map(([x]) => x)).size, 2);
  assert.deepEqual(origins.filter((_, i) => i % 2 === 0).map(([, y]) => y), [
    origins[0]![1], origins[0]![1]! + 86, origins[0]![1]! + 172,
  ]);
  assertWellFormed(await a4.bytes(), 2);
  const solutions = batchAnswersPdf(puzzles, color, 'a4', stub);
  assert.deepEqual(solutions.pages.map(page => ids(page.ops)), Array.from({ length: 7 }, () => []));
  assertWellFormed(await solutions.bytes(), 7);
  const letter = batchPdf(puzzles, color, { paper: 'letter', cell: 8 }, stub);
  assert.deepEqual(letter.pages.map(page => ids(page.ops)), [['101', '102', '103', '104'], ['105', '106', '107']]);
});
