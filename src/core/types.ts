// Shared data shapes of the generator. See docs/algorithm.md §3–4 for what they mean.

export type Quarter = 'n' | 'e' | 's' | 'w';

/** Affine map [a, b, c, d, tx, ty]: (x, y) → (a·x + b·y + tx, c·x + d·y + ty). */
export type Affine = readonly [number, number, number, number, number, number];

/** One facet of paper lying at some position of the folded state. */
export interface Layer {
  /** Facet id: cellId * 4 + quarter index. */
  f: number;
  /** Cell id: y * 8 + x in the flat sheet. */
  id: number;
  /** Quarter of the cell this facet is. */
  q: Quarter;
  /** Which face looks up: 0 = front, 1 = back. */
  up: 0 | 1;
  /** Map from sheet coordinates to current coordinates. */
  t: Affine;
}

/** A quarter-sized spot of the folded state and the layers piled on it, bottom → top. */
export interface Position {
  X: number;
  Y: number;
  stack: Layer[];
}

/** Folded state: position key "X,Y" → position. */
export type State = Map<string, Position>;

/** v: x = c, h: y = c, d: x − y = c ("\"), a: x + y = c ("/"). */
export type LineType = 'v' | 'h' | 'd' | 'a';
export type Side = 1 | -1;
export type Direction = 'over' | 'under';

/** Extent of a state in cells, inclusive. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
}

interface MoveBase {
  t: LineType;
  c: number;
  /** Which half-plane moves: the one where LINE[t] > c·S (+1) or < c·S (−1). */
  side: Side;
  dir: Direction;
  /** Extent before the move, used for instructions. */
  box: Box;
}

/** Everything on the moving side folds. */
export interface FullMove extends MoveBase {
  kind: 'full';
}

/** One flap (top or bottom segment) on the moving side folds. */
export interface FlapMove extends MoveBase {
  kind: 'flap';
  flap: Set<number>;
  partial: true;
}

/** The moving part slides in between layers at `depth`. */
export interface TuckMove extends MoveBase {
  kind: 'tuck';
  flap: Set<number>;
  /** True when only a flap moves, false when everything on the moving side does. */
  partial: boolean;
  depth: number;
}

export type Move = FullMove | FlapMove | TuckMove;
export type MoveKind = Move['kind'];

export type Paint = 'B' | 'W' | 'N';
export type Solid = 'B' | 'W';
export type FacePaint = Record<Quarter, Paint>;
/** Print of one cell: [front, back]. */
export type CellPaint = [FacePaint, FacePaint];

export type Level = 'easy' | 'mid' | 'hard';
/** 0: full folds only, 1: + flap folds, 2: + tucks. */
export type Tech = 0 | 1 | 2;

export interface Puzzle {
  seed: number;
  level: Level;
  decoy: number;
  diag: number;
  tech: Tech;
  folds: Move[];
  /** State before each move, then the final state: folds.length + 1 entries. */
  states: State[];
  /** Print of every cell, indexed by cell id. */
  faces: CellPaint[];
  topColor: Solid;
  decoys: number;
  stars: number;
}
