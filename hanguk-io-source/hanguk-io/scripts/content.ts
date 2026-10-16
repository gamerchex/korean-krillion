// Content pipeline: validate + compile the answer bank, write the game's content JSON and a
// human-readable quality report, and freeze the official schedule ahead of time.
//
//   npm run content          compile, extend content/schedule.lock.json, write
//                            src/generated/content.json + content/REPORT.md
//   npm run content:check    validate only (exit 1 on errors); never touches the lock

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { compileContent, encodeContent, type Issue, type RawPrompt } from '../src/core/compile';
import { ContentModel } from '../src/core/content';
import { GAME, SCORING } from '../src/core/config';
import { Scheduler, kstDateKey, addDays } from '../src/core/daily';
import { promptScoreProfile } from '../src/core/rarity';
import type { CategoryId } from '../src/core/types';

const ROOT = join(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');

const poolDir = join(ROOT, 'content/pools');
const promptDir = join(ROOT, 'content/prompts');
const pools = readdirSync(poolDir)
  .filter((f) => f.endsWith('.psv'))
  .sort()
  .map((f) => ({ file: `pools/${f}`, text: readFileSync(join(poolDir, f), 'utf8') }));
const prompts = readdirSync(promptDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    file: `prompts/${f}`,
    category: basename(f, '.json') as CategoryId,
    items: JSON.parse(readFileSync(join(promptDir, f), 'utf8')) as RawPrompt[],
  }));

const lockPath = join(ROOT, 'content/schedule.lock.json');
const lock: Record<string, string[]> = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};

const { content, issues } = compileContent({ pools, prompts, epoch: GAME.epoch, minAnswersForDaily: GAME.minAnswersForDaily, schedule: lock });
const model = new ContentModel(content);

// Prompt-level quality checks that need the full model.
const promptRows: string[] = [];
let dailyEligible = 0;
for (const p of content.prompts) {
  const rt = model.runtime(p.id);
  const where = `prompt ${p.id}`;
  const n = rt.accepted.size;
  if (n < 4) issues.push({ level: 'error', where, message: `Only ${n} accepted answers` });
  else if (n < GAME.minAnswersForDaily) issues.push({ level: 'warning', where, message: `${n} answers: practice-only (daily needs ${GAME.minAnswersForDaily})` });
  const prof = promptScoreProfile(model, p.id);
  if (n >= 4 && prof.min > 30) issues.push({ level: 'warning', where, message: `No clearly common answer: the most familiar scores ${prof.min}` });
  if (p.status === 'approved' && p.daily && n >= GAME.minAnswersForDaily) dailyEligible++;
  promptRows.push(
    `| ${p.id} | ${p.category} | ${p.difficulty} | ${n} | ${prof.min} | ${prof.median} | ${prof.max} | ${prof.legendary} | ${prof.top.map((t) => t.name).join(', ')} |`,
  );
}

const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');
const totalAliases = content.entities.reduce((s, e) => s + e.aliases.length, 0);
const acceptedStrings = content.entities.reduce((s, e) => s + 1 + (e.hangul ? 1 : 0) + e.aliases.length, 0);

console.log(`Pools: ${Object.keys(content.pools).length}  Entities: ${content.entities.length}  Accepted strings: ${acceptedStrings}`);
console.log(`Prompts: ${content.prompts.length} (${dailyEligible} daily-eligible)  Errors: ${errors.length}  Warnings: ${warnings.length}`);
for (const i of errors.slice(0, 50)) console.log(`  ERROR ${i.where}: ${i.message}`);
if (process.argv.includes('--verbose')) for (const i of warnings) console.log(`  warn  ${i.where}: ${i.message}`);

if (checkOnly) process.exit(errors.length ? 1 : 0);
if (errors.length) {
  console.log('Not writing anything until the errors above are fixed.');
  process.exit(1);
}

// --- Freeze the schedule ---------------------------------------------------------------------
// Every day up to today + publishAheadDays (KST) is computed once and then never recomputed.
// Existing entries are never modified; only new days are appended.
const today = kstDateKey(Date.now());
const horizon = addDays(today, GAME.publishAheadDays);
const sched = new Scheduler(model);
let added = 0;
for (let d = GAME.epoch; d <= horizon; d = addDays(d, 1)) {
  if (lock[d]) continue;
  lock[d] = sched.promptIdsFor(d);
  added++;
}
const sortedLock = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(lockPath, '{\n' + Object.entries(sortedLock).map(([d, ids]) => `  ${JSON.stringify(d)}: ${JSON.stringify(ids)}`).join(',\n') + '\n}\n');
content.schedule = sortedLock;
console.log(`Schedule lock: ${Object.keys(sortedLock).length} published days through ${horizon} (${added} new)`);

// --- Write outputs ---------------------------------------------------------------------------
mkdirSync(join(ROOT, 'src/generated'), { recursive: true });
writeFileSync(join(ROOT, 'src/generated/content.json'), JSON.stringify(encodeContent(content)));

const byCat = new Map<string, { prompts: number; entities: Set<string> }>();
for (const c of content.categories) byCat.set(c.id, { prompts: 0, entities: new Set() });
for (const p of content.prompts) {
  const row = byCat.get(p.category)!;
  row.prompts++;
  for (const k of model.runtime(p.id).accepted) row.entities.add(k);
}
const poolRows = Object.values(content.pools).map((p) => {
  const ents = content.entities.filter((e) => e.pool === p.id);
  return `| ${p.id} | ${p.title.en} | ${ents.length} | ${p.drafted ?? '-'} | ${p.reviewed} | ${p.source.replace(/\|/g, '/')} |`;
});

const lockedSched = new Scheduler(new ContentModel(content));
const preview: string[] = [];
for (let i = 0; i < 14; i++) {
  const d = addDays(today, i);
  const ch = lockedSched.forDate(d);
  if (ch) preview.push(`| ${d} | #${ch.number} | ${ch.promptIds.map((id) => `${id} (${model.prompt(id)!.category})`).join(', ')} |`);
}

const md = `# Content report

Generated ${new Date().toISOString()} for content version \`${content.version}\` (scoring \`${SCORING.version}\`).
This file is written by \`npm run content\`; do not edit by hand.

## Totals

- Pools: **${Object.keys(content.pools).length}**
- Accepted answers (entities): **${content.entities.length}**
- Accepted strings (names + Hangul + aliases, incl. generated romanizations): **${acceptedStrings}** (${totalAliases} aliases)
- Prompts: **${content.prompts.length}**, of which **${dailyEligible}** are eligible for the official daily
- Categories: **${content.categories.length}**
- Errors: **${errors.length}**, warnings: **${warnings.length}**
- Pools awaiting human editorial review: **${Object.values(content.pools).filter((p) => p.reviewed === 'pending').length}** of ${Object.keys(content.pools).length}

## By category

| Category | Prompts | Distinct accepted answers |
|---|---|---|
${content.categories.map((c) => `| ${c.name.en} | ${byCat.get(c.id)!.prompts} | ${byCat.get(c.id)!.entities.size} |`).join('\n')}

## Pools

| Pool | Title | Entries | Drafted | Human review | Source / verification note |
|---|---|---|---|---|---|
${poolRows.join('\n')}

## Prompts and curated score profile

Points each accepted answer would earn from the curated prior alone (no player data yet).
"min" is the most familiar answer, "max" the rarest.

| Prompt | Category | Difficulty | Answers | Min | Median | Max | 100-pt answers | Most familiar |
|---|---|---|---|---|---|---|---|---|
${promptRows.join('\n')}

## Official schedule preview (KST)

Frozen in \`content/schedule.lock.json\` through ${horizon}: later content edits cannot change these days.

| Date | Dive | Prompts |
|---|---|---|
${preview.join('\n')}

## Issues

${issues.length ? issues.map((i: Issue) => `- **${i.level}** \`${i.where}\` ${i.message}`).join('\n') : 'None.'}
`;
writeFileSync(join(ROOT, 'content/REPORT.md'), md);
console.log('Wrote src/generated/content.json and content/REPORT.md');
if (errors.length) process.exit(1);
