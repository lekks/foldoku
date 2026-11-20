# Foldoku: generator algorithm

This document describes how the Foldoku generator in `src/core/` generates puzzle
sheets in the style of *Manifold* by Jérôme Morin-Drouin (Russian edition: «Квадригами»).
Foldoku is an independent project, not affiliated with that puzzle's publishers. It is written for
two kinds of readers: a developer who will rewrite this as production code, and an AI
agent that has to reason about or extend the generator. Identifiers in `code` are the
names used in the source; the code map below says where each one lives.

Russian UI terms appear in parentheses so the document can be mapped onto the page.

### Code map

| file | contents | sections |
|------|----------|----------|
| `src/core/types.ts` | `Layer`, `Position`, `State`, `Move` (`FullMove` / `FlapMove` / `TuckMove`), `Puzzle` | §3.5, §4 |
| `src/core/rng.ts` | `rng` (mulberry32), `shuffle`, `pick` | §6.4 |
| `src/core/geometry.ts` | `N`, `T`, `S`, quarters, `decode`, `NB`, `LINE`, `mirror`, `ap`, `compose` | §3 |
| `src/core/state.ts` | `initState`, `bbox`, `isSquare`, `candidates`, `components`, `isSegment` | §3.5, §4.2 |
| `src/core/fold.ts` | `applyFold`, `onSide`, `movesAt` | §4 |
| `src/core/validity.ts` | `isValid` | §5 |
| `src/core/wasm/generator.cpp` | Browser generator: folds, validity, search, painting | §4–8 |
| `src/core/generate.ts` | TypeScript benchmark reference and independent test verifier | §4.3, §6–8 |
| `src/core/describe.ts` | Russian move instructions | §9 |
| `src/web/render.ts` | `sheetScene`, `stepScene` → `toSvg` | §9 |
| `src/web/print.ts`, `pdf.ts`, `labels.ts` | two-sided PDF and calibration sheet | [printing.md](printing.md) |
| `src/web/app.ts`, `worker.ts` | page logic, generation in a Web Worker | §6.5 |
| `test/` | checker fixtures, property tests, golden snapshots | §5, §10 |

---

## 1. The puzzle

- A sheet is a square grid of **8×8 cells**. Both sides are printed.
- Each printed cell (or a triangular part of it) is **black**, **white**, or **neutral**
  (the sheet colour and optional pattern). Black and white are logical paint values
  rendered using the selected dark and light shades.
- The player may fold only along **grid lines** and along **cell diagonals**.
- Goal: fold the sheet into a **4×4 square** whose top face is entirely one colour and
  whose bottom face is entirely the other (black on one side, white on the other).

The generator must output a sheet (front + back print) that is **guaranteed solvable**,
plus one solution as a list of moves.

## 2. Core idea: generate forward, paint afterwards

The generator never designs a picture and then searches for a solution. It does the
opposite:

1. Start from a blank, flat sheet.
2. Apply random but physically valid folding moves until the paper forms exactly a
   4×4 square.
3. Look at the finished square. Every piece of paper visible from above gets colour
   `topColor`; every piece visible from below gets the other colour.
4. Unfold mentally (we already know where every piece came from) and print those
   colours onto the corresponding faces of the flat sheet. Everything else is neutral,
   apart from optional decoys.

Solvability holds by construction: the recorded moves are a solution. `verify()` replays
them as an independent check.

```
blank sheet ──random valid moves──▶ 4×4 stack ──paint outer faces──▶ printed sheet
     ▲                                                                   │
     └──────────────────── the same moves solve it ◀────────────────────┘
```

## 3. Geometry model

### 3.1 Facets: quarter-triangles

Each cell is cut by both diagonals into four triangles called **quarters**, named by the
side of the cell they touch: `n`, `e`, `s`, `w` (index `QI`: n=0, e=1, s=2, w=3).

```
 +-------+
 |\  n  /|
 | \   / |
 |w  X  e|
 | /   \ |
 |/  s  \|
 +-------+
```

A quarter is the smallest piece of paper the model knows. The sheet has
8·8·4 = **256 facets**. A facet id is

```
f = cellId * 4 + QI[q],   cellId = y * 8 + x   (x to the right, y downwards)
```

**Why quarters:** any fold line the puzzle allows (a grid line, or a 45° line through
lattice points) is a union of quarter edges. A reflection across such a line maps every
quarter of the plane onto another quarter of the plane. So the positions of folded paper
are always whole quarters, and no facet is ever cut by a fold.

### 3.2 Coordinates

All coordinates live on an integer lattice with `S = 12` units per cell. A quarter
position is identified by its **centroid**:

| quarter | centroid offset inside the cell |
|---------|---------------------------------|
| n       | (6, 2)                          |
| e       | (10, 6)                         |
| s       | (6, 10)                         |
| w       | (2, 6)                          |

`decode(X, Y)` turns a centroid back into `(cell x, cell y, quarter)`. Centroids never
lie on a fold line (checked arithmetically), so every facet is strictly on one side of
any line.

Edge midpoints are also integers on this lattice. For example, n's outer edge has its
midpoint at (6, 0), and the inner edge between n and e is at (9, 3). `S = 12` was
chosen so that these midpoints are integers.

### 3.3 Adjacency of the flat sheet: `NB`

`NB[f]` is a precomputed list of `[g, mx, my]`: the facet `g` that shares an edge with
`f` in the **flat** sheet, and the midpoint of that edge in sheet coordinates. Every
quarter has 2 inner neighbours (in the same cell) and up to 1 outer neighbour (in the
adjacent cell). The sheet border has no neighbour, so it is a free edge.

`NB` is the only description of how the paper is connected. Connectivity never changes,
because paper is not cut.

### 3.4 Fold lines

| type `t` | line        | shape | mirror matrix `[a,b,c,d,tx,ty]`, `k = c·S` |
|----------|-------------|-------|--------------------------------------------|
| `v`      | x = c       | │     | `[-1,0, 0,1, 2k,0]`                        |
| `h`      | y = c       | ─     | `[1,0, 0,-1, 0,2k]`                        |
| `d`      | x − y = c   | ╲     | `[0,1, 1,0, k,-k]`                         |
| `a`      | x + y = c   | ╱     | `[0,-1, -1,0, k,k]`                        |

`LINE[t](X, Y)` gives the signed quantity that is compared with `c·S`. A move has a
`side` of `+1` or `−1`, which names the half-plane that **moves**: `onSide(f, X, Y)`.

`candidates(m, t)` lists every integer `c` whose line strictly cuts the current shape,
so both sides are non-empty.

### 3.5 State

```
state m : Map< "X,Y" → { X, Y, stack } >
stack   : array of layers, bottom → top
layer   : { f, id, q, up, t }
          f  facet id
          id cell id (f >> 2)          q  original quarter name
          up 0 = front face looks up, 1 = back face looks up
          t  affine map [a,b,c,d,tx,ty]: sheet coordinates → current coordinates
```

- Positions are never renormalised, so coordinates can become negative after folds.
  `bbox(m)` gives the current extent in cells.
- `t` is composed with each mirror the layer undergoes (`compose(r, t)`). It is needed to
  find where a facet's *edges* are now (§5), not only its centroid.
- `up` flips on every reflection.
- Initial state (`initState`): 256 positions, each with one layer, `up = 0`, `t` = identity.

## 4. Moves

Every move reflects some layers across a line. The moving layers **flip** (`up` toggles)
and their **order reverses**, because a pile turned over lands upside down. A move
record looks like:

```
{ t, c, side, dir: 'over' | 'under', kind: 'full' | 'flap' | 'tuck',
  box,            // bbox before the move (for instructions)
  flap?: Set<f>,  // flap / tuck: which facets move
  partial?: bool, // the flap is not everything on the moving side
  depth?: int }   // tuck only
```

`applyFold(m, f)` implements all three kinds.

### 4.1 Full fold ("целый сгиб")

All layers on the moving side move. At each destination position:

- `over`: `stack = stationary ++ reverse(flipped moving)`
- `under`: `stack = reverse(flipped moving) ++ stationary`

Reflecting a flat-folded pile across a line, with everything on one side, is always
physically possible (a *simple fold*). It is not checked.

### 4.2 Flap fold ("сгиб части слоёв")

Only one **flap** moves:

1. `components(m, onMovingSide)` splits the paper on the moving side into connected
   pieces. Connectivity uses `NB` restricted to the moving side, so paper connected
   only through the stationary side forms separate pieces.
2. A piece qualifies if it is a **top segment** for `over` (or a bottom segment for
   `under`) at every position: no other layer lies above it (`isSegment`). This makes
   it possible to lift it off.
3. A move counts as a flap only if there were at least two pieces. Otherwise it is
   just a full fold.
4. The flap lands on top of the destination stacks (`over`) or underneath them (`under`).
5. The resulting state must pass `isValid` (§5). Otherwise the step is retried.

The flap's attachment to the rest of the paper runs only along the fold line, because
it is a connected component of one side. So the motion is a rotation about that line.

### 4.3 Tuck ("задвигание внутрь")

Instead of landing on top or underneath, the moving part is inserted **between** layers:

- `over`: at each destination with `n` layers, insert at index `max(0, n − depth)`,
  i.e. under the top `depth` layers.
- `under`: insert at index `min(n, depth)`, i.e. above the bottom `depth` layers.

The moving part is either a qualifying flap (as in §4.2) or everything on the moving
side.

`findTuck(R, m, types)` searches **lazily**:

```
for (t, c, side, dir) in shuffle(all lines of the allowed types × sides × dirs):
    for flap in shuffle(qualifying flaps ∪ {whole moving side}):
        maxDepth = max stack height at the flap's landing positions
        for depth in shuffle(1 .. maxDepth−1):
            if isValid(applyFold(m, move)): return move
return null
```

Physical model of a tuck: the final state must be a valid flat fold (§5). The motion
itself is assumed possible because paper flexes enough to slide the flap into the
pocket from the hinge side. The motion is **not** simulated (see §10).

## 5. Flat-fold validity check: `isValid(m)`

This check is what makes flaps and tucks safe. It decides whether a given layer order
can exist without paper passing through paper. It uses the classical local conditions
from flat-folding theory (Justin; Demaine & O'Rourke), applied to every edge of the
folded arrangement.

**Collecting.** For every pair of flat-sheet neighbours `(f, g)`, compute the current
position of their shared edge: `ap(f.t, mx, my)`. That midpoint identifies an edge of
the folded arrangement, which borders two positions `P` and `Q`.

- If `f` and `g` lie at the **same** position, the paper is folded at this edge. This
  is a **crease** on that position's side: interval `[min(h_f,h_g), max(h_f,h_g)]` in
  that stack.
- Otherwise they lie at the two positions on either side of the edge, and the paper
  continues straight through. This is a **through pair** `(P, h_P, Q, h_Q)`.

**Conditions** (any violation means invalid):

1. **Taco-taco.** On one side of one edge, crease intervals must be nested or disjoint,
   never interleaved (`a < c < b < d`). Two creases bending the same way at the same
   line cannot cross.
2. **Taco-tortilla.** No through layer may lie strictly inside a crease interval on the
   same side. A layer running past the edge would cut the fold.
3. **Tortilla-tortilla.** Through pairs keep their relative order. Sorted by `h_P`, the
   `h_Q` values must also increase, because layers cannot swap places where they cross
   an edge.

Creases on opposite sides of the same edge do not constrain each other. Each position
is a total order, so stacking within a position is consistent by construction.

Cost: about 384 neighbour pairs plus a quadratic pass per edge over a few creases.
That is well under a millisecond per call.

Tests used during development, which are not yet in the repo:
- All 1000 states produced by full folds pass.
- Randomly shuffling one 4-layer stack is rejected in 291 of 300 cases (the rest are
  most likely the identity shuffle).
- An impossible tuck is rejected: tucking a folded half between its own two layers.

## 6. Search: `generate` → `tryFolds`

### 6.1 Parameters

| UI control                 | parameter | values                                               |
|----------------------------|-----------|------------------------------------------------------|
| Номер задания              | `seed`    | 1 … 999999                                           |
| Сложность                  | `level`   | `easy` [2,3], `mid` [4,5], `hard` [6,8] (`LEVELS`)    |
| Диагонали                  | `diag`    | exact number of diagonal folds, 0–3                  |
| Приёмы                     | `tech`    | 0 full only; 1 + flaps (≥1 required); 2 + tucks (≥1 tuck required) |
| Ложные клетки              | `decoy`   | probability 0–0.5                                    |

The fold range `[lo, hi]` is adjusted before searching:

```
lo = max(levelLo, diag + 2, tech ≥ 2 ? 4 : 0)
hi = max(levelHi, lo + 1)
```

A diagonal needs grid folds around it to end as a square, and a tuck barely shrinks
the sheet. Shorter ranges were measured to be very slow or empty.

### 6.2 One attempt: `tryFolds(R, lo, hi, diag, tech)`

```
m = initState()
repeat up to hi steps:
    wantDiag = diagonals still owed AND (no room left for them OR R() < 0.45)
    t = random of (wantDiag ? {d, a} : {v, h})
    roll = R()
    kind = tuck if tech ≥ 2 and no tuck yet and step > 0 and roll < 0.35
           flap if tech ≥ 1 and roll < 0.6
           full otherwise
    move = findTuck(...) | proposeMove(R, m, t, kind); fallback: a full move on t
    full fold: c uniform among candidates, side ±1 at 50/50, dir over at 0.62
    flap move that fails isValid → retry this step
    apply move
    prune: fewer than 64 positions, or bbox narrower than 4 in either direction → fail
    if shape is exactly the 4×4 square:
        succeed if count ≥ lo, diagonal count = diag, and technique quotas are met
        else fail
fail
```

The pruning is sound because a fold never increases the number of occupied positions:
it is a union of the stationary part and the reflected moving part.

### 6.3 Outer loop

```
for relax in 0..5:
    for attempt in 1..3000:
        res = tryFolds(R, max(2, lo − relax), hi + relax, diag, tech)
        if res: stop
```

Relaxing widens the allowed fold count when the exact range is too rare. The UI shows
the real count.

### 6.4 Randomness and determinism

`rng` is mulberry32 seeded with `seed·7919 + 17 + diag·104729 + tech·1299709`. The same
inputs on the **same code version** give the same puzzle. `decoy` is not part of the
seed, and decoys are drawn after the folds, so the decoy slider changes the print
but not the solution. `level` changes the solution only through the search bounds.

### 6.5 Measured performance (node, prototype)

All 36 combinations of level × diag × tech: 0 failures, 0 verification errors.
Typical time is 5–300 ms. Worst cases: about 3 s for hard with tucks, and about 6 s
for 3 diagonals plus tucks. In the page, generation runs in a Web Worker
(`src/web/worker.ts`, bundled into the page as a string and started from a Blob URL).
A newer request terminates the running worker. In headless Chrome the worker answers
in about 0.26 s for the default settings.

## 7. Painting the sheet

```
faces[cellId][side][quarter] ∈ {'B','W','N'}      side 0 = front, 1 = back
for each position p of the final 4×4:
    top = p.stack.last;  faces[top.id][top.up][top.q]     = topColor
    bot = p.stack.first; faces[bot.id][1 − bot.up][bot.q] = other colour
```

`topColor` is random. Exactly 64 quarter faces get each colour, i.e. 16 cells' worth on
each side.

**Decoys ("ложные клетки").** For every face that is entirely neutral, with probability
`decoy`: paint it fully black or white. When diagonals are on, 35 % of these become
a triangular half instead. Decoys only go on faces that end up hidden inside the
square, so they cannot break the solution.

## 8. Difficulty score

```
score = folds + 0.6·under + 0.4·(changes of line type between consecutive moves)
      + 1.2·diagonal + 1.0·flap + 1.8·tuck + 6·decoy
stars = clamp(round((score − 1.5) / 2), 1, 5)
```

The weights are hand-picked and not calibrated (§10).

## 9. Output and presentation

- **Front** is printed as is. **Back** is shown as seen after turning the sheet like a
  page: column `x` becomes `7 − x`, and quarters `e` and `w` swap (`MIRQ`). This
  matches duplex printing flipped on the long edge.
- The sheet number is printed on a fully neutral front cell, as on the real sheets.
- Drawings are built once as scenes of polygons and lines (`sheetScene`, `stepScene`
  in `src/web/render.ts`) and written out either as SVG for the page (`toSvg`) or as
  PDF for printing ([printing.md](printing.md)).
- Step diagrams (`stepScene`) show the top face of the stack before each move, with
  the moving part faded. The fold line is drawn as a valley line (`6 4` dashes) for
  `over` or a mountain line (`8 3 2 3`) for `under`.
- Instructions (`describe`) count rows and columns relative to the current bbox and
  use Russian plural forms (`plural`).
- JSON export: per cell, four letters in n, e, s, w order for each side, plus the move
  list (`kind`, `line`, `c`, `moves`, `dir`, `depth`, `layers`, `text`).
- The C++ generator replays the moves and checks each intermediate state before
  returning a puzzle. The independent TypeScript verifier also checks the painted
  outer faces in tests.

## 10. Limitations and known problems

### Correctness and physics
1. **Tuck motion is not simulated.** Only the state after the move is validated. A
   tuck that is valid as a final state may still be awkward or impossible to perform
   with real paper, for example a pocket closed on three sides.
2. **No proof that the local checks are sufficient** for our discretisation. They are
   the standard necessary conditions and caught every counter-example tried, but
   there is no exhaustive test.
3. **Paper thickness is ignored.** Stacks can get deep (16+ layers at one position).
   Real 8×8 paper with many layers will not fold flat, and tucks into thick stacks are
   hard. There is no limit on layer count.
4. **Flap retry guard does nothing.** In `tryFolds`, an invalid flap does `step--` and
   checks `folds.length + 1 > hi * 3`, which can never be true. The loop still ends
   with probability 1, because a full fold is drawn with probability ≥ 0.4 on each
   retry, but it has no hard bound. Fix with a real retry counter.

### Puzzle quality
5. **Uniqueness and shortcuts are not checked.** A sheet generated with 8 moves may have
   a 3-move solution. The difficulty score describes the *generated* path, not the
   easiest one, so "hard" may be easy.
6. **Wasted moves.** Nothing prevents a move that undoes the previous one, such as
   folding back along the same line. This inflates the fold count and the score.
7. **Uncalibrated difficulty.** The score weights are guesses that have not been
   compared with the 100 levels of the original game or with player data.
8. **Visual hints.** Painted regions often show the fold structure directly, for
   example a solid 4×4 block in one corner. Real level design hides this better.
9. **Instructions are approximate.** "Правая нижняя часть по диагонали" does not say
   exactly where the line is. Diagrams show only the top face, so `under` flaps and
   tucks are visible only from the text.

### Engineering
10. **Thin test coverage.** `test/` has checker fixtures, property tests and golden
    snapshots over a sample of 24 settings, and print registration tests, but no unit
    tests of geometry helpers or rendering yet.
11. **Determinism is tied to the code.** Any change in the order of RNG calls changes
    every sheet with a given number. Published puzzles must be stored as data, or the
    generator must be versioned.
12. **Search is rejection sampling.** Time varies a lot (ms to seconds) and depends on
    luck. `relax` changes the fold range silently.
13. **Restricted move families.** A flap is a single connected component, never a
    union. A tuck has one uniform depth across all positions. There is at most one tuck
    per puzzle. There are no reverse folds, squash folds or slits.
14. **Browser coverage.** The WebAssembly worker path has a headless Chrome smoke
    check outside CI. A worker or WASM startup failure is reported in the interface.

## 11. Improvement ideas

Roughly in order of value.

1. **Module and tests.** Move the core into an ES module (`core/`) with
   `node:test` suites:
   - checker fixtures: known-valid and known-invalid states, including the
     counter-examples from §5;
   - property tests over many seeds: `verify(p) === true`, exactly 64 quarters of each
     colour, determinism for a fixed seed;
   - snapshot tests of a few sheets per generator version.
2. **Versioned output.** Add `generatorVersion` to every puzzle. Store accepted puzzles
   (sheet + solution) as JSON, so a printed book never depends on regeneration.
3. **Solver.** Write a breadth-first or iterative-deepening search from the flat sheet
   using the same move set, with canonical state hashing (layer orders up to
   translation and symmetry). It enables:
   - shortest-solution length as the real difficulty measure;
   - rejection of sheets that have shortcuts or many solutions;
   - checking hand-made sheets, including encodings of the original levels.
4. **Layer and thickness limits.** Add a maximum stack height per position and a
   maximum flap thickness, tuned with real paper.
5. **Fewer wasted moves.** Forbid moves that restore a previous state (keep a hash set
   of visited states) and moves that simply reverse the last one.
6. **Smarter search.** Use weighted line choice (prefer lines that shrink the bbox
   towards 4×4), beam search, or backtracking instead of restarting from a blank sheet.
   Precompute and cache full-fold sequences, then insert flaps and tucks into them.
7. **Faster `isValid`.** Re-check only the edges touched by a move and use typed arrays.
   This matters once a solver calls it millions of times.
8. **More techniques.** Inside and outside reverse folds, tucks with depth varying by
   position, multi-component flaps. Also variants: sheets with slits or non-square
   outlines (see the Delft generator below).
9. **Better instructions.** A crease-pattern (mountain/valley) view of the flat sheet,
   step diagrams of both faces, an animated or 3D fold preview, and an interactive
   "fold it yourself" mode that uses the same engine.
10. **Print pipeline.** Single-sheet PDF export with duplex registration, bleed,
    calibration and an answer page is done ([printing.md](printing.md)). Still missing:
    batch generation of a 100-sheet book with a difficulty curve.

## 12. References

- *Manifold* / «Квадригами», Jérôme Morin-Drouin: the original puzzle.
- S. Nanovski, M. Dhume, R. Bidarra, *Difficulty-Based Generation of Paperfolding
  Puzzles*, FDG 2026, doi:10.1145/3815598.3815696. Code:
  <https://github.com/stelitop/OrigamiPuzzleGenerator> (a different target: fold a slitted
  sheet into 2×2 so that one pattern shows; uses MiniZinc).
- E. Demaine, J. O'Rourke, *Geometric Folding Algorithms*, Cambridge UP, 2007:
  flat-foldability and the local layer-ordering conditions.
- M. Bern, B. Hayes, *The Complexity of Flat Origami*, SODA 1996: deciding
  flat-foldability in general is NP-hard, while checking a *given* layer order, as we
  do, is easy.
