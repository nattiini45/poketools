import type {
  OverlayConfig,
  OverlayTheme,
  AnimationIntensity,
  BrandPosition,
} from '@/types/broadcast';
import { isLocale } from '@/i18n/config';

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULTS: OverlayConfig = {
  theme: 'dark',
  accent: '#EF4444',
  accent2: '#3B82F6',
  anim: 'smooth',
  poll: 5000,
  w: 1920,
  h: 1080,
  brand: '',
  brandpos: 'br',
  preset: null,
  lang: null,
};

const VALID_THEMES: OverlayTheme[] = ['dark', 'light', 'custom'];
const VALID_ANIM: AnimationIntensity[] = ['none', 'subtle', 'smooth', 'dramatic'];
const VALID_BRANDPOS: BrandPosition[] = ['tl', 'tr', 'bl', 'br'];

// ─── Parse ──────────────────────────────────────────────────────────

/**
 * Parse overlay config from URL search params with safe defaults.
 * `?lang=en|de` pins the overlay language; anything else is null (follow the
 * league language, i18n-core §6.5).
 */
export function parseOverlayConfig(searchParams: URLSearchParams): OverlayConfig {
  const theme = searchParams.get('theme') as OverlayTheme | null;
  const anim = searchParams.get('anim') as AnimationIntensity | null;
  const brandpos = searchParams.get('brandpos') as BrandPosition | null;
  const poll = searchParams.get('poll');
  const w = searchParams.get('w');
  const h = searchParams.get('h');
  const lang = searchParams.get('lang');

  return {
    theme: theme && VALID_THEMES.includes(theme) ? theme : DEFAULTS.theme,
    accent: parseHexColor(searchParams.get('accent')) ?? DEFAULTS.accent,
    accent2: parseHexColor(searchParams.get('accent2')) ?? DEFAULTS.accent2,
    anim: anim && VALID_ANIM.includes(anim) ? anim : DEFAULTS.anim,
    poll: poll ? clamp(parseInt(poll, 10), 1000, 60000) : DEFAULTS.poll,
    w: w ? clamp(parseInt(w, 10), 320, 3840) : DEFAULTS.w,
    h: h ? clamp(parseInt(h, 10), 180, 2160) : DEFAULTS.h,
    brand: searchParams.get('brand') ?? DEFAULTS.brand,
    brandpos: brandpos && VALID_BRANDPOS.includes(brandpos) ? brandpos : DEFAULTS.brandpos,
    preset: searchParams.get('preset') ?? null,
    lang: isLocale(lang) ? lang : DEFAULTS.lang,
  };
}

// ─── CSS Variables ──────────────────────────────────────────────────

const ANIM_SPEED: Record<AnimationIntensity, number> = {
  none: 0,
  subtle: 0.5,
  smooth: 1,
  dramatic: 1.5,
};

/** Generate CSS custom property values from config. */
export function getOverlayCSSVars(config: OverlayConfig): Record<string, string> {
  const isDark = config.theme !== 'light';

  return {
    '--broadcast-accent': config.accent,
    '--broadcast-accent2': config.accent2,
    '--broadcast-bg': 'transparent',
    '--broadcast-surface': isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.92)',
    '--broadcast-surface-light': isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
    '--broadcast-text': isDark ? '#FFFFFF' : '#1A1714',
    '--broadcast-text-muted': isDark ? '#9CA3AF' : '#6B7280',
    '--broadcast-border': isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    '--tier-s': '#EF4444',
    '--tier-a': '#F97316',
    '--tier-b': '#3B82F6',
    '--tier-c': '#6B7280',
    '--anim-speed': String(ANIM_SPEED[config.anim]),
  };
}

/** Build a style object from CSS vars for use in React inline styles. */
export function getOverlayStyle(config: OverlayConfig): React.CSSProperties {
  const vars = getOverlayCSSVars(config);
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    style[key] = value;
  }
  return style as React.CSSProperties;
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseHexColor(value: string | null): string | null {
  if (!value) return null;
  // Accept with or without # prefix
  const hex = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : null;
}

function clamp(value: number, min: number, max: number): number {
  if (isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
