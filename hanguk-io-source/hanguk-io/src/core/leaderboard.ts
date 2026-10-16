// Leaderboards and observed answer statistics, computed from per-player result records.
// Ranking rule (documented in How to play): higher score ranks higher; equal scores share
// a rank (1, 2, 2, 4); within a shared rank, earlier finishers are listed first.

import { addDays, weekStart } from './daily';
import type { AnswerStats } from './types';

/** One official daily result as published to a shared board. */
export interface BoardRun {
  /** score */
  s: number;
  /** depth in meters */
  d: number;
  /** answer keys per prompt index (null = no valid answer) */
  a: Array<string | null>;
  /** 0 = valid, 1 = rejected, 2 = timeout, per prompt index */
  r?: number[];
  /** finished at (ms) */
  t: number;
  /** scoring model version */
  v: string;
}

export interface BoardDoc {
  name: string;
  updatedAt: number;
  runs: Record<string, BoardRun>;
  allTime: { dives: number; total: number; best: number };
}

export interface Ranked {
  id: string;
  name: string;
  score: number;
  detail?: string;
  at: number;
  rank: number;
  isMe: boolean;
}

export function rankEntries(entries: Array<Omit<Ranked, 'rank' | 'isMe'>>, meId?: string | null): Ranked[] {
  const sorted = entries.slice().sort((a, b) => b.score - a.score || a.at - b.at || a.id.localeCompare(b.id));
  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((e, i) => {
    const rank = e.score === lastScore ? lastRank : i + 1;
    lastScore = e.score;
    lastRank = rank;
    return { ...e, rank, isMe: !!meId && e.id === meId };
  });
}

export type Boards = Map<string, BoardDoc>;

export function dailyBoard(docs: Boards, challengeId: string, meId?: string | null): Ranked[] {
  const rows: Array<Omit<Ranked, 'rank' | 'isMe'>> = [];
  for (const [id, doc] of docs) {
    const r = doc.runs?.[challengeId];
    if (r) rows.push({ id, name: doc.name, score: r.s, at: r.t, detail: `${r.d.toLocaleString('en-US')} m` });
  }
  return rankEntries(rows, meId);
}

/** Sum of official daily scores for the KST week (Mon-Sun) containing dateKey. */
export function weeklyBoard(docs: Boards, dateKey: string, meId?: string | null): Ranked[] {
  const start = weekStart(dateKey);
  const ids = new Set(Array.from({ length: 7 }, (_, i) => `daily-${addDays(start, i)}`));
  const rows: Array<Omit<Ranked, 'rank' | 'isMe'>> = [];
  for (const [id, doc] of docs) {
    let total = 0;
    let dives = 0;
    let last = 0;
    for (const [cid, r] of Object.entries(doc.runs ?? {})) {
      if (!ids.has(cid)) continue;
      total += r.s;
      dives++;
      last = Math.max(last, r.t);
    }
    if (dives) rows.push({ id, name: doc.name, score: total, at: last, detail: `${dives} dive${dives === 1 ? '' : 's'}` });
  }
  return rankEntries(rows, meId);
}

/** All-time: total points across every official daily. */
export function allTimeBoard(docs: Boards, meId?: string | null): Ranked[] {
  const rows: Array<Omit<Ranked, 'rank' | 'isMe'>> = [];
  for (const [id, doc] of docs) {
    if (!doc.allTime?.dives) continue;
    rows.push({ id, name: doc.name, score: doc.allTime.total, at: doc.updatedAt, detail: `${doc.allTime.dives} dives · best ${doc.allTime.best}` });
  }
  return rankEntries(rows, meId);
}

/** Observed answers for one prompt of one challenge, excluding one player (the one being scored). */
export function statsFromBoards(docs: Boards, challengeId: string, index: number, excludeId?: string | null): AnswerStats {
  const counts: Record<string, number> = {};
  let valid = 0;
  let eligible = 0;
  for (const [id, doc] of docs) {
    if (excludeId && id === excludeId) continue;
    const r = doc.runs?.[challengeId];
    if (!r || index >= r.a.length) continue;
    eligible++;
    const key = r.a[index];
    if (key) {
      valid++;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return { valid, eligible, counts };
}

/** Keep a board document small: drop runs older than `keepDays` before `todayKey`. */
export function pruneRuns(runs: Record<string, BoardRun>, todayKey: string, keepDays = 90): Record<string, BoardRun> {
  const cutoff = `daily-${addDays(todayKey, -keepDays)}`;
  const out: Record<string, BoardRun> = {};
  for (const [k, v] of Object.entries(runs)) if (k >= cutoff) out[k] = v;
  return out;
}
