# Foldopia

A generator of paper-folding puzzles. Fold an 8×8 printed sheet along grid lines and
cell diagonals into a 4×4 square that is solid dark on one side and solid light on
the other. Every generated sheet comes with a step-by-step solution and is solvable
by construction.

The hosted version is at <https://foldopia.projlet.com>.

## Getting started

Building and testing require Node.js 22.18 or newer, Clang++ and the LLVM
WebAssembly linker. On Debian or Ubuntu, install the `clang` and `lld` packages.
Set `CLANGXX` or `WASM_LD` to use a compiler or linker outside your PATH.

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
The standalone page embeds the WASM generator and runs it in a Web Worker.

If you have Make installed, use `make build`, `make test`, or `make check` to run
the corresponding npm scripts. Run `make dev` and open <http://127.0.0.1:8080/>
for local development. The server rebuilds the page as sources change. Refresh
the browser to see the updated page. To use another port, run `make dev PORT=8081`.

The footer shows the version from `package.json` and the short commit hash on
GitHub Pages builds. Update the release version with
`npm version <patch|minor|major> --no-git-tag-version` before publishing.

To include an analytics snippet in the hosted page, set the optional `ANALYTICS_HTML`
environment variable at build time. GitHub Pages builds read it from the repository
variable of the same name. Without it, no analytics snippet is added; the artifact
fragment never includes it. The snippet is published as part of the page, so do not
put secrets in it and only accept code from trusted sources.

GitHub Pages sets `SITE_DOMAIN=foldopia.projlet.com` at build time. This produces
Russian at `/`, English at `/en/`, and discovery files at `/robots.txt` and
`/sitemap.xml`. Each public URL serves its language directly, with a link to the
other language. To preview that build, run `SITE_DOMAIN=foldopia.projlet.com make dev`.

| command | what it does |
|---------|--------------|
| `npm run dev` | rebuild `dist/` on every change in `src/` |
| `npm test` | run the tests (Node runs the TypeScript directly) |
| `npm run typecheck` | type-check everything with `tsc` |
| `npm run check` | typecheck + test + build |
| `npm run test:update-golden` | accept intended changes to generator output |

`node scripts/bench-generation.mjs` compares the published generator, the optimized
TypeScript core, the WebAssembly connectivity kernel, and the full C++ search
compiled to WebAssembly. It requires Clang, Clang++ and the LLVM WebAssembly linker
(`WASM_LD` can point to its executable).
Pass a baseline Git revision and round count to override `8605d7e` and three rounds.
The benchmark checks the paint, moves, and intermediate states against the baseline.
Set `FOLDOPIA_BENCH_HTML=/tmp/foldopia-bench.html` to generate a standalone browser
benchmark comparing the optimized TypeScript and full C++/WebAssembly variants.
The TypeScript generator is a reference for the benchmark. The app and golden
tests use the C++ generator.

## Adding a language

Foldopia supports Russian and English. On the hosted site, the URL sets the language.
In standalone builds, the selector in the header overrides the browser preference
and remembers the choice locally. English is the standalone fallback.

1. Add the language code in `src/core/language.ts` and the option in
   `src/web/body.html`. Use the language's own name for the option. Register the
   route and search metadata in `scripts/build.mjs` and include the new page in
   the hosted build and language navigation.
2. Use `src/web/static-en.ts` as a template for the page dictionary. Register it
   in `pageTranslations` in `src/web/i18n.ts` and add the language to
   `messages` there for dynamic text and PDF labels.
3. Translate the fold instructions in `src/core/describe.ts`.
4. Run `npm run check` and check the interface and PDF layouts in both the new
   language and Russian.

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

Foldopia is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE)
starting with version 0.2.1. For commercial use outside that license, contact
[lekks](https://github.com/lekks) for separate permission. See [NOTICE](NOTICE).

Published versions through 0.2.0 remain available under Apache License 2.0.

Foldopia is an independent project. It is not affiliated with or endorsed by the
publishers of Manifold, «Квадригами» or Foldology; those names belong to their
respective owners.
