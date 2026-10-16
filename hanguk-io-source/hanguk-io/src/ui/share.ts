// Spoiler-free share card: depth, zone, score and the tier pattern. No answers, no names.

import { zoneFor } from '../core/config';
import type { RunSummary } from '../core/results';
import { titleFor } from '../core/results';
import type { TierId } from '../core/types';
import { paintBackdrop } from './art/ocean';
import { TIER_COLOR } from './components';
import { TIER_LABEL, fmtDate, fmtMeters, type UiLang } from './i18n';

const TIER_PATHS: Record<TierId, string> = {
  none: 'M5 5l10 10M15 5L5 15',
  common: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  uncommon: 'M10 2l8 8-8 8-8-8z',
  rare: 'M10 2l8.5 15h-17z',
  'very-rare': 'M10 1.5l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L1.3 7.8l6.1-.7z',
  'extremely-rare': 'M10 1.5l7.4 4.25v8.5L10 18.5l-7.4-4.25v-8.5z',
  legendary: 'M16.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
};

export async function renderShareCard(s: RunSummary, opts: { lang: UiLang; number?: number }): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* fonts optional */
  }
  paintBackdrop(ctx, W, H, s.depth);
  const serif = '"Hahmlet", "Noto Serif KR", Georgia, serif';
  const sans = '"IBM Plex Sans KR", "Noto Sans KR", system-ui, sans-serif';
  const mono = '"IBM Plex Mono", ui-monospace, monospace';
  const zone = zoneFor(s.depth);
  const title = titleFor(s.total);
  const ko = opts.lang === 'ko';

  // seal
  ctx.fillStyle = '#c8372d';
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(80, 80, 96, 96, 14) : ctx.rect(80, 80, 96, 96);
  ctx.fill();
  ctx.fillStyle = '#fff3e6';
  ctx.font = `700 40px ${serif}`;
  ctx.textAlign = 'center';
  ctx.fillText('한', 128, 124);
  ctx.fillText('국', 128, 166);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f4efe4';
  ctx.font = `700 64px ${serif}`;
  ctx.fillText('HAN-GUK', 200, 150);
  const w1 = ctx.measureText('HAN-GUK').width;
  ctx.fillStyle = '#7fd6c4';
  ctx.fillText('.IO', 200 + w1, 150);

  ctx.fillStyle = '#cfe2ea';
  ctx.font = `500 34px ${sans}`;
  const head = s.mode === 'daily' && opts.number ? (ko ? `제${opts.number}회 잠수` : `Dive #${opts.number}`) : s.mode === 'archive' ? (ko ? '지난 잠수' : 'Archive dive') : ko ? '연습 잠수' : 'Practice dive';
  ctx.fillText(`${head}${s.dateKey ? ' · ' + fmtDate(s.dateKey, opts.lang) : ''}`, 80, 260);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 200px ${mono}`;
  ctx.fillText(String(s.total), 72, 500);
  const sw = ctx.measureText(String(s.total)).width;
  ctx.fillStyle = '#9fb6c2';
  ctx.font = `500 64px ${mono}`;
  ctx.fillText('/700', 84 + sw, 500);

  ctx.fillStyle = '#ffe2a0';
  ctx.font = `600 64px ${mono}`;
  ctx.fillText(fmtMeters(s.depth), 80, 610);
  ctx.fillStyle = '#e8f1f4';
  ctx.font = `600 44px ${sans}`;
  ctx.fillText(zone.name[opts.lang], 80, 680);

  // tier pattern
  const size = 104;
  const gap = 26;
  const startX = 80;
  s.answers.forEach((a, i) => {
    const x = startX + i * (size + gap);
    const y = 760;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    const p = new Path2D(TIER_PATHS[a.tier]);
    if (a.tier === 'none') {
      ctx.strokeStyle = TIER_COLOR.none;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.stroke(p);
    } else {
      ctx.fillStyle = TIER_COLOR[a.tier];
      ctx.fill(p);
    }
    ctx.restore();
    ctx.fillStyle = '#e8f1f4';
    ctx.font = `600 34px ${mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(a.points), x + size / 2, y + size + 46);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = '#f4efe4';
  ctx.font = `700 52px ${serif}`;
  ctx.fillText(title.name[opts.lang], 80, 1050);
  ctx.fillStyle = '#9fb6c2';
  ctx.font = `500 30px ${sans}`;
  const tiers = s.answers.filter((a) => a.tier !== 'none').map((a) => TIER_LABEL[a.tier][opts.lang]);
  ctx.fillText(tiers.slice(0, 4).join(' · '), 80, 1110);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `500 28px ${sans}`;
  ctx.fillText(ko ? 'HAN-GUK.IO · 한국 심해 탐사' : 'HAN-GUK.IO · The Korean Deep Dive', 80, H - 80);

  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
