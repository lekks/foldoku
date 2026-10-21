# Foldoku

A generator of paper-folding puzzles. Fold an 8×8 printed sheet along grid lines and
cell diagonals into a 4×4 square that is solid black on one side and solid white on
the other. Every generated sheet comes with a step-by-step solution and is solvable
by construction.

## Getting started

Requires Node.js 22.18 or newer.

```sh
npm install
npm run build        # → dist/index.html, one self-contained page
```

Open `dist/index.html` in a browser to generate sheets. To print, use duplex printing
flipped on the long edge.

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
