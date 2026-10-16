// A stand-in for the Claude Messages API, for testing the reference server's AI judge offline.
//
//   node scripts/mock-claude.mjs 8790 &
//   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:8790 npm run server
//
// Accepts answers containing "zzvalid" (or "즈발리드") as a new answer; everything else is
// judged invalid. Never use this outside tests.

import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8790);
const marker = "Player's answer (JSON string): ";

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let answer = '';
    try {
      const content = JSON.parse(raw).messages?.[0]?.content ?? '';
      if (content.includes(marker)) answer = JSON.parse(content.split(marker)[1].split('\n')[0]);
    } catch {
      answer = '';
    }
    const ok = answer.toLowerCase().includes('zzvalid') || answer.includes('즈발리드');
    const verdict = ok
      ? { verdict: 'valid', canonical: 'Zzvalid', hangul: '즈발리드', familiarity: 2, reason_en: 'A real answer that fits.', reason_ko: '맞는 답입니다.' }
      : { verdict: 'invalid', canonical: '', hangul: '', familiarity: 1, reason_en: 'That is not a real thing in this category.', reason_ko: '이 분야에 실제로 있는 것이 아닙니다.' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(verdict) }], stop_reason: 'end_turn' }));
  });
}).listen(port, '127.0.0.1', () => console.log(`mock Claude API on http://127.0.0.1:${port}`));
