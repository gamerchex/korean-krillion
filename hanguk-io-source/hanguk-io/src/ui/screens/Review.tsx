import { useEffect, useMemo, useState } from 'react';
import { cleanInput, keysFor } from '../../core/normalize';
import { approvedCsv } from '../../core/review';
import type { Ctx } from '../ctx';
import type { StringKey } from '../i18n';
import { allReports, approveAnswer, myReports, saveFile, setReportStatus, type QueueItem, type Report } from '../platform';

interface Group {
  key: string;
  promptId: string;
  input: string;
  items: QueueItem[];
  status: Report['status'];
}

interface Opinion {
  verdict?: string;
  canonical?: string;
  hangul?: string;
  reason?: string;
  error?: string;
}

export function Review({ ctx }: { ctx: Ctx }) {
  const { t, lang, model, platform } = ctx;
  const admin = platform.isOwner || platform.canEdit;
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [mine, setMine] = useState<Report[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [opinions, setOpinions] = useState<Record<string, Opinion | 'thinking'>>({});
  const [exported, setExported] = useState<'saved' | 'declined' | 'unavailable' | null>(null);
  const approvedCount = Object.values(ctx.approved).reduce((n, list) => n + list.length, 0);

  const aiAnswers = admin ? ctx.aiService.acceptedAnswers() : [];
  const [, setTick] = useState(0);
  const toggleBlock = async (promptId: string, answerKey: string, blocked: boolean) => {
    await ctx.aiService.setBlocked(promptId, answerKey, blocked);
    setTick((n) => n + 1);
  };
  const exportApproved = async () => {
    const { csv } = approvedCsv(model, ctx.approved, aiAnswers.filter((a) => !a.blocked));
    setExported(await saveFile(platform, `hanguk-io-approved-${ctx.todayKey}.csv`, new Blob([csv], { type: 'text/csv' })));
  };

  const load = async () => {
    setMine(await myReports(platform));
    if (admin) setQueue(await allReports(platform));
  };
  useEffect(() => {
    void load();
  }, []);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const it of queue ?? []) {
      const key = `${it.promptId}|${keysFor(it.input).exact}`;
      const g = map.get(key) ?? { key, promptId: it.promptId, input: cleanInput(it.input), items: [], status: 'pending' as const };
      g.items.push(it);
      map.set(key, g);
    }
    for (const g of map.values()) {
      const approved = (ctx.approved[g.promptId] ?? []).some((a) => keysFor(a).exact === keysFor(g.input).exact);
      g.status = approved ? 'approved' : g.items.every((i) => i.status === 'dismissed') ? 'dismissed' : 'pending';
    }
    return [...map.values()].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.items.length - a.items.length);
  }, [queue, ctx.approved]);

  const approve = async (g: Group) => {
    setBusy(g.key);
    const ok = await approveAnswer(platform, g.promptId, g.input);
    if (ok) {
      for (const it of g.items) await setReportStatus(platform, it.by, it.id, 'approved');
      await ctx.refreshApproved();
      await load();
    }
    setBusy(null);
  };

  const dismiss = async (g: Group) => {
    setBusy(g.key);
    for (const it of g.items) await setReportStatus(platform, it.by, it.id, 'dismissed');
    await load();
    setBusy(null);
  };

  const ask = async (g: Group) => {
    const sample = platform.sample;
    if (!sample?.json) return;
    const p = model.prompt(g.promptId);
    if (!p) return;
    const known = model.runtime(p.id).acceptedList.slice(0, 40).map((e) => (e.hangul ? `${e.name} (${e.hangul})` : e.name));
    setOpinions({ ...opinions, [g.key]: 'thinking' });
    const input =
      `You are helping a human moderator of a Korean trivia game decide whether a player's answer should be accepted.\n` +
      `Prompt (English): ${p.text.en}\nPrompt (Korean): ${p.text.ko}\n` +
      `Player's answer: "${g.input.slice(0, 80)}"\n` +
      `Some answers already accepted for this prompt: ${known.join('; ')}\n` +
      `Is the player's answer a real, correct answer to this prompt (allowing for romanization differences)? ` +
      `Reply with only JSON: {"verdict":"valid"|"invalid"|"unsure","canonical":"standard romanized or English name, or empty","hangul":"Hangul spelling or empty","reason":"one short sentence"}`;
    try {
      const res = (await sample.json(input, { modelTier: 'default' })) as Opinion;
      setOpinions((o) => ({ ...o, [g.key]: res && typeof res === 'object' ? res : { error: 'unreadable' } }));
    } catch (e) {
      setOpinions((o) => ({ ...o, [g.key]: { error: (e as { code?: string })?.code ?? 'error' } }));
    }
  };

  const promptText = (id: string) => model.prompt(id)?.text[lang] ?? id;

  return (
    <div className="page">
      <h1>{admin ? t('review') : t('myReports')}</h1>
      {!platform.db && <p className="muted">{t('reportsLocal')}</p>}
      {admin && queue && (
        <section className="panel">
          {groups.length === 0 ? (
            <p className="muted">{t('reviewEmpty')}</p>
          ) : (
            <ul className="queue">
              {groups.map((g) => {
                const op = opinions[g.key];
                return (
                  <li key={g.key} className={`q-item ${g.status}`}>
                    <div className="q-head">
                      <strong>“{g.input}”</strong>
                      <span className="badge">{g.items.length}×</span>
                      <span className={`badge st-${g.status}`}>{t(g.status === 'pending' ? 'pending' : g.status === 'approved' ? 'approved' : 'dismissed')}</span>
                    </div>
                    <p className="muted small">{promptText(g.promptId)} · {g.items.map((i) => t(`short_${i.reason ?? 'not-found'}` as StringKey)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>
                    {g.items.filter((i) => i.note).slice(0, 3).map((i) => (
                      <p key={i.id} className="q-note">“{i.note}”</p>
                    ))}
                    {op === 'thinking' && <p className="muted">{t('claudeThinking')}</p>}
                    {op && op !== 'thinking' && (
                      <div className="opinion">
                        {op.error ? (
                          <p className="muted small">{op.error}</p>
                        ) : (
                          <p>
                            <strong>{op.verdict}</strong> {op.canonical} {op.hangul && <span lang="ko">{op.hangul}</span>} · {op.reason}
                          </p>
                        )}
                        <p className="muted small">{t('claudeNote')}</p>
                      </div>
                    )}
                    {g.status === 'pending' && (
                      <div className="row gap wrap">
                        <button className="btn small primary" disabled={busy === g.key} onClick={() => approve(g)}>{t('approve')}</button>
                        <button className="btn small" disabled={busy === g.key} onClick={() => dismiss(g)}>{t('dismiss')}</button>
                        {platform.sample?.json && op !== 'thinking' && (
                          <button className="btn small ghost" onClick={() => ask(g)}>{t('askClaude')}</button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {admin && ctx.ai.mode === 'artifact' && (
        <section className="panel">
          <h2>{t('aiAnswers')} <span className="badge">{aiAnswers.length}</span></h2>
          <p className="muted small">{t('aiAnswersHint')}</p>
          {aiAnswers.length === 0 ? (
            <p className="muted">{t('aiAnswersEmpty')}</p>
          ) : (
            <ul className="queue">
              {aiAnswers.map((a) => (
                <li key={a.promptId + a.answerKey} className={`q-item ${a.blocked ? 'dismissed' : 'approved'}`}>
                  <div className="q-head">
                    <strong>{a.canonical || a.hangul}</strong>
                    {a.hangul && a.hangul !== a.canonical && <span lang="ko">{a.hangul}</span>}
                    <span className="badge">{a.familiarity}/6</span>
                    <span className="muted small">{t('votesN', { n: a.votes })}</span>
                    {a.blocked && <span className="badge st-dismissed">{t('blocked')}</span>}
                  </div>
                  <p className="muted small">{promptText(a.promptId)}</p>
                  <button className="btn small" onClick={() => toggleBlock(a.promptId, a.answerKey, !a.blocked)}>{a.blocked ? t('unblock') : t('block')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {admin && (approvedCount > 0 || aiAnswers.length > 0) && (
        <section className="panel">
          <h2>{t('approvedAnswers')} <span className="badge">{approvedCount}</span></h2>
          <p className="muted small">{t('exportApprovedHint')}</p>
          <div className="row gap wrap">
            <button className="btn small" onClick={exportApproved}>{t('exportApproved')}</button>
            {exported && <span className="muted small" role="status">{t(exported === 'saved' ? 'cardSaved' : exported === 'declined' ? 'cardDeclined' : 'exportUnavailable')}</span>}
          </div>
        </section>
      )}
      {!admin && platform.db && <p className="muted">{t('ownerOnly')}</p>}
      <section className="panel">
        <h2>{t('myReports')}</h2>
        {mine.length === 0 ? (
          <p className="muted">{t('reviewEmpty')}</p>
        ) : (
          <ul className="queue">
            {mine
              .slice()
              .reverse()
              .map((r) => {
                const approved = (ctx.approved[r.promptId] ?? []).some((a) => keysFor(a).exact === keysFor(r.input).exact);
                const status = approved ? 'approved' : r.status;
                return (
                  <li key={r.id} className={`q-item ${status}`}>
                    <div className="q-head">
                      <strong>“{r.input}”</strong>
                      <span className={`badge st-${status}`}>{t(status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : 'dismissed')}</span>
                    </div>
                    <p className="muted small">{promptText(r.promptId)}</p>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
