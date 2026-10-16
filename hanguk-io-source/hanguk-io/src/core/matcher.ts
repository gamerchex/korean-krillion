// Answer validation. The curated answer bank is the source of truth: an answer counts
// only if it resolves to an entity in the prompt's accepted set. Matching goes from
// strict to forgiving (exact -> loose spelling key -> small typo distance) and never
// merges two different answers: forgiving steps only run when nothing matched exactly,
// and a typo that is equally close to two answers is rejected as ambiguous.

import type { ContentModel, IndexEntry, PromptRuntime } from './content';
import { editDistance } from './hangul';
import { cleanInput, fallbackLatinKeys, fuzzyBudget, keysFor, type Script } from './normalize';
import type { MatchMethod, RejectReason } from './types';

export interface MatchResult {
  ok: boolean;
  entityKey?: string;
  method?: MatchMethod;
  reason?: RejectReason;
  /** The entity that explains a rejection (the excluded one, the wrong-category one...). */
  nearKey?: string;
  candidates?: string[];
  script: Script;
  clean: string;
  /** Set when an approved community answer (not yet in the bank) matched. */
  community?: string;
}

export interface MatchOptions {
  /** Community-approved answer texts for this prompt (reviewed by the page owner). */
  community?: string[];
  /** Exact and spelling-variant matches only (used to place the AI judge's canonical name). */
  noFuzzy?: boolean;
}

function pickMostFamiliar(model: ContentModel, rt: PromptRuntime, keys: string[]): string {
  let best = keys[0];
  let bestFam = -1;
  for (const k of keys) {
    const e = model.entity(k);
    const fam = e ? model.famFor(rt.prompt, e) : 0;
    if (fam > bestFam) {
      best = k;
      bestFam = fam;
    }
  }
  return best;
}

function evaluate(
  model: ContentModel,
  rt: PromptRuntime,
  entries: IndexEntry[],
  method: MatchMethod,
  script: Script,
  clean: string,
): MatchResult | null {
  if (!entries.length) return null;
  const inA = entries.filter((e) => rt.accepted.has(e.key));
  if (inA.length) {
    const okLang = inA.filter((e) => rt.prompt.accept.includes(e.lang));
    if (okLang.length) {
      const distinct = [...new Set(okLang.map((e) => e.key))];
      // Several real answers share this exact spelling (e.g. two kings named Taejo):
      // score it as the more familiar one, which is the conservative choice.
      return { ok: true, entityKey: pickMostFamiliar(model, rt, distinct), method, script, clean };
    }
    return { ok: false, reason: 'wrong-language', nearKey: inA[0].key, script, clean };
  }
  const ex = entries.find((e) => rt.excluded.has(e.key));
  if (ex) return { ok: false, reason: 'excluded', nearKey: ex.key, script, clean };
  const inU = entries.find((e) => rt.universe.has(e.key));
  if (inU) return { ok: false, reason: 'wrong-fit', nearKey: inU.key, script, clean };
  return { ok: false, reason: 'outside-category', nearKey: entries[0].key, script, clean };
}

function fuzzy(model: ContentModel, rt: PromptRuntime, loose: string, script: Script, clean: string): MatchResult | null {
  const budget = fuzzyBudget(loose);
  if (budget === 0) return null;
  const isH = loose.startsWith('h:');
  let bestDist = budget + 1;
  let bestKeys = new Set<string>();
  let bestLangOk = false;
  for (const lk of rt.looseKeys) {
    if (lk.loose.startsWith('h:') !== isH) continue;
    if (!isH && lk.loose[0] !== loose[0]) continue; // first letters rarely mistyped
    const d = editDistance(loose, lk.loose, budget);
    if (d > budget) continue;
    const langOk = rt.prompt.accept.includes(lk.lang);
    if (d < bestDist) {
      bestDist = d;
      bestKeys = new Set([lk.key]);
      bestLangOk = langOk;
    } else if (d === bestDist) {
      bestKeys.add(lk.key);
      bestLangOk = bestLangOk || langOk;
    }
  }
  if (!bestKeys.size) return null;
  if (bestKeys.size > 1) {
    return { ok: false, reason: 'ambiguous', candidates: [...bestKeys], script, clean };
  }
  const key = [...bestKeys][0];
  if (!bestLangOk) return { ok: false, reason: 'wrong-language', nearKey: key, script, clean };
  void model;
  return { ok: true, entityKey: key, method: 'fuzzy', script, clean };
}

export function matchAnswer(model: ContentModel, promptId: string, input: string, opts: MatchOptions = {}): MatchResult {
  const clean = cleanInput(input);
  const base = keysFor(clean);
  if (!clean || base.exact === '' || base.exact === 'h:') {
    return { ok: false, reason: 'empty', script: base.script, clean };
  }
  const rt = model.runtime(promptId);
  const exactMethod: MatchMethod = base.script === 'hangul' ? 'hangul' : 'exact';

  const attempts: Array<{ exact: string; loose: string }> = [{ exact: base.exact, loose: base.loose }];
  if (base.script === 'latin') {
    for (const k of fallbackLatinKeys(base.exact)) attempts.push(keysFor(k));
  }

  let firstRejection: MatchResult | null = null;
  for (const att of attempts) {
    const exact = evaluate(model, rt, model.lookupExact(att.exact), exactMethod, base.script, clean);
    if (exact?.ok) return exact;
    if (exact && !firstRejection) firstRejection = exact;

    const loose = evaluate(model, rt, model.lookupLoose(att.loose), 'loose', base.script, clean);
    if (loose?.ok) return loose;
    if (loose && !firstRejection && !exact) firstRejection = loose;
  }

  // Community-approved answers for this prompt that are not in the bank yet.
  if (opts.community?.length) {
    for (const text of opts.community) {
      const ck = keysFor(text);
      if (ck.exact === base.exact || ck.loose === base.loose) {
        return { ok: true, method: 'community', community: cleanInput(text), script: base.script, clean };
      }
    }
  }

  // The input is a real entry that doesn't answer this prompt. Never "typo-correct" a
  // real, different answer into an accepted one.
  if (firstRejection) return firstRejection;

  // Typos, only against this prompt's own answers.
  const fz = opts.noFuzzy ? null : fuzzy(model, rt, base.loose, base.script, clean);
  if (fz) return fz;
  return { ok: false, reason: 'not-found', script: base.script, clean };
}
