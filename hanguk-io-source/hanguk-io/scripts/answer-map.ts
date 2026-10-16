// Prints, for every prompt, a few accepted answers (most familiar first, then the rarest).
// Used by the end-to-end test to play a real dive through the UI.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentModel, decodeContent, isClosed } from '../src/core/content';

const ROOT = join(import.meta.dirname, '..');
const model = new ContentModel(decodeContent(JSON.parse(readFileSync(join(ROOT, 'src/generated/content.json'), 'utf8'))));
const out: Record<string, { id: string; common: string[]; rare: string[]; hangul: string[]; en: boolean; closed: boolean }> = {};
for (const p of model.content.prompts) {
  const rt = model.runtime(p.id);
  const sorted = rt.acceptedList.slice().sort((a, b) => model.famFor(p, b) - model.famFor(p, a));
  const entry = {
    id: p.id,
    common: sorted.slice(0, 3).map((e) => e.name),
    rare: sorted.slice(-3).map((e) => e.name),
    hangul: sorted.filter((e) => e.hangul).slice(0, 3).map((e) => e.hangul!),
    en: p.accept.includes('en'),
    closed: isClosed(p),
  };
  out[p.text.en] = entry;
  out[p.text.ko] = entry;
}
process.stdout.write(JSON.stringify(out));
