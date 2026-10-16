// Daily challenge system. The official set for a date is a pure function of
// (content, date, selection version): every device computes the same seven prompts in the
// same order, and nobody can reroll it. Dates are KST (Asia/Seoul, UTC+9, no DST).

import { GAME, SCORING, type GameConfig, type ScoringConfig } from './config';
import type { ContentModel } from './content';
import { rngFor, shuffle, weightedPick } from './rng';
import type { CategoryId, PromptDef } from './types';

const DAY_MS = 86_400_000;

export function kstDateKey(ms: number, cfg: GameConfig = GAME): string {
  return new Date(ms + cfg.utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** UTC epoch ms of 00:00 KST on the given date. */
export function dateKeyStartMs(dateKey: string, cfg: GameConfig = GAME): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - cfg.utcOffsetMinutes * 60_000;
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

export function isValidDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function msUntilNextDaily(now: number, cfg: GameConfig = GAME): number {
  const today = kstDateKey(now, cfg);
  return dateKeyStartMs(addDays(today, 1), cfg) - now;
}

/** Monday (KST date key) of the week containing dateKey. */
export function weekStart(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((dow + 6) % 7));
}

export function challengeNumber(dateKey: string, cfg: GameConfig = GAME): number {
  return daysBetween(cfg.epoch, dateKey) + 1;
}

export function dailyChallengeId(dateKey: string): string {
  return `daily-${dateKey}`;
}

export interface DailyChallenge {
  id: string;
  dateKey: string;
  number: number;
  promptIds: string[];
  publishedAt: number;
  scoringVersion: string;
  selectionVersion: string;
  contentVersion: string;
  status: 'live' | 'archived' | 'upcoming';
}

interface SchedState {
  day: string;
  lastUsed: Map<string, string>;
  catLast: Map<CategoryId, string>;
}

export class Scheduler {
  private model: ContentModel;
  private game: GameConfig;
  private scoring: ScoringConfig;
  private cache = new Map<string, string[]>();
  private state: SchedState | null = null;

  constructor(model: ContentModel, game: GameConfig = GAME, scoring: ScoringConfig = SCORING) {
    this.model = model;
    this.game = game;
    this.scoring = scoring;
  }

  /** The official challenge for a KST date. Dates before the epoch have no challenge. */
  forDate(dateKey: string, now: number = Date.now()): DailyChallenge | null {
    if (!isValidDateKey(dateKey) || dateKey < this.game.epoch) return null;
    const promptIds = this.promptIdsFor(dateKey);
    const today = kstDateKey(now, this.game);
    return {
      id: dailyChallengeId(dateKey),
      dateKey,
      number: challengeNumber(dateKey, this.game),
      promptIds,
      publishedAt: dateKeyStartMs(dateKey, this.game),
      scoringVersion: this.scoring.version,
      selectionVersion: this.game.selectionVersion,
      contentVersion: this.model.content.version,
      status: dateKey === today ? 'live' : dateKey < today ? 'archived' : 'upcoming',
    };
  }

  promptIdsFor(dateKey: string): string[] {
    const hit = this.cache.get(dateKey);
    if (hit) return hit;
    if (!this.state || this.state.day >= dateKey) {
      this.state = { day: addDays(this.game.epoch, -1), lastUsed: new Map(), catLast: new Map() };
    }
    while (this.state.day < dateKey) {
      const day = addDays(this.state.day, 1);
      // A published (locked) day is replayed exactly as published; everything after it is
      // selected by the algorithm, which sees the locked days in its cooldown history.
      const locked = this.model.content.schedule?.[day];
      const ids = locked && locked.length && locked.every((id) => this.model.prompt(id)) ? locked.slice() : this.selectDay(day, this.state);
      this.markUsed(ids, day, this.state);
      this.cache.set(day, ids);
      this.state.day = day;
    }
    return this.cache.get(dateKey)!;
  }

  /** True when the date's prompts come from the published schedule lock. */
  isLocked(dateKey: string): boolean {
    return Boolean(this.model.content.schedule?.[dateKey]);
  }

  private markUsed(ids: string[], day: string, st: SchedState): void {
    for (const id of ids) {
      const p = this.model.prompt(id);
      st.lastUsed.set(id, day);
      if (p) st.catLast.set(p.category, day);
    }
  }

  private selectDay(day: string, st: SchedState): string[] {
    const n = this.game.promptsPerDaily;
    const rnd = rngFor(`${this.game.selectionVersion}|${day}`);
    const all = this.model.dailyEligible(day, this.game.minAnswersForDaily);
    const age = (id: string) => {
      const last = st.lastUsed.get(id);
      return last ? daysBetween(last, day) : 10_000;
    };
    let pool = all.filter((p) => age(p.id) > this.game.cooldownDays);
    if (pool.length < n * 2) {
      // Not enough fresh prompts: fall back to the least recently used ones.
      pool = all.slice().sort((a, b) => age(b.id) - age(a.id)).slice(0, Math.max(n * 3, pool.length));
    }

    const byCat = new Map<CategoryId, PromptDef[]>();
    for (const p of pool) {
      const list = byCat.get(p.category);
      if (list) list.push(p);
      else byCat.set(p.category, [p]);
    }

    // Seven distinct categories when possible, favouring ones not seen recently.
    const cats: CategoryId[] = [];
    let remaining = [...byCat.keys()].sort();
    while (cats.length < n && remaining.length) {
      const pick = weightedPick(
        remaining,
        (c) => {
          const last = st.catLast.get(c);
          const since = last ? Math.min(daysBetween(last, day), 14) : 14;
          return (since + 1) * Math.sqrt(byCat.get(c)!.length);
        },
        rnd,
      )!;
      cats.push(pick);
      remaining = remaining.filter((c) => c !== pick);
    }
    while (cats.length < n && byCat.size) cats.push([...byCat.keys()].sort()[Math.floor(rnd() * byCat.size)]);

    const plan = shuffle(this.game.difficultyPlan.slice(0, n), rnd);
    const chosen: PromptDef[] = [];
    const used = new Set<string>();
    cats.forEach((cat, i) => {
      const target = plan[i] ?? 2;
      const options = (byCat.get(cat) ?? []).filter((p) => !used.has(p.id));
      if (!options.length) return;
      const best = Math.min(...options.map((p) => Math.abs(p.difficulty - target)));
      const fit = options.filter((p) => Math.abs(p.difficulty - target) === best);
      const pick = weightedPick(fit, (p) => Math.min(age(p.id), 120) + 1, rnd)!;
      chosen.push(pick);
      used.add(pick.id);
    });
    // Top up from anything left if categories ran out.
    if (chosen.length < n) {
      for (const p of shuffle(pool, rnd)) {
        if (chosen.length >= n) break;
        if (!used.has(p.id)) {
          chosen.push(p);
          used.add(p.id);
        }
      }
    }

    // Play order: easier prompts first; ties keep the seeded order.
    const order = chosen.map((p, i) => ({ p, i })).sort((a, b) => a.p.difficulty - b.p.difficulty || a.i - b.i);
    return order.map((o) => o.p.id);
  }

  /** Past challenges from the epoch up to (not including) today, newest first. */
  archive(now: number = Date.now()): DailyChallenge[] {
    const today = kstDateKey(now, this.game);
    const out: DailyChallenge[] = [];
    for (let d = addDays(today, -1); d >= this.game.epoch; d = addDays(d, -1)) {
      const c = this.forDate(d, now);
      if (c) out.push(c);
      if (out.length > 366) break;
    }
    return out;
  }
}

/** Practice sets: any approved prompt, optionally limited to categories, avoiding recent ones. */
export function practiceSet(
  model: ContentModel,
  opts: { count: number; categories?: CategoryId[]; avoid?: string[]; seed: string },
): string[] {
  const rnd = rngFor(`practice|${opts.seed}`);
  const avoid = new Set(opts.avoid ?? []);
  let pool = model.content.prompts.filter(
    (p) => p.status === 'approved' && (!opts.categories?.length || opts.categories.includes(p.category)),
  );
  pool = pool.filter((p) => model.runtime(p.id).accepted.size >= 4);
  const fresh = pool.filter((p) => !avoid.has(p.id));
  const source = fresh.length >= opts.count ? fresh : pool;
  // Spread across categories: round-robin over shuffled category buckets.
  const buckets = new Map<string, PromptDef[]>();
  for (const p of shuffle(source, rnd)) {
    const b = buckets.get(p.category);
    if (b) b.push(p);
    else buckets.set(p.category, [p]);
  }
  const out: string[] = [];
  const keys = shuffle([...buckets.keys()], rnd);
  while (out.length < opts.count && keys.some((k) => buckets.get(k)!.length)) {
    for (const k of keys) {
      const b = buckets.get(k)!;
      if (b.length && out.length < opts.count) out.push(b.shift()!.id);
    }
  }
  return out;
}
