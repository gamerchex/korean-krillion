import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GAME, MAX_DEPTH_M, zoneFor } from '../src/core/config';
import { advance, applyVerdict, createRun, expirePrompt, isComplete, NOTES, openPrompt, remainingMs, skipPrompt, submitAnswer, type EngineDeps } from '../src/core/engine';
import type { AiVerdict, RunState } from '../src/core/types';
import { clock, fixture } from './helpers';

const { model } = fixture();
const deps = { model };
const SEVEN = ['fx-dish', 'fx-dish-2', 'fx-not-kimchi', 'fx-spicy', 'fx-word', 'fx-drink', 'fx-capped'];

function start(promptIds = SEVEN, timerSec: number | null = 20) {
  const c = clock();
  const run = createRun({ mode: 'daily', challengeId: 'daily-2026-10-11', dateKey: '2026-10-11', promptIds, timerSec, now: c.now(), contentVersion: model.content.version });
  return { c, run };
}

describe('dive state machine', () => {
  it('plays a full seven-prompt dive', () => {
    const s = start();
    const c = s.c;
    let run = s.run;
    const inputs = ['hongeo-hoe', 'japchae', 'bulgogi', 'kimchi', '넷', 'makgeolli', 'gimje bread'];
    for (let i = 0; i < 7; i++) {
      run = openPrompt(run, c.tick(1000), model);
      assert.equal(run.phase, 'answering');
      const res = submitAnswer(run, inputs[i], c.tick(3000), deps);
      assert.ok(res.record, `prompt ${i}`);
      assert.equal(res.record!.status, 'accepted', `${inputs[i]}: ${res.record!.reason}`);
      run = advance(res.run, c.tick(500));
    }
    assert.ok(isComplete(run));
    assert.equal(run.answers.length, 7);
    const sum = run.answers.reduce((s, a) => s + a.points, 0);
    assert.equal(run.total, sum);
    assert.equal(run.answers[6].depthAfter, sum * 10);
    assert.equal(run.answers[6].points, 50); // capped prompt
  });

  it('starts the clock only when a prompt opens, and re-opening keeps the deadline', () => {
    const { c, run } = start();
    assert.equal(run.deadline, null);
    const opened = openPrompt(run, c.now(), model);
    assert.equal(opened.deadline, c.now() + 20_000);
    const reopened = openPrompt(opened, c.tick(5000), model);
    assert.equal(reopened.deadline, opened.deadline);
    assert.equal(remainingMs(reopened, c.now()), 15_000);
  });

  it('ignores a submission before the prompt is open and a second submission', () => {
    const { c, run } = start();
    assert.equal(submitAnswer(run, 'kimchi', c.now(), deps).ignored, 'not-open');
    const open = openPrompt(run, c.now(), model);
    const first = submitAnswer(open, 'kimchi', c.tick(1000), deps);
    assert.equal(first.record?.status, 'accepted');
    const second = submitAnswer(first.run, 'bulgogi', c.tick(10), deps);
    assert.equal(second.ignored, 'not-answering');
    assert.equal(second.run.answers.length, 1);
    assert.equal(second.run.total, first.run.total);
  });

  it('keeps the prompt open after a wrong try, charges the penalty, then accepts a right one', () => {
    const { c, run } = start();
    const open = openPrompt(run, c.now(), model);
    const wrong = submitAnswer(open, 'soju', c.tick(2000), deps);
    assert.equal(wrong.record, undefined);
    assert.equal(wrong.attempt?.reason, 'wrong-fit');
    assert.equal(wrong.attempt?.matchedName, 'Soju');
    assert.equal(wrong.attempt?.at, 2000);
    assert.equal(wrong.attempt?.penaltyMs, GAME.wrongTryPenaltyMs);
    assert.equal(wrong.run.phase, 'answering');
    assert.equal(wrong.run.deadline, open.deadline! - GAME.wrongTryPenaltyMs);
    assert.equal(wrong.run.total, 0);
    const right = submitAnswer(wrong.run, 'japchae', c.tick(1500), deps);
    assert.equal(right.record?.status, 'accepted');
    assert.equal(right.record?.tries?.length, 1);
    assert.equal(right.record?.tries?.[0].input, 'soju');
    assert.equal(right.record?.elapsedMs, 3500);
    assert.equal(right.record?.leftMs, 20_000 - 3500 - GAME.wrongTryPenaltyMs);
  });

  it('ends the prompt when penalties use up the clock', () => {
    const { c, run } = start();
    const open = openPrompt(run, c.now(), model);
    const res = submitAnswer(open, 'soju', c.tick(19_000), deps);
    assert.equal(res.attempt?.reason, 'wrong-fit');
    assert.equal(res.record?.status, 'timeout');
    assert.equal(res.record?.tries?.length, 1);
    assert.equal(res.run.phase, 'revealing');
  });

  it('treats a reused answer as a wrong try and ignores empty submissions', () => {
    let { c, run } = start(['fx-dish', 'fx-dish-2']);
    run = openPrompt(run, c.now(), model);
    run = submitAnswer(run, 'japchae', c.tick(1000), deps).run;
    run = advance(run, c.tick(100));
    run = openPrompt(run, c.tick(100), model);
    assert.equal(submitAnswer(run, '   ', c.tick(10), deps).ignored, 'empty');
    const dup = submitAnswer(run, '잡채', c.tick(1000), deps);
    assert.equal(dup.attempt?.reason, 'duplicate');
    assert.equal(dup.record, undefined);
    const other = submitAnswer(dup.run, 'bulgogi', c.tick(1000), deps);
    assert.equal(other.record?.status, 'accepted');
  });

  it('lets the player pass on a prompt', () => {
    const { c, run } = start();
    const open = openPrompt(run, c.now(), model);
    const tried = submitAnswer(open, 'soju', c.tick(3000), deps).run;
    const pass = skipPrompt(tried, c.tick(1000), {});
    assert.equal(pass.record?.status, 'timeout');
    assert.equal(pass.record?.reason, 'skipped');
    assert.equal(pass.record?.points, 0);
    assert.equal(pass.record?.tries?.length, 1);
    assert.equal(skipPrompt(pass.run, c.tick(10), {}).ignored, 'not-answering');
  });

  it('records a timeout once the clock runs out, exactly once', () => {
    let { c, run } = start();
    run = openPrompt(run, c.now(), model);
    assert.equal(expirePrompt(run, c.tick(19_999), {}).ignored, 'not-open');
    const exp = expirePrompt(run, c.tick(1), {});
    assert.equal(exp.record?.status, 'timeout');
    assert.equal(exp.record?.points, 0);
    assert.equal(expirePrompt(exp.run, c.tick(1000), {}).ignored, 'not-answering');
    assert.equal(exp.run.answers.length, 1);
  });

  it('accepts an answer within the grace window but not after it', () => {
    let { c, run } = start();
    run = openPrompt(run, c.now(), model);
    const inGrace = submitAnswer(run, 'kimchi', c.now() + 20_000 + GAME.lateGraceMs - 1, deps);
    assert.equal(inGrace.record?.status, 'accepted');
    const late = submitAnswer(run, 'kimchi', c.now() + 20_000 + GAME.lateGraceMs + 1, deps);
    assert.equal(late.record?.status, 'timeout');
    assert.equal(late.record?.reason, 'late');
    assert.equal(late.record?.points, 0);
  });

  it('runs untimed practice prompts without a deadline or penalties', () => {
    const c = clock();
    let run = createRun({ mode: 'practice', challengeId: 'practice-x', promptIds: ['fx-dish'], timerSec: null, now: c.now(), contentVersion: 'x' });
    run = openPrompt(run, c.now(), model);
    assert.equal(run.deadline, null);
    assert.equal(remainingMs(run, c.tick(999_999)), null);
    const wrong = submitAnswer(run, 'soju', c.now(), deps);
    assert.equal(wrong.attempt?.penaltyMs, undefined);
    assert.equal(wrong.run.deadline, null);
    assert.equal(submitAnswer(wrong.run, 'bulgogi', c.now(), deps).record?.status, 'accepted');
  });

  it('reaches exactly 700 points and 7,000 m with seven maximum answers', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `max-${i}`, en: `Max ${i}`, ko: `최대 ${i}`, pools: 'fx', any: ['spicy'], d: 1 as const, fam: { 'fx:hongeo-hoe': 1, 'fx:kimchi': 6 } }));
    const { model: m } = fixture(many);
    // Make every prompt's rare answer distinct by allowing reuse for this check.
    const game = { ...GAME, allowEntityReuse: true };
    const c = clock();
    let run: RunState = createRun({ mode: 'practice', challengeId: 'p', promptIds: many.map((p) => p.id), timerSec: 20, now: c.now(), contentVersion: 'x' });
    for (let i = 0; i < 7; i++) {
      run = openPrompt(run, c.tick(10), m);
      const r = submitAnswer(run, 'hongeo-hoe', c.tick(10), { model: m, game, statsFor: () => ({ valid: 10_000, eligible: 10_000, counts: { 'fx:kimchi': 10_000 } }) });
      assert.equal(r.record?.points, 100);
      run = advance(r.run, c.tick(10));
    }
    assert.equal(run.total, 700);
    assert.equal(run.answers[6].depthAfter, MAX_DEPTH_M);
    assert.equal(zoneFor(run.answers[6].depthAfter).id, 'hadal');
  });

  it('survives a JSON round trip mid-dive (resume after reload)', () => {
    let { c, run } = start();
    run = openPrompt(run, c.now(), model);
    const restored = JSON.parse(JSON.stringify(run)) as RunState;
    const again = openPrompt(restored, c.tick(4000), model);
    assert.equal(again.deadline, run.deadline);
    assert.equal(submitAnswer(again, 'bulgogi', c.tick(1000), deps).record?.status, 'accepted');
  });
});

const valid = (canonical: string, hangul: string, familiarity: number): AiVerdict => ({
  verdict: 'valid',
  canonical,
  hangul,
  familiarity,
  reason: { en: `${canonical} fits.`, ko: `${hangul} 맞습니다.` },
  by: 'test-judge',
});
const invalid: AiVerdict = { verdict: 'invalid', canonical: '', hangul: '', familiarity: 1, reason: { en: 'Not a dish.', ko: '음식이 아닙니다.' } };

describe('AI judging', () => {
  const ai: EngineDeps = { model, aiAvailable: true };
  const opened = (ids: string[] = ['fx-dish', 'fx-dish-2']) => {
    const s = start(ids);
    return { c: s.c, run: openPrompt(s.run, s.c.now(), model) };
  };

  it('asks the judge only about answers the bank cannot place, with the clock paused', () => {
    const { c, run } = opened();
    assert.equal(submitAnswer(run, 'japchae', c.tick(1000), ai).judge, undefined, 'listed answers never go to the judge');
    const res = submitAnswer(run, 'tteokbokki', c.tick(1000), ai);
    assert.ok(res.judge);
    assert.equal(res.judge!.answer, 'tteokbokki');
    assert.ok(res.judge!.examples.includes('Kimchi (김치)'));
    assert.equal(res.run.judging?.since, c.now());
    assert.equal(expirePrompt(res.run, c.now() + 60_000, {}).ignored, 'judging');
    assert.equal(submitAnswer(res.run, 'bulgogi', c.now() + 10, ai).ignored, 'judging');
    assert.equal(remainingMs(res.run, c.now() + 60_000), remainingMs(res.run, c.now()));
    const done = applyVerdict(res.run, valid('Tteokbokki', '떡볶이', 4), c.tick(3000), ai);
    assert.equal(done.record?.status, 'accepted');
    assert.equal(done.record?.matchedBy, 'ai');
    assert.equal(done.record?.entityKey, 'ai:h:떡볶이');
    assert.equal(done.record?.estimate?.source, 'ai');
    // 6^3 / (8041 + 6^3) -> 40 points
    assert.equal(done.record?.points, 40);
    assert.equal(done.record?.elapsedMs, 2000, 'judging time is not the player\'s time');
    assert.equal(done.record?.ai?.familiarity, 4);
  });

  it('gives back the judging time on a rejected try and counts the AI check', () => {
    const { c, run } = opened();
    const res = submitAnswer(run, 'chocolate', c.tick(1000), ai);
    const before = res.run.deadline!;
    const rej = applyVerdict(res.run, invalid, c.tick(5000), ai);
    assert.equal(rej.attempt?.reason, 'ai-rejected');
    assert.equal(rej.attempt?.aiNote?.en, 'Not a dish.');
    assert.equal(rej.run.deadline, before + 5000 - GAME.wrongTryPenaltyMs);
    assert.equal(rej.run.aiChecks, 1);
    assert.equal(rej.run.judging, null);
  });

  it('scores a new spelling of a listed answer as that answer', () => {
    const { c, run } = opened();
    const res = submitAnswer(run, 'the red fermented cabbage', c.tick(1000), ai);
    assert.ok(res.judge);
    const done = applyVerdict(res.run, valid('Kimchi', '김치', 2), c.tick(800), ai);
    assert.equal(done.record?.entityKey, 'fx:kimchi');
    assert.equal(done.record?.points, submitAnswer(run, 'kimchi', c.now(), deps).record?.points);
  });

  it('keeps exclusions, negative filters, closed lists and the Korean-word rule', () => {
    let { c, run } = opened(['fx-not-kimchi']);
    let res = submitAnswer(run, 'the red fermented cabbage', c.tick(1000), ai);
    assert.equal(applyVerdict(res.run, valid('Kimchi', '김치', 6), c.tick(500), ai).attempt?.reason, 'excluded');

    ({ c, run } = opened(['fx-not-spicy']));
    res = submitAnswer(run, 'hongeo-hoe', c.tick(1000), ai);
    assert.equal(res.judge, undefined, 'a negative filter is a rule, not a gap');
    assert.equal(res.attempt?.reason, 'wrong-fit');

    ({ c, run } = opened(['fx-closed']));
    res = submitAnswer(run, 'beer', c.tick(1000), ai);
    assert.ok(res.judge?.closed);
    const closed = applyVerdict(res.run, valid('Maekju', '맥주', 5), c.tick(500), ai);
    assert.equal(closed.attempt?.reason, 'ai-rejected');
    assert.deepEqual(closed.attempt?.aiNote, NOTES.closed);
    res = submitAnswer(closed.run, 'rice wine', c.tick(1000), ai);
    assert.equal(applyVerdict(res.run, valid('Makgeolli', '막걸리', 5), c.tick(500), ai).record?.entityKey, 'fx:makgeolli');

    ({ c, run } = opened(['fx-word']));
    res = submitAnswer(run, 'five', c.tick(1000), ai);
    assert.equal(applyVerdict(res.run, valid('Daseot', '다섯', 4), c.tick(500), ai).attempt?.reason, 'wrong-language');
    res = submitAnswer(run, 'daseot', c.tick(1000), ai);
    assert.equal(applyVerdict(res.run, valid('Daseot', '다섯', 4), c.tick(500), ai).record?.entityKey, 'ai:h:다섯');
  });

  it('lets a known entry fit a prompt the bank did not list it for, at its own familiarity', () => {
    const { c, run } = opened(['fx-spicy']);
    const res = submitAnswer(run, 'bulgogi', c.tick(1000), ai);
    assert.ok(res.judge?.bankNote?.includes('Bulgogi'));
    const done = applyVerdict(res.run, valid('Bulgogi', '불고기', 1), c.tick(500), ai);
    assert.equal(done.record?.entityKey, 'fx:bulgogi');
    // weight 6^3 (its curated familiarity 4, not the judge's 1) against 7777 -> 39 points
    assert.equal(done.record?.points, 39);
  });

  it('resolves a typo between two answers through the judge', () => {
    const { c, run } = opened(['fx-dish']);
    const res = submitAnswer(run, 'gimbe bread', c.tick(1000), ai);
    if (!res.judge) return assert.fail(`expected an ambiguous typo, got ${res.attempt?.reason ?? res.record?.status}`);
    assert.match(res.judge.bankNote ?? '', /Gimpo bread/);
    assert.equal(applyVerdict(res.run, valid('Gimje bread', '김제빵', 2), c.tick(500), ai).record?.entityKey, 'fx:gimje-bread');
  });

  it('rejects without a penalty when the judge cannot be reached', () => {
    const { c, run } = opened();
    const res = submitAnswer(run, 'tteokbokki', c.tick(1000), ai);
    const before = res.run.deadline!;
    const fail = applyVerdict(res.run, null, c.tick(4000), ai);
    assert.equal(fail.attempt?.reason, 'not-found');
    assert.equal(fail.attempt?.penaltyMs, undefined);
    assert.equal(fail.run.deadline, before + 4000);
    assert.equal(fail.run.aiChecks ?? 0, 0);
  });

  it('stops asking the judge after the per-prompt limit', () => {
    let { c, run } = opened();
    for (let i = 0; i < GAME.aiChecksPerPrompt; i++) {
      const res = submitAnswer(run, `unknown thing ${i}`, c.tick(100), ai);
      assert.ok(res.judge, `check ${i + 1}`);
      run = applyVerdict(res.run, invalid, c.tick(100), ai).run;
    }
    const last = submitAnswer(run, 'yet another thing', c.tick(100), ai);
    assert.equal(last.judge, undefined);
    assert.equal(last.attempt?.reason, 'not-found');
  });

  it('reuses cached verdicts and stored familiarities; honours blocks', () => {
    const { c, run } = opened();
    const cachedDeps: EngineDeps = { ...ai, aiAvailable: false, cachedVerdict: (_p, key) => (key === 'fx-dish|tteokbokki' ? valid('Tteokbokki', '떡볶이', 4) : undefined) };
    const cached = submitAnswer(run, 'Tteokbokki!', c.tick(1000), cachedDeps);
    assert.equal(cached.cached, true);
    assert.equal(cached.record?.entityKey, 'ai:h:떡볶이');
    assert.equal(cached.run.aiChecks ?? 0, 0);

    const stored: EngineDeps = { ...ai, aiAnswer: () => ({ familiarity: 2 }) };
    const r1 = submitAnswer(run, 'tteokbokki', c.tick(1000), stored);
    const d1 = applyVerdict(r1.run, valid('Tteokbokki', '떡볶이', 5), c.tick(500), stored);
    assert.equal(d1.record?.ai?.familiarity, 2);
    assert.equal(d1.record?.points, 78); // 6 / (8041 + 6)

    const blocked: EngineDeps = { ...ai, aiAnswer: () => ({ familiarity: 3, blocked: true }) };
    const r2 = submitAnswer(run, 'tteokbokki', c.tick(1000), blocked);
    assert.deepEqual(applyVerdict(r2.run, valid('Tteokbokki', '떡볶이', 5), c.tick(500), blocked).attempt?.aiNote, NOTES.blocked);
  });

  it('counts an AI-accepted answer as used for the rest of the dive', () => {
    let { c, run } = opened(['fx-dish', 'fx-dish-2']);
    let res = submitAnswer(run, 'tteokbokki', c.tick(1000), ai);
    run = applyVerdict(res.run, valid('Tteokbokki', '떡볶이', 4), c.tick(500), ai).run;
    run = openPrompt(advance(run, c.tick(100)), c.tick(100), model);
    assert.equal(run.aiChecks, 0);
    res = submitAnswer(run, 'ddeokbokki', c.tick(1000), ai);
    assert.equal(applyVerdict(res.run, valid('Tteokbokki', '떡볶이', 4), c.tick(500), ai).attempt?.reason, 'duplicate');
  });
});
