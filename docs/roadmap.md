# Roadmap

From the working prototype (branch `prototype`) to a production
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
| 1.1 | ✅ **Repository layout**: `src/core/` (pure generator, no DOM), `src/web/` (page), `scripts/` (build), `test/`, `docs/`; `cli/` comes with 1.6 | Done: output identical to the prototype on 270 compared puzzles |
| 1.2 | ◐ **Language and tooling**: TypeScript in strict mode, ES modules, esbuild, `package.json` scripts. Formatter and linter still to add | Types pay off for `Move`, `State` and the puzzle format, which are easy to misuse |
| 1.3 | ◐ **Tests** (`node:test`): checker fixtures, property tests over a sample of settings (`verify`, colour counts, determinism) are in. Unit tests for geometry helpers still to add | Turned the ad-hoc node scripts from development into permanent tests |
| 1.4 | **Puzzle format v1 + generator versioning**, see below | Needed before anything is published or printed |
| 1.5 | ✅ **Golden snapshots**: 24 fixed inputs → digest of the puzzle (`test/golden.json`), compared on every test run | Catches accidental output changes. Store full JSON once the puzzle format (1.4) exists |
| 1.6 | **CLI**: `foldopia generate --seed 1..500 --level hard --out puzzles/` | Batch generation without a browser |
| 1.7 | ◐ **Fix known bugs**: real retry limit in `tryFolds` (§10.4). The Web Worker is now checked in headless Chrome | The retry fix may change output: needs a golden refresh |
| 1.8 | **CI**: tests + lint on every push | GitHub Actions, deployed to GitHub Pages |

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
| 2.5 | **Calibration set**: encode a sample of original Manifold levels in the puzzle format, solve them, fit the score weights | Fixes §10.7. **Internal analysis only**: original levels are someone else's work and never go into the public repo |
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
| 3.4 | PDF export: duplex registration, bleed, sheet number placement, answer key pages. ◐ One puzzle per file with calibration is done ([printing.md](printing.md)); books and combined answer keys remain |
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

Ideas from *Foldology*, which uses nearly the same mechanic. We borrow ideas, never its
puzzles or artwork:
- **Picture reveal**: instead of solid black/white, the folded square shows a picture
  (one per side). The painting step (§7 of algorithm.md) maps any 4×4 image onto
  the visible quarters, so this is mostly a new painting mode plus an image source.
- **Tear-out booklet format** for printable sets, with difficulty growing page by page.

---

## Open questions

These decide priorities and should be answered before Phase 1 ends:

1. **Product.** ✅ Settled: a free, open-source web page where anyone generates their own
   sheets. Phase 3 shrinks to printable output for one sheet or a small set. Phase 4
   matters more. Audience: launch in Russian first, then English, with a bilingual UI.
2. **IP and licensing.** ✅ Partly settled: the project is called **Foldopia** (renamed
   from Foldoku because a game of that name already exists), licensed under PolyForm
   Noncommercial 1.0.0, and states that it is independent. Still to do before launch:
   check «Foldopia» in the trademark registers (FIPS, WIPO; classes 9, 28, 41) and
   check for live patents on folding puzzles. *Manifold*, «Квадригами» and *Foldology*
   are commercial products: their mechanics and ideas are free to use, their levels,
   artwork and texts are not.
3. **Hosting.** ✅ Settled: GitHub with CI on GitHub Actions, published to GitHub Pages
   at <https://foldopia.projlet.com>.
4. **TypeScript or plain JS** with JSDoc types (1.2). TypeScript is the recommendation.
