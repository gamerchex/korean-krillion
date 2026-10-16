// The dive itself: a small state machine shared by the browser game and the server.
// Every transition is a pure function returning a new RunState, which makes the rules easy to
// test and lets the UI persist the run after each step (so a reload resumes the same dive with
// the same deadline instead of rerolling it).
//
// Tries (as in Krillion): a wrong answer does not end the prompt. It is recorded as a try,
// costs `wrongTryPenaltyMs` of the prompt's clock, and the player types again. A prompt ends at
// the first accepted answer, a pass, or when its time runs out.
//
// AI judging: an answer the bank can't place may go to the AI judge (judge.ts). submitAnswer()
// then returns a `judge` request and marks the run as judging (the clock is paused); the caller
// asks the judge and finishes the try with applyVerdict(). The verdict is placed back into the
// bank before scoring, so a new spelling of a listed answer scores as that answer, and rules the
// bank states outright (exclusions, closed lists, required language) still win.

import { GAME, SCORING, depthFor, type GameConfig, type ScoringConfig } from './config';
import { failsNegative, isClosed, type ContentModel } from './content';
import { aiAnswerKey, buildJudgeRequest, readsAsRomanized, verdictKey, type JudgeRequest } from './judge';
import { matchAnswer, type MatchResult } from './matcher';
import { cleanInput, latinKey } from './normalize';
import { scoreAnswer, weightForFamiliarity, type PriorOptions } from './rarity';
import { randomId } from './rng';
import type { AiVerdict, AnswerRecord, AnswerStats, Attempt, Judging, MatchMethod, PromptDef, RunMode, RunState } from './types';

export interface EngineDeps {
  model: ContentModel;
  scoring?: ScoringConfig;
  game?: GameConfig;
  /** Observed answers for this prompt (this challenge), excluding the player being scored. */
  statsFor?: (promptId: string, index: number) => AnswerStats | null | undefined;
  /** Owner-approved answers that are not in the bank yet. */
  communityFor?: (promptId: string) => string[] | undefined;
  /** An AI judge can be asked right now. */
  aiAvailable?: boolean;
  /** A verdict already given for this answer to this prompt (shared cache): no need to ask again. */
  cachedVerdict?: (promptId: string, key: string) => AiVerdict | undefined;
  /**
   * An AI-accepted answer already scored for this prompt: reuse its familiarity so everyone who
   * gives it is scored alike. `blocked` = a moderator removed it.
   */
  aiAnswer?: (promptId: string, answerKey: string) => { familiarity: number; blocked?: boolean } | undefined;
}

export interface CreateRunOptions {
  mode: RunMode;
  challengeId: string;
  dateKey?: string;
  promptIds: string[];
  /** Seconds per prompt; null = untimed (practice option). */
  timerSec: number | null;
  now: number;
  runId?: string;
  contentVersion: string;
  scoringVersion?: string;
}

export function createRun(o: CreateRunOptions): RunState {
  if (!o.promptIds.length) throw new Error('A run needs at least one prompt');
  return {
    runId: o.runId ?? randomId('run_'),
    mode: o.mode,
    challengeId: o.challengeId,
    dateKey: o.dateKey,
    promptIds: o.promptIds.slice(),
    index: 0,
    phase: 'answering',
    openedAt: null,
    deadline: null,
    timerSec: o.timerSec,
    answers: [],
    tries: [],
    judging: null,
    aiChecks: 0,
    total: 0,
    startedAt: o.now,
    scoringVersion: o.scoringVersion ?? SCORING.version,
    contentVersion: o.contentVersion,
  };
}

/** Show the current prompt and start its clock. Re-opening an open prompt keeps its deadline. */
export function openPrompt(run: RunState, now: number, model?: ContentModel): RunState {
  if (run.phase !== 'answering' || run.openedAt !== null) return run;
  let timer = run.timerSec;
  if (timer !== null && model) {
    const p = model.prompt(run.promptIds[run.index]);
    if (p && p.timerSec && run.mode !== 'practice') timer = p.timerSec;
  }
  return { ...run, openedAt: now, deadline: timer === null ? null : now + timer * 1000 };
}

/** Time left on the current prompt. Frozen while the AI judge is thinking. */
export function remainingMs(run: RunState, now: number): number | null {
  if (run.deadline === null) return null;
  return Math.max(0, run.deadline - (run.judging ? run.judging.since : now));
}

export interface SubmitResult {
  run: RunState;
  /** The prompt is over: an accepted answer, or a timeout. */
  record?: AnswerRecord;
  /** A wrong try. The prompt stays open unless the penalty used up its clock (then `record` too). */
  attempt?: Attempt;
  /** The bank can't place the answer: ask the judge, then call applyVerdict(). */
  judge?: JudgeRequest;
  /** The verdict came from the shared cache (no AI call). */
  cached?: boolean;
  /** Why the submission was ignored (double submit, wrong phase, nothing typed...). */
  ignored?: 'not-answering' | 'already-answered' | 'not-open' | 'judging' | 'empty';
}

type RecordFields = Omit<AnswerRecord, 'index' | 'promptId' | 'totalAfter' | 'depthAfter' | 'tries'>;

/** Close the current prompt with this record. */
function finish(run: RunState, rec: RecordFields, scoring: ScoringConfig): SubmitResult {
  const total = run.total + rec.points;
  const full: AnswerRecord = {
    ...rec,
    index: run.index,
    promptId: run.promptIds[run.index],
    totalAfter: total,
    depthAfter: depthFor(total, scoring),
    ...(run.tries?.length ? { tries: run.tries } : {}),
  };
  return { run: { ...run, answers: [...run.answers, full], total, phase: 'revealing', judging: null }, record: full };
}

/** Record a wrong try: the prompt stays open, minus the penalty (plus any time the judge took). */
function wrongTry(
  run: RunState,
  attempt: Omit<Attempt, 'at' | 'penaltyMs'>,
  now: number,
  pausedMs: number,
  deps: EngineDeps,
  opts: { noPenalty?: boolean } = {},
): SubmitResult {
  const game = deps.game ?? GAME;
  const scoring = deps.scoring ?? SCORING;
  const opened = run.openedAt ?? now;
  const penalty = run.deadline === null || opts.noPenalty ? 0 : game.wrongTryPenaltyMs;
  const deadline = run.deadline === null ? null : run.deadline + pausedMs - penalty;
  const at = Math.max(0, (run.judging?.since ?? now) - opened);
  const tryRec: Attempt = { ...attempt, at, ...(penalty ? { penaltyMs: penalty } : {}) };
  const next: RunState = { ...run, deadline, judging: null, tries: [...(run.tries ?? []), tryRec] };
  if (deadline !== null && deadline <= now) {
    // The penalty used up the clock: the prompt ends here.
    const fin = finish(next, { input: '', status: 'timeout', points: 0, tier: 'none', elapsedMs: Math.max(0, deadline - opened), leftMs: 0 }, scoring);
    return { ...fin, attempt: tryRec };
  }
  return { run: next, attempt: tryRec };
}

interface Acceptance {
  /** Key the answer is counted under (entity key, community key or AI answer key). */
  key: string;
  /** Bank entity, when there is one. */
  entityKey: string | null;
  method: MatchMethod;
  name?: string;
  input: string;
  script: 'hangul' | 'latin';
  prior?: PriorOptions;
  ai?: AnswerRecord['ai'];
}

function accept(run: RunState, a: Acceptance, at: number, now: number, pausedMs: number, deps: EngineDeps): SubmitResult {
  const scoring = deps.scoring ?? SCORING;
  const game = deps.game ?? GAME;
  if (!game.allowEntityReuse && run.answers.some((x) => x.status === 'accepted' && x.entityKey === a.key)) {
    return wrongTry(run, { input: a.input, reason: 'duplicate', matchedName: a.name }, now, pausedMs, deps);
  }
  const promptId = run.promptIds[run.index];
  const stats = deps.statsFor?.(promptId, run.index) ?? null;
  const scored = scoreAnswer(deps.model, promptId, a.entityKey, stats, scoring, a.key, a.prior);
  return finish(
    run,
    {
      input: a.input,
      status: 'accepted',
      entityKey: a.key,
      matchedBy: a.method,
      matchedName: a.name,
      points: scored.points,
      tier: scored.tier,
      estimate: scored.estimate,
      elapsedMs: Math.max(0, at - (run.openedAt ?? at)),
      leftMs: run.deadline === null ? null : Math.max(0, run.deadline - at),
      script: a.script,
      ...(a.ai ? { ai: a.ai } : {}),
    },
    scoring,
  );
}

/** May an answer the bank rejected for this reason go to the AI judge? */
export function aiEligible(model: ContentModel, prompt: PromptDef, m: Pick<MatchResult, 'reason' | 'nearKey'>): boolean {
  switch (m.reason) {
    case 'not-found':
    case 'ambiguous':
      return true;
    case 'outside-category':
      return !isClosed(prompt);
    case 'wrong-fit':
      // A negative filter ("not spicy") is a rule, not a gap in the bank.
      return !isClosed(prompt) && !failsNegative(prompt, m.nearKey ? model.entity(m.nearKey) : undefined);
    default:
      // excluded, wrong-language, duplicate, empty: the bank's rules stand.
      return false;
  }
}

export function submitAnswer(run: RunState, input: string, now: number, deps: EngineDeps): SubmitResult {
  const scoring = deps.scoring ?? SCORING;
  const game = deps.game ?? GAME;
  if (run.phase !== 'answering') return { run, ignored: 'not-answering' };
  if (run.answers.length > run.index) return { run, ignored: 'already-answered' };
  if (run.openedAt === null) return { run, ignored: 'not-open' };
  if (run.judging) return { run, ignored: 'judging' };
  const promptId = run.promptIds[run.index];

  if (run.deadline !== null && now > run.deadline + game.lateGraceMs) {
    return finish(run, { input: cleanInput(input), status: 'timeout', reason: 'late', points: 0, tier: 'none', elapsedMs: Math.max(0, run.deadline - run.openedAt), leftMs: 0 }, scoring);
  }

  const m = matchAnswer(deps.model, promptId, input, { community: deps.communityFor?.(promptId) });
  if (m.reason === 'empty') return { run, ignored: 'empty' };

  if (m.ok) {
    const entity = m.entityKey ? deps.model.entity(m.entityKey) : undefined;
    const key = m.entityKey ?? `community:${promptId}:${latinKey(m.community ?? m.clean)}`;
    return accept(run, { key, entityKey: m.entityKey ?? null, method: m.method!, name: entity?.name ?? m.community, input: m.clean, script: m.script }, now, now, 0, deps);
  }

  const prompt = deps.model.prompt(promptId)!;
  if (aiEligible(deps.model, prompt, m)) {
    const judging: Judging = { input: m.clean, since: now, bank: { reason: m.reason!, nearKey: m.nearKey, candidates: m.candidates, script: m.script } };
    const cached = deps.cachedVerdict?.(promptId, verdictKey(promptId, m.clean));
    if (cached) return { ...applyVerdict({ ...run, judging }, cached, now, deps, { cached: true }), cached: true };
    if (deps.aiAvailable && (run.aiChecks ?? 0) < game.aiChecksPerPrompt) {
      return { run: { ...run, judging }, judge: buildJudgeRequest(deps.model, promptId, m.clean, judging.bank) };
    }
  }
  const near = m.nearKey ? deps.model.entity(m.nearKey) : undefined;
  return wrongTry(run, { input: m.clean, reason: m.reason!, matchedName: near?.name, explainKey: m.nearKey, candidates: m.candidates }, now, 0, deps);
}

type Placement = { kind: 'entity'; key: string } | { kind: 'excluded'; key: string } | { kind: 'closed' } | { kind: 'new' };

/** Where does the judge's answer sit in the bank? */
export function placeVerdict(model: ContentModel, prompt: PromptDef, v: AiVerdict, bank?: Judging['bank']): Placement {
  const rt = model.runtime(prompt.id);
  let outside: string | undefined;
  for (const text of [v.hangul, v.canonical]) {
    if (!text || !text.trim()) continue;
    const m = matchAnswer(model, prompt.id, text, { noFuzzy: true });
    if (m.ok && m.entityKey) return { kind: 'entity', key: m.entityKey };
    // The judge often names things in English: an English alias of an accepted answer is that answer.
    if (m.reason === 'wrong-language' && m.nearKey && rt.accepted.has(m.nearKey)) return { kind: 'entity', key: m.nearKey };
    if (m.reason === 'excluded' && m.nearKey) return { kind: 'excluded', key: m.nearKey };
    if (m.reason === 'wrong-fit' && m.nearKey && failsNegative(prompt, model.entity(m.nearKey))) return { kind: 'excluded', key: m.nearKey };
    if ((m.reason === 'wrong-fit' || m.reason === 'outside-category') && m.nearKey && !outside) outside = m.nearKey;
  }
  if (!outside && bank?.nearKey && (bank.reason === 'wrong-fit' || bank.reason === 'outside-category')) outside = bank.nearKey;
  if (isClosed(prompt)) return { kind: 'closed' };
  if (outside) return { kind: 'entity', key: outside };
  return { kind: 'new' };
}

export const NOTES = {
  closed: { en: 'This prompt has a fixed list of answers, and this is not one of them.', ko: '정답 목록이 정해진 문제이고, 이 답은 목록에 없습니다.' },
  blocked: { en: 'A moderator removed this answer.', ko: '운영자가 이 답을 제외했습니다.' },
  language: { en: 'This prompt wants the Korean word (Hangul or romanized).', ko: '이 문제는 한국어 낱말(한글이나 로마자)을 원합니다.' },
};

/**
 * Finish a try that went to the AI judge. `verdict` null = the judge could not be reached:
 * the try is rejected as the bank saw it, with no penalty and no AI check used.
 */
export function applyVerdict(run: RunState, verdict: AiVerdict | null, now: number, deps: EngineDeps, opts: { cached?: boolean } = {}): SubmitResult {
  const j = run.judging;
  if (!j || run.phase !== 'answering') return { run, ignored: 'not-answering' };
  const model = deps.model;
  const scoring = deps.scoring ?? SCORING;
  const promptId = run.promptIds[run.index];
  const prompt = model.prompt(promptId)!;
  const paused = Math.max(0, now - j.since);
  const near = j.bank.nearKey ? model.entity(j.bank.nearKey) : undefined;
  const base = { input: j.input, explainKey: j.bank.nearKey, matchedName: near?.name, candidates: j.bank.candidates };

  if (!verdict) return wrongTry(run, { ...base, reason: j.bank.reason }, now, paused, deps, { noPenalty: true });

  const counted: RunState = opts.cached ? run : { ...run, aiChecks: (run.aiChecks ?? 0) + 1 };
  const rejectAi = (aiNote: { en: string; ko: string }, name?: string) =>
    wrongTry(counted, { ...base, reason: 'ai-rejected', aiNote, matchedName: name ?? base.matchedName }, now, paused, deps);

  if (verdict.verdict !== 'valid') return rejectAi(verdict.reason, verdict.canonical || undefined);

  // A Korean-word prompt: Latin input must read as the romanized word, not a translation.
  if (!prompt.accept.includes('en') && j.bank.script === 'latin' && !readsAsRomanized(j.input, verdict)) {
    return wrongTry(counted, { ...base, reason: 'wrong-language', aiNote: NOTES.language, matchedName: verdict.canonical || undefined }, now, paused, deps);
  }

  const ai: AnswerRecord['ai'] = { canonical: verdict.canonical, ...(verdict.hangul ? { hangul: verdict.hangul } : {}), familiarity: verdict.familiarity, reason: verdict.reason, ...(verdict.by ? { by: verdict.by } : {}) };
  const place = placeVerdict(model, prompt, verdict, j.bank);
  if (place.kind === 'excluded') {
    return wrongTry(counted, { ...base, reason: 'excluded', explainKey: place.key, matchedName: model.entity(place.key)?.name }, now, paused, deps);
  }
  if (place.kind === 'closed') return rejectAi(NOTES.closed, verdict.canonical || undefined);

  if (place.kind === 'entity') {
    const e = model.entity(place.key)!;
    const inSet = model.runtime(promptId).accepted.has(e.key);
    // A listed answer scores as itself; a known entry the bank didn't list here keeps its own familiarity.
    const prior: PriorOptions = inSet ? {} : { weight: weightForFamiliarity(model.famFor(prompt, e), scoring) };
    return accept(counted, { key: e.key, entityKey: e.key, method: 'ai', name: e.name, input: j.input, script: j.bank.script, prior, ai }, j.since, now, paused, deps);
  }

  // A new answer the bank doesn't have.
  const key = aiAnswerKey(verdict);
  const known = deps.aiAnswer?.(promptId, key);
  if (known?.blocked) return rejectAi(NOTES.blocked, verdict.canonical || undefined);
  const familiarity = known?.familiarity ?? verdict.familiarity;
  return accept(
    counted,
    {
      key,
      entityKey: null,
      method: 'ai',
      name: verdict.canonical || verdict.hangul,
      input: j.input,
      script: j.bank.script,
      prior: { weight: weightForFamiliarity(familiarity, scoring), ai: true },
      ai: { ...ai, familiarity },
    },
    j.since,
    now,
    paused,
    deps,
  );
}

/** Record a timeout once the clock runs out. Safe to call repeatedly; ignored while judging. */
export function expirePrompt(run: RunState, now: number, deps: { scoring?: ScoringConfig }): SubmitResult {
  const scoring = deps.scoring ?? SCORING;
  if (run.phase !== 'answering' || run.answers.length > run.index) return { run, ignored: 'not-answering' };
  if (run.judging) return { run, ignored: 'judging' };
  if (run.deadline === null || run.openedAt === null || now < run.deadline) return { run, ignored: 'not-open' };
  return finish(run, { input: '', status: 'timeout', points: 0, tier: 'none', elapsedMs: run.deadline - run.openedAt, leftMs: 0 }, scoring);
}

/** Give up on the current prompt (0 points). */
export function skipPrompt(run: RunState, now: number, deps: { scoring?: ScoringConfig }): SubmitResult {
  const scoring = deps.scoring ?? SCORING;
  if (run.phase !== 'answering' || run.answers.length > run.index || run.openedAt === null) return { run, ignored: 'not-answering' };
  if (run.judging) return { run, ignored: 'judging' };
  const left = run.deadline === null ? null : Math.max(0, run.deadline - now);
  return finish(run, { input: '', status: 'timeout', reason: 'skipped', points: 0, tier: 'none', elapsedMs: Math.max(0, now - run.openedAt), leftMs: left }, scoring);
}

/** Leave the reveal: go to the next prompt, or finish after the last one. */
export function advance(run: RunState, now: number): RunState {
  if (run.phase !== 'revealing') return run;
  const index = run.index + 1;
  if (index >= run.promptIds.length) return { ...run, index: run.promptIds.length - 1, phase: 'done', finishedAt: now, tries: [], judging: null };
  return { ...run, index, phase: 'answering', openedAt: null, deadline: null, tries: [], judging: null, aiChecks: 0 };
}

export function isComplete(run: RunState): boolean {
  return run.phase === 'done' && run.answers.length === run.promptIds.length;
}
