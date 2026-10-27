import { describe, expect, it } from 'vitest';
import {
  BASE_TOKEN_NAMES,
  DEFAULT_SITE_PALETTE,
  SITE_PALETTE_ATTRIBUTE,
  SITE_PALETTE_IDS,
  SITE_PALETTE_STORAGE_KEY,
  SITE_PALETTES,
  getSitePaletteMeta,
  isSitePaletteId,
  sitePaletteSwatchVar,
  type BaseTokenName,
  type SitePaletteId,
  type SitePaletteMode,
} from '../site-palettes';
import {
  SITE_MOMENT_NAMES,
  SITE_MOMENT_TOKENS,
  SITE_PALETTE_DARK_MOMENT_OVERRIDES,
  SITE_PALETTE_TOKENS,
} from '../site-palette-tokens';
import { getRegisteredRouteThemeIds, getWorldByRouteThemeId } from '@/lib/worlds/registry';
import { contrastRatio, over, withAlpha } from './wcag';

/**
 * Site palettes (docs/design.md § Site palettes): the shared interface, the
 * plaza identity lock, completeness, and the contrast floor.
 *
 * Contrast: every pair of every palette, plaza included, meets its floor
 * (text 4.5:1, large text and non-text UI 3:1) in light and dark.
 */

describe('site palette interface', () => {
  it('declares the four palettes, plaza default, storage key and attribute', () => {
    expect([...SITE_PALETTE_IDS]).toEqual(['plaza', 'sakura', 'mountain', 'clouds']);
    expect(DEFAULT_SITE_PALETTE).toBe('plaza');
    expect(SITE_PALETTE_STORAGE_KEY).toBe('poketools:site-palette');
    expect(SITE_PALETTE_ATTRIBUTE).toBe('data-palette');
  });

  it('isSitePaletteId accepts exactly the four ids', () => {
    for (const id of SITE_PALETTE_IDS) expect(isSitePaletteId(id)).toBe(true);
    const rejected: unknown[] = [
      null, undefined, '', 'PLAZA', ' sakura', 'default', 'evoliga',
      '__proto__', 'constructor', 'toString', 42, {},
    ];
    for (const value of rejected) expect(isSitePaletteId(value), String(value)).toBe(false);
  });

  it('SITE_PALETTES lists every id in order with a registered world and no UI copy', () => {
    expect(SITE_PALETTES.map((p) => p.id)).toEqual([...SITE_PALETTE_IDS]);
    // Picker words come from `ui.palette` in the viewer's language, never from here.
    for (const p of SITE_PALETTES) expect(Object.keys(p).sort()).toEqual(['id', 'world']);
    expect(Object.fromEntries(SITE_PALETTES.map((p) => [p.id, p.world]))).toEqual({
      plaza: 'evoliga',
      sakura: 'sakura',
      mountain: 'mountain',
      clouds: 'clouds',
    });
    const routeNamespaces = getRegisteredRouteThemeIds().map((id) => getWorldByRouteThemeId(id)?.tokenNamespace);
    for (const p of SITE_PALETTES) expect(routeNamespaces, p.id).toContain(p.world);
    for (const id of SITE_PALETTE_IDS) expect(getSitePaletteMeta(id).id).toBe(id);
  });

  it('sitePaletteSwatchVar references the palette core', () => {
    expect(sitePaletteSwatchVar('sakura', 'accent')).toBe('var(--palette-sakura-accent)');
    expect(sitePaletteSwatchVar('plaza', 'ground')).toBe('var(--palette-plaza-ground)');
  });
});

/** The plaza values, both modes. The sunlit text tokens (muted, tertiary,
 *  accent, accent-strong, focus), the status hues and the warning / error
 *  inks are the AA values; the grounds, the primary inks and the light
 *  tints are the arena-sand originals. */
const PLAZA_PINNED = {
  light: {
    '--background': '#E8D9B5',
    '--foreground': '#241A0C',
    '--poke-base': '#E8D9B5',
    '--poke-surface': '#FFF8E9',
    '--poke-elevated': '#FAEED6',
    '--poke-muted': '#F1E4C8',
    '--poke-inverse': '#241A0C',
    '--poke-text-primary': '#241A0C',
    '--poke-text-secondary': '#5C4E37',
    '--poke-text-muted': '#675940',
    '--poke-text-tertiary': '#6C5E46',
    '--poke-border': '#E3D2AC',
    '--poke-border-strong': '#C9B183',
    '--poke-accent': '#9A4806',
    '--poke-accent-strong': '#843C05',
    '--poke-accent-light': '#F7E8CF',
    '--poke-focus': '#954506',
    '--poke-live': '#166534',
    '--poke-glow': 'rgba(192, 94, 10, 0.28)',
    '--poke-blue': '#1E4BC8',
    '--poke-blue-hover': '#1A3FA6',
    '--poke-green': '#166534',
    '--poke-green-hover': '#14532D',
    '--poke-yellow': '#EAB308',
    '--poke-danger': '#A91B1B',
    '--poke-danger-hover': '#8E1616',
    '--poke-plum': '#7A3B5C',
    '--poke-blue-light': '#EFF6FF',
    '--poke-green-light': '#F0FDF4',
    '--poke-yellow-light': '#FEFCE8',
    '--poke-danger-light': '#FEF2F2',
    '--poke-plum-light': '#F3E3EA',
    '--poke-yellow-ink': '#854d0e',
    '--poke-danger-ink': '#A91B1B',
    '--poke-danger-tint-ink': '#8E1616',
    '--poke-amber-ink': '#92400e',
    '--poke-on-blue': '#FFFFFF',
    '--poke-on-green': '#FFFFFF',
    '--poke-on-danger': '#FFFFFF',
    '--primary-foreground': '#FFF8E9',
    '--secondary-foreground': '#FFFFFF',
    '--destructive': '#A91B1B',
    '--destructive-foreground': '#FFFFFF',
  },
  dark: {
    '--background': '#0E0B06',
    '--foreground': '#F5EDDD',
    '--poke-base': '#0E0B06',
    '--poke-surface': '#171208',
    '--poke-elevated': '#241C0E',
    '--poke-muted': '#1D160A',
    '--poke-inverse': '#F5EDDD',
    '--poke-text-primary': '#F5EDDD',
    '--poke-text-secondary': '#C4B596',
    '--poke-text-muted': '#97886A',
    '--poke-text-tertiary': '#938567',
    '--poke-border': '#453C24',
    '--poke-border-strong': '#5C5133',
    '--poke-accent': '#F5B84B',
    '--poke-accent-strong': '#FFD166',
    '--poke-accent-light': 'rgba(245, 184, 75, 0.16)',
    '--poke-focus': '#FB923C',
    '--poke-live': '#4ADE80',
    '--poke-glow': 'rgba(245, 184, 75, 0.15)',
    '--poke-blue': '#659FF6',
    '--poke-blue-hover': '#87B4F8',
    '--poke-green': '#34C26A',
    '--poke-green-hover': '#5BD389',
    '--poke-yellow': '#EAB308',
    '--poke-danger': '#F4807A',
    '--poke-danger-hover': '#F8A09B',
    '--poke-plum': '#E39BB8',
    '--poke-blue-light': 'rgba(101, 159, 246, 0.15)',
    '--poke-green-light': 'rgba(52, 194, 106, 0.15)',
    '--poke-yellow-light': 'rgba(234, 179, 8, 0.15)',
    '--poke-danger-light': 'rgba(244, 128, 122, 0.15)',
    '--poke-plum-light': 'rgba(227, 155, 184, 0.16)',
    '--poke-yellow-ink': '#f2c55c',
    '--poke-danger-ink': '#F4807A',
    '--poke-danger-tint-ink': '#F8A09B',
    '--poke-amber-ink': '#fbbf24',
    '--poke-on-blue': '#0E0B06',
    '--poke-on-green': '#0E0B06',
    '--poke-on-danger': '#0E0B06',
    '--primary-foreground': '#171208',
    '--secondary-foreground': '#0E0B06',
    '--destructive': '#F4807A',
    '--destructive-foreground': '#0E0B06',
  },
} as const;

describe('plaza identity (I1)', () => {
  it('the plaza token set equals today\'s values in both modes', () => {
    expect(SITE_PALETTE_TOKENS.plaza).toEqual(PLAZA_PINNED);
  });
});

describe('completeness', () => {
  it('declares 43 base tokens, all unique', () => {
    expect(BASE_TOKEN_NAMES).toHaveLength(43);
    expect(new Set(BASE_TOKEN_NAMES).size).toBe(43);
  });

  it('every palette x mode has exactly BASE_TOKEN_NAMES', () => {
    expect(Object.keys(SITE_PALETTE_TOKENS).sort()).toEqual([...SITE_PALETTE_IDS].sort());
    for (const id of SITE_PALETTE_IDS) {
      expect(Object.keys(SITE_PALETTE_TOKENS[id]).sort(), id).toEqual(['dark', 'light']);
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(SITE_PALETTE_TOKENS[id][mode]).sort(), `${id} ${mode}`).toEqual(
          [...BASE_TOKEN_NAMES].sort(),
        );
      }
    }
  });
});

// ─── Contrast floor ────────────────────────────────────────────────────────

/** Moment chips (Layer 1 in globals.css, locked to the CSS by site-palette-css.test.ts). */
const MOMENTS = (mode: SitePaletteMode): ReadonlyArray<readonly [string, string, string]> =>
  SITE_MOMENT_NAMES.map((name) => [name, SITE_MOMENT_TOKENS[mode][name].ink, SITE_MOMENT_TOKENS[mode][name].bg]);

interface Pair {
  group: string;
  fgName: string;
  fg: string;
  bgName: string;
  bg: string;
  /** 0 = informational (not gated). */
  floor: number;
}

/** Every text / UI pair the app relies on, for one palette x mode. */
function pairs(id: SitePaletteId, mode: SitePaletteMode): Pair[] {
  const t = SITE_PALETTE_TOKENS[id][mode];
  const v = (name: BaseTokenName) => t[name];
  const list: Pair[] = [];
  const add = (group: string, fgName: string, fg: string, bgName: string, bg: string, floor: number) =>
    list.push({ group, fgName, fg, bgName, bg, floor });
  const surface = v('--poke-surface');
  const elevated = v('--poke-elevated');
  const grounds: Array<[string, string]> = [
    ['base', v('--poke-base')], ['surface', surface], ['elevated', elevated], ['muted', v('--poke-muted')],
  ];
  const three = grounds.slice(0, 3);
  const tint = (c: string) => (c.startsWith('rgba') ? over(c, surface) : c);

  const inks: Array<[BaseTokenName, string]> = [
    ['--poke-text-primary', 'text-primary'], ['--poke-text-secondary', 'text-secondary'],
    ['--poke-text-muted', 'text-muted'], ['--poke-text-tertiary', 'text-tertiary'],
  ];
  for (const [name, label] of inks) for (const [bn, bg] of grounds) add('ink', label, v(name), bn, bg, 4.5);
  const accents: Array<[BaseTokenName, string]> = [
    ['--poke-accent', 'accent (text)'], ['--poke-accent-strong', 'accent-strong (text)'], ['--poke-focus', 'focus / link text'],
  ];
  for (const [name, label] of accents) for (const [bn, bg] of three) add('accent', label, v(name), bn, bg, 4.5);

  add('button', 'primary-foreground', v('--primary-foreground'), 'accent', v('--poke-accent'), 4.5);
  add('button', 'primary-foreground', v('--primary-foreground'), 'accent-strong (hover)', v('--poke-accent-strong'), 4.5);
  add('button', 'text-inverse (surface)', surface, 'inverse', v('--poke-inverse'), 4.5);

  const status: Array<[BaseTokenName, string]> = [
    ['--poke-blue', 'blue (text)'], ['--poke-green', 'green (text)'], ['--poke-danger', 'danger (text)'],
  ];
  for (const [name, label] of status) for (const [bn, bg] of three) add('status', label, v(name), bn, bg, 4.5);

  add('status-fill', 'on-blue', v('--poke-on-blue'), 'blue', v('--poke-blue'), 4.5);
  add('status-fill', 'on-blue', v('--poke-on-blue'), 'blue-hover', v('--poke-blue-hover'), 4.5);
  add('status-fill', 'on-green', v('--poke-on-green'), 'green', v('--poke-green'), 4.5);
  add('status-fill', 'on-danger', v('--poke-on-danger'), 'danger', v('--poke-danger'), 4.5);
  add('status-fill', 'on-danger', v('--poke-on-danger'), 'danger-hover', v('--poke-danger-hover'), 4.5);
  add('status-fill', 'on-green', v('--poke-on-green'), 'green-hover', v('--poke-green-hover'), 4.5);
  add('status-fill', 'secondary-foreground', v('--secondary-foreground'), 'secondary (blue)', v('--poke-blue'), 4.5);
  add('status-fill', 'destructive-foreground', v('--destructive-foreground'), 'destructive', v('--destructive'), 4.5);
  // No text sits on a solid bg-poke-yellow (progress fills and the
  // LegalityBadge dot only); yellow text pairs use yellow-light (badge row
  // below, and component inks). Add a pair here when a component puts text on it.

  add('badge', 'accent', v('--poke-accent'), 'accent-light/surface', tint(v('--poke-accent-light')), 4.5);
  add('badge', 'blue', v('--poke-blue'), 'blue-light/surface', tint(v('--poke-blue-light')), 4.5);
  add('badge', 'green', v('--poke-green'), 'green-light/surface', tint(v('--poke-green-light')), 4.5);
  add('badge', 'danger', v('--poke-danger'), 'danger-light/surface', tint(v('--poke-danger-light')), 4.5);
  add('badge', 'plum', v('--poke-plum'), 'plum-light/surface', tint(v('--poke-plum-light')), 4.5);
  add('badge', 'yellow-ink', v('--poke-yellow-ink'), 'yellow-light/surface', tint(v('--poke-yellow-light')), 4.5);

  const overrides: Record<string, string> = SITE_PALETTE_DARK_MOMENT_OVERRIDES;
  for (const [name, fg0, bg] of MOMENTS(mode)) {
    const fg = mode === 'dark' && id !== 'plaza' ? (overrides[`--poke-moment-${name}`] ?? fg0) : fg0;
    add('moment', `moment-${name}`, fg, `moment-${name}-bg/surface`, over(bg, surface), 4.5);
  }

  // Status text on its own translucent tint (bg-poke-blue/10 text-poke-blue …).
  for (const [name, label] of [['--poke-blue', 'blue'], ['--poke-green', 'green']] as const) {
    for (const [gn, g] of [['surface', surface], ['elevated', elevated]] as const) {
      for (const al of [0.1, 0.15, 0.2]) {
        add('tint-text', `${label} (text)`, v(name), `${label}/${Math.round(al * 100)}/${gn}`, over(withAlpha(v(name), al), g), 4.5);
      }
    }
  }
  // On-colour text over the translucent hover fills the components keep.
  const hovers = [
    ['--poke-blue', '--poke-on-blue', 'on-blue', [0.8, 0.9]],
    ['--poke-green', '--poke-on-green', 'on-green', [0.9]],
  ] as const;
  for (const [hue, on, label, alphas] of hovers) {
    for (const [gn, g] of [['surface', surface], ['elevated', elevated]] as const) {
      for (const al of alphas) {
        add('hover-fill', label, v(on), `${label.slice(3)}/${Math.round(al * 100)}/${gn} (hover)`, over(withAlpha(v(hue), al), g), 4.5);
      }
    }
  }
  add('alert', 'yellow-ink (Alert warning)', v('--poke-yellow-ink'), 'yellow-light/surface', tint(v('--poke-yellow-light')), 4.5);
  add('picker', 'text-secondary (option description)', v('--poke-text-secondary'), 'accent-light/surface (checked row)', tint(v('--poke-accent-light')), 4.5);
  add('picker', 'text-primary (option label)', v('--poke-text-primary'), 'accent-light/surface (checked row)', tint(v('--poke-accent-light')), 4.5);

  // Navbar glass: color-mix(surface 80% | elevated 78% (dark), transparent) over the page ground.
  const glass = mode === 'light'
    ? over(withAlpha(surface, 0.8), v('--poke-base'))
    : over(withAlpha(elevated, 0.78), v('--poke-base'));
  add('navbar', 'text-primary', v('--poke-text-primary'), 'navbar glass/base', glass, 4.5);
  add('navbar', 'text-secondary', v('--poke-text-secondary'), 'navbar glass/base', glass, 4.5);
  add('navbar', 'accent (brand, 20px bold)', v('--poke-accent'), 'navbar glass/base', glass, 3);

  for (const [bn, bg] of three) add('non-text', 'focus ring', v('--poke-focus'), bn, bg, 3);
  add('non-text', 'accent indicator', v('--poke-accent'), 'base', v('--poke-base'), 3);
  add('non-text', 'live indicator', v('--poke-live'), 'surface', surface, 3);
  add('info', 'border', v('--poke-border'), 'surface', surface, 0);
  add('info', 'border-strong', v('--poke-border-strong'), 'surface', surface, 0);
  return list;
}

function failures(id: SitePaletteId): string[] {
  const out: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    for (const p of pairs(id, mode)) {
      if (p.floor > 0 && contrastRatio(p.fg, p.bg) < p.floor) out.push(`${mode} ${p.fgName} on ${p.bgName}`);
    }
  }
  return out;
}

describe('contrast floor (I4)', () => {
  it('models the same pair list in both modes', () => {
    for (const id of SITE_PALETTE_IDS) {
      const light = pairs(id, 'light').map((p) => `${p.group}|${p.bgName}`);
      const dark = pairs(id, 'dark').map((p) => `${p.group}|${p.bgName}`);
      expect(light).toEqual(dark);
      // The 88 rows of the spec's contrast table (palette-spec v2 §3), less
      // "ink on yellow fill": no component puts text on bg-poke-yellow.
      expect(light).toHaveLength(87);
    }
  });

  for (const id of SITE_PALETTE_IDS) {
    it(`${id}: every pair meets its floor in light and dark`, () => {
      expect(failures(id)).toEqual([]);
    });
  }

  it('spot-checks the ratio helper against the spec table', () => {
    const t = SITE_PALETTE_TOKENS;
    // The pre-AA plaza muted ink on the sand: the audit's 2.95:1.
    expect(contrastRatio('#8B7B5E', t.plaza.light['--poke-base'])).toBeCloseTo(2.95, 2);
    expect(contrastRatio(t.sakura.light['--poke-accent'], t.sakura.light['--poke-base'])).toBeCloseTo(4.53, 2);
    expect(contrastRatio(t.sakura.light['--poke-text-primary'], t.sakura.light['--poke-base'])).toBeCloseTo(11.33, 2);
  });
});

// ─── Component inks (warning / error text on its own tint) ─────────────────

const RED_500 = '#ef4444'; // static bg-red-500/NN error box / live chip tint
const AMBER_500 = '#f59e0b'; // static bg-amber-500/15 flag chip tint

/** Warning / error text that used to be static Tailwind (red-500, red-400,
 *  amber-600, yellow-700) and now reads the palette inks. Kept apart from
 *  the spec table above (its 88 rows stay fixed). */
function componentInkPairs(id: SitePaletteId, mode: SitePaletteMode): Pair[] {
  const t = SITE_PALETTE_TOKENS[id][mode];
  const v = (name: BaseTokenName) => t[name];
  const list: Pair[] = [];
  const add = (fgName: string, fg: string, bgName: string, bg: string) =>
    list.push({ group: 'component-ink', fgName, fg, bgName, bg, floor: 4.5 });
  const grounds: Array<[string, string]> = [
    ['base', v('--poke-base')], ['surface', v('--poke-surface')], ['elevated', v('--poke-elevated')],
  ];
  const tinted = grounds.slice(1);
  const tint = (c: string, g: string) => (c.startsWith('rgba') ? over(c, g) : c);

  // Inline error lines (WikiModerationPanel, avatar panels, ShowdownPicker, WikiNotesSection).
  for (const [gn, g] of grounds) add('danger-ink (error line)', v('--poke-danger-ink'), gn, g);
  // Error boxes and the live chip (CastStudio, SessionManager, Discord / social managers).
  for (const [gn, g] of tinted) {
    for (const al of [0.1, 0.2]) {
      add('danger-tint-ink (error box)', v('--poke-danger-tint-ink'), `red-500/${Math.round(al * 100)}/${gn}`, over(withAlpha(RED_500, al), g));
    }
  }
  // Test-account / flag chips (TestPlayersConsole, LeagueRosterManager).
  for (const [gn, g] of tinted) add('amber-ink (flag chip)', v('--poke-amber-ink'), `amber-500/15/${gn}`, over(withAlpha(AMBER_500, 0.15), g));
  // Legality warnings (LegalityBadge) and the yellow-tint labels (RoundRobinTable draw cell, MVP labels).
  for (const [gn, g] of grounds) add('yellow-ink (warning text)', v('--poke-yellow-ink'), gn, g);
  for (const [gn, g] of tinted) add('yellow-ink (on yellow tint)', v('--poke-yellow-ink'), `yellow-light/${gn}`, tint(v('--poke-yellow-light'), g));
  return list;
}

function componentInkFailures(id: SitePaletteId): string[] {
  const out: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    for (const p of componentInkPairs(id, mode)) {
      if (contrastRatio(p.fg, p.bg) < p.floor) out.push(`${mode} ${p.fgName} on ${p.bgName}`);
    }
  }
  return out;
}

describe('component inks (warning / error text on its own tint)', () => {
  for (const id of SITE_PALETTE_IDS) {
    it(`${id}: every component ink meets 4.5:1 in light and dark`, () => {
      expect(componentInkFailures(id)).toEqual([]);
    });
  }
});
