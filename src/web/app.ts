// The generator page: reads the controls, generates in a worker, draws the sheet and the solution.

import { bbox, describe, generate, isDiagonal, N, verify } from '../core/index.ts';
import type { Level, MoveKind, Puzzle, Tech } from '../core/index.ts';
import { sheetSvg, stepSvg } from './render.ts';
import type { GenerateArgs, WorkerReply, WorkerRequest } from './worker.ts';
import workerSource from 'virtual:worker-source';

const COLORS: readonly (readonly [string, string])[] = [
  ['Жёлтый', '#d9d23a'], ['Сиреневый', '#a98bd0'], ['Красный', '#e2474b'],
  ['Оранжевый', '#f0a23a'], ['Бирюзовый', '#4fb5ad'], ['Серый', '#b4b0bf'],
];
const STORAGE_KEY = 'foldoku';

const $ = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);

const ui: { color: string | null; showSol: boolean; puzzle: Puzzle | null } = { color: null, showSol: false, puzzle: null };

function store(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage may be unavailable */ } }
function load(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

interface Settings { seed: number; level: Level; diag: number; tech: Tech; decoy: number }

function settings(): Settings {
  return {
    seed: Math.max(1, Math.min(999999, parseInt(input('seed').value, 10) || 1)),
    level: select('level').value as Level,
    diag: parseInt(select('diag').value, 10) || 0,
    tech: (parseInt(select('tech').value, 10) || 0) as Tech,
    decoy: parseInt(input('decoy').value, 10) / 100,
  };
}

// Generation runs in a worker, so the page stays responsive on slow mixes.
const gen: { worker: Worker | null; busy: boolean; id: number; args: GenerateArgs | null } = { worker: null, busy: false, id: 0, args: null };

function startWorker(): Worker {
  const w = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  w.onmessage = (e: MessageEvent<WorkerReply>) => { gen.busy = false; if (e.data.id === gen.id) done(e.data.puzzle); };
  w.onerror = () => { gen.worker = null; gen.busy = false; if (gen.args) done(generate(...gen.args)); };
  return w;
}

function request(): void {
  const st = settings();
  $('decoyVal').textContent = Math.round(st.decoy * 100) + '%';
  gen.id++;
  const args: GenerateArgs = [st.seed, st.level, st.decoy, st.diag, st.tech];
  gen.args = args;
  $('board').classList.add('busy');
  $('meta').textContent = 'Складываю лист…';
  try {
    // A newer request makes the running one pointless: drop it rather than queue behind it.
    if (gen.busy && gen.worker) { gen.worker.terminate(); gen.worker = null; }
    gen.worker ??= startWorker();
    gen.busy = true;
    const msg: WorkerRequest = { id: gen.id, args };
    gen.worker.postMessage(msg);
  } catch {
    gen.worker = null;
    gen.busy = false;
    done(generate(...args));
  }
}

function done(p: Puzzle | null): void {
  $('board').classList.remove('busy');
  if (!p) { $('meta').textContent = 'Не удалось подобрать сгибы для этих настроек. Попробуйте другой номер или меньше диагоналей.'; return; }
  ui.puzzle = p;
  show();
}

const KIND: Readonly<Record<MoveKind, string>> = { full: '', flap: ' · часть слоёв', tuck: ' · задвигание' };

function show(): void {
  const p = ui.puzzle;
  if (!p) return;
  const seed = p.seed;
  const color = ui.color ?? COLORS[(seed - 1) % COLORS.length]![1];
  document.documentElement.style.setProperty('--sheet', color);
  for (const b of $('swatches').children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset['c'] === color));

  // Print the number on a neutral front cell, as the real sheets do.
  const neutral = p.faces.map((f, i) => (Object.values(f[0]).every(v => v === 'N') ? i : -1)).filter(i => i >= 0);
  const numberAt = neutral.length ? neutral[(seed * 13) % neutral.length]! : -1;
  $('front').innerHTML = sheetSvg(p.faces, 0, color, numberAt, `${seed}.`);
  $('back').innerHTML = sheetSvg(p.faces, 1, color);
  $('capNo').textContent = `№ ${seed}`;

  // Measured in cells; a triangle is half a cell, a lone quarter is a quarter.
  const cnt = (c: 'B' | 'W') => p.faces.reduce((a, f) => a + f.reduce((t, face) => t + Object.values(face).filter(v => v === c).length, 0), 0) / 4;
  const kinds = (k: MoveKind) => p.folds.filter(f => f.kind === k).length;
  const ok = verify(p);
  $('meta').innerHTML =
    `<span>Сгибов <b>${p.folds.length}</b></span><span>Диагональных <b>${p.folds.filter(f => isDiagonal(f.t)).length}</b></span>` +
    `<span>Частью слоёв <b>${kinds('flap')}</b></span><span>Задвиганий <b>${kinds('tuck')}</b></span>` +
    `<span>Чёрных клеток <b>${fmt(cnt('B'))}</b></span><span>Белых клеток <b>${fmt(cnt('W'))}</b></span>` +
    `<span>Ложных <b>${p.decoys}</b></span>` +
    `<span>Оценка <span class="stars" aria-label="${p.stars} из 5">${'■'.repeat(p.stars)}${'□'.repeat(5 - p.stars)}</span></span>` +
    `<span>Проверка <b>${ok ? 'решаемо' : 'ошибка'}</b></span>`;

  const items = p.folds.map((f, i) => {
    const nb = bbox(p.states[i + 1]!);
    return `<li><span class="n">Шаг ${i + 1} · ${f.box.w}×${f.box.h} → ${nb.w}×${nb.h}${KIND[f.kind]}</span>${stepSvg(p.states[i]!, p.faces, f, color)}<p>${describe(f)}</p></li>`;
  });
  const last = p.states[p.states.length - 1]!;
  items.push(`<li class="final"><span class="n">Готово · 4×4</span><div class="final-pair">` +
    `<div>${stepSvg(last, p.faces, null, color, 'top')}Сверху: ${p.topColor === 'B' ? 'чёрная' : 'белая'}</div>` +
    `<div>${stepSvg(last, p.faces, null, color, 'bottom')}Снизу: ${p.topColor === 'B' ? 'белая' : 'чёрная'}</div></div></li>`);
  $('steps').innerHTML = items.join('');
  $('steps').hidden = !ui.showSol;
  $('solBox').hidden = ui.showSol;
  $('toast').textContent = '';
  const st = settings();
  store(STORAGE_KEY, JSON.stringify({ seed: st.seed, level: st.level, diag: st.diag, tech: st.tech, decoy: input('decoy').value, color: ui.color }));
}

/** The current puzzle as JSON: each cell is four letters for its quarters n, e, s, w (B black, W white, N sheet colour). */
function exportJson(p: Puzzle): string {
  const rows = (side: 0 | 1) => Array.from({ length: N }, (_, y) =>
    p.faces.slice(y * N, y * N + N).map(f => f[side].n + f[side].e + f[side].s + f[side].w).join(' '));
  return JSON.stringify({
    number: p.seed, level: p.level, diagonals: p.diag, techniques: p.tech, top: p.topColor,
    front: rows(0),
    back: rows(1),
    folds: p.folds.map(f => ({
      kind: f.kind, line: f.t, c: f.c, moves: f.side, dir: f.dir,
      ...(f.kind === 'tuck' ? { depth: f.depth } : {}),
      ...(f.kind !== 'full' ? { layers: [...f.flap].sort((a, b) => a - b) } : {}),
      text: describe(f),
    })),
  }, null, 2);
}

function init(): void {
  for (const [name, c] of COLORS) {
    const b = document.createElement('button');
    b.className = 'sw'; b.type = 'button'; b.dataset['c'] = c; b.style.background = c;
    b.setAttribute('aria-label', name); b.title = name;
    b.onclick = () => { ui.color = c; show(); };
    $('swatches').appendChild(b);
  }
  try {
    const saved = JSON.parse(load(STORAGE_KEY) ?? 'null') as Partial<Settings & { decoy: string; color: string | null }> | null;
    if (saved) {
      input('seed').value = String(saved.seed ?? 101);
      select('level').value = saved.level ?? 'mid';
      input('decoy').value = String(saved.decoy ?? 15);
      select('diag').value = String(saved.diag ?? 1);
      select('tech').value = String(saved.tech ?? 1);
      ui.color = saved.color ?? null;
    }
  } catch { /* ignore a broken saved state */ }
  const m = /^#n(\d+)$/.exec(location.hash);
  if (m) input('seed').value = m[1]!;

  input('seed').addEventListener('input', request);
  select('level').addEventListener('change', request);
  input('decoy').addEventListener('input', request);
  select('diag').addEventListener('change', request);
  select('tech').addEventListener('change', request);
  $('next').onclick = () => { input('seed').value = String(Math.min(999999, (parseInt(input('seed').value, 10) || 0) + 1)); request(); };
  $('prev').onclick = () => { input('seed').value = String(Math.max(1, (parseInt(input('seed').value, 10) || 2) - 1)); request(); };
  $('toggleSol').onclick = () => {
    ui.showSol = !ui.showSol;
    $('toggleSol').textContent = ui.showSol ? 'Скрыть решение' : 'Показать решение';
    $('toggleSol').setAttribute('aria-expanded', String(ui.showSol));
    show();
  };
  $('copy').onclick = () => {
    if (!ui.puzzle) return;
    navigator.clipboard.writeText(exportJson(ui.puzzle))
      .then(() => { $('toast').textContent = 'Задание скопировано в буфер обмена.'; })
      .catch(() => { $('toast').textContent = 'Браузер не дал доступ к буферу обмена. Попробуйте открыть страницу локально.'; });
  };
  request();
}

init();
