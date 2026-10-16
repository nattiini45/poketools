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
import { SITE_PALETTE_DARK_MOMENT_OVERRIDES, SITE_PALETTE_TOKENS } from '../site-palette-tokens';
import { getRegisteredRouteThemeIds, getWorldByRouteThemeId } from '@/lib/worlds/registry';
import { contrastRatio, over, withAlpha } from './wcag';

/**
 * Site palettes (docs/design.md § Site palettes): the shared interface, the
 * plaza identity lock, completeness, and the contrast floor.
 *
 * Contrast: every non-plaza pair meets its floor (text 4.5:1, non-text UI
 * 3:1). Plaza keeps today's values, so its failures must equal
 * KNOWN_PLAZA_FAILURES exactly — the list can only shrink (by an owner
 * decision that changes plaza), never grow.
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

/** Today's plaza values (globals.css@1eecc4eb, both modes). The ten tokens
 *  this work added carry the old static Tailwind values (blue-hover
 *  #2563EB, green-700, red-700, white on-colours, yellow-700 ink, and the
 *  component inks red-500 / red-400 / amber-600). */
const PLAZA_TODAY = {
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
    '--poke-text-muted': '#8B7B5E',
    '--poke-text-tertiary': '#A3926F',
    '--poke-border': '#E3D2AC',
    '--poke-border-strong': '#C9B183',
    '--poke-accent': '#C05E0A',
    '--poke-accent-strong': '#8F4206',
    '--poke-accent-light': '#F7E8CF',
    '--poke-focus': '#B54708',
    '--poke-live': '#166534',
    '--poke-glow': 'rgba(192, 94, 10, 0.28)',
    '--poke-blue': '#3B82F6',
    '--poke-blue-hover': '#2563EB',
    '--poke-green': '#16A34A',
    '--poke-green-hover': '#15803D',
    '--poke-yellow': '#EAB308',
    '--poke-danger': '#DC2626',
    '--poke-danger-hover': '#B91C1C',
    '--poke-plum': '#7A3B5C',
    '--poke-blue-light': '#EFF6FF',
    '--poke-green-light': '#F0FDF4',
    '--poke-yellow-light': '#FEFCE8',
    '--poke-danger-light': '#FEF2F2',
    '--poke-plum-light': '#F3E3EA',
    '--poke-yellow-ink': '#a16207',
    '--poke-danger-ink': '#ef4444',
    '--poke-danger-tint-ink': '#f87171',
    '--poke-amber-ink': '#d97706',
    '--poke-on-blue': '#FFFFFF',
    '--poke-on-green': '#FFFFFF',
    '--poke-on-danger': '#FFFFFF',
    '--primary-foreground': '#FFF8E9',
    '--secondary-foreground': '#FFFFFF',
    '--destructive': '#DC2626',
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
    '--poke-text-tertiary': '#7D6F52',
    '--poke-border': '#453C24',
    '--poke-border-strong': '#5C5133',
    '--poke-accent': '#F5B84B',
    '--poke-accent-strong': '#FFD166',
    '--poke-accent-light': 'rgba(245, 184, 75, 0.16)',
    '--poke-focus': '#FB923C',
    '--poke-live': '#4ADE80',
    '--poke-glow': 'rgba(245, 184, 75, 0.15)',
    '--poke-blue': '#3B82F6',
    '--poke-blue-hover': '#2563EB',
    '--poke-green': '#16A34A',
    '--poke-green-hover': '#15803D',
    '--poke-yellow': '#EAB308',
    '--poke-danger': '#DC2626',
    '--poke-danger-hover': '#B91C1C',
    '--poke-plum': '#E39BB8',
    '--poke-blue-light': 'rgba(59, 130, 246, 0.15)',
    '--poke-green-light': 'rgba(22, 163, 74, 0.15)',
    '--poke-yellow-light': 'rgba(234, 179, 8, 0.15)',
    '--poke-danger-light': 'rgba(220, 38, 38, 0.15)',
    '--poke-plum-light': 'rgba(227, 155, 184, 0.16)',
    '--poke-yellow-ink': '#a16207',
    '--poke-danger-ink': '#ef4444',
    '--poke-danger-tint-ink': '#f87171',
    '--poke-amber-ink': '#d97706',
    '--poke-on-blue': '#FFFFFF',
    '--poke-on-green': '#FFFFFF',
    '--poke-on-danger': '#FFFFFF',
    '--primary-foreground': '#171208',
    '--secondary-foreground': '#ededed',
    '--destructive': '#DC2626',
    '--destructive-foreground': '#ededed',
  },
} as const;

describe('plaza identity (I1)', () => {
  it('the plaza token set equals today\'s values in both modes', () => {
    expect(SITE_PALETTE_TOKENS.plaza).toEqual(PLAZA_TODAY);
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

const YELLOW_700 = '#a16207'; // Badge.tsx light-mode yellow ink (static Tailwind)
const BLUE_300 = '#93c5fd'; // Badge.tsx dark-mode blue ink override (static Tailwind)

/** Moment chips (globals.css, mode-dependent, palette-independent). */
const MOMENTS: Record<SitePaletteMode, ReadonlyArray<readonly [string, string, string]>> = {
  light: [
    ['amber', '#92400e', 'rgba(245, 158, 11, 0.15)'],
    ['red', '#991b1b', 'rgba(239, 68, 68, 0.15)'],
    ['purple', '#6b21a8', 'rgba(168, 85, 247, 0.15)'],
    ['emerald', '#065f46', 'rgba(16, 185, 129, 0.15)'],
    ['blue', '#1e40af', 'rgba(59, 130, 246, 0.15)'],
  ],
  dark: [
    ['amber', '#fbbf24', 'rgba(245, 158, 11, 0.2)'],
    ['red', '#f87171', 'rgba(239, 68, 68, 0.2)'],
    ['purple', '#c084fc', 'rgba(168, 85, 247, 0.2)'],
    ['emerald', '#34d399', 'rgba(16, 185, 129, 0.2)'],
    ['blue', '#60a5fa', 'rgba(59, 130, 246, 0.2)'],
  ],
};

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
  add('status-fill', 'ink on yellow fill', mode === 'light' ? v('--poke-text-primary') : v('--poke-base'), 'yellow', v('--poke-yellow'), 4.5);

  add('badge', 'accent', v('--poke-accent'), 'accent-light/surface', tint(v('--poke-accent-light')), 4.5);
  add('badge', 'blue', mode === 'dark' ? BLUE_300 : v('--poke-blue'), 'blue-light/surface', tint(v('--poke-blue-light')), 4.5);
  add('badge', 'green', v('--poke-green'), 'green-light/surface', tint(v('--poke-green-light')), 4.5);
  add('badge', 'danger', v('--poke-danger'), 'danger-light/surface', tint(v('--poke-danger-light')), 4.5);
  add('badge', 'plum', v('--poke-plum'), 'plum-light/surface', tint(v('--poke-plum-light')), 4.5);
  add(
    'badge',
    mode === 'light' ? 'yellow-700 (static)' : 'yellow',
    mode === 'light' ? YELLOW_700 : v('--poke-yellow'),
    'yellow-light/surface',
    tint(v('--poke-yellow-light')),
    4.5,
  );

  const overrides: Record<string, string> = SITE_PALETTE_DARK_MOMENT_OVERRIDES;
  for (const [name, fg0, bg] of MOMENTS[mode]) {
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

/** Plaza pairs under their floor today (unchanged by this work; fixing them
 *  changes plaza and is a separate product decision). Remove an entry when it
 *  is fixed; never add one. */
const KNOWN_PLAZA_FAILURES = [
  'light text-muted on base',
  'light text-muted on surface',
  'light text-muted on elevated',
  'light text-muted on muted',
  'light text-tertiary on base',
  'dark text-tertiary on base',
  'light text-tertiary on surface',
  'dark text-tertiary on surface',
  'light text-tertiary on elevated',
  'dark text-tertiary on elevated',
  'light text-tertiary on muted',
  'dark text-tertiary on muted',
  'light accent (text) on base',
  'light accent (text) on surface',
  'light accent (text) on elevated',
  'light focus / link text on base',
  'light primary-foreground on accent',
  'light blue (text) on base',
  'light blue (text) on surface',
  'light blue (text) on elevated',
  'light green (text) on base',
  'light green (text) on surface',
  'light green (text) on elevated',
  'light danger (text) on base',
  'dark danger (text) on base',
  'dark danger (text) on surface',
  'light danger (text) on elevated',
  'dark danger (text) on elevated',
  'light on-blue on blue',
  'dark on-blue on blue',
  'light on-green on green',
  'dark on-green on green',
  'light secondary-foreground on secondary (blue)',
  'dark secondary-foreground on secondary (blue)',
  'dark destructive-foreground on destructive',
  'light accent on accent-light/surface',
  'light blue on blue-light/surface',
  'light green on green-light/surface',
  'light danger on danger-light/surface',
  'dark danger on danger-light/surface',
  'light blue (text) on blue/10/surface',
  'light blue (text) on blue/15/surface',
  'dark blue (text) on blue/15/surface',
  'light blue (text) on blue/20/surface',
  'dark blue (text) on blue/20/surface',
  'light blue (text) on blue/10/elevated',
  'dark blue (text) on blue/10/elevated',
  'light blue (text) on blue/15/elevated',
  'dark blue (text) on blue/15/elevated',
  'light blue (text) on blue/20/elevated',
  'dark blue (text) on blue/20/elevated',
  'light green (text) on green/10/surface',
  'light green (text) on green/15/surface',
  'light green (text) on green/20/surface',
  'dark green (text) on green/20/surface',
  'light green (text) on green/10/elevated',
  'light green (text) on green/15/elevated',
  'dark green (text) on green/15/elevated',
  'light green (text) on green/20/elevated',
  'dark green (text) on green/20/elevated',
  'light on-blue on blue/80/surface (hover)',
  'light on-blue on blue/90/surface (hover)',
  'dark on-blue on blue/90/surface (hover)',
  'light on-blue on blue/80/elevated (hover)',
  'light on-blue on blue/90/elevated (hover)',
  'dark on-blue on blue/90/elevated (hover)',
  'light on-green on green/90/surface (hover)',
  'dark on-green on green/90/surface (hover)',
  'light on-green on green/90/elevated (hover)',
  'dark on-green on green/90/elevated (hover)',
  'dark yellow-ink (Alert warning) on yellow-light/surface',
];

describe('contrast floor (I4)', () => {
  it('models the same pair list in both modes', () => {
    for (const id of SITE_PALETTE_IDS) {
      const light = pairs(id, 'light').map((p) => `${p.group}|${p.bgName}`);
      const dark = pairs(id, 'dark').map((p) => `${p.group}|${p.bgName}`);
      expect(light).toEqual(dark);
      // The 88 rows of the spec's contrast table (palette-spec v2 §3).
      expect(light).toHaveLength(88);
    }
  });

  for (const id of SITE_PALETTE_IDS.filter((p) => p !== 'plaza')) {
    it(`${id}: every pair meets its floor in light and dark`, () => {
      expect(failures(id)).toEqual([]);
    });
  }

  it('plaza: failures equal KNOWN_PLAZA_FAILURES exactly (71, pre-existing)', () => {
    expect(KNOWN_PLAZA_FAILURES).toHaveLength(71);
    expect(failures('plaza').sort()).toEqual([...KNOWN_PLAZA_FAILURES].sort());
  });

  it('spot-checks the ratio helper against the spec table', () => {
    const t = SITE_PALETTE_TOKENS;
    expect(contrastRatio(t.plaza.light['--poke-text-muted'], t.plaza.light['--poke-base'])).toBeCloseTo(2.95, 2);
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

/** Plaza component-ink pairs under 4.5:1 at 1eecc4eb (the static Tailwind
 *  values, unchanged: plaza keeps today's pixels). Same rule as
 *  KNOWN_PLAZA_FAILURES: remove an entry when it is fixed; never add one. */
const KNOWN_PLAZA_COMPONENT_INK_FAILURES = [
  'dark amber-ink (flag chip) on amber-500/15/elevated',
  'dark danger-ink (error line) on elevated',
  'dark yellow-ink (on yellow tint) on yellow-light/elevated',
  'dark yellow-ink (on yellow tint) on yellow-light/surface',
  'dark yellow-ink (warning text) on base',
  'dark yellow-ink (warning text) on elevated',
  'dark yellow-ink (warning text) on surface',
  'light amber-ink (flag chip) on amber-500/15/elevated',
  'light amber-ink (flag chip) on amber-500/15/surface',
  'light danger-ink (error line) on base',
  'light danger-ink (error line) on elevated',
  'light danger-ink (error line) on surface',
  'light danger-tint-ink (error box) on red-500/10/elevated',
  'light danger-tint-ink (error box) on red-500/10/surface',
  'light danger-tint-ink (error box) on red-500/20/elevated',
  'light danger-tint-ink (error box) on red-500/20/surface',
  'light yellow-ink (warning text) on base',
  'light yellow-ink (warning text) on elevated',
];

describe('component inks (review fix: static Tailwind inks on the dusk surfaces)', () => {
  for (const id of SITE_PALETTE_IDS.filter((p) => p !== 'plaza')) {
    it(`${id}: every component ink meets 4.5:1 in light and dark`, () => {
      expect(componentInkFailures(id)).toEqual([]);
    });
  }

  it('plaza: failures equal KNOWN_PLAZA_COMPONENT_INK_FAILURES exactly (18, pre-existing)', () => {
    expect(KNOWN_PLAZA_COMPONENT_INK_FAILURES).toHaveLength(18);
    expect(componentInkFailures('plaza').sort()).toEqual([...KNOWN_PLAZA_COMPONENT_INK_FAILURES].sort());
  });
});
