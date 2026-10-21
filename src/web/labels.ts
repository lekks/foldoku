// Renders text for PDF pages in the browser: the PDF's built-in fonts have no Cyrillic, so text goes in as images.

import type { Labeler } from './print.ts';

/** Pixels per millimetre: about 300 dpi. */
const PX = 12;
const FAMILY = '"Golos Text", "Segoe UI", system-ui, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxPx) { lines.push(line); line = word; } else line = next;
  }
  return line ? [...lines, line] : lines;
}

export const canvasLabeler: Labeler = (text, size, maxWidth, bold = false) => {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `${bold ? 600 : 400} ${size * PX}px ${FAMILY}`;
  ctx.font = font;
  const lines = wrap(ctx, text, maxWidth * PX);
  const lineH = size * 1.32 * PX;
  c.width = Math.max(1, Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width)) + 2));
  c.height = Math.max(1, Math.ceil(lines.length * lineH));
  // Resizing resets the context.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = font;
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lineH + size * 1.02 * PX));
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const grey = new Uint8Array(c.width * c.height);
  for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4]!;
  return { image: { w: c.width, h: c.height, channels: 1, data: grey }, w: c.width / PX, h: c.height / PX };
};
