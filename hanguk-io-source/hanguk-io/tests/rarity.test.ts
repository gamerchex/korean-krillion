import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SCORING, makeScoring } from '../src/core/config';
import { confidenceFor, estimateRarity, pointsFor, priorProbability, promptScoreProfile, scoreAnswer, tierFor } from '../src/core/rarity';
import { fixture } from './helpers';

// Weights for fx-dish: kimchi 7776, bulgogi 216, japchae 36, gimpo 6, gimje 6, hongeo 1 = 8041
const TOTAL = 7776 + 216 + 36 + 6 + 6 + 1;

describe('points formula S(p) = clamp(round(25 * log10(1/p)), 1, 100)', () => {
  it('matches hand-computed values', () => {
    assert.equal(pointsFor(1), 1); // a valid answer never earns zero
    assert.equal(pointsFor(0.5), 8);
    assert.equal(pointsFor(0.1), 25);
    assert.equal(pointsFor(0.01), 50);
    assert.equal(pointsFor(0.001), 75);
    assert.equal(pointsFor(0.0001), 100);
  });
  it('caps at the maximum', () => {
    assert.equal(pointsFor(1e-9), 100);
    assert.equal(pointsFor(0), 100);
    assert.equal(pointsFor(1e-9, SCORING, 50), 50);
  });
  it('follows the configured constant', () => {
    assert.equal(pointsFor(0.01, makeScoring({ k: 10 })), 20);
  });
});

describe('tiers', () => {
  const cases: Array<[number, string]> = [
    [0, 'common'], [1, 'common'], [19, 'common'], [20, 'uncommon'], [39, 'uncommon'], [40, 'rare'], [59, 'rare'],
    [60, 'very-rare'], [79, 'very-rare'], [80, 'extremely-rare'], [99, 'extremely-rare'], [100, 'legendary'],
  ];
  for (const [pts, tier] of cases) it(`${pts} points -> ${tier}`, () => assert.equal(tierFor(pts, true), tier));
  it('invalid answers have no tier', () => assert.equal(tierFor(55, false), 'none'));
});

describe('curated prior (Method B)', () => {
  const { model } = fixture();
  it('is the familiarity weight share', () => {
    assert.ok(Math.abs(priorProbability(model, 'fx-dish', 'fx:kimchi') - 7776 / TOTAL) < 1e-12);
    assert.ok(Math.abs(priorProbability(model, 'fx-dish', 'fx:hongeo-hoe') - 1 / TOTAL) < 1e-12);
  });
  it('scores the obvious answer low and the obscure one high', () => {
    assert.equal(scoreAnswer(model, 'fx-dish', 'fx:kimchi').points, 1);
    assert.equal(scoreAnswer(model, 'fx-dish', 'fx:bulgogi').points, Math.round(25 * Math.log10(TOTAL / 216)));
    assert.equal(scoreAnswer(model, 'fx-dish', 'fx:hongeo-hoe').points, 98);
    assert.equal(scoreAnswer(model, 'fx-dish', 'fx:hongeo-hoe').tier, 'extremely-rare');
  });
  it('honours a prompt maximum', () => {
    assert.equal(scoreAnswer(model, 'fx-capped', 'fx:hongeo-hoe').points, 50);
  });
  it('labels curated estimates as curated', () => {
    const e = estimateRarity(model, 'fx-dish', 'fx:japchae', null);
    assert.equal(e.source, 'curated');
    assert.equal(e.confidence, 'curated');
    assert.equal(e.sampleSize, 0);
  });
  it('treats community answers as the rarest tier', () => {
    assert.ok(Math.abs(priorProbability(model, 'fx-dish', null) - 1 / (TOTAL + 1)) < 1e-12);
  });
  it('profiles a prompt', () => {
    const prof = promptScoreProfile(model, 'fx-dish');
    assert.equal(prof.answers, 6);
    assert.equal(prof.min, 1);
    assert.equal(prof.max, 98);
    assert.equal(prof.top[0].name, 'Kimchi');
  });
});

describe('observed data (Method A) with small-sample protection', () => {
  const { model } = fixture();
  const prior = priorProbability(model, 'fx-dish', 'fx:japchae');

  it('ignores observations below the minimum sample', () => {
    const e = estimateRarity(model, 'fx-dish', 'fx:japchae', { valid: 24, eligible: 30, counts: { 'fx:japchae': 24 } });
    assert.equal(e.source, 'curated');
    assert.equal(e.p, prior);
    assert.equal(e.confidence, 'low');
  });
  it('blends observations with the prior once the sample is big enough', () => {
    const stats = { valid: 100, eligible: 120, counts: { 'fx:japchae': 50 } };
    const e = estimateRarity(model, 'fx-dish', 'fx:japchae', stats);
    assert.equal(e.source, 'blended');
    assert.ok(Math.abs(e.p - (50 + 100 * prior) / 200) < 1e-12);
    assert.equal(e.confidence, 'medium');
  });
  it('an answer nobody else gave stays rare but not infinitely so', () => {
    const e = estimateRarity(model, 'fx-dish', 'fx:hongeo-hoe', { valid: 400, eligible: 400, counts: { 'fx:kimchi': 400 } });
    assert.ok(e.p > 0);
    assert.equal(e.confidence, 'high');
    assert.equal(pointsFor(e.p), 100);
  });
  it('reports confidence by sample size', () => {
    assert.equal(confidenceFor(0), 'curated');
    assert.equal(confidenceFor(10), 'low');
    assert.equal(confidenceFor(59), 'low');
    assert.equal(confidenceFor(60), 'medium');
    assert.equal(confidenceFor(300), 'high');
  });
});
