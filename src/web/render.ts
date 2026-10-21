// SVG drawings of sheets and fold steps. Pure string builders: no DOM, so they also run in Node.

import { bbox, decode, movesAt, N } from '../core/index.ts';
import type { CellPaint, Move, Paint, Quarter, Solid, State } from '../core/index.ts';

const PAPER: Readonly<Record<Solid, string>> = { B: '#1d1b1f', W: '#fbfbf8' };
/** Corners of each quarter inside a unit cell (the third corner is the cell centre). */
const QUAD: Readonly<Record<Quarter, readonly [readonly [number, number], readonly [number, number]]>> = {
  n: [[0, 0], [1, 0]], e: [[1, 0], [1, 1]], s: [[1, 1], [0, 1]], w: [[0, 1], [0, 0]],
};
const QUARTERS = Object.keys(QUAD) as Quarter[];
/** The pyramid relief printed on neutral cells: each quarter catches light differently. */
const SHADE: Readonly<Record<Quarter, readonly [string, number]>> = {
  n: ['#ffffff', 0.28], e: ['#000000', 0.06], s: ['#000000', 0.16], w: ['#ffffff', 0.1],
};
/** Looking at the other side swaps east and west. */
const MIRQ: Readonly<Record<Quarter, Quarter>> = { n: 'n', s: 's', e: 'w', w: 'e' };

/** Solid mixes instead of translucent overlays, so print and SVG converters get the same colours. */
function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
}

function quarter(x0: number, y0: number, cs: number, q: Quarter, color: Paint, sheet: string): string {
  const [[ax, ay], [bx, by]] = QUAD[q];
  const pts = `${x0 + ax * cs},${y0 + ay * cs} ${x0 + bx * cs},${y0 + by * cs} ${x0 + cs / 2},${y0 + cs / 2}`;
  // A thin stroke in the same colour hides the seam between two quarters of one half.
  const fill = color === 'N' ? mix(sheet, SHADE[q][0], SHADE[q][1]) : PAPER[color];
  return `<polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="${cs / 60}" stroke-linejoin="round"/>`;
}

/**
 * One printed side of the sheet. The back is drawn as seen after turning the sheet like a page,
 * so columns read right to left. `number` is printed on the front cell `numberAt`.
 */
export function sheetSvg(faces: readonly CellPaint[], side: 0 | 1, sheet: string, numberAt = -1, number = ''): string {
  const cs = 100, gap = 10, pad = 16, W = N * (cs + gap) - gap + pad * 2;
  let s = `<svg viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${side ? 'Оборот' : 'Лицевая сторона'} листа">`;
  s += `<rect width="${W}" height="${W}" fill="${sheet}"/>`;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const id = side === 0 ? y * N + x : y * N + (N - 1 - x);
    const x0 = pad + x * (cs + gap), y0 = pad + y * (cs + gap);
    for (const q of QUARTERS) s += quarter(x0, y0, cs, q, faces[id]![side][side ? MIRQ[q] : q], sheet);
    s += `<rect x="${x0}" y="${y0}" width="${cs}" height="${cs}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="2"/>`;
    if (side === 0 && id === numberAt) {
      s += `<text x="${x0 + cs / 2}" y="${y0 + cs / 2 + 9}" text-anchor="middle" fill="#000" fill-opacity=".55">${number}</text>`;
    }
  }
  return s + '</svg>';
}

/**
 * A folded state seen from above (or below, mirrored), with the move about to happen: its moving part faded
 * and its line drawn as a valley (over) or mountain (under) line.
 */
export function stepSvg(m: State, faces: readonly CellPaint[], f: Move | null, sheet: string, view: 'top' | 'bottom' = 'top'): string {
  const cs = 18, gap = 2, pad = 6;
  const b = bbox(m);
  const W = b.w * (cs + gap) - gap + pad * 2, H = b.h * (cs + gap) - gap + pad * 2;
  const ux = (u: number) => pad - gap / 2 + (u - b.x0) * (cs + gap), uy = (u: number) => pad - gap / 2 + (u - b.y0) * (cs + gap);
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`;
  for (const p of m.values()) {
    const d = decode(p.X, p.Y);
    let q = d.q;
    const e = view === 'top' ? p.stack[p.stack.length - 1]! : p.stack[0]!;
    const c = view === 'top' ? faces[e.id]![e.up][e.q] : faces[e.id]![e.up === 0 ? 1 : 0][e.q];
    let px = d.cx - b.x0;
    if (view !== 'top') { px = b.w - 1 - px; q = MIRQ[q]; }
    const x0 = pad + px * (cs + gap), y0 = pad + (d.cy - b.y0) * (cs + gap);
    const tri = quarter(x0, y0, cs, q, c, sheet);
    s += f && movesAt(f, p) ? `<g opacity=".42">${tri}</g>` : tri;
  }
  if (f) {
    let x1: number, y1: number, x2: number, y2: number;
    if (f.t === 'v') { x1 = x2 = f.c; y1 = b.y0; y2 = b.y1 + 1; }
    else if (f.t === 'h') { y1 = y2 = f.c; x1 = b.x0; x2 = b.x1 + 1; }
    else if (f.t === 'd') { x1 = Math.max(b.x0, b.y0 + f.c); x2 = Math.min(b.x1 + 1, b.y1 + 1 + f.c); y1 = x1 - f.c; y2 = x2 - f.c; }
    else { x1 = Math.max(b.x0, f.c - b.y1 - 1); x2 = Math.min(b.x1 + 1, f.c - b.y0); y1 = f.c - x1; y2 = f.c - x2; }
    s += `<line x1="${ux(x1)}" y1="${uy(y1)}" x2="${ux(x2)}" y2="${uy(y2)}" stroke="#d1233f" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${f.dir === 'over' ? '6 4' : '8 3 2 3'}"/>`;
  }
  return s + '</svg>';
}
