// Hangul utilities: syllable decomposition, Revised Romanization (RR) with the main
// sound-change rules, a letter-by-letter transliteration, and the "loose" keys the
// matcher uses to accept common spelling variants without confusing different words.

const S_BASE = 0xac00;
const S_LAST = 0xd7a3;
const V_COUNT = 21;
const T_COUNT = 28;

const INITIAL_RR = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL_RR = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINAL_RR = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const FINAL_TRANSLIT = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

const INITIAL_JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const MEDIAL_JAMO = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINAL_JAMO = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// Initial indices
const L_G = 0, L_N = 2, L_D = 3, L_R = 5, L_M = 6, L_B = 7, L_S = 9, L_SS = 10, L_NONE = 11, L_J = 12, L_CH = 14, L_K = 15, L_T = 16, L_P = 17, L_H = 18;
// Final indices
const T_NONE = 0, T_N = 4, T_L = 8, T_M = 16, T_NG = 21;

const K_CLASS = new Set([1, 2, 3, 9, 24]);
const T_CLASS = new Set([7, 19, 20, 22, 23, 25, 27]);
const P_CLASS = new Set([14, 17, 18, 26]);

/** Final index -> [final kept, initial produced] when the next syllable starts with ㅇ. */
const LIAISON: Record<number, [number, number]> = {
  1: [T_NONE, 0], 2: [T_NONE, 1], 3: [1, L_S], 4: [T_NONE, L_N], 5: [T_N, L_J], 6: [T_N, L_NONE],
  7: [T_NONE, L_D], 8: [T_NONE, L_R], 9: [T_L, L_G], 10: [T_L, L_M], 11: [T_L, L_B], 12: [T_L, L_S],
  13: [T_L, L_T], 14: [T_L, L_P], 15: [T_L, L_NONE], 16: [T_NONE, L_M], 17: [T_NONE, L_B], 18: [17, L_S],
  19: [T_NONE, L_S], 20: [T_NONE, L_SS], 22: [T_NONE, L_J], 23: [T_NONE, L_CH], 24: [T_NONE, L_K],
  25: [T_NONE, L_T], 26: [T_NONE, L_P], 27: [T_NONE, L_NONE],
};

interface Syl {
  l: number;
  v: number;
  t: number;
  /** romanize the initial ㄹ as "l" (after a final ㄹ) */
  lAsL?: boolean;
}

export function isHangulSyllable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c >= S_BASE && c <= S_LAST;
}

export function isHangulJamo(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x3131 && c <= 0x318e) || (c >= 0x1100 && c <= 0x11ff);
}

export function hasHangul(s: string): boolean {
  for (const ch of s) if (isHangulSyllable(ch) || isHangulJamo(ch)) return true;
  return false;
}

function decompose(ch: string): Syl {
  const c = (ch.codePointAt(0) ?? 0) - S_BASE;
  return { l: Math.floor(c / (V_COUNT * T_COUNT)), v: Math.floor((c % (V_COUNT * T_COUNT)) / T_COUNT), t: c % T_COUNT };
}

/** Split text into runs of Hangul syllables and everything else. */
function segments(text: string): Array<{ hangul: boolean; text: string }> {
  const out: Array<{ hangul: boolean; text: string }> = [];
  for (const ch of text) {
    const h = isHangulSyllable(ch);
    const last = out[out.length - 1];
    if (last && last.hangul === h) last.text += ch;
    else out.push({ hangul: h, text: ch });
  }
  return out;
}

function applySoundChanges(syls: Syl[]): void {
  for (let i = 0; i < syls.length - 1; i++) {
    const a = syls[i];
    const b = syls[i + 1];
    const t = a.t;
    if (t === T_NONE) continue;

    if (b.l === L_NONE) {
      if (t === T_NG) continue; // ㅇ final never moves
      const rule = LIAISON[t];
      if (rule) {
        a.t = rule[0];
        b.l = rule[1];
        // palatalization: ㄷ/ㅌ + 이 -> 지/치
        if (b.v === 20) {
          if (b.l === L_D) b.l = L_J;
          else if (b.l === L_T) b.l = L_CH;
        }
        if (b.l === L_R && a.t === T_L) b.lAsL = true;
      }
      continue;
    }

    // ㅎ-final aspiration: 좋고 -> joko, 많다 -> manta
    if (t === 27 || t === 6 || t === 15) {
      const keep = t === 27 ? T_NONE : t === 6 ? T_N : T_L;
      if (b.l === L_G) { a.t = keep; b.l = L_K; continue; }
      if (b.l === L_D) { a.t = keep; b.l = L_T; continue; }
      if (b.l === L_J) { a.t = keep; b.l = L_CH; continue; }
      if (b.l === L_S) { a.t = keep; b.l = L_SS; continue; }
    }

    if (b.l === L_N || b.l === L_M) {
      if (K_CLASS.has(t)) a.t = T_NG;
      else if (T_CLASS.has(t)) a.t = T_N;
      else if (P_CLASS.has(t)) a.t = T_M;
      else if (t === T_L && b.l === L_N) {
        // ㄹ + ㄴ -> ㄹㄹ (설날 seollal)
        b.l = L_R;
        b.lAsL = true;
      }
      continue;
    }

    if (b.l === L_R) {
      if (t === T_N || t === T_L || t === 11 || t === 12 || t === 13 || t === 15) {
        a.t = T_L; // 신라 Silla, 설령
        b.lAsL = true;
      } else if (t === T_M || t === T_NG) {
        b.l = L_N; // 종로 Jongno, 침략 chimnyak
      } else if (K_CLASS.has(t)) {
        a.t = T_NG; b.l = L_N; // 독립 dongnip
      } else if (P_CLASS.has(t)) {
        a.t = T_M; b.l = L_N; // 협력 hyeomnyeok
      } else if (T_CLASS.has(t)) {
        a.t = T_N; b.l = L_N;
      }
    }
  }
}

function romanizeSyllables(syls: Syl[], finals: string[]): string {
  let out = '';
  for (const s of syls) {
    out += s.l === L_R && s.lAsL ? 'l' : INITIAL_RR[s.l];
    out += MEDIAL_RR[s.v];
    out += finals[s.t];
  }
  return out;
}

/** Revised Romanization with the standard assimilation rules (신라 -> silla, 종로 -> jongno). */
export function romanize(text: string): string {
  return segments(text)
    .map((seg) => {
      if (!seg.hangul) return seg.text;
      const syls = [...seg.text].map(decompose);
      applySoundChanges(syls);
      return romanizeSyllables(syls, FINAL_RR);
    })
    .join('');
}

/** RR syllable by syllable without sound changes (신라 -> sinra). */
export function romanizePlain(text: string): string {
  return segments(text)
    .map((seg) => (seg.hangul ? romanizeSyllables([...seg.text].map(decompose), FINAL_RR) : seg.text))
    .join('');
}

/** Letter-for-letter transliteration (떡볶이 -> tteogbokki, 닭 -> dalg). */
export function transliterate(text: string): string {
  return segments(text)
    .map((seg) => (seg.hangul ? romanizeSyllables([...seg.text].map(decompose), FINAL_TRANSLIT) : seg.text))
    .join('');
}

/** All distinct romanizations worth indexing for a Hangul string. */
export function romanizations(text: string): string[] {
  const set = new Set([romanize(text), romanizePlain(text), transliterate(text)]);
  return [...set];
}

/** Hangul -> compatibility jamo sequence (한국 -> ㅎㅏㄴㄱㅜㄱ). */
export function toJamo(text: string): string {
  let out = '';
  for (const ch of text) {
    if (isHangulSyllable(ch)) {
      const s = decompose(ch);
      out += INITIAL_JAMO[s.l] + MEDIAL_JAMO[s.v] + FINAL_JAMO[s.t];
    } else out += ch;
  }
  return out;
}

const LOOSE_JAMO: Record<string, string> = {
  'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ',
  'ㅐ': 'ㅔ', 'ㅒ': 'ㅖ', 'ㅙ': 'ㅞ', 'ㅚ': 'ㅞ',
};

/** Jamo key that forgives tense/plain consonant slips and ㅐ/ㅔ confusion (떡뽁이 ~ 떡볶이). */
export function looseHangul(text: string): string {
  let out = '';
  for (const ch of toJamo(text)) out += LOOSE_JAMO[ch] ?? ch;
  return out;
}

/**
 * Loose key for Latin text. Folds the spelling differences romanizations disagree on
 * (eo/u/o, ae/e, ee/i, b/p, g/k, d/t, j/ch, r/l, doubled letters) so "dukbokki",
 * "ddeokbokki" and "tteokbokki" meet. Only used when no exact match exists, and only
 * within a single prompt's answer list.
 */
export function looseLatin(exactKey: string): string {
  let s = exactKey.replace(/[^a-z0-9]/g, '');
  s = s
    .replace(/yeo/g, 'yo')
    .replace(/eo/g, 'o')
    .replace(/eu/g, 'u')
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/ae/g, 'e');
  s = s
    .replace(/sh/g, 's')
    .replace(/ch/g, 'j')
    .replace(/ph/g, 'p')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
    .replace(/f/g, 'p')
    .replace(/v/g, 'b')
    .replace(/z/g, 'j');
  s = s.replace(/[bp]+/g, 'p').replace(/[gkc]+/g, 'k').replace(/[dt]+/g, 't').replace(/r/g, 'l');
  s = s.replace(/u/g, 'o');
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

/** Optimal-string-alignment edit distance with an early-exit ceiling. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: bl + 1 }, (_, j) => j);
  for (let i = 1; i <= al; i++) {
    const cur: number[] = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[bl];
}
