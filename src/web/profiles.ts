import type { Language } from '../core/language.ts';
import { messages } from './i18n.ts';
import { foldRange } from '../core/difficulty.ts';
import type { Level, Puzzle, Tech } from '../core/types.ts';

export const profiles = {
  A: { level: 'easy', diag: 0, tech: 0 },
  B: { level: 'mid', diag: 0, tech: 0 },
  C: { level: 'mid', diag: 1, tech: 0 },
  D: { level: 'mid', diag: 1, tech: 1 },
  E: { level: 'hard', diag: 2, tech: 1 },
  F: { level: 'hard', diag: 2, tech: 2 },
  G: { level: 'hard', diag: 3, tech: 1 },
  H: { level: 'hard', diag: 3, tech: 2 },
} as const satisfies Record<string, { level: Level; diag: number; tech: Tech }>;

export type Profile = keyof typeof profiles;
export const profileIds = Object.keys(profiles) as Profile[];
export const defaultProfile: Profile = 'D';
export const maxSeed = 999999;

export interface PuzzleCode {
  profile: Profile;
  seed: number;
  decoyPercent: number;
  doubleSided?: boolean;
}

export function formatCode({ profile, seed, decoyPercent, doubleSided }: PuzzleCode): string {
  return `${doubleSided ? '%' : ''}${profile}-${seed}${decoyPercent ? `-${decoyPercent}` : ''}`;
}

export function parseCode(value: string): PuzzleCode | null {
  const match = /^(%)?([A-H])\s*-\s*(\d{1,6})(?:\s*-\s*(\d{1,2}))?(?:\s*-\s*(2S))?$/i.exec(value.trim());
  if (!match || Number(match[3]) === 0) return null;
  const decoyPercent = Number(match[4] ?? 0);
  if (decoyPercent > 50 || decoyPercent % 5 !== 0) return null;
  return { profile: match[2]!.toUpperCase() as Profile, seed: Number(match[3]), decoyPercent, ...((match[1] || match[5]) ? { doubleSided: true } : {}) };
}

export function puzzleCode(p: Puzzle): string {
  const profile = profileIds.find(id => {
    const { level, diag, tech } = profiles[id];
    return p.level === level && p.diag === diag && p.tech === tech;
  });
  const percent = p.decoy * 100;
  const decoyPercent = Math.round(percent);
  return profile && Math.abs(percent - decoyPercent) < 1e-8 && decoyPercent >= 0 && decoyPercent <= 50 && decoyPercent % 5 === 0
    ? formatCode({ profile, seed: p.seed, decoyPercent, doubleSided: !p.singleSided }) : String(p.seed);
}

export function profileLabel(id: Profile, language: Language = 'ru', singleSided = true): string {
  const { level, diag, tech } = profiles[id];
  const [lo, hi] = foldRange(level, diag, tech, singleSided);
  const count = lo === hi ? String(lo) : `${lo}–${hi}`;
  const text = messages[language];
  return `${id} · ${text.foldCount(count, hi)} · ${text.diagonals[diag]} · ${text.techniques[tech]}`;
}
