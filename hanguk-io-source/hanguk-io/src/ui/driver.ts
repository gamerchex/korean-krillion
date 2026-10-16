// Dive drivers. The UI plays through a driver so the same screens work in two modes:
//   local  - the rules engine runs in the browser (artifact and standalone copies); answers the
//            bank can't place go to the AI judge from here (ai.ts)
//   server - the reference server (server/) keeps the clock, scores every answer and asks
//            the AI judge itself; the browser only mirrors the run it gets back.

import type { ContentModel } from '../core/content';
import { advance, applyVerdict, expirePrompt, openPrompt, skipPrompt, submitAnswer, type EngineDeps, type SubmitResult } from '../core/engine';
import { buildJudgeRequest, type Judge, type JudgeRequest } from '../core/judge';
import type { AiVerdict, AnswerRecord, Attempt, RunState } from '../core/types';

export interface StepResult {
  run: RunState;
  /** The prompt ended (accepted answer or timeout). */
  record?: AnswerRecord | null;
  /** A wrong try; the prompt is still open unless `record` is set too. */
  attempt?: Attempt | null;
}

export interface DiveDriver {
  kind: 'local' | 'server';
  open(run: RunState): Promise<RunState>;
  submit(run: RunState, input: string): Promise<StepResult | null>;
  expire(run: RunState): Promise<StepResult | null>;
  skip(run: RunState): Promise<StepResult | null>;
  /** A dive reloaded while the judge was thinking: finish that try. */
  resume(run: RunState): Promise<StepResult | null>;
  /** Leave the reveal; returns the next (already opened) prompt, or the finished run. */
  advance(run: RunState): Promise<RunState>;
}

export interface LocalJudging {
  /** The judge to ask, or null when AI checking is off or unavailable. */
  judge: () => Judge | null;
  /** Called when a try goes to the judge (persist the paused run, show "checking"). */
  onJudging?: (run: RunState) => void;
  /** Called with every fresh verdict (to share it). */
  remember?: (promptId: string, input: string, verdict: AiVerdict, record?: AnswerRecord | null) => void;
}

const step = (res: SubmitResult): StepResult | null =>
  res.ignored ? null : { run: res.run, record: res.record ?? null, attempt: res.attempt ?? null };

export function localDriver(model: ContentModel, deps: () => EngineDeps, now: () => number, ai: LocalJudging): DiveDriver {
  /** Ask the judge about the try in `run.judging`, then finish it. */
  const judgeAndApply = async (run: RunState, req: JudgeRequest): Promise<StepResult | null> => {
    ai.onJudging?.(run);
    const judge = ai.judge();
    let verdict: AiVerdict | null = null;
    if (judge) {
      try {
        verdict = await judge(req);
      } catch {
        verdict = null; // judged as the bank saw it, without a penalty
      }
    }
    const done = applyVerdict(run, verdict, now(), deps());
    if (verdict) ai.remember?.(run.promptIds[run.index], run.judging!.input, verdict, done.record);
    return step(done);
  };
  return {
    kind: 'local',
    open: async (run) => openPrompt(run, now(), model),
    submit: async (run, input) => {
      const d = deps();
      const res = submitAnswer(run, input, now(), { ...d, aiAvailable: d.aiAvailable && !!ai.judge() });
      if (res.judge) return judgeAndApply(res.run, res.judge);
      return step(res);
    },
    expire: async (run) => {
      const res = expirePrompt(run, now(), {});
      return res.record ? step(res) : null;
    },
    skip: async (run) => step(skipPrompt(run, now(), {})),
    resume: async (run) => {
      const j = run.judging;
      if (!j) return null;
      return judgeAndApply(run, buildJudgeRequest(model, run.promptIds[run.index], j.input, j.bank));
    },
    advance: async (run) => {
      const next = advance(run, now());
      return next.phase === 'answering' ? openPrompt(next, now(), model) : next;
    },
  };
}

// --- server mode ---------------------------------------------------------------------------

export interface ServerConn {
  token: string;
  playerId: string;
  /** serverTime - localTime, measured at connect. */
  offset: number;
  /** The server checks unknown answers with the AI judge. */
  ai: boolean;
}

const TOKEN_KEY = 'hanguk.server.session';

async function request<T>(conn: ServerConn | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(conn ? { authorization: `Bearer ${conn.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** Look for the reference server on this page's own origin (never inside a claude.ai viewer). */
export async function connectServer(hasRuntime: boolean): Promise<ServerConn | null> {
  if (hasRuntime || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    const res = await fetch('/api/health', { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const health = (await res.json()) as { ok?: boolean; serverTime?: number; ai?: boolean };
    if (!health.ok || typeof health.serverTime !== 'number') return null;
    const offset = health.serverTime - Date.now();
    let saved: { token: string; playerId: string } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved?.token) {
      saved = await request<{ token: string; playerId: string }>(null, 'POST', '/api/session', {});
      try {
        localStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
      } catch {
        /* session lasts for this page load only */
      }
    }
    return { token: saved.token, playerId: saved.playerId, offset, ai: !!health.ai };
  } catch {
    return null;
  }
}

/** Shift a server-clock run onto the local clock for display. */
export function toLocal(run: RunState, offset: number): RunState {
  const shift = (v: number | null | undefined) => (typeof v === 'number' ? v - offset : v);
  return {
    ...run,
    openedAt: shift(run.openedAt) as number | null,
    deadline: shift(run.deadline) as number | null,
    startedAt: shift(run.startedAt) as number,
    finishedAt: shift(run.finishedAt) as number | undefined,
    ...(run.judging ? { judging: { ...run.judging, since: run.judging.since - offset } } : {}),
  };
}

export function serverDriver(conn: ServerConn): DiveDriver {
  const call = <T>(method: string, path: string, body?: unknown) => request<T>(conn, method, path, body);
  return {
    kind: 'server',
    open: async (run) => toLocal((await call<{ run: RunState }>('POST', `/api/runs/${run.runId}/open`)).run, conn.offset),
    submit: async (run, input) => {
      try {
        const r = await call<{ run: RunState; record: AnswerRecord | null; attempt: Attempt | null }>('POST', `/api/runs/${run.runId}/answer`, { input });
        return { run: toLocal(r.run, conn.offset), record: r.record, attempt: r.attempt };
      } catch (e) {
        if ((e as { status?: number }).status === 409) return null;
        throw e;
      }
    },
    expire: async (run) => {
      const r = await call<{ run: RunState; record: AnswerRecord | null }>('POST', `/api/runs/${run.runId}/expire`);
      return r.record ? { run: toLocal(r.run, conn.offset), record: r.record } : null;
    },
    skip: async (run) => {
      const r = await call<{ run: RunState; record: AnswerRecord | null }>('POST', `/api/runs/${run.runId}/skip`);
      return r.record ? { run: toLocal(r.run, conn.offset), record: r.record } : null;
    },
    // The server finishes a judged try on its own; opening waits for it and returns the result.
    resume: async (run) => ({ run: toLocal((await call<{ run: RunState }>('POST', `/api/runs/${run.runId}/open`)).run, conn.offset) }),
    advance: async (run) => toLocal((await call<{ run: RunState }>('POST', `/api/runs/${run.runId}/advance`)).run, conn.offset),
  };
}

export const serverApi = {
  startRun: async (conn: ServerConn, body: Record<string, unknown>) => {
    const r = await request<{ run: RunState; resumed: boolean }>(conn, 'POST', '/api/runs', body);
    return { run: toLocal(r.run, conn.offset), resumed: r.resumed };
  },
  leaderboard: (conn: ServerConn | null, type: 'daily' | 'weekly' | 'alltime', date: string) =>
    request<{ rows: Array<{ rank: number; name: string; score: number; detail?: string; isMe: boolean }> }>(conn, 'GET', `/api/leaderboard?type=${type}&date=${date}`),
  report: (conn: ServerConn, body: { promptId: string; input: string; reason: string; note: string }) => request<{ id: number }>(conn, 'POST', '/api/reports', body),
  rename: (conn: ServerConn, name: string) => request(conn, 'POST', '/api/players/me', { name }),
};
