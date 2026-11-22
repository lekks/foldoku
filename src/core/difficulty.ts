import type { Level, Tech } from './types.ts';

export function foldRange(level: Level, diag: number, tech: Tech, single: boolean): [number, number] {
  const min = Math.max(diag + 2, tech === 2 ? 4 : 2);
  const easyMax = Math.max(3, min, single && diag > 0 ? 4 : 0);
  const midMax = Math.max(5, easyMax + 1);
  if (level === 'easy') return [min, easyMax];
  if (level === 'mid') return [easyMax + 1, midMax];
  return [midMax + 1, 8];
}
