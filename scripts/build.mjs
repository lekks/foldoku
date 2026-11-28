// Builds the page into self-contained HTML files, with styles and scripts inlined:
//   dist/index.html     full document: open locally, print, or host anywhere
//   dist/artifact.html  page fragment for Claude Artifacts, which supply the document skeleton
// With SITE_DOMAIN, also emits localized pages and discovery files for GitHub Pages.
// Usage: node scripts/build.mjs [--watch] [--serve=PORT]

import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
// Set on hosted builds to emit the public language routes and use the custom domain.
const siteDomain = process.env.SITE_DOMAIN ?? '';
if (siteDomain && !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(siteDomain)) {
  throw new Error('Expected a hostname in SITE_DOMAIN');
}

const locales = {
  ru: {
    path: '/', name: 'Русский',
    title: 'Foldopia — бумажные головоломки для печати',
    description: 'Создавайте головоломки со складыванием бумаги: превратите лист 8×8 в квадрат 4×4. Скачивайте задания в PDF для печати с пошаговыми решениями.',
  },
  en: {
    path: '/en/', name: 'English',
    title: 'Foldopia — Printable Paper-Folding Puzzles',
    description: 'Generate paper-folding puzzles: fold an 8×8 sheet into a 4×4 square. Download printable PDF puzzles with step-by-step solutions.',
  },
};
const languages = Object.keys(locales);
const publicUrl = language => 'https://' + siteDomain + locales[language].path;

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
const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function loadTranslations() {
  // Bundle dependencies together so editing an imported dictionary changes the module URL.
  const { outputFiles: [bundle] } = await build({
    ...common, entryPoints: [join(src, 'i18n.ts')], format: 'esm', platform: 'node', write: false,
  });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.contents).toString('base64'));
}

function localizeBody(body, language, { messages, pageTranslations }) {
  const alternate = languages.find(candidate => candidate !== language);
  const link = '<a id="language" href="' + locales[alternate].path + '" hreflang="' + alternate
    + '" lang="' + alternate + '">' + locales[alternate].name + '</a>';
  const localized = body.replace(/<!-- FOLDOPIA_LANGUAGE_START -->[\s\S]*?<!-- FOLDOPIA_LANGUAGE_END -->/, link);
  const dictionary = pageTranslations[language];
  if (!dictionary) return localized;

  // The translation markers in body.html label plain leaf text or a single attribute.
  const translate = key => escapeHtml(dictionary[key]);
  return localized
    .replace(/(data-i18n="([^"]+)"[^>]*>)[^<]*/g, (_, tag, key) => tag + translate(key))
    .replace(/(data-i18n-(aria-label|title)="([^"]+)"[^>]*?\s\2=")[^"]*/g, (_, tag, attr, key) => tag + translate(key))
    .replace(/(<option value="(\d+)"[^>]* data-cell-label="(single|batch)">)[^<]*/g,
      (_, tag, cell, type) => tag + escapeHtml(messages[language].cellSize(Number(cell), type === 'batch')));
}

function pageMetadata(language) {
  const { title, description } = locales[language];
  return [
    '<title>' + escapeHtml(title) + '</title>',
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<link rel="canonical" href="' + publicUrl(language) + '">',
    ...languages.map(alternate => '<link rel="alternate" hreflang="' + alternate
      + '" href="' + publicUrl(alternate) + '">'),
  ].join('\n');
}

async function writePages(appJs) {
  const [headTemplate, template, css, mark, packageJson, translations] = await Promise.all([
    ...pageFiles.map(file => readFile(file, 'utf8')),
    readFile(manifest, 'utf8'),
    siteDomain ? loadTranslations() : undefined,
  ]);
  const { version } = JSON.parse(packageJson);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error('Expected a release version in package.json');
  }
  const revision = process.env.GITHUB_SHA ?? '';
  const buildVersion = /^[a-f0-9]{40}$/i.test(revision) ? `${version} · ${revision.slice(0, 7)}` : version;
  const icon = 'data:image/svg+xml,' + encodeURIComponent(mark.trim());
  const head = metadata => headTemplate.replace('<!-- FOLDOPIA_METADATA -->', () => metadata)
    .replace('<!-- FOLDOPIA_FAVICON -->', icon);
  const body = template.replace('<!-- FOLDOPIA_VERSION -->', buildVersion);
  const analytics = process.env.ANALYTICS_HTML || '';
  const style = `<style>\n${css}</style>`;
  const script = `<script>${safeScript(appJs)}</script>`;
  const render = (language, hosted) => {
    const lang = hosted ? 'lang="' + language + '" data-page-language="' + language + '"' : 'lang="' + language + '"';
    const metadata = hosted ? pageMetadata(language) : '<title>Foldopia</title>';
    const markup = hosted ? localizeBody(body, language, translations) : body;
    return `<!doctype html>
<html ${lang}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head(metadata)}${style}
${analytics}
</head>
<body>
${markup}${script}
</body>
</html>
`;
  };
  // The artifact host wraps the page itself; the extra meta promises that the side gutter clears system bars.
  const artifactMetadata = siteDomain ? '<title>Foldopia</title>\n<meta name="robots" content="noindex">' : '<title>Foldopia</title>';
  const fragment = `${head(artifactMetadata)}<meta name="claude:viewport-fit-sides" content="cover">\n${style}\n\n${body}${script}\n`;
  const full = render('ru', Boolean(siteDomain));
  await mkdir(dist, { recursive: true });
  const outputs = [writeFile(join(dist, 'index.html'), full), writeFile(join(dist, 'artifact.html'), fragment)];
  if (siteDomain) {
    await mkdir(join(dist, 'en'), { recursive: true });
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + languages.map(language => '  <url><loc>' + publicUrl(language) + '</loc></url>\n').join('')
      + '</urlset>\n';
    outputs.push(
      writeFile(join(dist, 'en', 'index.html'), render('en', true)),
      writeFile(join(dist, 'CNAME'), siteDomain + '\n'),
      writeFile(join(dist, 'sitemap.xml'), sitemap),
      writeFile(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://' + siteDomain + '/sitemap.xml\n'),
    );
  } else {
    for (const file of ['en/index.html', 'CNAME', 'sitemap.xml', 'robots.txt']) {
      outputs.push(rm(join(dist, file), { force: true }));
    }
  }
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
