import { createHash } from 'node:crypto';
import type { Level, Puzzle, Tech } from '../src/core/index.ts';

export type Case = { seed: number; level: Level; decoy: number; diag: number; tech: Tech; singleSided?: boolean };

/** Everything that defines a puzzle for a player: the print and the solution. */
export function canonical(p: Puzzle): string {
  return JSON.stringify({
    folds: p.folds.map(f => [
      f.kind, f.t, f.c, f.side, f.dir,
      f.kind === 'tuck' ? f.depth : null,
      f.kind === 'full' ? null : f.partial,
      f.kind === 'full' ? null : [...f.flap].sort((a, b) => a - b),
    ]),
    faces: p.faces,
    top: p.topColor,
    decoys: p.decoys,
    stars: p.stars,
  });
}

export const digest = (p: Puzzle): string => createHash('sha256').update(canonical(p)).digest('hex').slice(0, 16);

export const caseName = (c: Case): string => `seed ${c.seed} ${c.level} diag ${c.diag} tech ${c.tech} decoy ${c.decoy}${c.singleSided ? ' single-sided' : ''}`;

/** Cases spanning the levels, diagonal counts, techniques, and print modes. */
export function sampleCases(): Case[] {
  const out: Case[] = [];
  for (const tech of [0, 1, 2] as const) for (const diag of [0, 1, 2]) for (const level of ['easy', 'mid', 'hard'] as const) {
    if (tech === 2 && level === 'hard') continue;
    out.push({ seed: 7 + diag * 10 + tech * 100, level, decoy: 0.15, diag, tech });
  }
  out.push(
    { seed: 101, level: 'mid', decoy: 0.15, diag: 1, tech: 1, singleSided: true },
    { seed: 101, level: 'mid', decoy: 0.15, diag: 3, tech: 2, singleSided: true },
    { seed: 101, level: 'hard', decoy: 0.2, diag: 2, tech: 2 },
  );
  return out;
}
