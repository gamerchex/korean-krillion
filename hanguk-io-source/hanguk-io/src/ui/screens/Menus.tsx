import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES } from '../../core/compile';
import { addDays, dailyChallengeId } from '../../core/daily';
import { allTimeBoard, dailyBoard, weeklyBoard, type Ranked } from '../../core/leaderboard';
import type { CategoryId } from '../../core/types';
import { CategoryGlyph, TierShape } from '../components';
import type { Ctx } from '../ctx';
import { serverApi } from '../driver';
import { fmtDate, fmtMeters } from '../i18n';

export function Practice({ ctx }: { ctx: Ctx }) {
  const { t, lang, settings } = ctx;
  const [cats, setCats] = useState<CategoryId[]>(settings.practiceCats);
  const [count, setCount] = useState(settings.practiceCount);
  const [timer, setTimer] = useState<number | null>(settings.practiceTimer);
  const toggle = (c: CategoryId) => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]);
  const start = () => {
    ctx.audio.unlock();
    ctx.updateSettings({ practiceCats: cats, practiceCount: count, practiceTimer: timer });
    ctx.startPractice({ count, categories: cats, timer });
  };
  return (
    <div className="page">
      <h1>{t('practiceSetup')}</h1>
      <p className="muted">{t('practiceSub')}</p>
      <section className="panel">
        <h2>{t('categories')}</h2>
        <div className="chip-grid" role="group" aria-label={t('categories')}>
          <button className={`chip toggle ${cats.length === 0 ? 'on' : ''}`} aria-pressed={cats.length === 0} onClick={() => setCats([])}>
            {t('allCategories')}
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`chip toggle ${cats.includes(c.id) ? 'on' : ''}`} aria-pressed={cats.includes(c.id)} onClick={() => toggle(c.id)}>
              <CategoryGlyph cat={c.id} size={14} /> {c.name[lang]}
            </button>
          ))}
        </div>
        <h2>{t('promptCount')}</h2>
        <div className="seg" role="radiogroup" aria-label={t('promptCount')}>
          {[3, 5, 7, 10].map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <h2>{t('timer')}</h2>
        <div className="seg" role="radiogroup" aria-label={t('timer')}>
          {[10, 20, 30, null].map((s) => (
            <button key={String(s)} role="radio" aria-checked={timer === s} className={timer === s ? 'on' : ''} onClick={() => setTimer(s)}>
              {s === null ? t('off') : `${s}s`}
            </button>
          ))}
        </div>
        <button className="btn primary big-btn" onClick={start}>
          {t('startPractice')} <span aria-hidden="true">↓</span>
        </button>
      </section>
    </div>
  );
}

export function Archive({ ctx }: { ctx: Ctx }) {
  const { t, lang, sched, profile } = ctx;
  const list = useMemo(() => sched.archive(ctx.now()).slice(0, 120), []);
  return (
    <div className="page">
      <h1>{t('archive')}</h1>
      <p className="muted">{t('archiveSub')}</p>
      {list.length === 0 && <p className="panel">{t('archiveEmpty')}</p>}
      <ul className="archive-list">
        {list.map((c) => {
          const daily = profile.dailies[c.id];
          const arch = profile.archive[c.id];
          const best = daily ?? arch;
          const cats = c.promptIds.map((id) => ctx.model.prompt(id)!.category);
          return (
            <li key={c.id} className="panel archive-item">
              <div className="ai-head">
                <strong>{t('diveNo', { n: c.number })}</strong>
                <span className="muted">{fmtDate(c.dateKey, lang)}</span>
              </div>
              <div className="ai-cats" aria-hidden="true">
                {cats.map((cat, i) => <CategoryGlyph key={i} cat={cat} size={14} />)}
              </div>
              <div className="ai-score">
                {best ? (
                  <>
                    <span className="mono">{best.total}</span>
                    <span className="tier-row small">{best.answers.map((a, i) => <TierShape key={i} tier={a.tier} size={12} />)}</span>
                    <span className="muted small">{daily ? t('daily') : t('archive')}</span>
                  </>
                ) : (
                  <span className="muted small">{t('notPlayed')}</span>
                )}
              </div>
              <button className="btn small" onClick={() => { ctx.audio.unlock(); ctx.startArchive(c.dateKey); }}>
                {best ? t('replayAgain') : t('replay')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Board({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  const [tab, setTab] = useState<'day' | 'week' | 'all'>('day');
  const [day, setDay] = useState(ctx.todayKey);
  const [loading, setLoading] = useState(false);
  const [serverRows, setServerRows] = useState<Ranked[] | null>(null);
  useEffect(() => {
    if (ctx.server) return;
    setLoading(true);
    void ctx.refreshBoards().finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!ctx.server) return;
    setLoading(true);
    serverApi
      .leaderboard(ctx.server, tab === 'day' ? 'daily' : tab === 'week' ? 'weekly' : 'alltime', day)
      .then((r) => setServerRows(r.rows.map((x, i) => ({ ...x, id: String(i), at: 0 }))))
      .catch(() => setServerRows([]))
      .finally(() => setLoading(false));
  }, [tab, day]);
  const boards = ctx.server ? new Map() : ctx.boards;
  const rows: Ranked[] = useMemo(() => {
    if (ctx.server) return serverRows ?? [];
    if (!boards) return [];
    if (tab === 'day') return dailyBoard(boards, dailyChallengeId(day), ctx.platform.uid);
    if (tab === 'week') return weeklyBoard(boards, day, ctx.platform.uid);
    return allTimeBoard(boards, ctx.platform.uid);
  }, [boards, tab, day, serverRows]);

  return (
    <div className="page">
      <h1>{t('leaderboard')}</h1>
      {!boards ? (
        <p className="panel">{loading ? t('loading') : t('boardUnavailable')}</p>
      ) : (
        <>
          <p className="muted small">{ctx.server ? t('serverMode') : t('boardNote')}</p>
          {ctx.platform.canWriteShared === false && <p className="muted small">{t('boardReadOnly')}</p>}
          <div className="seg" role="tablist">
            {(['day', 'week', 'all'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {k === 'day' ? t('boardToday') : k === 'week' ? t('boardWeek') : t('boardAll')}
              </button>
            ))}
          </div>
          {tab !== 'all' && (
            <div className="row gap center day-pick">
              <button className="icon-btn" onClick={() => setDay(addDays(day, tab === 'week' ? -7 : -1))} aria-label="Previous">‹</button>
              <span>{fmtDate(day, lang)}</span>
              <button className="icon-btn" disabled={day >= ctx.todayKey} onClick={() => setDay(addDays(day, tab === 'week' ? 7 : 1))} aria-label="Next">›</button>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="panel">{t('boardEmpty')}</p>
          ) : (
            <div className="panel table-wrap">
              <table className="board">
                <thead>
                  <tr>
                    <th>{t('rank')}</th>
                    <th>{t('player')}</th>
                    <th className="num">{t('score')}</th>
                    <th className="num hide-narrow">{tab === 'day' ? t('depth') : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.id} className={r.isMe ? 'me' : ''}>
                      <td className="mono">{r.rank}</td>
                      <td>
                        {r.name || t('anonymous')}
                        {r.isMe && <span className="you"> ({t('you')})</span>}
                      </td>
                      <td className="num mono">{r.score}</td>
                      <td className="num hide-narrow muted">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const _fmt = fmtMeters;
