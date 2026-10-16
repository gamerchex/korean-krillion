import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GAME } from '../src/core/config';
import { Scheduler, addDays } from '../src/core/daily';
import type { Judge, JudgeRequest } from '../src/core/judge';
import type { AiVerdict, AnswerRecord, Attempt, RunState } from '../src/core/types';
import { real } from '../tests/helpers';
import { HangukServer, type ApiRequest, type ServerOptions } from './app';

function setup(opts: Partial<ServerOptions> = {}, start = Date.UTC(2026, 9, 11, 3, 0, 0)) {
  let t = start;
  const { model } = real();
  const server = new HangukServer({ model, now: () => t, adminToken: 'admin-secret-token-123', rateLimit: 10_000, ...opts });
  const call = (method: string, path: string, o: Partial<ApiRequest> = {}) => server.handle({ method, path, ...o });
  const session = async (name = '') => {
    const r = await call('POST', '/api/session', { body: { name } });
    assert.equal(r.status, 200);
    return (r.body as { token: string; playerId: string }).token;
  };
  const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
  /** Start a run and open its first prompt. */
  const begin = async (tok: string, body: Record<string, unknown> = { mode: 'daily' }) => {
    const run = ((await call('POST', '/api/runs', { body, ...auth(tok) })).body as { run: RunState }).run;
    return ((await call('POST', `/api/runs/${run.runId}/open`, auth(tok))).body as { run: RunState }).run;
  };
  const answer = async (tok: string, runId: string, input: string) => {
    const r = await call('POST', `/api/runs/${runId}/answer`, { body: { input }, ...auth(tok) });
    return { status: r.status, ...(r.body as { run: RunState; record: AnswerRecord | null; attempt: Attempt | null }) };
  };
  return { server, model, call, session, auth, begin, answer, tick: (ms: number) => (t += ms), now: () => t };
}

/** Pick an answer for a prompt: the most familiar or the rarest accepted answer. */
function answerFor(model: ReturnType<typeof setup>['model'], promptId: string, which: 'common' | 'rare', avoid: string[] = []) {
  const rt = model.runtime(promptId);
  const list = rt.acceptedList.slice().sort((a, b) => model.famFor(rt.prompt, b) - model.famFor(rt.prompt, a)).filter((e) => !avoid.includes(e.name));
  return (which === 'common' ? list[0] : list[list.length - 1]).name;
}

/** A past dive whose first prompt takes English answers (so a Latin "new answer" is allowed). */
function englishArchive(model: ReturnType<typeof setup>['model']): string {
  const sched = new Scheduler(model);
  for (let d = GAME.epoch; d < '2026-10-11'; d = addDays(d, 1)) {
    const first = model.prompt(sched.promptIdsFor(d)[0])!;
    if (first.accept.includes('en') && !first.closed && !first.includeOnly) return d;
  }
  throw new Error('no suitable archive date');
}

/** A judge that accepts anything starting with "zz" as a new answer, and counts its calls. */
function fakeJudge(familiarity = 2) {
  const calls: JudgeRequest[] = [];
  const judge: Judge = async (req) => {
    calls.push(req);
    const ok = req.answer.toLowerCase().startsWith('zz');
    const v: AiVerdict = ok
      ? { verdict: 'valid', canonical: 'Zzyzx', hangul: '', familiarity, reason: { en: 'A real one.', ko: '있는 답입니다.' }, by: 'fake' }
      : { verdict: 'invalid', canonical: '', hangul: '', familiarity: 1, reason: { en: 'Not a real one.', ko: '없는 답입니다.' }, by: 'fake' };
    return v;
  };
  return { judge, calls };
}

describe('reference server', () => {
  it('reports health and serves today’s dive', async () => {
    const { call } = setup();
    const h = await call('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal((h.body as { today: string }).today, '2026-10-11');
    assert.equal((h.body as { ai: boolean }).ai, false);
    const d = await call('GET', '/api/daily');
    assert.equal(d.status, 200);
    assert.equal((d.body as { challenge: { promptIds: string[] } }).challenge.promptIds.length, 7);
    assert.equal((await call('GET', '/api/daily', { query: { date: '2026-10-12' } })).status, 400, 'no peeking at tomorrow');
  });

  it('requires a session for game actions', async () => {
    const { call } = setup();
    assert.equal((await call('POST', '/api/runs', { body: { mode: 'daily' } })).status, 401);
    assert.equal((await call('POST', '/api/runs', { body: {}, headers: { authorization: 'Bearer not-a-real-token-but-long-enough' } })).status, 401);
  });

  it('plays a full daily with server-side timing and scoring', async () => {
    const { call, session, auth, begin, answer, tick, model } = setup();
    const tok = await session('Haenyeo');
    let run = await begin(tok);
    const id = run.runId;
    assert.equal(run.deadline! - run.openedAt!, GAME.defaultTimerSec * 1000);
    const used: string[] = [];
    let total = 0;
    let r = await call('GET', `/api/runs/${id}`, auth(tok));
    for (let i = 0; i < 7; i++) {
      tick(3000);
      const ans = answerFor(model, run.promptIds[i], i % 2 ? 'rare' : 'common', used);
      used.push(ans);
      const res = await answer(tok, id, ans);
      assert.equal(res.status, 200, JSON.stringify(res));
      assert.equal(res.record?.status, 'accepted', `${run.promptIds[i]}: ${ans} (${res.attempt?.reason})`);
      total += res.record!.points;
      // the prompt is over: another answer is refused
      assert.equal((await answer(tok, id, ans)).status, 409);
      r = await call('POST', `/api/runs/${id}/advance`, auth(tok));
      run = (r.body as { run: RunState }).run;
    }
    assert.equal(run.phase, 'done');
    assert.equal(run.total, total);
    assert.equal((r.body as { summary: { total: number } }).summary.total, total);
    // the daily can't be restarted; asking again returns the finished run
    const again = await call('POST', '/api/runs', { body: { mode: 'daily' }, ...auth(tok) });
    assert.equal((again.body as { resumed: boolean }).resumed, true);
    assert.equal((again.body as { run: RunState }).run.phase, 'done');
    const lb = await call('GET', '/api/leaderboard', { query: { type: 'daily' }, ...auth(tok) });
    const rows = (lb.body as { rows: Array<{ name: string; score: number; isMe: boolean; rank: number }> }).rows;
    assert.deepEqual(rows.map((x) => [x.name, x.score, x.isMe, x.rank]), [['Haenyeo', total, true, 1]]);
  });

  it('keeps a prompt open after a wrong try, on the server clock', async () => {
    const { session, begin, answer, tick, model } = setup();
    const tok = await session();
    const run = await begin(tok);
    tick(2000);
    const wrong = await answer(tok, run.runId, 'zzyzx qwerty');
    assert.equal(wrong.status, 200);
    assert.equal(wrong.record, null);
    assert.equal(wrong.attempt?.reason, 'not-found');
    assert.equal(wrong.run.deadline, run.deadline! - GAME.wrongTryPenaltyMs);
    tick(2000);
    const right = await answer(tok, run.runId, answerFor(model, run.promptIds[0], 'common'));
    assert.equal(right.record?.status, 'accepted');
    assert.equal(right.record?.tries?.length, 1);
  });

  it('times out late answers and lets a player pass', async () => {
    const { call, session, auth, begin, answer, tick, model } = setup();
    const tok = await session();
    const run = await begin(tok);
    tick(GAME.defaultTimerSec * 1000 + GAME.lateGraceMs + 50);
    const late = await answer(tok, run.runId, answerFor(model, run.promptIds[0], 'common'));
    assert.equal(late.record?.status, 'timeout');
    assert.equal(late.record?.points, 0);
    const tok2 = await session();
    const run2 = await begin(tok2, { mode: 'practice', count: 2 });
    const skip = await call('POST', `/api/runs/${run2.runId}/skip`, auth(tok2));
    assert.equal((skip.body as { record: AnswerRecord }).record.reason, 'skipped');
  });

  it('uses other players’ answers (never your own) once the sample is large enough', async () => {
    const { call, session, begin, answer, tick, model } = setup();
    const today = ((await call('GET', '/api/daily')).body as { challenge: { promptIds: string[] } }).challenge;
    const first = today.promptIds[0];
    const common = answerFor(model, first, 'common');
    const rare = answerFor(model, first, 'rare');
    for (let i = 0; i < 30; i++) {
      const tok = await session(`p${i}`);
      const run = await begin(tok);
      tick(1000);
      await answer(tok, run.runId, rare);
    }
    const tok = await session('late');
    const run = await begin(tok);
    tick(1000);
    const rec = (await answer(tok, run.runId, rare)).record!;
    assert.equal(rec.estimate?.source, 'blended');
    assert.equal(rec.estimate?.sampleSize, 30);
    assert.ok(rec.points < 40, `a popular "rare" answer now scores low (${rec.points})`);
    const tok2 = await session('other');
    const run2 = await begin(tok2);
    tick(1000);
    const rec2 = (await answer(tok2, run2.runId, common)).record!;
    assert.ok(rec2.points > 1, `common answer rescored with data (${rec2.points})`);
  });

  it('checks unknown answers with the AI judge once, and scores everyone alike', async () => {
    const { judge, calls } = fakeJudge(2);
    const { call, session, begin, answer, tick, model } = setup({ judge });
    assert.equal(((await call('GET', '/api/health')).body as { ai: boolean }).ai, true);
    const dateKey = englishArchive(model);
    const results: AnswerRecord[] = [];
    for (const name of ['a', 'b']) {
      const tok = await session(name);
      const run = await begin(tok, { mode: 'archive', dateKey });
      tick(1500);
      const res = await answer(tok, run.runId, 'Zzyzx');
      assert.equal(res.record?.status, 'accepted', JSON.stringify(res.attempt));
      results.push(res.record!);
    }
    assert.equal(calls.length, 1, 'the second player is answered from the shared verdict');
    assert.equal(results[0].matchedBy, 'ai');
    assert.equal(results[0].entityKey, 'ai:zzyzx');
    assert.equal(results[0].points, results[1].points);
    assert.equal(results[0].ai?.familiarity, 2);

    // An invalid verdict is a wrong try with the AI's reason.
    const tok = await session('c');
    const run = await begin(tok, { mode: 'archive', dateKey });
    const bad = await answer(tok, run.runId, 'definitely not real');
    assert.equal(bad.attempt?.reason, 'ai-rejected');
    assert.equal(bad.attempt?.aiNote?.en, 'Not a real one.');
    assert.equal(bad.run.aiChecks, 1);
  });

  it('lets a moderator review and block AI-accepted answers', async () => {
    const { judge } = fakeJudge(3);
    const { call, session, begin, answer, tick, model } = setup({ judge });
    const dateKey = englishArchive(model);
    const tok = await session();
    const run = await begin(tok, { mode: 'archive', dateKey });
    tick(1000);
    assert.equal((await answer(tok, run.runId, 'zzyzx')).record?.status, 'accepted');
    const admin = { headers: { 'x-admin-token': 'admin-secret-token-123' } };
    assert.equal((await call('GET', '/api/ai-answers', { headers: { authorization: 'Bearer x' } })).status, 403);
    const list = ((await call('GET', '/api/ai-answers', admin)).body as { answers: Array<{ promptId: string; answerKey: string; canonical: string; blocked: boolean }> }).answers;
    assert.equal(list.length, 1);
    assert.equal(list[0].canonical, 'Zzyzx');
    assert.equal((await call('POST', '/api/ai-answers/block', { body: { promptId: list[0].promptId, answerKey: list[0].answerKey }, ...admin })).status, 200);
    const tok2 = await session();
    const run2 = await begin(tok2, { mode: 'archive', dateKey });
    assert.equal(run2.promptIds[0], list[0].promptId);
    const blocked = await answer(tok2, run2.runId, 'zzyzx');
    assert.equal(blocked.attempt?.reason, 'ai-rejected');
    assert.match(blocked.attempt?.aiNote?.en ?? '', /moderator/);
  });

  it('falls back to the bank, without a penalty, when the judge fails or the daily AI budget is spent', async () => {
    const failing: Judge = async () => {
      throw new Error('overloaded');
    };
    const { session, begin, answer, tick } = setup({ judge: failing });
    const tok = await session();
    const run = await begin(tok, { mode: 'practice', count: 1, categories: ['food'] });
    tick(1000);
    const res = await answer(tok, run.runId, 'zzyzx');
    assert.equal(res.attempt?.reason, 'not-found');
    assert.equal(res.attempt?.penaltyMs, undefined);
    assert.equal(res.run.deadline, run.deadline);

    const { judge, calls } = fakeJudge();
    const limited = setup({ judge, aiChecksPerDay: 1 });
    const t2 = await limited.session();
    const r2 = await limited.begin(t2, { mode: 'practice', count: 1, categories: ['food'] });
    await limited.answer(t2, r2.runId, 'not food one');
    const second = await limited.answer(t2, r2.runId, 'not food two');
    assert.equal(calls.length, 1);
    assert.equal(second.attempt?.reason, 'not-found');
  });

  it('holds the run while the judge thinks, with the clock paused', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Judge = async () => {
      await gate;
      return { verdict: 'valid', canonical: 'Zzyzx', hangul: '', familiarity: 3, reason: { en: 'Fine.', ko: '좋아요.' } };
    };
    const { call, session, auth, begin, answer, tick, model } = setup({ judge: slow });
    const tok = await session();
    const run = await begin(tok, { mode: 'archive', dateKey: englishArchive(model) });
    tick(5000);
    const pending = answer(tok, run.runId, 'zzyzx');
    await new Promise((r) => setTimeout(r, 5));
    tick(60_000); // the judge takes "a minute": long past the deadline
    const expire = call('POST', `/api/runs/${run.runId}/expire`, auth(tok));
    release();
    const done = await pending;
    assert.equal(done.record?.status, 'accepted', `judging time does not count against the player (${JSON.stringify(done.attempt)})`);
    assert.equal(done.record?.elapsedMs, 5000);
    assert.equal(((await expire).body as { record: AnswerRecord | null }).record, null, 'the expire waited and found the prompt answered');
  });

  it('keeps today’s answer distribution hidden until you finish', async () => {
    const { call, session, auth } = setup();
    const tok = await session();
    assert.equal((await call('GET', '/api/stats/daily-2026-10-11', auth(tok))).status, 403);
    assert.equal((await call('GET', '/api/stats/daily-2026-10-10', auth(tok))).status, 200);
  });

  it('runs a moderated review queue', async () => {
    const { call, session, auth, begin, answer, tick } = setup();
    const tok = await session();
    const daily = ((await call('GET', '/api/daily')).body as { challenge: { promptIds: string[] } }).challenge;
    const pid = daily.promptIds[0];
    const rep = await call('POST', '/api/reports', { body: { promptId: pid, input: 'Zzyzx Qwerty', reason: 'not-found', note: 'I swear' }, ...auth(tok) });
    assert.equal(rep.status, 200);
    assert.equal((await call('GET', '/api/reports', auth(tok))).status, 403, 'players cannot read the queue');
    const admin = { headers: { 'x-admin-token': 'admin-secret-token-123' } };
    const list = ((await call('GET', '/api/reports', admin)).body as { reports: Array<{ id: number; input: string }> }).reports;
    assert.equal(list[0].input, 'Zzyzx Qwerty');
    assert.equal((await call('POST', `/api/reports/${list[0].id}/approve`, admin)).status, 200);
    const run = await begin(tok);
    tick(1000);
    const rec = (await answer(tok, run.runId, 'zzyzx qwerty')).record!;
    assert.equal(rec.status, 'accepted');
    assert.equal(rec.matchedBy, 'community');
  });

  it('validates input and limits request rates', async () => {
    const { model } = setup();
    const limited = new HangukServer({ model, rateLimit: 3, now: () => 1 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.handle({ method: 'GET', path: '/api/health', ip: '1.2.3.4' })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    let clock = 0;
    const sessions = new HangukServer({ model, sessionsPerHour: 2, now: () => clock });
    const mk = async (ip: string) => (await sessions.handle({ method: 'POST', path: '/api/session', body: {}, ip })).status;
    assert.deepEqual([await mk('5.6.7.8'), await mk('5.6.7.8'), await mk('5.6.7.8'), await mk('9.9.9.9')], [200, 200, 429, 200]);
    clock += 3_600_001;
    assert.equal(await mk('5.6.7.8'), 200, 'the window slides');
    const { call, session, auth } = setup();
    const tok = await session();
    assert.equal((await call('POST', '/api/runs', { body: { mode: 'archive', dateKey: '../../etc' }, ...auth(tok) })).status, 400);
    assert.equal((await call('POST', '/api/runs', { body: { mode: 'archive', dateKey: '2027-01-01' }, ...auth(tok) })).status, 400);
    assert.equal((await call('GET', '/api/runs/run_doesnotexist123', auth(tok))).status, 404);
    assert.equal((await call('POST', '/api/runs/run_doesnotexist123/answer', { body: { input: 'x' }, ...auth(tok) })).status, 404);
    assert.equal((await call('POST', '/api/reports', { body: { promptId: 'nope', input: 'x' }, ...auth(tok) })).status, 400);
    assert.equal((await call('GET', '/api/leaderboard', { query: { type: 'bogus' } })).status, 400);
  });

  it('lets a player read only their own runs', async () => {
    const { call, session, auth } = setup();
    const a = await session();
    const b = await session();
    const run = ((await call('POST', '/api/runs', { body: { mode: 'practice', count: 3 }, ...auth(a) })).body as { run: RunState }).run;
    assert.equal(run.promptIds.length, 3);
    assert.equal((await call('GET', `/api/runs/${run.runId}`, auth(a))).status, 200);
    assert.equal((await call('GET', `/api/runs/${run.runId}`, auth(b))).status, 404);
  });
});
