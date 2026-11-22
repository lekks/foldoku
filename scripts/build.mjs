// Builds the page into self-contained HTML files, with styles and scripts inlined:
//   dist/index.html     full document: open locally, print, or host anywhere
//   dist/artifact.html  page fragment for Claude Artifacts, which supply the document skeleton
// Usage: node scripts/build.mjs [--watch] [--serve=PORT]

import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGeneratorWasm, generatorSource } from './build-wasm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'web');
const dist = join(root, 'dist');
const pageFiles = ['head.html', 'body.html', 'styles.css', 'foldopia-mark.svg'].map(file => join(src, file));
const manifest = join(root, 'package.json');
const watch = process.argv.includes('--watch');
const serve = process.argv.find(arg => arg.startsWith('--serve='));
// Set on hosted builds so GitHub Pages serves the custom domain.
const siteDomain = process.env.SITE_DOMAIN ?? '';

const common = { bundle: true, format: 'iife', target: 'es2022', charset: 'utf8', minify: !watch, logLevel: 'warning' };

// `import workerSource from 'virtual:worker-source'` gives the app the bundled worker as a string,
// which it starts from a Blob URL: one HTML file, no separate worker file to serve.
const workerSource = {
  name: 'worker-source',
  setup(b) {
    b.onResolve({ filter: /^virtual:worker-source$/ }, () => ({ path: 'worker-source', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => {
      const wasm = buildGeneratorWasm();
      const out = await build({
        ...common, entryPoints: [join(src, 'worker.ts')], write: false, metafile: true,
        define: { FOLDOPIA_WASM_BASE64: JSON.stringify(wasm.toString('base64')) },
      });
      return {
        contents: `export default ${JSON.stringify(out.outputFiles[0].text)};`,
        loader: 'js',
        watchFiles: [manifest, generatorSource, ...pageFiles, ...Object.keys(out.metafile.inputs).map(f => resolve(root, f))],
      };
    });
  },
};

// Inline scripts must not contain a closing script tag.
const safeScript = js => js.replace(/<\/script/gi, '<\\/script');

async function writePages(appJs) {
  const [headTemplate, template, css, mark, packageJson] = await Promise.all([
    ...pageFiles.map(file => readFile(file, 'utf8')),
    readFile(manifest, 'utf8'),
  ]);
  const { version } = JSON.parse(packageJson);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error('Expected a release version in package.json');
  }
  const revision = process.env.GITHUB_SHA ?? '';
  const buildVersion = /^[a-f0-9]{40}$/i.test(revision) ? `${version} · ${revision.slice(0, 7)}` : version;
  const icon = 'data:image/svg+xml,' + encodeURIComponent(mark.trim());
  const head = headTemplate.replace('<!-- FOLDOPIA_FAVICON -->', icon);
  const body = template.replace('<!-- FOLDOPIA_VERSION -->', buildVersion);
  const analytics = process.env.ANALYTICS_HTML || '';
  const style = `<style>\n${css}</style>`;
  const script = `<script>${safeScript(appJs)}</script>`;
  const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}${style}
${analytics}
</head>
<body>
${body}${script}
</body>
</html>
`;
  // The artifact host wraps the page itself; the extra meta promises that the side gutter clears system bars.
  const fragment = `${head}<meta name="claude:viewport-fit-sides" content="cover">\n${style}\n\n${body}${script}\n`;
  await mkdir(dist, { recursive: true });
  const outputs = [writeFile(join(dist, 'index.html'), full), writeFile(join(dist, 'artifact.html'), fragment)];
  if (siteDomain) outputs.push(writeFile(join(dist, 'CNAME'), `${siteDomain}\n`));
  await Promise.all(outputs);
  const target = siteDomain ? ` for ${siteDomain}` : '';
  console.log(`built dist/index.html (${(full.length / 1024).toFixed(1)} KB) and dist/artifact.html${target}`);
}

const pages = {
  name: 'pages',
  setup(b) {
    b.onEnd(async r => { if (!r.errors.length) await writePages(r.outputFiles[0].text); });
  },
};

const options = { ...common, entryPoints: [join(src, 'app.ts')], write: false, plugins: [workerSource, pages] };

if (watch) {
  const ctx = await context(serve ? { ...options, outfile: join(dist, 'app.js') } : options);
  try {
    if (serve) {
      const port = Number(serve.slice('--serve='.length));
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Expected a port from 1 to 65535');
      }
      await ctx.rebuild();
      await ctx.serve({ host: '127.0.0.1', port, servedir: dist });
      console.log(`Serving dist/ at http://127.0.0.1:${port}/`);
    }
    await ctx.watch();
    console.log('watching src/ …');
  } catch (error) {
    await ctx.dispose();
    throw error;
  }
} else {
  await build(options);
}
