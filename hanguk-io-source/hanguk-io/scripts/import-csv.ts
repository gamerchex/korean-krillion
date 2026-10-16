// Import answers from a CSV file into a pool (content/pools/<pool>.psv).
//
//   node --import tsx scripts/import-csv.ts <file.csv> <pool> [--section "tags: a, b"] [--write]
//
// CSV columns (header row required): name, hangul, fam, tags, aliases, note
//   aliases: semicolon-separated; prefix ~ for English translations ("~fire meat; bulgogi")
//   optional "pool" column: rows for other pools are skipped, so one file (such as the
//   "Export approved answers" CSV from the review screen) can be imported pool by pool.
// Without --write the script only validates and prints the rows it would add. Rows whose
// name or Hangul already exists in the pool are reported and skipped, never overwritten.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePool, slugify, type Issue } from '../src/core/compile';

const ROOT = join(import.meta.dirname, '..');
const [file, poolId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!file || !poolId) {
  console.error('usage: import-csv.ts <file.csv> <pool> [--section "tags: a, b"] [--write]');
  process.exit(2);
}
const write = process.argv.includes('--write');
const sectionIdx = process.argv.indexOf('--section');
const section = sectionIdx > 0 ? process.argv[sectionIdx + 1] : null;

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const poolPath = join(ROOT, 'content/pools', `${poolId}.psv`);
const poolText = readFileSync(poolPath, 'utf8');
const issues: Issue[] = [];
const pool = parsePool(poolText, `${poolId}.psv`, issues);
if (!pool) {
  console.error(`Pool ${poolId} could not be parsed`);
  process.exit(1);
}
const ids = new Set(pool.entities.map((e) => e.id));
const hanguls = new Set(pool.entities.map((e) => e.hangul).filter(Boolean));

const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'));
const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
const ci = { name: col('name'), hangul: col('hangul'), fam: col('fam'), tags: col('tags'), aliases: col('aliases'), note: col('note'), pool: col('pool') };
if (ci.name < 0 || ci.fam < 0) {
  console.error('CSV needs at least "name" and "fam" columns');
  process.exit(1);
}

const out: string[] = [];
let skipped = 0;
let bad = 0;
let otherPool = 0;
rows.forEach((r, i) => {
  const get = (k: keyof typeof ci) => (ci[k] >= 0 ? (r[ci[k]] ?? '').trim() : '');
  if (ci.pool >= 0 && get('pool') && get('pool') !== poolId) {
    otherPool++;
    return;
  }
  const name = get('name').replace(/\|/g, '/');
  const hangul = get('hangul').replace(/\|/g, '/');
  const fam = Number(get('fam'));
  const where = `${file}:${i + 2}`;
  if (!name || !Number.isInteger(fam) || fam < 1 || fam > 6) {
    console.log(`  bad   ${where}: needs a name and fam 1-6`);
    bad++;
    return;
  }
  if (/\?\s*$/.test(name) || get('aliases').split(';').some((a) => a.trim().endsWith('?'))) {
    console.log(`  bad   ${where}: "${name}" looks uncertain (ends with "?")`);
    bad++;
    return;
  }
  if (ids.has(slugify(name)) || (hangul && hanguls.has(hangul))) {
    console.log(`  skip  ${where}: "${name}" is already in ${poolId}`);
    skipped++;
    return;
  }
  ids.add(slugify(name));
  if (hangul) hanguls.add(hangul);
  const aliases = get('aliases')
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .join(', ');
  out.push([name, hangul, String(fam), get('tags'), aliases, get('note').replace(/\|/g, '/')].join(' | ').replace(/\s+$/, ''));
});

console.log(`${out.length} new row(s), ${skipped} already present, ${bad} invalid${otherPool ? `, ${otherPool} for other pools` : ''}`);
if (!write) {
  out.slice(0, 20).forEach((l) => console.log('  + ' + l));
  console.log('Dry run. Add --write to append, then run `npm run content` to check.');
} else if (out.length) {
  const block = `\n${section ? `## ${section}\n` : ''}${out.join('\n')}\n`;
  writeFileSync(poolPath, poolText.replace(/\s*$/, '\n') + block);
  console.log(`Appended to content/pools/${poolId}.psv. Now run: npm run content`);
}
if (bad) process.exitCode = 1;
