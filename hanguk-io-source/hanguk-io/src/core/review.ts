// Review-queue helpers shared by the UI and tests.

import type { ContentModel } from './content';
import { romanize } from './hangul';
import { scriptOf } from './normalize';

/**
 * CSV of moderator-approved answers, laid out for scripts/import-csv.ts (which reads the
 * name, hangul, fam, tags, aliases and note columns and skips rows whose pool column names
 * another pool). Approved answers already count in the game; this moves them into the bank.
 */
export interface AiAnswerRow {
  promptId: string;
  canonical: string;
  hangul?: string;
  familiarity: number;
}

export function approvedCsv(model: ContentModel, approved: Record<string, string[]>, aiAnswers: AiAnswerRow[] = []): { csv: string; rows: number } {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['prompt,pool,name,hangul,fam,tags,aliases,note'];
  for (const a of aiAnswers) {
    const p = model.prompt(a.promptId);
    if (!p) continue;
    const name = a.canonical || (a.hangul ? romanize(a.hangul) : '');
    if (!name) continue;
    const tags = [...(p.all ?? []), ...(p.any ?? []).slice(0, 1)].join(', ');
    const fam = String(Math.max(1, Math.min(6, Math.round(a.familiarity))));
    lines.push([a.promptId, p.pools[0], name.charAt(0).toUpperCase() + name.slice(1), a.hangul ?? '', fam, tags, '', 'Accepted by the AI judge: check it, then set familiarity and tags'].map(q).join(','));
  }
  for (const [pid, texts] of Object.entries(approved)) {
    const p = model.prompt(pid);
    if (!p) continue;
    for (const text of texts) {
      const hangul = scriptOf(text) === 'hangul' ? text : '';
      const rr = hangul ? romanize(hangul) : text;
      const name = rr.charAt(0).toUpperCase() + rr.slice(1);
      const tags = [...(p.all ?? []), ...(p.any ?? []).slice(0, 1)].join(', ');
      const note = p.includeOnly
        ? `Prompt ${pid} accepts only its "inc" list: add the new entry there too`
        : 'Approved in the review queue: check spelling, familiarity and tags before importing';
      lines.push([pid, p.pools[0], name, hangul, '1', tags, '', note].map(q).join(','));
    }
  }
  return { csv: lines.join('\n') + '\n', rows: lines.length - 1 };
}
