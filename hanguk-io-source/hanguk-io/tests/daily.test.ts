import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GAME } from '../src/core/config';
import { ContentModel } from '../src/core/content';
import {
  Scheduler,
  addDays,
  challengeNumber,
  dateKeyStartMs,
  daysBetween,
  isValidDateKey,
  kstDateKey,
  msUntilNextDaily,
  practiceSet,
  weekStart,
} from '../src/core/daily';
import { real } from './helpers';

describe('KST dates', () => {
  it('rolls over at midnight in Seoul, not UTC', () => {
    assert.equal(kstDateKey(Date.UTC(2026, 9, 11, 14, 59, 59)), '2026-10-11'); // 23:59:59 KST
    assert.equal(kstDateKey(Date.UTC(2026, 9, 11, 15, 0, 0)), '2026-10-12'); // 00:00 KST
    assert.equal(kstDateKey(Date.UTC(2026, 9, 10, 15, 0, 0)), '2026-10-11');
  });
  it('handles month and year boundaries', () => {
    assert.equal(kstDateKey(Date.UTC(2026, 11, 31, 15, 0, 0)), '2027-01-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(daysBetween('2026-10-04', '2026-10-11'), 7);
  });
  it('knows when the next dive opens', () => {
    const now = Date.UTC(2026, 9, 11, 14, 0, 0); // 23:00 KST
    assert.equal(msUntilNextDaily(now), 3_600_000);
    assert.equal(dateKeyStartMs('2026-10-12'), Date.UTC(2026, 9, 11, 15, 0, 0));
  });
  it('validates date keys', () => {
    assert.ok(isValidDateKey('2026-10-11'));
    assert.ok(!isValidDateKey('2026-02-30'));
    assert.ok(!isValidDateKey('2026-10-11T00'));
    assert.ok(!isValidDateKey('../../etc'));
  });
  it('weeks start on Monday', () => {
    assert.equal(weekStart('2026-10-11'), '2026-10-05'); // Sunday -> previous Monday
    assert.equal(weekStart('2026-10-12'), '2026-10-12');
  });
  it('numbers dives from the epoch', () => {
    assert.equal(challengeNumber(GAME.epoch), 1);
    assert.equal(challengeNumber(addDays(GAME.epoch, 7)), 8);
  });
});

describe('official daily selection', () => {
  const { model } = real();

  it('is the same on every device, whatever order dates are asked in', () => {
    const a = new Scheduler(model);
    const b = new Scheduler(model);
    const later = a.promptIdsFor('2026-12-25');
    const earlier = a.promptIdsFor('2026-10-20');
    assert.deepEqual(b.promptIdsFor('2026-10-20'), earlier);
    assert.deepEqual(b.promptIdsFor('2026-12-25'), later);
  });

  it('picks seven different prompts from seven categories, easiest first', () => {
    const s = new Scheduler(model);
    for (let i = 0; i < 30; i++) {
      const ids = s.promptIdsFor(addDays(GAME.epoch, i));
      assert.equal(ids.length, 7);
      assert.equal(new Set(ids).size, 7);
      const ps = ids.map((id) => model.prompt(id)!);
      assert.equal(new Set(ps.map((p) => p.category)).size, 7, ids.join(','));
      for (let j = 1; j < ps.length; j++) assert.ok(ps[j].difficulty >= ps[j - 1].difficulty);
      for (const p of ps) assert.ok(p.status === 'approved' && p.daily);
    }
  });

  it('does not repeat a prompt within the cooldown window', () => {
    const s = new Scheduler(model);
    const last = new Map<string, string>();
    for (let i = 0; i < 90; i++) {
      const day = addDays(GAME.epoch, i);
      for (const id of s.promptIdsFor(day)) {
        const prev = last.get(id);
        if (prev) assert.ok(daysBetween(prev, day) > GAME.cooldownDays, `${id} repeated after ${daysBetween(prev, day)} days`);
        last.set(id, day);
      }
    }
  });

  it('has no challenge before the epoch or for invalid dates', () => {
    const s = new Scheduler(model);
    assert.equal(s.forDate(addDays(GAME.epoch, -1)), null);
    assert.equal(s.forDate('not-a-date'), null);
    const c = s.forDate(GAME.epoch, Date.UTC(2026, 9, 11));
    assert.equal(c?.number, 1);
    assert.equal(c?.status, 'archived');
    assert.equal(c?.id, `daily-${GAME.epoch}`);
  });

  it('keeps past dailies stable when new prompts are added for future dates', () => {
    const before = new Scheduler(model).promptIdsFor('2026-11-15');
    const extra = model.content.prompts.slice(0, 40).map((p) => ({ ...p, id: `${p.id}-v2`, availableFrom: '2027-01-01' }));
    const grown = new ContentModel({ ...model.content, prompts: [...model.content.prompts, ...extra] });
    assert.deepEqual(new Scheduler(grown).promptIdsFor('2026-11-15'), before);
  });

  it('replays published (locked) days exactly, whatever the content does later', () => {
    const base = new Scheduler(model);
    const lock: Record<string, string[]> = {};
    for (let d = GAME.epoch; d <= '2026-10-25'; d = addDays(d, 1)) lock[d] = base.promptIdsFor(d);
    // An editor adds 40 prompts and forgets "from": without the lock, history could shift.
    const extra = model.content.prompts.slice(0, 40).map((p) => ({ ...p, id: `${p.id}-v2`, availableFrom: GAME.epoch }));
    const edited = new ContentModel({ ...model.content, prompts: [...model.content.prompts, ...extra], schedule: lock });
    const s = new Scheduler(edited);
    for (const [d, ids] of Object.entries(lock)) {
      assert.deepEqual(s.promptIdsFor(d), ids, d);
      assert.ok(s.isLocked(d));
    }
    assert.ok(!s.isLocked('2026-10-26'));
    assert.equal(s.forDate('2026-10-26')!.promptIds.length, GAME.promptsPerDaily);
  });

  it('keeps the cooldown for prompts published by the lock', () => {
    const pick = model.content.prompts.filter((p) => p.daily && p.status === 'approved').slice(0, 7).map((p) => p.id);
    const s = new Scheduler(new ContentModel({ ...model.content, schedule: { '2026-10-20': pick } }));
    const base = new Scheduler(model);
    assert.deepEqual(s.promptIdsFor('2026-10-19'), base.promptIdsFor('2026-10-19'));
    assert.deepEqual(s.promptIdsFor('2026-10-20'), pick);
    for (let d = '2026-10-21'; d <= addDays('2026-10-20', GAME.cooldownDays); d = addDays(d, 1)) {
      for (const id of s.promptIdsFor(d)) assert.ok(!pick.includes(id), `${id} repeated on ${d}`);
    }
  });

  it('skips retired prompts after their end date', () => {
    const ids = new Scheduler(model).promptIdsFor('2026-10-20');
    const retired = new ContentModel({
      ...model.content,
      prompts: model.content.prompts.map((p) => (p.id === ids[0] ? { ...p, retiredOn: '2026-10-19' } : p)),
    });
    assert.ok(!new Scheduler(retired).promptIdsFor('2026-10-20').includes(ids[0]));
  });

  it('builds practice sets that respect filters and avoid recent prompts', () => {
    const set = practiceSet(model, { count: 7, seed: 'abc' });
    assert.equal(set.length, 7);
    assert.equal(new Set(set).size, 7);
    const onlyFood = practiceSet(model, { count: 5, categories: ['food'], seed: 'x' });
    assert.ok(onlyFood.every((id) => model.prompt(id)!.category === 'food'));
    const avoid = practiceSet(model, { count: 7, seed: 'abc', avoid: set });
    assert.ok(avoid.every((id) => !set.includes(id)));
    assert.deepEqual(practiceSet(model, { count: 7, seed: 'abc' }), set);
  });
});
