import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CATEGORIES, compileContent, encodeContent, parsePool, slugify, type Issue } from '../src/core/compile';
import { GAME } from '../src/core/config';
import { decodeContent } from '../src/core/content';
import { hasHangul } from '../src/core/hangul';
import { keysFor } from '../src/core/normalize';
import { promptScoreProfile } from '../src/core/rarity';
import { approvedCsv } from '../src/core/review';
import { real } from './helpers';

describe('content bank', () => {
  const { out, model } = real();
  const { content, issues } = out;

  it('compiles without errors', () => {
    const errors = issues.filter((i) => i.level === 'error');
    assert.deepEqual(errors, []);
  });

  it('meets the size floor (regression guard, not the long-term target)', () => {
    assert.ok(content.entities.length >= 5000, `${content.entities.length} entities`);
    const strings = content.entities.reduce((s, e) => s + 1 + (e.hangul ? 1 : 0) + e.aliases.length, 0);
    assert.ok(strings >= 20000, `${strings} accepted strings`);
    assert.ok(content.prompts.length >= 250, `${content.prompts.length} prompts`);
  });

  it('covers all twelve categories with enough daily prompts', () => {
    assert.equal(CATEGORIES.length, 12);
    for (const c of CATEGORIES) {
      const n = content.prompts.filter((p) => p.category === c.id && p.daily && p.status === 'approved').length;
      assert.ok(n >= 12, `${c.id} has ${n} daily prompts`);
    }
  });

  it('has a well-formed record for every entity', () => {
    const keys = new Set<string>();
    for (const e of content.entities) {
      assert.ok(!keys.has(e.key), `duplicate key ${e.key}`);
      keys.add(e.key);
      assert.equal(e.key, `${e.pool}:${e.id}`);
      assert.ok(e.fam >= 1 && e.fam <= 6 && Number.isInteger(e.fam), e.key);
      assert.ok(e.name.trim().length > 0, e.key);
      assert.ok(content.pools[e.pool], `${e.key}: unknown pool`);
      if (e.hangul) assert.ok(hasHangul(e.hangul) || /^[\x20-\x7e]+$/.test(e.hangul), `${e.key}: hangul field "${e.hangul}"`);
      assert.ok(!/\?$/.test(e.name) || e.hangul, `${e.key}: placeholder name`);
    }
  });

  it('has bilingual, answerable prompts with sources', () => {
    const ids = new Set<string>();
    for (const p of content.prompts) {
      assert.ok(!ids.has(p.id), `duplicate prompt ${p.id}`);
      ids.add(p.id);
      assert.ok(p.text.en && p.text.ko, p.id);
      assert.ok(hasHangul(p.text.ko), `${p.id}: Korean text should be in Hangul`);
      assert.ok(p.accept.length > 0, p.id);
      assert.ok([1, 2, 3].includes(p.difficulty), p.id);
      const rt = model.runtime(p.id);
      assert.ok(rt.accepted.size >= 4, `${p.id}: ${rt.accepted.size} answers`);
      if (p.daily && p.status === 'approved') assert.ok(rt.accepted.size >= GAME.minAnswersForDaily, `${p.id}: ${rt.accepted.size} answers`);
      assert.ok(p.source || p.pools.every((id) => content.pools[id].source), `${p.id}: no source`);
      for (const k of p.include ?? []) assert.ok(model.entity(k), `${p.id}: include ${k}`);
      // A prompt needs an obvious answer: its most familiar answer must be cheap.
      assert.ok(promptScoreProfile(model, p.id).min <= 30, `${p.id}: no clearly common answer`);
    }
  });

  it('documents a source, how it was drafted and its review state for every pool', () => {
    for (const p of Object.values(content.pools)) {
      assert.ok(p.source.length > 20, `${p.id}: source`);
      assert.match(p.drafted ?? '', /^\d{4}-\d{2}-\d{2}/, `${p.id}: drafted`);
      assert.match(p.reviewed, /^(\d{4}-\d{2}-\d{2}|pending)$/, `${p.id}: reviewed`);
    }
  });

  it('round-trips through the compact encoding used by the game', () => {
    const decoded = decodeContent(JSON.parse(JSON.stringify(encodeContent(content))));
    const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
    assert.equal(decoded.entities.length, content.entities.length);
    assert.deepEqual(plain(decoded.entities), plain(content.entities));
    assert.deepEqual(plain(decoded.prompts), plain(content.prompts));
  });

  it('keeps aliases free of duplicates within an entry', () => {
    for (const e of content.entities) {
      const seen = new Set<string>();
      for (const a of e.aliases) {
        const k = keysFor(a.text).exact + '|' + a.lang;
        assert.ok(!seen.has(k), `${e.key}: duplicate alias ${a.text}`);
        seen.add(k);
      }
    }
  });
});

describe('content compiler checks', () => {
  const header = '# pool: t\n# title: T | 티\n# category: food\n# source: test source for the compiler\n';

  it('rejects bad rows', () => {
    const issues: Issue[] = [];
    parsePool(header + 'Kimchi | 김치 | 9 | | |\nBulgogi? | | 2 | | |\nJapchae | 잡채 | 3 | | chapchae? |\n | 떡 | 2 | | |\nKimchi | 김치 | 3 | | |\nKimchi! | 김치 | 3 | | |', 't.psv', issues);
    const msgs = issues.map((i) => i.message).join('\n');
    assert.match(msgs, /Familiarity must be 1-6/);
    assert.match(msgs, /Placeholder or uncertain text in "Bulgogi\?"/);
    assert.match(msgs, /Placeholder or uncertain text in "Japchae"/);
    assert.match(msgs, /Missing name/);
  });

  it('flags duplicate ids, unknown pools and entities, and missing translations', () => {
    const { issues } = compileContent({
      pools: [{ file: 't.psv', text: header + 'Kimchi | 김치 | 6 | | |\nKimchi | 김치 | 5 | | |\nBap | 밥 | 3 | | |' }],
      prompts: [{ file: 'food.json', category: 'food', items: [
        { id: 'x', en: 'Name it', ko: '', pools: 't' },
        { id: 'x', en: 'Name it again', ko: '다시', pools: 't' },
        { id: 'y', en: 'Other', ko: '다른', pools: 'nope', inc: ['t:missing'] },
        { id: 'z', en: 'Name it', ko: '같은 글', pools: 't' },
        { id: 'w', en: 'Lang', ko: '언어', pools: 't', acc: ['fr' as 'ko'] },
      ] }],
      epoch: GAME.epoch,
      minAnswersForDaily: 12,
    });
    const msgs = issues.map((i) => i.message).join('\n');
    assert.match(msgs, /Duplicate id "kimchi"/);
    assert.match(msgs, /needs both English and Korean/);
    assert.match(msgs, /Duplicate prompt id/);
    assert.match(msgs, /Unknown pool "nope"/);
    assert.match(msgs, /Unknown entity "t:missing"/);
    assert.match(msgs, /Duplicate prompt text/);
    assert.match(msgs, /acc must list/);
  });

  it('protects the published schedule: deleted prompts are errors, late retirements warnings', () => {
    const { issues, content } = compileContent({
      pools: [{ file: 't.psv', text: header + 'Kimchi | 김치 | 6 | | |\nBap | 밥 | 3 | | |' }],
      prompts: [{ file: 'food.json', category: 'food', items: [
        { id: 'a', en: 'Name a dish', ko: '음식', pools: 't' },
        { id: 'b', en: 'Name a side', ko: '반찬', pools: 't', to: '2026-10-09' },
      ] }],
      epoch: GAME.epoch,
      minAnswersForDaily: 12,
      schedule: { '2026-10-05': ['a', 'gone'], '2026-10-10': ['b'], '2026-09-01': ['a'], '2026-10-06': [] },
    });
    const msgs = issues.map((i) => `${i.level}: ${i.where} ${i.message}`).join('\n');
    assert.match(msgs, /error: schedule\.lock\.json#2026-10-05 Published prompt "gone" no longer exists/);
    assert.match(msgs, /warning: schedule\.lock\.json#2026-10-10 "b" is retired/);
    assert.match(msgs, /error: schedule\.lock\.json#2026-09-01 Bad date/);
    assert.match(msgs, /error: schedule\.lock\.json#2026-10-06 A published day needs/);
    const round = decodeContent(JSON.parse(JSON.stringify(encodeContent(content))));
    assert.deepEqual(round.schedule, content.schedule);
  });

  it('exports approved review-queue answers in the import-csv layout', () => {
    const { csv, rows } = approvedCsv(real().model, { 'folk-zodiac': ['고양이'], 'no-such-prompt': ['x'], 'food-street': ['Hotteok, "sweet"'] });
    assert.equal(rows, 2);
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'prompt,pool,name,hangul,fam,tags,aliases,note');
    assert.match(lines[1], /^folk-zodiac,folk,Goyangi,고양이,1,zodiac,,/);
    assert.match(lines[2], /^food-street,food,"Hotteok, ""sweet""",,1,/);
  });

  it('marks complete answer lists as closed', () => {
    const { out, model } = real();
    const closed = out.content.prompts.filter((p) => p.closed).map((p) => p.id).sort();
    assert.deepEqual(closed, ['folk-zodiac', 'geo-busan-gu', 'geo-line2', 'geo-national-park', 'geo-seoul-gu', 'geo-top-level', 'hist-baekje-king', 'hist-goguryeo-king', 'hist-joseon-king', 'nature-solar-term']);
    assert.equal(model.runtime('folk-zodiac').accepted.size, 12);
    assert.equal(model.runtime('geo-seoul-gu').accepted.size, 25);
  });

  it('slugs names predictably', () => {
    assert.equal(slugify("Shin Ramyun"), 'shin-ramyun');
    assert.equal(slugify("Mom's Touch"), 'moms-touch');
    assert.equal(slugify('Lock & Lock'), 'lock-and-lock');
    assert.equal(slugify('Pŏlgyo'), 'polgyo');
  });
});
