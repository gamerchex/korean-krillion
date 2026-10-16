// Run the HAN-GUK.IO server:  npm run build && npm run server
//
//   PORT=8787 DB_PATH=./data/hanguk.sqlite ADMIN_TOKEN=change-me npm run server
//
// Behind a reverse proxy (nginx, Caddy, a PaaS router) set TRUST_PROXY=1 so rate limits use
// the client address from X-Forwarded-For. Without it the header is ignored, because any
// client could send it to dodge the limits.
//
// AI answer checking: set ANTHROPIC_API_KEY. Optional: HANGUK_JUDGE_MODEL (default
// claude-haiku-5-5), ANTHROPIC_BASE_URL, HANGUK_AI_PER_DAY (AI checks per player per day).
//
// Serves the built game (dist/index.html) at / and the JSON API under /api.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import { ContentModel, decodeContent } from '../src/core/content';
import { DEFAULT_JUDGE_MODEL, anthropicJudge } from '../src/core/judge';
import { HangukServer } from './app';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'hanguk.sqlite');
const MAX_BODY = 16 * 1024;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const model = new ContentModel(decodeContent(JSON.parse(readFileSync(join(ROOT, 'src/generated/content.json'), 'utf8'))));
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });
const judgeModel = process.env.HANGUK_JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
const judge = process.env.ANTHROPIC_API_KEY
  ? anthropicJudge({ apiKey: process.env.ANTHROPIC_API_KEY, model: judgeModel, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined })
  : undefined;
const app = new HangukServer({
  model,
  dbPath: DB_PATH,
  adminToken: process.env.ADMIN_TOKEN || undefined,
  judge,
  aiChecksPerDay: Number(process.env.HANGUK_AI_PER_DAY) || undefined,
});

const pagePath = join(ROOT, 'dist', 'index.html');
const page = () => (existsSync(pagePath) ? readFileSync(pagePath) : Buffer.from('<p>Run <code>npm run build</code> first.</p>'));

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
    res.end(page());
    return;
  }
  let body: unknown = {};
  if (req.method === 'POST') {
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body too large' }));
      return;
    }
    if (body === null) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
  }
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  const out = await app.handle({
    method: req.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    ip: ((TRUST_PROXY ? headers['x-forwarded-for']?.split(',')[0] : undefined) ?? req.socket.remoteAddress ?? 'unknown').trim(),
  });
  res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(out.body));
}).listen(PORT, () => {
  console.log(`HAN-GUK.IO server on http://localhost:${PORT} (db: ${DB_PATH}; AI judge: ${judge ? judgeModel : 'off, set ANTHROPIC_API_KEY to enable'})`);
});
