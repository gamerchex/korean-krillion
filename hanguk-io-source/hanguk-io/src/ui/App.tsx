import { useEffect, useMemo, useRef, useState } from 'react';
import { GAME } from '../core/config';
import type { ContentModel } from '../core/content';
import { Scheduler, kstDateKey, practiceSet } from '../core/daily';
import { createRun } from '../core/engine';
import type { BoardDoc, BoardRun } from '../core/leaderboard';
import { applyRun, newProfile, withInProgress, type Profile, type Settings } from '../core/profile';
import { summarize } from '../core/results';
import type { RunState } from '../core/types';
import { audio } from './audio';
import type { OceanScene } from './art/ocean';
import { Logo } from './components';
import type { Ctx, Screen } from './ctx';
import { t as translate, type StringKey } from './i18n';
import {
  LOCAL_PLATFORM,
  clearLocalProfile,
  initPlatform,
  loadApproved,
  loadBoards,
  loadCloudProfile,
  loadLocalProfile,
  localAvailable,
  mergeLoaded,
  hasRuntime,
  publishRun,
  renameOnBoard,
  saveCloudProfile,
  saveLocalProfile,
  type Approved,
  type Platform,
} from './platform';
import { connectServer, serverApi, type ServerConn } from './driver';
import { aiService, loadApiKey, type AiStatus } from './ai';
import { Dive } from './screens/Dive';
import { Home } from './screens/Home';
import { HowTo, Records, SettingsScreen } from './screens/Info';
import { Archive, Board, Practice } from './screens/Menus';
import { Results } from './screens/Results';
import { Review } from './screens/Review';

function prefersReducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function App({ model, scene }: { model: ContentModel; scene: OceanScene | null }) {
  const now = () => Date.now();
  const sched = useMemo(() => new Scheduler(model), [model]);
  const [profile, setProfile] = useState<Profile>(() => loadLocalProfile(now()));
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [platform, setPlatform] = useState<Platform>(LOCAL_PLATFORM);
  const [server, setServer] = useState<ServerConn | null>(null);
  const serverRef = useRef<ServerConn | null>(null);
  serverRef.current = server;
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const [boards, setBoards] = useState<Map<string, BoardDoc> | null>(null);
  const [ai, setAi] = useState<AiStatus>(aiService.status());
  const [approved, setApproved] = useState<Approved>({});
  const [screen, setScreen] = useState<Screen>({ id: 'home' });
  const [todayKey, setTodayKey] = useState(kstDateKey(now()));
  const [storage] = useState<'cloud' | 'local' | 'none'>(() => (localAvailable() ? 'local' : 'none'));
  const [cloud, setCloud] = useState(false);
  const [sysReduced, setSysReduced] = useState(prefersReducedMotion());
  const settings = profile.settings;
  const lang = settings.lang;
  const reducedMotion = settings.motion === 'reduced' || (settings.motion === 'system' && sysReduced);

  // --- persistence ---------------------------------------------------------------------
  const commit = (p: Profile) => {
    profileRef.current = p;
    setProfile(p);
    saveLocalProfile(p);
    saveCloudProfile(platformRef.current, p);
  };
  const updateProfile = (fn: (p: Profile) => Profile) => commit({ ...fn(profileRef.current), updatedAt: now() });

  // --- platform bootstrap (runtime capabilities resolve asynchronously) --------------------
  useEffect(() => {
    let alive = true;
    void (async () => {
      const conn = await connectServer(hasRuntime());
      if (!alive) return;
      if (conn) {
        serverRef.current = conn;
        setServer(conn);
      }
      const pf = await initPlatform();
      if (!alive) return;
      platformRef.current = pf;
      setPlatform(pf);
      aiService.configure({ pf, serverAi: conn ? conn.ai : null, key: loadApiKey(), inViewer: hasRuntime() });
      void aiService.loadShared();
      if (pf.db && pf.uid) {
        const cloudProfile = await loadCloudProfile(pf, now());
        if (!alive) return;
        commit(mergeLoaded(profileRef.current, cloudProfile));
        setCloud(true);
      }
      const [b, a] = await Promise.all([loadBoards(pf), loadApproved(pf)]);
      if (!alive) return;
      setBoards(b);
      setApproved(a);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => aiService.onChange(() => setAi(aiService.status())), []);
  const refreshAi = () => aiService.configure({ pf: platformRef.current, serverAi: serverRef.current ? serverRef.current.ai : null, key: loadApiKey(), inViewer: hasRuntime() });

  // --- environment: day rollover, motion preference, theme flags, audio -----------------
  useEffect(() => {
    const id = setInterval(() => setTodayKey(kstDateKey(now())), 15_000);
    let mq: MediaQueryList | null = null;
    const onMq = () => setSysReduced(prefersReducedMotion());
    try {
      mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onMq);
    } catch {
      /* ignore */
    }
    return () => {
      clearInterval(id);
      mq?.removeEventListener('change', onMq);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.classList.toggle('hc', settings.contrast);
    root.classList.toggle('rm', reducedMotion);
    scene?.setOptions({ reducedMotion, highContrast: settings.contrast });
    audio.setVolumes(settings.music, settings.sfx, settings.muted);
  }, [lang, settings.contrast, reducedMotion, settings.music, settings.sfx, settings.muted]);

  const firstScreen = useRef(true);
  useEffect(() => {
    // Return to the surface on the home screen and menus.
    if (screen.id === 'home' || screen.id === 'practice' || screen.id === 'archive') {
      scene?.setDepth(0);
      audio.setDepth(0);
    }
    if (scene) {
      // The dive places the camera anchor itself (just above its prompt); the depth ruler shows
      // while diving and on the results.
      if (screen.id !== 'dive') scene.setAnchor(screen.id === 'home' || screen.id === 'results' ? 0.22 : 0.05, !firstScreen.current);
      firstScreen.current = false;
      scene.ruler = screen.id === 'dive' || screen.id === 'results';
    }
    if (screen.id !== 'dive') window.scrollTo?.(0, 0);
  }, [screen.id]);

  // --- actions ---------------------------------------------------------------------------
  const t = (key: StringKey, vars?: Record<string, string | number>) => translate(lang, key, vars);

  const refreshBoards = async () => {
    const b = await loadBoards(platformRef.current);
    if (b) setBoards(b);
    return b;
  };
  const refreshApproved = async () => setApproved(await loadApproved(platformRef.current));

  const saveInProgress = (run: RunState | null) => {
    const p = profileRef.current;
    if (run && run.mode === 'daily' && p.dailies[run.challengeId]) return; // already finished
    commit(withInProgress(p, run, now()));
  };

  const startRun = (run: RunState) => {
    saveInProgress(run);
    // Pick up other players' fresh AI rulings so the same answer is judged the same way.
    void aiService.loadShared();
    setScreen({ id: 'dive', run });
  };

  /** Server mode: the server creates (or resumes) the run and owns its clock. */
  const startOnServer = async (body: Record<string, unknown>) => {
    const conn = serverRef.current!;
    try {
      const { run } = await serverApi.startRun(conn, body);
      if (run.phase === 'done') {
        const p = profileRef.current;
        if (run.mode === 'daily' && p.dailies[run.challengeId]) return setScreen({ id: 'results', summary: p.dailies[run.challengeId], unlocked: [] });
        return completeRun(run);
      }
      saveInProgress(run);
      setScreen({ id: 'dive', run });
    } catch {
      alertMsg(translate(lang, 'connectionLost'));
    }
  };
  const [notice, setNotice] = useState('');
  const alertMsg = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(''), 6000);
  };

  const startDaily = () => {
    const ch = sched.forDate(todayKey, now());
    if (!ch) return;
    const p = profileRef.current;
    const done = p.dailies[ch.id];
    if (done) return setScreen({ id: 'results', summary: done, unlocked: [] });
    if (serverRef.current) return void startOnServer({ mode: 'daily' });
    if (p.inProgressDaily && p.inProgressDaily.challengeId === ch.id) return setScreen({ id: 'dive', run: p.inProgressDaily });
    startRun(
      createRun({ mode: 'daily', challengeId: ch.id, dateKey: ch.dateKey, promptIds: ch.promptIds, timerSec: GAME.defaultTimerSec, now: now(), contentVersion: model.content.version }),
    );
  };

  const startArchive = (dateKey: string) => {
    const ch = sched.forDate(dateKey, now());
    if (!ch) return;
    if (serverRef.current) return void startOnServer({ mode: 'archive', dateKey });
    startRun(createRun({ mode: 'archive', challengeId: ch.id, dateKey, promptIds: ch.promptIds, timerSec: GAME.defaultTimerSec, now: now(), contentVersion: model.content.version }));
  };

  const startPractice = (o: { count: number; categories: Settings['practiceCats']; timer: number | null }) => {
    if (serverRef.current) return void startOnServer({ mode: 'practice', count: o.count, categories: o.categories, timer: o.timer });
    const ids = practiceSet(model, { count: o.count, categories: o.categories, avoid: profileRef.current.practice.recentPrompts, seed: String(now()) });
    if (!ids.length) return;
    startRun(createRun({ mode: 'practice', challengeId: `practice-${now()}`, promptIds: ids, timerSec: o.timer, now: now(), contentVersion: model.content.version }));
  };

  const completeRun = (run: RunState) => {
    const summary = summarize(run, model);
    const { profile: p2, unlocked } = applyRun(profileRef.current, summary, run, now(), todayKey);
    commit(p2);
    if (unlocked.length) setTimeout(() => audio.unlockChime(), 900);
    const pf = platformRef.current;
    const publishable = run.mode === 'daily' && !!pf.db;
    setScreen({ id: 'results', summary, unlocked, publish: publishable ? 'pending' : undefined, run });
    if (publishable) {
      const boardRun: BoardRun = {
        s: summary.total,
        d: summary.depth,
        a: run.answers.map((a) => (a.status === 'accepted' ? a.entityKey ?? null : null)),
        r: run.answers.map((a) => (a.status === 'accepted' ? 0 : a.status === 'rejected' ? 1 : 2)),
        t: summary.finishedAt,
        v: summary.scoringVersion,
      };
      void publishRun(pf, run.challengeId, boardRun, profileRef.current.settings.diverName, todayKey).then(async (res) => {
        await refreshBoards();
        setScreen((s) => (s.id === 'results' && s.summary.runId === summary.runId ? { ...s, publish: res } : s));
      });
    }
  };

  const updateSettings = (patch: Partial<Settings>) => {
    updateProfile((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
    if (patch.diverName !== undefined) {
      void renameOnBoard(platformRef.current, patch.diverName);
      if (serverRef.current) void serverApi.rename(serverRef.current, patch.diverName).catch(() => null);
    }
  };

  const resetProfile = () => {
    clearLocalProfile();
    const fresh = newProfile(now());
    fresh.settings = { ...profileRef.current.settings };
    commit(fresh);
    setScreen({ id: 'home' });
  };

  const ctx: Ctx = {
    model,
    sched,
    profile,
    settings,
    lang,
    t,
    platform,
    server,
    ai,
    aiService,
    refreshAi,
    storage: cloud ? 'cloud' : storage,
    boards,
    approved,
    now,
    todayKey,
    nav: (s) => setScreen(s),
    updateProfile,
    updateSettings,
    refreshBoards,
    refreshApproved,
    startDaily,
    startArchive,
    startPractice,
    completeRun,
    saveInProgress,
    resetProfile,
    audio,
    scene,
    reducedMotion,
  };

  const inDive = screen.id === 'dive' || screen.id === 'results';
  // Keep the bell clear of the column of text on wide screens.
  useEffect(() => {
    if (scene) scene.bellX = inDive ? 0.88 : 0.9;
  }, [inDive]);

  return (
    <div className={`app screen-${screen.id}`} onPointerDown={() => audio.unlock()} onKeyDown={() => audio.unlock()}>
      <a className="skip" href="#main">{t('skipToContent')}</a>
      {screen.id !== 'dive' && (
      <header className="topbar">
        {screen.id === 'home' ? (
          <span />
        ) : (
          <button className="logo-btn" onClick={() => setScreen({ id: 'home' })} aria-label={t('home')}>
            <Logo size="sm" />
          </button>
        )}
        <div className="topbar-actions">
          <button
            className="icon-btn"
            onClick={() => updateSettings({ lang: lang === 'en' ? 'ko' : 'en' })}
            aria-label={lang === 'en' ? '한국어로 보기' : 'Switch to English'}
          >
            {lang === 'en' ? '한' : 'EN'}
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              audio.unlock();
              updateSettings({ muted: !settings.muted });
            }}
            aria-label={settings.muted ? t('soundOn') : t('soundOff')}
            aria-pressed={!settings.muted}
          >
            {settings.muted ? (
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-4v12l-4-4H3zM13 7l5 6M18 7l-5 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-4v12l-4-4H3zM13 7c1.5 1.5 1.5 4.5 0 6M15.5 5c3 3 3 7 0 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
            )}
          </button>
          <button className="icon-btn" onClick={() => setScreen({ id: 'settings' })} aria-label={t('settings')}>
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M4 4l2.1 2.1M13.9 13.9L16 16M4 16l2.1-2.1M13.9 6.1L16 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>
      )}

      {notice && (
        <div className="toast" role="alert">
          {notice}
        </div>
      )}
      <main id="main" className="main">
        {screen.id === 'home' && <Home ctx={ctx} />}
        {screen.id === 'dive' && <Dive key={screen.run.runId} ctx={ctx} initial={screen.run} />}
        {screen.id === 'results' && <Results key={screen.summary.runId} ctx={ctx} summary={screen.summary} unlocked={screen.unlocked} publish={screen.publish} run={screen.run} />}
        {screen.id === 'practice' && <Practice ctx={ctx} />}
        {screen.id === 'archive' && <Archive ctx={ctx} />}
        {screen.id === 'board' && <Board ctx={ctx} />}
        {screen.id === 'howto' && <HowTo ctx={ctx} />}
        {screen.id === 'settings' && <SettingsScreen ctx={ctx} />}
        {screen.id === 'records' && <Records ctx={ctx} />}
        {screen.id === 'review' && <Review ctx={ctx} />}
      </main>
    </div>
  );
}
