# Deploying HAN-GUK.IO

There are three editions of the same build. They share all game rules (`src/core/`); they differ
in where data lives and who keeps the clock.

| | Standalone page | claude.ai artifact | Reference server |
|---|---|---|---|
| File | `dist/index.html` | `dist/hanguk-io.artifact.html` | `dist/index.html` served by `server/` |
| Clock and scoring | player's browser | player's browser | **server** |
| Records | this browser | private per-viewer cloud profile (+ browser) | server (+ browser) |
| Rarity data | curated only | answers of everyone on the page's board | all players' official answers |
| Leaderboards | none | daily / weekly / all-time among page viewers | daily / weekly / all-time |
| AI answer checking | player's own Anthropic API key (Settings) | Claude on each viewer's own account (`sample`) | operator's `ANTHROPIC_API_KEY` |
| Shared AI rulings | this browser | between the page's viewers (majority) | all players (database) |
| Review queue | reports stay on the device | owner reviews in the game, optional AI opinion | admin API |
| One official dive per day | per browser | per viewer | per player session, enforced by the database |

The page detects its edition at run time: it uses the server when it is served by one (same-origin
`/api/health`), the artifact capabilities when they are granted, and falls back to the standalone
behaviour otherwise. It never pretends: no leaderboard is shown without shared data.

## Build

Requirements: Node.js 22.5+ (the server uses the built-in `node:sqlite`).

```bash
npm install          # then commit package-lock.json and use `npm ci` from then on
npm run build        # content (and schedule lock) -> assets -> dist/
```

`npm run build` writes three self-contained files (everything inlined: React, the game, the
answer bank, styles, art; about 1.2 MB, roughly 370 KB gzipped):

- `dist/index.html`: the full page.
- `dist/hanguk-io.artifact.html`: the same game as a page body for publishing as an artifact.
- `dist/gallery.html`: a gallery of all the original illustrations.

The only external request is the optional Google Fonts stylesheet (Hahmlet, IBM Plex Sans KR,
IBM Plex Mono); without it the page uses system Korean fonts.

Run `npm run build` (or at least `npm run content`) at least every two weeks and commit
`content/schedule.lock.json`, so the frozen schedule stays ahead of today (see
[CONTENT.md](CONTENT.md#the-published-schedule-never-changes)).

## 1. Standalone page (any static host)

Upload `dist/index.html` to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3...).
Serve it with `Cache-Control: no-cache` so content updates reach players; the schedule lock keeps
older cached copies in agreement with new ones for two weeks anyway.

Everything works offline after the first load except the web fonts. Records live in the
browser's `localStorage`; there is no leaderboard and rarity uses curated estimates only.

AI answer checking is off until a player pastes their own Anthropic API key in Settings. The key
stays in that browser's `localStorage` and is sent only to `https://api.anthropic.com` (the page
uses the API's browser opt-in header, `anthropic-dangerous-direct-browser-access`). That is fine
for a personal copy; never ship a page with a key built in.

## 2. claude.ai artifact

Publish `dist/hanguk-io.artifact.html` as an artifact with these capabilities:

```json
{
  "db": {
    "rules": [
      { "path": "board", "read": "view", "write": "owner" },
      { "path": "board/{self}", "write": "interact" },
      { "path": "reports", "read": "admin", "write": "admin" },
      { "path": "reports/{self}", "read": "interact", "write": "interact" },
      { "path": "approved", "read": "view", "write": "admin" },
      { "path": "verdicts", "read": "view", "write": "owner" },
      { "path": "verdicts/{self}", "write": "interact" }
    ]
  },
  "user": {},
  "sample": {},
  "downloads": true
}
```

What each one does:

- **db**: shared documents for the page.
  - `board/<viewer id>`: one document per player: display name, official daily results (score,
    depth, answer ids per prompt, finish time, scoring version; last 120 days) and all-time
    totals. The first published result for a dive is final. Everyone can read every board (that is the leaderboard, and it is where rarity is
    measured); each player can only write their own (`{self}`), and only with at least
    "can interact" access.
  - `data/users/<viewer id>/profile`: the private profile (records, streaks, achievements,
    settings, a dive in progress). Private to that viewer, even from the owner.
  - `reports/<viewer id>`: a player's review requests; readable by that player and by the
    owner/editors, who set their status.
  - `approved/answers`: answers approved by the owner, and `approved/blocked`: AI-accepted
    answers the owner blocked. Readable by all, writable by the owner/editors.
  - `verdicts/<viewer id>`: the AI rulings this viewer's checks produced (newest 400) and the
    familiarity of the new answers they accepted. Everyone reads all of them, so the same answer
    gets the same ruling and score for everyone (the majority of viewers' rulings decides); each
    viewer writes only their own.
- **user**: the viewer's id (to key the documents above) and whether they own or can edit
  the page (the Review screen is for owners and editors).
- **sample**: the AI answer judge. An answer the bank can't place is sent to Claude (the fast
  tier) on the viewer's own Claude account; the first check asks the viewer's permission, and
  identical checks are cached for a day. Also the owner's optional AI second opinion on the
  Review screen. A viewer who declines plays with the answer bank alone.
- **downloads**: saving the PNG share card and the approved-answers CSV.

Every capability is optional at run time: a viewer who declines one, or a view where it is not
available, gets the rest of the game (a viewer without "interact" access can play, but their
results are not published to the board). Results are only published for first attempts at the
official daily.

Trust model: in this edition each browser scores its own answers, so the leaderboard is as
trustworthy as the people who can open the page. Share it with people you would play cards with,
or use the server edition.

## 3. Reference server

```bash
npm install && npm run build
PORT=8787 DB_PATH=/var/lib/hanguk/hanguk.sqlite ADMIN_TOKEN="$(openssl rand -hex 24)" npm run server
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port. |
| `DB_PATH` | `data/hanguk.sqlite` | SQLite database file (created on first start; WAL mode). |
| `ADMIN_TOKEN` | unset | Enables the moderation API (`x-admin-token` header). Use a long random value. |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. Leave unset otherwise: the header is client-controlled. |
| `ANTHROPIC_API_KEY` | unset | Turns on AI answer checking (the server calls the Claude API). Without it the bank decides alone. |
| `HANGUK_JUDGE_MODEL` | `claude-haiku-5-5` | Judge model. `claude-sonnet-5-5` is more careful and slower. |
| `HANGUK_AI_PER_DAY` | `150` | AI checks per player per day (cost control). Each prompt allows at most 3. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | For a proxy or for tests (`scripts/mock-claude.mjs`). |

The server runs TypeScript through `tsx`, so install dev dependencies on the server too
(plain `npm install` / `npm ci`, not `--omit=dev`).

It serves the game at `/` and the JSON API under `/api/`. The page finds the API by itself.

### What the server enforces

- The daily for "today" in KST (UTC+9, no DST); no peeking at tomorrow; no cron job needed.
- One official daily per player (unique index on player + challenge). Archive and practice runs
  are unlimited and never affect statistics or boards.
- Deadlines on the server's clock with an 800 ms grace window; answers are scored on the server
  with live statistics from other players (never the player's own), blended once 25 or more
  valid answers exist (see [SCORING.md](SCORING.md)).
- Today's answer distribution (`GET /api/stats/daily-YYYY-MM-DD`) is hidden from a player until
  they have finished today's dive.
- AI judging on the server: one action at a time per dive (an expiry waits for an answer being
  judged), the clock paused while the judge thinks, rulings and new answers' familiarity stored
  in `ai_verdicts` / `ai_answers` and reused for every player, at most 3 judge calls per prompt
  and `HANGUK_AI_PER_DAY` per player, and a judge failure counts as "not in the bank" with no
  time penalty. Each judge call is one short Messages API request (structured JSON output, low
  effort, a few hundred output tokens at most).
- Rate limits: 240 requests per minute and 60 new player sessions per hour per client address;
  50 reports per player per day; 16 KB request bodies.
- Player tokens are random 192-bit bearer tokens stored only as SHA-256 hashes. No emails or
  passwords are collected; display names are optional (24 characters).
- Responses carry `nosniff`, `no-referrer` and `DENY` framing headers.

### Production checklist

1. **TLS**: put the server behind a reverse proxy that terminates HTTPS, for example Caddy:
   ```
   hanguk.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```
   and start the server with `TRUST_PROXY=1`.
2. **Process manager**: a systemd unit, for example:
   ```ini
   [Service]
   WorkingDirectory=/srv/hanguk-io
   Environment=PORT=8787 DB_PATH=/var/lib/hanguk/hanguk.sqlite TRUST_PROXY=1
   EnvironmentFile=/etc/hanguk/secrets   # ADMIN_TOKEN=...
   ExecStart=/usr/bin/npm run server
   Restart=on-failure
   User=hanguk
   ```
3. **Backups**: SQLite in WAL mode can be copied safely with its own backup command, for example
   nightly: `sqlite3 /var/lib/hanguk/hanguk.sqlite ".backup '/backups/hanguk-$(date +%F).sqlite'"`.
4. **Content updates**: pull, `npm run build` (which extends the schedule lock), restart. Players
   with a dive in progress keep it: runs are stored with their prompts and deadlines.
5. **Monitoring**: `GET /api/health` returns the server time, today's date and the content,
   scoring and selection versions.

### API

All game routes need `Authorization: Bearer <token>` from `POST /api/session`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Server time, KST date, versions, and whether AI checking is on (`ai`). |
| `POST /api/session` `{name?}` | New player: returns `{playerId, token}`. |
| `POST /api/players/me` `{name}` | Set the display name. |
| `GET /api/daily[?date=YYYY-MM-DD]` | Today's or a past challenge (prompt ids and number). |
| `POST /api/runs` `{mode: daily \| archive \| practice, dateKey?, count?, categories?, timer?}` | Start a run (the daily only once). |
| `GET /api/runs/:id` | A player's own run. |
| `POST /api/runs/:id/open` | Show the current prompt and start its clock. |
| `POST /api/runs/:id/answer` `{input}` | Submit a try. Returns `record` when the prompt ends (accepted, or the penalty used up the clock) and/or `attempt` for a wrong try. May take a few seconds when the AI judge is asked. |
| `POST /api/runs/:id/expire` | Record a timeout once the deadline has passed. |
| `POST /api/runs/:id/skip` | Pass on the current prompt (0 points). |
| `POST /api/runs/:id/advance` | Next prompt, or finish. |
| `GET /api/leaderboard?type=daily\|weekly\|alltime[&date=]` | Rankings (ties share a rank). |
| `GET /api/stats/daily-YYYY-MM-DD` | Answer distribution (today's only after finishing). |
| `POST /api/reports` `{promptId, input, reason?, note?}` | Send an answer for review. |
| `GET /api/approved` | Approved answers per prompt. |

Moderation (header `x-admin-token: $ADMIN_TOKEN`):

```bash
curl -s -H "x-admin-token: $ADMIN_TOKEN" https://hanguk.example.com/api/reports
curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" https://hanguk.example.com/api/reports/42/approve
curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" https://hanguk.example.com/api/reports/42/dismiss
# answers the AI judge accepted that are not in the bank (with how often they were given)
curl -s -H "x-admin-token: $ADMIN_TOKEN" https://hanguk.example.com/api/ai-answers
curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"promptId":"food-street","answerKey":"ai:h:호떡빵"}' https://hanguk.example.com/api/ai-answers/block
```

Approving makes the answer count for later players immediately; blocking an AI-accepted answer
refuses it for later players. Fold approved and good AI-accepted answers into the answer bank
with `scripts/import-csv.ts` ([CONTENT.md](CONTENT.md)).
