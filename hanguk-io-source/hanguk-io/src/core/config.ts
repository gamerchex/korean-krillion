import type { TierId } from './types';

// ---------------------------------------------------------------------------
// Scoring model (documented in docs/SCORING.md). Every completed run records
// `version`, so a later recalibration never silently changes an old result.
// ---------------------------------------------------------------------------

export interface TierDef {
  id: Exclude<TierId, 'none'>;
  min: number;
  max: number;
}

export interface ScoringConfig {
  version: string;
  /** S(p) = clamp(round(k * log10(1 / p)), minValidPoints, maxPoints) */
  k: number;
  maxPoints: number;
  /** A valid answer always earns at least this much. */
  minValidPoints: number;
  /** Curated prior weight for familiarity f is famBase^(f - 1). */
  famBase: number;
  /** Bayesian pseudo-count: how many "virtual players" the curated prior is worth. */
  priorStrength: number;
  /** Below this many observed valid answers, real data is recorded but not used. */
  minSampleForBlend: number;
  confidenceMedium: number;
  confidenceHigh: number;
  metersPerPoint: number;
  tiers: TierDef[];
}

export const SCORING: ScoringConfig = {
  version: 'rarity-v1',
  k: 25,
  maxPoints: 100,
  minValidPoints: 1,
  famBase: 6,
  priorStrength: 100,
  minSampleForBlend: 25,
  confidenceMedium: 60,
  confidenceHigh: 300,
  metersPerPoint: 10,
  tiers: [
    { id: 'common', min: 0, max: 19 },
    { id: 'uncommon', min: 20, max: 39 },
    { id: 'rare', min: 40, max: 59 },
    { id: 'very-rare', min: 60, max: 79 },
    { id: 'extremely-rare', min: 80, max: 99 },
    { id: 'legendary', min: 100, max: 100 },
  ],
};

export function makeScoring(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return { ...SCORING, ...overrides, tiers: overrides.tiers ?? SCORING.tiers };
}

// ---------------------------------------------------------------------------
// Game rules
// ---------------------------------------------------------------------------

export interface GameConfig {
  promptsPerDaily: number;
  defaultTimerSec: number;
  /** Network/render slack after the deadline before an answer counts as late. */
  lateGraceMs: number;
  /** Official dailies roll over at midnight in this fixed offset (KST, no DST). */
  utcOffsetMinutes: number;
  timezoneLabel: string;
  /** First official challenge date (Dive #1). */
  epoch: string;
  selectionVersion: string;
  /** A prompt needs at least this many accepted answers to appear in a daily. */
  minAnswersForDaily: number;
  /** Days before a prompt may repeat in the official schedule. */
  cooldownDays: number;
  /**
   * `npm run content` freezes the official schedule this many days past today (KST) into
   * content/schedule.lock.json, so content edits never change a published or imminent dive,
   * even for players still running an older build.
   */
  publishAheadDays: number;
  /** Difficulty mix for the seven daily prompts, in play order. */
  difficultyPlan: Array<1 | 2 | 3>;
  /** When false, an answer can only be used once per dive. */
  allowEntityReuse: boolean;
  /** A wrong try keeps the prompt open but costs this much of its clock. */
  wrongTryPenaltyMs: number;
  /** Answers the bank can't place that may go to the AI judge, per prompt. */
  aiChecksPerPrompt: number;
}

export const GAME: GameConfig = {
  promptsPerDaily: 7,
  defaultTimerSec: 20,
  lateGraceMs: 800,
  utcOffsetMinutes: 9 * 60,
  timezoneLabel: 'KST (Asia/Seoul)',
  epoch: '2026-10-04',
  selectionVersion: 'select-v1',
  minAnswersForDaily: 12,
  cooldownDays: 30,
  publishAheadDays: 14,
  difficultyPlan: [1, 1, 2, 2, 2, 3, 3],
  allowEntityReuse: false,
  wrongTryPenaltyMs: 2000,
  aiChecksPerPrompt: 3,
};

// ---------------------------------------------------------------------------
// Ocean zones. Depth (m) = metersPerPoint * total points; 700 points = 7,000 m.
// ---------------------------------------------------------------------------

export interface ZoneDef {
  id: 'surface' | 'twilight' | 'midnight' | 'abyssal' | 'hadal';
  min: number;
  max: number;
  name: { en: string; ko: string };
}

export const ZONES: ZoneDef[] = [
  { id: 'surface', min: 0, max: 200, name: { en: 'Surface waters', ko: '햇빛의 바다' } },
  { id: 'twilight', min: 200, max: 1000, name: { en: 'Twilight zone', ko: '어스름의 바다' } },
  { id: 'midnight', min: 1000, max: 4000, name: { en: 'Midnight zone', ko: '한밤의 바다' } },
  { id: 'abyssal', min: 4000, max: 6000, name: { en: 'Abyssal zone', ko: '심연' } },
  { id: 'hadal', min: 6000, max: 7000, name: { en: 'Hadal zone', ko: '해구' } },
];

export const MAX_DEPTH_M = 7000;

export function zoneFor(depthM: number): ZoneDef {
  for (const z of ZONES) if (depthM < z.max) return z;
  return ZONES[ZONES.length - 1];
}

export function depthFor(points: number, scoring: ScoringConfig = SCORING): number {
  return points * scoring.metersPerPoint;
}
