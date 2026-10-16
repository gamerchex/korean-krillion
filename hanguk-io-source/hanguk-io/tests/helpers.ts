// Shared test helpers: compile the real content bank from source (so tests never run against
// a stale build) plus a tiny hand-made fixture whose numbers are easy to check by hand.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileContent, type CompileOutput, type RawPrompt } from '../src/core/compile';
import { GAME } from '../src/core/config';
import { ContentModel } from '../src/core/content';
import type { CategoryId } from '../src/core/types';

export const ROOT = join(import.meta.dirname, '..');

export function loadSources() {
  const poolDir = join(ROOT, 'content/pools');
  const promptDir = join(ROOT, 'content/prompts');
  const pools = readdirSync(poolDir)
    .filter((f) => f.endsWith('.psv'))
    .sort()
    .map((f) => ({ file: `pools/${f}`, text: readFileSync(join(poolDir, f), 'utf8') }));
  const prompts = readdirSync(promptDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: `prompts/${f}`,
      category: basename(f, '.json') as CategoryId,
      items: JSON.parse(readFileSync(join(promptDir, f), 'utf8')) as RawPrompt[],
    }));
  return { pools, prompts };
}

let realCache: { out: CompileOutput; model: ContentModel } | null = null;

/** The real content bank, compiled once per test process. */
export function real() {
  if (!realCache) {
    const { pools, prompts } = loadSources();
    const out = compileContent({ pools, prompts, epoch: GAME.epoch, minAnswersForDaily: GAME.minAnswersForDaily });
    realCache = { out, model: new ContentModel(out.content) };
  }
  return realCache;
}

/**
 * Fixture: one pool, a handful of answers with known familiarity.
 *   weights (famBase 6): fam6 = 7776, fam4 = 216, fam3 = 36, fam2 = 6, fam1 = 1
 */
export const FIXTURE_POOL = `# pool: fx
# title: Fixture | 픽스처
# category: food
# source: test fixture
## tags: dish
Kimchi | 김치 | 6 | spicy | ~fermented cabbage | The obvious one.
Bulgogi | 불고기 | 4 | | ~fire meat |
Japchae | 잡채 | 3 | | chapchae |
Gimpo bread | 김포빵 | 2 | | |
Gimje bread | 김제빵 | 2 | | |
Hongeo-hoe | 홍어회 | 1 | spicy | |
## tags: drink
Soju | 소주 | 6 | | sooju |
Makgeolli | 막걸리 | 5 | | makkoli |
## tags: word
Hana | 하나 | 5 | | ~one |
Dul | 둘 | 5 | | ~two |
Set | 셋 | 4 | | ~three |
Net | 넷 | 4 | | ~four |
`;

export const FIXTURE_PROMPTS: RawPrompt[] = [
  { id: 'fx-dish', en: 'Name a dish', ko: '음식', pools: 'fx', any: ['dish'], d: 1 },
  { id: 'fx-dish-2', en: 'Name another dish', ko: '음식 2', pools: 'fx', any: ['dish'], d: 2 },
  { id: 'fx-not-kimchi', en: 'Name a dish that is not kimchi', ko: '김치 말고', pools: 'fx', any: ['dish'], exc: ['kimchi'], d: 2 },
  { id: 'fx-spicy', en: 'Name a spicy dish', ko: '매운 음식', pools: 'fx', any: ['spicy'], d: 3 },
  { id: 'fx-word', en: 'Say a number in Korean', ko: '수', pools: 'fx', any: ['word'], acc: ['ko', 'rr'], d: 1 },
  { id: 'fx-drink', en: 'Name a drink', ko: '술', pools: 'fx', any: ['drink'], d: 2 },
  { id: 'fx-capped', en: 'Name a dish (max 50)', ko: '음식 (최대 50점)', pools: 'fx', any: ['dish'], max: 50, d: 3 },
  { id: 'fx-not-spicy', en: 'Name a dish that is not spicy', ko: '안 매운 음식', pools: 'fx', any: ['dish'], not: ['spicy'], d: 2 },
  { id: 'fx-closed', en: 'Name one of these drinks', ko: '이 술 중 하나', pools: 'fx', any: ['drink'], closed: true, d: 1 },
];

export function fixture(prompts: RawPrompt[] = FIXTURE_PROMPTS) {
  const out = compileContent({
    pools: [{ file: 'fixture.psv', text: FIXTURE_POOL }],
    prompts: [{ file: 'fixture.json', category: 'food', items: prompts }],
    epoch: GAME.epoch,
    minAnswersForDaily: 1,
  });
  return { out, model: new ContentModel(out.content) };
}

/** A controllable clock for engine tests. */
export function clock(start = Date.UTC(2026, 9, 11, 3, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
      return t;
    },
  };
}
