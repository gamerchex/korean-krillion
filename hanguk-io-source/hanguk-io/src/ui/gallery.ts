// Asset gallery (dist/gallery.html): every original illustration with its manifest data, plus
// a scene viewer for checking the ocean at a given depth: gallery.html#scene-4500

import { CREATURES, DIVING_BELL, svgDataUrl } from './art/creatures';
import { OceanScene } from './art/ocean';

const root = document.getElementById('root')!;
const hash = location.hash.slice(1);
const sceneMatch = hash.match(/^scene-(-?\d+)$/);

if (sceneMatch) {
  const canvas = document.getElementById('ocean') as HTMLCanvasElement;
  const scene = new OceanScene(canvas);
  const depth = Number(sceneMatch[1]);
  scene.setOptions({ reducedMotion: false, highContrast: false });
  scene.setDepth(depth, false);
  scene.setFinale(depth >= 7000);
  scene.start();
  window.addEventListener('resize', () => scene.resize());
  root.innerHTML = `<div class="tag mono">${depth.toLocaleString('en-US')} m</div>`;
} else {
  const all = [...CREATURES, DIVING_BELL];
  root.innerHTML = `<h1>HAN-GUK.IO original art</h1><p>${all.length} illustrations, all drawn for this project. Scenes: ${[0, 150, 600, 1500, 3000, 4500, 6300, 7000]
    .map((d) => `<a href="#scene-${d}" onclick="setTimeout(()=>location.reload())">${d} m</a>`)
    .join(' · ')}</p><div class="grid">${all
    .map(
      (c) => `<figure><div class="art"><img alt="" src="${svgDataUrl(c)}"></div><figcaption><strong>${c.name.en}</strong> <span lang="ko">${c.name.ko}</span><br><span class="mono">${c.id}</span> · ${c.zone} · ${c.min}–${c.max} m<br><small>${c.desc}</small></figcaption></figure>`,
    )
    .join('')}</div>`;
}
