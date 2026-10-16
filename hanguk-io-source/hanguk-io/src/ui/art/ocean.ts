// The ocean behind the game: a canvas scene of the water column at the player's depth.
// Procedural layers (sky and swell, light shafts, marine snow, bioluminescent sparks,
// continental slope and trench walls, vent plumes, the trench floor) plus the original
// SVG creatures from creatures.ts placed deterministically along the depth axis.

import { CREATURES, DIVING_BELL, svgDataUrl, type CreatureDef } from './creatures';
import { mulberry32, hashString } from '../../core/rng';

export interface SceneOptions {
  reducedMotion: boolean;
  highContrast: boolean;
}

interface Instance {
  def: CreatureDef;
  depth: number;
  x: number; // 0..1 of width at spawn
  layer: number; // parallax factor
  scale: number;
  phase: number;
  dir: 1 | -1;
  side: -1 | 1; // for wall anchors
  school?: Array<{ dx: number; dy: number; s: number }>;
  /** Left out when the scene is quieted behind the game's text (see setFocus). */
  extra: boolean;
}

/** A screen rectangle (px) the scene keeps quiet behind. */
export interface FocusRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const COLOR_STOPS: Array<[number, [number, number, number]]> = [
  [-80, [120, 196, 230]],
  [0, [31, 132, 173]],
  [40, [22, 112, 154]],
  [200, [13, 74, 114]],
  [600, [10, 49, 82]],
  [1000, [7, 29, 54]],
  [2000, [5, 19, 42]],
  [4000, [4, 12, 28]],
  [6000, [3, 8, 18]],
  [7300, [2, 5, 12]],
];

function colorAt(d: number): [number, number, number] {
  if (d <= COLOR_STOPS[0][0]) return COLOR_STOPS[0][1];
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [d1, c1] = COLOR_STOPS[i];
    const [d0, c0] = COLOR_STOPS[i - 1];
    if (d <= d1) {
      const f = (d - d0) / (d1 - d0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cheap 1-D value noise for wall outlines. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export const FLOOR_DEPTH = 7160;
const PALACE_DEPTH = 7095;
const PPM = 2.4; // pixels per metre at the mid layer

export class OceanScene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private images = new Map<string, HTMLImageElement>();
  private instances: Instance[] = [];
  private snow: Array<{ x: number; y: number; r: number; v: number; a: number }> = [];
  private sparks: Array<{ x: number; d: number; c: string; p: number }> = [];
  private rings: Array<{ t0: number; color: string }> = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = 0;
  private target = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private opts: SceneOptions = { reducedMotion: false, highContrast: false };
  private finale = 0; // 0..1 glow of the perfect-dive finale
  private finaleTarget = 0;
  /** Where the current depth sits on screen (0..1 from the top); eased towards anchorTarget. */
  private anchor = 0.42;
  private anchorTarget = 0.42;
  /** Where the player's bell sits horizontally (0..1); the UI moves it out of the way. */
  bellX = 0.86;
  /** Draw the faint depth ruler on the right edge (dive and results screens). */
  ruler = false;
  /** Quiet zone: creatures fade behind this rectangle and about half of them stay away. */
  private focus: FocusRect | null = null;
  private calm = 0;
  private calmTarget = 0;
  private focusSeen = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    for (const def of [...CREATURES, DIVING_BELL]) {
      const img = new Image();
      img.decoding = 'async';
      img.src = svgDataUrl(def);
      this.images.set(def.id, img);
    }
    this.populate();
    this.resize();
  }

  private populate(): void {
    const rnd = mulberry32(hashString('hanguk-ocean-v1'));
    const thin = mulberry32(hashString('hanguk-ocean-quiet'));
    for (const def of CREATURES) {
      const span = Math.max(1, def.max - def.min);
      const count = def.density >= 1000 ? 1 : Math.max(1, Math.round((def.density * span) / 1000));
      for (let i = 0; i < count; i++) {
        const layerRoll = rnd();
        const anchored = def.anchor === 'wall';
        // Surface props (boats, floats, gulls) and anchored life must sit exactly where they belong.
        const fixed = def.density >= 1000 || anchored || def.max <= 30 || def.motion === 'bob';
        const layer = fixed ? 1 : layerRoll < 0.3 ? 0.55 : layerRoll < 0.85 ? 1 : 1.55;
        const inst: Instance = {
          def,
          depth: def.min + (count === 1 && def.density >= 1000 ? 0 : rnd() * span),
          x: rnd(),
          layer,
          scale: fixed ? 1 : layer === 0.55 ? 0.55 : layer === 1.55 ? 1.3 : 0.85 + rnd() * 0.3,
          phase: rnd() * Math.PI * 2,
          dir: rnd() < 0.5 ? -1 : 1,
          side: rnd() < 0.5 ? -1 : 1,
          extra: def.density < 1000 && thin() < 0.45,
        };
        if (def.motion === 'school') {
          const n = 5 + Math.floor(rnd() * 6);
          inst.school = Array.from({ length: n }, () => ({ dx: (rnd() - 0.5) * 180, dy: (rnd() - 0.5) * 60, s: 0.75 + rnd() * 0.4 }));
        }
        this.instances.push(inst);
      }
    }
    // draw far layers first
    this.instances.sort((a, b) => a.layer - b.layer);
    for (let i = 0; i < 140; i++) this.snow.push({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.6, v: 0.3 + rnd() * 0.7, a: 0.25 + rnd() * 0.5 });
    const colors = ['#7ff2ff', '#8affc8', '#9fb8ff', '#c49bff'];
    for (let i = 0; i < 260; i++) this.sparks.push({ x: rnd(), d: 450 + rnd() * 6700, c: colors[Math.floor(rnd() * colors.length)], p: rnd() * 10 });
  }

  setOptions(o: SceneOptions): void {
    this.opts = o;
  }

  /** Move the camera; with animate=false (or reduced motion) it jumps. */
  setDepth(d: number, animate = true): void {
    this.target = Math.max(-30, Math.min(7000, d));
    if (!animate || this.opts.reducedMotion) this.cam = this.target;
  }

  get depth(): number {
    return this.cam;
  }

  /** Keep the water quiet behind the game's text: creatures fade as they pass behind `rect` and
   *  roughly half of them stay away. `null` brings the full scene back. */
  setFocus(rect: FocusRect | null, amount = 1): void {
    if (rect) this.focus = rect;
    this.calmTarget = rect ? amount : 0;
    // The first screen starts quiet; later changes ease in and out.
    if (this.opts.reducedMotion || !this.focusSeen) this.calm = this.calmTarget;
    this.focusSeen = true;
  }

  /** Put the current depth at this fraction of the screen height (the dive hangs its prompt
   *  just under the surface line, the menus keep it lower). */
  setAnchor(frac: number, animate = true): void {
    this.anchorTarget = Math.max(0.04, Math.min(0.6, frac));
    if (!animate || this.opts.reducedMotion) this.anchor = this.anchorTarget;
  }

  setFinale(on: boolean): void {
    this.finaleTarget = on ? 1 : 0;
    if (this.opts.reducedMotion) this.finale = this.finaleTarget;
  }

  ping(color = '#9ff7ff'): void {
    if (this.opts.reducedMotion) return;
    this.rings.push({ t0: performance.now(), color });
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, (globalThis as any).devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.running) this.draw(performance.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.opts.reducedMotion) {
      this.cam = this.target;
      this.finale = this.finaleTarget;
      this.anchor = this.anchorTarget;
      this.calm = this.calmTarget;
    } else {
      const k = 1 - Math.exp(-dt * 1.9);
      this.cam += (this.target - this.cam) * k;
      if (Math.abs(this.target - this.cam) < 0.05) this.cam = this.target;
      this.finale += (this.finaleTarget - this.finale) * (1 - Math.exp(-dt * 0.8));
      this.anchor += (this.anchorTarget - this.anchor) * (1 - Math.exp(-dt * 2.6));
      if (Math.abs(this.anchorTarget - this.anchor) < 0.0005) this.anchor = this.anchorTarget;
      this.calm += (this.calmTarget - this.calm) * (1 - Math.exp(-dt * 1.6));
    }
    this.draw(t);
  }

  /** Screen y of a world depth for a parallax layer. */
  private yOf(depth: number, layer = 1): number {
    return this.h * this.anchor + (depth - this.cam) * PPM * layer;
  }

  private depthAtY(y: number, layer = 1): number {
    return this.cam + (y - this.h * this.anchor) / (PPM * layer);
  }

  /** Left and right wall edges (px) at a depth; NaN when there is no wall. */
  private walls(d: number): [number, number] {
    const w = this.w;
    const narrow = w < 700 ? 0.6 : 1;
    const left = smooth(2900, 4300, d) * 0.17 * narrow + smooth(5800, 6900, d) * 0.08 * narrow;
    const right = smooth(5600, 6500, d) * 0.2 * narrow;
    const jitterL = (noise1(d / 60, 1) - 0.5) * 0.05 * smooth(2900, 3600, d);
    const jitterR = (noise1(d / 55, 2) - 0.5) * 0.05 * smooth(5600, 6000, d);
    const reef = d > 4 && d < 70 ? 0.05 * (1 - Math.abs(d - 37) / 33) * (0.7 + 0.6 * noise1(d / 9, 3)) : 0;
    const l = (left + jitterL + reef) * w;
    const r = w - (right + jitterR + reef * 0.8) * w;
    return [l, r];
  }

  private draw(t: number): void {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const time = this.opts.reducedMotion ? 0 : t / 1000;
    const topD = this.depthAtY(0);
    const botD = this.depthAtY(h);

    // 1. Water (and sky) gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const d = topD + ((botD - topD) * i) / steps;
      const c = colorAt(d);
      const dim = this.opts.highContrast ? 0.55 : 1;
      g.addColorStop(i / steps, rgb([c[0] * dim, c[1] * dim, c[2] * dim]));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 2. Sky, sun and swell near the surface
    const surfaceY = this.yOf(0);
    if (surfaceY > -40) this.drawSurface(surfaceY, time);

    // 3. Light shafts in the sunlit zone
    const rayA = 1 - smooth(0, 260, this.cam);
    if (rayA > 0.01) this.drawRays(surfaceY, rayA, time);

    // 4. Bioluminescent sparks (world-anchored, deeper than 450 m)
    if (botD > 400) this.drawSparks(time);

    // 5. Marine snow (screen-space, scrolls with the camera)
    this.drawSnow(time);

    // 6. Open-water creatures, then the rock that hides whatever swims behind it,
    //    then the life that lives on the rock.
    this.drawCreatures(time, false);
    if (botD > 2900 || (topD < 70 && botD > 4)) this.drawWalls(time);
    this.drawCreatures(time, true);

    // 8. Trench floor and the finale glow
    const floorY = this.yOf(FLOOR_DEPTH);
    if (floorY < h + 40) this.drawFloor(floorY, time);

    // 9. The player's bell and sonar rings
    this.drawBell(time);

    // 10. Vignette
    const v = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.35 + smooth(1000, 7000, this.cam) * 0.3})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    // 11. Depth ruler on the right edge
    if (this.ruler) this.drawRuler(topD, botD);
  }

  /** A faint sounding line: a tick every 10 m, a label every 100 m, a gold notch at the bell. */
  private drawRuler(topD: number, botD: number): void {
    const { ctx, w, h } = this;
    const x = Math.round(w - (w < 600 ? 6 : 12)) + 0.5;
    const ink = this.opts.highContrast ? 'rgba(230,245,250,0.6)' : 'rgba(205,232,242,0.3)';
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, Math.max(0, this.yOf(0)));
    ctx.lineTo(x, h);
    for (let d = Math.max(0, Math.ceil(topD / 10) * 10); d <= botD; d += 10) {
      const y = Math.round(this.yOf(d)) + 0.5;
      const len = d % 100 === 0 ? 9 : d % 50 === 0 ? 5 : 3;
      ctx.moveTo(x - len, y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = this.opts.highContrast ? 'rgba(235,248,252,0.8)' : 'rgba(205,232,242,0.42)';
    ctx.font = `${w < 600 ? 9 : 10}px "IBM Plex Sans KR", system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let d = Math.max(0, Math.ceil(topD / 100) * 100); d <= botD; d += 100) {
      ctx.fillText(`${d.toLocaleString('en-US')} m`, x - 13, Math.round(this.yOf(d)));
    }
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(x - 11, Math.round(this.yOf(this.cam)) - 1, 11, 2);
    ctx.restore();
  }

  private drawSurface(y: number, time: number): void {
    const { ctx, w } = this;
    // sky
    const sky = ctx.createLinearGradient(0, y - 260, 0, y);
    sky.addColorStop(0, '#f6d8a8');
    sky.addColorStop(0.55, '#a9d6ee');
    sky.addColorStop(1, '#7cc4e6');
    ctx.fillStyle = sky;
    ctx.fillRect(0, y - 400, w, 400);
    // distant islands (Jeju's oreum silhouettes)
    ctx.fillStyle = 'rgba(64,104,120,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 8) {
      const hgt = 18 + 26 * Math.max(0, Math.sin(x / 140)) + 40 * Math.exp(-(((x - w * 0.3) / 120) ** 2));
      ctx.lineTo(x, y - hgt);
    }
    ctx.lineTo(w, y);
    ctx.fill();
    // sun
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    ctx.beginPath();
    ctx.arc(w * 0.72, y - 150, 26, 0, Math.PI * 2);
    ctx.fill();
    // swell line
    ctx.fillStyle = 'rgba(31,132,173,1)';
    ctx.beginPath();
    ctx.moveTo(0, y + 30);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y + Math.sin(x / 38 + time * 1.4) * 4 + Math.sin(x / 13 - time * 2.2) * 1.5);
    ctx.lineTo(w, y + 30);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,248,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const yy = y + Math.sin(x / 38 + time * 1.4) * 4 + Math.sin(x / 13 - time * 2.2) * 1.5;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    // caustic glints just under the surface
    ctx.fillStyle = 'rgba(220,245,255,0.18)';
    for (let i = 0; i < 26; i++) {
      const gx = ((i * 97.3 + time * 18) % (w + 40)) - 20;
      const gy = y + 10 + ((i * 37) % 60);
      ctx.fillRect(gx, gy, 14 + (i % 4) * 6, 1.6);
    }
  }

  private drawRays(surfaceY: number, a: number, time: number): void {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x0 = w * (0.08 + i * 0.14) + Math.sin(time * 0.3 + i) * 30;
      const spread = 70 + (i % 3) * 30;
      const top = Math.max(surfaceY, -50);
      const grad = ctx.createLinearGradient(0, top, 0, h);
      grad.addColorStop(0, `rgba(190,235,255,${0.09 * a})`);
      grad.addColorStop(1, 'rgba(190,235,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0 - 18, top);
      ctx.lineTo(x0 + 18, top);
      ctx.lineTo(x0 + spread + 120, h);
      ctx.lineTo(x0 + spread - 40, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSnow(time: number): void {
    const { ctx, w, h } = this;
    const a = smooth(80, 400, this.cam) * (this.opts.highContrast ? 0.4 : 1);
    if (a <= 0) return;
    ctx.fillStyle = '#e6f0f5';
    for (const p of this.snow) {
      // scroll with the camera (parallax 0.8) and drift slowly down
      let y = (p.y * h - this.cam * PPM * 0.8 * p.v + time * 6 * p.v) % h;
      if (y < 0) y += h;
      const x = (p.x * w + Math.sin(time * 0.4 + p.y * 20) * 6) % w;
      ctx.globalAlpha = p.a * a;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawSparks(time: number): void {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const y = this.yOf(s.d, 0.7);
      if (y < -10 || y > h + 10) continue;
      const tw = this.opts.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(time * 1.7 + s.p * 3);
      const a = tw * smooth(400, 1200, s.d) * 0.8;
      if (a < 0.05) continue;
      const x = s.x * w;
      const r = 6 + 6 * tw;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, s.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private drawWalls(time: number): void {
    const { ctx, w, h } = this;
    const step = 10;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (let y = -step; y <= h + step; y += step) {
      const d = this.depthAtY(y);
      const [l, r] = this.walls(d);
      left.push([l, y]);
      right.push([r, y]);
    }
    const shallow = this.cam < 200;
    const rim = shallow ? 'rgba(170,210,160,0.4)' : 'rgba(150,180,225,0.32)';
    for (const [pts, edge] of [[left, 0], [right, w]] as const) {
      if (pts.every(([x]) => Math.abs(x - edge) < 1)) continue;
      const g = ctx.createLinearGradient(edge, 0, edge === 0 ? Math.max(...pts.map((p) => p[0])) : Math.min(...pts.map((p) => p[0])), 0);
      g.addColorStop(0, shallow ? '#1d2a1f' : '#0b0e15');
      g.addColorStop(1, shallow ? '#34493a' : '#1b2231');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(edge, pts[0][1]);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(edge, pts[pts.length - 1][1]);
      ctx.closePath();
      ctx.fill();
      // strata: short ledges seeded by depth so they scroll with the rock
      ctx.strokeStyle = shallow ? 'rgba(20,30,20,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      for (const [x, y] of pts) {
        const d = this.depthAtY(y);
        if (noise1(d / 7, edge ? 9 : 8) > 0.78) {
          const len = 10 + noise1(d / 3, 4) * 40;
          ctx.beginPath();
          ctx.moveTo(x + (edge ? 6 : -6), y);
          ctx.lineTo(x + (edge ? 6 + len : -6 - len), y + 3);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = rim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    void time;
  }

  private drawFloor(y: number, time: number): void {
    const { ctx, w, h } = this;
    // finale glow
    const glow = 0.25 + this.finale * 0.75;
    const rad = Math.max(w, 600);
    const g = ctx.createRadialGradient(w / 2, y, 10, w / 2, y, rad);
    g.addColorStop(0, `rgba(255,210,122,${0.35 * glow})`);
    g.addColorStop(0.4, `rgba(127,242,200,${0.12 * glow})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, y - rad), w, Math.min(h, y + rad) - Math.max(0, y - rad));
    if (this.finale > 0.05 && !this.opts.reducedMotion) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x = w / 2 + (i - 2) * 70;
        const lg = ctx.createLinearGradient(0, y - 420, 0, y);
        lg.addColorStop(0, 'rgba(255,226,160,0)');
        lg.addColorStop(1, `rgba(255,226,160,${0.12 * this.finale * (0.6 + 0.4 * Math.sin(time * 2 + i))})`);
        ctx.fillStyle = lg;
        ctx.fillRect(x - 14, y - 420, 28, 420);
      }
      ctx.restore();
    }
    ctx.fillStyle = '#07080c';
    ctx.beginPath();
    ctx.moveTo(0, h + 10);
    for (let x = 0; x <= w; x += 12) ctx.lineTo(x, y + 30 + (noise1(x / 50, 5) - 0.5) * 18);
    ctx.lineTo(w, h + 10);
    ctx.closePath();
    ctx.fill();
  }

  private drawCreatures(time: number, anchoredPass: boolean): void {
    const { ctx, w, h } = this;
    const reduced = this.opts.reducedMotion;
    for (const inst of this.instances) {
      const def = inst.def;
      if ((def.anchor === 'wall') !== anchoredPass) continue;
      const special = def.zone === 'finale';
      const depth = special ? (def.id === 'yonggung' ? PALACE_DEPTH : def.id === 'dragon' ? 7020 : 7085) : inst.depth;
      const y0 = this.yOf(depth, inst.layer);
      const dw = def.w * inst.scale * (w < 600 ? 0.75 : 1);
      const dh = def.h * inst.scale * (w < 600 ? 0.75 : 1);
      const margin = (inst.school ? 140 : 0) + dh;
      if (y0 < -margin || y0 > h + margin) continue;
      const img = this.images.get(def.id);
      if (!img || !img.complete || !img.naturalWidth) continue;

      // horizontal position and motion
      let x: number;
      let flip = false;
      let dy = 0;
      let sy = 1;
      let rot = 0;
      if (def.anchor === 'wall') {
        const [l, r] = this.walls(depth);
        // Only on a wall that actually exists here (shallow reef life uses the screen edges).
        if (depth >= 100 && ((inst.side < 0 && l < 8) || (inst.side > 0 && r > w - 8))) continue;
        const onLeft = inst.side < 0;
        x = onLeft ? Math.max(l - dw * 0.25, -dw * 0.4) + inst.x * 30 : Math.min(r + dw * 0.25 - dw, w - dw * 0.6) - inst.x * 30;
        if (depth < 100) x = inst.side < 0 ? -dw * 0.2 + inst.x * 40 : w - dw * 0.8 - inst.x * 40;
      } else if (special) {
        x = w / 2 - dw / 2 + (def.id === 'byeoljubu' ? -dw * 2.6 : 0);
      } else if (def.motion === 'swim' || def.motion === 'school') {
        const speed = (def.speed ?? 20) * inst.layer * (reduced ? 0 : 1);
        const span = w + dw + 360;
        const travel = (inst.x * span + inst.dir * speed * time) % span;
        x = (travel < 0 ? travel + span : travel) - dw - 180;
        flip = inst.dir < 0;
        dy = reduced ? 0 : Math.sin(time * 1.3 + inst.phase) * 3;
      } else {
        x = inst.x * (w - dw);
        if (!reduced) {
          if (def.motion === 'drift') {
            x += Math.sin(time * 0.15 + inst.phase) * 30;
            dy = Math.sin(time * 0.4 + inst.phase) * 8;
          } else if (def.motion === 'pulse') {
            const p = Math.sin(time * 2 + inst.phase);
            sy = 1 + p * 0.06;
            dy = -Math.max(0, p) * 6 + Math.sin(time * 0.3 + inst.phase) * 10;
          } else if (def.motion === 'bob') dy = Math.sin(time * 1.5 + inst.phase) * 3;
          else if (def.motion === 'hover') dy = Math.sin(time * 0.7 + inst.phase) * 5;
          else if (def.motion === 'sway') rot = Math.sin(time * 0.8 + inst.phase) * 0.05;
        }
      }
      const layerAlpha = inst.layer < 1 ? 0.45 : inst.layer > 1.2 ? 0.92 : 0.85;
      const deepDim = smooth(200, 1500, depth) * (def.glow ? 0.1 : 0.35);
      const thinned = inst.extra && !special ? 1 - this.calm : 1;
      if (thinned < 0.02) continue;
      const alpha = thinned * Math.max(0.15, layerAlpha - deepDim) * (this.opts.highContrast ? 0.55 : 1) * (special ? 0.4 + 0.6 * Math.max(this.finale, smooth(6600, 7000, this.cam)) : 1);
      const quiet = this.calm > 0.01 && this.focus && !special ? this.focus : null;

      const drawOne = (px: number, py: number, s: number) => {
        const ww = dw * s;
        const hh = dh * s;
        let a = alpha;
        if (quiet) {
          // Fade whatever passes behind the text; full strength again ~70 px outside it.
          const cx = px + ww / 2;
          const cy = py + hh / 2;
          const dx = Math.max(quiet.x0 - cx, 0, cx - quiet.x1);
          const dy = Math.max(quiet.y0 - cy, 0, cy - quiet.y1);
          const inside = 1 - smooth(0, 70 + Math.max(ww, hh) * 0.5, Math.hypot(dx, dy));
          a *= 1 - this.calm * 0.82 * inside;
          if (a < 0.02) return;
        }
        if (def.glow) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const gr0 = Math.max(ww, hh) * 0.75;
          const gr = ctx.createRadialGradient(px + ww / 2, py + hh / 2, 0, px + ww / 2, py + hh / 2, gr0);
          const pulse = reduced ? 0.7 : 0.6 + 0.4 * Math.sin(time * 2.2 + inst.phase);
          gr.addColorStop(0, def.glow + '55');
          gr.addColorStop(1, def.glow + '00');
          ctx.globalAlpha = a * pulse;
          ctx.fillStyle = gr;
          ctx.fillRect(px + ww / 2 - gr0, py + hh / 2 - gr0, gr0 * 2, gr0 * 2);
          ctx.restore();
        }
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(px + ww / 2, py + hh / 2);
        if (rot) ctx.rotate(rot);
        ctx.scale(flip ? -1 : 1, sy);
        ctx.drawImage(img, -ww / 2, -hh / 2, ww, hh);
        ctx.restore();
      };

      if (inst.school) {
        for (const m of inst.school) {
          const wob = reduced ? 0 : Math.sin(time * 2 + m.dx) * 4;
          drawOne(x + m.dx, y0 + m.dy + dy + wob - dh / 2, m.s);
        }
      } else {
        drawOne(x, y0 + dy - dh / 2, 1);
      }

      // vent plumes
      if (def.id === 'vent' && !reduced) {
        const cx = x + dw / 2;
        const topY = y0 - dh / 2 + dh * 0.2;
        ctx.save();
        for (let i = 0; i < 9; i++) {
          const k = ((time * 0.35 + i / 9) % 1);
          const py = topY - k * 160;
          const px = cx + Math.sin(k * 6 + i) * 10 * k;
          ctx.globalAlpha = (1 - k) * 0.35 * alpha;
          ctx.fillStyle = '#1b1715';
          ctx.beginPath();
          ctx.arc(px, py, 6 + k * 26, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  private drawBell(time: number): void {
    const { ctx, w, h } = this;
    const img = this.images.get(DIVING_BELL.id);
    if (!img || !img.complete || !img.naturalWidth) return;
    const small = w < 700;
    const bw = DIVING_BELL.w * (small ? 0.55 : 0.8);
    const bh = DIVING_BELL.h * (small ? 0.55 : 0.8);
    // Wide screens: at the current depth, beside the column. Phones: low on the right, clear of
    // the prompt and the answer field at the top of the screen.
    const cx = small ? w - bw * 0.95 : w * this.bellX;
    const cy = small ? h * 0.78 : h * this.anchor + bh * 0.35;
    const bob = this.opts.reducedMotion ? 0 : Math.sin(time * 1.2) * 4;
    // Like the creatures, the bell steps back when it would sit behind the game's text (the
    // results list on a phone, say).
    let fade = 1;
    const f = this.focus;
    if (f && this.calm > 0.01) {
      const dx = Math.max(f.x0 - cx, 0, cx - f.x1);
      const dy = Math.max(f.y0 - cy, 0, cy - f.y1);
      fade = 1 - this.calm * 0.8 * (1 - smooth(0, 60 + bw * 0.5, Math.hypot(dx, dy)));
    }
    ctx.save();
    ctx.globalAlpha = fade;
    // cable to the surface (left out on phones, where it would run behind the prompt)
    if (!small) {
      ctx.strokeStyle = 'rgba(200,210,220,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, -10);
      ctx.lineTo(cx, cy - bh / 2 + bob);
      ctx.stroke();
    }
    // lamp glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lamp = ctx.createRadialGradient(cx, cy + bob, 4, cx, cy + bob, 140);
    lamp.addColorStop(0, `rgba(255,231,168,${0.18 + smooth(200, 2000, this.cam) * 0.25})`);
    lamp.addColorStop(1, 'rgba(255,231,168,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(cx - 140, cy - 140 + bob, 280, 280);
    ctx.restore();
    // sonar rings
    const now = performance.now();
    this.rings = this.rings.filter((r) => now - r.t0 < 1800);
    for (const r of this.rings) {
      const k = (now - r.t0) / 1800;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - k) * 0.7 * fade;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy + bob, 20 + k * 220, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = fade;
    ctx.drawImage(img, cx - bw / 2, cy - bh / 2 + bob, bw, bh);
    ctx.restore();
  }
}

/** Draw a static postcard of the ocean at a depth (used for the share card). */
export function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, depth: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgb(colorAt(Math.max(0, depth - 400))));
  g.addColorStop(1, rgb(colorAt(depth + 400)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(hashString(`card-${depth}`));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 1 + rnd() * (depth > 800 ? 5 : 2);
    ctx.fillStyle = depth > 800 ? ['#7ff2ff55', '#8affc855', '#c49bff55'][i % 3] : '#e6f0f544';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function creatureImage(def: CreatureDef): HTMLImageElement {
  const img = new Image();
  img.src = svgDataUrl(def);
  return img;
}
