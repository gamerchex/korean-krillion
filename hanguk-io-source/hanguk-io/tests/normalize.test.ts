import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { editDistance, looseHangul, looseLatin, romanize, romanizations, toJamo, transliterate } from '../src/core/hangul';
import { cleanInput, fallbackLatinKeys, fuzzyBudget, keysFor, scriptOf } from '../src/core/normalize';

describe('cleanInput', () => {
  it('normalizes decomposed Hangul (NFD) to composed syllables (NFC)', () => {
    const nfd = '김치'.normalize('NFD');
    assert.notEqual(nfd, '김치');
    assert.equal(cleanInput(nfd), '김치');
  });
  it('folds full-width ASCII typed with a Korean IME', () => {
    assert.equal(cleanInput('ＢＴＳ'), 'BTS');
    assert.equal(cleanInput('ｋｉｍｃｈｉ！'), 'kimchi');
  });
  it('removes zero-width characters, wrapping quotes and trailing punctuation', () => {
    assert.equal(cleanInput('​kim‍chi'), 'kimchi');
    assert.equal(cleanInput('"Tteokbokki."'), 'Tteokbokki');
    assert.equal(cleanInput('「떡볶이」'), '떡볶이');
    assert.equal(cleanInput('  bibim   bap  '), 'bibim bap');
    assert.equal(cleanInput('　한라산　'), '한라산');
  });
  it('keeps compatibility jamo intact (no NFKC)', () => {
    assert.equal(cleanInput('ㄱ'), 'ㄱ');
  });
});

describe('keysFor', () => {
  it('ignores case, spacing, hyphens and apostrophes in Latin input', () => {
    const a = keysFor('Tteok-bokki').exact;
    assert.equal(keysFor('tteokbokki').exact, a);
    assert.equal(keysFor('TTEOK BOKKI').exact, a);
    assert.equal(keysFor("tteok'bokki").exact, a);
  });
  it('strips diacritics (McCune-Reischauer breves)', () => {
    assert.equal(keysFor('Pŏlgyo').exact, 'polgyo');
    assert.equal(keysFor('Kyŏngju').exact, keysFor('Kyongju').exact);
  });
  it('ignores spaces inside Hangul answers and keeps Hangul and Latin keys apart', () => {
    assert.equal(keysFor('김치 찌개').exact, keysFor('김치찌개').exact);
    assert.ok(keysFor('김치').exact.startsWith('h:'));
    assert.notEqual(keysFor('김치').exact, keysFor('gimchi').exact);
  });
  it('treats Hangul with Latin letters as Hangul script', () => {
    assert.equal(scriptOf('PC방'), 'hangul');
    assert.equal(scriptOf('KTX'), 'latin');
    assert.equal(keysFor('PC 방').exact, 'h:pc방');
  });
  it('indexes hanja with Hangul', () => {
    assert.equal(scriptOf('鶴首苦待'), 'hangul');
  });
});

describe('romanization', () => {
  const cases: Array<[string, string]> = [
    ['김치', 'gimchi'],
    ['한국', 'hanguk'],
    ['신라', 'silla'],
    ['종로', 'jongno'],
    ['독립', 'dongnip'],
    ['설날', 'seollal'],
    ['떡볶이', 'tteokbokki'],
    ['백마', 'baengma'],
    ['같이', 'gachi'],
    ['좋고', 'joko'],
    ['부산', 'busan'],
    ['한라산', 'hallasan'],
  ];
  for (const [h, r] of cases) it(`${h} -> ${r}`, () => assert.equal(romanize(h), r));

  it('keeps non-Hangul text as is', () => assert.equal(romanize('PC방'), 'PCbang'));
  it('offers plain and letter-by-letter variants for indexing', () => {
    assert.equal(transliterate('닭'), 'dalg');
    assert.ok(romanizations('신라').includes('silla'));
    assert.ok(romanizations('신라').includes('sinra'));
  });
  it('decomposes to compatibility jamo', () => assert.equal(toJamo('한국'), 'ㅎㅏㄴㄱㅜㄱ'));
});

describe('loose keys', () => {
  it('meet across common romanization disagreements', () => {
    const k = looseLatin('tteokbokki');
    for (const v of ['ddeokbokki', 'dukbokki', 'teokbokki', 'ttukbokki']) assert.equal(looseLatin(v), k, v);
    assert.equal(looseLatin('kimchi'), looseLatin('gimchi'));
    assert.equal(looseLatin('pusan'), looseLatin('busan'));
    assert.equal(looseLatin('seoul'), looseLatin('soul'));
  });
  it('do not merge clearly different words', () => {
    assert.notEqual(looseLatin('gimbap'), looseLatin('gimchi'));
    assert.notEqual(looseLatin('busan'), looseLatin('suwon'));
  });
  it('forgive tense consonants and ㅐ/ㅔ in Hangul', () => {
    assert.equal(looseHangul('떡뽁이'), looseHangul('떡볶이'));
    assert.equal(looseHangul('께임'), looseHangul('게임'));
  });
});

describe('typo budget', () => {
  it('scales with length and is zero for short words', () => {
    assert.equal(fuzzyBudget('bts'), 0);
    assert.equal(fuzzyBudget('kimchi'), 1);
    assert.equal(fuzzyBudget('seokgulamgloto'), 2);
    assert.equal(fuzzyBudget('h:ㄱㅣㅁ'), 0);
    assert.equal(fuzzyBudget('h:ㄱㅣㅁㅊㅣㅈ'), 1);
  });
  it('edit distance counts transpositions as one and stops early', () => {
    assert.equal(editDistance('kimchi', 'kimhci'), 1);
    assert.equal(editDistance('abc', 'abc'), 0);
    assert.equal(editDistance('aaaaaaa', 'bbbbbbb', 2), 3);
  });
  it('tries plural and article trims for English input', () => {
    assert.deepEqual(fallbackLatinKeys('thedumplings'), ['dumplings', 'thedumpling']);
    assert.deepEqual(fallbackLatinKeys('kimchi'), []);
  });
});
