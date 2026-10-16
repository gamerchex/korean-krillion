// HAN-GUK.IO reference server: authoritative timers and scoring, shared answer statistics,
// leaderboards, a moderated review queue and the AI answer judge, on Node's built-in SQLite
// (node:sqlite).
//
// The request handler is a plain async function over (method, path, headers, body) so the
// tests can drive it in-process with an in-memory database, a fake clock and a fake judge.

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { GAME, SCORING } from '../src/core/config';
import type { ContentModel } from '../src/core/content';
import { Scheduler, addDays, isValidDateKey, kstDateKey, practiceSet, weekStart } from '../src/core/daily';
import { advance, applyVerdict, createRun, expirePrompt, openPrompt, skipPrompt, submitAnswer, type EngineDeps, type SubmitResult } from '../src/core/engine';
import { verdictKey, type Judge } from '../src/core/judge';
import { rankEntries } from '../src/core/leaderboard';
import { cleanInput } from '../src/core/normalize';
import { summarize } from '../src/core/results';
import type { AiVerdict, AnswerStats, CategoryId, RunState } from '../src/core/types';

export interface ServerOptions {
  model: ContentModel;
  dbPath?: string;
  now?: () => number;
  adminToken?: string;
  /** Requests per minute per client key. */
  rateLimit?: number;
  /** New player sessions per hour per client key (slows down throwaway identities). */
  sessionsPerHour?: number;
  /** The AI answer judge for answers the bank can't place (none = bank only). */
  judge?: Judge;
  /** AI checks per player per day (cost control). */
  aiChecksPerDay?: number;
}

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  ip?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  date_key TEXT,
  state TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  scoring_version TEXT NOT NULL,
  content_version TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_daily_per_player ON runs(player_id, challenge_id) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS runs_board ON runs(mode, challenge_id, status);
CREATE TABLE IF NOT EXISTS answers (
  run_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  prompt_id TEXT NOT NULL,
  entity_key TEXT,
  status TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, idx)
);
CREATE INDEX IF NOT EXISTS answers_stats ON answers(challenge_id, idx, status);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  input TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approved (
  prompt_id TEXT NOT NULL,
  text TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (prompt_id, text)
);
-- The AI judge's verdicts, shared: the same answer to the same prompt gets the same verdict.
CREATE TABLE IF NOT EXISTS ai_verdicts (
  prompt_id TEXT NOT NULL,
  input_key TEXT NOT NULL,
  verdict TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (prompt_id, input_key)
);
-- New answers the judge accepted (not in the bank), with the familiarity they are scored at.
CREATE TABLE IF NOT EXISTS ai_answers (
  prompt_id TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  canonical TEXT NOT NULL,
  hangul TEXT,
  familiarity INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (prompt_id, answer_key)
);
`;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? cleanInput(v).slice(0, max) : '';
}

/** Strip server-only details before sending a run to the client. */
function publicRun(run: RunState) {
  return run;
}

export class HangukServer {
  readonly db: DatabaseSync;
  private model: ContentModel;
  private sched: Scheduler;
  private now: () => number;
  private adminToken?: string;
  private limit: number;
  private buckets = new Map<string, { tokens: number; at: number }>();
  private sessionLimit: number;
  private sessionLog = new Map<string, number[]>();
  private judge?: Judge;
  private aiPerDay: number;
  private aiUse = new Map<string, number>();
  /** One action at a time per run: an answer waiting for the judge holds the run. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(o: ServerOptions) {
    this.model = o.model;
    this.sched = new Scheduler(o.model);
    this.now = o.now ?? Date.now;
    this.adminToken = o.adminToken;
    this.limit = o.rateLimit ?? 240;
    this.sessionLimit = o.sessionsPerHour ?? 60;
    this.judge = o.judge;
    this.aiPerDay = o.aiChecksPerDay ?? 150;
    this.db = new DatabaseSync(o.dbPath ?? ':memory:');
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- plumbing -------------------------------------------------------------------------

  private rateLimited(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.limit, at: t };
    b.tokens = Math.min(this.limit, b.tokens + ((t - b.at) / 60_000) * this.limit);
    b.at = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return true;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return false;
  }

  private sessionAllowed(key: string): boolean {
    const t = this.now();
    const recent = (this.sessionLog.get(key) ?? []).filter((x) => t - x < 3_600_000);
    const ok = recent.length < this.sessionLimit;
    if (ok) recent.push(t);
    this.sessionLog.set(key, recent);
    if (this.sessionLog.size > 10_000) this.sessionLog.clear();
    return ok;
  }

  private player(req: ApiRequest): { id: string; name: string } {
    const auth = req.headers?.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(401, 'Sign in first (POST /api/session)');
    const row = this.db.prepare('SELECT id, name FROM players WHERE token_hash = ?').get(sha256(token)) as { id: string; name: string } | undefined;
    if (!row) throw new HttpError(401, 'Unknown session');
    return row;
  }

  private requireAdmin(req: ApiRequest): void {
    const given = req.headers?.['x-admin-token'];
    if (!this.adminToken || !given || sha256(given) !== sha256(this.adminToken)) throw new HttpError(403, 'Admin token required');
  }

  private loadRun(id: string, playerId: string): RunState {
    if (!/^run_[A-Za-z0-9]{6,40}$/.test(id)) throw new HttpError(400, 'Bad run id');
    const row = this.db.prepare('SELECT state, player_id FROM runs WHERE id = ?').get(id) as { state: string; player_id: string } | undefined;
    if (!row || row.player_id !== playerId) throw new HttpError(404, 'No such run');
    return JSON.parse(row.state) as RunState;
  }

  private saveRun(run: RunState): void {
    this.db
      .prepare('UPDATE runs SET state = ?, total = ?, status = ?, finished_at = ? WHERE id = ?')
      .run(JSON.stringify(run), run.total, run.phase === 'done' ? 'done' : 'active', run.finishedAt ?? null, run.runId);
  }

  private stats(challengeId: string, index: number, excludePlayer: string): AnswerStats {
    const rows = this.db
      .prepare(
        `SELECT entity_key AS k, COUNT(*) AS n FROM answers
         WHERE challenge_id = ? AND idx = ? AND player_id != ? AND status = 'accepted' AND entity_key IS NOT NULL
         GROUP BY entity_key`,
      )
      .all(challengeId, index, excludePlayer) as Array<{ k: string; n: number }>;
    const eligible = (
      this.db.prepare('SELECT COUNT(*) AS n FROM answers WHERE challenge_id = ? AND idx = ? AND player_id != ?').get(challengeId, index, excludePlayer) as { n: number }
    ).n;
    const counts: Record<string, number> = {};
    let valid = 0;
    for (const r of rows) {
      counts[r.k] = Number(r.n);
      valid += Number(r.n);
    }
    return { valid, eligible: Number(eligible), counts };
  }

  private approvedFor(promptId: string): string[] {
    return (this.db.prepare('SELECT text FROM approved WHERE prompt_id = ?').all(promptId) as Array<{ text: string }>).map((r) => r.text);
  }

  private aiUseKey(playerId: string): string {
    return `${playerId}|${kstDateKey(this.now())}`;
  }

  private deps(run: RunState, playerId: string): EngineDeps {
    return {
      model: this.model,
      statsFor: (_p: string, index: number) => (run.mode === 'practice' ? null : this.stats(run.challengeId, index, playerId)),
      communityFor: (promptId: string) => this.approvedFor(promptId),
      aiAvailable: !!this.judge && (this.aiUse.get(this.aiUseKey(playerId)) ?? 0) < this.aiPerDay,
      cachedVerdict: (promptId: string, key: string) => {
        const row = this.db.prepare('SELECT verdict FROM ai_verdicts WHERE prompt_id = ? AND input_key = ?').get(promptId, key) as { verdict: string } | undefined;
        return row ? (JSON.parse(row.verdict) as AiVerdict) : undefined;
      },
      aiAnswer: (promptId: string, answerKey: string) => {
        const row = this.db.prepare('SELECT familiarity, blocked FROM ai_answers WHERE prompt_id = ? AND answer_key = ?').get(promptId, answerKey) as
          | { familiarity: number; blocked: number }
          | undefined;
        return row ? { familiarity: Number(row.familiarity), blocked: !!row.blocked } : undefined;
      },
    };
  }

  /** Remember what the judge said, and the familiarity a new answer is scored at (first one wins). */
  private rememberVerdict(promptId: string, input: string, verdict: AiVerdict, res: SubmitResult): void {
    this.db.prepare('INSERT OR IGNORE INTO ai_verdicts (prompt_id, input_key, verdict, created_at) VALUES (?, ?, ?, ?)').run(promptId, verdictKey(promptId, input), JSON.stringify(verdict), this.now());
    const rec = res.record;
    if (rec?.status === 'accepted' && rec.ai && rec.entityKey?.startsWith('ai:')) {
      this.db
        .prepare('INSERT OR IGNORE INTO ai_answers (prompt_id, answer_key, canonical, hangul, familiarity, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(promptId, rec.entityKey, rec.ai.canonical, rec.ai.hangul ?? null, rec.ai.familiarity, this.now());
    }
  }

  /** Run `fn` after any earlier action on the same run has finished. */
  private withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.locks.set(runId, tail);
    void tail.then(() => {
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    });
    return next;
  }

  /** Play one answer: the bank first, then (when needed and allowed) the judge. */
  private async answer(run: RunState, input: string, playerId: string): Promise<SubmitResult> {
    const deps = this.deps(run, playerId);
    const res = submitAnswer(run, input, this.now(), deps);
    if (res.ignored || !res.judge) return res;
    this.saveRun(res.run); // judging: the clock is paused while the judge thinks
    const key = this.aiUseKey(playerId);
    this.aiUse.set(key, (this.aiUse.get(key) ?? 0) + 1);
    if (this.aiUse.size > 50_000) this.aiUse.clear();
    let verdict: AiVerdict | null = null;
    try {
      verdict = await this.judge!(res.judge);
    } catch {
      verdict = null; // the try is rejected as the bank saw it, without a penalty
    }
    const done = applyVerdict(res.run, verdict, this.now(), deps);
    if (verdict) this.rememberVerdict(res.run.promptIds[res.run.index], res.run.judging!.input, verdict, done);
    return done;
  }

  private recordAnswer(run: RunState, playerId: string): void {
    if (run.mode !== 'daily') return;
    const a = run.answers[run.answers.length - 1];
    if (!a) return;
    this.db
      .prepare('INSERT OR IGNORE INTO answers (run_id, player_id, challenge_id, idx, prompt_id, entity_key, status, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(run.runId, playerId, run.challengeId, a.index, a.promptId, a.status === 'accepted' ? a.entityKey ?? null : null, a.status, a.points, this.now());
  }

  // --- routing ----------------------------------------------------------------------------

  async handle(req: ApiRequest): Promise<ApiResponse> {
    try {
      const key = req.ip ?? 'local';
      if (this.rateLimited(key)) throw new HttpError(429, 'Too many requests, slow down');
      return { status: 200, body: await this.route(req) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      return { status: 500, body: { error: 'Internal error' } };
    }
  }

  private async route(req: ApiRequest): Promise<unknown> {
    const m = req.method.toUpperCase();
    const p = req.path.replace(/\/+$/, '') || '/';
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const today = kstDateKey(this.now());

    if (m === 'GET' && p === '/api/health') {
      return { ok: true, serverTime: this.now(), today, contentVersion: this.model.content.version, scoringVersion: SCORING.version, selectionVersion: GAME.selectionVersion, ai: !!this.judge };
    }

    if (m === 'POST' && p === '/api/session') {
      if (!this.sessionAllowed(req.ip ?? 'local')) throw new HttpError(429, 'Too many new players from this address; try again later');
      const token = randomBytes(24).toString('base64url');
      const id = `p_${randomBytes(9).toString('base64url')}`;
      this.db.prepare('INSERT INTO players (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)').run(id, sha256(token), str(body.name, 24), this.now());
      return { playerId: id, token };
    }

    if (m === 'POST' && p === '/api/players/me') {
      const me = this.player(req);
      const name = str(body.name, 24);
      this.db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, me.id);
      return { playerId: me.id, name };
    }

    if (m === 'GET' && p === '/api/daily') {
      const date = req.query?.date ?? today;
      if (!isValidDateKey(date) || date > today) throw new HttpError(400, 'Only today and past dates are available');
      const ch = this.sched.forDate(date, this.now());
      if (!ch) throw new HttpError(404, 'No dive on that date');
      return { challenge: ch };
    }

    if (m === 'POST' && p === '/api/runs') return this.createRun(req, body, today);

    const runMatch = p.match(/^\/api\/runs\/([^/]+)(?:\/(open|answer|expire|skip|advance))?$/);
    if (runMatch) {
      const me = this.player(req);
      const action = runMatch[2];
      if (!action && m === 'GET') return { run: publicRun(this.loadRun(runMatch[1], me.id)) };
      if (m !== 'POST') throw new HttpError(405, 'Use POST');
      this.loadRun(runMatch[1], me.id); // 400/404 before queueing
      return this.withRunLock(runMatch[1], async () => {
        let run = this.loadRun(runMatch[1], me.id);
        // Holding the lock, nothing else can be judging this run: a judging state here was
        // left by a crash. Close that try as the bank saw it (no penalty).
        if (run.judging) {
          run = applyVerdict(run, null, this.now(), this.deps(run, me.id)).run;
          this.saveRun(run);
        }
        const now = this.now();
        if (action === 'open') {
          run = openPrompt(run, now, this.model);
          this.saveRun(run);
          return { run: publicRun(run), serverTime: now };
        }
        if (action === 'answer') {
          const input = typeof body.input === 'string' ? body.input.slice(0, 120) : '';
          const res = await this.answer(run, input, me.id);
          if (res.ignored) throw new HttpError(409, `Answer not accepted: ${res.ignored}`);
          this.saveRun(res.run);
          if (res.record) this.recordAnswer(res.run, me.id);
          return { run: publicRun(res.run), record: res.record ?? null, attempt: res.attempt ?? null, serverTime: this.now() };
        }
        if (action === 'expire' || action === 'skip') {
          const res = action === 'expire' ? expirePrompt(run, now, {}) : skipPrompt(run, now, {});
          if (res.record) {
            this.saveRun(res.run);
            this.recordAnswer(res.run, me.id);
          }
          return { run: publicRun(res.run), record: res.record ?? null, serverTime: now };
        }
        if (action === 'advance') {
          run = advance(run, now);
          if (run.phase === 'answering') run = openPrompt(run, now, this.model);
          this.saveRun(run);
          const summary = run.phase === 'done' ? summarize(run, this.model) : null;
          return { run: publicRun(run), summary, serverTime: now };
        }
        throw new HttpError(404, 'Not found');
      });
    }

    if (m === 'GET' && p === '/api/leaderboard') return this.leaderboard(req, today);

    const statsMatch = p.match(/^\/api\/stats\/(daily-\d{4}-\d{2}-\d{2})$/);
    if (m === 'GET' && statsMatch) {
      const challengeId = statsMatch[1];
      const date = challengeId.slice(6);
      if (date >= today) {
        // Today's distribution is visible only to players who finished today's dive.
        const me = this.player(req);
        const done = this.db.prepare("SELECT 1 FROM runs WHERE player_id = ? AND challenge_id = ? AND status = 'done'").get(me.id, challengeId);
        if (!done) throw new HttpError(403, 'Finish the dive to see how others answered');
      }
      const rows = this.db
        .prepare("SELECT idx, entity_key AS k, COUNT(*) AS n FROM answers WHERE challenge_id = ? AND status = 'accepted' GROUP BY idx, entity_key ORDER BY idx, n DESC")
        .all(challengeId) as Array<{ idx: number; k: string; n: number }>;
      const byIdx: Record<number, Array<{ key: string; count: number }>> = {};
      for (const r of rows) (byIdx[r.idx] ??= []).push({ key: r.k, count: Number(r.n) });
      return { challengeId, prompts: byIdx };
    }

    if (m === 'POST' && p === '/api/reports') {
      const me = this.player(req);
      const promptId = str(body.promptId, 80);
      if (!this.model.prompt(promptId)) throw new HttpError(400, 'Unknown prompt');
      const input = str(body.input, 80);
      if (!input) throw new HttpError(400, 'Empty answer');
      const recent = this.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE player_id = ? AND created_at > ?').get(me.id, this.now() - 86_400_000) as { n: number };
      if (Number(recent.n) >= 50) throw new HttpError(429, 'Report limit reached for today');
      const info = this.db
        .prepare('INSERT INTO reports (player_id, prompt_id, input, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(me.id, promptId, input, str(body.reason, 30) || 'not-found', str(body.note, 300), this.now());
      return { id: Number(info.lastInsertRowid), status: 'pending' };
    }

    if (m === 'GET' && p === '/api/reports') {
      this.requireAdmin(req);
      return {
        reports: this.db
          .prepare("SELECT id, prompt_id AS promptId, input, reason, note, status, created_at AS at FROM reports ORDER BY status = 'pending' DESC, created_at DESC LIMIT 500")
          .all(),
      };
    }

    const reportAction = p.match(/^\/api\/reports\/(\d+)\/(approve|dismiss)$/);
    if (m === 'POST' && reportAction) {
      this.requireAdmin(req);
      const row = this.db.prepare('SELECT prompt_id AS promptId, input FROM reports WHERE id = ?').get(Number(reportAction[1])) as { promptId: string; input: string } | undefined;
      if (!row) throw new HttpError(404, 'No such report');
      if (reportAction[2] === 'approve') {
        this.db.prepare('INSERT OR IGNORE INTO approved (prompt_id, text, approved_at) VALUES (?, ?, ?)').run(row.promptId, row.input, this.now());
        this.db.prepare("UPDATE reports SET status = 'approved' WHERE prompt_id = ? AND input = ?").run(row.promptId, row.input);
      } else {
        this.db.prepare("UPDATE reports SET status = 'dismissed' WHERE id = ?").run(Number(reportAction[1]));
      }
      return { ok: true };
    }

    if (m === 'GET' && p === '/api/ai-answers') {
      this.requireAdmin(req);
      const rows = this.db
        .prepare(
          `SELECT a.prompt_id AS promptId, a.answer_key AS answerKey, a.canonical, a.hangul, a.familiarity, a.blocked, a.created_at AS at,
                  (SELECT COUNT(*) FROM answers x WHERE x.prompt_id = a.prompt_id AND x.entity_key = a.answer_key AND x.status = 'accepted') AS given
           FROM ai_answers a ORDER BY a.created_at DESC LIMIT 1000`,
        )
        .all() as Array<Record<string, unknown>>;
      return { answers: rows.map((r) => ({ ...r, blocked: !!r.blocked, given: Number(r.given) })) };
    }

    const aiAction = p.match(/^\/api\/ai-answers\/(block|unblock)$/);
    if (m === 'POST' && aiAction) {
      this.requireAdmin(req);
      const promptId = str(body.promptId, 80);
      const answerKey = typeof body.answerKey === 'string' ? body.answerKey.slice(0, 200) : '';
      const info = this.db.prepare('UPDATE ai_answers SET blocked = ? WHERE prompt_id = ? AND answer_key = ?').run(aiAction[1] === 'block' ? 1 : 0, promptId, answerKey);
      if (!Number(info.changes)) throw new HttpError(404, 'No such AI answer');
      return { ok: true };
    }

    if (m === 'GET' && p === '/api/approved') {
      const out: Record<string, string[]> = {};
      for (const r of this.db.prepare('SELECT prompt_id AS p, text FROM approved').all() as Array<{ p: string; text: string }>) (out[r.p] ??= []).push(r.text);
      return { approved: out };
    }

    throw new HttpError(404, 'Not found');
  }

  private createRun(req: ApiRequest, body: Record<string, unknown>, today: string): unknown {
    const me = this.player(req);
    const mode = body.mode === 'archive' || body.mode === 'practice' ? body.mode : 'daily';
    const now = this.now();
    let run: RunState;
    if (mode === 'practice') {
      const count = Math.max(1, Math.min(10, Number(body.count) || 7));
      const cats = Array.isArray(body.categories) ? (body.categories.filter((c) => this.model.categories.has(String(c))) as CategoryId[]) : [];
      const timer = body.timer === null ? null : Math.max(5, Math.min(60, Number(body.timer) || GAME.defaultTimerSec));
      const ids = practiceSet(this.model, { count, categories: cats, seed: `${me.id}-${now}` });
      run = createRun({ mode, challengeId: `practice-${now}`, promptIds: ids, timerSec: timer, now, contentVersion: this.model.content.version });
    } else {
      const date = mode === 'daily' ? today : String(body.dateKey ?? '');
      if (!isValidDateKey(date) || date > today || (mode === 'archive' && date === today)) throw new HttpError(400, 'Bad date');
      const ch = this.sched.forDate(date, now);
      if (!ch) throw new HttpError(404, 'No dive on that date');
      if (mode === 'daily') {
        const existing = this.db.prepare("SELECT state FROM runs WHERE player_id = ? AND challenge_id = ? AND mode = 'daily'").get(me.id, ch.id) as { state: string } | undefined;
        if (existing) return { run: JSON.parse(existing.state) as RunState, resumed: true };
      }
      run = createRun({ mode, challengeId: ch.id, dateKey: date, promptIds: ch.promptIds, timerSec: GAME.defaultTimerSec, now, contentVersion: this.model.content.version });
    }
    this.db
      .prepare('INSERT INTO runs (id, player_id, mode, challenge_id, date_key, state, created_at, scoring_version, content_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(run.runId, me.id, run.mode, run.challengeId, run.dateKey ?? null, JSON.stringify(run), now, run.scoringVersion, run.contentVersion);
    return { run, resumed: false };
  }

  private leaderboard(req: ApiRequest, today: string): unknown {
    const type = req.query?.type ?? 'daily';
    const date = req.query?.date ?? today;
    if (!isValidDateKey(date)) throw new HttpError(400, 'Bad date');
    let rows: Array<{ id: string; name: string; score: number; at: number; detail?: string }>;
    if (type === 'daily') {
      rows = (
        this.db
          .prepare("SELECT p.id, p.name, r.total AS score, r.finished_at AS at FROM runs r JOIN players p ON p.id = r.player_id WHERE r.mode = 'daily' AND r.status = 'done' AND r.challenge_id = ?")
          .all(`daily-${date}`) as Array<{ id: string; name: string; score: number; at: number }>
      ).map((r) => ({ ...r, score: Number(r.score), at: Number(r.at), detail: `${Number(r.score) * 10} m` }));
    } else if (type === 'weekly') {
      const start = weekStart(date);
      const ids = Array.from({ length: 7 }, (_, i) => `daily-${addDays(start, i)}`);
      rows = (
        this.db
          .prepare(
            `SELECT p.id, p.name, SUM(r.total) AS score, MAX(r.finished_at) AS at, COUNT(*) AS dives FROM runs r JOIN players p ON p.id = r.player_id
             WHERE r.mode = 'daily' AND r.status = 'done' AND r.challenge_id IN (${ids.map(() => '?').join(',')}) GROUP BY p.id`,
          )
          .all(...ids) as Array<{ id: string; name: string; score: number; at: number; dives: number }>
      ).map((r) => ({ id: r.id, name: r.name, score: Number(r.score), at: Number(r.at), detail: `${r.dives} dives` }));
    } else if (type === 'alltime') {
      rows = (
        this.db
          .prepare(
            "SELECT p.id, p.name, SUM(r.total) AS score, MAX(r.finished_at) AS at, COUNT(*) AS dives, MAX(r.total) AS best FROM runs r JOIN players p ON p.id = r.player_id WHERE r.mode = 'daily' AND r.status = 'done' GROUP BY p.id",
          )
          .all() as Array<{ id: string; name: string; score: number; at: number; dives: number; best: number }>
      ).map((r) => ({ id: r.id, name: r.name, score: Number(r.score), at: Number(r.at), detail: `${r.dives} dives · best ${r.best}` }));
    } else throw new HttpError(400, 'type must be daily, weekly or alltime');
    let meId: string | null = null;
    try {
      meId = this.player(req).id;
    } catch {
      meId = null;
    }
    const ranked = rankEntries(rows, meId).slice(0, 200);
    // Never expose other players' ids.
    return { type, date, rows: ranked.map((r) => ({ rank: r.rank, name: r.name, score: r.score, detail: r.detail, isMe: r.isMe })) };
  }
}
