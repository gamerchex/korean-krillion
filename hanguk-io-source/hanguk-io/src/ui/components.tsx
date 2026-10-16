// Small shared components: logo, tier badges, category glyphs, modal, count-up.

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { OceanScene } from './art/ocean';
import type { CategoryId, TierId } from '../core/types';
import { TIER_LABEL, type UiLang } from './i18n';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`logo logo-${size}`} aria-label="HAN-GUK.IO">
      <span className="seal" aria-hidden="true">
        <span>한</span>
        <span>국</span>
      </span>
      <span className="wordmark" aria-hidden="true">
        HAN-GUK<span className="dot">.IO</span>
      </span>
    </span>
  );
}

export const TIER_COLOR: Record<TierId, string> = {
  none: '#6b7480',
  common: '#e9e4d8',
  uncommon: '#5b9cf0',
  rare: '#42c79a',
  'very-rare': '#f2c44f',
  'extremely-rare': '#f0624a',
  legendary: '#c99bff',
};

export function TierShape({ tier, size = 18 }: { tier: TierId; size?: number }) {
  const c = TIER_COLOR[tier];
  const common = { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': true } as const;
  switch (tier) {
    case 'common':
      return <svg {...common}><circle cx="10" cy="10" r="7" fill={c} /></svg>;
    case 'uncommon':
      return <svg {...common}><path d="M10 2l8 8-8 8-8-8z" fill={c} /></svg>;
    case 'rare':
      return <svg {...common}><path d="M10 2l8.5 15h-17z" fill={c} /></svg>;
    case 'very-rare':
      return <svg {...common}><path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L1.3 7.8l6.1-.7z" fill={c} /></svg>;
    case 'extremely-rare':
      return <svg {...common}><path d="M10 1.5l7.4 4.25v8.5L10 18.5l-7.4-4.25v-8.5z" fill={c} /></svg>;
    case 'legendary':
      return (
        <svg {...common}>
          <circle cx="10" cy="11" r="6.5" fill={c} />
          <circle cx="8" cy="9" r="2" fill="#fff" opacity=".8" />
          <path d="M10 4.5C11 2 13.5 1 15.5 1.5 14 2.5 13 3.6 12.6 5" stroke="#ffd27a" strokeWidth="1.6" fill="none" />
        </svg>
      );
    default:
      return <svg {...common}><path d="M5 5l10 10M15 5L5 15" stroke={c} strokeWidth="2.6" strokeLinecap="round" /></svg>;
  }
}

export function TierBadge({ tier, lang, points }: { tier: TierId; lang: UiLang; points?: number }) {
  return (
    <span className={`tier-badge tier-${tier}`} style={{ '--tier': TIER_COLOR[tier] } as any}>
      <TierShape tier={tier} />
      <span>{TIER_LABEL[tier][lang]}</span>
      {points !== undefined && <span className="tier-pts">{points}</span>}
    </span>
  );
}

const ICONS: Record<CategoryId, string> = {
  food: 'M3 9h14a7 7 0 0 1-14 0zM6 4c0 2 2 2 2 4M10 3c0 2 2 2 2 4M14 4c0 2 2 2 2 4',
  geo: 'M1 17l6-10 3 5 3-4 6 9z',
  history: 'M4 3h10a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2zM4 15a2 2 0 0 0 2 2M8 7h5M8 10h5',
  ent: 'M7 2a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM4 8a6 6 0 0 0 12 0M10 14v4M7 18h6',
  lang: 'M3 3h14v10H9l-4 4v-4H3zM7 6h3v4M12 6v5',
  folk: 'M5 18V9a5 5 0 0 1 10 0v9M6 6L3 2M14 6l3-4M8 11h.01M12 11h.01',
  sport: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM2.5 8C6 9 8 12 7 17M17.5 8C14 9 12 12 13 17',
  tech: 'M5 5h10v10H5zM8 8h4v4H8zM8 2v3M12 2v3M8 15v3M12 15v3M2 8h3M2 12h3M15 8h3M15 12h3',
  culture: 'M10 16L3 6a10 10 0 0 1 14 0zM10 16v3M6 7l4 9 4-9',
  nature: 'M4 16C4 8 10 3 17 3c0 7-5 13-13 13zM4 16l7-7',
  brand: 'M3 3h7l8 8-7 7-8-8zM7 7h.01',
  assoc: 'M8 12l4-4M7 9L5 11a3 3 0 0 0 4 4l2-2M13 11l2-2a3 3 0 0 0-4-4L9 7',
};

export function CategoryGlyph({ cat, size = 16 }: { cat: CategoryId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="cat-glyph">
      <path d={ICONS[cat]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Modal({ title, onClose, children, labelClose }: { title: string; onClose: () => void; children: any; labelClose: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = el?.querySelector<HTMLElement>('input, textarea, button, [tabindex]');
    focusable?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !el) return;
      // Keep keyboard focus inside the dialog.
      const items = Array.from(
        el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e: any) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={labelClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value mono">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Animate a number towards `value` (instant with reduced motion). */
export function useCountUp(value: number, ms: number, reduced: boolean, start = value): number {
  const [shown, setShown] = useState(start);
  const cur = useRef(start);
  useEffect(() => {
    const from = cur.current;
    if (reduced || from === value) {
      cur.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now: number) {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return shown;
}

/** Keep the ocean quiet behind an element: creatures fade as they pass behind it. */
export function useSceneFocus(scene: OceanScene | null, ref: MutableRefObject<HTMLElement | null>, amount = 1): void {
  useEffect(() => {
    const el = ref.current;
    if (!scene || !el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      scene.setFocus({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }, amount);
    };
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(el);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
      scene.setFocus(null);
    };
  }, [scene]);
}
