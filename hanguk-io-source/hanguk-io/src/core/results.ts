// Post-dive summaries: titles, zones, category totals, consistency.

import { SCORING, depthFor, zoneFor, type ScoringConfig } from './config';
import type { ContentModel } from './content';
import type { AnswerStatus, CategoryId, DataSource, RejectReason, RunMode, RunState, TierId } from './types';

export interface TitleDef {
  id: string;
  min: number;
  name: { en: string; ko: string };
}

/** Score-band titles. They describe depth reached, never a measured global rank. */
export const TITLES: TitleDef[] = [
  { id: 'surface-dweller', min: 0, name: { en: 'Surface Dweller', ko: '수면 위 산책자' } },
  { id: 'twilight-drifter', min: 20, name: { en: 'Twilight Drifter', ko: '어스름 표류자' } },
  { id: 'midnight-swimmer', min: 100, name: { en: 'Midnight Swimmer', ko: '한밤의 유영자' } },
  { id: 'lantern-bearer', min: 200, name: { en: 'Lantern Bearer', ko: '등불 든 잠수부' } },
  { id: 'pressure-diver', min: 300, name: { en: 'Pressure Diver', ko: '수압을 견디는 자' } },
  { id: 'abyss-explorer', min: 400, name: { en: 'Abyss Explorer', ko: '심연 탐험가' } },
  { id: 'trench-scholar', min: 500, name: { en: 'Trench Scholar', ko: '해구 학자' } },
  { id: 'hadal-legend', min: 600, name: { en: 'Hadal Legend', ko: '해구의 전설' } },
  { id: 'dragon-king-guest', min: 700, name: { en: 'Guest of the Dragon King', ko: '용궁의 손님' } },
];

export function titleFor(total: number): TitleDef {
  let t = TITLES[0];
  for (const x of TITLES) if (total >= x.min) t = x;
  return t;
}

export type Consistency = 'steady' | 'spiky' | 'patchy' | 'mixed';

export interface SummaryAnswer {
  promptId: string;
  category: CategoryId;
  input: string;
  status: AnswerStatus;
  reason?: RejectReason;
  entityKey?: string;
  name?: string;
  points: number;
  tier: TierId;
  p?: number;
  source?: DataSource;
  /** Wrong tries before the answer (or before time ran out). */
  tries?: number;
  /** The AI judge accepted it. */
  ai?: boolean;
}

export interface RunSummary {
  runId: string;
  mode: RunMode;
  challengeId: string;
  dateKey?: string;
  total: number;
  depth: number;
  zoneId: string;
  titleId: string;
  accepted: number;
  answers: SummaryAnswer[];
  categoryTotals: Partial<Record<CategoryId, number>>;
  strongest: number | null;
  consistency: Consistency;
  startedAt: number;
  finishedAt: number;
  scoringVersion: string;
  contentVersion: string;
  promptIds: string[];
}

export function consistencyOf(points: number[], accepted: number): Consistency {
  if (accepted <= Math.floor(points.length / 2)) return 'patchy';
  const valid = points.filter((p) => p > 0);
  const mean = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, valid.length));
  const sorted = points.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  if (max - median >= 40) return 'spiky';
  if (sd < 12) return 'steady';
  return 'mixed';
}

export function summarize(run: RunState, model: ContentModel, scoring: ScoringConfig = SCORING): RunSummary {
  const answers: SummaryAnswer[] = run.answers.map((a) => {
    const prompt = model.prompt(a.promptId);
    return {
      promptId: a.promptId,
      category: (prompt?.category ?? 'assoc') as CategoryId,
      input: a.input,
      status: a.status,
      reason: a.reason,
      entityKey: a.entityKey,
      name: a.matchedName,
      points: a.points,
      tier: a.tier,
      p: a.estimate?.p,
      source: a.estimate?.source,
      ...(a.tries?.length ? { tries: a.tries.length } : {}),
      ...(a.matchedBy === 'ai' ? { ai: true } : {}),
    };
  });
  const categoryTotals: Partial<Record<CategoryId, number>> = {};
  for (const a of answers) categoryTotals[a.category] = (categoryTotals[a.category] ?? 0) + a.points;
  let strongest: number | null = null;
  answers.forEach((a, i) => {
    if (a.points > 0 && (strongest === null || a.points > answers[strongest].points)) strongest = i;
  });
  const accepted = answers.filter((a) => a.status === 'accepted').length;
  const depth = depthFor(run.total, scoring);
  return {
    runId: run.runId,
    mode: run.mode,
    challengeId: run.challengeId,
    dateKey: run.dateKey,
    total: run.total,
    depth,
    zoneId: zoneFor(depth).id,
    titleId: titleFor(run.total).id,
    accepted,
    answers,
    categoryTotals,
    strongest,
    consistency: consistencyOf(answers.map((a) => a.points), accepted),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? run.startedAt,
    scoringVersion: run.scoringVersion,
    contentVersion: run.contentVersion,
    promptIds: run.promptIds.slice(),
  };
}

const TIER_SQUARES: Record<TierId, string> = {
  none: '⬛',
  common: '⬜',
  uncommon: '🟦',
  rare: '🟩',
  'very-rare': '🟨',
  'extremely-rare': '🟥',
  legendary: '🟪',
};

/** Spoiler-free share text: tiers and points, never the answers. */
export function shareText(s: RunSummary, opts: { number?: number; url?: string; zoneName: string; titleName: string }): string {
  const head = s.mode === 'daily' && opts.number ? `HAN-GUK.IO Dive #${opts.number}` : 'HAN-GUK.IO practice dive';
  const squares = s.answers.map((a) => TIER_SQUARES[a.tier]).join('');
  const pts = s.answers.map((a) => String(a.points)).join(' · ');
  const lines = [
    `${head} 🌊`,
    `${s.total}/700 · ${s.depth.toLocaleString('en-US')} m · ${opts.zoneName}`,
    squares,
    pts,
    opts.titleName,
  ];
  if (opts.url) lines.push(opts.url);
  return lines.join('\n');
}
