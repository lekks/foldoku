// Drawings of sheets and fold steps. A drawing is first built as a scene of polygons and lines, which is then
// written out as SVG for the page or as PDF for printing. Pure: no DOM, so it also runs in Node.

import { bbox, decode, movesAt, N } from '../core/index.ts';
import type { Box, CellPaint, Direction, Move, Paint, Puzzle, Quarter, State } from '../core/index.ts';

export interface Appearance {
  sheet: string;
  dark: string;
  light: string;
  texture: 'flat' | 'bands' | 'checker' | 'relief';
}

export const DEFAULT_INK: Readonly<Omit<Appearance, 'sheet'>> = { dark: '#606060', light: '#ffffff', texture: 'flat' };
/** Corners of each quarter inside a unit cell (the third corner is the cell centre). */
const QUAD: Readonly<Record<Quarter, readonly [readonly [number, number], readonly [number, number]]>> = {
  n: [[0, 0], [1, 0]], e: [[1, 0], [1, 1]], s: [[1, 1], [0, 1]], w: [[0, 1], [0, 0]],
};
const QUARTERS = Object.keys(QUAD) as Quarter[];
const RELIEF: Readonly<Record<Quarter, readonly [string, number]>> = {
  n: ['#ffffff', 0.28], e: ['#000000', 0.06], s: ['#000000', 0.16], w: ['#ffffff', 0.1],
};
/** Looking at the other side swaps east and west. */
const MIRQ: Readonly<Record<Quarter, Quarter>> = { n: 'n', s: 's', e: 'w', w: 'e' };

/** Solid mixes instead of translucent overlays, so print and SVG converters get the same colours. */
export function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
}

function inkOf(color: Paint, appearance: Appearance, id: number, q: Quarter): string {
  if (color === 'B') return appearance.dark;
  if (color === 'W') return appearance.light;
  if (appearance.texture === 'relief') return mix(appearance.sheet, ...RELIEF[q]);
  const row = Math.floor(id / N), col = id % N;
  const shaded = (appearance.texture === 'bands' && row % 2 === 1)
    || (appearance.texture === 'checker' && (row + col) % 2 === 1);
  return shaded ? mix(appearance.sheet, '#000000', 0.08) : appearance.sheet;
}

/** The back is seen like a turned page: its columns and east and west quarters are mirrored. */
export function sheetInk(faces: readonly CellPaint[], side: 0 | 1, x: number, y: number, q: Quarter, appearance: Appearance): string {
  const id = y * N + (side === 0 ? x : N - 1 - x);
  return inkOf(faces[id]![side][side === 0 ? q : MIRQ[q]], appearance, id, q);
}

/** The front cell that carries the sheet's number: a fully neutral one, as on the real sheets. */
export function numberCell(p: Puzzle): number {
  const neutral = p.faces.map((f, i) => (Object.values(f[0]).every(v => v === 'N') ? i : -1)).filter(i => i >= 0);
  return neutral.length ? neutral[(p.seed * 13) % neutral.length]! : -1;
}

export interface Poly { pts: readonly number[]; fill: string; faded: boolean }
export interface Scene {
  w: number;
  h: number;
  /** Cell size, for stroke widths. */
  cs: number;
  polys: Poly[];
  /** Cell outlines, drawn as faint lines over the paint. */
  cells: { x: number; y: number }[];
  fold: { x1: number; y1: number; x2: number; y2: number; dir: Direction } | null;
  number: { x: number; y: number; text: string } | null;
}

function quarterPoly(x0: number, y0: number, cs: number, q: Quarter, fill: string, faded = false): Poly {
  const [[ax, ay], [bx, by]] = QUAD[q];
  return { pts: [x0 + ax * cs, y0 + ay * cs, x0 + bx * cs, y0 + by * cs, x0 + cs / 2, y0 + cs / 2], fill, faded };
}

/** One printed side of the sheet; `gap` separates cells on screen and is 0 for print. */
export function sheetScene(faces: readonly CellPaint[], side: 0 | 1, appearance: Appearance, cs: number, gap: number, pad: number, numberAt = -1, number = ''): Scene {
  const W = N * (cs + gap) - gap + pad * 2;
  const sc: Scene = { w: W, h: W, cs, polys: [], cells: [], fold: null, number: null };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const x0 = pad + x * (cs + gap), y0 = pad + y * (cs + gap);
    for (const q of QUARTERS) sc.polys.push(quarterPoly(x0, y0, cs, q, sheetInk(faces, side, x, y, q, appearance)));
    sc.cells.push({ x: x0, y: y0 });
    if (side === 0 && y * N + x === numberAt) sc.number = { x: x0 + cs / 2, y: y0 + cs / 2, text: number };
  }
  return sc;
}

/** End points of a fold line across a state's extent, in cell units. */
export function foldEnds(f: Move, b: Box): [number, number, number, number] {
  if (f.t === 'v') return [f.c, b.y0, f.c, b.y1 + 1];
  if (f.t === 'h') return [b.x0, f.c, b.x1 + 1, f.c];
  if (f.t === 'd') {
    const x1 = Math.max(b.x0, b.y0 + f.c), x2 = Math.min(b.x1 + 1, b.y1 + 1 + f.c);
    return [x1, x1 - f.c, x2, x2 - f.c];
  }
  const x1 = Math.max(b.x0, f.c - b.y1 - 1), x2 = Math.min(b.x1 + 1, f.c - b.y0);
  return [x1, f.c - x1, x2, f.c - x2];
}

/**
 * A folded state seen from above (or below, mirrored), with the move about to happen: its moving part faded
 * and its line drawn as a valley (over) or mountain (under) line.
 */
export function stepScene(m: State, faces: readonly CellPaint[], f: Move | null, appearance: Appearance, view: 'top' | 'bottom' = 'top', cs = 18, gap = 2, pad = 6, singleSided = false): Scene {
  const b = bbox(m);
  const sc: Scene = { w: b.w * (cs + gap) - gap + pad * 2, h: b.h * (cs + gap) - gap + pad * 2, cs, polys: [], cells: [], fold: null, number: null };
  const ux = (u: number) => pad - gap / 2 + (u - b.x0) * (cs + gap), uy = (u: number) => pad - gap / 2 + (u - b.y0) * (cs + gap);
  for (const p of m.values()) {
    const d = decode(p.X, p.Y);
    let q = d.q;
    const e = view === 'top' ? p.stack[p.stack.length - 1]! : p.stack[0]!;
    const side = view === 'top' ? e.up : e.up === 0 ? 1 : 0;
    let px = d.cx - b.x0;
    if (view !== 'top') { px = b.w - 1 - px; q = MIRQ[q]; }
    const fill = singleSided && side === 1 ? '#ffffff' : inkOf(faces[e.id]![side][e.q], appearance, e.id, q);
    sc.polys.push(quarterPoly(pad + px * (cs + gap), pad + (d.cy - b.y0) * (cs + gap), cs, q, fill, !!f && movesAt(f, p)));
  }
  if (f) {
    const [x1, y1, x2, y2] = foldEnds(f, b);
    sc.fold = { x1: ux(x1), y1: uy(y1), x2: ux(x2), y2: uy(y2), dir: f.dir };
  }
  return sc;
}

/** Valley (over) and mountain (under) dash patterns, in cell sizes. */
export const DASH: Readonly<Record<Direction, readonly number[]>> = { over: [1 / 3, 2 / 9], under: [4 / 9, 1 / 6, 1 / 9, 1 / 6] };
export const FOLD_INK = '#d1233f';
export const FADED = 0.42;

export function toSvg(sc: Scene, label = ''): string {
  let s = `<svg viewBox="0 0 ${sc.w} ${sc.h}" xmlns="http://www.w3.org/2000/svg" role="img"${label ? ` aria-label="${label}"` : ''}>`;
  for (const p of sc.polys) {
    // A thin stroke in the same colour hides the seam between two quarters of one half.
    const tri = `<polygon points="${p.pts.join(' ')}" fill="${p.fill}" stroke="${p.fill}" stroke-width="${sc.cs / 60}" stroke-linejoin="round"/>`;
    s += p.faded ? `<g opacity="${FADED}">${tri}</g>` : tri;
  }
  for (const c of sc.cells) {
    s += `<rect x="${c.x}" y="${c.y}" width="${sc.cs}" height="${sc.cs}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="${sc.cs / 50}"/>`;
  }
  if (sc.number) {
    s += `<text x="${sc.number.x}" y="${sc.number.y + sc.cs * 0.09}" text-anchor="middle" style="font-size:${sc.cs * Math.min(0.26, 1.4 / sc.number.text.length)}px" fill="#000" fill-opacity=".55">${sc.number.text}</text>`;
  }
  if (sc.fold) {
    const { x1, y1, x2, y2, dir } = sc.fold;
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${FOLD_INK}" stroke-width="${sc.cs * 0.14}" stroke-linecap="round" stroke-dasharray="${DASH[dir].map(d => +(d * sc.cs).toFixed(2)).join(' ')}"/>`;
  }
  return s + '</svg>';
}

export function sheetSvg(faces: readonly CellPaint[], side: 0 | 1, appearance: Appearance, numberAt = -1, number = ''): string {
  return toSvg(sheetScene(faces, side, appearance, 100, 10, 16, numberAt, number), side ? 'Оборот листа' : 'Лицевая сторона листа');
}

export function stepSvg(m: State, faces: readonly CellPaint[], f: Move | null, appearance: Appearance, view: 'top' | 'bottom' = 'top', singleSided = false): string {
  return toSvg(stepScene(m, faces, f, appearance, view, undefined, undefined, undefined, singleSided));
}
