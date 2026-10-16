# Scoring

Everything here is implemented in `src/core/rarity.ts`, `src/core/engine.ts`,
`src/core/judge.ts` and `src/core/config.ts`, and shared by the browser game, the reference
server and the tests. The in-game "How to play" screen explains the same rules in plain language,
in English and Korean.

Current model: **`rarity-v1`**. Every finished dive records the scoring version, content version
and selection version it was played under, so a later recalibration never silently rewrites an
old result.

## One prompt, one score

Each of the seven prompts scores its **first accepted answer** (wrong tries cost time, see
[Tries](#tries)). A valid answer scores

```
points = clamp( round( k · log10(1 / p) ), 1, 100 )        k = 25
```

where **p** is the estimated share of players who would give that same answer to that prompt.
Every tenfold drop in p is worth 25 more points:

| p (share giving this answer) | points | tier |
|---:|---:|---|
| 100% | 1 (minimum for a valid answer) | Common |
| 50% | 8 | Common |
| 25% | 15 | Common |
| 10% | 25 | Uncommon |
| 5% | 33 | Uncommon |
| 2% | 42 | Rare |
| 1% | 50 | Rare |
| 0.5% | 58 | Rare |
| 0.1% | 75 | Very rare |
| 0.01% or less | 100 | Legendary |

A prompt with no accepted answer before its time runs out (or that you pass) scores **0**.
Seven prompts × 100 = **700** maximum.

| Tier | Points |
|---|---|
| Common | 0–19 |
| Uncommon | 20–39 |
| Rare | 40–59 |
| Very rare | 60–79 |
| Extremely rare | 80–99 |
| Legendary | 100 |

A prompt can lower its own ceiling (`max` in the prompt file) if its rarest answers should not
be worth a full 100; none of the current prompts do.

## Where p comes from

### Method B: curated estimate (used now)

Every accepted answer in the bank carries a familiarity grade from 1 (obscure) to 6 (the obvious
answer), set by the content editor and overridable per prompt. The grade becomes a weight

```
w = 6^(familiarity − 1)          6 → 7,776   5 → 1,296   4 → 216   3 → 36   2 → 6   1 → 1
p0(answer) = w(answer) / Σ w(all accepted answers to this prompt)
```

so one familiarity step is roughly six times more (or less) likely. Worked example, *Name an
animal of the Korean zodiac* (12 answers, Σw = 16,632):

| Answer | Familiarity | p0 | Points |
|---|---:|---:|---:|
| Tiger 호랑이 | 6 | 46.8% | 8 |
| Rat, Ox, Rabbit, Dragon, Horse, Pig | 5 | 7.8% each | 28 |
| Snake, Sheep, Monkey, Rooster, Dog | 4 | 1.3% each | 47 |

These are **editorial estimates, not measurements**, and the game says so: How to play explains
it, and hovering a score on the results shows its source ("Curated estimate: about 8% of players
would give this"). The full curated
score profile of every prompt is listed in [content/REPORT.md](../content/REPORT.md).

Answers that a moderator approves from the review queue but that are not yet in the bank are
treated as the rarest curated grade (weight 1).

### AI estimate (answers the bank doesn't have)

When the AI judge accepts an answer that is not in the bank (see [The AI judge](#the-ai-judge)),
it also rates how readily players would think of it, on the same 1–6 scale. That rating is used
exactly like a curated familiarity: weight 6^(f − 1), added to the prompt's total. The results
mark such answers with an AI tag and their score's source reads "Claude's estimate", so it is
never mistaken for player data. The first rating given for an
answer is stored and reused, so everyone who gives it is scored alike (on the claude.ai page, the
most common rating among the viewers' stored rulings). Real answers blend in on top exactly as
for curated answers (Method A).

If the judge accepts an entry the bank already knows but had not listed for this prompt (a dish
missing a "spicy" tag, say), the entry keeps its own curated familiarity.

### Method A: real answers (used as soon as there are enough)

Wherever real answers are collected (the reference server, or the shared board of the claude.ai
edition), the estimate is blended with what other players actually answered to the same prompt
in the same official dive:

```
p = (n_answer + α · p0) / (N + α)          α = 100 (the prior is worth 100 "virtual players")
```

- `N` is the number of valid answers other players gave to this prompt in this dive, `n_answer`
  how many of them gave this answer.
- **Your own answer is never counted**, so the first person to find a rare answer is not
  penalised by their own submission.
- **Small-sample protection:** below **25** valid answers the curated estimate is used unchanged
  (the answers are still recorded).
- Confidence recorded with each estimate: low (25–59 answers), medium (60–299), high (300+). As N grows
  the prior's weight fades: at N = 900 it is 10% of the estimate.
- Practice runs and replays of past dives never feed the statistics; only official dailies do.

Example: 40 other players answered the zodiac prompt (30 Tiger, 6 Rat, 4 Dragon).

| Answer | Curated | With data |
|---|---:|---:|
| Tiger | 46.8% → 8 pts | 54.8% → 7 pts |
| Rat | 7.8% → 28 pts | 9.9% → 25 pts |
| Dragon | 7.8% → 28 pts | 8.4% → 27 pts |
| Monkey (nobody) | 1.3% → 47 pts | 0.9% → 51 pts |

Points are fixed at the moment you answer. Later players change later players' scores, never
yours: a dive's score is a record of what was known when it was played.

### Method C: practice

Practice dives never use player data (curated or AI estimates only) and never touch records,
streaks, statistics or leaderboards.

## What counts as valid

An answer is valid only if it resolves to an entry in the prompt's accepted set. Matching goes
from strict to forgiving and never merges two different answers:

1. Clean the input: Unicode NFC, zero-width characters removed, full-width IME characters folded,
   spaces collapsed, wrapping quotes and end punctuation dropped.
2. Exact match against names, Hangul, curated aliases and generated romanizations (Revised
   Romanization with and without sound-change rules, plus a letter-by-letter transliteration).
3. Loose spelling key that folds what romanization systems disagree on: `eo/o`, `eu/u`, `oo/u`,
   `ae/e`, `b/p`, `g/k`, `d/t`, `r/l`, `ch/j`, doubled letters, spaces and hyphens. So *Pusan*
   meets *Busan* and *kimchee* meets *gimchi*. Hangul gets the same treatment for tense/plain
   consonants and ㅐ/ㅔ (떡뽁이 meets 떡볶이).
4. English plural and article fallbacks ("the dragon", "dragons").
5. Moderator-approved community answers for this prompt.
6. If the text is a **real but different** entry (for example a city typed for a mountain
   prompt), it is rejected with that reason: a typo step never turns one real answer into another.
7. Typo tolerance, only when exactly one accepted answer is that close: one edit for 4–10
   letters, two for longer words, one jamo for Hangul words of about two syllables or more.
   Two equally close answers → rejected as ambiguous.

8. Anything the bank still can't place goes to the AI judge when one is available (below).

Reasons shown for a wrong try: outside the category, doesn't fit this prompt, ruled out by the
prompt, wrong language (a prompt can require Korean), ambiguous, already used in this dive, not in
the answer bank (no judge available), and "Claude checked it" with the judge's one-line reason.
A wrong try can be sent to the review queue; it scores nothing now, and a human's approval makes
it count for later players.

Where several entries share a spelling (two kings both called 태조 Taejo), the answer is scored
as the more familiar one, which is the conservative choice.

## The AI judge

The bank decides first: it is instant, free and deterministic. When it can't accept an answer, the
answer may go to Claude (Claude Haiku 5.5 by default) with the prompt in both languages, a sample
of accepted answers (the whole list for a closed prompt), the answers the prompt rules out, what
the bank knows about the text, and the rules. The player's text is passed as a quoted string and
the judge is told never to follow instructions inside it. Claude replies with structured JSON:
valid / invalid / unsure, the standard name and Hangul spelling, a familiarity rating and a short
reason in English and Korean. "Unsure" counts as not valid.

Which answers can go to the judge:

| Bank says | Judge? |
|---|---|
| not in the bank | yes |
| a typo between two answers | yes (it must say which one) |
| a known entry from another topic, or one the prompt's tags don't list | yes, unless the prompt is closed |
| ruled out by the prompt, or by a negative tag ("not spicy") | no: the prompt's rule stands |
| English where the prompt wants the Korean word | no |
| already used in this dive | no |

Then the verdict is placed back into the bank before anything is scored:

- The judge's name or Hangul for the answer is matched against the bank (exact and spelling
  variants only). If it is a listed answer, **it scores as that answer**: typing a common answer
  in an odd spelling can't buy a rare score.
- If it is an answer the prompt rules out, it stays out, whatever the judge said.
- **Closed prompts** (complete lists: the zodiac, Seoul's 25 districts, Line 2 stations, the 24
  solar terms, the kings of Joseon, Goguryeo and Baekje, provinces, national parks, Busan's
  districts) never gain answers: the judge can only recognise a spelling of a listed one.
- On a prompt that wants the Korean word, a Latin-letter answer must read as a romanization of the
  judge's Hangul (loanwords typed in English spelling, like *handphone* for 핸드폰, pass; a
  translation like *love* for 사랑 does not), so a judge slip can't let a translation through.
- A moderator can block an AI-accepted answer; it is then refused for everyone.

Consistency and cost: a verdict is stored per prompt and normalized answer and reused for every
later player (shared through the server's database, or through the claude.ai page's shared
documents, where a majority of viewers' rulings decides). At most **3** answers per prompt go to
the judge; later unknown answers on that prompt are simply not in the bank. The server also caps
judge calls per player per day (150 by default). If the judge can't be reached, the try is judged
as the bank saw it, with no time penalty.

Where the judge runs: the server's own API key (server edition), Claude on the viewer's own
account through the page (claude.ai edition, asks permission once), or the player's own API key
entered in Settings (standalone page). Without any of these the bank decides alone.

## Tries

As in Krillion, a wrong answer does not end the prompt:

- A short label says it didn't count ("Already used", "Doesn't fit", "Invalid answer"...), the
  prompt stays open and the clock loses **2 seconds**. Try again as often as the time allows. If
  the penalty uses up the clock, the prompt ends with 0.
- Your first accepted answer scores; the earlier tries are kept with the result, and rejected
  ones can be sent for review from the results screen.
- In untimed practice, **Pass** ends the prompt at once for 0.
- In untimed practice there is no penalty.

## Time

- 20 seconds per prompt by default (a prompt can set its own `timer`; practice can be untimed).
- The deadline is fixed when the prompt opens and saved with the run, so a reload resumes the same
  clock instead of restarting it.
- **The clock is paused while the AI judge checks an answer**, and the judging time is not counted
  as the player's: an accepted answer's time is when it was submitted.
- Answers arriving up to **800 ms** after the deadline are accepted (network and rendering slack).
  Later answers are recorded as a timeout and score 0.
- On the reference server the server's clock decides, not the browser's, and one action at a time
  is processed per dive (an expiry waits for an answer that is being judged).
- Once a prompt is answered, further submissions are ignored.

## Depth

```
depth (m) = 10 × total points            700 points = 7,000 m
```

| Zone | Depth |
|---|---|
| Surface waters 햇빛의 바다 | 0–200 m |
| Twilight zone 어스름의 바다 | 200–1,000 m |
| Midnight zone 한밤의 바다 | 1,000–4,000 m |
| Abyssal zone 심연 | 4,000–6,000 m |
| Hadal zone 해구 | 6,000–7,000 m |

A perfect 700 reaches the trench floor and Yonggung, the Dragon King's palace.

## Titles

Titles describe the depth reached and nothing else. They never claim a measured rank or
percentile.

| From | Title |
|---:|---|
| 0 | Surface Dweller |
| 20 | Twilight Drifter |
| 100 | Midnight Swimmer |
| 200 | Lantern Bearer |
| 300 | Pressure Diver |
| 400 | Abyss Explorer |
| 500 | Trench Scholar |
| 600 | Hadal Legend |
| 700 | Guest of the Dragon King |

## Results details

- **Strongest answer:** the highest-scoring valid answer.
- **Tries:** wrong tries per prompt are listed; AI-judged answers are marked.
- **Consistency:** *patchy* when half or fewer prompts got a valid answer; otherwise *spiky*
  when the best score is 40+ above the median, *steady* when valid scores have a standard
  deviation under 12, else *mixed*.
- **Category totals:** points per category in this dive.

## Leaderboards (only where real players exist)

Higher score ranks higher. Equal scores share a rank (1, 2, 2, 4); within a shared rank the
earlier finisher is listed first. Weekly = sum of official dailies in the KST week (Monday to
Sunday). All-time = sum of all official dailies. Only first attempts at official dailies count;
archive replays and practice never appear. No leaderboard is shown where there is no shared
data (the standalone page).

## Changing the model

All constants live in `SCORING` (`src/core/config.ts`): `k`, `famBase`, `priorStrength`,
`minSampleForBlend`, the confidence thresholds, `metersPerPoint` and the tiers. Changing any of
them is a new scoring version: bump `version`, note the change here, and old results keep the
points they were scored with. The rules of play (`wrongTryPenaltyMs`, `aiChecksPerPrompt`, the
timer, the grace window) live in `GAME`.
