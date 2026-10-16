# Content

The answer bank is plain text in `content/` and compiles into the game with `npm run content`.
Every number below is regenerated in [content/REPORT.md](../content/REPORT.md), which also lists
each prompt's curated score profile, the next 14 official dives and any compiler warnings.

## Where it stands

| | Now | Expansion target |
|---|---:|---:|
| Prompts | 285 (all daily-eligible) | 1,000 |
| Accepted answers (entities) | 5,944 | 10,000 |
| Accepted spellings (names, Hangul, aliases, generated romanizations) | 23,805 | — |
| Categories | 12 | 12 |
| Answer pools | 23 | — |

285 prompts with a 30-day cooldown give more than a year of dailies before the schedule has to
reuse prompts more often than once a month. The targets are goals for human editors, not
something to reach by padding: an answer goes in only if it is real and correctly spelled, and
a prompt only if it has at least 12 accepted answers and a clearly common answer.

### Provenance: read this before launching

The pools were **drafted with AI assistance** on 2026-10-11, from general knowledge and the
reference works named in each pool's `# source:` line, then checked by the compiler and by
spot checks. A handful of time-sensitive facts were verified on the web (for example the 2026
K League 2 membership and the 2025 UNESCO inscription of the Bangucheon petroglyphs). **No pool
has had a full human editorial review yet**: every pool says `# reviewed: pending`, and the
report counts them. Before a public launch, a Korean-literate editor should review each pool
(spellings, Hangul, familiarity grades, notes), then set `# reviewed:` to the review date.

The game is upfront about this: How to play explains that rarity is a curated estimate until
players arrive and that the bank is a draft awaiting review, the results show each score's source
on hover, and any player can report a rejected answer.

## Categories

| Id | English | Korean | Prompts |
|---|---|---|---:|
| food | Food & drink | 음식 | 31 |
| geo | Geography | 지리 | 27 |
| history | History | 역사 | 37 |
| ent | K-pop & screen | 대중문화 | 41 |
| lang | Language | 언어 | 19 |
| folk | Folklore | 설화 | 18 |
| sport | Sports | 스포츠 | 16 |
| tech | Tech & industry | 기술·산업 | 18 |
| culture | Culture & life | 문화·생활 | 16 |
| nature | Nature | 자연 | 20 |
| brand | Brands | 브랜드 | 18 |
| assoc | Word association | 연상 | 24 |

## Answer pools (`content/pools/*.psv`)

A pool is a list of real things (dishes, cities, kings, idols, words...) with tags. Prompts select
from pools by tag, so one entry can answer many prompts and its spellings are written once.

```
# pool: food
# title: Korean food | 한국 음식
# category: food
# source: where the list comes from and how to verify it
# drafted: 2026-10-11, AI-assisted
# reviewed: pending                      (date of the last human review, or "pending")
# defaults: dish                         (tags added to every row, optional)
## tags: soup, stew                      (tags added to the rows below, until the next ##)
name | hangul | fam | tags | aliases | note
Kimchi-jjigae | 김치찌개 | 6 | spicy, jjigae | kimchi jjigae, ~kimchi stew | The default stew of every home.
```

| Column | Meaning |
|---|---|
| name | Display name, usually Revised Romanization or the established English name. Its slug is the entry's id (`food:kimchi-jjigae`). |
| hangul | Korean spelling. Optional for things with no Korean name. |
| fam | Familiarity 1–6: 6 = the answer almost everyone gives, 1 = obscure. Drives the curated rarity estimate (see [SCORING.md](SCORING.md)). |
| tags | Comma-separated, combined with `defaults` and `## tags`. |
| aliases | Comma-separated other accepted spellings. `~` marks an English translation (`~fire meat`), which only counts where the prompt accepts English. Hangul aliases are allowed. |
| note | Optional one-line fact for editors. The play screens stay minimal and don't show notes. |

The compiler adds romanizations of the Hangul automatically (Revised Romanization with and
without sound changes, and a letter-by-letter transliteration), and place-style forms for
place tags: `Hallasan` also accepts *Mount Halla*, *Halla mountain*, *Mt Halla*; `Suwon` with tag
`city` accepts *Suwon city*, *Suwon-si* and 수원. Place-suffix tags (`city`, `mountain`, `island`,
`temple`, `palace`, `park`, `station`...) are reserved for place pools; the compiler warns if a
non-place pool uses them, because they would generate odd aliases.

Rules for entries:

- Only real things, spelled as their official or most common source spells them.
- Never leave a guess in the file. A trailing `?` on a name or alias is a compile error.
- Two entries may share a Hangul spelling (two kings named 태조); the display names must differ.
- Notes state facts, not opinions, and nothing that will silently go stale ("currently...").
- Left out on purpose: tragedies and disasters, private individuals, anything sexual,
  and slurs. Living public figures appear only through their public work.

## Prompts (`content/prompts/<category>.json`)

```json
{ "id": "food-spicy", "en": "Name a spicy Korean dish", "ko": "매운 한국 음식을 하나 말해 보세요",
  "pools": "food", "any": ["spicy"], "not": ["drink"], "exc": ["kimchi"], "d": 2 }
```

| Field | Meaning |
|---|---|
| `id` | Permanent id. Never rename or delete a prompt once it has been in a published dive (see below). |
| `en`, `ko` | Prompt text in both languages (both required). |
| `hint` | Optional `{ "en", "ko" }` hint under the prompt. |
| `pools` | Pool id or list of pool ids to draw answers from. |
| `any` / `all` / `not` | Accept entries with any of / all of / none of these tags. |
| `inc` / `exc` | Add / remove specific entries (`pool:id`, or just `id` for the first pool). |
| `only` | `true`: accept only the `inc` list. The pools still explain near misses. |
| `acc` | Accepted answer languages: `ko` (Hangul), `rr` (romanized Korean), `en` (English). Default all three; Korean-language prompts use `["ko", "rr"]` (19 prompts). |
| `fam` | Per-prompt familiarity overrides, e.g. `{ "yong": 5 }`: the dragon is a level-4 creature in general but a level-5 zodiac answer. |
| `d` | Difficulty 1–3. Each daily uses the mix 1, 1, 2, 2, 2, 3, 3 and plays easiest first. |
| `timer` | Seconds, default 20. |
| `max` | Lower ceiling for this prompt's points (default 100). |
| `st` | `approved` (default), `draft` (never used) or `retired`. |
| `from` / `to` | First and last date (KST) the prompt may appear in a daily. |
| `daily` | `false` keeps a prompt practice-only. |
| `closed` | `true` when the bank lists every valid answer (the zodiac, Seoul's districts...). The AI judge may then only recognise spellings of listed answers, never add new ones. 10 prompts use it. |
| `src` | Source for a prompt whose answers need one beyond the pool's source. |
| `note` | Editor note (not shown to players). |

## What the compiler checks

`npm run content:check` exits non-zero on any error; `npm run content` refuses to write output
while errors remain.

Errors: missing headers, unknown category or pool, familiarity outside 1–6, duplicate entry ids
in a pool, placeholder text (`?`), duplicate prompt ids or prompt texts, missing English or Korean
text, unknown entities in `inc`/`exc`/`fam`, bad `acc`/`d` values, `only` without `inc`, a malformed
`# reviewed:` value, prompts with fewer than 4 accepted answers, and any problem with the
published schedule (below).

Warnings: tags that no entry in the prompt's pools uses (a typo in a tag silently empties a
prompt otherwise), two entries normalizing to the same name, place-alias tags outside place
pools, prompts with fewer than 12 answers (practice-only), prompts whose most familiar answer
already scores over 30 (no obvious answer, so the prompt feels unfair), pools without a source.

The test suite (`npm test`) also compiles the real bank and checks, among other things, that
every prompt has a clearly common answer and enough answers, that Korean-language prompts reject
English, and that every pool documents its source and review state.

## The published schedule never changes

Each day's seven prompts are chosen by a seeded algorithm from the content, the date and the
selection version (`select-v1`), so every device agrees without a server. The catch: editing the
content could change what the algorithm picks, which would silently rewrite past dives (and
today's, mid-day).

So `npm run content` **freezes** the schedule in `content/schedule.lock.json`: every day from the
first dive (2026-10-04) through today + 14 days (KST) is recorded once and never recomputed.
Locked days are replayed exactly; days beyond the lock are picked by the algorithm, which sees the
locked days in its 30-day cooldown history. The 14-day lead also means players still running an
older build agree with a new build on every upcoming dive.

Rules that follow from this:

- **Never delete or rename a published prompt**, and never rename the pool entries it accepts
  (an entry's id is the slug of its name; statistics and old results refer to it). Fix a prompt's
  answers freely; retire it with `"to": "YYYY-MM-DD"` or `"st": "retired"`; add a better spelling
  of an entry as an alias rather than changing its name. Deleting a locked prompt is a compile
  error.
- Retiring a prompt does not remove it from days already locked: published dives are history.
- Points are fixed when an answer is given, so editing a prompt that is live today (new answers,
  new familiarity grades) treats earlier and later players differently. Ship such edits between
  dives when you can; REPORT.md lists the next 14 days.
- Commit `schedule.lock.json` with every content change, and run `npm run content` at least once
  every two weeks (any build does) so the lock stays ahead of today.
- Changing the selection algorithm or its constants means a new `selectionVersion`; the lock keeps
  the past intact either way.

## Adding content

1. Add rows to a pool (or a new `content/pools/<id>.psv`), or prompts to the category file.
   For bulk additions use the CSV importer, which validates rows, skips anything already in the
   pool and never overwrites:
   ```bash
   node --import tsx scripts/import-csv.ts new-dishes.csv food              # dry run
   node --import tsx scripts/import-csv.ts new-dishes.csv food --section "tags: soup" --write
   ```
   CSV columns: `name, hangul, fam, tags, aliases, note` (aliases separated by `;`), plus an
   optional `pool` column: rows for other pools are skipped, so one file can be imported pool by
   pool.
2. `npm run content` and read the new `content/REPORT.md`: errors, warnings, and the score profile
   of every prompt you touched (is the most familiar answer cheap? are there too many 100s?).
3. `npm test`, then `npm run build`.

## The AI judge and the bank

Answers the bank can't place can be checked by Claude ([SCORING.md](SCORING.md#the-ai-judge)).
That makes gaps in the bank much less painful for players, but it doesn't replace the bank: the
bank is instant and free, scores familiar answers correctly, and states the rules (exclusions,
closed lists, required language) that the judge can't override. Treat the judge's acceptances as
a stream of suggestions: the claude.ai Review screen and the server's `/api/ai-answers` list them
with how often they were given, both can block bad ones, and the CSV export includes them (with
the judge's familiarity filled in) for the importer.

## Player reports and the review queue

When a try is rejected (not in the bank, doesn't fit, ruled out, wrong language, ambiguous, or
turned down by the AI judge), the results screen offers **Report an answer**: it lists the
dive's rejected tries, each with **Send for review** and an optional note. Reports go to the
review queue:

- **claude.ai edition:** the page owner (and editors) see the queue on the Review screen, grouped
  by prompt and answer, with an optional AI second opinion (Claude's verdict, standard spelling and
  Hangul). The AI never approves anything; a person presses Approve or Dismiss.
- **Server edition:** `GET /api/reports`, `POST /api/reports/:id/approve` and `.../dismiss` with
  the `x-admin-token` header ([DEPLOY.md](DEPLOY.md)). Players are limited to 50 reports a day.
- **Standalone page:** reports stay on the player's device.

An approved answer counts for **later** players straight away (as the rarest curated grade); the
player who reported it keeps their original score. Approved answers still belong in the bank: the
Review screen's **Export approved answers (CSV)** button, or `GET /api/approved` on the server,
produces a file for the importer above, with the prompt's tags pre-filled for an editor to check.
