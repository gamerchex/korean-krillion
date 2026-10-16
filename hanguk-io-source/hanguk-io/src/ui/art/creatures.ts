// Original artwork for HAN-GUK.IO, drawn as SVG for this project (no third-party assets).
// Every entry is listed in ASSETS.md / assets/manifest.json, generated from this registry.
// Swimmers face right in their source drawing; the renderer mirrors them when they swim left.

export type ZoneId = 'surface' | 'twilight' | 'midnight' | 'abyssal' | 'hadal' | 'finale';
export type Motion = 'swim' | 'school' | 'drift' | 'pulse' | 'sway' | 'static' | 'bob' | 'hover';

export interface CreatureDef {
  id: string;
  name: { en: string; ko: string };
  zone: ZoneId;
  /** Depth band (m) where instances are placed. */
  min: number;
  max: number;
  /** Size on screen at the middle parallax layer (px). */
  w: number;
  h: number;
  motion: Motion;
  /** Horizontal speed for swimmers (px/s at the mid layer). */
  speed?: number;
  /** Instances per 1,000 m of the band. */
  density: number;
  /** Bioluminescence drawn by the renderer around the sprite. */
  glow?: string;
  /** Attach to a wall or the trench floor instead of open water. */
  anchor?: 'wall' | 'floor';
  vb: [number, number];
  svg: string;
  desc: string;
}

const C: CreatureDef[] = [
  // ---------------------------------------------------------------- Surface (0-200 m)
  {
    id: 'haenyeo', name: { en: 'Haenyeo diver', ko: '해녀' }, zone: 'surface', min: 6, max: 26, w: 120, h: 46, motion: 'swim', speed: 18, density: 60,
    vb: [140, 54], desc: 'A Jeju haenyeo in a black diving suit and round goggles, net bag trailing.',
    svg: `<path d="M12 29c11-7 31-10 53-9l28 1c9 0 12 6 4 9l-33 3c-20 2-38 1-52-4z" fill="#1c2533"/>
<path d="M13 28L2 19c-2-2 0-4 2-3l15 8zM14 32L3 41c-2 2 0 4 2 3l15-8z" fill="#111822"/>
<path d="M91 22l23-13c2-1 3 1 2 2l-21 15z" fill="#1c2533"/>
<path d="M114 10l15-7" stroke="#aab5bd" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="104" cy="26" r="9.5" fill="#1c2533"/>
<ellipse cx="108.5" cy="25" rx="6" ry="4.8" fill="#bfeaf6" stroke="#d5dde2" stroke-width="1.6"/>
<path d="M30 26c10 2 22 2 34 0" stroke="#f08a3c" stroke-width="2.4" fill="none" opacity=".9"/>
<path d="M58 31l-9 12" stroke="#cbb782" stroke-width="1.3"/>
<ellipse cx="46" cy="47" rx="10" ry="6" fill="#cbb782" fill-opacity=".18" stroke="#cbb782" stroke-width="1.2" stroke-dasharray="2 2"/>`,
  },
  {
    id: 'tewak', name: { en: 'Tewak float', ko: '테왁' }, zone: 'surface', min: 0, max: 3, w: 48, h: 40, motion: 'bob', density: 700,
    vb: [60, 50], desc: "The haenyeo's orange float with its net bag, bobbing at the surface.",
    svg: `<ellipse cx="30" cy="17" rx="16" ry="13" fill="#f2782f"/>
<ellipse cx="24" cy="11" rx="6" ry="4" fill="#ffb47e" opacity=".85"/>
<path d="M14 18h32" stroke="#c25619" stroke-width="1.4" opacity=".7"/>
<path d="M18 27l7 18h10l7-18" fill="#d9c38c" fill-opacity=".22" stroke="#d9c38c" stroke-width="1.3" stroke-dasharray="2 2"/>`,
  },
  {
    id: 'squid-boat', name: { en: 'Squid-fishing boat', ko: '오징어잡이 배' }, zone: 'surface', min: 0, max: 1, w: 200, h: 62, motion: 'bob', density: 400,
    vb: [200, 62], desc: 'An East Sea squid boat with its strings of bright lure lamps.',
    svg: `<path d="M6 40h178l-20 17H28z" fill="#24354a"/>
<path d="M6 40h178" stroke="#3b5470" stroke-width="2"/>
<path d="M62 22h48v18H62z" fill="#e8edf1"/>
<path d="M62 30h48" stroke="#3a76b8" stroke-width="3"/>
<path d="M70 25h8v4h-8zM84 25h8v4h-8z" fill="#9fc3df"/>
<path d="M124 6v34M40 12v28" stroke="#9aa8b5" stroke-width="2"/>
<path d="M24 14h118" stroke="#9aa8b5" stroke-width="1"/>
<g fill="#fff4c4">${Array.from({ length: 12 }, (_, i) => `<circle cx="${28 + i * 10}" cy="17" r="3"/>`).join('')}</g>`,
  },
  {
    id: 'seagull', name: { en: 'Black-tailed gull', ko: '괭이갈매기' }, zone: 'surface', min: -40, max: -10, w: 64, h: 26, motion: 'swim', speed: 40, density: 300,
    vb: [70, 30], desc: 'Busan\'s city bird, gliding over the water.',
    svg: `<path d="M2 16c10-10 20-12 30-4 3-3 6-3 8 0 10-8 20-6 28 4-10-4-19-3-27 4h-10C23 13 12 12 2 16z" fill="#eef2f4"/>
<path d="M58 12c4 1 8 3 10 5-4-1-7-1-10 0z" fill="#2b3036"/>
<path d="M33 14l4 2-4 1z" fill="#f2c23d"/>`,
  },
  {
    id: 'mackerel', name: { en: 'Mackerel shoal', ko: '고등어 떼' }, zone: 'surface', min: 20, max: 170, w: 70, h: 24, motion: 'school', speed: 55, density: 18,
    vb: [90, 30], desc: 'Chub mackerel with wavy dark stripes, moving as a shoal.',
    svg: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e7f86"/><stop offset=".5" stop-color="#6fb1b4"/><stop offset=".55" stop-color="#e7eef0"/><stop offset="1" stop-color="#c9d5d9"/></linearGradient></defs>
<path d="M6 15c12-10 40-12 62-6l14-8-4 14 4 14-14-8c-22 6-50 4-62-6z" fill="url(#g)"/>
<path d="M20 9c4 3 8-2 12 1s8-2 12 1 8-2 12 1" stroke="#163846" stroke-width="1.6" fill="none"/>
<path d="M40 5l6-4 2 5z" fill="#2e7f86"/>
<circle cx="14" cy="13" r="2.2" fill="#0d1a22"/>`,
  },
  {
    id: 'sea-turtle', name: { en: 'Green turtle', ko: '바다거북' }, zone: 'surface', min: 15, max: 140, w: 100, h: 64, motion: 'swim', speed: 14, density: 14,
    vb: [110, 70], desc: 'A green sea turtle rowing through the shallows.',
    svg: `<path d="M44 24c-10-14-30-16-36-10 8 2 18 8 28 16z" fill="#7a8f4e"/>
<path d="M46 50c-8 10-22 16-30 14 6-6 14-12 22-18z" fill="#7a8f4e"/>
<ellipse cx="54" cy="37" rx="34" ry="21" fill="#5b6e3a"/>
<path d="M30 30l12-9h18l12 9-6 13H36z" fill="#86995a" stroke="#4a5a2e" stroke-width="1.5"/>
<path d="M42 21v-6M60 21v-6M30 30H21M72 30h10M36 43l-6 7M66 43l6 7" stroke="#4a5a2e" stroke-width="1.5"/>
<path d="M86 34c8-2 16 0 19 4-3 4-11 5-19 3z" fill="#7a8f4e"/>
<circle cx="99" cy="36" r="1.8" fill="#16200c"/>
<path d="M74 52c8 6 14 8 18 7-4-4-10-8-14-10z" fill="#7a8f4e"/>`,
  },
  {
    id: 'moon-jelly', name: { en: 'Moon jellyfish', ko: '보름달물해파리' }, zone: 'surface', min: 8, max: 190, w: 54, h: 70, motion: 'pulse', density: 40,
    vb: [60, 80], desc: 'A translucent moon jelly with its four-leaf ring.',
    svg: `<path d="M4 28C4 12 16 4 30 4s26 8 26 24c0 3-4 4-6 2-4 4-8 0-12 2-4 3-8 3-12 0-4-2-8 2-12-2-2 2-6 1-6-2z" fill="#d8eef7" fill-opacity=".45" stroke="#e8f6fb" stroke-opacity=".7"/>
<g fill="none" stroke="#f3b6d8" stroke-width="2.4" opacity=".85"><circle cx="22" cy="18" r="4.5"/><circle cx="38" cy="18" r="4.5"/><circle cx="30" cy="12" r="4.5"/><circle cx="30" cy="24" r="4.5"/></g>
<path d="M14 34c-2 14 4 26 0 40M24 34c2 16-3 28 1 42M36 34c-2 16 3 28-1 42M46 34c2 14-4 26 0 40" stroke="#e8f6fb" stroke-opacity=".55" fill="none"/>`,
  },
  {
    id: 'sea-bream', name: { en: 'Red seabream', ko: '참돔' }, zone: 'surface', min: 30, max: 190, w: 80, h: 46, motion: 'swim', speed: 30, density: 16,
    vb: [90, 50], desc: 'A pink-red seabream speckled with blue.',
    svg: `<path d="M4 25C14 6 46 2 66 16l16-10-3 19 3 19-16-10C46 48 14 44 4 25z" fill="#e47a7a"/>
<path d="M20 9c10-6 24-8 36-4l-6-5c-12 0-22 4-30 9z" fill="#c95c5f"/>
<path d="M8 27c16 10 40 12 58 2" stroke="#f6c1b9" stroke-width="5" fill="none" opacity=".6"/>
<g fill="#8fd3f0">${[[26, 18], [34, 14], [42, 20], [50, 16], [30, 25], [46, 27], [56, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join('')}</g>
<circle cx="14" cy="21" r="3" fill="#fff"/><circle cx="14.5" cy="21" r="1.8" fill="#111"/>`,
  },
  {
    id: 'kelp', name: { en: 'Kelp and sea mustard', ko: '다시마와 미역' }, zone: 'surface', min: 10, max: 60, w: 46, h: 160, motion: 'sway', density: 80, anchor: 'wall',
    vb: [60, 200], desc: 'Long brown fronds of kelp and miyeok swaying in the swell.',
    svg: `<path d="M30 200C24 160 38 130 30 100S22 40 30 4c6 30 10 64 4 98s-4 64 2 98z" fill="#5d6b2b"/>
<path d="M30 120c-14-10-22-26-24-42 10 8 18 22 24 34zM32 80c14-8 20-22 22-36-8 6-16 18-22 30zM30 160c-12-8-18-20-20-32 8 6 14 16 20 26z" fill="#7a8a3a"/>`,
  },
  {
    id: 'dolphin', name: { en: 'Bottlenose dolphin', ko: '남방큰돌고래' }, zone: 'surface', min: 4, max: 70, w: 128, h: 46, motion: 'swim', speed: 70, density: 22,
    vb: [140, 50], desc: "One of Jeju's resident bottlenose dolphins.",
    svg: `<path d="M8 26c10-12 40-18 70-16 16 1 30 6 40 12l18 1c2 2 0 4-2 4l-16 1c-14 8-40 12-62 10-14-1-26-4-34-8l-8 8c-2 1-4 0-3-2l4-8-10-4c-2-1-1-3 1-3z" fill="#7c93a6"/>
<path d="M60 10l8-10 6 2-4 10z" fill="#6a8195"/>
<path d="M30 30c20 6 50 6 80-2" stroke="#d7e2ea" stroke-width="6" fill="none" opacity=".7"/>
<circle cx="112" cy="20" r="2" fill="#18232c"/>
<path d="M62 34l-8 10 8-2 6-8z" fill="#6a8195"/>`,
  },
  {
    id: 'spotted-seal', name: { en: 'Spotted seal', ko: '점박이물범' }, zone: 'surface', min: 4, max: 50, w: 100, h: 42, motion: 'swim', speed: 26, density: 12,
    vb: [110, 45], desc: 'A spotted seal from Baengnyeongdo, swimming belly-up.',
    svg: `<path d="M10 24c4-12 30-18 56-16 18 1 30 6 36 12 4 4 4 9-2 11-10 4-26 6-44 6-20 0-36-3-46-13z" fill="#a9a497"/>
<path d="M10 24L0 14c0-3 3-4 5-2l10 9zM12 28L1 36c0 3 3 4 5 2l10-7z" fill="#8f8a7d"/>
<g fill="#6f6a5f">${[[30, 16], [42, 13], [52, 20], [64, 14], [72, 22], [38, 24], [58, 27], [80, 18]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.8"/>`).join('')}</g>
<circle cx="94" cy="18" r="2.4" fill="#1d1b17"/><path d="M102 22c2 0 4 1 4 2" stroke="#1d1b17"/>`,
  },
  {
    id: 'octopus', name: { en: 'Giant octopus', ko: '문어' }, zone: 'surface', min: 40, max: 200, w: 80, h: 80, motion: 'drift', density: 10,
    vb: [90, 90], desc: 'A curious octopus, a must at Gyeongsang ancestral rites.',
    svg: `<path d="M45 6c18 0 26 14 24 28-1 8-6 12-6 18H27c0-6-5-10-6-18C19 20 27 6 45 6z" fill="#c4584a"/>
<g fill="none" stroke="#c4584a" stroke-width="7" stroke-linecap="round"><path d="M30 50c-10 8-20 6-24 16 0 6 6 8 8 4"/><path d="M38 52c-4 12-12 18-10 28"/><path d="M52 52c4 12 12 18 10 28"/><path d="M60 50c10 8 20 6 24 16 0 6-6 8-8 4"/></g>
<circle cx="37" cy="30" r="4" fill="#f6e3c8"/><circle cx="53" cy="30" r="4" fill="#f6e3c8"/><rect x="35" y="29" width="4" height="2" fill="#2a1410"/><rect x="51" y="29" width="4" height="2" fill="#2a1410"/>`,
  },
  {
    id: 'pollock', name: { en: 'Alaska pollock shoal', ko: '명태 떼' }, zone: 'surface', min: 120, max: 400, w: 70, h: 22, motion: 'school', speed: 45, density: 10,
    vb: [80, 28], desc: 'Myeongtae, three dorsal fins and all: the fish with a dozen Korean names.',
    svg: `<path d="M4 15c10-8 36-10 56-6l14-6-3 12 3 12-14-6c-20 4-46 2-56-6z" fill="#8c8a7c"/>
<path d="M20 8l4-6 4 6zM34 7l4-6 4 6zM48 8l3-5 4 6z" fill="#77756a"/>
<path d="M8 17c16 6 36 6 52 2" stroke="#d6d2c2" stroke-width="3" fill="none" opacity=".7"/>
<circle cx="11" cy="13" r="2" fill="#141410"/>`,
  },
  {
    id: 'sunfish', name: { en: 'Ocean sunfish', ko: '개복치' }, zone: 'surface', min: 60, max: 380, w: 100, h: 116, motion: 'drift', density: 5,
    vb: [120, 140], desc: 'A mola mola: Korean slang for someone who "dies" of the slightest stress.',
    svg: `<path d="M58 4c-6 12-6 24-4 36H66c2-12 0-24-8-36z" fill="#8d9aa7"/>
<path d="M58 136c-6-12-6-24-4-36H66c2 12 0 24-8 36z" fill="#8d9aa7"/>
<ellipse cx="60" cy="70" rx="46" ry="40" fill="#a9b6c2"/>
<path d="M14 58c-6 6-6 18 0 24 4-6 4-18 0-24z" fill="#8d9aa7"/>
<circle cx="88" cy="62" r="5" fill="#fff"/><circle cx="89" cy="62" r="3" fill="#1d2731"/>
<path d="M100 74c3 1 5 3 5 5" stroke="#5f6c78" stroke-width="2" fill="none"/>
<path d="M40 50c10 12 10 28 0 40" stroke="#c7d1da" stroke-width="3" fill="none" opacity=".6"/>`,
  },
  // ---------------------------------------------------------------- Twilight (200-1,000 m)
  {
    id: 'squid', name: { en: 'Japanese flying squid', ko: '살오징어' }, zone: 'twilight', min: 180, max: 650, w: 100, h: 36, motion: 'swim', speed: 50, density: 14,
    vb: [110, 40], desc: 'The ojingeo of East Sea squid boats, swimming mantle-first.',
    svg: `<path d="M104 20L80 6v28z" fill="#d79b88"/>
<path d="M84 20c0-8-6-12-20-12H40c-6 0-10 6-10 12s4 12 10 12h24c14 0 20-4 20-12z" fill="#e9b4a2" fill-opacity=".9"/>
<g stroke="#d79b88" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M30 15C18 12 8 10 2 12"/><path d="M30 18C16 18 10 18 4 20"/><path d="M30 22C16 22 10 24 4 26"/><path d="M30 25C18 28 8 30 2 30"/></g>
<circle cx="36" cy="17" r="3.4" fill="#1e1416"/><circle cx="37" cy="16" r="1" fill="#fff"/>
<g fill="#c26f5a" opacity=".6">${[[50, 14], [58, 18], [66, 13], [54, 24], [70, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g>`,
  },
  {
    id: 'lanternfish', name: { en: 'Lanternfish', ko: '샛비늘치' }, zone: 'twilight', min: 300, max: 1000, w: 44, h: 18, motion: 'school', speed: 36, density: 25, glow: '#6fd3ff',
    vb: [50, 20], desc: 'Small fish dotted with photophores; they rise toward the surface every night.',
    svg: `<path d="M3 10c6-6 22-8 34-4l10-5-2 9 2 9-10-5c-12 4-28 2-34-4z" fill="#3a4a5c"/>
<circle cx="8" cy="9" r="2.6" fill="#cfe9ff"/><circle cx="8.4" cy="9" r="1.3" fill="#0b1118"/>
<g fill="#8ff0ff">${[14, 19, 24, 29, 34].map((x) => `<circle cx="${x}" cy="13" r="1.1"/>`).join('')}${[16, 22, 28].map((x) => `<circle cx="${x}" cy="15.5" r=".9"/>`).join('')}</g>`,
  },
  {
    id: 'hatchetfish', name: { en: 'Hatchetfish', ko: '도끼고기' }, zone: 'twilight', min: 400, max: 900, w: 36, h: 36, motion: 'hover', density: 22, glow: '#86e0ff',
    vb: [40, 40], desc: 'A mirror-sided hatchetfish that hides its shadow with belly lights.',
    svg: `<path d="M6 12c6-6 18-8 26-4l6-4-1 10c-2 10-8 20-18 24-6-4-12-14-13-26z" fill="#b8c6d3"/>
<path d="M10 14c6 2 14 2 22-2" stroke="#e6eef5" stroke-width="3" fill="none"/>
<circle cx="11" cy="12" r="3.6" fill="#e9f3fb"/><circle cx="11" cy="11.4" r="2" fill="#0d141a"/>
<g fill="#7fe7ff">${[[14, 28], [18, 30], [22, 31], [26, 29], [17, 25], [23, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1"/>`).join('')}</g>`,
  },
  {
    id: 'comb-jelly', name: { en: 'Comb jelly', ko: '빗해파리' }, zone: 'twilight', min: 200, max: 800, w: 34, h: 52, motion: 'pulse', density: 26,
    vb: [40, 60], desc: 'A comb jelly whose beating cilia scatter rainbow light.',
    svg: `<ellipse cx="20" cy="30" rx="15" ry="25" fill="#dff3ff" fill-opacity=".2" stroke="#dff3ff" stroke-opacity=".5"/>
<path d="M9 14c-2 10-2 22 0 32" stroke="#ff7ad9" stroke-width="2" fill="none" stroke-dasharray="2 2"/>
<path d="M15 8c-2 14-2 30 0 44" stroke="#7af0ff" stroke-width="2" fill="none" stroke-dasharray="2 2"/>
<path d="M25 8c2 14 2 30 0 44" stroke="#c4ff7a" stroke-width="2" fill="none" stroke-dasharray="2 2"/>
<path d="M31 14c2 10 2 22 0 32" stroke="#ffd36e" stroke-width="2" fill="none" stroke-dasharray="2 2"/>`,
  },
  {
    id: 'siphonophore', name: { en: 'Siphonophore', ko: '관해파리' }, zone: 'twilight', min: 500, max: 1100, w: 200, h: 36, motion: 'drift', density: 6, glow: '#9a8cff',
    vb: [220, 40], desc: 'A colony organism strung out like a glowing necklace.',
    svg: `<path d="M6 20C40 8 80 32 120 20s70-8 94 0" stroke="#cfc6ff" stroke-opacity=".6" fill="none" stroke-width="1.5"/>
<ellipse cx="10" cy="19" rx="7" ry="5" fill="#e9e4ff" fill-opacity=".7"/>
<g fill="#b9adff" fill-opacity=".8">${Array.from({ length: 16 }, (_, i) => { const x = 24 + i * 12; const y = 20 + Math.sin(i * 0.9) * 7; return `<circle cx="${x}" cy="${y.toFixed(1)}" r="${(3 - (i % 3) * 0.6).toFixed(1)}"/>`; }).join('')}</g>
<g stroke="#b9adff" stroke-opacity=".5">${Array.from({ length: 8 }, (_, i) => `<path d="M${30 + i * 24} ${22} v${10 + (i % 3) * 4}"/>`).join('')}</g>`,
  },
  {
    id: 'barreleye', name: { en: 'Barreleye', ko: '배럴아이' }, zone: 'twilight', min: 600, max: 850, w: 84, h: 38, motion: 'hover', density: 8,
    vb: [90, 40], desc: 'A fish with a see-through head and green, upward-looking eyes.',
    svg: `<path d="M20 22c6-8 30-10 50-6l16-6-3 12 3 12-16-6c-20 4-44 2-50-6z" fill="#3b3f4a"/>
<path d="M4 20c0-12 10-18 22-18 10 0 16 6 16 12l-4 10H8c-3-1-4-2-4-4z" fill="#d9f5ff" fill-opacity=".25" stroke="#e6faff" stroke-opacity=".6"/>
<ellipse cx="24" cy="12" rx="5" ry="6.5" fill="#57e38c"/><ellipse cx="24" cy="10" rx="3" ry="3" fill="#b8ffd4"/>
<circle cx="10" cy="20" r="1.4" fill="#9aa"/>`,
  },
  {
    id: 'sperm-whale', name: { en: 'Sperm whale', ko: '향유고래' }, zone: 'twilight', min: 300, max: 1300, w: 260, h: 96, motion: 'swim', speed: 22, density: 3,
    vb: [300, 110], desc: 'A sperm whale diving to hunt squid in the dark.',
    svg: `<path d="M10 34c0-16 14-26 34-26h110c40 0 80 10 110 26l20-14c4-2 8 2 6 6l-14 22 14 22c2 4-2 8-6 6l-20-14c-30 16-74 26-114 24-50-2-90-6-112-16C14 64 10 50 10 34z" fill="#4d5560"/>
<path d="M20 70c40 12 110 14 170 2" stroke="#5f6874" stroke-width="10" fill="none" opacity=".7"/>
<g stroke="#3f464f" stroke-width="2" opacity=".7">${Array.from({ length: 10 }, (_, i) => `<path d="M${150 + i * 10} 30c3 10 3 20 0 30"/>`).join('')}</g>
<circle cx="60" cy="52" r="3" fill="#15191d"/>
<path d="M14 66c10 4 20 6 34 6" stroke="#3a4048" stroke-width="3" fill="none"/>`,
  },
  {
    id: 'vampire-squid', name: { en: 'Vampire squid', ko: '흡혈오징어' }, zone: 'midnight', min: 650, max: 1500, w: 80, h: 62, motion: 'pulse', density: 10, glow: '#6fb7ff',
    vb: [90, 70], desc: 'Not a vampire at all: it drifts in a webbed cloak eating marine snow.',
    svg: `<path d="M45 4c14 0 22 10 22 22 0 6-2 10-4 14l18 22c-10 4-20 0-26-6l-10 12-10-12c-6 6-16 10-26 6l18-22c-2-4-4-8-4-14C23 14 31 4 45 4z" fill="#6d1f2e"/>
<path d="M30 10c-6-4-10-4-14-2 4 2 8 6 10 10zM60 10c6-4 10-4 14-2-4 2-8 6-10 10z" fill="#8a2a3c"/>
<circle cx="37" cy="24" r="5" fill="#cfe9ff"/><circle cx="53" cy="24" r="5" fill="#cfe9ff"/><circle cx="37" cy="24" r="2.4" fill="#0a0d14"/><circle cx="53" cy="24" r="2.4" fill="#0a0d14"/>
<g fill="#9fe4ff">${[[22, 54], [45, 64], [68, 54]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2"/>`).join('')}</g>`,
  },
  // ---------------------------------------------------------------- Midnight (1,000-4,000 m)
  {
    id: 'anglerfish', name: { en: 'Deep-sea anglerfish', ko: '초롱아귀' }, zone: 'midnight', min: 1000, max: 4000, w: 96, h: 74, motion: 'hover', density: 6, glow: '#9ff7ff',
    vb: [110, 80], desc: 'A black anglerfish dangling a glowing lure over a mouth full of needles.',
    svg: `<path d="M70 20C70 6 82 2 92 6" stroke="#2a2f36" stroke-width="2.4" fill="none"/>
<circle cx="94" cy="7" r="5" fill="#c9fbff"/>
<path d="M8 44C8 22 30 12 54 14c24 2 40 16 40 34 0 16-16 26-38 26-12 0-20-4-26-8L10 74c-2 1-4-1-3-3l8-12C10 56 8 50 8 44z" fill="#1a1d22"/>
<path d="M58 40c14 2 26 8 34 14-10 10-26 14-40 12" fill="#0b0c0f"/>
<path d="M58 42l3 6 3-5 3 6 3-5 3 6 3-5 3 6 3-4M56 64l3-5 3 5 3-6 3 5 3-6 3 5 3-6 3 4" stroke="#e8e2d0" stroke-width="1.4" fill="none"/>
<circle cx="64" cy="30" r="3.4" fill="#cfd8de"/><circle cx="64" cy="30" r="1.6" fill="#000"/>`,
  },
  {
    id: 'gulper-eel', name: { en: 'Gulper eel', ko: '풍선장어' }, zone: 'midnight', min: 1200, max: 3000, w: 170, h: 64, motion: 'swim', speed: 18, density: 4, glow: '#ff7ab8',
    vb: [180, 70], desc: 'A pelican eel: a balloon of a mouth on a whip of a tail with a pink light at the tip.',
    svg: `<path d="M120 14c22-6 46 6 52 20-6 14-30 26-52 20-10-4-14-12-14-20s4-16 14-20z" fill="#1f2128"/>
<path d="M122 22c16-2 34 4 40 12-6 8-24 14-40 12" fill="#08090b"/>
<circle cx="164" cy="28" r="2" fill="#bcc"/>
<path d="M108 34C80 30 60 50 40 46S14 30 4 36" stroke="#1f2128" stroke-width="6" fill="none" stroke-linecap="round"/>
<circle cx="4" cy="36" r="3" fill="#ff8ac4"/>`,
  },
  {
    id: 'giant-squid', name: { en: 'Giant squid', ko: '대왕오징어' }, zone: 'midnight', min: 1000, max: 2200, w: 240, h: 66, motion: 'swim', speed: 16, density: 2,
    vb: [260, 70], desc: 'A giant squid trailing two feeding tentacles longer than its body.',
    svg: `<path d="M254 35l-34-18v36z" fill="#8f3b31"/>
<path d="M226 35c0-12-10-18-30-18h-62c-10 0-16 8-16 18s6 18 16 18h62c20 0 30-6 30-18z" fill="#a8473a"/>
<circle cx="126" cy="32" r="6" fill="#e9d8c8"/><circle cx="126" cy="32" r="3.4" fill="#120808"/>
<g stroke="#a8473a" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M118 28C90 22 70 20 50 24"/><path d="M118 33C92 32 76 34 56 38"/><path d="M118 38C94 42 78 46 58 50"/><path d="M118 42C96 52 80 56 62 58"/></g>
<g stroke="#a8473a" stroke-width="2" fill="none"><path d="M118 32C80 30 40 26 6 30"/><path d="M118 36C80 40 40 44 8 42"/></g>
<ellipse cx="8" cy="30" rx="6" ry="3" fill="#a8473a"/><ellipse cx="10" cy="42" rx="6" ry="3" fill="#a8473a"/>`,
  },
  {
    id: 'viperfish', name: { en: 'Viperfish', ko: '독사고기' }, zone: 'midnight', min: 1000, max: 2800, w: 100, h: 36, motion: 'swim', speed: 26, density: 6, glow: '#8affea',
    vb: [110, 40], desc: 'Teeth too long to fit inside its own mouth.',
    svg: `<path d="M24 20c10-10 40-12 62-8l20-8-4 16 4 16-20-8c-22 4-52 2-62-8z" fill="#2b3a44"/>
<path d="M4 18c4-8 14-10 22-8l2 10-2 10c-8 2-18 0-22-8z" fill="#33454f"/>
<path d="M6 16l2 8M10 14l1 12M15 14l1 13M20 15l1 11" stroke="#e6efe8" stroke-width="1.2"/>
<circle cx="20" cy="14" r="2.6" fill="#a7f5ff"/>
<path d="M40 12c-2-8 2-10 6-10" stroke="#3b4c56" stroke-width="1.5" fill="none"/><circle cx="46" cy="2.5" r="1.6" fill="#8affea"/>
<g fill="#8affea">${[34, 42, 50, 58, 66, 74].map((x) => `<circle cx="${x}" cy="26" r="1.1"/>`).join('')}</g>`,
  },
  {
    id: 'atolla', name: { en: 'Atolla jellyfish', ko: '아톨라해파리' }, zone: 'midnight', min: 1000, max: 4000, w: 64, h: 54, motion: 'pulse', density: 10, glow: '#5ab8ff',
    vb: [70, 60], desc: 'A deep-red crown jelly that flashes blue rings like a burglar alarm.',
    svg: `<path d="M6 30C6 14 20 6 35 6s29 8 29 24c-4 4-8 2-12 4-4-2-8 2-12 0-4 2-8-2-12 0-4-2-8 2-12-2-2 0-4-2-4-2z" fill="#8c1f2a"/>
<ellipse cx="35" cy="20" rx="12" ry="8" fill="#b22f39"/>
<path d="M10 30c10 4 40 4 50 0" stroke="#6fd3ff" stroke-width="2.4" stroke-dasharray="3 3" fill="none"/>
<path d="M14 34c-2 8 0 16-2 22M26 36c0 8 2 14 0 20M44 36c0 8-2 14 0 20M56 34c2 8 0 16 2 22" stroke="#8c1f2a" stroke-width="1.6" fill="none"/>`,
  },
  {
    id: 'frilled-shark', name: { en: 'Frilled shark', ko: '주름상어' }, zone: 'midnight', min: 600, max: 1500, w: 190, h: 36, motion: 'swim', speed: 20, density: 3,
    vb: [200, 40], desc: 'An eel-like shark with frilly gill slits, unchanged for 80 million years.',
    svg: `<path d="M8 20c6-8 20-10 34-8 40 4 90 2 130 6l22-6-6 10 6 10-22-6c-40 4-90 4-130 6-14 2-28 0-34-12z" fill="#5a4e46"/>
<g stroke="#c98b74" stroke-width="2" fill="none">${[30, 36, 42, 48, 54, 60].map((x) => `<path d="M${x} 13c-3 4-3 10 0 14"/>`).join('')}</g>
<circle cx="16" cy="17" r="2" fill="#d6e6c8"/>
<path d="M120 18l10-10 6 2-4 10z" fill="#4c423b"/>`,
  },
  {
    id: 'dumbo', name: { en: 'Dumbo octopus', ko: '덤보문어' }, zone: 'midnight', min: 2500, max: 6500, w: 64, h: 64, motion: 'pulse', density: 5,
    vb: [70, 70], desc: 'A dumbo octopus flapping its ear-like fins.',
    svg: `<path d="M35 6c14 0 22 10 22 22 0 8-4 14-4 18H17c0-4-4-10-4-18C13 16 21 6 35 6z" fill="#f2a7b4"/>
<path d="M14 16C6 10 2 14 2 20c4 0 8 0 12-2zM56 16c8-6 12-2 12 4-4 0-8 0-12-2z" fill="#f6b9c4"/>
<path d="M16 44c-4 10-10 14-12 22 6 0 10-4 14-12M26 46c0 10-2 16 0 22M44 46c0 10 2 16 0 22M54 44c4 10 10 14 12 22-6 0-10-4-14-12" stroke="#f2a7b4" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M18 46h34" stroke="#f6d0d7" stroke-width="3"/>
<circle cx="28" cy="26" r="3" fill="#2a1418"/><circle cx="42" cy="26" r="3" fill="#2a1418"/>`,
  },
  {
    id: 'red-shrimp', name: { en: 'Deep-sea red shrimp', ko: '심해 새우' }, zone: 'midnight', min: 1200, max: 3500, w: 52, h: 26, motion: 'drift', density: 10, glow: '#7ae7ff',
    vb: [60, 30], desc: 'Red is invisible down here, so the shrimp wear it as camouflage.',
    svg: `<path d="M50 14c-6-8-20-10-30-6-8 3-12 10-10 16 8 2 16 0 22-4 6 2 12 0 18-6z" fill="#c8342f"/>
<path d="M50 14L60 8M50 14l10 2M14 22l-4 6M20 22l-2 6M26 21l0 6M32 19l2 6" stroke="#c8342f" stroke-width="1.2"/>
<path d="M50 12C40 6 30 4 2 2M50 13C42 10 28 12 4 14" stroke="#e7605a" stroke-width=".9" fill="none"/>
<circle cx="47" cy="12" r="1.6" fill="#111"/>`,
  },
  {
    id: 'whale-fall', name: { en: 'Whale fall', ko: '고래 뼈 생태계' }, zone: 'midnight', min: 3500, max: 3900, w: 240, h: 84, motion: 'static', density: 3, anchor: 'wall',
    vb: [260, 90], desc: 'A whale skeleton on the slope, feeding a whole community for decades.',
    svg: `<path d="M10 80c40-8 200-8 240 0v10H10z" fill="#3a3b44"/>
<path d="M30 70c10-26 40-30 54-20 4 4 4 12-2 16-12 6-30 8-52 4z" fill="#d9d2bf"/>
<path d="M84 64h150" stroke="#d9d2bf" stroke-width="5" stroke-linecap="round"/>
<g stroke="#d9d2bf" stroke-width="3.5" fill="none" stroke-linecap="round">${Array.from({ length: 9 }, (_, i) => `<path d="M${96 + i * 14} 64c-6-14-4-26 2-34"/>`).join('')}</g>
<g fill="#f2d6e8" fill-opacity=".6">${Array.from({ length: 14 }, (_, i) => `<circle cx="${60 + i * 12}" cy="${76 - (i % 3) * 2}" r="2"/>`).join('')}</g>`,
  },
  // ---------------------------------------------------------------- Abyssal (4,000-6,000 m)
  {
    id: 'sea-pig', name: { en: 'Sea pig', ko: '바다돼지' }, zone: 'abyssal', min: 4000, max: 6200, w: 60, h: 36, motion: 'static', density: 4, anchor: 'wall',
    vb: [70, 40], desc: 'A see-through sea cucumber that walks the abyss on tube feet.',
    svg: `<path d="M8 24C8 14 22 8 36 8s28 6 28 16c0 6-6 8-12 8H18C12 32 8 30 8 24z" fill="#f2b8c6" fill-opacity=".75"/>
<path d="M44 8c0-6 4-8 8-6M50 10c2-6 6-7 9-4" stroke="#f2b8c6" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<path d="M16 32v6M26 32v7M36 32v7M46 32v6M56 31v5" stroke="#e79fb1" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="34" cy="18" rx="16" ry="5" fill="#d9879c" fill-opacity=".5"/>`,
  },
  {
    id: 'tripod-fish', name: { en: 'Tripod fish', ko: '삼각대물고기' }, zone: 'abyssal', min: 4000, max: 6000, w: 110, h: 72, motion: 'static', density: 3, anchor: 'wall',
    vb: [120, 80], desc: 'Standing on three stiff fin rays, facing the current, waiting.',
    svg: `<path d="M20 30c10-8 40-10 66-6l26-6-6 12 6 12-26-6c-26 4-56 2-66-6z" fill="#5d5a52"/>
<circle cx="26" cy="27" r="2" fill="#ddd"/>
<path d="M30 20l-8-14M30 20l-4-16" stroke="#77736a" stroke-width="1.4"/>
<path d="M44 34l-4 44M60 34l20 44M96 34l14 44" stroke="#77736a" stroke-width="2.2"/>`,
  },
  {
    id: 'glass-sponge', name: { en: 'Glass sponge', ko: '유리해면' }, zone: 'abyssal', min: 4000, max: 6200, w: 44, h: 100, motion: 'static', density: 3, anchor: 'wall',
    vb: [50, 110], desc: "A vase of silica lattice: 'Venus's flower basket'.",
    svg: `<path d="M14 106c-2-30-6-60 0-90 4-8 18-8 22 0 6 30 2 60 0 90z" fill="#e9efe8" fill-opacity=".25" stroke="#eef5ee" stroke-opacity=".75"/>
<path d="M12 30h26M11 46h28M11 62h28M12 78h26M13 94h24M18 12c-2 30-2 62 0 94M25 10v96M32 12c2 30 2 62 0 94" stroke="#eef5ee" stroke-opacity=".55" fill="none"/>
<path d="M14 18l22 16M14 34l24 16M13 50l25 16M13 66l24 16M14 82l22 16" stroke="#eef5ee" stroke-opacity=".3"/>`,
  },
  {
    id: 'vent', name: { en: 'Hydrothermal vent', ko: '열수 분출구' }, zone: 'abyssal', min: 4600, max: 6900, w: 90, h: 200, motion: 'static', density: 3, anchor: 'wall', glow: '#ff8a3c',
    vb: [100, 220], desc: 'A black-smoker chimney pouring out mineral-rich water hotter than 350°C.',
    svg: `<path d="M26 220c2-40 6-80 12-130 2-14 4-30 4-40 4-4 12-4 16 0 0 10 2 26 4 40 6 50 10 90 12 130z" fill="#2a2522"/>
<path d="M40 70c-6 10-12 12-16 8M60 110c6 8 12 10 16 6M36 140c-8 6-14 6-18 2" stroke="#3a322d" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M42 50c2-10 14-10 16 0" fill="#ff8a3c"/>
<ellipse cx="50" cy="52" rx="10" ry="3" fill="#ffd27a"/>
<path d="M30 212h40" stroke="#ff8a3c" stroke-width="3" opacity=".5"/>`,
  },
  {
    id: 'tube-worms', name: { en: 'Giant tube worms', ko: '관벌레' }, zone: 'abyssal', min: 4600, max: 6900, w: 80, h: 70, motion: 'sway', density: 4, anchor: 'wall',
    vb: [90, 80], desc: 'Red-plumed worms living off bacteria that eat vent chemicals.',
    svg: `<g fill="#efe7da">${[[14, 30], [26, 18], [40, 26], [52, 14], [66, 24], [78, 32]].map(([x, y]) => `<rect x="${x - 4}" y="${y}" width="8" height="${80 - y}" rx="3"/>`).join('')}</g>
<g fill="#d8343c">${[[14, 30], [26, 18], [40, 26], [52, 14], [66, 24], [78, 32]].map(([x, y]) => `<path d="M${x - 6} ${y + 2}c0-8 3-12 6-12s6 4 6 12z"/>`).join('')}</g>`,
  },
  {
    id: 'yeti-crab', name: { en: 'Yeti crab', ko: '예티게' }, zone: 'abyssal', min: 4600, max: 6900, w: 70, h: 44, motion: 'static', density: 3, anchor: 'wall',
    vb: [80, 50], desc: 'A pale crab farming bacteria on its hairy claws.',
    svg: `<ellipse cx="40" cy="30" rx="16" ry="11" fill="#eee7dc"/>
<path d="M26 24C14 16 8 10 4 12c0 6 8 12 20 16M54 24c12-8 18-14 22-12 0 6-8 12-20 16" fill="#f4efe6" stroke="#e1d7c6"/>
<g stroke="#f4efe6" stroke-width="1" opacity=".9">${Array.from({ length: 12 }, (_, i) => `<path d="M${6 + i * 1.6} ${12 + i * 0.9}l-3 3M${74 - i * 1.6} ${12 + i * 0.9}l3 3"/>`).join('')}</g>
<path d="M28 38l-8 10M34 40l-4 10M46 40l4 10M52 38l8 10" stroke="#e1d7c6" stroke-width="2.4" stroke-linecap="round"/>`,
  },
  {
    id: 'brittle-star', name: { en: 'Brittle star', ko: '거미불가사리' }, zone: 'abyssal', min: 3800, max: 6900, w: 60, h: 60, motion: 'static', density: 4, anchor: 'wall',
    vb: [70, 70], desc: 'Five whip-like arms crawling over the abyssal mud.',
    svg: `<g stroke="#c9a77f" stroke-width="3" fill="none" stroke-linecap="round"><path d="M35 35C35 20 30 10 36 2"/><path d="M35 35c14-4 24-2 32 6"/><path d="M35 35c10 10 12 20 8 32"/><path d="M35 35c-8 12-18 18-30 18"/><path d="M35 35C22 30 12 22 4 24"/></g>
<circle cx="35" cy="35" r="7" fill="#d9b88f"/>`,
  },
  {
    id: 'rattail', name: { en: 'Grenadier', ko: '민태 무리' }, zone: 'abyssal', min: 3500, max: 6500, w: 130, h: 36, motion: 'swim', speed: 14, density: 6,
    vb: [140, 40], desc: 'A rattail fish, big head and long tapering tail, cruising above the floor.',
    svg: `<path d="M4 20c6-12 26-16 40-12 30 6 60 8 92 12-32 4-62 6-92 12-14 4-34 0-40-12z" fill="#7d7a73"/>
<circle cx="18" cy="16" r="5" fill="#d3dad9"/><circle cx="18" cy="16" r="2.6" fill="#101214"/>
<path d="M36 8l10-6 4 8z" fill="#6c6963"/>`,
  },
  {
    id: 'sea-lily', name: { en: 'Sea lily', ko: '바다나리' }, zone: 'abyssal', min: 4000, max: 6500, w: 52, h: 110, motion: 'sway', density: 3, anchor: 'wall',
    vb: [60, 120], desc: 'A stalked crinoid holding out feathery arms to catch food.',
    svg: `<path d="M30 120V40" stroke="#e1c48f" stroke-width="3"/>
<g fill="none" stroke="#f0d79f" stroke-width="2.4" stroke-linecap="round"><path d="M30 40C20 30 10 26 4 30"/><path d="M30 40C24 26 20 14 22 4"/><path d="M30 40C36 26 40 14 38 4"/><path d="M30 40c10-10 20-14 26-10"/><path d="M30 40c-12-4-20 0-24 8"/><path d="M30 40c12-4 20 0 24 8"/></g>
<circle cx="30" cy="40" r="4" fill="#e1c48f"/>`,
  },
  {
    id: 'giant-isopod', name: { en: 'Giant isopod', ko: '대왕구족충' }, zone: 'abyssal', min: 3000, max: 6000, w: 84, h: 46, motion: 'static', density: 3, anchor: 'wall',
    vb: [90, 50], desc: 'A pill-bug the size of a shoe, scavenging the abyss.',
    svg: `<path d="M8 30C8 14 28 8 46 8s38 6 38 22c0 8-10 12-38 12S8 38 8 30z" fill="#c9bfae"/>
<g stroke="#a99f8e" stroke-width="2">${[22, 30, 38, 46, 54, 62, 70].map((x) => `<path d="M${x} 10c-2 10-2 20 0 30"/>`).join('')}</g>
<path d="M84 26c3 0 5 2 5 4" stroke="#a99f8e" stroke-width="2" fill="none"/>
<circle cx="78" cy="22" r="2.4" fill="#2a2620"/>
<path d="M16 40l-4 6M28 42l-2 6M42 42v6M56 42l2 6M70 40l4 6" stroke="#b5ab9a" stroke-width="2" stroke-linecap="round"/>`,
  },
  // ---------------------------------------------------------------- Hadal (6,000-7,000 m)
  {
    id: 'snailfish', name: { en: 'Hadal snailfish', ko: '심해꼼치' }, zone: 'hadal', min: 6000, max: 7000, w: 100, h: 40, motion: 'swim', speed: 10, density: 14,
    vb: [110, 45], desc: 'A soft, see-through snailfish: the deepest-living fish ever filmed.',
    svg: `<path d="M8 22C8 10 22 6 34 8c24 4 46 8 70 14-24 6-46 10-70 14C22 38 8 34 8 22z" fill="#f4d6cf" fill-opacity=".7"/>
<path d="M30 12c20 4 50 8 70 10" stroke="#fbe9e4" stroke-opacity=".7" fill="none"/>
<ellipse cx="30" cy="24" rx="10" ry="6" fill="#e9a99c" fill-opacity=".6"/>
<circle cx="16" cy="18" r="2.2" fill="#2b1916"/>`,
  },
  {
    id: 'amphipod', name: { en: 'Hadal amphipods', ko: '심해 단각류' }, zone: 'hadal', min: 5800, max: 7000, w: 34, h: 20, motion: 'school', speed: 12, density: 12,
    vb: [40, 24], desc: 'Scavenging amphipods that swarm anything that sinks into the trench.',
    svg: `<path d="M4 14C4 6 14 2 24 4c8 2 12 6 12 10-6 4-14 6-22 6-6 0-10-2-10-6z" fill="#f3efe5"/>
<g stroke="#e3dccc" stroke-width="1.2">${[10, 14, 18, 22, 26].map((x) => `<path d="M${x} 18l-1 5"/>`).join('')}</g>
<path d="M34 10l6-6M34 11l6-1" stroke="#e3dccc"/><circle cx="31" cy="10" r="1.2" fill="#111"/>`,
  },
  {
    id: 'hadal-cucumber', name: { en: 'Glassy sea cucumber', ko: '심해 해삼' }, zone: 'hadal', min: 6000, max: 7000, w: 70, h: 36, motion: 'drift', density: 6, glow: '#ffb38a',
    vb: [80, 40], desc: 'A transparent sea cucumber whose gut glows through its body.',
    svg: `<ellipse cx="40" cy="20" rx="34" ry="14" fill="#ffe1d2" fill-opacity=".3" stroke="#ffe8dc" stroke-opacity=".6"/>
<path d="M14 20c10-6 20 6 30 0s16 6 24 0" stroke="#ff9e6e" stroke-width="3" fill="none"/>
<path d="M8 12c-4-2-6-4-6-8M72 12c4-2 6-4 6-8" stroke="#ffe8dc" stroke-opacity=".6" fill="none"/>`,
  },
  // ---------------------------------------------------------------- Finale (7,000 m)
  {
    id: 'yonggung', name: { en: 'Yonggung, palace of the Dragon King', ko: '용궁' }, zone: 'finale', min: 6880, max: 6880, w: 420, h: 250, motion: 'static', density: 1000, glow: '#ffd27a',
    vb: [420, 260], desc: "The Dragon King's undersea palace from Korean folklore, waiting at the bottom of the trench.",
    svg: `<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6f6a"/><stop offset="1" stop-color="#1d4a47"/></linearGradient><radialGradient id="h" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".55"/><stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="210" cy="170" rx="210" ry="90" fill="url(#h)"/>
<path d="M40 236h340l18 24H22z" fill="#6b5a4a"/>
<path d="M60 222h300v14H60z" fill="#8a7560"/>
<path d="M70 222v-82M110 222v-82M160 222v-82M260 222v-82M310 222v-82M350 222v-82" stroke="#b23a2e" stroke-width="10"/>
<path d="M60 140h300v14H60z" fill="#3e8a6e"/>
<g fill="#e4c15a">${Array.from({ length: 15 }, (_, i) => `<rect x="${64 + i * 20}" y="143" width="8" height="8" rx="2"/>`).join('')}</g>
<path d="M18 120c40 10 120 6 192-30 72 36 152 40 192 30-12 16-40 26-60 24H78c-20 2-48-8-60-24z" fill="url(#r)"/>
<path d="M18 120c40 10 120 6 192-30 72 36 152 40 192 30" stroke="#5fb3a3" stroke-width="3" fill="none"/>
<path d="M120 90c30 6 60 2 90-24 30 26 60 30 90 24-8 10-24 16-40 14H160c-16 2-32-4-40-14z" fill="url(#r)"/>
<path d="M206 40h8v26h-8z" fill="#e4c15a"/><circle cx="210" cy="36" r="8" fill="#ffe28a"/>
<path d="M190 222v-56h40v56" fill="#2a1f18"/><path d="M190 166h40" stroke="#e4c15a" stroke-width="3"/>
<g fill="#ffd27a" fill-opacity=".85"><rect x="124" y="176" width="22" height="26" rx="3"/><rect x="274" y="176" width="22" height="26" rx="3"/></g>`,
  },
  {
    id: 'dragon', name: { en: 'The Dragon King', ko: '용왕' }, zone: 'finale', min: 6820, max: 6820, w: 330, h: 150, motion: 'hover', density: 1000, glow: '#7ff2c8',
    vb: [360, 160], desc: 'A jade Korean dragon holding the wish-granting pearl (yeouiju).',
    svg: `<path d="M20 110C60 60 100 140 150 100S230 40 270 80s50 20 70-10" stroke="#2e9c7a" stroke-width="22" fill="none" stroke-linecap="round"/>
<path d="M20 110C60 60 100 140 150 100S230 40 270 80s50 20 70-10" stroke="#e8c45a" stroke-width="6" fill="none" stroke-dasharray="4 8" stroke-linecap="round"/>
<path d="M22 112C60 70 100 148 150 108" stroke="#7fd6b4" stroke-width="3" fill="none"/>
<path d="M330 70c10-14 24-18 28-10-2 10-10 16-20 18z" fill="#2e9c7a"/>
<path d="M332 64c-2-14 6-26 14-30M340 66c4-14 12-22 18-24" stroke="#e8c45a" stroke-width="2.4" fill="none"/>
<path d="M346 74c8 8 6 20-2 26M338 78c2 12-4 22-12 26" stroke="#d9efe6" stroke-width="1.6" fill="none"/>
<circle cx="344" cy="64" r="2.4" fill="#ffefa8"/>
<path d="M110 120l-10 22 14-8zM230 74l-6 24 12-12z" fill="#2e9c7a"/>
<circle cx="300" cy="118" r="12" fill="#cfe8ff"/><circle cx="296" cy="114" r="4" fill="#fff"/>
<path d="M300 106c6-6 12-8 18-6" stroke="#ffd27a" stroke-width="2" fill="none"/>`,
  },
  {
    id: 'byeoljubu', name: { en: 'Byeoljubu the turtle', ko: '별주부' }, zone: 'finale', min: 6930, max: 6930, w: 90, h: 54, motion: 'bob', density: 1000,
    vb: [100, 60], desc: 'The soft-shelled turtle of the tale Byeoljubu-jeon, still in his official hat.',
    svg: `<ellipse cx="46" cy="38" rx="30" ry="16" fill="#6f7f4a"/>
<path d="M22 36c8-10 40-10 48 0" stroke="#8a9a5a" stroke-width="4" fill="none"/>
<path d="M74 34c8-4 14-2 16 2-2 4-8 6-16 4z" fill="#8a9a5a"/><circle cx="85" cy="35" r="1.6" fill="#111"/>
<path d="M78 26h14v6H78z" fill="#1a1a1e"/><path d="M76 30h18M78 26c0-4 3-6 7-6s7 2 7 6" fill="#1a1a1e" stroke="#1a1a1e"/>
<path d="M75 29h-8M95 29h7" stroke="#1a1a1e" stroke-width="2.4" stroke-linecap="round"/>
<path d="M24 48l-8 8M64 50l6 8M22 30l-10-6" stroke="#8a9a5a" stroke-width="5" stroke-linecap="round"/>`,
  },
];

/** The player's diving bell: a bathysphere shaped like a Korean bronze temple bell. */
export const DIVING_BELL: CreatureDef = {
  id: 'diving-bell', name: { en: 'Beomjong diving bell', ko: '범종 잠수종' }, zone: 'surface', min: 0, max: 7000, w: 92, h: 120, motion: 'bob', density: 0,
  vb: [100, 130], desc: 'The player: a bronze diving bell shaped like a Korean temple bell, with a dragon hook on top and lit portholes.',
  svg: `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5b4a2e"/><stop offset=".45" stop-color="#b9955a"/><stop offset=".6" stop-color="#d8b878"/><stop offset="1" stop-color="#6b5734"/></linearGradient></defs>
<path d="M50 2v10" stroke="#8a8f96" stroke-width="2"/>
<path d="M40 18c0-6 4-8 10-8s10 2 10 8c-4-2-6-2-10-2s-6 0-10 2z" fill="#4f8f7a"/>
<path d="M44 14c-4-4-2-8 2-8M56 14c4-4 2-8-2-8" stroke="#4f8f7a" stroke-width="3" fill="none"/>
<path d="M26 30c0-10 10-14 24-14s24 4 24 14l4 66c0 6 4 10 8 14H14c4-4 8-8 8-14z" fill="url(#b)"/>
<path d="M24 40h52M22 92h56" stroke="#7a6136" stroke-width="3"/>
<g fill="#7a6136">${[30, 38, 46, 54, 62, 70].map((x) => `<circle cx="${x}" cy="35" r="1.8"/>`).join('')}</g>
<circle cx="50" cy="64" r="15" fill="#3a2f1e"/>
<circle cx="50" cy="64" r="11.5" fill="#ffe7a8"/>
<circle cx="46" cy="60" r="4" fill="#fff8de"/>
<path d="M14 110h72v8H14z" fill="#4a3c24"/>
<circle cx="30" cy="80" r="3.6" fill="#ffe7a8" opacity=".85"/><circle cx="70" cy="80" r="3.6" fill="#ffe7a8" opacity=".85"/>`,
};

export const CREATURES: CreatureDef[] = C;

export function svgMarkup(def: CreatureDef): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${def.vb[0]} ${def.vb[1]}" width="${def.vb[0]}" height="${def.vb[1]}">${def.svg}</svg>`;
}

export function svgDataUrl(def: CreatureDef): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(def))}`;
}
