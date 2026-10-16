import { useEffect, useState } from 'react';
import { ACHIEVEMENTS } from '../../core/achievements';
import { GAME, SCORING, ZONES } from '../../core/config';
import { challengeNumber } from '../../core/daily';
import { pointsFor } from '../../core/rarity';
import { personalBest, streakInfo } from '../../core/profile';
import { TITLES } from '../../core/results';
import { CREATURES } from '../art/creatures';
import { CategoryGlyph, Modal, Stat, TierBadge, TierShape } from '../components';
import { anthropicJudge, buildJudgeRequest, DEFAULT_JUDGE_MODEL } from '../../core/judge';
import { clearApiKey, JUDGE_MODELS, loadApiKey, saveApiKey } from '../ai';
import type { Ctx } from '../ctx';
import { hasRuntime, managePermissions, permissionState, requestPermission, type PermissionState } from '../platform';
import { fmtDate, fmtMeters, TIER_LABEL } from '../i18n';

export function HowTo({ ctx }: { ctx: Ctx }) {
  const { lang, model } = ctx;
  const ko = lang === 'ko';
  const mode: 'server' | 'artifact' | 'local' = ctx.server ? 'server' : ctx.platform.kind === 'artifact' ? 'artifact' : 'local';
  const reviewer = {
    server: ko ? '운영자가 승인하면' : 'once a moderator approves them',
    artifact: ko ? '페이지 소유자가 승인하면' : 'once the page owner approves them',
    local: ko ? '검토자가 있는 판(서버판이나 공유 페이지)에서 승인되면' : 'once a reviewer approves them (in the server or shared edition; this copy keeps reports on this device)',
  }[mode];
  const nPrompts = model.content.prompts.length;
  const nAnswers = model.content.entities.length;
  const nStrings = model.content.entities.reduce((s, e) => s + 1 + (e.hangul ? 1 : 0) + e.aliases.length, 0);
  const examples = [0.5, 0.1, 0.01, 0.001, 0.0001];
  return (
    <div className="page prose">
      <h1>{ko ? '게임 방법' : 'How to play'}</h1>
      <section className="panel">
        <h2>{ko ? '규칙' : 'The dive'}</h2>
        <ul>
          {ko ? (
            <>
              <li>매일 한국 시간 자정에 모두에게 같은 일곱 문제가 열립니다. 하루 한 번만 공식 기록으로 남습니다.</li>
              <li>문제마다 {GAME.defaultTimerSec}초가 주어집니다. 영어, 로마자, 한글 모두 됩니다. 단, 한국어 낱말을 묻는 문제는 한글이나 로마자로 답해야 합니다.</li>
              <li>틀려도 끝이 아닙니다. 짧은 표시로 알려 주고, 틀릴 때마다 {GAME.wrongTryPenaltyMs / 1000}초가 줄어듭니다. 시간이 남아 있는 한 몇 번이든 다시 낼 수 있고, 처음 인정된 답이 점수가 됩니다. 점수를 보여 준 뒤 다음 문제가 저절로 열립니다(Enter를 누르면 바로 넘어갑니다). 시간 제한 없는 연습에서는 넘기기로 0점 처리하고 다음 문제로 갈 수 있습니다.</li>
              <li>남들이 잘 떠올리지 못하는 정답일수록 점수가 높고, 점수만큼 더 깊이 가라앉습니다 (1점 = {SCORING.metersPerPoint}m, 최대 700점 = 7,000m).</li>
              <li>한 잠수에서 같은 답을 두 번 쓸 수는 없습니다. 시간 안에 인정된 답이 없으면 0점입니다.</li>
              <li>타이머는 문제가 보이는 순간 시작하고, 새로고침해도 다시 시작하지 않습니다.</li>
            </>
          ) : (
            <>
              <li>Every day at midnight Korea time (KST) the same seven prompts open for everyone. Only your first attempt counts as your official dive.</li>
              <li>You get {GAME.defaultTimerSec} seconds per prompt. Answer in English, romanized Korean or Hangul; prompts about Korean words want the Korean word (Hangul or romanized).</li>
              <li>A wrong answer doesn't end the prompt: a short note says it didn't count, you lose {GAME.wrongTryPenaltyMs / 1000} seconds, and you can try again as often as the clock allows. Your first accepted answer is the one that scores. After its points show, the next prompt opens by itself (Enter skips the wait). In untimed practice, Pass skips a prompt for zero.</li>
              <li>Valid answers that fewer players would think of score more, and every point sinks you {SCORING.metersPerPoint} m deeper: 700 points is 7,000 m.</li>
              <li>You can't reuse an answer within one dive. No accepted answer before time runs out scores zero.</li>
              <li>The clock starts when a prompt appears, and reloading the page does not restart it.</li>
            </>
          )}
        </ul>
      </section>

      <section className="panel">
        <h2>{ko ? '정답 판정' : 'What counts as an answer'}</h2>
        <p>
          {ko
            ? `정답은 엄선한 답안 은행(현재 문제 ${nPrompts}개, 정답 ${nAnswers.toLocaleString('en-US')}개, 인정되는 표기 ${nStrings.toLocaleString('en-US')}개)에 있어야 합니다. 한글·로마자 표기 차이, 띄어쓰기, 대소문자, 전각 문자는 맞춰서 비교하고, 한 답에만 가까운 작은 오타는 받아 줍니다. 실제로 있는 다른 답을 오타로 보고 바꿔 주는 일은 절대 없습니다. 은행에 없는 답은 검토 요청을 보낼 수 있고, ${reviewer} 이후 플레이어부터 인정됩니다. AI 의견은 참고용일 뿐 자동으로 인정되지 않습니다.`
            : `Answers must be in the curated answer bank (currently ${nPrompts} prompts, ${nAnswers.toLocaleString('en-US')} answers and ${nStrings.toLocaleString('en-US')} accepted spellings). Spacing, case, full-width characters, Hangul and the common romanization systems are normalized, and a small typo is forgiven when it points at exactly one answer. A real, different answer is never "corrected" into an accepted one. Answers the bank doesn't know can be sent for review; they count for later players ${reviewer}. An AI second opinion can help a reviewer decide but never accepts anything by itself.`}
        </p>
        <p>
          {ko
            ? `은행이 모르는 답은 AI 심판(Claude)에게 보냅니다. Claude는 실제로 있는 답인지, 문제에 맞는지 확인하고, 얼마나 흔한 답인지 1~6으로 추정합니다. 확인하는 동안 시간은 멈춥니다. 은행에 있는 답을 다른 철자로 쓴 경우에는 은행의 그 답으로 계산하므로 철자를 바꿔 점수를 올릴 수는 없고, 문제가 제외한 답이나 정해진 목록 밖의 답은 AI가 인정해도 인정되지 않습니다. 같은 답에는 모두에게 같은 판정과 점수가 적용됩니다. ${ctx.ai.mode === 'off' ? '이 사본에는 지금 AI 심판이 없어 은행만으로 판정합니다(설정에서 켤 수 있습니다).' : ''}`
            : `Answers the bank doesn't know go to an AI judge (Claude), which checks that they are real and fit the prompt, and rates how familiar they are from 1 to 6. The clock is paused while it checks. A new spelling of an answer the bank already has scores as that answer, so respelling can't buy points, and answers the prompt rules out or that fall outside a fixed list stay out even if the AI likes them. The same answer gets the same ruling and score for everyone. ${ctx.ai.mode === 'off' ? 'This copy has no AI judge right now, so the bank decides alone (you can turn it on in Settings).' : ''}`}
        </p>
      </section>

      <section className="panel">
        <h2>{ko ? '점수 계산' : 'How points are calculated'}</h2>
        <p className="formula mono">points = clamp(round({SCORING.k} × log₁₀(1 / p)), {SCORING.minValidPoints}, {SCORING.maxPoints})</p>
        <p>
          {ko
            ? 'p는 플레이어가 그 답을 낼 것으로 보이는 비율입니다. 정답이면 최소 1점, 최대 100점입니다.'
            : 'p is the estimated share of players who give that answer. A valid answer always earns at least 1 point and at most 100.'}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{ko ? '답하는 비율 p' : 'Share of players p'}</th>
                <th className="num">{ko ? '점수' : 'Points'}</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((p) => (
                <tr key={p}>
                  <td className="mono">{p * 100}%</td>
                  <td className="num mono">{pointsFor(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{ko ? 'p는 어디서 오나요?' : 'Where p comes from'}</h3>
        <ul>
          {ko ? (
            <>
              <li><strong>큐레이션 추정치 (기본):</strong> 모든 정답에는 편집자가 매긴 친숙도(1~6)가 있습니다. 친숙도 f인 답의 가중치는 6^(f−1)이고, p는 그 문제 정답 전체 가중치에서 차지하는 몫입니다. 실제 플레이 데이터가 모이기 전까지는 이 추정치로 점수를 매깁니다.</li>
              <li><strong>실제 플레이 데이터:</strong> 같은 회차를 푼 다른 플레이어(본인 제외)의 정답이 {SCORING.minSampleForBlend}개 이상 모이면, p = (n + {SCORING.priorStrength}·p₀) / (N + {SCORING.priorStrength})로 추정치와 섞습니다. 표본이 적을 때는 실제 데이터를 쓰지 않습니다.</li>
              <li><strong>AI 추정치:</strong> 은행에 없는 새 답은 Claude가 매긴 친숙도로 같은 공식을 씁니다. 결과 화면에서 이런 답에는 AI 표시가 붙습니다.</li>
              <li>연습 잠수에는 플레이 데이터를 쓰지 않습니다(큐레이션·AI 추정치만). 모든 결과에는 점수 모델 버전({SCORING.version})이 기록됩니다.</li>
            </>
          ) : (
            <>
              <li><strong>Curated estimate (default):</strong> every accepted answer carries an editor-assigned familiarity from 1 to 6. An answer with familiarity f weighs 6^(f−1), and p is its share of the prompt's total weight. Until enough players have answered, points come from this estimate.</li>
              <li><strong>Observed player data:</strong> once at least {SCORING.minSampleForBlend} other players (never counting you) have given valid answers to the same prompt of the same dive, p = (n + {SCORING.priorStrength}·p₀) / (N + {SCORING.priorStrength}) blends their answers with the curated estimate. Below that sample size, observations are not used.</li>
              <li><strong>AI estimate:</strong> a new answer that isn't in the bank uses the same formula with the familiarity Claude gave it; the results mark such answers with an AI tag.</li>
              <li>Practice dives never use player data (curated or AI estimates only). Every result records the scoring model version ({SCORING.version}).</li>
            </>
          )}
        </ul>
        <h3>{ko ? '희귀도 등급' : 'Rarity tiers'}</h3>
        <ul className="tier-list">
          {SCORING.tiers.map((tier) => (
            <li key={tier.id}>
              <TierBadge tier={tier.id} lang={lang} /> <span className="mono">{tier.min === tier.max ? tier.min : `${tier.min}–${tier.max}`}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">{ko ? '등급은 색뿐 아니라 모양과 글자로도 구분됩니다.' : 'Tiers are told apart by shape and label as well as colour.'}</p>
      </section>

      <section className="panel">
        <h2>{ko ? '바다의 구역' : 'The zones'}</h2>
        <ul>
          {ZONES.map((z) => (
            <li key={z.id}>
              <strong>{z.name[lang]}</strong> <span className="mono">{z.min.toLocaleString('en-US')}–{z.max.toLocaleString('en-US')} m</span>
            </li>
          ))}
        </ul>
        <p>{ko ? '700점 만점을 받으면 해구 바닥의 용궁에 닿습니다.' : 'A perfect 700 reaches the Dragon King’s palace, Yonggung, at the bottom of the trench.'}</p>
        <h3>{ko ? '칭호' : 'Titles'}</h3>
        <p className="muted small">
          {TITLES.map((x) => `${x.name[lang]} (${x.min}+)`).join(' · ')}
        </p>
        <p className="muted small">{ko ? '칭호는 점수 구간을 뜻할 뿐, 전체 플레이어 중 순위를 뜻하지 않습니다.' : 'Titles describe the depth you reached, not a measured rank among players.'}</p>
      </section>

      <section className="panel">
        <h2>{ko ? '공정성과 데이터' : 'Fairness and your data'}</h2>
        <ul>
          {ko ? (
            <>
              {mode === 'artifact' && <li>순위표는 이 페이지를 열어 결과를 올린 사람들만의 것입니다. 이 페이지에서는 점수를 각자의 브라우저에서 계산하므로, 서버판(서버에서 시간과 점수를 확인)만큼 조작에 강하지는 않습니다.</li>}
              {mode === 'artifact' && <li>공식 결과에는 답 자체가 아니라 답의 식별자만 올라가며, 다른 사람의 희귀도 계산에 쓰입니다.</li>}
              {mode === 'server' && <li>서버가 시간을 재고 모든 답을 채점합니다. 공식 잠수는 플레이어마다 하루 한 번입니다.</li>}
              {mode === 'server' && <li>공식 잠수의 답(답의 식별자)은 서버에 저장되어 다른 플레이어의 희귀도 계산에 쓰입니다. 오늘 답의 분포는 잠수를 마친 뒤에만 볼 수 있습니다.</li>}
              {mode === 'local' && <li>이 사본에는 공유 데이터가 없습니다. 순위표가 없고, 희귀도는 큐레이션 추정치로만 계산하며, 기록은 이 브라우저에만 남습니다.</li>}
              {ctx.ai.mode !== 'off' ? <li>은행이 모르는 답은 확인을 위해 Claude(Anthropic)에게 보냅니다. 보내는 것은 문제와 답 글자뿐이고, 이름이나 기록은 보내지 않습니다.</li> : null}
              <li>공유 문구와 공유 카드에는 답이 들어가지 않습니다.</li>
              <li>지난 잠수와 연습은 공식 기록·순위표에 반영되지 않습니다.</li>
            </>
          ) : (
            <>
              {mode === 'artifact' && <li>The leaderboard only contains people who opened this page and published their dive. Here, scores are computed in each player's browser, which is less tamper-proof than the server edition (where the server keeps the clock and scores answers).</li>}
              {mode === 'artifact' && <li>An official result publishes which answers you gave (as answer IDs), which is what lets rarity be measured for everyone else.</li>}
              {mode === 'server' && <li>The server keeps the clock and scores every answer. Each player gets one official dive per day.</li>}
              {mode === 'server' && <li>Your official answers (as answer IDs) are stored on the server and used to measure rarity for everyone else. Today's answer distribution only opens once you have finished.</li>}
              {mode === 'local' && <li>This copy has no shared data: there is no leaderboard, rarity always uses the curated estimate, and your records stay in this browser.</li>}
              {ctx.ai.mode !== 'off' ? <li>Answers the bank doesn't know are sent to Claude (Anthropic) to be checked: the prompt and the answer text only, never your name or records.</li> : null}
              <li>Share text and share cards never include your answers.</li>
              <li>Archive and practice dives never touch official records or the leaderboard.</li>
            </>
          )}
        </ul>
      </section>

      <section className="panel">
        <h2>{ko ? '만든 것들' : 'Credits'}</h2>
        <p>
          {ko
            ? `그림 ${CREATURES.length + 1}점(바다 생물, 용궁과 용왕, 잠수종)과 소리(가야금 같은 현 소리, 범종, 물소리)는 모두 이 게임을 위해 새로 만든 것입니다. 외부 이미지나 음원을 쓰지 않았습니다. 글꼴은 오픈 폰트 라이선스(OFL)의 Hahmlet와 IBM Plex입니다. 답안 은행은 AI의 도움을 받아 작성한 초안으로, 사람의 편집 검토를 기다리고 있습니다. 분야마다 출처를 적어 두었으니, 틀린 곳을 발견하면 결과 화면에서 알려 주세요.`
            : `All ${CREATURES.length + 1} illustrations (sea life, Yonggung and its Dragon King, the diving bell) and all sound (gayageum-like plucks, the temple bell, the water) were made for this game: no third-party images or recordings. Fonts are Hahmlet and IBM Plex (SIL Open Font License). The answer bank is an AI-assisted draft awaiting human editorial review; each answer pool lists its sources, and a rejected answer you think should count can be reported from the results screen.`}
        </p>
      </section>
    </div>
  );
}

export function SettingsScreen({ ctx }: { ctx: Ctx }) {
  const { t, settings } = ctx;
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(settings.diverName);
  return (
    <div className="page">
      <h1>{t('settings')}</h1>
      <section className="panel form">
        <div className="field">
          <span>{t('settingsLanguage')}</span>
          <div className="seg" role="radiogroup">
            {(['en', 'ko'] as const).map((l) => (
              <button key={l} role="radio" aria-checked={settings.lang === l} className={settings.lang === l ? 'on' : ''} onClick={() => ctx.updateSettings({ lang: l })}>
                {l === 'en' ? 'English' : '한국어'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t('settingsMusic')} <span className="mono muted">{Math.round(settings.music * 100)}</span></span>
          <input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(e: any) => ctx.updateSettings({ music: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>{t('settingsSfx')} <span className="mono muted">{Math.round(settings.sfx * 100)}</span></span>
          <input type="range" min={0} max={1} step={0.05} value={settings.sfx} onChange={(e: any) => ctx.updateSettings({ sfx: Number(e.target.value) })} />
        </label>
        <label className="field check">
          <input type="checkbox" checked={settings.muted} onChange={(e: any) => ctx.updateSettings({ muted: e.target.checked })} />
          <span>{t('settingsMute')}</span>
        </label>
        <div className="field">
          <span>{t('settingsMotion')}</span>
          <div className="seg" role="radiogroup">
            {(['system', 'reduced', 'full'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={settings.motion === m} className={settings.motion === m ? 'on' : ''} onClick={() => ctx.updateSettings({ motion: m })}>
                {t(`motion_${m}` as any)}
              </button>
            ))}
          </div>
        </div>
        <label className="field check">
          <input type="checkbox" checked={settings.contrast} onChange={(e: any) => ctx.updateSettings({ contrast: e.target.checked })} />
          <span>{t('settingsContrast')}</span>
        </label>
        <label className="field">
          <span>{t('settingsName')}</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            placeholder={t('settingsNamePh')}
            onChange={(e: any) => setName(e.target.value)}
            onBlur={() => ctx.updateSettings({ diverName: name.trim().slice(0, 24) })}
          />
        </label>
        <p className="muted small">{ctx.storage === 'cloud' ? t('storageCloud') : ctx.storage === 'local' ? t('storageLocal') : t('storageNone')}</p>
        <button className="btn danger" onClick={() => setConfirm(true)}>{t('settingsReset')}</button>
      </section>
      <AiSettings ctx={ctx} />
      {confirm && (
        <Modal title={t('settingsReset')} onClose={() => setConfirm(false)} labelClose={t('close')}>
          <p>{t('settingsResetConfirm')}</p>
          <div className="row gap">
            <button className="btn danger" onClick={() => { ctx.resetProfile(); setConfirm(false); }}>{t('erase')}</button>
            <button className="btn" onClick={() => setConfirm(false)}>{t('cancel')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AiSettings({ ctx }: { ctx: Ctx }) {
  const { t, settings, ai, lang } = ctx;
  const stored = loadApiKey();
  const [key, setKey] = useState(stored?.key ?? '');
  const [judgeModel, setJudgeModel] = useState(stored?.model ?? DEFAULT_JUDGE_MODEL);
  const [test, setTest] = useState('');
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const viewer = hasRuntime();
  useEffect(() => {
    if (ai.mode === 'artifact') void permissionState('sample').then(setPerm);
  }, [ai.mode]);
  const modelLabel = JUDGE_MODELS.find((m) => m.id === (stored?.model ?? DEFAULT_JUDGE_MODEL))?.label ?? stored?.model ?? DEFAULT_JUDGE_MODEL;
  const modeText =
    ai.mode === 'server'
      ? t('aiMode_server')
      : ai.mode === 'artifact'
        ? t('aiMode_artifact')
        : ai.mode === 'key'
          ? t('aiMode_key', { model: modelLabel })
          : ctx.server
            ? t('aiMode_serverOff')
            : t('aiMode_off');

  const runTest = async () => {
    setTest(t('keyTesting'));
    try {
      const judge = anthropicJudge({ apiKey: key.trim(), model: judgeModel, browser: true });
      const v = await judge(buildJudgeRequest(ctx.model, 'food-street', 'hotteok', { reason: 'not-found' }));
      setTest(`${t('keyOk')} (${v.verdict})`);
    } catch (e) {
      setTest(t('keyFail', { why: (e as Error).message || 'error' }));
    }
  };

  return (
    <section className="panel form">
      <h2>{t('aiSection')}</h2>
      <p className="muted small">{t('aiIntro')}</p>
      <p>{modeText}</p>
      {ai.problem && <p className="error-line">{t(`aiProblem_${ai.problem}` as 'aiProblem_refused')}</p>}
      {ai.mode !== 'server' && ai.mode !== 'off' && (
        <label className="field check">
          <input type="checkbox" checked={settings.aiJudge} onChange={(e: any) => ctx.updateSettings({ aiJudge: e.target.checked })} />
          <span>{t('aiUse')}</span>
        </label>
      )}
      {ai.mode === 'artifact' && perm === 'prompt' && (
        <button className="btn small" onClick={async () => setPerm(await requestPermission('sample'))}>{t('aiAllow')}</button>
      )}
      {ai.mode === 'artifact' && perm === 'denied' && (
        <button className="btn small" onClick={async () => { await managePermissions(); setPerm(await permissionState('sample')); }}>{t('aiPermissions')}</button>
      )}
      {!ctx.server && !viewer && (
        <>
          <label className="field">
            <span>{t('apiKey')}</span>
            <input type="password" value={key} autoComplete="off" spellCheck={false} placeholder="sk-ant-…" onChange={(e: any) => setKey(e.target.value)} />
          </label>
          <div className="field">
            <span>{t('judgeModel')}</span>
            <div className="seg" role="radiogroup">
              {JUDGE_MODELS.map((m) => (
                <button key={m.id} role="radio" aria-checked={judgeModel === m.id} className={judgeModel === m.id ? 'on' : ''} onClick={() => setJudgeModel(m.id)}>
                  {m.label} <span className="muted small">· {m.note[lang]}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">{t('apiKeyNote')}</p>
          <div className="row gap wrap">
            <button className="btn small primary" disabled={!key.trim()} onClick={() => { saveApiKey(key, judgeModel); ctx.refreshAi(); }}>{t('saveKey')}</button>
            <button className="btn small" disabled={!key.trim()} onClick={runTest}>{t('testKey')}</button>
            {stored && <button className="btn small" onClick={() => { clearApiKey(); setKey(''); ctx.refreshAi(); }}>{t('forgetKey')}</button>}
          </div>
          {test && <p className="muted small" role="status">{test}</p>}
        </>
      )}
    </section>
  );
}

export function Records({ ctx }: { ctx: Ctx }) {
  const { t, lang, profile, todayKey } = ctx;
  const dailies = Object.values(profile.dailies).sort((a, b) => (b.dateKey ?? '').localeCompare(a.dateKey ?? ''));
  const streak = streakInfo(profile, todayKey);
  const best = personalBest(profile);
  const avg = dailies.length ? Math.round(dailies.reduce((s, d) => s + d.total, 0) / dailies.length) : 0;
  const got = Object.keys(profile.achievements).length;
  return (
    <div className="page">
      <h1>{t('records')}</h1>
      <section className="stats-row">
        <Stat label={t('dives')} value={dailies.length} />
        <Stat label={t('best')} value={best ? best.total : '–'} sub={best ? fmtMeters(best.depth) : ''} />
        <Stat label={t('average')} value={dailies.length ? avg : '–'} />
        <Stat label={t('streak')} value={streak.current} sub={`${t('bestStreak')} ${streak.best}`} />
        <Stat label={t('practice')} value={profile.practice.runs} sub={profile.practice.runs ? `${t('best')} ${profile.practice.best}` : ''} />
      </section>
      <section className="panel">
        <h2>{t('acceptedByCategory')}</h2>
        <ul className="cat-counts">
          {[...ctx.model.categories.values()].map((c) => (
            <li key={c.id} className={profile.categoriesHit[c.id] ? 'on' : 'off'}>
              <CategoryGlyph cat={c.id} size={14} /> <span>{c.name[lang]}</span> <strong className="mono">{profile.categoriesHit[c.id] ?? 0}</strong>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>{t('achievements')} <span className="muted mono">{got}/{ACHIEVEMENTS.length}</span></h2>
        <ul className="ach-grid">
          {ACHIEVEMENTS.map((a) => {
            const on = !!profile.achievements[a.id];
            return (
              <li key={a.id} className={`ach ${on ? 'on' : 'off'}`}>
                <strong>{a.name[lang]}</strong>
                <span>{a.desc[lang]}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel">
        <h2>{t('recentDives')}</h2>
        {dailies.length === 0 ? (
          <p className="muted">{t('noDives')}</p>
        ) : (
          <ul className="recent">
            {dailies.slice(0, 30).map((d) => (
              <li key={d.challengeId}>
                <span>{d.dateKey ? `${t('diveNo', { n: challengeNumber(d.dateKey) })} · ${fmtDate(d.dateKey, lang)}` : d.challengeId}</span>
                <span className="tier-row small">{d.answers.map((a, i) => <TierShape key={i} tier={a.tier} size={12} />)}</span>
                <span className="mono">{d.total}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export const _tiers = TIER_LABEL;
