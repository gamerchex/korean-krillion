// AI answer checking in the browser.
//
//   artifact  Claude through the page's `sample` capability, on the viewer's own Claude
//             account (asks once). Verdicts are shared through the page's db
//             (verdicts/<viewer>) so everyone on the board gets the same ruling and score
//             for the same answer, and the owner can block an AI-accepted answer.
//   key       the standalone page with the player's own Anthropic API key (kept in this
//             browser, sent only to api.anthropic.com). Verdicts are cached locally.
//   server    the reference server judges answers itself; nothing to do here.
//   off       no judge: the answer bank alone decides.

import { aiAnswerKey, anthropicJudge, DEFAULT_JUDGE_MODEL, textJudge, verdictKey, type Judge } from '../core/judge';
import type { AiVerdict, AnswerRecord } from '../core/types';
import type { Platform } from './platform';

export type AiMode = 'artifact' | 'key' | 'server' | 'off';

const KEY_STORE = 'hanguk.ai.key.v1';
const CACHE_STORE = 'hanguk.ai.cache.v1';

export const JUDGE_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: { en: 'fastest', ko: '가장 빠름' } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: { en: 'more careful, slower', ko: '더 꼼꼼함, 느림' } },
];

export function loadApiKey(): { key: string; model: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_STORE) ?? 'null') as { key?: string; model?: string } | null;
    return raw?.key ? { key: raw.key, model: raw.model || DEFAULT_JUDGE_MODEL } : null;
  } catch {
    return null;
  }
}

export function saveApiKey(key: string, model: string): void {
  try {
    localStorage.setItem(KEY_STORE, JSON.stringify({ key: key.trim(), model }));
  } catch {
    /* private mode: the key lasts for this page load only */
  }
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}

/** Compact stored verdict. */
interface Stored {
  s: AiVerdict['verdict'];
  c: string;
  h: string;
  f: number;
  r: [string, string];
  t: number;
  by?: string;
}

interface VerdictDoc {
  /** verdict key (prompt|answer) -> verdict */
  v: Record<string, Stored>;
  /** prompt|answerKey -> familiarity of an AI-accepted new answer */
  a: Record<string, number>;
  updatedAt?: number;
}

const toStored = (v: AiVerdict, t: number): Stored => ({ s: v.verdict, c: v.canonical, h: v.hangul, f: v.familiarity, r: [v.reason.en, v.reason.ko], t, ...(v.by ? { by: v.by } : {}) });
const fromStored = (s: Stored): AiVerdict => ({ verdict: s.s, canonical: s.c, hangul: s.h, familiarity: s.f, reason: { en: s.r[0], ko: s.r[1] }, ...(s.by ? { by: s.by } : {}) });

/** Other viewers' documents are untrusted: keep only well-formed, bounded entries. */
function cleanDoc(raw: unknown): VerdictDoc {
  const out: VerdictDoc = { v: {}, a: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { v?: Record<string, unknown>; a?: Record<string, unknown> };
  for (const [k, val] of Object.entries(r.v ?? {}).slice(0, 2000)) {
    const s = val as Partial<Stored> | null;
    if (k.length > 200 || !s || !['valid', 'invalid', 'unsure'].includes(String(s.s))) continue;
    const f = Math.max(1, Math.min(6, Math.round(Number(s.f) || 3)));
    const reason = Array.isArray(s.r) ? s.r : [];
    out.v[k] = {
      s: s.s as Stored['s'],
      c: String(s.c ?? '').slice(0, 80),
      h: String(s.h ?? '').slice(0, 40),
      f,
      r: [String(reason[0] ?? '').slice(0, 200), String(reason[1] ?? '').slice(0, 200)],
      t: Number(s.t) || 0,
      ...(typeof s.by === 'string' ? { by: s.by.slice(0, 40) } : {}),
    };
  }
  for (const [k, val] of Object.entries(r.a ?? {}).slice(0, 2000)) {
    const f = Math.round(Number(val));
    if (k.length <= 200 && f >= 1 && f <= 6) out.a[k] = f;
  }
  return out;
}

const NOT_GRANTED = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

export interface AiStatus {
  mode: AiMode;
  /** The judge can be asked now. */
  ready: boolean;
  /** Claude was refused in this view (artifact) or the key was rejected (key mode). */
  problem?: 'refused' | 'bad-key' | 'unreachable';
}

export class AiService {
  mode: AiMode = 'off';
  private pf: Platform | null = null;
  private judgeFn: Judge | null = null;
  private problem: AiStatus['problem'];
  /** Merged view of every viewer's verdicts (artifact) or the local cache (key). */
  private verdicts = new Map<string, { v: AiVerdict; votes: number; t: number }>();
  private familiarity = new Map<string, number>();
  private blocked = new Set<string>();
  private mine: VerdictDoc = { v: {}, a: {} };
  private writing: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  /** Decide where answers are judged. Call again when the platform, server or key changes. */
  configure(opts: { pf: Platform; serverAi: boolean | null; key: { key: string; model: string } | null; inViewer?: boolean }): void {
    this.pf = opts.pf;
    this.problem = undefined;
    if (opts.serverAi !== null) {
      this.mode = opts.serverAi ? 'server' : 'off';
      this.judgeFn = null;
    } else if (opts.pf.sample?.json) {
      this.mode = 'artifact';
      const sample = opts.pf.sample;
      this.judgeFn = textJudge(
        (prompt, signal) => sample.json!(prompt, { modelTier: 'quick', cache: { gcTime: 86_400_000 }, ...(signal ? { signal } : {}) }),
        'claude (quick)',
      );
    } else if (opts.key && !opts.inViewer) {
      // (Inside a claude.ai viewer the page can't reach other hosts, so a key is no use there.)
      this.mode = 'key';
      this.judgeFn = anthropicJudge({ apiKey: opts.key.key, model: opts.key.model, browser: true });
    } else {
      this.mode = 'off';
      this.judgeFn = null;
    }
    if (this.mode === 'key' || this.mode === 'off') this.loadLocalCache();
    this.changed();
  }

  status(): AiStatus {
    return { mode: this.mode, ready: !!this.judgeFn && !this.problem, ...(this.problem ? { problem: this.problem } : {}) };
  }

  /** A judge the local driver can call, or null. */
  get judge(): Judge | null {
    if (!this.judgeFn || this.problem === 'refused' || this.problem === 'bad-key') return null;
    const fn = this.judgeFn;
    return async (req, signal) => {
      try {
        const v = await fn(req, signal);
        if (this.problem) {
          this.problem = undefined;
          this.changed();
        }
        return v;
      } catch (e) {
        const code = (e as { code?: string; status?: number }).code;
        const status = (e as { status?: number }).status;
        if (code && NOT_GRANTED.has(code)) this.problem = 'refused';
        else if (status === 401 || status === 403) this.problem = 'bad-key';
        else this.problem = 'unreachable';
        this.changed();
        throw e;
      }
    };
  }

  // --- shared verdicts -------------------------------------------------------------------

  /** Artifact: read every viewer's verdict document and the owner's block list. */
  async loadShared(): Promise<void> {
    const pf = this.pf;
    if (!pf?.db) return;
    try {
      const [snap, blockedSnap] = await Promise.all([pf.db.collection('verdicts').limit(1000).get(), pf.db.doc('approved/blocked').get()]);
      const docs: Array<{ id: string; doc: VerdictDoc }> = snap.docs.map((d: { id: string; data(): unknown }) => ({ id: d.id, doc: cleanDoc(d.data()) }));
      const mineDoc = docs.find((d) => d.id === pf.uid);
      if (mineDoc) this.mine = mineDoc.doc;
      this.merge(docs.map((d) => d.doc));
      this.blocked.clear();
      const keys = (blockedSnap.exists ? (blockedSnap.data() as { keys?: Record<string, unknown> })?.keys : null) ?? {};
      for (const [pid, list] of Object.entries(keys)) if (Array.isArray(list)) for (const k of list) if (typeof k === 'string') this.blocked.add(`${pid}|${k.slice(0, 200)}`);
      this.changed();
    } catch {
      /* the page still works without the shared cache */
    }
  }

  private merge(docs: VerdictDoc[]): void {
    this.verdicts.clear();
    this.familiarity.clear();
    const votes = new Map<string, Stored[]>();
    const fams = new Map<string, number[]>();
    for (const d of docs) {
      for (const [k, s] of Object.entries(d.v)) (votes.get(k) ?? votes.set(k, []).get(k)!).push(s);
      for (const [k, f] of Object.entries(d.a)) (fams.get(k) ?? fams.set(k, []).get(k)!).push(f);
    }
    for (const [k, list] of votes) {
      // Majority of valid vs not valid; the earliest ruling on the winning side stands.
      const ok = list.filter((s) => s.s === 'valid');
      const side = ok.length * 2 > list.length ? ok : ok.length * 2 < list.length ? list.filter((s) => s.s !== 'valid') : list;
      const first = side.slice().sort((a, b) => a.t - b.t)[0];
      this.verdicts.set(k, { v: fromStored(first), votes: list.length, t: first.t });
    }
    // Familiarity of an AI answer: the most common value recorded, ties going to the more
    // familiar (lower-scoring) one, so every viewer computes the same number.
    for (const [k, list] of fams) {
      const count = new Map<number, number>();
      for (const f of list) count.set(f, (count.get(f) ?? 0) + 1);
      const best = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
      this.familiarity.set(k, best);
    }
  }

  private loadLocalCache(): void {
    try {
      this.mine = cleanDoc(JSON.parse(localStorage.getItem(CACHE_STORE) ?? 'null'));
    } catch {
      this.mine = { v: {}, a: {} };
    }
    this.merge([this.mine]);
  }

  cachedVerdict = (promptId: string, key: string): AiVerdict | undefined => {
    void promptId;
    return this.verdicts.get(key)?.v;
  };

  aiAnswer = (promptId: string, answerKey: string): { familiarity: number; blocked?: boolean } | undefined => {
    const k = `${promptId}|${answerKey}`;
    const f = this.familiarity.get(k);
    const blocked = this.blocked.has(k);
    if (f === undefined && !blocked) return undefined;
    return { familiarity: f ?? 3, ...(blocked ? { blocked: true } : {}) };
  };

  /** Keep a fresh verdict (and the familiarity of a new answer it accepted) for everyone. */
  remember(promptId: string, input: string, verdict: AiVerdict, record?: AnswerRecord | null): void {
    const t = Date.now();
    const key = verdictKey(promptId, input);
    this.mine.v[key] = toStored(verdict, t);
    if (!this.verdicts.has(key)) this.verdicts.set(key, { v: verdict, votes: 1, t });
    if (record?.status === 'accepted' && record.ai && record.entityKey?.startsWith('ai:')) {
      const ak = `${promptId}|${record.entityKey}`;
      if (!(ak in this.mine.a)) this.mine.a[ak] = record.ai.familiarity;
      if (!this.familiarity.has(ak)) this.familiarity.set(ak, record.ai.familiarity);
    }
    // Keep the document small: the newest 400 verdicts.
    const entries = Object.entries(this.mine.v);
    if (entries.length > 400) this.mine.v = Object.fromEntries(entries.sort((a, b) => b[1].t - a[1].t).slice(0, 400));
    this.persist();
  }

  private persist(): void {
    const pf = this.pf;
    if (this.mode === 'artifact' && pf?.db && pf.uid) {
      const doc = { v: this.mine.v, a: this.mine.a, updatedAt: Date.now() };
      // One write at a time for this document.
      this.writing = this.writing.then(() => pf.db.doc(`verdicts/${pf.uid}`).set(doc)).catch(() => undefined);
      return;
    }
    try {
      localStorage.setItem(CACHE_STORE, JSON.stringify(this.mine));
    } catch {
      /* ignore */
    }
  }

  // --- moderation (artifact owner) -------------------------------------------------------

  /** AI-accepted new answers known on this page, newest first. */
  acceptedAnswers(): Array<{ promptId: string; answerKey: string; canonical: string; hangul: string; familiarity: number; votes: number; blocked: boolean; at: number }> {
    const out: Array<{ promptId: string; answerKey: string; canonical: string; hangul: string; familiarity: number; votes: number; blocked: boolean; at: number }> = [];
    const seen = new Set<string>();
    for (const [key, { v, votes, t }] of this.verdicts) {
      if (v.verdict !== 'valid') continue;
      const promptId = key.slice(0, key.indexOf('|'));
      const answerKey = aiAnswerKey(v);
      const id = `${promptId}|${answerKey}`;
      if (!this.familiarity.has(id) || seen.has(id)) continue; // only answers that were scored as new
      seen.add(id);
      out.push({ promptId, answerKey, canonical: v.canonical, hangul: v.hangul, familiarity: this.familiarity.get(id)!, votes, blocked: this.blocked.has(id), at: t });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  async setBlocked(promptId: string, answerKey: string, blocked: boolean): Promise<boolean> {
    const pf = this.pf;
    if (!pf?.db) return false;
    const id = `${promptId}|${answerKey}`;
    if (blocked) this.blocked.add(id);
    else this.blocked.delete(id);
    const keys: Record<string, string[]> = {};
    for (const b of this.blocked) {
      const i = b.indexOf('|');
      (keys[b.slice(0, i)] ??= []).push(b.slice(i + 1));
    }
    try {
      await pf.db.doc('approved/blocked').set({ keys, updatedAt: Date.now() });
      this.changed();
      return true;
    } catch {
      if (blocked) this.blocked.delete(id);
      else this.blocked.add(id);
      return false;
    }
  }
}

export const aiService = new AiService();
