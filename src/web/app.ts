import type { Language } from '../core/language.ts';
import { formatNumber, messages, preferredLanguage, translatePage } from './i18n.ts';
import { defaultProfile, formatCode, maxSeed, parseCode, profileIds, profileLabel, profiles, puzzleCode } from './profiles.ts';
import type { Profile, PuzzleCode } from './profiles.ts';
// The generator page: reads the controls, generates in a worker, draws the sheet and the solution.

import { bbox, describe, isDiagonal, N } from '../core/index.ts';
import type { MoveKind, Puzzle } from '../core/index.ts';
import { canvasLabeler } from './labels.ts';
import { batchAnswersPdf, batchPdf, BATCH_CELLS, calibrationPdf, CELLS, DEFAULT_CELL, puzzlePdf } from './print.ts';
import type { Flip, PaperSize, PrintOptions } from './print.ts';
import { DEFAULT_INK, numberCell, sheetSvg, stepSvg } from './render.ts';
import type { Appearance } from './render.ts';
import type { GenerateArgs, WorkerReply, WorkerRequest } from './worker.ts';
import workerSource from 'virtual:worker-source';

const COLORS = [
  ['yellow', '#d9d23a'], ['lilac', '#a98bd0'], ['red', '#e2474b'],
  ['orange', '#f0a23a'], ['turquoise', '#4fb5ad'], ['gray', '#b4b0bf'],
] as const;
const STORAGE_KEY = 'foldopia';
const PRINT_KEY = 'foldopia-print';
const INK_KEY = 'foldopia-ink';
const LANGUAGE_KEY = 'foldopia-language';

const $ = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);

const ui: { color: string | null; showSol: boolean; puzzle: Puzzle | null } = { color: null, showSol: false, puzzle: null };
const sheetColor = (p: Puzzle, color = ui.color) => color ?? COLORS[(p.seed - 1) % COLORS.length]![1];

function store(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage may be unavailable */ } }
function load(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }

let language = preferredLanguage(load(LANGUAGE_KEY), navigator.languages ?? [navigator.language]);

type GenerationError = 'workerStart' | 'workerGenerate' | 'noPuzzle';
let generationError: GenerationError | null = null;
const statusMessages = new Map<HTMLElement, () => string>();

function setStatus(id: string, message?: () => string): void {
  const element = $(id);
  if (message) statusMessages.set(element, message);
  else statusMessages.delete(element);
  element.textContent = message?.() ?? '';
}

function renderGenerationStatus(): void {
  const text = messages[language];
  $('meta').textContent = generationError === 'workerGenerate'
    ? text.workerGenerate(formatCode(settings()))
    : generationError ? text[generationError] : text.generating;
}

function applyLanguage(): void {
  document.documentElement.lang = language;
  select('language').value = language;
  translatePage(language);
  const text = messages[language];
  for (const [i, profile] of profileIds.entries()) {
    select('profile').options[i]!.text = profileLabel(profile, language);
  }
  for (const [i, [name]] of COLORS.entries()) {
    const button = $('swatches').children[i] as HTMLButtonElement;
    button.setAttribute('aria-label', text[name]);
    button.title = text[name];
  }
  if (input('seed').validity.customError) input('seed').setCustomValidity(text.invalidCode);
  renderSolutionToggle();
  if (ui.puzzle) show();
  else renderGenerationStatus();
  for (const [element, message] of statusMessages) element.textContent = message();
}

function renderSolutionToggle(): void {
  const text = messages[language];
  $('toggleSol').textContent = ui.showSol ? text.hideSolution : text.showSolution;
  $('toggleSol').setAttribute('aria-expanded', String(ui.showSol));
}

function textureSetting(value: unknown): Appearance['texture'] {
  return value === 'bands' || value === 'checker' || value === 'relief' ? value : DEFAULT_INK.texture;
}

function inkSettings(): Omit<Appearance, 'sheet'> {
  return {
    dark: input('darkInk').value,
    light: input('lightInk').value,
    texture: textureSetting(select('texture').value),
  };
}

function initInk(): void {
  try {
    const saved = JSON.parse(load(INK_KEY) ?? 'null') as Partial<Omit<Appearance, 'sheet'>> | null;
    const { dark = '', light = '' } = saved ?? {};
    input('darkInk').value = /^#[0-9a-f]{6}$/i.test(dark) ? dark : DEFAULT_INK.dark;
    input('lightInk').value = /^#[0-9a-f]{6}$/i.test(light) ? light : DEFAULT_INK.light;
    select('texture').value = textureSetting(saved?.texture);
  } catch { /* ignore broken saved settings */ }
  for (const id of ['darkInk', 'lightInk', 'texture']) {
    $(id).addEventListener('input', () => {
      store(INK_KEY, JSON.stringify(inkSettings()));
      show();
    });
  }
}


const defaultCode: PuzzleCode = { profile: defaultProfile, seed: 101, decoyPercent: 0 };

function settings(): PuzzleCode {
  return parseCode(input('seed').value) ?? defaultCode;
}

function setCode(code: PuzzleCode): void {
  input('seed').value = formatCode(code);
  input('seed').setCustomValidity('');
  select('profile').value = code.profile;
  input('decoy').valueAsNumber = code.decoyPercent;
  $('decoyVal').textContent = code.decoyPercent + '%';
}

function generationArgs({ profile, seed, decoyPercent }: PuzzleCode): GenerateArgs {
  const { level, diag, tech } = profiles[profile];
  return [seed, level, decoyPercent / 100, diag, tech, true];
}

const gen: { worker: Worker | null; busy: boolean; id: number } = { worker: null, busy: false, id: 0 };

function createWorker(): Worker {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  try {
    return new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function startWorker(): Worker {
  const w = createWorker();
  w.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    if (gen.worker !== w || data.id !== gen.id) return;
    gen.busy = false;
    if ('error' in data) done(null, data.error);
    else done(data.puzzle);
  };
  w.onerror = () => {
    if (gen.worker !== w) return;
    w.terminate();
    gen.worker = null;
    gen.busy = false;
    done(null, 'workerStart');
  };
  return w;
}

function request(): void {
  const st = settings();
  gen.id++;
  const args = generationArgs(st);
  $('board').classList.add('busy');
  $('board').classList.add('single-sided');
  ui.puzzle = null;
  $<HTMLButtonElement>('pdf').disabled = true;
  $<HTMLButtonElement>('copy').disabled = true;
  setStatus('printMsg');
  setStatus('toast');
  $('steps').hidden = true;
  $('solBox').hidden = false;
  $('backPreview').hidden = true;
  $('singlePrintHelp').hidden = false;
  for (const el of document.querySelectorAll<HTMLElement>('[data-duplex]')) el.hidden = true;
  generationError = null;
  renderGenerationStatus();
  try {
    // A newer request makes the running one pointless: drop it rather than queue behind it.
    if (gen.busy && gen.worker) { gen.worker.terminate(); gen.worker = null; }
    gen.worker ??= startWorker();
    gen.busy = true;
    const msg: WorkerRequest = { id: gen.id, args };
    gen.worker.postMessage(msg);
  } catch {
    gen.worker?.terminate();
    gen.worker = null;
    gen.busy = false;
    done(null, 'workerStart');
  }
}

function done(p: Puzzle | null, error: GenerationError = 'noPuzzle'): void {
  $('board').classList.remove('busy');
  if (!p) {
    $('front').replaceChildren();
    $('back').replaceChildren();
    $('capNo').textContent = '';
    generationError = error;
    renderGenerationStatus();
    return;
  }
  $<HTMLButtonElement>('pdf').disabled = false;
  $<HTMLButtonElement>('copy').disabled = false;
  ui.puzzle = p;
  show();
}


function show(): void {
  const text = messages[language];
  const p = ui.puzzle;
  if (!p) return;
  const code = puzzleCode(p);
  const color = sheetColor(p);
  const appearance = { ...inkSettings(), sheet: color };
  document.documentElement.style.setProperty('--sheet', color);
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset['c'] === color));

  $('front').innerHTML = sheetSvg(p.faces, 0, appearance, numberCell(p), `${code}.`, language);
  $('back').innerHTML = p.singleSided ? '' : sheetSvg(p.faces, 1, appearance, -1, '', language);
  $('capNo').textContent = `${text.number} ${code}`;

  // Measured in cells; a triangle is half a cell, a lone quarter is a quarter.
  const cnt = (c: 'B' | 'W') => p.faces.reduce((a, f) => a + f.reduce((t, face) => t + Object.values(face).filter(v => v === c).length, 0), 0) / 4;
  const kinds = (k: MoveKind) => p.folds.filter(f => f.kind === k).length;
  $('meta').innerHTML =
    `<span>${text.folds} <b>${p.folds.length}</b></span><span>${text.diagonalFolds} <b>${p.folds.filter(f => isDiagonal(f.t)).length}</b></span>` +
    `<span>${text.partialFolds} <b>${kinds('flap')}</b></span><span>${text.tucks} <b>${kinds('tuck')}</b></span>` +
    `<span>${text.darkCells} <b>${formatNumber(cnt('B'), language)}</b></span><span>${text.lightCells} <b>${formatNumber(cnt('W'), language)}</b></span>` +
    `<span>${text.rating} <span class="stars" aria-label="${p.stars} ${text.outOfFive}">${'■'.repeat(p.stars)}${'□'.repeat(5 - p.stars)}</span></span>` +
    `<span>${text.check} <b>${text.solvable}</b></span>`;

  const items = p.folds.map((f, i) => {
    const nb = bbox(p.states[i + 1]!);
    return `<li><span class="n">${text.step} ${i + 1} · ${f.box.w}×${f.box.h} → ${nb.w}×${nb.h}${f.kind === 'full' ? '' : text[f.kind]}</span>${stepSvg(p.states[i]!, p.faces, f, appearance, 'top', p.singleSided)}<p>${describe(f, language)}</p></li>`;
  });
  const last = p.states[p.states.length - 1]!;
  items.push(`<li class="final"><span class="n">${messages[language].complete}</span><div class="final-pair">` +
    `<div>${stepSvg(last, p.faces, null, appearance, 'top', p.singleSided)}${text.top}: ${p.topColor === 'B' ? text.dark : text.light}</div>` +
    `<div>${stepSvg(last, p.faces, null, appearance, 'bottom', p.singleSided)}${text.bottom}: ${p.topColor === 'B' ? text.light : text.dark}</div></div></li>`);
  $('steps').innerHTML = items.join('');
  $('steps').hidden = !ui.showSol;
  $('solBox').hidden = ui.showSol;
  store(STORAGE_KEY, JSON.stringify({ code: puzzleCode(p), color: ui.color }));
}

/** The current puzzle as JSON: each cell is four letters for its quarters n, e, s, w (B black, W white, N sheet colour). */
function exportJson(p: Puzzle): string {
  const rows = (side: 0 | 1) => Array.from({ length: N }, (_, y) =>
    p.faces.slice(y * N, y * N + N).map(f => f[side].n + f[side].e + f[side].s + f[side].w).join(' '));
  return JSON.stringify({
    code: puzzleCode(p), number: p.seed, level: p.level, diagonals: p.diag, techniques: p.tech, top: p.topColor,
    ...(p.singleSided ? { singleSided: true } : {}),
    front: rows(0),
    back: rows(1),
    folds: p.folds.map(f => ({
      kind: f.kind, line: f.t, c: f.c, moves: f.side, dir: f.dir,
      ...(f.kind === 'tuck' ? { depth: f.depth } : {}),
      ...(f.kind !== 'full' ? { layers: [...f.flap].sort((a, b) => a - b) } : {}),
      text: describe(f, language),
    })),
  }, null, 2);
}

function printOptions(): PrintOptions {
  const mm = (id: string) => Math.max(-10, Math.min(10, Math.round((parseFloat(input(id).value.replace(',', '.')) || 0) * 10) / 10));
  return {
    paper: select('paper').value as PaperSize,
    flip: select('flip').value as Flip,
    dx: mm('dx'),
    dy: mm('dy'),
    solution: input('withSol').checked,
    cell: CELLS.includes(Number(select('cell').value)) ? Number(select('cell').value) : DEFAULT_CELL,
  };
}

// Inside a Claude artifact viewer, plain downloads are blocked and files go through the host's `downloads`
// capability, which asks the viewer to confirm. A standalone copy of the page has no `window.claude`.
interface HostSaver { save(r: { filename: string; data: Blob }): Promise<unknown> }
const host = (window as { claude?: { use(name: 'downloads'): Promise<HostSaver | null> } }).claude;
const hostSaver: Promise<HostSaver | null> = host ? host.use('downloads').catch(() => null) : Promise.resolve(null);

async function save(name: string, blob: Blob): Promise<void> {
  const saver = await hostSaver;
  if (saver) { await saver.save({ filename: name, data: blob }); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function pdfBlob(doc: ReturnType<typeof puzzlePdf>): Promise<Blob> {
  return new Blob([await doc.bytes() as BlobPart], { type: 'application/pdf' });
}

async function savePdf(name: string, blob: Blob, statusId: string, singleSided: boolean): Promise<void> {
  await save(name, blob);
  setStatus(statusId, () => messages[language].pdfReady(name, singleSided));
}

function pdfError(e: unknown, action: string): string {
  const error = e as { code?: string; name?: string; message?: string } | null;
  if (error?.code === 'declined' || error?.name === 'AbortError') return messages[language].cancelled;
  return messages[language].pdfError(action, typeof e === 'function' ? e() : error?.message ?? String(e));
}

/** Builds a PDF and hands it to the viewer as a file to save. */
async function download(
  name: string, make: (o: PrintOptions) => ReturnType<typeof puzzlePdf>,
  singleSided = false,
): Promise<void> {
  const o = printOptions();
  const statusId = 'printMsg';
  store(PRINT_KEY, JSON.stringify(o));
  setStatus(statusId, () => messages[language].makingPdf);
  try {
    // Labels are drawn with the page font, which may still be loading.
    await document.fonts.ready;
    await savePdf(name, await pdfBlob(make(o)), statusId, singleSided);
  } catch (e) {
    setStatus(statusId, () => pdfError(e, messages[language].savePdf));
  }
}

async function generateBatch(
  st: PuzzleCode, count: number, statusId: string, signal: AbortSignal,
): Promise<{ puzzles: Puzzle[]; skipped: number }> {
  signal.throwIfAborted();
  const worker = createWorker();
  const puzzles: Puzzle[] = [];
  let seed = st.seed;
  let skipped = 0;
  let cancel: (() => void) | undefined;
  try {
    return await new Promise<{ puzzles: Puzzle[]; skipped: number }>((resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      const next = () => {
        if (maxSeed - seed + 1 < count - puzzles.length) {
          reject(() => messages[language].batchExhausted(puzzles.length, count, skipped));
          return;
        }
        setStatus(statusId, () => messages[language].batchProgress(formatCode({ ...st, seed }), puzzles.length, count, skipped));
        const msg: WorkerRequest = { id: seed, args: generationArgs({ ...st, seed }) };
        try {
          worker.postMessage(msg);
        } catch (e) {
          reject(e);
        }
      };
      worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.id !== seed) return;
        if ('error' in data) {
          reject(() => data.error === 'workerStart' ? messages[language].workerStart
            : messages[language].workerGenerate(formatCode({ ...st, seed })));
          return;
        }
        const p = data.puzzle;
        if (p) puzzles.push(p);
        else skipped++;
        if (puzzles.length === count) {
          resolve({ puzzles, skipped });
        } else {
          seed++;
          next();
        }
      };
      worker.onerror = () => reject(() => messages[language].workerGenerate(formatCode({ ...st, seed })));
      next();
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    worker.terminate();
  }
}

let batchUrl: string | null = null;
let refreshBatchPreview: (() => Promise<void>) | undefined;

async function previewBatch(): Promise<void> {
  const start = $<HTMLButtonElement>('batchPreviewButton');
  const cancel = $<HTMLButtonElement>('batchCancel');
  const answers = $<HTMLButtonElement>('batchAnswers');
  const puzzlesPdf = $<HTMLButtonElement>('batchPdf');
  const preview = $('batchPreview');
  const frame = $<HTMLIFrameElement>('batchFrame');
  const open = $<HTMLAnchorElement>('batchOpen');
  const statusId = 'batchMsg';
  const count = input('batchCount').valueAsNumber;
  const st = settings();
  $(statusId).hidden = false;
  if (!Number.isInteger(count) || count < 1 || count > 50 || st.seed + count - 1 > maxSeed) {
    setStatus(statusId, () => messages[language].batchLimits);
    return;
  }
  const cell = BATCH_CELLS.find(size => size === Number(select('batchCell').value)) ?? BATCH_CELLS[0];
  const { paper } = printOptions();
  const color = ui.color;
  const ink = inkSettings();
  const appearanceFor = (p: Puzzle) => ({ ...ink, sheet: sheetColor(p, color) });
  const controller = new AbortController();
  start.disabled = true;
  preview.hidden = true;
  answers.onclick = null;
  puzzlesPdf.onclick = null;
  refreshBatchPreview = undefined;
  if (batchUrl) {
    frame.removeAttribute('src');
    open.removeAttribute('href');
    URL.revokeObjectURL(batchUrl);
    batchUrl = null;
  }
  cancel.hidden = false;
  cancel.onclick = () => controller.abort();
  try {
    const { puzzles, skipped } = await generateBatch(st, count, statusId, controller.signal);
    const range = `${puzzleCode(puzzles[0]!)}-${puzzleCode(puzzles[puzzles.length - 1]!)}`;
    cancel.hidden = true;
    setStatus(statusId, () => messages[language].makingPreview);
    await document.fonts.ready;
    const batchBlobs = new Map<Language, Promise<Blob>>();
    const getBatchBlob = (locale: Language) => {
      const cached = batchBlobs.get(locale);
      if (cached) return cached;
      const blob = pdfBlob(batchPdf(puzzles, appearanceFor, { paper, cell }, canvasLabeler, locale));
      batchBlobs.set(locale, blob);
      return blob;
    };
    let previewRevision = 0;
    const updatePreview = async () => {
      const locale = language;
      const revision = ++previewRevision;
      const isCurrent = () => refreshBatchPreview === updatePreview && revision === previewRevision;
      setStatus(statusId, () => messages[language].makingPreview);
      open.hidden = true;
      open.removeAttribute('href');
      frame.hidden = true;
      frame.removeAttribute('src');
      if (batchUrl) {
        URL.revokeObjectURL(batchUrl);
        batchUrl = null;
      }
      let blob: Blob;
      try {
        blob = await getBatchBlob(locale);
      } catch (e) {
        batchBlobs.delete(locale);
        if (isCurrent()) setStatus(statusId, () => pdfError(e, messages[language].makePreview));
        return;
      }
      if (!isCurrent()) return;
      batchUrl = URL.createObjectURL(blob);
      frame.hidden = navigator.pdfViewerEnabled === false;
      if (!frame.hidden) frame.src = batchUrl;
      open.href = batchUrl;
      open.hidden = false;
      setStatus(statusId, () => messages[language].batchReady(puzzles.length, range, skipped));
    };
    refreshBatchPreview = updatePreview;
    await updatePreview();
    const saveBatch = async (name: string, getBlob: () => Blob | Promise<Blob>) => {
      start.disabled = puzzlesPdf.disabled = answers.disabled = true;
      setStatus(statusId, () => messages[language].makingPdf);
      try {
        await savePdf(name, await getBlob(), statusId, true);
      } catch (e) {
        setStatus(statusId, () => pdfError(e, messages[language].savePdf));
      } finally {
        start.disabled = puzzlesPdf.disabled = answers.disabled = false;
      }
    };
    puzzlesPdf.onclick = () => saveBatch(`foldopia-pack-${range}.pdf`, () => getBatchBlob(language));
    answers.onclick = () => saveBatch(`foldopia-solutions-${range}.pdf`,
      () => pdfBlob(batchAnswersPdf(puzzles, appearanceFor, paper, canvasLabeler, language)));
    preview.hidden = false;
  } catch (e) {
    setStatus(statusId, () => pdfError(e, messages[language].makePreview));
  } finally {
    cancel.hidden = true;
    cancel.onclick = null;
    start.disabled = false;
  }
}

function initPrint(): void {
  try {
    const saved = JSON.parse(load(PRINT_KEY) ?? 'null') as Partial<PrintOptions> | null;
    if (saved) {
      select('paper').value = saved.paper ?? 'a4';
      select('flip').value = saved.flip ?? 'long';
      input('dx').value = String(saved.dx ?? 0);
      input('dy').value = String(saved.dy ?? 0);
      input('withSol').checked = saved.solution ?? true;
      select('cell').value = String(saved.cell ?? DEFAULT_CELL);
    }
  } catch { /* ignore a broken saved state */ }
  for (const id of ['paper', 'cell', 'flip', 'dx', 'dy', 'withSol']) $(id).addEventListener('change', () => store(PRINT_KEY, JSON.stringify(printOptions())));
  $('pdf').onclick = () => {
    const p = ui.puzzle;
    if (!p) return;
    const appearance = { ...inkSettings(), sheet: sheetColor(p) };
    void download(`foldopia-${puzzleCode(p)}.pdf`, o => puzzlePdf(p, appearance, o, canvasLabeler, language), p.singleSided);
  };
  $('calib').onclick = () => void download('foldopia-calibration.pdf', o => calibrationPdf(o, canvasLabeler, language));
  $('batchPreviewButton').onclick = () => void previewBatch();
}

function init(): void {
  for (const [, c] of COLORS) {
    const b = document.createElement('button');
    b.className = 'sw'; b.type = 'button'; b.dataset['c'] = c; b.style.background = c;
    b.onclick = () => { ui.color = c; show(); };
    $('swatches').appendChild(b);
  }
  for (const profile of profileIds) select('profile').add(new Option(profileLabel(profile, language), profile));
  let initial = defaultCode;
  try {
    const saved = JSON.parse(load(STORAGE_KEY) ?? 'null') as { code?: string; seed?: number; decoy?: string; color?: string } | null;
    if (saved) {
      initial = parseCode(saved.code ?? '') ?? parseCode(`${defaultProfile}-${saved.seed}-${saved.decoy ?? 0}`) ?? initial;
      ui.color = saved.color ?? null;
    }
  } catch { /* ignore a broken saved state */ }
  const hash = location.hash.slice(1);
  setCode(parseCode(hash) ?? parseCode(hash.replace(/^n/, `${initial.profile}-`)) ?? initial);

  const applyCode = () => {
    const field = input('seed');
    const code = parseCode(field.value);
    field.setCustomValidity(code ? '' : messages[language].invalidCode);
    if (!code) { field.reportValidity(); return; }
    setCode(code);
    request();
  };
  input('seed').addEventListener('input', () => input('seed').setCustomValidity(''));
  input('seed').addEventListener('change', applyCode);
  input('seed').addEventListener('keydown', event => {
    if (event.key === 'Enter') input('seed').blur();
  });
  select('profile').addEventListener('change', () => {
    setCode({ ...settings(), profile: select('profile').value as Profile });
    request();
  });
  input('decoy').addEventListener('input', () => {
    setCode({ ...settings(), decoyPercent: input('decoy').valueAsNumber });
    request();
  });
  const step = (delta: number) => {
    const current = settings();
    setCode({ ...current, seed: Math.max(1, Math.min(maxSeed, current.seed + delta)) });
    request();
  };
  $('next').onclick = () => step(1);
  $('prev').onclick = () => step(-1);
  $('toggleSol').onclick = () => {
    ui.showSol = !ui.showSol;
    renderSolutionToggle();
    show();
  };
  $('copy').onclick = () => {
    if (!ui.puzzle) return;
    navigator.clipboard.writeText(exportJson(ui.puzzle))
      .then(() => { setStatus('toast', () => messages[language].copied); })
      .catch(() => { setStatus('toast', () => messages[language].clipboardError); });
  };
  applyLanguage();
  select('language').addEventListener('change', () => {
    language = preferredLanguage(select('language').value, []);
    store(LANGUAGE_KEY, language);
    applyLanguage();
    void refreshBatchPreview?.();
  });
  initInk();
  initPrint();
  request();
}

init();
