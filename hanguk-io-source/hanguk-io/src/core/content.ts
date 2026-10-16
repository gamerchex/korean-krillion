// Runtime content model: entity lookup, per-prompt answer sets, and the search indexes
// the validator uses. Built once from the compiled content JSON.

import { SCORING, type ScoringConfig } from './config';
import { keysFor, scriptOf } from './normalize';
import type { CategoryMeta, CompiledContent, Entity, Lang, PromptDef } from './types';

export interface IndexEntry {
  key: string;
  lang: Lang;
}

export interface PromptRuntime {
  prompt: PromptDef;
  /** Entity keys that answer the prompt. */
  accepted: Set<string>;
  acceptedList: Entity[];
  /** Everything in the prompt's pools (used to explain near-miss rejections). */
  universe: Set<string>;
  excluded: Set<string>;
  /** Curated prior weight per accepted entity. */
  weights: Map<string, number>;
  totalWeight: number;
  /** Loose keys of accepted entities, for typo-tolerant matching. */
  looseKeys: Array<{ loose: string; key: string; lang: Lang }>;
}

function push(map: Map<string, IndexEntry[]>, k: string, entry: IndexEntry) {
  if (!k || k === 'h:') return;
  const list = map.get(k);
  if (!list) map.set(k, [entry]);
  else if (!list.some((e) => e.key === entry.key && e.lang === entry.lang)) list.push(entry);
}

/** Inverse of encodeContent() in compile.ts. Accepts already-decoded content unchanged. */
export function decodeContent(raw: unknown): CompiledContent {
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.entities)) return r as unknown as CompiledContent;
  const enc = r as {
    v: string;
    g: string;
    c: CompiledContent['categories'];
    p: CompiledContent['pools'];
    e: Array<[string, string, string, string, number, string, string, string]>;
    q: PromptDef[];
    s?: Record<string, string[]>;
  };
  const entities: Entity[] = enc.e.map(([pool, id, name, hangul, fam, tags, aliases, note]) => ({
    key: `${pool}:${id}`,
    pool,
    id,
    name,
    hangul: hangul || undefined,
    fam,
    tags: tags ? tags.split(',') : [],
    aliases: aliases
      ? aliases.split('|').map((a) =>
          a.startsWith('~')
            ? { text: a.slice(1), lang: 'en' as Lang }
            : { text: a, lang: (scriptOf(a) === 'hangul' ? 'ko' : 'rr') as Lang },
        )
      : [],
    note: note || undefined,
  }));
  return { version: enc.v, generatedAt: enc.g, categories: enc.c, pools: enc.p, entities, prompts: enc.q, schedule: enc.s };
}

/** The prompt rules this entry out by a negative tag filter ("not spicy"): a hard rule. */
export function failsNegative(p: PromptDef, e: Entity | undefined): boolean {
  return !!e && !!p.not?.some((t) => e.tags.includes(t));
}

/** The bank lists every valid answer, so nothing new may be added by the AI judge. */
export function isClosed(p: PromptDef): boolean {
  return !!p.closed || !!p.includeOnly;
}

export function entityMatchesPrompt(p: PromptDef, e: Entity): boolean {
  if (!p.pools.includes(e.pool)) return false;
  if (p.any && p.any.length && !p.any.some((t) => e.tags.includes(t))) return false;
  if (p.all && p.all.length && !p.all.every((t) => e.tags.includes(t))) return false;
  if (p.not && p.not.length && p.not.some((t) => e.tags.includes(t))) return false;
  return true;
}

export class ContentModel {
  readonly content: CompiledContent;
  readonly scoring: ScoringConfig;
  readonly entities = new Map<string, Entity>();
  readonly prompts = new Map<string, PromptDef>();
  readonly categories = new Map<string, CategoryMeta>();
  private exactIndex = new Map<string, IndexEntry[]>();
  private looseIndex = new Map<string, IndexEntry[]>();
  private byPool = new Map<string, Entity[]>();
  private runtimeCache = new Map<string, PromptRuntime>();

  constructor(content: CompiledContent, scoring: ScoringConfig = SCORING) {
    this.content = content;
    this.scoring = scoring;
    for (const c of content.categories) this.categories.set(c.id, c);
    for (const e of content.entities) {
      this.entities.set(e.key, e);
      const list = this.byPool.get(e.pool);
      if (list) list.push(e);
      else this.byPool.set(e.pool, [e]);
      this.indexEntity(e);
    }
    for (const p of content.prompts) this.prompts.set(p.id, p);
  }

  private indexEntity(e: Entity) {
    const add = (text: string, lang: Lang) => {
      const k = keysFor(text);
      const l: Lang = k.script === 'hangul' ? 'ko' : lang;
      push(this.exactIndex, k.exact, { key: e.key, lang: l });
      push(this.looseIndex, k.loose, { key: e.key, lang: l });
    };
    add(e.name, 'rr');
    if (e.hangul) add(e.hangul, 'ko');
    for (const a of e.aliases) add(a.text, a.lang);
  }

  entity(key: string): Entity | undefined {
    return this.entities.get(key);
  }

  prompt(id: string): PromptDef | undefined {
    return this.prompts.get(id);
  }

  lookupExact(k: string): IndexEntry[] {
    return this.exactIndex.get(k) ?? [];
  }

  lookupLoose(k: string): IndexEntry[] {
    return this.looseIndex.get(k) ?? [];
  }

  poolEntities(pool: string): Entity[] {
    return this.byPool.get(pool) ?? [];
  }

  famFor(p: PromptDef, e: Entity): number {
    return p.famOverride?.[e.key] ?? e.fam;
  }

  runtime(promptId: string): PromptRuntime {
    const cached = this.runtimeCache.get(promptId);
    if (cached) return cached;
    const prompt = this.prompts.get(promptId);
    if (!prompt) throw new Error(`Unknown prompt ${promptId}`);
    const excluded = new Set(prompt.exclude ?? []);
    const accepted = new Set<string>();
    const universe = new Set<string>();
    for (const pool of prompt.pools) {
      for (const e of this.poolEntities(pool)) {
        universe.add(e.key);
        if (!prompt.includeOnly && entityMatchesPrompt(prompt, e) && !excluded.has(e.key)) accepted.add(e.key);
      }
    }
    for (const k of prompt.include ?? []) {
      if (this.entities.has(k) && !excluded.has(k)) {
        accepted.add(k);
        universe.add(k);
      }
    }
    const acceptedList = [...accepted].map((k) => this.entities.get(k)!).filter(Boolean);
    const weights = new Map<string, number>();
    let totalWeight = 0;
    for (const e of acceptedList) {
      const w = Math.pow(this.scoring.famBase, Math.max(1, Math.min(6, this.famFor(prompt, e))) - 1);
      weights.set(e.key, w);
      totalWeight += w;
    }
    const looseKeys: PromptRuntime['looseKeys'] = [];
    for (const e of acceptedList) {
      const seen = new Set<string>();
      const add = (text: string, lang: Lang) => {
        const k = keysFor(text);
        const l: Lang = k.script === 'hangul' ? 'ko' : lang;
        const id = k.loose + '|' + l;
        if (seen.has(id) || !k.loose || k.loose === 'h:') return;
        seen.add(id);
        looseKeys.push({ loose: k.loose, key: e.key, lang: l });
      };
      add(e.name, 'rr');
      if (e.hangul) add(e.hangul, 'ko');
      for (const a of e.aliases) add(a.text, a.lang);
    }
    const rt: PromptRuntime = { prompt, accepted, acceptedList, universe, excluded, weights, totalWeight, looseKeys };
    this.runtimeCache.set(promptId, rt);
    return rt;
  }

  /** Approved prompts eligible for official dailies on a given KST date. */
  dailyEligible(dateKey: string, minAnswers: number): PromptDef[] {
    const out: PromptDef[] = [];
    for (const p of this.content.prompts) {
      if (p.status !== 'approved' || !p.daily) continue;
      if (p.availableFrom > dateKey) continue;
      if (p.retiredOn && p.retiredOn < dateKey) continue;
      if (this.runtime(p.id).accepted.size < minAnswers) continue;
      out.push(p);
    }
    return out;
  }
}
