# Features and limitations

Status as of 2026-10-16 (KST), content version in [content/REPORT.md](../content/REPORT.md).
"Tested" means covered by the automated suites (`npm test`, 152 tests) and/or the headless
browser run (`npm run e2e`), which plays a complete seven-prompt daily dive (with a wrong try, an
AI-judged answer and a timeout) in both the standalone page and against the reference server,
with the Claude API replaced by a local fake, on desktop and phone viewports.

## Working

### Playing

- **Daily dive**: the same seven prompts for everyone each KST day, picked deterministically
  (seeded by date and selection version), seven categories when possible, difficulty mix
  1-1-2-2-2-3-3 played easiest first, 30-day cooldown per prompt. No rerolls. Past and the next
  14 days are frozen in `content/schedule.lock.json`, so content edits can't rewrite them. Tested.
- **One official attempt**: the first daily attempt is the official one; finishing again shows
  the stored result. A reload mid-dive resumes the same run with the same deadline. Tested.
- **Archive**: replay any past daily (since dive #1 on 2026-10-04); never affects records or
  boards. Tested.
- **Practice**: 3, 5, 7 or 10 prompts, any categories, 20-second timer or untimed; avoids recently
  practised prompts; curated scoring only; never affects records. Tested.
- **Answers** in Hangul, romanized Korean or English (Korean-language prompts require Korean).
  IME-safe: pressing Enter to confirm a Hangul composition never submits early.
- **Multiple tries** (as in Krillion): a wrong answer gets a short label ("Already used",
  "Doesn't fit", "Korean word only", "Invalid answer"...), costs 2 seconds and leaves the prompt
  open; the first accepted answer scores. In untimed practice **Pass** gives up a prompt. Tested.
- **Timer**: 20 s, deadline fixed at prompt open, paused while the AI judge checks an answer,
  800 ms grace, ticking in the last five seconds, timeout scores 0. Tested (including the grace
  window, late answers, penalties that use up the clock and the pause).
- **Minimal play screen** (in the spirit of Krillion): a small HUD (menu, depth, seven progress
  stripes with n/7, score, sound), a compact prompt box (about 460 px wide on desktop, full width
  with 16 px margins on a phone) with the prompt in both languages, the one-line answer field
  directly beneath it with a ring timer and a small Dive button, and nothing else. No navigation
  bar during a dive, nothing scrolls, and on a phone the prompt, field and timer stay in the top
  half of the screen, clear of the keyboard. Tested on desktop and phone sizes.
- **Feedback** after each prompt, in the answer field's place: the answer as it counted (with its
  Hangul), a small rarity mark and the points, while the score counts up; or "Time's up". No
  answer key, no other answers, no explanations. The next prompt opens by itself after about a
  second and a half (Enter skips the wait); the results open after the seventh. Tested.
- **Results**: score out of 700 (counted up), depth, zone, title (in both languages), a tier
  stripe per prompt, the seven answers with their points (hover a score for its estimate's
  source), leaderboard position only where a real board exists, personal best, achievements,
  spoiler-free share text, PNG share card (no answers, no names), and "Report an answer" for
  rejected tries. Fits one screen at 1280 × 860 and 390 × 844. Tested.
- **Records**: personal bests, history, current and best streaks, per-category totals and 28
  achievements.

### Scoring and validation

- Transparent log-rarity scoring, tiers, curated estimate (Method B), blending with real answers
  once 25+ other players have answered (Method A, own answer excluded, confidence shown),
  curated-only practice (Method C), scoring version recorded on every result. See
  [SCORING.md](SCORING.md). Tested, including zero and maximum scores.
- Answer matching with Unicode/IME normalization, romanization folding, generated
  romanizations, place-name forms, plurals and articles, typo tolerance only when unambiguous,
  and explicit reasons for every wrong try. A real but different answer is never typo-corrected
  into an accepted one. Tested.
- **AI answer checking**: answers the bank can't place go to Claude, which rules on whether they
  are real and fit, names them and rates their familiarity. The ruling is placed back into the
  bank (a new spelling of a listed answer scores as that answer), exclusions, negative filters,
  closed lists (10 complete-list prompts) and the Korean-word rule always win, at most 3 checks per
  prompt, the same ruling and score for everyone (shared cache), moderators can block AI answers,
  and a judge outage falls back to the bank with no penalty. Prompt-injection hardened (the answer
  is passed as quoted data; structured output). Tested with fake judges (unit, server and browser).
- No reuse of the same answer within a dive (AI-accepted answers included). Tested.

### Review and moderation

- Rejected answers can be sent for review with a note.
- claude.ai edition: an in-game review queue for the page owner and editors, grouped by answer,
  with an optional AI second opinion; approved answers count for later players at once; a list
  of Claude-accepted new answers with Block/Unblock; CSV export of approved and AI-accepted
  answers for the content importer.
- Server edition: the same flow through an admin API (`x-admin-token`), including listing and
  blocking AI-accepted answers (`/api/ai-answers`).
- Content importer (`scripts/import-csv.ts`): validates, skips existing entries, never
  overwrites, dry run by default.

### Editions

- **Standalone page** (`dist/index.html`): everything local, no leaderboard; AI checking with
  the player's own Anthropic API key (Settings; key kept in the browser, sent only to
  api.anthropic.com).
- **claude.ai artifact**: private per-viewer cloud profile, shared daily/weekly/all-time boards
  and live rarity measurement among the page's viewers, owner review queue, AI checking through
  the page's `sample` capability on each viewer's own Claude account, with rulings shared between
  viewers. Every capability degrades gracefully when declined or unavailable. Exercised locally
  against a fake claude.ai runtime (judging, shared rulings, blocking).
- **Reference server** (`server/`): authoritative clock and scoring, AI judge with the operator's
  API key (`ANTHROPIC_API_KEY`), one daily per player enforced in the database, live statistics,
  leaderboards (ties share a rank), hidden answer distribution until you finish, rate limits,
  hashed tokens, moderation API, one action at a time per dive. Tested in-process (14 integration
  tests) and end to end in a browser against a mock Claude API (`scripts/mock-claude.mjs`).

### Ocean, art and sound

- Canvas descent through five zones with light shafts, marine snow, bioluminescent sparks,
  reef, slope and trench walls, vent plumes and a Yonggung finale for a perfect 700; the diving
  bell sinks with your score and pings a tier-coloured sonar ring on each accepted answer.
- 48 original SVG illustrations (47 sea creatures and scenes from 0 to 7,000 m, plus the bell)
  and 14 procedural environment layers; manifest with provenance in [ASSETS.md](../ASSETS.md) and
  `assets/manifest.json`; gallery page in `dist/gallery.html`.
- 11 synthesized sounds (WebAudio): ambience and a drone that darken with depth, gayageum-like
  plucks on a Korean pentatonic scale, a temple bell, bubbles, sonar, ticks. Separate music and
  effects volumes and a mute switch. Sound starts only after the first interaction.

### Accessibility and language

- Full English and Korean interface (switchable any time); prompts and answers bilingual.
- Keyboard: type and press Enter to answer (Enter again skips the wait after a result), Escape
  closes the menu and dialogs; visible focus; dialogs trap focus.
- Reduced motion (follows the system setting, or force on/off) and a high-contrast mode.
- Tiers are distinguished by shape and label, not colour alone; a live region announces each
  prompt and each result, and the timer when it is urgent.
- Responsive from phone width (tested at 390 × 844) to desktop.

### Tooling

- Content compiler with errors and warnings, generated content report, schedule lock,
  asset manifest generator, CSV importer, single-file build, dev server.
- 138 unit tests (normalization, romanization, matching, rarity, engine, tries, AI judging,
  judge prompt and API client, timing, daily schedule, KST boundaries, schedule lock,
  persistence, results, leaderboards, content schema) + 14 server tests + a Playwright
  end-to-end script with screenshots and a mock Claude API, which also checks the layout rules
  (compact column, field under the prompt, no scrolling, short feedback with no answer key).

## Limitations and what is not done

Listed plainly so nobody launches on wrong assumptions.

### Content

- **The answer bank is an AI-assisted draft.** All 23 pools are marked `# reviewed: pending`.
  Spellings, Hangul, familiarity grades and notes need a review by a Korean-literate editor before
  a public launch. Expect some errors and some debatable familiarity grades.
- **The Korean interface text is also AI-drafted** and should be reviewed by a native speaker.
- **Size**: 285 prompts and 5,944 answers, against expansion targets of 1,000 and 10,000. Long,
  open-ended prompts (any K-drama, any K-pop song) can't list every valid answer; real answers
  missing from the bank are rejected as "not in the bank yet" until someone approves them.
- **Rarity is editorial until players arrive.** Curated familiarity grades are informed guesses;
  How to play says so and the results show each score's source on hover. Only the server and artifact editions
  collect real answers, and they are used only above 25 answers per prompt per dive.

### AI answer checking

- **The AI judge can be wrong** both ways: accept something dubious or reject a real answer. The
  bank-first order, the placement rules, closed lists, the Korean-word check, shared rulings and
  moderator blocks limit the damage, and wrong rejections can be sent for review, but an AI
  ruling is not an editor's review. Watch the AI-accepted list and fold good answers into the bank.
- **AI familiarity ratings are estimates** and can be inconsistent between prompts; real answers
  replace them as they accumulate.
- **It costs something**: the server operator pays for API calls (capped per player per day); on
  claude.ai each viewer's checks use their own Claude usage; the standalone page needs the
  player's own API key.
- **Not tested against the live service here.** The build machine never called the real Claude
  API or the claude.ai runtime; the request format follows the current API documentation (Claude
  Haiku 5.5, structured JSON output, low effort, thinking off) and every code path was exercised
  against faithful fakes. Try one real check after deploying (the Settings "Test" button does).
- On the claude.ai page, shared rulings are written by viewers' browsers: a viewer could forge
  their own ruling document. A majority of viewers' rulings decides, which is fine among friends
  but not tamper-proof.

### Fairness and security

- In the **standalone and artifact editions the browser keeps the clock and scores answers**, so
  a technically minded player can cheat. The artifact leaderboard is a friendly board among the
  people who can open the page. Use the server edition for anything competitive.
- **Server identities are anonymous bearer tokens.** One official daily per token, not per
  human: someone can start a new session to replay the daily (slowed by a limit of 60 new
  sessions per hour per address). There are no accounts, no recovery if the browser's token is
  lost, and no cross-device sync in the server edition.
- The server is a single Node process with SQLite and in-memory rate limits: comfortable for a
  community, not designed for horizontal scaling. No admin web UI (moderation is by API).

### Platform

- Fonts load from Google Fonts; offline (and in the sandbox where the screenshots were taken)
  the page uses system Korean fonts instead.
- Tested in headless Chromium (desktop and phone viewport). Not yet tested on real iOS/Android
  devices, Safari, Firefox, or with a screen reader.
- The sounds are synthesized approximations (no recorded gayageum or bell).
- No accounts, friends, notifications or reminders; sharing is by text and image.
- The build environment had no access to the npm registry (organization policy), so the
  project was built and tested with preinstalled packages at the versions in `package.json`, and
  no `package-lock.json` was generated. Run `npm install` once with registry access and commit the
  lockfile.
