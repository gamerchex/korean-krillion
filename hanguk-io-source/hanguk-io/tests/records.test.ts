import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ACHIEVEMENTS } from '../src/core/achievements';
import { advance, createRun, expirePrompt, openPrompt, submitAnswer } from '../src/core/engine';
import { allTimeBoard, dailyBoard, pruneRuns, rankEntries, statsFromBoards, weeklyBoard, type BoardDoc } from '../src/core/leaderboard';
import { applyRun, coerceProfile, mergeProfiles, newProfile, personalBest, streakInfo } from '../src/core/profile';
import { consistencyOf, shareText, summarize, titleFor } from '../src/core/results';
import type { RunState } from '../src/core/types';
import { clock, fixture } from './helpers';

const { model } = fixture();

function playRun(inputs: string[], mode: 'daily' | 'practice' | 'archive' = 'daily', dateKey = '2026-10-11'): RunState {
  const ids = ['fx-dish', 'fx-dish-2', 'fx-not-kimchi', 'fx-spicy', 'fx-word', 'fx-drink', 'fx-capped'];
  const c = clock();
  let run = createRun({ mode, challengeId: mode === 'practice' ? 'practice-1' : `daily-${dateKey}`, dateKey, promptIds: ids, timerSec: 20, now: c.now(), contentVersion: 'v' });
  for (let i = 0; i < ids.length; i++) {
    run = openPrompt(run, c.tick(100), model);
    run = submitAnswer(run, inputs[i] ?? '', c.tick(2500), { model }).run;
    // A wrong (or empty) try leaves the prompt open; then the clock runs out.
    if (run.phase === 'answering') run = expirePrompt(run, c.tick(30_000), {}).run;
    run = advance(run, c.tick(100));
  }
  return run;
}

describe('results', () => {
  const run = playRun(['hongeo-hoe', 'japchae', 'bulgogi', 'nope', '하나', 'soju', 'gimpo bread']);
  const s = summarize(run, model);

  it('totals points, depth, zone and title', () => {
    assert.equal(s.total, run.answers.reduce((a, b) => a + b.points, 0));
    assert.equal(s.depth, s.total * 10);
    assert.equal(s.accepted, 6);
    assert.equal(titleFor(0).id, 'surface-dweller');
    assert.equal(titleFor(700).id, 'dragon-king-guest');
    assert.equal(s.titleId, titleFor(s.total).id);
  });
  it('finds the strongest answer and category totals', () => {
    assert.equal(s.strongest, 0);
    assert.equal(s.categoryTotals.food, s.total);
  });
  it('describes consistency', () => {
    assert.equal(consistencyOf([30, 32, 28, 35, 31, 29, 33], 7), 'steady');
    assert.equal(consistencyOf([5, 6, 5, 100, 7, 5, 6], 7), 'spiky');
    assert.equal(consistencyOf([0, 0, 0, 0, 50, 0, 40], 2), 'patchy');
  });
  it('shares tiers and points but never the answers', () => {
    const text = shareText(s, { number: 8, zoneName: 'Midnight zone', titleName: 'Abyss Explorer' });
    assert.match(text, /HAN-GUK\.IO Dive #8/);
    assert.match(text, new RegExp(`${s.total}/700`));
    for (const a of run.answers) if (a.input) assert.ok(!text.toLowerCase().includes(a.input.toLowerCase()), a.input);
    assert.ok(!text.includes('Japchae'));
  });
});

describe('player records', () => {
  it('fills in defaults for missing or damaged data', () => {
    const p = coerceProfile({ settings: { lang: 'ko' }, dailies: null }, 1);
    assert.equal(p.settings.lang, 'ko');
    assert.equal(p.settings.sfx, 0.7);
    assert.deepEqual(p.dailies, {});
    assert.deepEqual(coerceProfile('garbage', 5).dailies, {});
  });

  it('survives a JSON round trip', () => {
    const run = playRun(['kimchi', 'bulgogi', 'japchae', 'hongeo-hoe', 'dul', 'soju', 'gimje bread']);
    const { profile } = applyRun(newProfile(1), summarize(run, model), run, 10, '2026-10-11');
    const again = coerceProfile(JSON.parse(JSON.stringify(profile)), 99);
    assert.deepEqual(again, JSON.parse(JSON.stringify(profile)));
  });

  it('records an official daily once, and keeps the best archive run', () => {
    const r1 = playRun(['kimchi', 'bulgogi', 'japchae', 'hongeo-hoe', 'dul', 'soju', 'gimje bread']);
    const r2 = playRun(['hongeo-hoe', 'japchae', 'bulgogi', 'kimchi', '넷', 'makgeolli', 'gimpo bread']);
    let p = applyRun(newProfile(1), summarize(r1, model), r1, 10, '2026-10-11').profile;
    p = applyRun(p, summarize(r2, model), r2, 20, '2026-10-11').profile;
    assert.equal(p.dailies['daily-2026-10-11'].total, r1.total);
    const a1 = playRun(['kimchi'], 'archive', '2026-10-05');
    const a2 = playRun(['hongeo-hoe', 'japchae'], 'archive', '2026-10-05');
    p = applyRun(p, summarize(a2, model), a2, 30, '2026-10-11').profile;
    p = applyRun(p, summarize(a1, model), a1, 40, '2026-10-11').profile;
    assert.equal(p.archive['daily-2026-10-05'].total, a2.total);
  });

  it('counts daily streaks with gaps', () => {
    let p = newProfile(1);
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-10']) {
      const r = playRun(['kimchi'], 'daily', d);
      p = applyRun(p, summarize(r, model), r, 1, d).profile;
    }
    assert.deepEqual(streakInfo(p, '2026-10-11'), { current: 2, best: 3, playedToday: false });
    assert.deepEqual(streakInfo(p, '2026-10-10'), { current: 2, best: 3, playedToday: true });
    assert.equal(streakInfo(p, '2026-10-13').current, 0);
    assert.ok(personalBest(p));
  });

  it('unlocks achievements once', () => {
    const run = playRun(['kimchi', 'bulgogi', 'japchae', 'hongeo-hoe', 'dul', 'soju', 'gimje bread']);
    const first = applyRun(newProfile(1), summarize(run, model), run, 10, '2026-10-11');
    assert.ok(first.unlocked.includes('first-dive'));
    assert.ok(first.unlocked.includes('full-house'));
    const second = applyRun(first.profile, summarize(run, model), run, 20, '2026-10-11');
    assert.ok(!second.unlocked.includes('first-dive'));
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  });

  it('merges two copies without losing results', () => {
    const r1 = playRun(['kimchi'], 'daily', '2026-10-09');
    const r2 = playRun(['bulgogi'], 'daily', '2026-10-10');
    const a = applyRun(newProfile(1), summarize(r1, model), r1, 100, '2026-10-09').profile;
    const b = applyRun(newProfile(2), summarize(r2, model), r2, 200, '2026-10-10').profile;
    const m = mergeProfiles(a, b);
    assert.ok(m.dailies['daily-2026-10-09'] && m.dailies['daily-2026-10-10']);
    assert.equal(m.createdAt, 1);
  });
});

describe('leaderboards', () => {
  it('shares ranks on ties and lists earlier finishers first', () => {
    const r = rankEntries([
      { id: 'a', name: 'A', score: 400, at: 30 },
      { id: 'b', name: 'B', score: 500, at: 50 },
      { id: 'c', name: 'C', score: 400, at: 10 },
      { id: 'd', name: 'D', score: 300, at: 5 },
    ], 'c');
    assert.deepEqual(r.map((x) => [x.id, x.rank]), [['b', 1], ['c', 2], ['a', 2], ['d', 4]]);
    assert.ok(r.find((x) => x.id === 'c')!.isMe);
  });

  const docs = new Map<string, BoardDoc>([
    ['u1', { name: 'Haenyeo', updatedAt: 5, runs: { 'daily-2026-10-05': { s: 300, d: 3000, a: ['fx:kimchi', null], t: 1, v: 'rarity-v1' }, 'daily-2026-10-11': { s: 200, d: 2000, a: ['fx:japchae'], t: 2, v: 'rarity-v1' } }, allTime: { dives: 2, total: 500, best: 300 } }],
    ['u2', { name: 'Gorae', updatedAt: 6, runs: { 'daily-2026-10-11': { s: 450, d: 4500, a: ['fx:kimchi'], t: 3, v: 'rarity-v1' } }, allTime: { dives: 1, total: 450, best: 450 } }],
    ['u3', { name: 'Mulgogi', updatedAt: 7, runs: { 'daily-2026-10-04': { s: 999, d: 9990, a: [], t: 1, v: 'rarity-v1' } }, allTime: { dives: 1, total: 120, best: 120 } }],
  ]);

  it('builds daily, weekly and all-time boards', () => {
    assert.deepEqual(dailyBoard(docs, 'daily-2026-10-11').map((x) => x.name), ['Gorae', 'Haenyeo']);
    const week = weeklyBoard(docs, '2026-10-11'); // Mon 10-05 .. Sun 10-11
    assert.deepEqual(week.map((x) => [x.name, x.score]), [['Haenyeo', 500], ['Gorae', 450]]);
    assert.deepEqual(allTimeBoard(docs).map((x) => x.name), ['Haenyeo', 'Gorae', 'Mulgogi']);
  });

  it('counts observed answers without the player being scored', () => {
    const all = statsFromBoards(docs, 'daily-2026-10-11', 0);
    assert.deepEqual(all, { valid: 2, eligible: 2, counts: { 'fx:japchae': 1, 'fx:kimchi': 1 } });
    const notMe = statsFromBoards(docs, 'daily-2026-10-11', 0, 'u2');
    assert.deepEqual(notMe.counts, { 'fx:japchae': 1 });
  });

  it('prunes old runs', () => {
    const runs = docs.get('u1')!.runs;
    assert.deepEqual(Object.keys(pruneRuns(runs, '2026-10-11', 3)), ['daily-2026-10-11']);
  });
});
