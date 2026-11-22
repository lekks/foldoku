import type { Language } from '../core/language.ts';
import { messages, formatNumber } from './i18n.ts';
// Print layouts: the puzzle sheet on two pages (front, back) that line up when printed on both sides of one
// sheet of paper, an optional answer page, and a calibration sheet that measures the printer's duplex offset.
// Pure: Russian text arrives as images from a Labeler, so the layouts also run in Node.
// See docs/printing.md.

import { bbox, describe, N } from '../core/index.ts';
import type { Puzzle } from '../core/index.ts';
import { puzzleCode } from './profiles.ts';
import { PdfDoc } from './pdf.ts';
import type { PdfImage, PdfPage } from './pdf.ts';
import { DASH, FADED, FOLD_INK, mix, numberCell, sheetInk, sheetScene, stepScene } from './render.ts';
import type { Appearance, Scene } from './render.ts';

export type PaperSize = 'a4' | 'letter';
export type Flip = 'long' | 'short';
export const PAPERS: Readonly<Record<PaperSize, readonly [number, number]>> = { a4: [210, 297], letter: [215.9, 279.4] };

export interface PrintOptions {
  paper: PaperSize;
  /** Which edge the printer turns the paper over for the back. */
  flip: Flip;
  /** Shift of the back page in mm, right and down as seen on the back; measured with the calibration sheet. */
  dx: number;
  dy: number;
  /** Add the answer page. */
  solution: boolean;
  /** Cell size in mm; the folded square is four cells wide. */
  cell: number;
}

/** Cell sizes offered, in mm: the folded square is 48–88 mm wide. Larger cells fold more easily. */
export const CELLS: readonly number[] = [12, 14, 16, 18, 20, 22];
export const DEFAULT_CELL = 16;
export const BATCH_CELLS = [8, 9, 10] as const;
/** Colour runs this far past the cut line, so a slightly shifted back still reaches the edge. */
export const BLEED = 2.5;
const MARGIN = 14;
const CROP_GAP = BLEED + 1.5;
const CROP_LEN = 6;
const CROP_EXTENT = CROP_GAP + CROP_LEN;

/** Russian text as an image; `size` is the font size in mm, lines wrap at `maxWidth` mm. */
export interface Label { image: PdfImage; w: number; h: number }
export type Labeler = (text: string, size: number, maxWidth: number, bold?: boolean) => Label;

/** Top-left corner of the sheet on the page: centred, so mirroring the page keeps it in place. */
export function sheetOrigin(paper: PaperSize, cell: number): { x: number; y: number } {
  const [W, H] = PAPERS[paper];
  return { x: (W - N * cell) / 2, y: (H - N * cell) / 2 };
}

/**
 * The back page is drawn in the "back frame": the front page mirrored left to right, which is what lies
 * behind it when the paper turns over its long edge. This maps the back frame to the page:
 * first the calibration offset, then a half turn if the paper turns over its short edge.
 */
export function backMatrix(o: Pick<PrintOptions, 'paper' | 'flip' | 'dx' | 'dy'>): [number, number, number, number, number, number] {
  const [W, H] = PAPERS[o.paper];
  return o.flip === 'long' ? [1, 0, 0, 1, o.dx, o.dy] : [-1, 0, 0, -1, W - o.dx, H - o.dy];
}

/** `backdrop` fills the scene's box first: white paper on white paper needs it to show. */
function drawScene(pg: PdfPage, sc: Scene, x: number, y: number, cellLines: boolean, backdrop = ''): void {
  pg.save().transform([1, 0, 0, 1, x, y]);
  if (backdrop) pg.fill(backdrop).rect(0, 0, sc.w, sc.h);
  for (const p of sc.polys) {
    // Faded parts are mixed into the ground rather than drawn translucent, which would show the seams.
    const fill = p.faded ? mix(p.fill, backdrop || '#ffffff', 1 - FADED) : p.fill;
    // Stroking in the fill colour hides hairline seams between quarters.
    pg.fill(fill).stroke(fill, sc.cs / 60).poly(p.pts, 'B');
  }
  if (cellLines && sc.cells.length) {
    pg.save().alpha(0.18).stroke('#000000', sc.cs / 110);
    for (const c of sc.cells) pg.rect(c.x, c.y, sc.cs, sc.cs, 'S');
    pg.restore();
  }
  if (sc.number) {
    pg.save().alpha(0.55).fill('#000000').text(sc.number.text, sc.number.x, sc.number.y + sc.cs * 0.12, sc.cs * Math.min(0.3, 1.45 / sc.number.text.length), 'center').restore();
  }
  if (sc.fold) {
    const { x1, y1, x2, y2, dir } = sc.fold;
    pg.save().stroke(FOLD_INK, sc.cs * 0.14, DASH[dir].map(d => d * sc.cs), 1).line(x1, y1, x2, y2).restore();
  }
  pg.restore();
}

/** One side of the sheet with colour bled past its edges, drawn with its top-left corner at (x, y). */
function drawSheet(pg: PdfPage, p: Puzzle, side: 0 | 1, appearance: Appearance, x: number, y: number, CELL: number): void {
  const SIZE = N * CELL;
  const ink = (cx: number, cy: number, q: 'n' | 'e' | 's' | 'w') => sheetInk(p.faces, side, cx, cy, q, appearance);
  const b = BLEED, L = N - 1;
  for (let i = 0; i < N; i++) {
    const at = x + i * CELL, down = y + i * CELL;
    pg.fill(ink(i, 0, 'n')).rect(at, y - b, CELL, b);
    pg.fill(ink(i, L, 's')).rect(at, y + SIZE, CELL, b);
    pg.fill(ink(0, i, 'w')).rect(x - b, down, b, CELL);
    pg.fill(ink(L, i, 'e')).rect(x + SIZE, down, b, CELL);
  }
  pg.fill(ink(0, 0, 'n')).rect(x - b, y - b, b, b);
  pg.fill(ink(L, 0, 'n')).rect(x + SIZE, y - b, b, b);
  pg.fill(ink(0, L, 's')).rect(x - b, y + SIZE, b, b);
  pg.fill(ink(L, L, 's')).rect(x + SIZE, y + SIZE, b, b);
  const at = side === 0 ? numberCell(p) : -1;
  drawScene(pg, sheetScene(p.faces, side, appearance, CELL, 0, 0, at, `${puzzleCode(p)}.`), x, y, true);
}

/** Corner marks for cutting, placed outside the bleed. Only on the front: its print is the reference. */
function cropMarks(pg: PdfPage, x: number, y: number, SIZE: number): void {
  pg.save().stroke('#000000', 0.2);
  for (const [cx, sx] of [[x, -1], [x + SIZE, 1]] as const) for (const [cy, sy] of [[y, -1], [y + SIZE, 1]] as const) {
    pg.line(cx + sx * CROP_GAP, cy, cx + sx * CROP_EXTENT, cy);
    pg.line(cx, cy + sy * CROP_GAP, cx, cy + sy * CROP_EXTENT);
  }
  pg.restore();
}

function put(pg: PdfPage, l: Label, x: number, y: number, align: 'left' | 'center' = 'left'): number {
  pg.image(l.image, align === 'center' ? x - l.w / 2 : x, y, l.w, l.h);
  return l.h;
}

const BACKDROP = '#d9dadf';

/** Front, back and, optionally, the answer page of one puzzle. */
export function puzzlePdf(p: Puzzle, appearance: Appearance, o: PrintOptions, label: Labeler, language: Language = 'ru'): PdfDoc {
  const text = messages[language];
  const [W, H] = PAPERS[o.paper];
  const { x, y } = sheetOrigin(o.paper, o.cell);
  const SIZE = N * o.cell, TEXT = Math.max(SIZE, 150);
  const doc = new PdfDoc(`Foldopia ${puzzleCode(p)}`, p.singleSided ? 'simplex' : o.flip);
  const head = `Foldopia · ${text.number} ${puzzleCode(p)} · ${text[p.level]}`;

  const front = doc.page(W, H);
  drawSheet(front, p, 0, appearance, x, y, o.cell);
  cropMarks(front, x, y, SIZE);
  put(front, label(`${head} · ${text.printFront}`, 3.4, TEXT, true), x, y - BLEED - 14);
  put(front, label(text.printInstructions, 2.8, TEXT), x, y + SIZE + BLEED + 6);

  if (!p.singleSided) {
    const back = doc.page(W, H);
    back.save().transform(backMatrix(o));
    drawSheet(back, p, 1, appearance, x, y, o.cell);
    put(back, label(`${head} · ${text.printBack}`, 3.4, TEXT, true), x, y - BLEED - 14);
    back.restore();
  }

  if (o.solution) answerPage(doc.page(W, H), p, appearance, label, language);
  return doc;
}

export function batchPdf(
  puzzles: readonly Puzzle[], appearanceFor: (p: Puzzle) => Appearance,
  o: Pick<PrintOptions, 'paper'> & { cell: typeof BATCH_CELLS[number] }, label: Labeler, language: Language = 'ru',
): PdfDoc {
  const text = messages[language];
  if (!puzzles.length || puzzles.some(p => !p.singleSided)) {
    throw new Error(text.batchSimplex);
  }
  const [w, h] = PAPERS[o.paper];
  const size = N * o.cell;
  const gap = 2 * CROP_EXTENT + 2;
  const xStart = (w - 2 * size - gap) / 2;
  const title = label(text.batchInstructions, 2.8, w - 2 * MARGIN);
  const yStart = MARGIN + title.h + CROP_EXTENT + 2;
  const rows = Math.floor((h - MARGIN - CROP_EXTENT - yStart + gap) / (size + gap));
  if (rows < 1) throw new Error(text.batchRow);
  const perPage = 2 * rows;
  const doc = new PdfDoc('Foldopia', 'simplex');
  for (let i = 0; i < puzzles.length; i += perPage) {
    const page = doc.page(w, h);
    put(page, title, w / 2, MARGIN, 'center');
    for (const [slot, p] of puzzles.slice(i, i + perPage).entries()) {
      const x = xStart + (slot % 2) * (size + gap);
      const y = yStart + Math.floor(slot / 2) * (size + gap);
      page.fill('#000000').text(`#${puzzleCode(p)}`, x + size / 2, y - BLEED - 2, 3.4, 'center');
      drawSheet(page, p, 0, appearanceFor(p), x, y, o.cell);
      cropMarks(page, x, y, size);
    }
  }
  return doc;
}

export function batchAnswersPdf(
  puzzles: readonly Puzzle[], appearanceFor: (p: Puzzle) => Appearance, paper: PaperSize, label: Labeler, language: Language = 'ru',
): PdfDoc {
  const [w, h] = PAPERS[paper];
  const doc = new PdfDoc('Foldopia Solutions', 'simplex');
  for (const p of puzzles) answerPage(doc.page(w, h), p, appearanceFor(p), label, language);
  return doc;
}

function answerPage(pg: PdfPage, p: Puzzle, appearance: Appearance, label: Labeler, language: Language): void {
  const text = messages[language];
  const cols = 2, gap = 6, colW = (pg.w - 2 * MARGIN - gap) / cols, cs = 3.2, diag = N * cs + 2;
  let top = MARGIN;
  top += put(pg, label(`Foldopia · ${text.number} ${puzzleCode(p)} · ${text.printSolution}`, 4.2, pg.w - 2 * MARGIN, true), MARGIN, top) + 2;
  top += put(pg, label(text.answerLegend, 2.6, pg.w - 2 * MARGIN), MARGIN, top) + 5;

  const cards: ((x: number, y: number) => number)[] = p.folds.map((f, i) => (cx, cy) => {
    const nb = bbox(p.states[i + 1]!);
    let h = put(pg, label(`${text.step} ${i + 1} · ${f.box.w}×${f.box.h} → ${nb.w}×${nb.h}${f.kind === 'full' ? '' : text[f.kind]}`, 2.6, colW, true), cx, cy) + 1.5;
    const sc = stepScene(p.states[i]!, p.faces, f, appearance, 'top', cs, 0.3, 0.6, p.singleSided);
    drawScene(pg, sc, cx, cy + h, false, BACKDROP);
    const instruction = label(describe(f, language), 2.9, colW - diag - 3);
    put(pg, instruction, cx + diag + 3, cy + h);
    h += Math.max(sc.h, instruction.h);
    return h;
  });
  const last = p.states[p.states.length - 1]!;
  cards.push((cx, cy) => {
    let h = put(pg, label(text.complete, 2.6, colW, true), cx, cy) + 1.5;
    const up = p.topColor === 'B' ? text.dark : text.light, down = p.topColor === 'B' ? text.light : text.dark;
    let sh = 0;
    for (const [i, [view, cap]] of ([['top', `${text.top}: ${up}`], ['bottom', `${text.bottom}: ${down}`]] as const).entries()) {
      const sc = stepScene(last, p.faces, null, appearance, view, 4, 0.4, 0.6, p.singleSided);
      const cx2 = cx + i * (sc.w + 10);
      drawScene(pg, sc, cx2, cy + h, false, BACKDROP);
      sh = Math.max(sh, sc.h + 1 + put(pg, label(cap, 2.6, sc.w + 8), cx2, cy + h + sc.h + 1));
    }
    return h + sh;
  });

  for (let i = 0; i < cards.length; i += cols) {
    let rowH = 0;
    for (let k = 0; k < cols && i + k < cards.length; k++) rowH = Math.max(rowH, cards[i + k]!(MARGIN + k * (colW + gap), top));
    top += rowH + 6;
  }
}

/**
 * Two pages: a target on the front, a millimetre grid on the back. A pin pushed through the target's centre
 * comes out on the grid at the back's error; the reading, added to the current offset, cancels it.
 */
export function calibrationPdf(o: PrintOptions, label: Labeler, language: Language = 'ru'): PdfDoc {
  const text = messages[language];
  const [W, H] = PAPERS[o.paper];
  // The target sits at the page centre, where every sheet size has its centre too.
  const { x, y } = sheetOrigin(o.paper, o.cell);
  const SIZE = N * o.cell, TEXT = Math.max(SIZE, 150);
  const doc = new PdfDoc('Foldopia calibration', o.flip);
  const cx = W / 2, cy = y + SIZE / 2;
  const outline = (pg: PdfPage) => pg.save().stroke('#808080', 0.25, [2, 1.5]).rect(x, y, SIZE, SIZE, 'S').restore();

  const front = doc.page(W, H);
  outline(front);
  cropMarks(front, x, y, SIZE);
  front.save().stroke('#000000', 0.15);
  front.line(cx - 12, cy, cx + 12, cy).line(cx, cy - 12, cx, cy + 12);
  for (const r of [2, 5, 9]) front.circle(cx, cy, r);
  front.restore();
  let t = y - BLEED - 22;
  t += put(front, label(text.calibrationFront, 3.4, TEXT, true), x, t) + 2;
  put(front, label(text.calibrationTarget, 2.8, TEXT), x, t);
  put(front, label(text.calibrationOffset(formatNumber(o.dx, language), formatNumber(o.dy, language), o.flip === 'long'), 2.6, TEXT), x, y + SIZE + BLEED + 6);

  const back = doc.page(W, H);
  back.save().transform(backMatrix(o));
  outline(back);
  // The target's mirror image sits at the same x because the sheet is centred.
  const R = 6;
  back.save().stroke('#9a9a9a', 0.08);
  for (let i = -R; i <= R; i += 0.5) if (i % 1) back.line(cx + i, cy - R, cx + i, cy + R).line(cx - R, cy + i, cx + R, cy + i);
  back.restore().save().stroke('#4a4a4a', 0.15);
  for (let i = -R; i <= R; i++) back.line(cx + i, cy - R, cx + i, cy + R).line(cx - R, cy + i, cx + R, cy + i);
  back.restore().save().stroke('#000000', 0.35).line(cx - R - 2, cy, cx + R + 2, cy).line(cx, cy - R - 2, cx, cy + R + 2).restore();
  // Axes point to the positive side: right and down.
  const A = R + 5;
  back.save().stroke('#000000', 0.3).line(cx - R, cy - R - 1.5, cx + A, cy - R - 1.5).line(cx - R - 1.5, cy - R, cx - R - 1.5, cy + A).restore();
  back.fill('#000000').poly([cx + A + 1.6, cy - R - 1.5, cx + A, cy - R - 2.3, cx + A, cy - R - 0.7]).poly([cx - R - 1.5, cy + A + 1.6, cx - R - 2.3, cy + A, cx - R - 0.7, cy + A]);
  for (let i = -R; i <= R; i += 2) {
    back.text(String(i), cx + i, cy - R - 2.6, 1.4, 'center');
    back.text(String(i), cx - R - 2.6, cy + i + 0.5, 1.4, 'right');
  }
  back.text('X', cx + A + 2.4, cy - R - 0.8, 2.2);
  back.text('Y', cx - R - 1.5, cy + A + 4.4, 2.2, 'center');
  put(back, label(text.calibrationGrid, 2.6, TEXT), x, cy + A + 8);
  t = y - BLEED - 22;
  t += put(back, label(text.calibrationBack, 3.4, TEXT, true), x, t) + 2;
  put(back, label(text.calibrationCorrection, 2.8, TEXT), x, t);
  back.restore();
  return doc;
}
