import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { matchAnswer } from '../src/core/matcher';
import { fixture, real } from './helpers';

describe('answer validation: fixture', () => {
  const { model } = fixture();

  it('accepts the name, the Hangul, a romanization and an English alias', () => {
    for (const input of ['Japchae', '잡채', 'chapchae', 'japche']) {
      const m = matchAnswer(model, 'fx-dish', input);
      assert.ok(m.ok, input);
      assert.equal(m.entityKey, 'fx:japchae', input);
    }
    assert.equal(matchAnswer(model, 'fx-dish', 'fire meat').entityKey, 'fx:bulgogi');
  });

  it('accepts a typo only when it points at a single answer', () => {
    const m = matchAnswer(model, 'fx-dish', 'Bulgoggi');
    assert.ok(m.ok);
    assert.equal(m.entityKey, 'fx:bulgogi');
    const amb = matchAnswer(model, 'fx-dish', 'Gimpe bread');
    assert.equal(amb.ok, false);
    assert.equal(amb.reason, 'ambiguous');
    assert.deepEqual(new Set(amb.candidates), new Set(['fx:gimpo-bread', 'fx:gimje-bread']));
  });

  it('explains rejections', () => {
    assert.equal(matchAnswer(model, 'fx-dish', '').reason, 'empty');
    assert.equal(matchAnswer(model, 'fx-dish', '   ').reason, 'empty');
    assert.equal(matchAnswer(model, 'fx-dish', '!!!').reason, 'empty');
    assert.equal(matchAnswer(model, 'fx-not-kimchi', 'kimchi').reason, 'excluded');
    assert.equal(matchAnswer(model, 'fx-spicy', 'bulgogi').reason, 'wrong-fit');
    assert.equal(matchAnswer(model, 'fx-dish', 'zzzzzzzz').reason, 'not-found');
  });

  it('enforces per-prompt answer languages', () => {
    assert.ok(matchAnswer(model, 'fx-word', '하나').ok);
    assert.ok(matchAnswer(model, 'fx-word', 'hana').ok);
    const en = matchAnswer(model, 'fx-word', 'one');
    assert.equal(en.ok, false);
    assert.equal(en.reason, 'wrong-language');
    assert.equal(en.nearKey, 'fx:hana');
  });

  it('accepts owner-approved community answers that are not in the bank', () => {
    const m = matchAnswer(model, 'fx-dish', 'Mul-hoe', { community: ['mulhoe'] });
    assert.ok(m.ok);
    assert.equal(m.method, 'community');
    assert.equal(matchAnswer(model, 'fx-dish', 'Mul-hoe').reason, 'not-found');
  });
});

describe('answer validation: real content bank', () => {
  const { model } = real();
  const ok = (pid: string, input: string, key: string) => {
    const m = matchAnswer(model, pid, input);
    assert.ok(m.ok, `${pid}: "${input}" should be accepted (got ${m.reason})`);
    assert.equal(m.entityKey, key, `${pid}: "${input}"`);
  };
  const no = (pid: string, input: string, reason: string) => {
    const m = matchAnswer(model, pid, input);
    assert.equal(m.ok, false, `${pid}: "${input}" should be rejected`);
    assert.equal(m.reason, reason, `${pid}: "${input}"`);
  };

  it('handles Hangul, romanization variants, English and IME input', () => {
    ok('food-kimchi', '깍두기', 'food:kkakdugi');
    ok('food-kimchi', 'kaktugi', 'food:kkakdugi');
    ok('food-kimchi', 'cubed radish kimchi', 'food:kkakdugi');
    ok('food-street', '떡뽁이', 'food:tteokbokki');
    ok('food-street', 'ddeokbokki', 'food:tteokbokki');
    ok('ent-kpop-group', 'ＢＴＳ', 'kpop:bts');
    ok('ent-kpop-group', '방탄소년단', 'kpop:bts');
    ok('food-kimchi', '김치'.normalize('NFD'), 'food:kimchi');
  });

  it('accepts spelled-out place names', () => {
    ok('geo-mountain', 'Mount Halla', 'terrain:hallasan');
    ok('geo-mountain', '한라산', 'terrain:hallasan');
    ok('geo-seoul-gu', 'Gangnam', 'admin:gangnam-gu');
    ok('geo-seoul-gu', '강남구', 'admin:gangnam-gu');
    ok('geo-island', 'Jeju Island', 'terrain:jejudo');
  });

  it('never typo-corrects a real, different answer into an accepted one', () => {
    no('geo-seoul-gu', 'Gangneung', 'wrong-fit');
    no('food-kimchi', 'bibimbap', 'wrong-fit');
    no('food-kimchi', 'Seoul', 'outside-category');
    no('ent-boy-group-not-bts', 'BTS', 'excluded');
  });

  it('keeps language prompts in Korean', () => {
    ok('lang-num-native', 'hana', 'lang:hana');
    no('lang-num-native', 'one', 'wrong-language');
    ok('lang-consonant', 'ㄱ', 'lang:giyeok');
  });
});
