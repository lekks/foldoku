import type { Language } from '../core/language.ts';
import { formatNumber, messages, preferredLanguage, translatePage } from './i18n.ts';
import { defaultProfile, formatCode, maxSeed, parseCode, profileIds, profileLabel, profiles, puzzleCode } from './profiles.ts';
import type { Profile, PuzzleCode } from './profiles.ts';
// The generator page: reads the controls, generates in a worker, draws the sheet and the solution.

import { applyFold, bbox, describe, initState, isDiagonal, N } from '../core/index.ts';
import type { FlapMove, FullMove, MoveKind, Puzzle, TuckMove } from '../core/index.ts';
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
const LANGUAGE_TRANSITION_KEY = 'foldopia-language-transition';

const $ = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);

const ui: { color: string | null; showSol: boolean } = { color: null, showSol: false };
const sheetColor = (p: Puzzle, color = ui.color) => color ?? COLORS[(p.seed - 1) % COLORS.length]![1];

function store(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage may be unavailable */ } }
function load(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }

const languageSelect = document.querySelector<HTMLSelectElement>('select#language');
const languageLink = document.querySelector<HTMLAnchorElement>('a#language');
const pageLanguage = document.documentElement.dataset.pageLanguage;
let language = preferredLanguage(pageLanguage ?? load(LANGUAGE_KEY), navigator.languages ?? [navigator.language]);

type GenerationError = 'workerStart' | 'workerGenerate' | 'noPuzzle';
type GenerationState =
  | { kind: 'idle' }
  | { kind: 'pending'; code: PuzzleCode }
  | { kind: 'ready'; puzzle: Puzzle }
  | { kind: 'failed'; code: PuzzleCode; error: GenerationError };
const gen: { worker: Worker | null; id: number; state: GenerationState } = {
  worker: null, id: 0, state: { kind: 'idle' },
};
const statusMessages = new Map<HTMLElement, () => string>();

function setStatus(id: string, message?: () => string): void {
  const element = $(id);
  if (message) statusMessages.set(element, message);
  else statusMessages.delete(element);
  element.textContent = message?.() ?? '';
}

function renderGenerationStatus(): void {
  const text = messages[language];
  const state = gen.state;
  $('meta').textContent = state.kind !== 'failed' ? text.generating
    : state.error === 'workerGenerate' ? text.workerGenerate(formatCode(state.code))
    : text[state.error];
}

function applyLanguage(): void {
  document.documentElement.lang = language;
  if (languageSelect) {
    languageSelect.value = language;
    translatePage(language);
  }
  const text = messages[language];
  for (const [i, profile] of profileIds.entries()) {
    select('profile').options[i]!.text = profileLabel(profile, language, !input('doubleSided').checked);
  }
  for (const [i, [name]] of COLORS.entries()) {
    const button = $('swatches').children[i] as HTMLButtonElement;
    button.setAttribute('aria-label', text[name]);
    button.title = text[name];
  }
  if (input('seed').validity.customError) input('seed').setCustomValidity(text.invalidCode);
  renderSolutionToggle();
  if (gen.state.kind === 'ready') show();
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

function updateLanguageLink(): void {
  if (!languageLink || gen.state.kind === 'idle') return;
  const code = gen.state.kind === 'ready' ? puzzleCode(gen.state.puzzle) : formatCode(gen.state.code);
  languageLink.hash = encodeURIComponent(code);
}

type LanguageTransition = {
  destination: string;
  color: string | null;
  showSolution: boolean;
  batchCount: string;
  batchCell: string;
  batch?: StoredBatch;
};

function saveLanguageTransition(event: MouseEvent): void {
  if (!languageLink || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const transition: LanguageTransition = {
    destination: languageLink.pathname + languageLink.hash,
    color: ui.color,
    showSolution: ui.showSol,
    batchCount: input('batchCount').value,
    batchCell: select('batchCell').value,
  };
  try {
    const batch = batchState.kind === 'empty' ? undefined
      : storeBatch(batchState.snapshot, batchState.kind === 'generating' ? batchState.progress : undefined);
    sessionStorage.setItem(LANGUAGE_TRANSITION_KEY, JSON.stringify({ ...transition, batch }));
  } catch {
    // The smaller preferences may still fit if the batch exceeds the storage quota.
    try { sessionStorage.setItem(LANGUAGE_TRANSITION_KEY, JSON.stringify(transition)); }
    catch { /* storage may be unavailable */ }
  }
}

function restoreLanguageTransition(): ReturnType<typeof restoreBatch> {
  try {
    const saved = sessionStorage.getItem(LANGUAGE_TRANSITION_KEY);
    if (!saved) return;
    sessionStorage.removeItem(LANGUAGE_TRANSITION_KEY);
    const transition = JSON.parse(saved) as LanguageTransition;
    if (transition.destination !== location.pathname + location.hash) return;
    if (transition.color === null || COLORS.some(([, color]) => color === transition.color)) ui.color = transition.color;
    ui.showSol = transition.showSolution === true;
    if (typeof transition.batchCount === 'string') input('batchCount').value = transition.batchCount;
    if (BATCH_CELLS.some(cell => String(cell) === transition.batchCell)) select('batchCell').value = transition.batchCell;
    if (transition.batch) return restoreBatch(transition.batch);
  } catch { /* ignore unavailable storage or a broken saved transition */ }
}

function setCode(code: PuzzleCode): void {
  input('seed').value = formatCode(code);
  input('seed').setCustomValidity('');
  select('profile').value = code.profile;
  input('doubleSided').checked = !!code.doubleSided;
  for (const option of select('profile').options) {
    option.text = profileLabel(option.value as Profile, language, !code.doubleSided);
  }
  input('decoy').valueAsNumber = code.decoyPercent;
  $('decoyVal').textContent = code.decoyPercent + '%';
}

function generationArgs({ profile, seed, decoyPercent, doubleSided }: PuzzleCode): GenerateArgs {
  const { level, diag, tech } = profiles[profile];
  return [seed, level, decoyPercent / 100, diag, tech, !doubleSided];
}

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
    if ('error' in data) done(null, data.error);
    else done(data.puzzle);
  };
  w.onerror = () => {
    if (gen.worker !== w) return;
    w.terminate();
    gen.worker = null;
    done(null, 'workerStart');
  };
  return w;
}

function request(): void {
  const st = settings();
  const wasPending = gen.state.kind === 'pending';
  gen.id++;
  gen.state = { kind: 'pending', code: st };
  updateLanguageLink();
  const args = generationArgs(st);
  $('board').classList.add('busy');
  $('board').classList.toggle('single-sided', !st.doubleSided);
  $<HTMLButtonElement>('pdf').disabled = true;
  $<HTMLButtonElement>('copy').disabled = true;
  setStatus('printMsg');
  setStatus('toast');
  $('steps').hidden = true;
  $('solBox').hidden = false;
  $('backPreview').hidden = !st.doubleSided;
  $('singlePrintHelp').hidden = !!st.doubleSided;
  $('batchSection').hidden = !!st.doubleSided;
  for (const el of document.querySelectorAll<HTMLElement>('[data-duplex]')) el.hidden = !st.doubleSided;
  renderGenerationStatus();
  try {
    // A newer request makes the running one pointless: drop it rather than queue behind it.
    if (wasPending && gen.worker) { gen.worker.terminate(); gen.worker = null; }
    gen.worker ??= startWorker();
    const msg: WorkerRequest = { id: gen.id, args };
    gen.worker.postMessage(msg);
  } catch {
    gen.worker?.terminate();
    gen.worker = null;
    done(null, 'workerStart');
  }
}

function done(p: Puzzle | null, error: GenerationError = 'noPuzzle'): void {
  if (gen.state.kind !== 'pending') return;
  gen.state = p ? { kind: 'ready', puzzle: p } : { kind: 'failed', code: gen.state.code, error };
  updateLanguageLink();
  $('board').classList.remove('busy');
  if (!p) {
    $('front').replaceChildren();
    $('back').replaceChildren();
    $('capNo').textContent = '';
    renderGenerationStatus();
    return;
  }
  $<HTMLButtonElement>('pdf').disabled = false;
  $<HTMLButtonElement>('copy').disabled = false;
  show();
}


function show(): void {
  if (gen.state.kind !== 'ready') return;
  const text = messages[language];
  const { puzzle: p } = gen.state;
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
  snapshot: BatchSnapshot, progress: BatchProgress, statusId: string, signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const worker = createWorker();
  const { puzzles } = snapshot;
  const { code, count } = progress;
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener('abort', cancel, { once: true });
      const next = () => {
        const seed = progress.nextSeed;
        if (maxSeed - seed + 1 < count - puzzles.length) {
          reject(() => messages[language].batchExhausted(puzzles.length, count, snapshot.skipped));
          return;
        }
        const candidate = { ...code, seed };
        setStatus(statusId, () => messages[language].batchProgress(formatCode(candidate), puzzles.length, count, snapshot.skipped));
        const msg: WorkerRequest = { id: seed, args: generationArgs(candidate) };
        try {
          worker.postMessage(msg);
        } catch (e) {
          reject(e);
        }
      };
      worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.id !== progress.nextSeed) return;
        if ('error' in data) {
          reject(() => data.error === 'workerStart' ? messages[language].workerStart
            : messages[language].workerGenerate(formatCode({ ...code, seed: data.id })));
          return;
        }
        const p = data.puzzle;
        if (p) puzzles.push(p);
        else snapshot.skipped++;
        progress.nextSeed++;
        if (puzzles.length === count) resolve();
        else next();
      };
      worker.onerror = () => reject(() => messages[language].workerGenerate(formatCode({ ...code, seed: progress.nextSeed })));
      next();
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    worker.terminate();
  }
}

interface BatchSnapshot {
  puzzles: Puzzle[];
  skipped: number;
  paper: PaperSize;
  cell: typeof BATCH_CELLS[number];
  color: string | null;
  ink: Omit<Appearance, 'sheet'>;
}

interface BatchProgress {
  code: PuzzleCode;
  count: number;
  nextSeed: number;
}

type StoredMove = FullMove | ((Omit<FlapMove, 'flap'> | Omit<TuckMove, 'flap'>) & { flap: number[] });
type StoredPuzzle = Omit<Puzzle, 'states' | 'folds'> & { folds: StoredMove[] };
type StoredBatch = Omit<BatchSnapshot, 'puzzles'> & { puzzles: StoredPuzzle[]; progress?: BatchProgress };

function storeBatch(snapshot: BatchSnapshot, progress?: BatchProgress): StoredBatch {
  return {
    ...snapshot,
    progress,
    // Store the accepted sheets and moves. Folded states can be replayed from those moves.
    puzzles: snapshot.puzzles.map(({ states: _states, folds, ...puzzle }) => ({
      ...puzzle, folds: folds.map(move => move.kind === 'full' ? move : { ...move, flap: [...move.flap] }),
    })),
  };
}

function restoreBatch(stored: StoredBatch): { snapshot: BatchSnapshot; progress?: BatchProgress } | undefined {
  const { progress, puzzles, ...settings } = stored;
  if ((!progress && !puzzles.length) || puzzles.some(puzzle => !puzzle.singleSided)) return;
  if (progress && (!Number.isInteger(progress.count) || progress.count <= puzzles.length || progress.count > 50 ||
      !Number.isInteger(progress.nextSeed) || progress.nextSeed < progress.code.seed)) return;
  const snapshot: BatchSnapshot = {
    ...settings,
    puzzles: puzzles.map(({ folds, ...puzzle }) => {
      const moves = folds.map(move => move.kind === 'full' ? move : { ...move, flap: new Set(move.flap) });
      let state = initState();
      const states = [state];
      for (const move of moves) {
        state = applyFold(state, move);
        states.push(state);
      }
      return { ...puzzle, folds: moves, states };
    }),
  };
  return { snapshot, progress };
}

type BatchState =
  | { kind: 'empty' }
  | { kind: 'generating'; controller: AbortController; snapshot: BatchSnapshot; progress: BatchProgress }
  | { kind: 'ready'; snapshot: BatchSnapshot; refresh: () => Promise<void> };
let batchState: BatchState = { kind: 'empty' };
let batchUrl: string | null = null;

function clearBatchPreview(): void {
  const frame = $<HTMLIFrameElement>('batchFrame');
  const open = $<HTMLAnchorElement>('batchOpen');
  frame.hidden = open.hidden = true;
  frame.removeAttribute('src');
  open.removeAttribute('href');
  if (batchUrl) URL.revokeObjectURL(batchUrl);
  batchUrl = null;
}

function previewBatch(): void {
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
  void runBatch({ puzzles: [], skipped: 0, paper, cell, color, ink }, { code: st, count, nextSeed: st.seed });
}

async function runBatch(snapshot: BatchSnapshot, progress: BatchProgress): Promise<void> {
  const start = $<HTMLButtonElement>('batchPreviewButton');
  const cancel = $<HTMLButtonElement>('batchCancel');
  const statusId = 'batchMsg';
  const controller = new AbortController();
  batchState = { kind: 'generating', controller, snapshot, progress };
  $(statusId).hidden = false;
  start.disabled = true;
  $('batchPreview').hidden = true;
  $('batchAnswers').onclick = null;
  $('batchPdf').onclick = null;
  clearBatchPreview();
  cancel.hidden = false;
  try {
    await generateBatch(snapshot, progress, statusId, controller.signal);
    cancel.hidden = true;
    await showBatch(snapshot);
  } catch (e) {
    batchState = { kind: 'empty' };
    setStatus(statusId, () => pdfError(e, messages[language].makePreview));
  } finally {
    cancel.hidden = true;
    start.disabled = false;
  }
}

async function showBatch(snapshot: BatchSnapshot): Promise<void> {
  const { puzzles, skipped, paper, cell, color, ink } = snapshot;
  const appearanceFor = (p: Puzzle) => ({ ...ink, sheet: sheetColor(p, color) });
  const range = `${puzzleCode(puzzles[0]!)}-${puzzleCode(puzzles[puzzles.length - 1]!)}`;
  const start = $<HTMLButtonElement>('batchPreviewButton');
  const answers = $<HTMLButtonElement>('batchAnswers');
  const puzzlesPdf = $<HTMLButtonElement>('batchPdf');
  const frame = $<HTMLIFrameElement>('batchFrame');
  const open = $<HTMLAnchorElement>('batchOpen');
  const statusId = 'batchMsg';
  const batchBlobs = new Map<Language, Promise<Blob>>();
  const getBatchBlob = (locale: Language) => {
    const cached = batchBlobs.get(locale);
    if (cached) return cached;
    const blob = document.fonts.ready.then(() =>
      pdfBlob(batchPdf(puzzles, appearanceFor, { paper, cell }, canvasLabeler, locale)));
    batchBlobs.set(locale, blob);
    return blob;
  };
  let previewRevision = 0;
  const updatePreview = async () => {
    const locale = language;
    const revision = ++previewRevision;
    const isCurrent = () => batchState.kind === 'ready' && batchState.refresh === updatePreview && revision === previewRevision;
    setStatus(statusId, () => messages[language].makingPreview);
    clearBatchPreview();
    try {
      const blob = await getBatchBlob(locale);
      if (!isCurrent()) return;
      batchUrl = URL.createObjectURL(blob);
      frame.hidden = navigator.pdfViewerEnabled === false;
      if (!frame.hidden) frame.src = batchUrl;
      open.href = batchUrl;
      open.hidden = false;
      setStatus(statusId, () => messages[language].batchReady(puzzles.length, range, skipped));
    } catch (e) {
      batchBlobs.delete(locale);
      if (isCurrent()) setStatus(statusId, () => pdfError(e, messages[language].makePreview));
    }
  };
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
  batchState = { kind: 'ready', snapshot, refresh: updatePreview };
  start.disabled = true;
  $(statusId).hidden = false;
  await updatePreview();
  puzzlesPdf.onclick = () => saveBatch(`foldopia-pack-${range}.pdf`, () => getBatchBlob(language));
  answers.onclick = () => saveBatch(`foldopia-solutions-${range}.pdf`,
    () => pdfBlob(batchAnswersPdf(puzzles, appearanceFor, paper, canvasLabeler, language)));
  $('batchPreview').hidden = false;
  start.disabled = false;
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
    if (gen.state.kind !== 'ready') return;
    const { puzzle: p } = gen.state;
    const appearance = { ...inkSettings(), sheet: sheetColor(p) };
    void download(`foldopia-${puzzleCode(p)}.pdf`, o => puzzlePdf(p, appearance, o, canvasLabeler, language), p.singleSided);
  };
  $('calib').onclick = () => void download('foldopia-calibration.pdf', o => calibrationPdf(o, canvasLabeler, language));
  $('batchPreviewButton').onclick = previewBatch;
  $('batchCancel').onclick = () => {
    if (batchState.kind === 'generating') batchState.controller.abort();
  };
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
  const restoredBatch = languageLink ? restoreLanguageTransition() : undefined;
  const hash = location.hash.slice(1).replace(/^%25/i, '%');
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
  input('doubleSided').addEventListener('change', () => {
    setCode({ ...settings(), doubleSided: input('doubleSided').checked });
    request();
  });
  window.addEventListener('hashchange', () => {
    const code = parseCode(location.hash.slice(1).replace(/^%25/i, '%'));
    if (!code) return;
    setCode(code);
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
    if (gen.state.kind !== 'ready') return;
    navigator.clipboard.writeText(exportJson(gen.state.puzzle))
      .then(() => { setStatus('toast', () => messages[language].copied); })
      .catch(() => { setStatus('toast', () => messages[language].clipboardError); });
  };
  applyLanguage();
  languageSelect?.addEventListener('change', () => {
    language = preferredLanguage(languageSelect.value, []);
    store(LANGUAGE_KEY, language);
    applyLanguage();
    if (batchState.kind === 'ready') void batchState.refresh();
  });
  languageLink?.addEventListener('click', saveLanguageTransition);
  initInk();
  initPrint();
  request();
  if (restoredBatch?.progress) void runBatch(restoredBatch.snapshot, restoredBatch.progress);
  else if (restoredBatch) void showBatch(restoredBatch.snapshot);
}

init();
