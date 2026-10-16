// The app context handed to every screen (plain props, no global store).

import type { ContentModel } from '../core/content';
import type { Scheduler } from '../core/daily';
import type { BoardDoc } from '../core/leaderboard';
import type { Profile, Settings } from '../core/profile';
import type { RunSummary } from '../core/results';
import type { CategoryId, RunState } from '../core/types';
import type { AudioEngine } from './audio';
import type { OceanScene } from './art/ocean';
import type { StringKey, UiLang } from './i18n';
import type { ServerConn } from './driver';
import type { Approved, Platform } from './platform';
import type { AiService, AiStatus } from './ai';

export type Screen =
  | { id: 'home' }
  | { id: 'dive'; run: RunState }
  | { id: 'results'; summary: RunSummary; unlocked: string[]; publish?: 'published' | 'refused' | 'unavailable' | 'pending'; run?: RunState }
  | { id: 'practice' }
  | { id: 'archive' }
  | { id: 'board' }
  | { id: 'howto' }
  | { id: 'settings' }
  | { id: 'records' }
  | { id: 'review' };

export interface Ctx {
  model: ContentModel;
  sched: Scheduler;
  profile: Profile;
  settings: Settings;
  lang: UiLang;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  platform: Platform;
  /** Set when the page is served by the HAN-GUK.IO reference server. */
  server: ServerConn | null;
  /** AI answer checking: where it runs and whether it is ready. */
  ai: AiStatus;
  aiService: AiService;
  /** Re-read the stored API key (standalone page) and reconfigure the judge. */
  refreshAi: () => void;
  storage: 'cloud' | 'local' | 'none';
  boards: Map<string, BoardDoc> | null;
  approved: Approved;
  now: () => number;
  todayKey: string;
  nav: (s: Screen) => void;
  updateProfile: (fn: (p: Profile) => Profile) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  refreshBoards: () => Promise<Map<string, BoardDoc> | null>;
  refreshApproved: () => Promise<void>;
  startDaily: () => void;
  startArchive: (dateKey: string) => void;
  startPractice: (opts: { count: number; categories: CategoryId[]; timer: number | null }) => void;
  completeRun: (run: RunState) => void;
  saveInProgress: (run: RunState | null) => void;
  resetProfile: () => void;
  audio: AudioEngine;
  scene: OceanScene | null;
  reducedMotion: boolean;
}
