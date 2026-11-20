import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildGeneratorWasm } from './build-wasm.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseline = process.argv[2] ?? '8605d7e';
const rounds = Number(process.argv[3] ?? 3);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('Expected a positive number of rounds');

const cases = [
  ...Array.from({ length: 6 }, (_, i) => [101 + i, 'mid', 0.15, 1, 1, true]),
  [101, 'mid', 0.15, 1, 2, true],
  [101, 'mid', 0.15, 3, 2, true],
  [101, 'hard', 0.2, 2, 2, false],
];
const work = mkdtempSync(join(tmpdir(), 'foldoku-bench-'));
const cpp = join(work, 'generator.wasm');

function compile(compiler, source, output, options) {
  const linker = process.env.WASM_LD;
  execFileSync(compiler, [
    '--target=wasm32', ...(linker ? [`-fuse-ld=${linker}`] : []),
    '-O3', '-mbulk-memory', '-nostdlib', '-ffreestanding',
    '-Wl,--no-entry,--strip-all', ...options, join(root, 'scripts/wasm', source), '-o', output,
  ], { stdio: 'inherit' });
}

try {
  writeFileSync(cpp, buildGeneratorWasm());
  const html = process.env.FOLDOKU_BENCH_HTML;
  if (html) {
    const bundle = await build({
      bundle: true, platform: 'browser', format: 'iife', write: false,
      stdin: { resolveDir: root, contents: `
        import { generate, verify } from './src/core/generate.ts';
        import { createGenerator } from './src/core/wasm.ts';
        import { canonical } from './test/helpers.ts';
        const bytes = Uint8Array.from(atob(${JSON.stringify(readFileSync(cpp).toString('base64'))}), c => c.charCodeAt(0));
        const variants = [generate, createGenerator(new WebAssembly.Module(bytes))];
        const results = [[], []];
        let expected;
        for (const run of variants) run(7, 'easy', 0.15, 0, 0);
        for (let round = 0; round < ${rounds}; round++) {
          for (let i = 0; i < variants.length; i++) {
            const variant = (round + i) % variants.length;
            const rows = ${JSON.stringify(cases)}.map(args => {
              const start = performance.now();
              const p = variants[variant](...args);
              const ms = performance.now() - start;
              if (!p || !verify(p)) throw new Error('Invalid puzzle: ' + args.join(' '));
              return { ms, output: canonical(p) + JSON.stringify(p.states.map(state => [...state])) };
            });
            const outputs = rows.map(row => row.output);
            expected ??= outputs;
            if (outputs.some((output, n) => output !== expected[n])) throw new Error('Output mismatch');
            results[variant].push(rows.map(row => row.ms));
          }
        }
        document.getElementById('result').textContent = JSON.stringify({
          browser: navigator.userAgent, typescript: results[0], cppWasm: results[1],
        });
      ` },
      plugins: [{
        name: 'browser-canonical',
        setup(builder) {
          // The browser only uses canonical(), never the Node-only hash function.
          builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'crypto', namespace: 'unused-node-crypto' }));
          builder.onLoad({ filter: /.*/, namespace: 'unused-node-crypto' }, () => ({
            contents: 'export function createHash() { throw new Error("Node-only"); }',
          }));
        },
      }],
    });
    writeFileSync(html, '<!doctype html><meta charset="utf-8"><title>Foldoku WASM benchmark</title>'
      + '<pre id="result">Running benchmark…</pre><script>'
      + bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') + '</script>');
    console.log(`Open ${html} in a browser to run the benchmark`);
  } else {
    const original = join(work, 'original');
    mkdirSync(original);
    const archive = join(work, 'original.tar');
    execFileSync('git', ['archive', '-o', archive, baseline], { cwd: root, stdio: 'inherit' });
    execFileSync('tar', ['-xf', archive, '-C', original], { stdio: 'inherit' });
    const wasm = join(work, 'connectivity.wasm');
    compile(process.env.CLANG ?? 'clang', 'connectivity.c', wasm, [
      '-Wl,--export=group_facets,--export=neighbor_buffer,--export=order_buffer,--export=grouped_buffer',
    ]);

    const variants = ['baseline', 'typescript', 'wasm', 'cpp-wasm'];
    for (const variant of variants) {
      const core = join(variant === 'baseline' ? original : root, 'src/core/generate.ts');
      await build({
        bundle: true, platform: 'node', format: 'esm', outfile: join(work, `${variant}.mjs`),
        stdin: { resolveDir: root, contents: `
          import { createHash } from 'node:crypto';
          import { generate as tsGenerate, verify } from ${JSON.stringify(core)};
          import { canonical } from './test/helpers.ts';
          ${variant === 'cpp-wasm' ? `
            import { readFileSync } from 'node:fs';
            import { createGenerator } from './src/core/wasm.ts';
            const generate = createGenerator(new WebAssembly.Module(readFileSync(process.env.FOLDOKU_BENCH_CPP)));
          ` : 'const generate = tsGenerate;'}
          generate(7, 'easy', 0.15, 0, 0);
          const results = ${JSON.stringify(cases)}.map(args => {
            const start = performance.now();
            const p = generate(...args);
            const ms = performance.now() - start;
            if (!p || !verify(p)) throw new Error('Expected a valid puzzle: ' + args.join(' '));
            const hash = createHash('sha256').update(canonical(p))
              .update(JSON.stringify(p.states.map(state => [...state]))).digest('hex');
            return { ms, hash };
          });
          console.log(JSON.stringify(results));
        ` },
        plugins: variant === 'wasm' ? [{
          name: 'wasm-connectivity',
          setup(builder) {
            builder.onResolve({ filter: /^\.\/connectivity\.ts$/ }, () => ({
              path: join(root, 'scripts/wasm/connectivity.ts'),
            }));
          },
        }] : [],
      });
    }

    const results = Object.fromEntries(variants.map(v => [v, []]));
    const output = join(work, 'results.json');
    let expected;
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[(round + i) % variants.length];
        const fd = openSync(output, 'w');
        try {
          execFileSync(process.execPath, [join(work, `${variant}.mjs`)], {
            stdio: ['ignore', fd, 'inherit'], env: { ...process.env, FOLDOKU_BENCH_WASM: wasm, FOLDOKU_BENCH_CPP: cpp },
          });
        } finally {
          closeSync(fd);
        }
        const rows = JSON.parse(readFileSync(output, 'utf8'));
        const hashes = JSON.stringify(rows.map(row => row.hash));
        expected ??= hashes;
        if (hashes !== expected) throw new Error(`Output mismatch in ${variant}, round ${round + 1}`);
        results[variant].push(rows);
        console.log(`Round ${round + 1}/${rounds}: ${variant} verified`);
      }
    }

    const median = values => {
      const sorted = values.toSorted((a, b) => a - b);
      return Math.round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2);
    };
    const summarize = measure => Object.fromEntries(variants.map(v => [v, median(results[v].map(measure))]));
    console.log(`Median milliseconds across ${rounds} rounds (${process.version}, ${process.arch}); reference ${baseline}`);
    console.table([
      ...cases.map(([seed, level, , diag, tech, single], i) => ({
        case: `${seed} ${level} d${diag}/t${tech} ${single ? 'single' : 'double'}`,
        ...summarize(rows => rows[i].ms),
      })),
      { case: 'Default six-puzzle batch', ...summarize(rows => rows.slice(0, 6).reduce((sum, row) => sum + row.ms, 0)) },
    ]);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
