// Content compiler: turns the human-edited answer pools (pipe-separated text files) and
// prompt definitions (JSON) into the compiled content the game loads, and reports every
// problem it finds. Used by scripts/content.ts and by the tests.
//
// Pool file format (content/pools/*.psv):
//   # pool: food                         required, the pool id
//   # title: Korean food | 한국 음식       English | Korean
//   # category: food                     one of the 12 category ids
//   # source: ...                        where the answer list comes from / how to verify it
//   # drafted: 2026-10-11, AI-assisted   how and when the list was drafted
//   # reviewed: pending                  date of the last human editorial review, or "pending"
//   # defaults: dish                     tags added to every row
//   ## tags: soup, stew                  tags added to the rows that follow (until the next ##)
//   name | hangul | fam | tags | aliases | note
// fam: 1 (obscure) .. 6 (the obvious answer). aliases: comma-separated; prefix ~ marks an
// English translation (only accepted where a prompt accepts English).

import { romanizations } from './hangul';
import { keysFor, scriptOf } from './normalize';
import { hashString } from './rng';
import type { Alias, CategoryId, CategoryMeta, CompiledContent, Entity, Lang, PoolMeta, PromptDef } from './types';

export const CATEGORIES: CategoryMeta[] = [
  { id: 'food', name: { en: 'Food & drink', ko: '음식' } },
  { id: 'geo', name: { en: 'Geography', ko: '지리' } },
  { id: 'history', name: { en: 'History', ko: '역사' } },
  { id: 'ent', name: { en: 'K-pop & screen', ko: '대중문화' } },
  { id: 'lang', name: { en: 'Language', ko: '언어' } },
  { id: 'folk', name: { en: 'Folklore', ko: '설화' } },
  { id: 'sport', name: { en: 'Sports', ko: '스포츠' } },
  { id: 'tech', name: { en: 'Tech & industry', ko: '기술·산업' } },
  { id: 'culture', name: { en: 'Culture & life', ko: '문화·생활' } },
  { id: 'nature', name: { en: 'Nature', ko: '자연' } },
  { id: 'brand', name: { en: 'Brands', ko: '브랜드' } },
  { id: 'assoc', name: { en: 'Word association', ko: '연상' } },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export interface Issue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export interface RawPool {
  meta: PoolMeta;
  entities: Entity[];
  file: string;
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitList(s: string | undefined): string[] {
  return (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parsePool(text: string, file: string, issues: Issue[]): RawPool | null {
  const meta: Partial<PoolMeta> & { defaults?: string[] } = {};
  let sectionTags: string[] = [];
  const entities: Entity[] = [];
  const ids = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const t = line.trim();
    if (!t) return;
    if (t.startsWith('##')) {
      const m = t.match(/^##\s*tags:\s*(.*)$/i);
      sectionTags = m ? splitList(m[1]) : [];
      return;
    }
    if (t.startsWith('#')) {
      const m = t.match(/^#\s*([a-z]+):\s*(.*)$/i);
      if (!m) return;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'pool') meta.id = val;
      else if (key === 'title') {
        const [en, ko] = val.split('|').map((x) => x.trim());
        meta.title = { en, ko: ko || en };
      } else if (key === 'category') meta.category = val as CategoryId;
      else if (key === 'source') meta.source = val;
      else if (key === 'reviewed') meta.reviewed = val;
      else if (key === 'drafted') meta.drafted = val;
      else if (key === 'defaults') meta.defaults = splitList(val);
      return;
    }
    if (!meta.id) {
      issues.push({ level: 'error', where, message: 'Row before "# pool:" header' });
      return;
    }
    const cols = line.split('|').map((c) => c.trim());
    const [name, hangul, famRaw, tagsRaw, aliasesRaw, ...noteParts] = cols;
    if (!name) {
      issues.push({ level: 'error', where, message: 'Missing name' });
      return;
    }
    if ((/\?$/.test(name) && !hangul) || splitList(aliasesRaw).some((a) => a.endsWith('?'))) {
      issues.push({ level: 'error', where, message: `Placeholder or uncertain text in "${name}" (remove the "?")` });
      return;
    }
    const fam = Number(famRaw);
    if (!Number.isInteger(fam) || fam < 1 || fam > 6) {
      issues.push({ level: 'error', where, message: `Familiarity must be 1-6 (got "${famRaw}") for ${name}` });
      return;
    }
    const id = slugify(name);
    if (ids.has(id)) {
      issues.push({ level: 'error', where, message: `Duplicate id "${id}" in pool ${meta.id}` });
      return;
    }
    ids.add(id);
    const tags = [...new Set([...(meta.defaults ?? []), ...sectionTags, ...splitList(tagsRaw)])];
    const aliases: Alias[] = splitList(aliasesRaw).map((a) =>
      a.startsWith('~')
        ? { text: a.slice(1).trim(), lang: 'en' as Lang }
        : { text: a, lang: (scriptOf(a) === 'hangul' ? 'ko' : 'rr') as Lang },
    );
    const note = noteParts.join('|').trim() || undefined;
    entities.push({
      key: `${meta.id}:${id}`,
      pool: meta.id,
      id,
      name,
      hangul: hangul || undefined,
      fam,
      tags,
      aliases,
      note,
    });
  });
  if (!meta.id) {
    issues.push({ level: 'error', where: file, message: 'Missing "# pool:" header' });
    return null;
  }
  if (!meta.category || !CATEGORY_IDS.has(meta.category)) {
    issues.push({ level: 'error', where: file, message: `Unknown or missing category "${meta.category}"` });
  }
  if (!meta.source) issues.push({ level: 'warning', where: file, message: 'Pool has no "# source:" line' });
  if (meta.reviewed && meta.reviewed !== 'pending' && !/^\d{4}-\d{2}-\d{2}$/.test(meta.reviewed)) {
    issues.push({ level: 'error', where: file, message: `"# reviewed:" must be a date (YYYY-MM-DD) or "pending" (got "${meta.reviewed}")` });
  }
  return {
    meta: {
      id: meta.id,
      title: meta.title ?? { en: meta.id, ko: meta.id },
      category: (meta.category ?? 'assoc') as CategoryId,
      source: meta.source ?? '',
      ...(meta.drafted ? { drafted: meta.drafted } : {}),
      reviewed: meta.reviewed ?? 'pending',
    },
    entities,
    file,
  };
}

// --- Automatic aliases --------------------------------------------------------

function stripSuffix(name: string, suffix: string): string | null {
  const lower = name.toLowerCase();
  if (!lower.endsWith(suffix) || lower.length - suffix.length < 2) return null;
  return name.slice(0, name.length - suffix.length).replace(/[-\s]+$/, '');
}

/** Tags that generate place-style aliases ("X temple", "X island"...). Only meaningful for places. */
export const ALIAS_TAGS = ['city', 'county', 'province', 'district', 'mountain', 'island', 'river', 'stream', 'temple', 'palace', 'fortress', 'lake', 'beach', 'park', 'station', 'market', 'festival', 'bridge'];
const PLACE_CATEGORIES = new Set(['geo', 'history', 'culture', 'tech', 'sport']);

/** Spelled-out forms people type: "Mount Halla", "Han River", "Suwon City", "Mapo". */
export function autoAliases(e: Entity): Alias[] {
  const out: Alias[] = [];
  const add = (text: string, lang: Lang = 'en') => out.push({ text, lang });
  const has = (t: string) => e.tags.includes(t);
  const n = e.name;

  if (e.hangul) for (const r of romanizations(e.hangul)) add(r, 'rr');

  if (has('city')) { add(`${n} city`); add(`${n}-si`, 'rr'); }
  if (has('county')) { add(`${n} county`); add(`${n}-gun`, 'rr'); }
  if (has('province')) { add(`${n} province`); add(`${n}-do`, 'rr'); }
  if (has('district')) {
    const b = stripSuffix(n, 'gu');
    if (b) { add(b, 'rr'); add(`${b} district`); }
  }
  if (has('mountain')) {
    const b = stripSuffix(n, 'san') ?? stripSuffix(n, 'bong') ?? stripSuffix(n, 'ak');
    add(`${n} mountain`);
    add(`mount ${n}`);
    if (b && b.length >= 3) { add(`mount ${b}`); add(`mt ${b}`); add(`${b} mountain`); add(b, 'rr'); }
  }
  if (has('island')) {
    const b = stripSuffix(n, 'do') ?? stripSuffix(n, 'seom');
    add(`${n} island`);
    if (b && b.length >= 3) { add(`${b} island`); add(b, 'rr'); }
  }
  if (has('river')) {
    const b = stripSuffix(n, 'gang') ?? stripSuffix(n, 'cheon');
    add(`${n} river`);
    if (b && b.length >= 2) { add(`${b} river`); add(b, 'rr'); }
  }
  if (has('stream')) {
    const b = stripSuffix(n, 'cheon');
    add(`${n} stream`);
    if (b) add(`${b} stream`);
  }
  if (has('temple')) {
    const b = stripSuffix(n, 'sa');
    add(`${n} temple`);
    if (b && b.length >= 3) add(`${b} temple`);
  }
  if (has('palace')) {
    const b = stripSuffix(n, 'gung');
    add(`${n} palace`);
    if (b && b.length >= 3) add(`${b} palace`);
  }
  if (has('fortress')) {
    const b = stripSuffix(n, 'sanseong') ?? stripSuffix(n, 'seong');
    add(`${n} fortress`);
    if (b && b.length >= 3) { add(`${b} fortress`); add(`${b} castle`); }
  }
  if (has('lake')) {
    const b = stripSuffix(n, 'ho');
    add(`${n} lake`);
    if (b && b.length >= 3) { add(`${b} lake`); add(`lake ${b}`); }
  }
  if (has('beach')) add(`${n} beach`);
  if (has('park') && !/park$/i.test(n)) { add(`${n} national park`); add(`${n} park`); }
  if (has('station')) add(`${n} station`);
  if (has('market')) { add(`${n} market`); add(`${n} sijang`, 'rr'); }
  if (has('festival')) add(`${n} festival`);
  if (has('bridge')) { const b = stripSuffix(n, 'daegyo') ?? stripSuffix(n, 'gyo'); add(`${n} bridge`); if (b && b.length >= 3) add(`${b} bridge`); }

  // Hangul without the administrative suffix: 수원시 -> 수원, 강남구 -> 강남
  if (e.hangul && (has('city') || has('county') || has('district') || has('province'))) {
    const h = e.hangul;
    const syl = [...h];
    if (syl.length >= 3 && /[시군구도]$/.test(h)) add(syl.slice(0, -1).join(''), 'ko');
  }
  return out;
}

/** Remove aliases that duplicate the name, the Hangul, or each other. */
export function dedupeAliases(e: Entity, extra: Alias[]): Alias[] {
  const seen = new Set<string>();
  const mark = (text: string, lang: Lang) => {
    const k = keysFor(text);
    const id = k.exact + '|' + (k.script === 'hangul' ? 'ko' : lang === 'en' ? 'en' : 'rr');
    if (!k.exact || k.exact === 'h:' || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  mark(e.name, 'rr');
  if (e.hangul) mark(e.hangul, 'ko');
  const out: Alias[] = [];
  for (const a of [...e.aliases, ...extra]) if (mark(a.text, a.lang)) out.push(a);
  return out;
}

// --- Prompts ------------------------------------------------------------------

export interface RawPrompt {
  id: string;
  cat?: CategoryId;
  en: string;
  ko: string;
  hint?: { en: string; ko: string };
  note?: string;
  pools: string | string[];
  any?: string[];
  all?: string[];
  not?: string[];
  inc?: string[];
  /** Accept only the `inc` list (the pools still explain near misses). */
  only?: boolean;
  exc?: string[];
  acc?: Lang[];
  fam?: Record<string, number>;
  d?: 1 | 2 | 3;
  timer?: number;
  max?: number;
  st?: 'approved' | 'draft' | 'retired';
  from?: string;
  to?: string;
  src?: string;
  daily?: boolean;
  /** The bank lists every valid answer; the AI judge may map spellings but never add answers. */
  closed?: boolean;
}

export interface CompileInput {
  pools: Array<{ file: string; text: string }>;
  prompts: Array<{ file: string; category: CategoryId; items: RawPrompt[] }>;
  epoch: string;
  minAnswersForDaily: number;
  /** Published schedule (content/schedule.lock.json): KST date -> prompt ids. */
  schedule?: Record<string, string[]>;
}

export interface CompileOutput {
  content: CompiledContent;
  issues: Issue[];
}

/** Compact on-disk form of compiled content (roughly halves the JSON the game downloads). */
export interface EncodedContent {
  v: string;
  g: string;
  c: CategoryMeta[];
  p: Record<string, PoolMeta>;
  /** [pool, id, name, hangul, fam, tags, aliases ("~" = English), note] */
  e: Array<[string, string, string, string, number, string, string, string]>;
  q: PromptDef[];
  /** Published schedule lock. */
  s?: Record<string, string[]>;
}

export function encodeContent(c: CompiledContent): EncodedContent {
  return {
    v: c.version,
    g: c.generatedAt,
    c: c.categories,
    p: c.pools,
    e: c.entities.map((e) => [
      e.pool,
      e.id,
      e.name,
      e.hangul ?? '',
      e.fam,
      e.tags.join(','),
      e.aliases.map((a) => (a.lang === 'en' ? '~' : '') + a.text).join('|'),
      e.note ?? '',
    ]),
    q: c.prompts,
    ...(c.schedule && Object.keys(c.schedule).length ? { s: c.schedule } : {}),
  };
}

/**
 * Check a published schedule against the content. A published prompt can be fixed or retired
 * but never deleted or renamed: old dives in the archive (and players' results) refer to it.
 */
export function checkSchedule(schedule: Record<string, string[]>, prompts: PromptDef[], epoch: string, issues: Issue[]): void {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  for (const [date, ids] of Object.entries(schedule)) {
    const where = `schedule.lock.json#${date}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < epoch) {
      issues.push({ level: 'error', where, message: `Bad date (must be YYYY-MM-DD on or after the epoch ${epoch})` });
      continue;
    }
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) {
      issues.push({ level: 'error', where, message: 'A published day needs a non-empty list of distinct prompt ids' });
      continue;
    }
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) {
        issues.push({ level: 'error', where, message: `Published prompt "${id}" no longer exists. Never delete or rename a published prompt; retire it with "to" instead.` });
      } else if (p.retiredOn && p.retiredOn < date) {
        issues.push({ level: 'warning', where, message: `"${id}" is retired from ${p.retiredOn} but already published for ${date}; the published schedule wins` });
      }
    }
  }
}

export function compileContent(input: CompileInput): CompileOutput {
  const issues: Issue[] = [];
  const pools: Record<string, PoolMeta> = {};
  const entities: Entity[] = [];
  const tagsByPool = new Map<string, Set<string>>();

  for (const f of input.pools) {
    const p = parsePool(f.text, f.file, issues);
    if (!p) continue;
    if (pools[p.meta.id]) {
      issues.push({ level: 'error', where: f.file, message: `Pool id "${p.meta.id}" defined twice` });
      continue;
    }
    pools[p.meta.id] = p.meta;
    if (!PLACE_CATEGORIES.has(p.meta.category)) {
      const misused = ALIAS_TAGS.filter((t) => p.entities.some((e) => e.tags.includes(t)));
      if (misused.length) issues.push({ level: 'warning', where: f.file, message: `Tags ${misused.join(', ')} generate place-name aliases; use a different tag name outside place pools` });
    }
    const tagSet = new Set<string>();
    for (const e of p.entities) {
      e.aliases = dedupeAliases(e, autoAliases(e)).map((a) =>
        a.lang !== 'en' && scriptOf(a.text) === 'hangul' ? { ...a, lang: 'ko' as Lang } : a,
      );
      e.tags.forEach((t) => tagSet.add(t));
      entities.push(e);
    }
    tagsByPool.set(p.meta.id, tagSet);
  }

  // Duplicate normalized display names inside one pool usually mean a copy-paste slip.
  // (Shared Hangul is fine: two kings can both be 태조; their display names disambiguate.)
  for (const [poolId] of Object.entries(pools)) {
    const owner = new Map<string, string>();
    for (const e of entities) {
      if (e.pool !== poolId) continue;
      const k = keysFor(e.name).exact;
      const prev = owner.get(k);
      if (prev && prev !== e.key) {
        issues.push({ level: 'warning', where: poolId, message: `Two entries normalize to "${e.name}": ${prev} and ${e.key}` });
      } else owner.set(k, e.key);
    }
  }

  const byKey = new Map(entities.map((e) => [e.key, e]));
  const prompts: PromptDef[] = [];
  const promptIds = new Set<string>();
  const promptTexts = new Map<string, string>();

  for (const file of input.prompts) {
    for (const raw of file.items) {
      const where = `${file.file}#${raw.id}`;
      if (!raw.id) {
        issues.push({ level: 'error', where: file.file, message: 'Prompt without id' });
        continue;
      }
      if (promptIds.has(raw.id)) {
        issues.push({ level: 'error', where, message: 'Duplicate prompt id' });
        continue;
      }
      promptIds.add(raw.id);
      const category = raw.cat ?? file.category;
      if (!CATEGORY_IDS.has(category)) issues.push({ level: 'error', where, message: `Unknown category "${category}"` });
      if (!raw.en || !raw.ko) issues.push({ level: 'error', where, message: 'Prompt needs both English and Korean text' });
      const textKey = (raw.en ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (promptTexts.has(textKey)) {
        issues.push({ level: 'error', where, message: `Duplicate prompt text (same as ${promptTexts.get(textKey)})` });
      } else promptTexts.set(textKey, raw.id);
      const poolList = Array.isArray(raw.pools) ? raw.pools : [raw.pools];
      for (const pid of poolList) if (!pools[pid]) issues.push({ level: 'error', where, message: `Unknown pool "${pid}"` });
      const resolve = (ref: string) => (ref.includes(':') ? ref : `${poolList[0]}:${ref}`);
      if (raw.only && !(raw.inc ?? []).length) issues.push({ level: 'error', where, message: '"only" needs an inc list' });
      const include = (raw.inc ?? []).map(resolve);
      const exclude = (raw.exc ?? []).map(resolve);
      for (const k of [...include, ...exclude]) {
        if (!byKey.has(k)) issues.push({ level: 'error', where, message: `Unknown entity "${k}"` });
      }
      const famOverride: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.fam ?? {})) {
        const key = resolve(k);
        if (!byKey.has(key)) issues.push({ level: 'error', where, message: `fam override for unknown entity "${key}"` });
        else if (!(v >= 1 && v <= 6)) issues.push({ level: 'error', where, message: `fam override out of range for ${key}` });
        else famOverride[key] = v;
      }
      const allTags = new Set<string>();
      for (const pid of poolList) for (const t of tagsByPool.get(pid) ?? []) allTags.add(t);
      for (const t of [...(raw.any ?? []), ...(raw.all ?? []), ...(raw.not ?? [])]) {
        if (!allTags.has(t)) issues.push({ level: 'warning', where, message: `Tag "${t}" is not used by any entry in ${poolList.join(', ')}` });
      }
      const accept: Lang[] = raw.acc ?? ['ko', 'rr', 'en'];
      if (!accept.length || accept.some((l) => !['ko', 'rr', 'en'].includes(l))) {
        issues.push({ level: 'error', where, message: 'acc must list ko, rr and/or en' });
      }
      const difficulty = raw.d ?? 2;
      if (![1, 2, 3].includes(difficulty)) issues.push({ level: 'error', where, message: 'd (difficulty) must be 1, 2 or 3' });
      const sources = poolList.map((pid) => pools[pid]?.source).filter(Boolean);
      if (!raw.src && !sources.length) issues.push({ level: 'warning', where, message: 'Factual prompt without a source (pool or prompt)' });
      prompts.push({
        id: raw.id,
        category,
        text: { en: raw.en, ko: raw.ko },
        hint: raw.hint,
        note: raw.note,
        pools: poolList,
        any: raw.any,
        all: raw.all,
        not: raw.not,
        include: include.length ? include : undefined,
        includeOnly: raw.only ? true : undefined,
        exclude: exclude.length ? exclude : undefined,
        accept,
        famOverride: Object.keys(famOverride).length ? famOverride : undefined,
        difficulty: difficulty as 1 | 2 | 3,
        timerSec: raw.timer ?? 20,
        maxPoints: raw.max ?? 100,
        status: raw.st ?? 'approved',
        availableFrom: raw.from ?? input.epoch,
        retiredOn: raw.to,
        source: raw.src,
        daily: raw.daily ?? true,
        ...(raw.closed ? { closed: true } : {}),
      });
    }
  }

  const schedule = input.schedule ?? {};
  checkSchedule(schedule, prompts, input.epoch, issues);

  const body = JSON.stringify({ entities, prompts });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const content: CompiledContent = {
    version: `${stamp}-${hashString(body).toString(16).padStart(8, '0')}`,
    generatedAt: new Date().toISOString(),
    categories: CATEGORIES,
    pools,
    entities,
    prompts,
    ...(Object.keys(schedule).length ? { schedule } : {}),
  };
  return { content, issues };
}
