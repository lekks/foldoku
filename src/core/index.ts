// Public API of the Foldoku generator core. No DOM: runs in browsers, workers and Node alike.

export type * from './types.ts';
export { N, T, S, QS, QI, LINE, decode, isDiagonal } from './geometry.ts';
export { initState, bbox, isSquare } from './state.ts';
export { applyFold, movesAt } from './fold.ts';
export { isValid } from './validity.ts';
export { LEVELS, generate, verify } from './generate.ts';
export { describe, plural } from './describe.ts';
