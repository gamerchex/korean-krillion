// Shared types for HAN-GUK.IO. Everything in src/core is framework-free TypeScript so the
// browser game, the Node reference server, the content scripts and the tests all use the
// same rules.

export type Lang = 'ko' | 'rr' | 'en';

export type CategoryId =
  | 'food'
  | 'geo'
  | 'history'
  | 'ent'
  | 'lang'
  | 'folk'
  | 'sport'
  | 'tech'
  | 'culture'
  | 'nature'
  | 'brand'
  | 'assoc';

export type RunMode = 'daily' | 'archive' | 'practice';

export type AnswerStatus = 'accepted' | 'rejected' | 'timeout';

/** Why an answer earned nothing. Each maps to a plain-language explanation in the UI. */
export type RejectReason =
  | 'empty' // nothing typed before submitting
  | 'excluded' // a real answer the prompt explicitly rules out ("other than kimchi")
  | 'wrong-fit' // a real entry in the same category that doesn't fit this prompt's filter
  | 'outside-category' // a real Korean entry from a different category altogether
  | 'wrong-language' // e.g. an English translation where the prompt wants the Korean word
  | 'not-found' // not in the answer bank: queued for review
  | 'ambiguous' // a typo-level match to two or more different answers
  | 'duplicate' // the same answer was already used earlier in this dive
  | 'ai-rejected' // not in the bank, and the AI judge said it doesn't answer the prompt
  | 'skipped' // the player passed on the prompt
  | 'late'; // arrived after the timer (counts as a timeout)

export type MatchMethod = 'exact' | 'hangul' | 'loose' | 'fuzzy' | 'community' | 'ai';

/** Where an answer's frequency estimate came from. */
export type DataSource = 'curated' | 'blended' | 'ai';

export type Confidence = 'curated' | 'low' | 'medium' | 'high';

export type TierId =
  | 'none'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'very-rare'
  | 'extremely-rare'
  | 'legendary';

export interface Alias {
  text: string;
  lang: Lang;
}

/** One accepted answer in the bank: a dish, a city, a king, a K-pop group... */
export interface Entity {
  /** Globally unique key: `${pool}:${id}` */
  key: string;
  pool: string;
  id: string;
  /** Display name, usually romanized Korean or the common English name. */
  name: string;
  hangul?: string;
  /** Curated familiarity 1 (obscure) .. 6 (the answer everyone gives). Drives prior rarity. */
  fam: number;
  tags: string[];
  aliases: Alias[];
  /** Short fact shown in the post-answer reveal. */
  note?: string;
}

export interface PoolMeta {
  id: string;
  title: { en: string; ko: string };
  category: CategoryId;
  source: string;
  /** How and when the list was drafted, e.g. "2026-10-11, AI-assisted". */
  drafted?: string;
  /** Date of the last human editorial review (YYYY-MM-DD), or "pending". */
  reviewed: string;
}

export interface Bilingual {
  en: string;
  ko: string;
}

export interface PromptDef {
  id: string;
  category: CategoryId;
  text: Bilingual;
  /** Optional explanatory line shown under the prompt. */
  hint?: Bilingual;
  /** Editorial note shown in reveals and the content report. */
  note?: string;
  /** Selection rules: entities from these pools... */
  pools: string[];
  /** ...having at least one of these tags (if given)... */
  any?: string[];
  /** ...having all of these tags (if given)... */
  all?: string[];
  /** ...having none of these tags. */
  not?: string[];
  /** Extra entity keys accepted regardless of tags (cross-pool allowed). */
  include?: string[];
  /** When true, only `include` is accepted; the pools just supply near-miss explanations. */
  includeOnly?: boolean;
  /** Entity keys the prompt rules out explicitly ("other than kimchi"). */
  exclude?: string[];
  /** Which answer languages count. Language prompts use ['ko','rr']. */
  accept: Lang[];
  /** Prompt-specific familiarity overrides (entity key -> fam). */
  famOverride?: Record<string, number>;
  difficulty: 1 | 2 | 3;
  timerSec: number;
  maxPoints: number;
  status: 'approved' | 'draft' | 'retired';
  /** First KST date the prompt may appear in an official daily. */
  availableFrom: string;
  /** Last KST date (inclusive) it may appear; omitted = no end. */
  retiredOn?: string;
  /** Source note; falls back to the pools' sources. */
  source?: string;
  /** Set false to keep a prompt practice-only. */
  daily: boolean;
  /**
   * The bank lists every valid answer (zodiac animals, Line 2 stations...). The AI judge may
   * still recognise a spelling of a listed answer, but never adds a new one.
   */
  closed?: boolean;
}

export interface CategoryMeta {
  id: CategoryId;
  name: Bilingual;
}

export interface CompiledContent {
  version: string;
  generatedAt: string;
  categories: CategoryMeta[];
  pools: Record<string, PoolMeta>;
  entities: Entity[];
  prompts: PromptDef[];
  /**
   * Published official schedule (KST date -> prompt ids), from content/schedule.lock.json.
   * Locked days never change, whatever happens to the content later.
   */
  schedule?: Record<string, string[]>;
}

/** Observed answer statistics for one prompt in one challenge (Method A). */
export interface AnswerStats {
  /** Valid (accepted) submissions observed, excluding the player being scored. */
  valid: number;
  /** All eligible submissions observed (accepted + rejected + timeouts). */
  eligible: number;
  /** Accepted submissions per entity key. */
  counts: Record<string, number>;
  /** Observation window, KST date keys. */
  from?: string;
  to?: string;
}

export interface RarityEstimate {
  /** Estimated share of players who give this answer, 0..1 */
  p: number;
  /** Curated prior before any blending. */
  prior: number;
  source: DataSource;
  confidence: Confidence;
  sampleSize: number;
}

/** One wrong try on a prompt. The prompt stays open (Krillion-style retries). */
export interface Attempt {
  input: string;
  reason: RejectReason;
  /** ms after the prompt opened */
  at: number;
  /** Name of the entry that explains the rejection, or the AI judge's reading of the answer. */
  matchedName?: string;
  explainKey?: string;
  candidates?: string[];
  /** The AI judge's one-line explanation, when the AI looked at this try. */
  aiNote?: { en: string; ko: string };
  /** Clock time this try cost. */
  penaltyMs?: number;
}

/** What the AI judge said about an answer the bank could not accept. */
export interface AiVerdict {
  verdict: 'valid' | 'invalid' | 'unsure';
  /** Standard name of the thing (romanized Korean or established English name). */
  canonical: string;
  hangul: string;
  /** 1 (obscure) .. 6 (the answer everyone gives) for this prompt. */
  familiarity: number;
  reason: { en: string; ko: string };
  /** Which judge answered (model or tier), for the record. */
  by?: string;
}

export interface AnswerRecord {
  index: number;
  promptId: string;
  input: string;
  status: AnswerStatus;
  reason?: RejectReason;
  entityKey?: string;
  matchedBy?: MatchMethod;
  /** Display name of the matched entity (or the closest entity that explains a rejection). */
  matchedName?: string;
  explainKey?: string;
  /** For ambiguous typos: the answers it was equally close to. */
  candidates?: string[];
  points: number;
  tier: TierId;
  estimate?: RarityEstimate;
  elapsedMs: number;
  /** Clock time left when the answer was accepted (null when untimed). */
  leftMs?: number | null;
  totalAfter: number;
  depthAfter: number;
  script?: 'hangul' | 'latin';
  /** Wrong tries before this answer (or before time ran out). */
  tries?: Attempt[];
  /** Set when the AI judge accepted the answer. */
  ai?: { canonical: string; hangul?: string; familiarity: number; reason: { en: string; ko: string }; by?: string };
}

export interface Judging {
  input: string;
  /** When the answer was submitted (the clock stopped here). */
  since: number;
  /** What the bank said about it. */
  bank: { reason: RejectReason; nearKey?: string; candidates?: string[]; script: 'hangul' | 'latin' };
}

export interface RunState {
  runId: string;
  mode: RunMode;
  challengeId: string;
  /** KST date key for daily/archive runs. */
  dateKey?: string;
  promptIds: string[];
  index: number;
  phase: 'answering' | 'revealing' | 'done';
  openedAt: number | null;
  deadline: number | null;
  timerSec: number | null;
  answers: AnswerRecord[];
  /** Wrong tries on the current prompt. */
  tries?: Attempt[];
  /** An answer waiting for the AI judge; the clock is paused meanwhile. */
  judging?: Judging | null;
  /** AI checks used on the current prompt. */
  aiChecks?: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  scoringVersion: string;
  contentVersion: string;
}
