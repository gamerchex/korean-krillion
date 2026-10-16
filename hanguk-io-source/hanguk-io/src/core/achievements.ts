// Original achievement set. Each check runs after a completed dive against the updated profile.

import type { Profile } from './profile';
import type { RunSummary } from './results';
import type { RunState } from './types';

export interface AchievementDef {
  id: string;
  name: { en: string; ko: string };
  desc: { en: string; ko: string };
  check: (ctx: { profile: Profile; summary: RunSummary; run: RunState; streak: number }) => boolean;
}

const depthAtLeast = (m: number) => (c: { summary: RunSummary }) => c.summary.depth >= m;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-dive', name: { en: 'First Splash', ko: '첫 입수' }, desc: { en: 'Finish your first dive.', ko: '첫 잠수를 마치세요.' }, check: () => true },
  { id: 'depth-200', name: { en: 'Sunlight Behind You', ko: '햇빛과 작별' }, desc: { en: 'Sink past 200 m in one dive.', ko: '한 번의 잠수로 200m를 넘으세요.' }, check: depthAtLeast(200) },
  { id: 'depth-1000', name: { en: 'Lights Out', ko: '빛이 꺼진 곳' }, desc: { en: 'Reach the midnight zone (1,000 m).', ko: '한밤의 바다(1,000m)에 닿으세요.' }, check: depthAtLeast(1000) },
  { id: 'depth-2500', name: { en: 'Pressure Rising', ko: '수압 상승' }, desc: { en: 'Reach 2,500 m.', ko: '2,500m에 닿으세요.' }, check: depthAtLeast(2500) },
  { id: 'depth-4000', name: { en: 'Abyssal Plain', ko: '심연 평원' }, desc: { en: 'Reach the abyssal zone (4,000 m).', ko: '심연(4,000m)에 닿으세요.' }, check: depthAtLeast(4000) },
  { id: 'depth-6000', name: { en: 'Trench Walker', ko: '해구 보행자' }, desc: { en: 'Enter the hadal trench (6,000 m).', ko: '해구(6,000m)에 들어가세요.' }, check: depthAtLeast(6000) },
  { id: 'depth-7000', name: { en: 'Guest of Yonggung', ko: '용궁의 손님' }, desc: { en: 'A perfect 7,000 m dive.', ko: '완벽한 7,000m 잠수.' }, check: depthAtLeast(7000) },
  {
    id: 'full-house', name: { en: 'Seven for Seven', ko: '일곱 개 모두' }, desc: { en: 'Get all seven answers accepted in one dive.', ko: '한 번의 잠수에서 일곱 답을 모두 인정받으세요.' },
    check: ({ summary }) => summary.answers.length >= 7 && summary.accepted === summary.answers.length,
  },
  { id: 'deep-cut', name: { en: 'Deep Cut', ko: '깊은 한 수' }, desc: { en: 'Find an answer worth 80+ points.', ko: '80점 이상의 답을 찾으세요.' }, check: ({ summary }) => summary.answers.some((a) => a.points >= 80) },
  { id: 'legendary', name: { en: 'Needle in the Sea', ko: '바다 속 바늘' }, desc: { en: 'Find a 100-point answer.', ko: '100점짜리 답을 찾으세요.' }, check: ({ summary }) => summary.answers.some((a) => a.points >= 100) },
  { id: 'hangul-hand', name: { en: 'Hangul Hand', ko: '한글 손글씨' }, desc: { en: 'Get an answer accepted typed in Hangul.', ko: '한글로 입력한 답을 인정받으세요.' }, check: ({ run }) => run.answers.some((a) => a.status === 'accepted' && a.script === 'hangul') },
  {
    id: 'bilingual', name: { en: 'Two Scripts', ko: '두 개의 문자' }, desc: { en: 'Answer in both Hangul and the Latin alphabet in one dive.', ko: '한 번의 잠수에서 한글과 로마자 답을 모두 쓰세요.' },
    check: ({ run }) => {
      const ok = run.answers.filter((a) => a.status === 'accepted');
      return ok.some((a) => a.script === 'hangul') && ok.some((a) => a.script === 'latin');
    },
  },
  { id: 'quick-draw', name: { en: 'Quick Draw', ko: '순발력' }, desc: { en: 'Get an answer accepted in under 4 seconds.', ko: '4초 안에 답을 인정받으세요.' }, check: ({ run }) => run.answers.some((a) => a.status === 'accepted' && a.elapsedMs < 4000) },
  {
    id: 'buzzer-beater', name: { en: 'Last Breath', ko: '마지막 숨' }, desc: { en: 'Get an answer accepted with under 2 seconds left.', ko: '2초도 안 남기고 답을 인정받으세요.' },
    check: ({ run }) =>
      run.timerSec !== null &&
      run.answers.some((a) => a.status === 'accepted' && (typeof a.leftMs === 'number' ? a.leftMs : (run.timerSec ?? 20) * 1000 - a.elapsedMs) < 2000),
  },
  {
    id: 'second-wind', name: { en: 'Second Wind', ko: '다시 한 번' }, desc: { en: 'Get an answer accepted after a wrong try.', ko: '틀린 뒤 다시 시도해서 답을 인정받으세요.' },
    check: ({ run }) => run.answers.some((a) => a.status === 'accepted' && (a.tries?.length ?? 0) > 0),
  },
  {
    id: 'clean-sweep', name: { en: 'Clean Sweep', ko: '한 번에 일곱' }, desc: { en: 'Seven answers accepted, each on the first try.', ko: '일곱 답 모두 첫 시도에 인정받으세요.' },
    check: ({ run }) => run.answers.length >= 7 && run.answers.every((a) => a.status === 'accepted' && !(a.tries?.length)),
  },
  {
    id: 'uncharted', name: { en: 'Uncharted Waters', ko: '지도에 없는 바다' }, desc: { en: 'Get an answer the answer bank did not know accepted by the AI judge.', ko: '답안 은행에 없던 답을 AI 심판에게 인정받으세요.' },
    check: ({ run }) => run.answers.some((a) => a.status === 'accepted' && a.matchedBy === 'ai' && (a.entityKey ?? '').startsWith('ai:')),
  },
  { id: 'kimchi', name: { en: 'Kimchi Classic', ko: '김치는 진리' }, desc: { en: 'Answer "kimchi" somewhere it counts.', ko: '인정되는 곳에서 "김치"라고 답하세요.' }, check: ({ run }) => run.answers.some((a) => a.status === 'accepted' && a.entityKey === 'food:kimchi') },
  { id: 'streak-3', name: { en: 'Three Tides', ko: '세 번의 물때' }, desc: { en: 'Finish the daily dive three days in a row.', ko: '사흘 연속 오늘의 잠수를 마치세요.' }, check: ({ streak }) => streak >= 3 },
  { id: 'streak-7', name: { en: 'A Week Underwater', ko: '일주일 잠수' }, desc: { en: 'A seven-day daily streak.', ko: '7일 연속 기록.' }, check: ({ streak }) => streak >= 7 },
  { id: 'streak-30', name: { en: 'Month of Tides', ko: '한 달의 물때' }, desc: { en: 'A thirty-day daily streak.', ko: '30일 연속 기록.' }, check: ({ streak }) => streak >= 30 },
  { id: 'archivist', name: { en: 'Wreck Diver', ko: '난파선 탐사' }, desc: { en: 'Finish a dive from the archive.', ko: '지난 잠수 하나를 마치세요.' }, check: ({ summary }) => summary.mode === 'archive' },
  { id: 'practice-10', name: { en: 'Practice Laps', ko: '연습 바퀴' }, desc: { en: 'Finish ten practice dives.', ko: '연습 잠수를 열 번 마치세요.' }, check: ({ profile }) => profile.practice.runs >= 10 },
  {
    id: 'all-rounder', name: { en: 'Twelve Currents', ko: '열두 갈래 해류' }, desc: { en: 'Land accepted answers in all twelve categories.', ko: '열두 분야 모두에서 답을 인정받으세요.' },
    check: ({ profile }) => Object.values(profile.categoriesHit).filter((n) => (n ?? 0) > 0).length >= 12,
  },
  {
    id: 'no-small-fish', name: { en: 'No Small Fish', ko: '잔챙이는 없다' }, desc: { en: 'Every answer in a dive scores 20+.', ko: '한 번의 잠수에서 모든 답이 20점 이상.' },
    check: ({ summary }) => summary.answers.length >= 7 && summary.answers.every((a) => a.points >= 20),
  },
  {
    id: 'off-the-map', name: { en: 'Off the Map', ko: '지도 밖으로' }, desc: { en: 'Every answer in a dive scores 40+.', ko: '한 번의 잠수에서 모든 답이 40점 이상.' },
    check: ({ summary }) => summary.answers.length >= 7 && summary.answers.every((a) => a.points >= 40),
  },
  {
    id: 'late-bloomer', name: { en: 'Late Bloomer', ko: '늦깎이' }, desc: { en: 'Save your best answer (40+) for the last prompt.', ko: '가장 좋은 답(40점 이상)을 마지막 문제에서.' },
    check: ({ summary }) => {
      const pts = summary.answers.map((a) => a.points);
      const last = pts[pts.length - 1] ?? 0;
      return pts.length >= 5 && last >= 40 && pts.slice(0, -1).every((p) => p < last);
    },
  },
  { id: 'reporter', name: { en: 'Second Opinion', ko: '다시 봐 주세요' }, desc: { en: 'Send an answer to the review queue.', ko: '답 하나를 검토 대기열에 보내세요.' }, check: ({ profile }) => profile.reportsFiled > 0 },
];

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
