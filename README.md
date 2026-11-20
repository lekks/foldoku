# Foldoku

A generator of paper-folding puzzles. Fold an 8×8 printed sheet along grid lines and
cell diagonals into a 4×4 square that is solid dark on one side and solid light on
the other. Every generated sheet comes with a step-by-step solution and is solvable
by construction.

## Getting started

Requires Node.js 22.18 or newer.

```sh
npm install
npm run build        # → dist/index.html, one self-contained page
```

Open `dist/index.html` in a browser to generate sheets. Choose «Односторонняя» under
«Печать задания» to print on one side of white paper. The folded square still has a
solid dark side and a solid light side. The shades and neutral-cell pattern can be
adjusted before printing. The «Печать» block downloads a PDF (cell
size 12–22 mm) with an optional answer page. In duplex mode it also offers a
calibration sheet for measuring the printer's offset. See [docs/printing.md](docs/printing.md).

To include an analytics snippet in the hosted page, set the optional `ANALYTICS_HTML`
environment variable at build time. GitHub Pages builds read it from the repository
variable of the same name. Without it, no analytics snippet is added; the artifact
fragment never includes it. The snippet is published as part of the page, so do not
put secrets in it and only accept code from trusted sources.

| command | what it does |
|---------|--------------|
| `npm run dev` | rebuild `dist/` on every change in `src/` |
| `npm test` | run the tests (Node runs the TypeScript directly) |
| `npm run typecheck` | type-check everything with `tsc` |
| `npm run check` | typecheck + test + build |
| `npm run test:update-golden` | accept intended changes to generator output |

## Layout

```
src/core/   the generator: geometry, folding, validity check, search. No DOM
src/web/    the page: markup, styles, SVG rendering, UI, Web Worker, PDF export
scripts/    build script (esbuild; inlines everything into one HTML file)
test/       checker fixtures, property tests, golden snapshots
docs/       algorithm description, printing, roadmap
```

- [How the generator works](docs/algorithm.md)
- [Printing: duplex registration and calibration](docs/printing.md)
- [Roadmap](docs/roadmap.md)

## Status

Prototype. See the roadmap for the path to a production version.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Foldoku is an independent project. It is not affiliated with or endorsed by the
publishers of Manifold, «Квадригами» or Foldology; those names belong to their
respective owners.
