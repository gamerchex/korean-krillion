// End of a dive: the score, the depth, a title and the seven answers. Nothing else competes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { zoneFor } from '../../core/config';
import { challengeNumber } from '../../core/daily';
import { achievementById } from '../../core/achievements';
import { dailyBoard } from '../../core/leaderboard';
import { shareText, titleFor, type RunSummary, type SummaryAnswer } from '../../core/results';
import type { RejectReason, RunState } from '../../core/types';
import { Modal, TierShape, TIER_COLOR, useCountUp, useSceneFocus } from '../components';
import type { Ctx } from '../ctx';
import { fmtMeters, fmtShare } from '../i18n';
import { serverApi } from '../driver';
import { fileReport, saveFile } from '../platform';
import { renderShareCard } from '../share';
import { shortReason } from './Dive';

const REPORTABLE = new Set<RejectReason>(['not-found', 'wrong-fit', 'outside-category', 'wrong-language', 'ambiguous', 'excluded', 'ai-rejected']);
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

/** A wrong try from this dive that the player can send for review. */
interface ReportTarget {
  id: string;
  promptId: string;
  input: string;
  reason: RejectReason;
}

function label(ctx: Ctx, a: SummaryAnswer): { main: string; alt?: string } {
  const key = a.entityKey;
  const entity = key && key.includes(':') && !key.startsWith('community:') && !key.startsWith('ai:') ? ctx.model.entity(key) : undefined;
  const name = entity?.name ?? a.name ?? a.input;
  const hangul = entity?.hangul;
  if (!hangul || hangul === name) return { main: name };
  return HANGUL.test(a.input) ? { main: hangul, alt: name } : { main: name, alt: hangul };
}

export function Results({
  ctx,
  summary,
  unlocked,
  publish,
  run,
}: {
  ctx: Ctx;
  summary: RunSummary;
  unlocked: string[];
  publish?: 'published' | 'refused' | 'unavailable' | 'pending';
  /** The run that just finished (absent when an old result is reopened). */
  run?: RunState;
}) {
  const { t, lang, model } = ctx;
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('');
  const [card, setCard] = useState<'' | 'saved' | 'declined' | 'unavailable' | 'busy'>('');
  const [reportOpen, setReportOpen] = useState(false);
  const [picked, setPicked] = useState<ReportTarget | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<Set<string>>(new Set());
  const zone = zoneFor(summary.depth);
  const title = titleFor(summary.total);
  const other = lang === 'ko' ? 'en' : 'ko';
  const number = summary.dateKey ? challengeNumber(summary.dateKey) : undefined;
  const text = shareText(summary, { number, zoneName: zone.name[lang], titleName: title.name[lang] });
  const perfect = summary.total >= 700;
  const shown = useCountUp(summary.total, 1400, ctx.reducedMotion, run ? 0 : summary.total);
  const colRef = useRef<HTMLDivElement | null>(null);
  useSceneFocus(ctx.scene, colRef, 0.9);

  useEffect(() => {
    ctx.scene?.setDepth(summary.depth);
    ctx.scene?.setFinale(perfect);
    ctx.audio.setDepth(summary.depth);
    if (summary.depth >= 1000 || perfect) setTimeout(() => ctx.audio.bell(perfect ? 1.2 : 0.8), 600);
    // The one celebration of the dive: the bell rings out a few sonar pulses as the score counts up.
    const pulses = run ? [700, 1100, 1500].map((ms, i) => setTimeout(() => ctx.scene?.ping(i === 2 ? '#ffd27a' : '#9ff7ff'), ms)) : [];
    return () => {
      pulses.forEach(clearTimeout);
      ctx.scene?.setFinale(false);
    };
  }, []);

  const [serverRank, setServerRank] = useState<{ r: number; n: number } | null>(null);
  useEffect(() => {
    if (!ctx.server || summary.mode !== 'daily' || !summary.dateKey) return;
    serverApi
      .leaderboard(ctx.server, 'daily', summary.dateKey)
      .then((res) => {
        const me = res.rows.find((x) => x.isMe);
        if (me) setServerRank({ r: me.rank, n: res.rows.length });
      })
      .catch(() => null);
  }, []);
  // Only a real board gives a rank; nothing is shown otherwise.
  const rank = useMemo(() => {
    if (serverRank) return serverRank;
    if (summary.mode !== 'daily' || !ctx.boards) return null;
    const rows = dailyBoard(ctx.boards, summary.challengeId, ctx.platform.uid);
    const me = rows.find((r) => r.isMe);
    return me ? { r: me.rank, n: rows.length } : null;
  }, [ctx.boards, serverRank]);

  const previous = summary.mode === 'daily' ? Object.values(ctx.profile.dailies).filter((d) => d.challengeId !== summary.challengeId) : [];
  const prevBest = previous.length ? Math.max(...previous.map((d) => d.total)) : null;
  const newBest = !!run && prevBest !== null && summary.total > prevBest;

  const targets = useMemo<ReportTarget[]>(() => {
    if (!run) return [];
    const out: ReportTarget[] = [];
    for (const rec of run.answers) {
      for (const a of rec.tries ?? []) {
        if (REPORTABLE.has(a.reason)) out.push({ id: `${run.runId}-${rec.index}-${a.at}`, promptId: rec.promptId, input: a.input, reason: a.reason });
      }
    }
    return out;
  }, [run]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
      setTimeout(() => setCopied((c) => (c === 'ok' ? '' : c)), 2200);
    } catch {
      setCopied('fail');
      setTimeout(() => (document.getElementById('share-text') as HTMLTextAreaElement | null)?.select(), 30);
    }
  };

  const saveCard = async () => {
    setCard('busy');
    const blob = await renderShareCard(summary, { lang, number });
    if (!blob) return setCard('unavailable');
    setCard(await saveFile(ctx.platform, `hanguk-io-${summary.dateKey ?? 'practice'}-${summary.total}.png`, blob));
  };

  const sendReport = async () => {
    if (!picked) return;
    const body = { promptId: picked.promptId, input: picked.input.slice(0, 80), reason: picked.reason, note: note.slice(0, 300) };
    if (ctx.server) await serverApi.report(ctx.server, body).catch(() => null);
    await fileReport(ctx.platform, { id: picked.id, ...body, at: ctx.now(), status: 'pending' });
    ctx.updateProfile((p) => ({ ...p, reportsFiled: p.reportsFiled + 1 }));
    setSent(new Set([...sent, picked.id]));
    setPicked(null);
    setNote('');
  };

  const kicker =
    summary.mode === 'practice'
      ? t('practiceDone')
      : summary.mode === 'archive'
        ? t('archiveDiveN', { n: number ?? '' })
        : t('diveNo', { n: number ?? '' });
  const achievements = unlocked.map((id) => achievementById(id)?.name[lang]).filter(Boolean) as string[];

  return (
    <div ref={colRef} className="results">
      <section className="res-head" aria-live="polite">
        <p className="res-kicker">{kicker}</p>
        <p className="res-score" aria-label={`${summary.total} / 700`}>
          <strong>{shown}</strong>
          <span>/700</span>
        </p>
        <p className="res-depth">
          <span>{fmtMeters(summary.depth)}</span>
          <span>{zone.name[lang]}</span>
        </p>
        <p className="res-title">
          {title.name[lang]} <span lang={other}>{title.name[other]}</span>
        </p>
        <span className="res-band" aria-hidden="true">
          {summary.answers.map((a, i) => (
            <i key={i} style={{ background: a.status === 'accepted' ? TIER_COLOR[a.tier] : undefined, animationDelay: `${0.25 + i * 0.09}s` }} />
          ))}
        </span>
        {perfect && <p className="res-note gold">{t('perfectDive')}</p>}
        {rank && <p className="res-note rank-line">{t('rankOnBoard', { r: rank.r, n: rank.n })}</p>}
        {newBest && <p className="res-note gold">{t('newBestShort')}</p>}
        {achievements.length > 0 && (
          <p className="res-note">
            {achievements.length <= 2 ? (
              t('unlockedList', { list: achievements.join(', ') })
            ) : (
              <button className="link-btn" onClick={() => ctx.nav({ id: 'records' })}>{t('unlockedN', { n: achievements.length })}</button>
            )}
          </p>
        )}
        {summary.mode === 'daily' && publish === 'refused' && <p className="res-note muted">{t('publishFailed')}</p>}
      </section>

      <ol className="res-list" aria-label={t('yourAnswers')}>
        {summary.answers.map((a, i) => {
          const p = model.prompt(a.promptId);
          const ok = a.status === 'accepted';
          const l = ok ? label(ctx, a) : { main: a.reason === 'skipped' ? t('passed') : t('timeout') };
          return (
            <li key={i} className={ok ? '' : 'miss'}>
              <span className="rl-mark">{ok ? <TierShape tier={a.tier} size={13} /> : <TierShape tier="none" size={11} />}</span>
              <span className="rl-main">
                <span className="rl-ans">
                  {l.main}
                  {l.alt && <span className="rl-alt" lang={HANGUL.test(l.alt) ? 'ko' : 'en'}>{l.alt}</span>}
                  {a.ai && <span className="rl-tag" title={t('aiChecked')}>AI</span>}
                </span>
                <span className="rl-q">{p ? p.text[lang] : a.promptId}</span>
              </span>
              <span className="rl-pts" title={ok && a.p !== undefined ? t('srcTitle', { src: t(a.source === 'blended' ? 'srcBlended' : a.source === 'ai' ? 'srcAi' : 'srcCurated'), pct: fmtShare(a.p, lang) }) : undefined}>
                {a.points}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="res-actions">
        <button className="btn primary small" onClick={copy}>{copied === 'ok' ? t('copied') : t('copyResult')}</button>
        <button className="btn small" onClick={() => ctx.nav({ id: 'practice' })}>{t('practice')}</button>
        <button className="btn small ghost" onClick={() => ctx.nav({ id: 'home' })}>{t('home')}</button>
      </div>
      <p className="res-links">
        <button className="link-btn" onClick={saveCard} disabled={card === 'busy'}>{t('saveImage')}</button>
        <button className="link-btn" onClick={() => ctx.nav({ id: 'howto' })}>{t('howScores')}</button>
        {targets.length > 0 && <button className="link-btn" onClick={() => setReportOpen(true)}>{t('reportAnswer')}</button>}
      </p>
      {card === 'saved' && <p className="res-status">{t('cardSaved')}</p>}
      {(card === 'declined' || card === 'unavailable') && <p className="res-status">{t('cardDeclined')}</p>}
      {copied === 'fail' && <p className="res-status">{t('copyFailed')}</p>}
      <textarea
        id="share-text"
        className={copied === 'fail' ? 'share-text' : 'sr-only'}
        readOnly
        value={text}
        rows={5}
        tabIndex={copied === 'fail' ? 0 : -1}
        aria-hidden={copied !== 'fail'}
      />

      {reportOpen && (
        <Modal
          title={t('reportTitle')}
          onClose={() => {
            setReportOpen(false);
            setPicked(null);
          }}
          labelClose={t('close')}
        >
          {picked ? (
            <>
              <p>
                <strong>“{picked.input}”</strong>
                <br />
                <span className="muted small">{model.prompt(picked.promptId)?.text[lang]}</span>
              </p>
              <label className="field">
                <span>{t('reviewNote')}</span>
                <textarea value={note} maxLength={300} rows={3} onChange={(e: any) => setNote(e.target.value)} />
              </label>
              <div className="row gap">
                <button className="btn primary small" onClick={sendReport}>{t('sendReport')}</button>
                <button className="btn small" onClick={() => setPicked(null)}>{t('cancel')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">{t('reportHint')}</p>
              <ul className="report-list">
                {targets.map((x) => (
                  <li key={x.id}>
                    <span className="rp-main">
                      <strong>“{x.input}”</strong>
                      <span className="muted small">{shortReason(t, x.reason)}</span>
                    </span>
                    {sent.has(x.id) ? (
                      <span className="muted small">{t('sentShort')}</span>
                    ) : (
                      <button className="btn small" onClick={() => setPicked(x)}>{t('sendForReview')}</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
