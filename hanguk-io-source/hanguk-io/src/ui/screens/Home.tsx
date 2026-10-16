// The surface: the name, today's dive and a row of small links. Everything else is one click away.

import { useEffect, useRef, useState } from 'react';
import { dailyChallengeId, msUntilNextDaily } from '../../core/daily';
import { personalBest, streakInfo } from '../../core/profile';
import { Logo, TIER_COLOR, useSceneFocus } from '../components';
import type { Ctx } from '../ctx';
import { fmtDuration, fmtMeters } from '../i18n';

export function Home({ ctx }: { ctx: Ctx }) {
  const { t, sched, profile, todayKey } = ctx;
  const [now, setNow] = useState(ctx.now());
  useEffect(() => {
    const id = setInterval(() => setNow(ctx.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const challenge = sched.forDate(todayKey, now);
  const done = challenge ? profile.dailies[dailyChallengeId(todayKey)] : undefined;
  const inProgress = profile.inProgressDaily && challenge && profile.inProgressDaily.challengeId === challenge.id ? profile.inProgressDaily : null;
  const streak = streakInfo(profile, todayKey);
  const best = personalBest(profile);
  const other = profile.inProgress;
  const reviewLabel = ctx.platform.isOwner || ctx.platform.canEdit ? t('review') : t('myReports');
  const colRef = useRef<HTMLDivElement | null>(null);
  useSceneFocus(ctx.scene, colRef, 0.85);

  return (
    <div className="home">
      <div ref={colRef} className="home-col">
      <header className="home-head">
        <Logo size="lg" />
        <p className="home-line">{t('homeLine')}</p>
      </header>

      {challenge && (
        <section className="home-today" aria-label={t('todayDive')}>
          {done ? (
            <>
              <p className="home-score">
                <strong>{done.total}</strong>
                <span>/700</span>
                <span className="home-depth">{fmtMeters(done.depth)}</span>
              </p>
              <span className="res-band small" aria-hidden="true">
                {done.answers.map((a, i) => (
                  <i key={i} style={{ background: a.status === 'accepted' ? TIER_COLOR[a.tier] : undefined }} />
                ))}
              </span>
              <button className="btn home-go" onClick={() => ctx.nav({ id: 'results', summary: done, unlocked: [] })}>
                {t('seeResults')}
              </button>
            </>
          ) : (
            <button
              className="btn primary home-go"
              onClick={() => {
                ctx.audio.unlock();
                ctx.startDaily();
              }}
            >
              {inProgress ? t('resumeDive') : t('startDiveN', { n: challenge.number })}
            </button>
          )}
          <p className="home-next">{t('nextDiveIn', { t: fmtDuration(msUntilNextDaily(now)) })}</p>
        </section>
      )}

      {other && (
        <p className="home-resume">
          <span>
            {other.mode === 'practice' ? t('practice') : t('archive')} {other.answers.length}/{other.promptIds.length}
          </span>
          <button className="link-btn" onClick={() => ctx.nav({ id: 'dive', run: other })}>{t('resumeDive')}</button>
          <button className="link-btn" onClick={() => ctx.saveInProgress(null)}>{t('dismiss')}</button>
        </p>
      )}

      <nav className="home-links" aria-label={t('menu')}>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'practice' })}>{t('practice')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'archive' })}>{t('archive')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'board' })}>{t('leaderboard')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'records' })}>{t('records')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'howto' })}>{t('howToPlay')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'review' })}>{reviewLabel}</button>
      </nav>

      {(streak.current > 0 || best) && (
        <p className="home-stats">
          {streak.current > 0 && (
            <span>
              {t('streak')} <strong className="home-streak">{streak.current}</strong>
            </span>
          )}
          {best && (
            <span>
              {t('best')} <strong>{best.total}</strong>
            </span>
          )}
        </p>
      )}
      </div>
    </div>
  );
}
