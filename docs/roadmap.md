# Roadmap

From the working prototype (`index.html` on branch `prototype`) to a production
generator. The algorithm, limitations and improvement ideas this plan builds on are in
[algorithm.md](algorithm.md). References like "§10.4" point there.

Each phase lists its **goal**, **deliverables** and an **exit criterion**: the phase is
done only when its exit criterion holds. Phases are ordered by dependency. Work inside
a phase can run in parallel.

---

## Phase 0: Prototype ✅ done

Single-page generator with full folds, diagonal folds, flap folds, tucks, a flat-fold
validity check and step-by-step solutions. Commits `2425a6f` → `dbd5c2a`.

---

## Phase 1: Foundation

**Goal:** a codebase that can change without silently breaking puzzles.

| # | Deliverable | Notes |
|---|-------------|-------|
| 1.1 | **Repository layout**: `core/` (pure generator, no DOM), `web/` (current page using `core`), `cli/`, `test/`, `docs/` | The core already has no DOM dependencies, so this is mostly a move |
| 1.2 | **Language and tooling**: TypeScript in strict mode, ES modules, formatter and linter, `package.json` scripts | Types pay off for `Move`, `State` and the puzzle format, which are easy to misuse |
| 1.3 | **Tests** (`node:test` or vitest): checker fixtures (valid / invalid states), property tests over many seeds (`verify`, exactly 64 quarters per colour, determinism), unit tests for geometry helpers | Turns the ad-hoc node scripts from development into permanent tests |
| 1.4 | **Puzzle format v1 + generator versioning**, see below | Needed before anything is published or printed |
| 1.5 | **Golden snapshots**: a fixed set of (seed, params) → stored puzzle JSON, compared on every test run | Catches accidental output changes |
| 1.6 | **CLI**: `kvadrigami generate --seed 1..500 --level hard --out puzzles/` | Batch generation without a browser |
| 1.7 | **Fix known bugs**: real retry limit in `tryFolds` (§10.4), test the Web Worker in a real browser (§10.14) | |
| 1.8 | **CI**: tests + lint on every push | Needs a git remote: decide hosting |

**Exit criterion:** `npm test` is green in CI. The page and the CLI produce identical
puzzles for the same input. Golden snapshots exist for every technique combination.

### 1.4 in detail: versioned output

**Problem.** A puzzle number (`seed`) means something only together with the exact
code that turned it into a sheet. Small changes reshuffle every sheet: a different
probability, another candidate order, one extra `R()` call. After such a change,
"№ 57" in a printed book and "№ 57" on the site are different sheets, and the
answer key no longer matches.

**Rule.** The source of truth for a published puzzle is its **stored data**, never its
seed.

1. Every puzzle carries `generatorVersion` (semver) and `formatVersion`.
2. Generator semver:
   - **major**: the same input gives different sheets, e.g. a changed search or RNG use;
   - **minor**: new options, while old inputs give the same sheets;
   - **patch**: no change in output.
   Golden snapshots enforce this: if they change, the change needs a major bump.
3. Accepted puzzles are saved as JSON files and never regenerated:

   ```json
   {
     "formatVersion": 1,
     "generatorVersion": "1.0.0",
     "id": "base-057",
     "params": { "seed": 57, "level": "hard", "diag": 1, "tech": 2, "decoy": 0.15 },
     "sheet": {
       "front": [["NNNN","BBBB","NNBB", "…8 cells"], "…8 rows"],
       "back":  ["…"]
     },
     "solution": [
       { "kind": "full", "line": "v", "c": 3, "side": -1, "dir": "over" },
       { "kind": "tuck", "line": "h", "c": 2, "side": 1, "dir": "over", "depth": 1, "layers": [12, 13, 14] }
     ],
     "metrics": { "folds": 6, "diagonal": 1, "flap": 0, "tuck": 1, "stars": 4 },
     "checksum": "sha256 of sheet + solution"
   }
   ```

4. The format pins the facet numbering (`f = cellId·4 + quarter`) and the coordinate
   convention, because `layers` in a solution refers to facet ids.
5. Any build of the code must be able to **verify** an old stored puzzle by replaying
   its solution. Generating it again is not required.

---

## Phase 2: Puzzle quality

**Goal:** the difficulty label is trustworthy and the puzzles are physically pleasant.

| # | Deliverable | Notes |
|---|-------------|-------|
| 2.1 | **Solver**: iterative-deepening search over the same move set with canonical state hashing | The key tool for this phase (§11.3) |
| 2.2 | **Shortest-solution difficulty**: grade by the solver's minimum, not the generated path; reject sheets whose shortest solution is much shorter than intended | Fixes §10.5 |
| 2.3 | **No wasted moves**: forbid moves that return to a visited state | Fixes §10.6 |
| 2.4 | **Thickness limits**: maximum layers per position and per flap, tuned by folding real printouts | Fixes §10.3 |
| 2.5 | **Calibration set**: encode a sample of original Manifold levels in the puzzle format, solve them, fit the score weights | Fixes §10.7. Check the legal side first, see open questions |
| 2.6 | **Paper testing**: print about 20 generated sheets per tier and record solve time and failures | Ground truth for 2.4 and 2.5 |

**Exit criterion:** for each tier, the shortest solutions fall in the intended band.
Paper testers rate the tiers in the right order. No tested sheet has a
"physically impossible" report.

---

## Phase 3: Content pipeline

**Goal:** produce a print-ready book (or level pack) of curated puzzles.

| # | Deliverable |
|---|-------------|
| 3.1 | Batch generation with filters (tier, techniques, maximum time) into a candidate pool |
| 3.2 | Curation tool: review candidates and accept or reject them, writing accepted JSON into `puzzles/` |
| 3.3 | Book assembly: pick N puzzles along a difficulty curve, assign final numbers |
| 3.4 | PDF export: duplex registration, bleed, sheet number placement, answer key pages |
| 3.5 | Print proof: one physical test print checking duplex alignment and colours |

**Exit criterion:** one command builds the PDF from `puzzles/`, and the printed proof
lines up front to back.

---

## Phase 4: Player experience

| # | Deliverable |
|---|-------------|
| 4.1 | Clearer instructions: crease-pattern (mountain/valley) view, diagrams of both faces, exact diagonal positions |
| 4.2 | Animated fold preview per step |
| 4.3 | Interactive "fold it yourself" mode on the same engine, with hints from the solver |

---

## Phase 5: Extensions

Reverse folds and squash folds, tucks with depth varying by position, multi-component
flaps, sheets with slits or non-square outlines, other grid sizes.

---

## Open questions

These decide priorities and should be answered before Phase 1 ends:

1. **Product.** A printed book, a web or mobile game, or both? Phase 3 and Phase 4 swap
   order depending on the answer.
2. **IP and licensing.** *Manifold* and «Квадригами» are commercial products. Before
   publishing or selling sheets in this format, or encoding original levels (2.5),
   check what is allowed. This may affect the name too.
3. **Hosting.** Where the git remote and CI live (affects 1.8).
4. **TypeScript or plain JS** with JSDoc types (1.2). TypeScript is the recommendation.
