// Build the game into self-contained HTML files.
//
//   node scripts/build.mjs            -> dist/index.html (standalone page)
//                                       dist/hanguk-io.artifact.html (claude.ai artifact body)
//   node scripts/build.mjs --dev      -> unminified, with sourcemaps inlined
//   node scripts/build.mjs --serve    -> also serve dist/ on http://localhost:5173
//
// Everything (React, the game, the content bank, the CSS, the art) is inlined: the page
// makes no network requests except the optional Google Fonts stylesheet.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const serve = process.argv.includes('--serve');

const result = await build({
  entryPoints: [join(ROOT, 'src/ui/main.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  loader: { '.json': 'json' },
  logLevel: 'warning',
});

const js = result.outputFiles[0].text
  // never let the bundle close the inline <script> early
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\!--');
const css = readFileSync(join(ROOT, 'src/ui/styles.css'), 'utf8');
const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;700&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">';

const body =
  `<canvas id="ocean" aria-hidden="true"></canvas>\n` +
  `<div id="root"><noscript><p style="padding:24px;font-family:sans-serif;color:#eef4f6">HAN-GUK.IO needs JavaScript to run.</p></noscript></div>\n` +
  `<script>${js}</script>\n`;

// claude.ai artifact: the host supplies <!doctype>, <head> and <body>; title and style come first.
const artifact = `<title>HAN-GUK.IO</title>\n<style>${css}</style>\n${fonts}\n${body}`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="HAN-GUK.IO: a daily Korean trivia dive. The rarer your answer, the deeper you sink.">
<meta name="theme-color" content="#04121f">
<title>HAN-GUK.IO</title>
<style>${css}</style>
${fonts}
</head>
<body>
${body}</body>
</html>
`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/index.html'), standalone);
writeFileSync(join(ROOT, 'dist/hanguk-io.artifact.html'), artifact);
// Asset gallery and scene viewer (documentation aid; not part of the game page).
const gallery = await build({
  entryPoints: [join(ROOT, 'src/ui/gallery.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['es2020'],
  minify: !dev,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
});
const galleryCss = `body{margin:0;background:#04121f;color:#eef4f6;font-family:system-ui,sans-serif}#ocean{position:fixed;inset:0;width:100%;height:100%}#root{position:relative;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}figure{margin:0;background:#0b2234;border:1px solid #1d3d55;border-radius:14px;padding:12px}
.art{height:150px;display:grid;place-items:center;background:radial-gradient(#123a57,#06182a);border-radius:10px}.art img{max-width:90%;max-height:130px}
figcaption{font-size:13px;margin-top:8px;line-height:1.4}small{color:#9fb6c2}.mono{font-family:ui-monospace,monospace}.tag{position:fixed;left:12px;bottom:12px;background:#0008;padding:6px 10px;border-radius:8px}a{color:#7fd6c4}`;
writeFileSync(
  join(ROOT, 'dist/gallery.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HAN-GUK.IO art</title><style>${galleryCss}</style></head><body><canvas id="ocean"></canvas><div id="root"></div><script>${gallery.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
);

const kb = (f) => (statSync(join(ROOT, f)).size / 1024).toFixed(0);
console.log(`dist/index.html ${kb('dist/index.html')} KB, dist/hanguk-io.artifact.html ${kb('dist/hanguk-io.artifact.html')} KB`);

if (serve) {
  const port = Number(process.env.PORT || 5173);
  createServer((req, res) => {
    const file = req.url && req.url.startsWith('/artifact') ? 'dist/hanguk-io.artifact.html' : 'dist/index.html';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(join(ROOT, file)));
  }).listen(port, () => console.log(`Serving http://localhost:${port}`));
}
