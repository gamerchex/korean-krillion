// Writes the asset manifest (assets/manifest.json + ASSETS.md) and exports every original
// illustration as a standalone SVG file (assets/svg/<id>.svg) from the in-code registry.
//
//   npm run assets

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREATURES, DIVING_BELL, svgMarkup } from '../src/ui/art/creatures';

const ROOT = join(import.meta.dirname, '..');
const ORIGINAL = 'Original work for HAN-GUK.IO: hand-coded SVG (AI-assisted authoring), no third-party source material';
const LICENSE = 'MIT (same as the HAN-GUK.IO source)';

interface Entry {
  id: string;
  kind: 'illustration' | 'environment' | 'audio' | 'font' | 'library';
  name: string;
  nameKo?: string;
  zone?: string;
  depth?: string;
  file: string;
  creator: string;
  license: string;
  notes: string;
}

const entries: Entry[] = [];

mkdirSync(join(ROOT, 'assets/svg'), { recursive: true });
for (const def of [...CREATURES, DIVING_BELL]) {
  const file = `assets/svg/${def.id}.svg`;
  writeFileSync(join(ROOT, file), svgMarkup(def) + '\n');
  entries.push({
    id: def.id,
    kind: 'illustration',
    name: def.name.en,
    nameKo: def.name.ko,
    zone: def.zone,
    depth: def.id === 'diving-bell' ? 'player' : `${def.min}–${def.max} m`,
    file: `${file} (source: src/ui/art/creatures.ts)`,
    creator: ORIGINAL,
    license: LICENSE,
    notes: def.desc,
  });
}

const env: Array<[string, string, string, string]> = [
  ['env-zone-gradient', 'Depth colour ramp', 'all', 'Ten colour stops from sky to hadal black, sampled per frame for the water column.'],
  ['env-sky-islands', 'Sky, sun and oreum silhouettes', 'surface', 'Warm sky gradient with Jeju-like volcanic cone silhouettes on the horizon.'],
  ['env-swell', 'Swell line and caustic glints', 'surface', 'Two-frequency animated wave line with sun glints just under the surface.'],
  ['env-light-shafts', 'Light shafts', 'surface/twilight', 'Additive god-ray beams that fade out by about 260 m.'],
  ['env-marine-snow', 'Marine snow', 'twilight–hadal', 'Drifting particles that scroll with the descent (parallax 0.8).'],
  ['env-biolum', 'Bioluminescent sparks', 'twilight–hadal', 'World-anchored twinkling sparks in four colours below 450 m.'],
  ['env-reef', 'Shallow reef rock', 'surface', 'Mossy rock at both screen edges between 4 and 70 m, home to the kelp.'],
  ['env-slope', 'Continental slope wall', 'midnight/abyssal', 'Noise-shaped rock wall with strata, appearing from about 2,900 m.'],
  ['env-trench', 'Trench walls', 'hadal', 'Second wall closing in from 5,600 m to form the hadal trench.'],
  ['env-vent-plume', 'Black-smoker plumes', 'abyssal/hadal', 'Rising particle plumes drawn above each hydrothermal vent chimney.'],
  ['env-floor', 'Trench floor', 'finale', 'Jagged floor silhouette at 7,160 m.'],
  ['env-yonggung-glow', 'Yonggung glow and light pillars', 'finale', 'Golden-jade glow and pulsing light pillars for the perfect 700-point dive.'],
  ['env-lamp', 'Diving-bell lamp and sonar rings', 'all', "Warm lamp glow around the player's bell and tier-coloured sonar rings on each accepted answer."],
  ['env-vignette', 'Depth vignette', 'all', 'Edge darkening that deepens with depth.'],
];
for (const [id, name, zone, notes] of env) {
  entries.push({ id, kind: 'environment', name, zone, file: 'src/ui/art/ocean.ts (procedural canvas drawing)', creator: 'Original procedural drawing for HAN-GUK.IO', license: LICENSE, notes });
}

const audio: Array<[string, string, string]> = [
  ['sfx-ambience', 'Underwater ambience', 'Looping brown noise through a slowly swelling low-pass filter; darkens with depth.'],
  ['sfx-drone', 'Depth drone', 'Soft detuned fifth (sine + triangle) whose pitch and brightness fall as you sink.'],
  ['sfx-pluck', 'Gayageum-like pluck', 'Karplus-Strong string synthesis with a nonghyeon-style pitch bend, on a Korean pentatonic scale.'],
  ['sfx-accept', 'Accept arpeggio', 'Rising plucks, more notes for rarer tiers; a bell joins at Extremely rare and Legendary.'],
  ['sfx-reject', 'Reject thud', 'Low falling sine and triangle pair.'],
  ['sfx-timeout', 'Timeout', 'Two falling triangle tones.'],
  ['sfx-tick', 'Clock tick', 'Short square-wave clicks in the last five seconds.'],
  ['sfx-bubbles', 'Bubbles', 'Rising sine chirps.'],
  ['sfx-sonar', 'Sonar ping', 'Sine ping with a delayed echo.'],
  ['sfx-bell', 'Temple bell (beomjong)', 'Inharmonic partials with long decays and a detuned pair for the slow beating of Korean bells.'],
  ['sfx-unlock', 'Achievement chime', 'Four high plucks.'],
];
for (const [id, name, notes] of audio) {
  entries.push({ id, kind: 'audio', name, file: 'src/ui/audio.ts (synthesized at run time with WebAudio)', creator: 'Original synthesis code for HAN-GUK.IO; no samples or recordings', license: LICENSE, notes });
}

entries.push(
  { id: 'font-hahmlet', kind: 'font', name: 'Hahmlet', file: 'Google Fonts (loaded at run time)', creator: 'Hypertype', license: 'SIL Open Font License 1.1', notes: 'Display face for headings and the wordmark. Falls back to Korean serif system fonts.' },
  { id: 'font-plex-sans-kr', kind: 'font', name: 'IBM Plex Sans KR', file: 'Google Fonts (loaded at run time)', creator: 'IBM / Mike Abbink, Bold Monday, Sandoll', license: 'SIL Open Font License 1.1', notes: 'Interface text. Falls back to Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR.' },
  { id: 'font-plex-mono', kind: 'font', name: 'IBM Plex Mono', file: 'Google Fonts (loaded at run time)', creator: 'IBM / Mike Abbink, Bold Monday', license: 'SIL Open Font License 1.1', notes: 'Depth readouts and scores.' },
  { id: 'lib-react', kind: 'library', name: 'React 19.2.8 and React DOM', file: 'bundled into dist/*.html', creator: 'Meta Platforms, Inc. and contributors', license: 'MIT', notes: 'UI library.' },
);

writeFileSync(join(ROOT, 'assets/manifest.json'), JSON.stringify({ generated: new Date().toISOString(), count: entries.length, entries }, null, 2) + '\n');

const illus = entries.filter((e) => e.kind === 'illustration');
const row = (e: Entry) => `| \`${e.id}\` | ${e.name}${e.nameKo ? ` · ${e.nameKo}` : ''} | ${e.zone ?? ''} | ${e.depth ?? ''} | ${e.notes.replace(/\|/g, '/')} |`;
const md = `# Asset manifest

Generated by \`npm run assets\` from the code that draws and plays them (\`src/ui/art/creatures.ts\`,
\`src/ui/art/ocean.ts\`, \`src/ui/audio.ts\`). Machine-readable copy: \`assets/manifest.json\`.

**Provenance.** Every illustration, environment layer and sound in HAN-GUK.IO is original work made
for this project. The illustrations are hand-coded SVG (written with AI assistance), the environment
layers are procedural canvas drawing, and the sounds are synthesized at run time with WebAudio. No
third-party images, sprites, recordings or samples are used, and nothing imitates the visual identity
of any other game. The only third-party assets are three OFL-licensed web fonts (optional, with system
fallbacks) and the React library (MIT).

- Illustrations: **${illus.length}** (standalone copies in \`assets/svg/\`)
- Environment layers / variations: **${env.length}**
- Synthesized sounds: **${audio.length}**

## Illustrations

| ID | Name | Zone | Depth band | Description |
|---|---|---|---|---|
${illus.map(row).join('\n')}

## Environment layers

| ID | Name | Zone | Notes |
|---|---|---|---|
${entries.filter((e) => e.kind === 'environment').map((e) => `| \`${e.id}\` | ${e.name} | ${e.zone} | ${e.notes} |`).join('\n')}

## Sound

| ID | Name | Notes |
|---|---|---|
${entries.filter((e) => e.kind === 'audio').map((e) => `| \`${e.id}\` | ${e.name} | ${e.notes} |`).join('\n')}

## Third-party

| ID | Name | Creator | License | Notes |
|---|---|---|---|---|
${entries.filter((e) => e.kind === 'font' || e.kind === 'library').map((e) => `| \`${e.id}\` | ${e.name} | ${e.creator} | ${e.license} | ${e.notes} |`).join('\n')}

All original assets: creator "HAN-GUK.IO project", license ${LICENSE}.
`;
writeFileSync(join(ROOT, 'ASSETS.md'), md);
console.log(`Wrote assets/manifest.json (${entries.length} entries), ${illus.length} SVG files and ASSETS.md`);
