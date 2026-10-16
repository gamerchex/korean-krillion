// Answer normalization: one place that decides when two typed strings are "the same".

import { hasHangul, isHangulJamo, isHangulSyllable, looseHangul, looseLatin } from './hangul';

const ZERO_WIDTH = /[​-‏⁠﻿]/g;
const APOSTROPHES = /['’‘`´ʼʻ]/g;

/** Unicode-clean the raw input: NFC, full-width ASCII folded, whitespace collapsed. */
export function cleanInput(raw: string): string {
  let s = (raw ?? '').normalize('NFC').replace(ZERO_WIDTH, '');
  // Full-width ASCII (common with Korean IMEs) -> ASCII. NFKC is avoided on purpose:
  // it would rewrite Hangul compatibility jamo such as ㄱ, which some prompts accept.
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/　/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Strip wrapping quotes and trailing sentence punctuation.
  s = s.replace(/^["“”'‘’「『(]+|["“”'‘’」』)]+$/g, '').replace(/[.!?。！？]+$/g, '').trim();
  return s;
}

export type Script = 'hangul' | 'latin';

function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff);
}

function hasCJK(s: string): boolean {
  for (const ch of s) if (isCJK(ch)) return true;
  return false;
}

/** Hangul and Hanja are indexed together ("non-Latin"); everything else is Latin. */
export function scriptOf(s: string): Script {
  return hasHangul(s) || hasCJK(s) ? 'hangul' : 'latin';
}

/** Exact key for Latin text: lowercase, diacritics and punctuation removed (Ŏ -> o). */
export function latinKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Exact key for text containing Hangul: Hangul, jamo, Latin letters and digits only. */
export function hangulKey(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC').toLowerCase()) {
    if (isHangulSyllable(ch) || isHangulJamo(ch) || isCJK(ch) || /[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

export interface Keys {
  script: Script;
  exact: string;
  loose: string;
}

/** Keys used for indexing and lookup. Hangul keys are prefixed so they never collide with Latin ones. */
export function keysFor(text: string): Keys {
  const clean = cleanInput(text);
  if (scriptOf(clean) === 'hangul') {
    const exact = hangulKey(clean);
    return { script: 'hangul', exact: 'h:' + exact, loose: 'h:' + looseHangul(exact) };
  }
  const exact = latinKey(clean);
  return { script: 'latin', exact, loose: looseLatin(exact) };
}

/** Allowed typo distance for a loose key of this length (0 = exact only). */
export function fuzzyBudget(looseKey: string): number {
  const n = looseKey.startsWith('h:') ? [...looseKey].length - 2 : looseKey.length;
  if (looseKey.startsWith('h:')) return n >= 6 ? 1 : 0; // jamo count: ~2+ syllables
  if (n <= 3) return 0;
  if (n <= 10) return 1;
  return 2;
}

/** Fallback variants tried when nothing matches: plural/article/suffix trims for English input. */
export function fallbackLatinKeys(exact: string): string[] {
  const out: string[] = [];
  if (exact.startsWith('the') && exact.length > 5) out.push(exact.slice(3));
  if (exact.endsWith('es') && exact.length > 5) out.push(exact.slice(0, -2));
  if (exact.endsWith('s') && exact.length > 4) out.push(exact.slice(0, -1));
  return out;
}
