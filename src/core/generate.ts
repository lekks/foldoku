import { applyFold, onSide } from './fold.ts';
import { ap, isDiagonal, mirror, N, QS, T } from './geometry.ts';
import { pick, rng, shuffle, type Rng } from './rng.ts';
import { bbox, candidates, components, initState, isSegment, isSquare } from './state.ts';
import type { CellPaint, Direction, Level, LineType, Move, MoveKind, Puzzle, Quarter, Side, State, Tech, TuckMove } from './types.ts';
import { isValid } from './validity.ts';

// Changing anything below that draws from the RNG changes every sheet for a given seed. See docs/roadmap.md §1.4.

export const LEVELS: Readonly<Record<Level, readonly [number, number]>> = { easy: [2, 3], mid: [4, 5], hard: [6, 8] };

const isDiag = (f: Move): boolean => isDiagonal(f.t);

/** Proposes a full or flap move on a line of type t; null when the drawn kind has nothing to fold there. */
function proposeMove(R: Rng, m: State, t: LineType, kind: 'full' | 'flap'): Move | null {
  const cs = candidates(m, t);
  if (!cs.length) return null;
  const c = pick(R, cs);
  const side: Side = R() < 0.5 ? 1 : -1;
  const dir: Direction = R() < 0.62 ? 'over' : 'under';
  const box = bbox(m);
  if (kind === 'full') return { kind: 'full', t, c, side, dir, box };
  const mov = components(m, p => onSide({ t, c, side }, p.X, p.Y));
  if (mov.length < 2) return null;
  const ok = mov.filter(k => isSegment(m, k, dir === 'over'));
  if (!ok.length) return null;
  return { kind: 'flap', t, c, side, dir, box, flap: pick(R, ok), partial: true };
}

/**
 * A random physically possible tuck from this state on lines of the given types, or null: the moving part
 * (a flap, or everything on that side) slides in between layers instead of landing on top or underneath.
 */
function findTuck(R: Rng, m: State, types: readonly LineType[]): TuckMove | null {
  const box = bbox(m);
  const combos: { t: LineType; c: number; side: Side; dir: Direction }[] = [];
  for (const t of types) for (const c of candidates(m, t)) for (const side of [1, -1] as const) {
    for (const dir of ['over', 'under'] as const) combos.push({ t, c, side, dir });
  }
  for (const { t, c, side, dir } of shuffle(R, combos)) {
    const mov = components(m, p => onSide({ t, c, side }, p.X, p.Y));
    const flaps: [Set<number>, boolean][] = mov.length > 1
      ? mov.filter(k => isSegment(m, k, dir === 'over')).map(k => [k, true])
      : [];
    flaps.push([new Set(mov.flatMap(k => [...k])), false]);
    const r = mirror(t, c);
    for (const [flap, partial] of shuffle(R, flaps)) {
      let maxDepth = 0;
      for (const p of m.values()) {
        if (!onSide({ t, c, side }, p.X, p.Y) || !p.stack.some(e => flap.has(e.f))) continue;
        const q = m.get(ap(r, p.X, p.Y).join(','));
        if (q) maxDepth = Math.max(maxDepth, q.stack.length);
      }
      const depths: number[] = [];
      for (let d = 1; d < maxDepth; d++) depths.push(d);
      for (const depth of shuffle(R, depths)) {
        const f: TuckMove = { kind: 'tuck', t, c, side, dir, box, flap, partial, depth };
        if (isValid(applyFold(m, f))) return f;
      }
    }
  }
  return null;
}

interface Attempt {
  folds: Move[];
  states: State[];
  m: State;
}

/** One random walk from the flat sheet; succeeds only if it ends exactly as the T×T square with all quotas met. */
function tryFolds(R: Rng, lo: number, hi: number, diag: number, tech: Tech): Attempt | null {
  let m = initState();
  const folds: Move[] = [], states: State[] = [m];
  for (let step = 0; step < hi; step++) {
    const diagLeft = diag - folds.filter(isDiag).length;
    const wantDiag = diagLeft > 0 && (diagLeft >= hi - step || R() < 0.45);
    const t = pick(R, wantDiag ? ['d', 'a'] as const : ['v', 'h'] as const);
    const roll = R();
    // One tuck per attempt: searching for one is the slow part.
    const tucked = folds.some(f => f.kind === 'tuck');
    const kind: MoveKind = tech >= 2 && !tucked && step > 0 && roll < 0.35 ? 'tuck' : tech >= 1 && roll < 0.6 ? 'flap' : 'full';
    let f: Move | null = kind === 'tuck' ? findTuck(R, m, wantDiag ? ['d', 'a'] : ['v', 'h']) : proposeMove(R, m, t, kind);
    if (!f && kind !== 'full') f = proposeMove(R, m, t, 'full');
    if (!f) return null;
    const next = applyFold(m, f);
    // TODO(roadmap 1.7): this guard can never fire; the retry loop ends only because full folds keep being drawn.
    if (f.kind === 'flap' && !isValid(next)) { step--; if (folds.length + 1 > hi * 3) return null; continue; }
    m = next;
    folds.push(f);
    states.push(m);
    const nb = bbox(m);
    if (m.size < T * T * 4 || nb.w < T || nb.h < T) return null;
    if (isSquare(m)) {
      const okDiag = folds.filter(isDiag).length === diag;
      const okTech = (tech < 1 || folds.some(g => g.kind === 'flap' || g.kind === 'tuck')) && (tech < 2 || folds.some(g => g.kind === 'tuck'));
      return folds.length >= lo && okDiag && okTech ? { folds, states, m } : null;
    }
  }
  return null;
}

const HALVES: readonly (readonly Quarter[])[] = [['n', 'e'], ['e', 's'], ['s', 'w'], ['w', 'n']];

/** A solvable sheet for these settings, or null if the search gave up. Deterministic for equal inputs. */
export function generate(seed: number, level: Level = 'mid', decoy = 0.15, diag = 0, tech: Tech = 0): Puzzle | null {
  const R = rng(seed * 7919 + 17 + diag * 104729 + tech * 1299709);
  let [lo, hi] = LEVELS[level];
  // A diagonal fold always needs grid folds around it, and a tuck barely shrinks the sheet,
  // so short levels grow to fit them.
  lo = Math.max(lo, diag + 2, tech >= 2 ? 4 : 0);
  hi = Math.max(hi, lo + 1);
  let res: Attempt | null = null;
  // Exact fold counts are rare for some mixes, so the range widens until something fits.
  for (let relax = 0; !res && relax < 6; relax++) {
    for (let attempt = 0; !res && attempt < 3000; attempt++) res = tryFolds(R, Math.max(2, lo - relax), hi + relax, diag, tech);
  }
  if (!res) return null;
  const { folds, states, m } = res;

  // Paint: quarters looking up from the final square get one colour, quarters looking down the other.
  const topColor = R() < 0.5 ? 'B' : 'W', botColor = topColor === 'B' ? 'W' : 'B';
  const faces: CellPaint[] = Array.from({ length: N * N }, () => [{ n: 'N', e: 'N', s: 'N', w: 'N' }, { n: 'N', e: 'N', s: 'N', w: 'N' }]);
  for (const p of m.values()) {
    const top = p.stack[p.stack.length - 1]!, bot = p.stack[0]!;
    faces[top.id]![top.up][top.q] = topColor;
    faces[bot.id]![bot.up === 0 ? 1 : 0][bot.q] = botColor;
  }
  // Decoys: whole hidden faces, and with diagonals on, sometimes just a triangular half.
  let decoys = 0;
  for (const cell of faces) for (const face of cell) {
    if (!Object.values(face).every(v => v === 'N')) continue;
    if (R() < decoy) {
      const col = R() < 0.5 ? 'B' : 'W';
      const qs = diag && R() < 0.35 ? HALVES[Math.floor(R() * 4)]! : QS;
      for (const q of qs) face[q] = col;
      decoys++;
    }
  }

  const count = (k: MoveKind) => folds.filter(f => f.kind === k).length;
  let switches = 0;
  for (let i = 1; i < folds.length; i++) if (folds[i]!.t !== folds[i - 1]!.t) switches++;
  const score = folds.length + folds.filter(f => f.dir === 'under').length * 0.6 + switches * 0.4
    + folds.filter(isDiag).length * 1.2 + count('flap') * 1 + count('tuck') * 1.8 + decoy * 6;
  const stars = Math.max(1, Math.min(5, Math.round((score - 1.5) / 2)));
  return { seed, level, decoy, diag, tech, folds, states, faces, topColor, decoys, stars };
}

/** Replays the moves, confirms every state is a real flat fold and both outer faces of the square are solid. */
export function verify(p: Puzzle): boolean {
  let m = initState();
  for (const f of p.folds) {
    m = applyFold(m, f);
    if (!isValid(m)) return false;
  }
  if (!isSquare(m)) return false;
  const bot = p.topColor === 'B' ? 'W' : 'B';
  for (const s of m.values()) {
    const t = s.stack[s.stack.length - 1]!, b = s.stack[0]!;
    if (p.faces[t.id]![t.up][t.q] !== p.topColor || p.faces[b.id]![b.up === 0 ? 1 : 0][b.q] !== bot) return false;
  }
  return true;
}
