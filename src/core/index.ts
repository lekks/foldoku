// Shared puzzle types and geometry used by the Foldopia interface and tests.

export type * from './types.ts';
export { N, T, S, QS, QI, LINE, decode, isDiagonal } from './geometry.ts';
export { initState, bbox, isSquare } from './state.ts';
export { applyFold, movesAt } from './fold.ts';
export { isValid } from './validity.ts';
export { describe, plural } from './describe.ts';
