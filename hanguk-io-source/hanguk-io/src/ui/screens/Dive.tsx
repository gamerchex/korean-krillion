// The dive: one compact column (prompt, answer field, ring timer) floating in the ocean, a small
// HUD above it, and nothing else. A result replaces the answer field in place for a moment and
// the next prompt opens by itself; Enter skips the wait.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { zoneFor } from '../../core/config';
import type { EngineDeps } from '../../core/engine';
import { statsFromBoards } from '../../core/leaderboard';
import type { AnswerRecord, Attempt, RejectReason, RunState } from '../../core/types';
import { Logo, TierShape, TIER_COLOR, useCountUp, useSceneFocus } from '../components';
import type { Ctx } from '../ctx';
import { TIER_LABEL, fmtMeters, type StringKey } from '../i18n';
import { localDriver, serverDriver, type DiveDriver, type StepResult } from '../driver';

/** How long a finished prompt stays on screen before the next one opens. */
const HOLD_ACCEPTED_MS = 1500;
const HOLD_MISSED_MS = 1100;
const HOLD_LAST_EXTRA_MS = 500;

/** A short label for why a try or a prompt didn't score (no explanations during play). */
export function shortReason(t: Ctx['t'], reason: RejectReason | undefined): string {
  return t(`short_${reason ?? 'not-found'}` as StringKey);
}

/** The answer as it counted: the bank's spelling plus its Hangul (or the reverse if typed in Hangul). */
export function answerLabel(ctx: Ctx, rec: AnswerRecord): { main: string; alt?: string } {
  const key = rec.entityKey;
  const entity = key && key.includes(':') && !key.startsWith('community:') && !key.startsWith('ai:') ? ctx.model.entity(key) : undefined;
  let name = rec.input;
  let hangul: string | undefined;
  if (entity) {
    name = entity.name;
    hangul = entity.hangul;
  } else if (rec.ai) {
    name = rec.ai.canonical || rec.input;
    hangul = rec.ai.hangul;
  } else if (rec.matchedName) name = rec.matchedName;
  if (!hangul || hangul === name) return { main: name };
  return rec.script === 'hangul' ? { main: hangul, alt: name } : { main: name, alt: hangul };
}

export function Dive({ ctx, initial }: { ctx: Ctx; initial: RunState }) {
  const { model, t, lang } = ctx;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [run, setRun] = useState<RunState>(initial);
  const runRef = useRef(run);
  runRef.current = run;
  const [input, setInput] = useState('');
  const [remaining, setRemaining] = useState<number | null>(run.deadline === null ? null : Math.max(0, run.deadline - ctx.now()));
  const [error, setError] = useState('');
  const [lastTry, setLastTry] = useState<Attempt | null>(null);
  const [tryKey, setTryKey] = useState(0);
  const [checking, setChecking] = useState<'' | 'bank' | 'ai'>('');
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [zoneNote, setZoneNote] = useState<{ key: number; text: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const busy = useRef(false);
  /** Time left when a submit went out; the ring holds it while the answer is checked. */
  const frozen = useRef<number | null>(null);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const qboxRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const zoneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shownTotal = useCountUp(run.total, 700, ctx.reducedMotion, initial.total);
  useSceneFocus(ctx.scene, stageRef, 1);

  // Observed answers from this page's shared board (Method A), owner-approved answers and the
  // AI judge's shared verdicts.
  const depsRef = useRef<EngineDeps>({ model });
  depsRef.current = {
    model,
    statsFor: (_promptId: string, index: number) =>
      ctx.boards && run.mode !== 'practice' ? statsFromBoards(ctx.boards, run.challengeId, index, ctx.platform.uid) : null,
    communityFor: (promptId: string) => ctx.approved[promptId],
    aiAvailable: ctx.settings.aiJudge && ctx.ai.ready,
    cachedVerdict: ctx.aiService.cachedVerdict,
    aiAnswer: ctx.aiService.aiAnswer,
  };
  const driver: DiveDriver = useMemo(
    () =>
      ctx.server
        ? serverDriver(ctx.server)
        : localDriver(model, () => depsRef.current, ctx.now, {
            judge: () => (ctxRef.current.settings.aiJudge ? ctxRef.current.aiService.judge : null),
            onJudging: (r) => {
              setChecking('ai');
              setRun(r);
            },
            remember: (promptId, typed, verdict, record) => ctxRef.current.aiService.remember(promptId, typed, verdict, record),
          }),
    [],
  );

  /** Run one driver step at a time; surface network trouble instead of failing silently. */
  const step = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;
    try {
      const out = await fn();
      setError('');
      return out;
    } catch {
      setError(ctxRef.current.t('connectionLost'));
      return null;
    } finally {
      busy.current = false;
    }
  };

  const focusInput = (select = false) =>
    setTimeout(() => {
      if (menuOpen.current) return;
      inputRef.current?.focus();
      if (select) inputRef.current?.select();
    }, 20);

  // Persist after every transition so a reload resumes the same dive and the same clock.
  useEffect(() => {
    ctx.saveInProgress(run);
  }, [run]);

  useEffect(() => {
    ctx.scene?.setDepth(run.total * 10, false);
    if (run.phase === 'answering' && run.judging) {
      // Reloaded while the judge was thinking: finish that try first.
      setChecking('ai');
      void step(() => driver.resume(runRef.current)).then((res) => {
        setChecking('');
        if (res) handle(res);
      });
    } else if (run.phase === 'answering' && run.openedAt === null) {
      void step(() => driver.open(runRef.current)).then((opened) => {
        if (opened) setRun(opened);
      });
    }
    focusInput();
    return () => {
      clearTimeout(hold.current);
      clearTimeout(zoneTimer.current);
    };
  }, []);

  // Hang the ocean's surface line just above the prompt, wherever the layout put it.
  useLayoutEffect(() => {
    const place = () => {
      const box = qboxRef.current;
      if (box) ctxRef.current.scene?.setAnchor((box.getBoundingClientRect().top - 3) / Math.max(1, window.innerHeight));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  // Announce each new prompt to screen readers.
  useEffect(() => {
    if (run.phase !== 'answering') return;
    const p = model.prompt(run.promptIds[run.index]);
    if (p) setAnnounce(`${t('prompt', { i: run.index + 1, n: run.promptIds.length })}. ${p.text[lang]}`);
  }, [run.index]);

  const apply = (next: RunState, rec: AnswerRecord) => {
    const c = ctxRef.current;
    setRun(next);
    setLastTry(null);
    setInput('');
    c.scene?.setDepth(rec.depthAfter);
    c.audio.setDepth(rec.depthAfter);
    if (rec.status === 'accepted') {
      c.audio.accept(rec.tier);
      c.scene?.ping(TIER_COLOR[rec.tier]);
      const { main } = answerLabel(c, rec);
      setAnnounce(c.t('srAccepted', { name: main, tier: TIER_LABEL[rec.tier][c.lang], p: rec.points, total: rec.totalAfter }));
      const before = zoneFor(rec.depthAfter - rec.points * 10);
      const after = zoneFor(rec.depthAfter);
      if (after.id !== before.id) {
        clearTimeout(zoneTimer.current);
        setZoneNote({ key: rec.index, text: after.name[c.lang] });
        zoneTimer.current = setTimeout(() => setZoneNote(null), 2900);
      }
    } else {
      c.audio.timeout();
      setAnnounce(rec.reason === 'skipped' ? c.t('passed') : c.t('timeout'));
    }
  };

  /** Show what a step did: a finished prompt, a wrong try, or just a newer run. */
  const handle = (res: StepResult) => {
    const c = ctxRef.current;
    if (res.attempt && !res.record) {
      setRun(res.run);
      setLastTry(res.attempt);
      setTryKey((k) => k + 1);
      c.audio.reject();
      const pen = res.attempt.penaltyMs ? ` ${c.t('penalty', { s: Math.round(res.attempt.penaltyMs / 1000) })}` : '';
      setAnnounce(shortReason(c.t, res.attempt.reason) + pen);
      if (!c.reducedMotion) {
        formRef.current?.animate?.(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
          { duration: 300, easing: 'ease-out' },
        );
      }
      focusInput(true);
    }
    if (res.record) apply(res.run, res.record);
    else if (!res.attempt) {
      // A server run that was resumed: show whatever it holds now.
      const r = res.run;
      setRun(r);
      const done = r.answers[r.index];
      if (r.phase !== 'answering' && done) apply(r, done);
      else if (r.tries?.length) setLastTry(r.tries[r.tries.length - 1]);
    }
  };

  // Clock: ~10 Hz UI updates, ticks in the last five seconds, expiry when time runs out.
  // The clock holds while an answer is being checked.
  useEffect(() => {
    let raf = 0;
    let lastSec = -1;
    let lastShown = -1;
    let retryAt = 0;
    const loop = () => {
      const r = runRef.current;
      if (r.phase === 'answering' && r.deadline !== null && r.openedAt !== null) {
        const now = ctxRef.current.now();
        const held = r.judging ? r.deadline - r.judging.since : frozen.current;
        const rem = held ?? r.deadline - now;
        const shown = Math.max(0, Math.ceil(rem / 100));
        if (shown !== lastShown) {
          lastShown = shown;
          setRemaining(Math.max(0, rem));
        }
        const sec = Math.ceil(rem / 1000);
        if (sec !== lastSec) {
          if (sec <= 5 && sec > 0 && lastSec !== -1 && held === null) ctxRef.current.audio.tick(sec <= 3);
          lastSec = sec;
        }
        if (held === null && rem <= 0 && now >= retryAt && !busy.current) {
          retryAt = now + 600; // the server's clock decides; ask again shortly if it disagrees
          void step(() => driver.expire(r)).then((res) => {
            if (res && res.record) apply(res.run, res.record);
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const submit = async () => {
    const r = runRef.current;
    if (r.phase === 'revealing') return void next();
    if (r.phase !== 'answering' || r.openedAt === null || r.judging || busy.current) return;
    const typed = input;
    if (!typed.trim()) return;
    const c = ctxRef.current;
    c.audio.unlock();
    c.audio.submit();
    frozen.current = r.deadline === null ? null : Math.max(0, r.deadline - c.now());
    // Only show "checking" if the answer takes a moment (the bank answers instantly).
    const slow = setTimeout(() => setChecking((k) => k || (c.server?.ai ? 'ai' : 'bank')), 250);
    const res = await step(() => driver.submit(r, typed));
    clearTimeout(slow);
    frozen.current = null;
    setChecking('');
    if (res) handle(res);
  };

  const pass = async () => {
    const r = runRef.current;
    if (r.phase !== 'answering' || r.openedAt === null || r.judging) return;
    const res = await step(() => driver.skip(r));
    if (res?.record) apply(res.run, res.record);
  };

  const next = async () => {
    const r = runRef.current;
    if (r.phase !== 'revealing') return;
    clearTimeout(hold.current);
    const adv = await step(() => driver.advance(r));
    if (!adv) {
      // Another step is still running, or the server can't be reached (the line under the field
      // says so): try again shortly rather than leaving the result up forever.
      advanceSoon(busy.current ? 400 : 2500);
      return;
    }
    if (adv.phase === 'done') {
      ctxRef.current.completeRun(adv);
      return;
    }
    setRun(adv);
    setInput('');
    setLastTry(null);
    setRemaining(adv.deadline === null ? null : adv.deadline - ctxRef.current.now());
    focusInput();
  };
  const nextRef = useRef(next);
  nextRef.current = next;

  /** Open the next prompt after `ms`, waiting while the menu is open or a step is running. */
  function advanceSoon(ms: number) {
    clearTimeout(hold.current);
    const fire = () => {
      if (menuOpen.current || busy.current) {
        hold.current = setTimeout(fire, 400);
        return;
      }
      void nextRef.current();
    };
    hold.current = setTimeout(fire, ms);
  }

  // A result stays up briefly, then the next prompt opens by itself.
  useEffect(() => {
    if (run.phase !== 'revealing') return;
    const rec = run.answers[run.index];
    const last = run.index === run.promptIds.length - 1;
    advanceSoon((rec?.status === 'accepted' ? HOLD_ACCEPTED_MS : HOLD_MISSED_MS) + (last ? HOLD_LAST_EXTRA_MS : 0));
    return () => clearTimeout(hold.current);
  }, [run.phase, run.index]);

  // Keys: Enter skips the wait when focus isn't in the field; Escape closes the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen.current) {
        setMenu(false);
        setLeaving(false);
        menuBtnRef.current?.focus();
        return;
      }
      if (e.key !== 'Enter' || menuOpen.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (runRef.current.phase === 'revealing' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault();
        void nextRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Menu: focus its first item, close on a click outside.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node;
      if (menuRef.current?.contains(el) || menuBtnRef.current?.contains(el)) return;
      setMenu(false);
      setLeaving(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const closeMenu = () => {
    setMenu(false);
    setLeaving(false);
    focusInput();
  };

  const prompt = model.prompt(run.promptIds[run.index])!;
  const rec = run.phase !== 'answering' ? run.answers[run.index] : undefined;
  const timed = run.deadline !== null || (run.timerSec ?? 0) > 0;
  const timerTotal = (run.timerSec ?? 0) * 1000 || (run.deadline !== null && run.openedAt !== null ? run.deadline - run.openedAt : 0) || 1;
  const secs = remaining === null ? null : Math.ceil(remaining / 1000);
  const urgent = run.phase === 'answering' && secs !== null && secs <= 5;
  const isChecking = checking !== '' || !!run.judging;
  const primary = prompt.text[lang];
  const secondary = lang === 'ko' ? prompt.text.en : prompt.text.ko;
  const n = run.promptIds.length;
  const missed = !!lastTry && input === lastTry.input;
  const frac = rec ? (rec.status === 'accepted' ? 1 : 0) : Math.max(0, Math.min(1, (remaining ?? timerTotal) / timerTotal));

  let ringLabel = secs === null ? '' : String(Math.max(0, secs));
  let ringTone = isChecking ? 'held' : urgent ? 'urgent' : 'run';
  if (rec) {
    ringLabel = rec.status === 'accepted' ? '✓' : rec.reason === 'skipped' ? '–' : '0';
    ringTone = rec.status === 'accepted' ? 'ok' : 'out';
  }

  return (
    <div className="dive">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <header className="hud">
        <button
          ref={menuBtnRef}
          className="hud-btn"
          aria-label={t('menu')}
          aria-expanded={menu}
          onClick={() => (menu ? closeMenu() : setMenu(true))}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>

        <div className="hud-cap">
          <div className="hud-cell">
            <span className="hud-label">{t('depth')}</span>
            <span className="hud-val">{fmtMeters(shownTotal * 10)}</span>
          </div>
          <div className="hud-prog" role="img" aria-label={t('prompt', { i: Math.min(run.index + 1, n), n })}>
            <span className="stripes">
              {run.promptIds.map((_, i) => {
                const a = run.answers[i];
                const cls = a ? (a.status === 'accepted' ? 'done' : 'miss') : i === run.index ? 'now' : '';
                return <i key={i} className={cls} style={a && a.status === 'accepted' ? { background: TIER_COLOR[a.tier] } : undefined} />;
              })}
            </span>
            <span className="hud-label">{Math.min(run.index + 1, n)}/{n}</span>
          </div>
          <div className="hud-cell right">
            <span className="hud-label">{t('score')}</span>
            <span key={run.total} className={`hud-val ${run.total > initial.total ? 'bump' : ''}`}>{shownTotal}</span>
          </div>
        </div>

        <button
          className="hud-btn"
          onMouseDown={keepFocus}
          onClick={() => {
            ctx.audio.unlock();
            ctx.updateSettings({ muted: !ctx.settings.muted });
          }}
          aria-label={ctx.settings.muted ? t('soundOn') : t('soundOff')}
          aria-pressed={!ctx.settings.muted}
        >
          {ctx.settings.muted ? (
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-4v12l-4-4H3zM13 7l5 6M18 7l-5 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-4v12l-4-4H3zM13 7c1.5 1.5 1.5 4.5 0 6M15.5 5c3 3 3 7 0 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
          )}
        </button>

        {zoneNote && (
          <p key={zoneNote.key} className="zone-note" aria-hidden="true">
            {zoneNote.text}
          </p>
        )}

        {menu && (
          <div ref={menuRef} className="menu-pop" role="dialog" aria-label={t('menu')}>
            <div className="menu-logo"><Logo size="sm" /></div>
            <button className="mi" onClick={closeMenu}>{t('resume')}</button>
            <button
              className="mi"
              lang={lang === 'en' ? 'ko' : 'en'}
              aria-label={lang === 'en' ? '한국어로 보기' : 'Switch to English'}
              onClick={() => ctx.updateSettings({ lang: lang === 'en' ? 'ko' : 'en' })}
            >
              {lang === 'en' ? '한국어' : 'English'}
            </button>
            {leaving ? (
              <div className="mi-confirm">
                <p>{t('quitConfirm')}</p>
                <div className="row gap">
                  <button className="btn small" onClick={() => ctx.nav({ id: 'home' })}>{t('leave')}</button>
                  <button className="btn small ghost" onClick={closeMenu}>{t('keepDiving')}</button>
                </div>
              </div>
            ) : (
              <button className="mi" onClick={() => setLeaving(true)}>{t('quit')}</button>
            )}
          </div>
        )}
      </header>

      <section ref={stageRef} className="stage">
        <div ref={qboxRef} key={run.index} className="qbox">
          <h1 className="prompt-text" lang={lang}>{primary}</h1>
          <p className="qalt" lang={lang === 'ko' ? 'en' : 'ko'}>{secondary}</p>
          {prompt.hint && <p className="qhint">{prompt.hint[lang]}</p>}
        </div>

        <div className={`arow ${timed ? '' : 'untimed'} ${urgent ? 'urgent' : ''}`}>
          {timed && (
            <span className="ring-wrap">
              <Ring frac={frac} label={ringLabel} tone={ringTone} tier={rec ? TIER_COLOR[rec.tier] : undefined} />
              {lastTry?.penaltyMs && !rec ? (
                <span key={tryKey} className="penalty" aria-hidden="true">
                  {t('penalty', { s: Math.round(lastTry.penaltyMs / 1000) })}
                </span>
              ) : null}
            </span>
          )}
          <div className="answer-wrap">
            <form
              ref={formRef}
              className={`afield ${missed ? 'missed' : ''}`}
              onSubmit={(e: any) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="sr-only" htmlFor="answer">{t('typeHere')}</label>
              <input
                id="answer"
                ref={inputRef}
                className="answer-input"
                value={input}
                maxLength={80}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder={t('placeholder')}
                aria-describedby="answer-line"
                onChange={(e: any) => {
                  // Typing is ignored while an answer is being checked or a result is showing.
                  if (runRef.current.phase === 'answering' && !runRef.current.judging) setInput(e.target.value);
                }}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => (composing.current = false)}
                onKeyDown={(e: any) => {
                  if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current || e.keyCode === 229)) e.preventDefault();
                }}
              />
              <button type="submit" className="go" disabled={isChecking || run.openedAt === null} tabIndex={rec ? -1 : 0}>
                {t('submit')}
              </button>
              {timed && !rec && (
                <span className="drain" aria-hidden="true">
                  <i style={{ transform: `scaleX(${frac})` }} />
                </span>
              )}
            </form>
            {rec && <ResultRow ctx={ctx} rec={rec} onNext={() => void next()} />}
          </div>
        </div>

        <p id="answer-line" className={`aline ${timed ? '' : 'untimed'}`}>
          {error ? (
            <span className="aline-err" role="alert">{error}</span>
          ) : isChecking ? (
            <span className="aline-check">
              {checking === 'ai' || run.judging ? t('checkingAi') : t('checking')} <span className="dots" aria-hidden="true" />
            </span>
          ) : lastTry && !rec ? (
            <span key={tryKey} className="aline-miss">
              <span aria-hidden="true">✕ </span>
              {shortReason(t, lastTry.reason)}
            </span>
          ) : (
            <span />
          )}
          {!timed && run.phase === 'answering' && (
            <button type="button" className="link-btn pass-btn" onClick={pass} disabled={isChecking}>
              {t('pass')}
            </button>
          )}
        </p>
        {timed && secs !== null && run.phase === 'answering' && (
          <span className="sr-only" role="timer" aria-live={urgent ? 'assertive' : 'off'}>
            {t('timeLeft', { s: Math.max(0, secs) })}
          </span>
        )}
      </section>
    </div>
  );
}

/** Clicking these must not take focus (and the phone keyboard) away from the answer field. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

function Ring({ frac, label, tone, tier }: { frac: number; label: string; tone: string; tier?: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <span className={`ring ${tone}`} style={tier ? ({ '--tier': tier } as any) : undefined} aria-hidden="true">
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle className="ring-track" cx="22" cy="22" r={r} />
        <circle className="ring-arc" cx="22" cy="22" r={r} strokeDasharray={c.toFixed(2)} strokeDashoffset={(c * (1 - frac)).toFixed(2)} transform="rotate(-90 22 22)" />
      </svg>
      <b>{label}</b>
    </span>
  );
}

/** The result, in the answer field's place: the answer, its rarity mark and the points. */
function ResultRow({ ctx, rec, onNext }: { ctx: Ctx; rec: AnswerRecord; onNext: () => void }) {
  const { t, lang } = ctx;
  const pts = useCountUp(rec.points, 520, ctx.reducedMotion, 0);
  if (rec.status !== 'accepted') {
    return (
      <div className="result miss" data-status={rec.status} data-points={0} onMouseDown={keepFocus} onClick={onNext} aria-hidden="true">
        <span className="r-ans">{rec.reason === 'skipped' ? t('passed') : t('timeout')}</span>
        <strong className="r-pts">+0</strong>
      </div>
    );
  }
  const { main, alt } = answerLabel(ctx, rec);
  return (
    <div className="result ok" data-status={rec.status} data-points={rec.points} data-tier={rec.tier} style={{ '--tier': TIER_COLOR[rec.tier] } as any} onMouseDown={keepFocus} onClick={onNext} aria-hidden="true">
      <span className="r-ans">
        <span className="r-name">{main}</span>
        {alt && <span className="r-alt" lang={rec.script === 'hangul' ? 'en' : 'ko'}>{alt}</span>}
      </span>
      <span className="r-tier">
        <TierShape tier={rec.tier} size={12} />
        <span>{TIER_LABEL[rec.tier][lang]}</span>
      </span>
      <strong className="r-pts">+{pts}</strong>
    </div>
  );
}
