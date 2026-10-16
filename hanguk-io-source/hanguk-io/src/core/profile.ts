// Personal records: completed dailies, archive and practice runs, streaks, achievements,
// settings and the in-progress dive. Stored per player (browser storage, the artifact's
// private per-viewer store, or the server).

import { ACHIEVEMENTS } from './achievements';
import { addDays, daysBetween } from './daily';
import type { RunSummary } from './results';
import type { CategoryId, RunState } from './types';

export interface Settings {
  lang: 'en' | 'ko';
  music: number;
  sfx: number;
  muted: boolean;
  motion: 'system' | 'reduced' | 'full';
  contrast: boolean;
  diverName: string;
  practiceTimer: number | null;
  practiceCount: number;
  practiceCats: CategoryId[];
  /** Send answers the bank doesn't know to the AI judge (when one is available). */
  aiJudge: boolean;
}

export interface Profile {
  v: 1;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  dailies: Record<string, RunSummary>;
  archive: Record<string, RunSummary>;
  practice: { runs: number; best: number; recent: RunSummary[]; recentPrompts: string[] };
  achievements: Record<string, number>;
  categoriesHit: Partial<Record<CategoryId, number>>;
  reportsFiled: number;
  /** The unfinished practice or archive dive, if any. */
  inProgress: RunState | null;
  /** The unfinished official daily, kept apart so practice can never replace (reroll) it. */
  inProgressDaily: RunState | null;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  music: 0.5,
  sfx: 0.7,
  muted: false,
  motion: 'system',
  contrast: false,
  diverName: '',
  practiceTimer: 20,
  practiceCount: 7,
  practiceCats: [],
  aiJudge: true,
};

export function newProfile(now: number): Profile {
  return {
    v: 1,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    dailies: {},
    archive: {},
    practice: { runs: 0, best: 0, recent: [], recentPrompts: [] },
    achievements: {},
    categoriesHit: {},
    reportsFiled: 0,
    inProgress: null,
    inProgressDaily: null,
  };
}

/** Accept anything that looks like a stored profile and fill in missing fields. */
export function coerceProfile(raw: unknown, now: number): Profile {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Profile>;
  return {
    ...base,
    ...r,
    v: 1,
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    dailies: r.dailies ?? {},
    archive: r.archive ?? {},
    practice: { ...base.practice, ...(r.practice ?? {}) },
    achievements: r.achievements ?? {},
    categoriesHit: r.categoriesHit ?? {},
    reportsFiled: r.reportsFiled ?? 0,
    inProgress: r.inProgress && r.inProgress.mode !== 'daily' ? r.inProgress : null,
    inProgressDaily: r.inProgressDaily ?? (r.inProgress && r.inProgress.mode === 'daily' ? r.inProgress : null),
  };
}

export function streakInfo(profile: Profile, todayKey: string): { current: number; best: number; playedToday: boolean } {
  const days = Object.values(profile.dailies)
    .map((s) => s.dateKey)
    .filter((d): d is string => !!d)
    .sort();
  const set = new Set(days);
  const playedToday = set.has(todayKey);
  let current = 0;
  let cursor = playedToday ? todayKey : addDays(todayKey, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current), playedToday };
}

export function personalBest(profile: Profile): RunSummary | null {
  let best: RunSummary | null = null;
  for (const s of Object.values(profile.dailies)) if (!best || s.total > best.total) best = s;
  return best;
}

export interface ApplyResult {
  profile: Profile;
  unlocked: string[];
}

/** Record a finished dive and evaluate achievements. Official dailies are recorded once. */
export function applyRun(profile: Profile, summary: RunSummary, run: RunState, now: number, todayKey: string): ApplyResult {
  const p: Profile = {
    ...profile,
    dailies: { ...profile.dailies },
    archive: { ...profile.archive },
    practice: { ...profile.practice, recent: profile.practice.recent.slice(), recentPrompts: profile.practice.recentPrompts.slice() },
    categoriesHit: { ...profile.categoriesHit },
    achievements: { ...profile.achievements },
    inProgress: summary.mode === 'daily' ? profile.inProgress : null,
    inProgressDaily: summary.mode === 'daily' ? null : profile.inProgressDaily,
    updatedAt: now,
  };
  if (summary.mode === 'daily') {
    if (!p.dailies[summary.challengeId]) p.dailies[summary.challengeId] = summary;
  } else if (summary.mode === 'archive') {
    const prev = p.archive[summary.challengeId];
    if (!prev || summary.total > prev.total) p.archive[summary.challengeId] = summary;
  } else {
    p.practice.runs += 1;
    p.practice.best = Math.max(p.practice.best, summary.total);
    p.practice.recent = [summary, ...p.practice.recent].slice(0, 12);
    p.practice.recentPrompts = [...summary.promptIds, ...p.practice.recentPrompts].slice(0, 120);
  }
  for (const a of summary.answers) {
    if (a.status === 'accepted') p.categoriesHit[a.category] = (p.categoriesHit[a.category] ?? 0) + 1;
  }
  const streak = streakInfo(p, todayKey).current;
  const unlocked: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (p.achievements[def.id]) continue;
    if (def.check({ profile: p, summary, run, streak })) {
      p.achievements[def.id] = now;
      unlocked.push(def.id);
    }
  }
  return { profile: p, unlocked };
}

/** Store an unfinished dive in the right slot (null clears both). */
export function withInProgress(p: Profile, run: RunState | null, now: number): Profile {
  if (!run) return { ...p, inProgress: null, updatedAt: now };
  return run.mode === 'daily' ? { ...p, inProgressDaily: run, updatedAt: now } : { ...p, inProgress: run, updatedAt: now };
}

/** Merge two copies of a profile (e.g. this browser and the cloud copy). */
export function mergeProfiles(a: Profile, b: Profile): Profile {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = newer === a ? b : a;
  const dailies = { ...older.dailies, ...newer.dailies };
  const archive = { ...older.archive };
  for (const [k, v] of Object.entries(newer.archive)) if (!archive[k] || v.total > archive[k].total) archive[k] = v;
  const achievements = { ...older.achievements };
  for (const [k, v] of Object.entries(newer.achievements)) achievements[k] = achievements[k] ? Math.min(achievements[k], v) : v;
  const categoriesHit: Partial<Record<CategoryId, number>> = { ...older.categoriesHit };
  for (const [k, v] of Object.entries(newer.categoriesHit)) {
    const key = k as CategoryId;
    categoriesHit[key] = Math.max(categoriesHit[key] ?? 0, v ?? 0);
  }
  // A daily that either copy finished is finished: drop a stale in-progress copy of it.
  const pendingDaily = newer.inProgressDaily ?? older.inProgressDaily;
  return {
    ...newer,
    inProgressDaily: pendingDaily && !dailies[pendingDaily.challengeId] ? pendingDaily : null,
    createdAt: Math.min(a.createdAt, b.createdAt),
    dailies,
    archive,
    achievements,
    categoriesHit,
    practice: {
      runs: Math.max(a.practice.runs, b.practice.runs),
      best: Math.max(a.practice.best, b.practice.best),
      recent: newer.practice.recent,
      recentPrompts: newer.practice.recentPrompts,
    },
    reportsFiled: Math.max(a.reportsFiled, b.reportsFiled),
  };
}
