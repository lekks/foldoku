// Builds the page into self-contained HTML files, with styles and scripts inlined:
//   dist/index.html     full document: open locally, print, or host anywhere
//   dist/artifact.html  page fragment for Claude Artifacts, which supply the document skeleton
// Usage: node scripts/build.mjs [--watch]

import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'web');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

const common = { bundle: true, format: 'iife', target: 'es2022', charset: 'utf8', minify: !watch, logLevel: 'warning' };

// `import workerSource from 'virtual:worker-source'` gives the app the bundled worker as a string,
// which it starts from a Blob URL: one HTML file, no separate worker file to serve.
const workerSource = {
  name: 'worker-source',
  setup(b) {
    b.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: 'worker-source', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => {
      const out = await build({ ...common, entryPoints: [join(src, 'worker.ts')], write: false, metafile: true });
      return {
        contents: `export default ${JSON.stringify(out.outputFiles[0].text)};`,
        loader: 'js',
        watchFiles: Object.keys(out.metafile.inputs).map(f => resolve(root, f)),
      };
    });
  },
};

// Inline scripts must not contain a closing script tag.
const safeScript = js => js.replace(/<\/script/gi, '<\\/script');

async function writePages(appJs) {
  const [head, body, css] = await Promise.all(['head.html', 'body.html', 'styles.css'].map(f => readFile(join(src, f), 'utf8')));
  const style = `<style>\n${css}</style>`;
  const script = `<script>${safeScript(appJs)}</script>`;
  const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}${style}
</head>
<body>
${body}${script}
</body>
</html>
`;
  // The artifact host wraps the page itself; the extra meta promises that the side gutter clears system bars.
  const fragment = `${head}<meta name="claude:viewport-fit-sides" content="cover">\n${style}\n\n${body}${script}\n`;
  await mkdir(dist, { recursive: true });
  await Promise.all([writeFile(join(dist, 'index.html'), full), writeFile(join(dist, 'artifact.html'), fragment)]);
  console.log(`built dist/index.html (${(full.length / 1024).toFixed(1)} KB) and dist/artifact.html`);
}

const pages = {
  name: 'pages',
  setup(b) {
    b.onEnd(async r => { if (!r.errors.length) await writePages(r.outputFiles[0].text); });
  },
};

const options = { ...common, entryPoints: [join(src, 'app.ts')], write: false, plugins: [workerSource, pages] };

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching src/ …');
} else {
  await build(options);
}
