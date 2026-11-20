// A small PDF writer: vector paths, Helvetica for digits and Latin, greyscale or RGB images.
// Pages are drawn in millimetres from the top-left corner, y down, so print layouts read like SVG.
// Standard fonts have no Cyrillic: Russian text comes in as images rendered by the browser.

export interface PdfImage {
  /** Size in pixels. */
  w: number;
  h: number;
  /** 1 byte per pixel (grey) or 3 (RGB), rows top to bottom. */
  channels: 1 | 3;
  data: Uint8Array;
}

const PT = 72 / 25.4;
const num = (n: number) => String(Math.round(n * 1000) / 1000);

function rgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return [16, 8, 0].map(sh => num(((v >> sh) & 255) / 255)).join(' ');
}

/** Helvetica advance widths per 1000 units, for the characters the layouts use; others count as a digit. */
const HELV: Readonly<Record<string, number>> = { ' ': 278, '.': 278, ',': 278, '-': 333, '+': 584, '#': 556, '/': 278, ':': 278, '(': 333, ')': 333 };
export const textWidth = (s: string, size: number): number => [...s].reduce((a, ch) => a + (HELV[ch] ?? 556), 0) * size / 1000;

export class PdfPage {
  readonly ops: string[] = [];
  readonly images: PdfImage[] = [];
  readonly alphas = new Set<number>();

  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.ops.push(`${num(PT)} 0 0 ${num(-PT)} 0 ${num(h * PT)} cm`);
  }

  save(): this { this.ops.push('q'); return this; }
  restore(): this { this.ops.push('Q'); return this; }
  /** Concatenates an affine map [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
  transform(m: readonly number[]): this { this.ops.push(`${m.map(num).join(' ')} cm`); return this; }
  fill(hex: string): this { this.ops.push(`${rgb(hex)} rg`); return this; }
  /** Stroke colour, width and dash; cap 0 is butt, 1 is round. */
  stroke(hex: string, width: number, dash: readonly number[] = [], cap: 0 | 1 = 0): this {
    this.ops.push(`${rgb(hex)} RG ${num(width)} w [${dash.map(num).join(' ')}] 0 d ${cap} J`);
    return this;
  }
  /** Opacity for both fill and stroke until the next restore(). */
  alpha(a: number): this {
    const k = Math.round(a * 100);
    this.alphas.add(k);
    this.ops.push(`/A${k} gs`);
    return this;
  }
  rect(x: number, y: number, w: number, h: number, mode: 'f' | 'S' | 'B' = 'f'): this {
    this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${mode}`);
    return this;
  }
  /** Polygon from flat [x0, y0, x1, y1, …]. 'B' fills and strokes. */
  poly(pts: readonly number[], mode: 'f' | 'S' | 'B' = 'f'): this {
    let s = `${num(pts[0]!)} ${num(pts[1]!)} m`;
    for (let i = 2; i < pts.length; i += 2) s += ` ${num(pts[i]!)} ${num(pts[i + 1]!)} l`;
    this.ops.push(`${s} h ${mode}`);
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number): this {
    this.ops.push(`${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
    return this;
  }
  circle(cx: number, cy: number, r: number, mode: 'f' | 'S' = 'S'): this {
    const k = 0.5523 * r;
    this.ops.push(`${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ` +
      `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ` +
      `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ` +
      `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c ${mode}`);
    return this;
  }
  /** Helvetica text with its baseline at y; size in mm. ASCII only. */
  text(s: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right' = 'left'): this {
    const w = textWidth(s, size);
    const x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
    const esc = s.replace(/[\\()]/g, ch => '\\' + ch);
    this.ops.push(`BT /F1 ${num(size)} Tf 1 0 0 -1 ${num(x0)} ${num(y)} Tm (${esc}) Tj ET`);
    return this;
  }
  /** Draws an image into the box with top-left corner (x, y). */
  image(img: PdfImage, x: number, y: number, w: number, h: number): this {
    this.images.push(img);
    this.ops.push(`q ${num(w)} 0 0 ${num(-h)} ${num(x)} ${num(y + h)} cm /I${this.images.length - 1} Do Q`);
    return this;
  }
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class PdfDoc {
  readonly pages: PdfPage[] = [];

  /** `flip` is a duplex hint for viewers that pass it on to the print dialog. */
  readonly title: string;
  readonly flip: 'long' | 'short' | 'simplex';

  constructor(title = '', flip: 'long' | 'short' | 'simplex' = 'long') {
    this.title = title;
    this.flip = flip;
  }

  page(w: number, h: number): PdfPage {
    const p = new PdfPage(w, h);
    this.pages.push(p);
    return p;
  }

  async bytes(): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const objs: (Uint8Array | null)[] = [];
    const reserve = () => objs.push(null);
    const set = (n: number, body: string | Uint8Array) => { objs[n - 1] = typeof body === 'string' ? enc.encode(body) : body; };
    const stream = async (dict: string, data: Uint8Array): Promise<Uint8Array> => {
      const z = await deflate(data);
      const body = z ?? data;
      const head = enc.encode(`<< ${dict}${z ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`);
      const tail = enc.encode('\nendstream');
      const out = new Uint8Array(head.length + body.length + tail.length);
      out.set(head); out.set(body, head.length); out.set(tail, head.length + body.length);
      return out;
    };

    const catalog = reserve(), pagesObj = reserve(), font = reserve(), info = reserve();
    set(font, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const title = [...this.title].map(ch => (ch.charCodeAt(0) < 128 ? ch : '')).join('').replace(/[\\()]/g, ch => '\\' + ch);
    set(info, `<< /Producer (Foldoku) /Title (${title}) >>`);
    const kids: number[] = [];
    for (const p of this.pages) {
      const pageObj = reserve(), content = reserve();
      kids.push(pageObj);
      const xobjs: string[] = [];
      for (const [i, img] of p.images.entries()) {
        const n = reserve();
        set(n, await stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /Device${img.channels === 1 ? 'Gray' : 'RGB'} /BitsPerComponent 8`, img.data));
        xobjs.push(`/I${i} ${n} 0 R`);
      }
      const gs = [...p.alphas].map(k => `/A${k} << /Type /ExtGState /ca ${k / 100} /CA ${k / 100} >>`).join(' ');
      set(content, await stream('', enc.encode(p.ops.join('\n'))));
      set(pageObj, `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(p.w * PT)} ${num(p.h * PT)}] /Contents ${content} 0 R ` +
        `/Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjs.join(' ')} >> /ExtGState << ${gs} >> >> >>`);
    }
    set(pagesObj, `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
    const duplex = { long: 'DuplexFlipLongEdge', short: 'DuplexFlipShortEdge', simplex: 'Simplex' }[this.flip];
    set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /PrintScaling /None /Duplex /${duplex} >> >>`);

    const parts: Uint8Array[] = [enc.encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
    let at = parts[0]!.length;
    const offsets: number[] = [];
    for (const [i, body] of objs.entries()) {
      const chunk = [enc.encode(`${i + 1} 0 obj\n`), body!, enc.encode('\nendobj\n')];
      offsets.push(at);
      for (const c of chunk) { parts.push(c); at += c.length; }
    }
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    parts.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}
