// Rarity model (see docs/SCORING.md).
//
//   prior      p0(a) = w(a) / sum(w),   w = famBase^(fam - 1)        curated estimate (Method B)
//   blended    p(a)  = (n_a + alpha * p0(a)) / (N + alpha)           real data (Method A), only once N >= minSample
//   points     S(p)  = clamp(round(k * log10(1 / p)), minValid, max)
//
// n_a and N never include the player being scored, so the first person to find a rare
// answer is not penalised by their own submission.

import { SCORING, type ScoringConfig, type TierDef } from './config';
import type { ContentModel } from './content';
import type { AnswerStats, Confidence, RarityEstimate, TierId } from './types';

/** Options for answers that are not in the prompt's curated set. */
export interface PriorOptions {
  /**
   * Prior weight for an answer outside the prompt's accepted set: an entry the AI judge
   * accepted for this prompt, or a brand-new answer (weight from the judge's familiarity).
   * Community-approved answers default to 1, the rarest curated grade.
   */
  weight?: number;
  /** The prior came from the AI judge's familiarity estimate. */
  ai?: boolean;
}

export function weightForFamiliarity(fam: number, cfg: ScoringConfig = SCORING): number {
  return Math.pow(cfg.famBase, Math.max(1, Math.min(6, Math.round(fam))) - 1);
}

export function priorProbability(model: ContentModel, promptId: string, entityKey: string | null, opts: PriorOptions = {}): number {
  const rt = model.runtime(promptId);
  if (rt.totalWeight <= 0) return 1;
  const inSet = !!entityKey && rt.weights.has(entityKey);
  const w = inSet ? rt.weights.get(entityKey!)! : opts.weight ?? 1;
  return w / (rt.totalWeight + (inSet ? 0 : w));
}

export function confidenceFor(n: number, cfg: ScoringConfig = SCORING): Confidence {
  if (n < cfg.minSampleForBlend) return n === 0 ? 'curated' : 'low';
  if (n < cfg.confidenceHigh) return n < cfg.confidenceMedium ? 'low' : 'medium';
  return 'high';
}

export function estimateRarity(
  model: ContentModel,
  promptId: string,
  entityKey: string | null,
  stats?: AnswerStats | null,
  cfg: ScoringConfig = SCORING,
  countKey?: string,
  opts: PriorOptions = {},
): RarityEstimate {
  const prior = priorProbability(model, promptId, entityKey, opts);
  const n = stats?.valid ?? 0;
  if (!stats || n < cfg.minSampleForBlend) {
    return { p: prior, prior, source: opts.ai ? 'ai' : 'curated', confidence: confidenceFor(n, cfg), sampleSize: n };
  }
  const count = stats.counts[countKey ?? entityKey ?? ''] ?? 0;
  const alpha = cfg.priorStrength;
  const p = (count + alpha * prior) / (n + alpha);
  return { p, prior, source: 'blended', confidence: confidenceFor(n, cfg), sampleSize: n };
}

export function pointsFor(p: number, cfg: ScoringConfig = SCORING, maxPoints = cfg.maxPoints): number {
  if (!(p > 0)) return Math.min(maxPoints, cfg.maxPoints);
  const raw = Math.round(cfg.k * Math.log10(1 / Math.min(1, p)));
  return Math.max(cfg.minValidPoints, Math.min(maxPoints, cfg.maxPoints, raw));
}

export function tierFor(points: number, valid: boolean, cfg: ScoringConfig = SCORING): TierId {
  if (!valid) return 'none';
  const t = cfg.tiers.find((tier: TierDef) => points >= tier.min && points <= tier.max);
  return t ? t.id : points >= cfg.maxPoints ? 'legendary' : 'common';
}

export const TIER_ORDER: TierId[] = ['none', 'common', 'uncommon', 'rare', 'very-rare', 'extremely-rare', 'legendary'];

/** Score a valid answer end to end. */
export function scoreAnswer(
  model: ContentModel,
  promptId: string,
  entityKey: string | null,
  stats?: AnswerStats | null,
  cfg: ScoringConfig = SCORING,
  countKey?: string,
  opts: PriorOptions = {},
): { points: number; tier: TierId; estimate: RarityEstimate } {
  const prompt = model.prompt(promptId);
  const estimate = estimateRarity(model, promptId, entityKey, stats, cfg, countKey, opts);
  const points = pointsFor(estimate.p, cfg, prompt?.maxPoints ?? cfg.maxPoints);
  return { points, tier: tierFor(points, true, cfg), estimate };
}

/** Distribution summary used by the content report and the "how scoring works" panel. */
export function promptScoreProfile(model: ContentModel, promptId: string, cfg: ScoringConfig = SCORING) {
  const rt = model.runtime(promptId);
  const scores = rt.acceptedList
    .map((e) => ({ key: e.key, name: e.name, points: pointsFor(rt.weights.get(e.key)! / rt.totalWeight, cfg) }))
    .sort((a, b) => a.points - b.points);
  const pts = scores.map((s) => s.points);
  const median = pts.length ? pts[Math.floor(pts.length / 2)] : 0;
  return {
    answers: scores.length,
    min: pts[0] ?? 0,
    max: pts[pts.length - 1] ?? 0,
    median,
    top: scores.slice(0, 3),
    legendary: scores.filter((s) => s.points >= cfg.maxPoints).length,
  };
}
