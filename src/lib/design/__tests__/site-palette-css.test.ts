import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  BASE_TOKEN_NAMES,
  SITE_PALETTE_IDS,
  type SitePaletteId,
  type SitePaletteMode,
} from '../site-palettes';
import {
  SITE_MOMENT_NAMES,
  SITE_MOMENT_TOKENS,
  SITE_PALETTE_DARK_MOMENT_OVERRIDES,
  SITE_PALETTE_TOKENS,
} from '../site-palette-tokens';
import { getRegisteredRouteThemeIds, getWorldByRouteThemeId, resolveWorld } from '@/lib/worlds/registry';
import type { RouteThemeId } from '@/types/season';

/**
 * Site palettes — globals.css contract (docs/design.md § Site palettes).
 *
 * Reads src/app/globals.css as text (comments stripped) and locks:
 * - Layer 0: every palette core declared once per mode, nowhere else;
 * - Layer 1 / Layer 2: every palette declares every base token in both
 *   modes, and the CSS resolves to the TS mirror (site-palette-tokens.ts);
 * - Layer 3: themed-world render unchanged — every themed [data-world]
 *   block pins its --world-* to the cores and resolves to today's values,
 *   the --hud-* declarations are byte-identical, and the Layer 1 pin list
 *   covers every themed world; the DOM-only default world pins nothing (it
 *   has no ground of its own, so it follows the site palette);
 * - the dark navbar glass reads the token, and the scene observer (I3)
 *   still ignores data-palette.
 *
 * Honest limit: a regex/brace parser over source, not a browser cascade.
 * The lead's visual pass is the runtime proof.
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripComments(read(join(SRC, 'app', 'globals.css')));

interface Rule {
  selector: string;
  decls: Map<string, string>;
  /** Raw declaration list in source order (duplicates kept). */
  list: Array<[string, string]>;
}

function parseDecls(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let start = 0;
  const push = (chunk: string) => {
    const i = chunk.indexOf(':');
    if (i > 0) out.push([chunk.slice(0, i).trim(), chunk.slice(i + 1).trim()]);
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return out;
}

const normalizeSelector = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

/** Leaf rules (no nested blocks), with at-rule wrappers flattened away. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: Array<{ prelude: string; bodyStart: number; hasChild: boolean }> = [];
  let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ prelude: css.slice(preludeStart, i), bodyStart: i + 1, hasChild: false });
      preludeStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) throw new Error(`unbalanced } at ${i}`);
      if (!top.hasChild) {
        const list = parseDecls(css.slice(top.bodyStart, i));
        rules.push({ selector: normalizeSelector(top.prelude), decls: new Map(list), list });
      }
      preludeStart = i + 1;
    } else if (ch === ';' && stack.length > 0) {
      preludeStart = i + 1;
    }
  }
  expect(stack, 'balanced braces').toHaveLength(0);
  return rules;
}

const RULES = parseRules(CSS);
const rulesFor = (selector: string) => RULES.filter((r) => r.selector === selector);
function onlyRule(selector: string): Rule {
  const found = rulesFor(selector);
  expect(found, `exactly one rule "${selector}"`).toHaveLength(1);
  return found[0];
}

const CORE_ROLES = [
  'ground', 'surface', 'elevated', 'ink', 'ink-secondary',
  'accent', 'accent-strong', 'focus', 'live', 'border',
] as const;
const WORLD_ROLES = [...CORE_ROLES.slice(0, 9), 'glow', 'border'] as const;
const CORE_NAMES = [
  ...SITE_PALETTE_IDS.flatMap((id) => CORE_ROLES.map((r) => `--palette-${id}-${r}`)),
  '--palette-plaza-glow',
];

/** Cores per mode: the --palette-* declarations of `:root` / `[data-theme="dark"]`. */
function cores(mode: SitePaletteMode): Map<string, string> {
  const selector = mode === 'light' ? ':root' : '[data-theme="dark"]';
  const map = new Map<string, string>();
  for (const rule of rulesFor(selector)) {
    for (const [name, value] of rule.list) if (name.startsWith('--palette-')) map.set(name, value);
  }
  return map;
}

/** Resolve var() references through the same block, then the cores. */
function resolve(value: string, block: Map<string, string>, mode: SitePaletteMode, depth = 0): string {
  expect(depth, `resolution depth for ${value}`).toBeLessThan(5);
  const m = /^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const [, name, fallback] = m;
  const next = name.startsWith('--palette-') ? cores(mode).get(name) : block.get(name);
  if (next !== undefined) return resolve(next, block, mode, depth + 1);
  expect(fallback, `unresolved ${name}`).toBeDefined();
  return resolve(fallback as string, block, mode, depth + 1);
}

/** The route-themed worlds' namespaces (each paints its own ground). */
function themedNamespaces(): string[] {
  const themed = getRegisteredRouteThemeIds().map((id) => {
    const world = getWorldByRouteThemeId(id);
    expect(world, id).not.toBeNull();
    return (world as NonNullable<typeof world>).tokenNamespace;
  });
  return [...new Set(themed)];
}

/** The DOM-only default world's namespace, reached through resolveWorld's
 *  fallback (the registry deliberately exports no handle to it). */
function fallbackNamespace(): string {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const fallback = resolveWorld({
    format_type: 'singles',
    route_theme: '__unregistered-test-theme__' as RouteThemeId,
  });
  warn.mockRestore();
  return fallback.tokenNamespace;
}

function layer1(mode: SitePaletteMode): Rule {
  const found = RULES.filter((r) =>
    mode === 'light'
      ? r.selector.startsWith(':root, :where(')
      : r.selector.startsWith('[data-theme="dark"], [data-theme="dark"] :where('),
  );
  expect(found, `Layer 1 ${mode} rule`).toHaveLength(1);
  return found[0];
}

function whereList(selector: string): string[] {
  const m = /:where\(([^)]*)\)/.exec(selector);
  expect(m, `:where list in ${selector}`).not.toBeNull();
  return (m as RegExpExecArray)[1].split(',').map((part) => {
    const w = /^\s*\[data-world="([a-z-]+)"\]\s*$/.exec(part);
    expect(w, `world attribute selector "${part}"`).not.toBeNull();
    return (w as RegExpExecArray)[1];
  });
}

function paletteBlock(id: Exclude<SitePaletteId, 'plaza'>, mode: SitePaletteMode): Rule {
  return onlyRule(mode === 'light' ? `html[data-palette="${id}"]` : `html[data-palette="${id}"][data-theme="dark"]`);
}

/** Today's world render (globals.css@1eecc4eb): 4 themed worlds x 2 modes x
 *  11 roles. evoliga inherited plaza through the root aliases;
 *  sakura, mountain and clouds had their own literals and borrowed plaza's
 *  glow. */
const WORLD_TODAY = {
  evoliga: {
    light: { 'ground': '#E8D9B5', 'surface': '#FFF8E9', 'elevated': '#FAEED6', 'ink': '#241A0C', 'ink-secondary': '#5C4E37', 'accent': '#C05E0A', 'accent-strong': '#8F4206', 'focus': '#B54708', 'live': '#166534', 'glow': 'rgba(192, 94, 10, 0.28)', 'border': '#E3D2AC' },
    dark: { 'ground': '#0E0B06', 'surface': '#171208', 'elevated': '#241C0E', 'ink': '#F5EDDD', 'ink-secondary': '#C4B596', 'accent': '#F5B84B', 'accent-strong': '#FFD166', 'focus': '#FB923C', 'live': '#4ADE80', 'glow': 'rgba(245, 184, 75, 0.15)', 'border': '#453C24' },
  },
  sakura: {
    light: { 'ground': '#f4e0e4', 'surface': '#fdf8f2', 'elevated': '#faeef1', 'ink': '#3a2333', 'ink-secondary': '#5d4153', 'accent': '#c2436c', 'accent-strong': '#992e55', 'focus': '#a1325b', 'live': '#1d7a53', 'glow': 'rgba(192, 94, 10, 0.28)', 'border': '#e6ccd3' },
    dark: { 'ground': '#1f1826', 'surface': '#2b2033', 'elevated': '#352942', 'ink': '#f5e9f1', 'ink-secondary': '#d3bcca', 'accent': '#f08cae', 'accent-strong': '#f7a8c3', 'focus': '#f2a0be', 'live': '#6fd7a8', 'glow': 'rgba(245, 184, 75, 0.15)', 'border': '#453351' },
  },
  mountain: {
    light: { 'ground': '#e3e7d6', 'surface': '#f8f6ee', 'elevated': '#edefdf', 'ink': '#2b352f', 'ink-secondary': '#566459', 'accent': '#97481e', 'accent-strong': '#8c421c', 'focus': '#8f441c', 'live': '#176344', 'glow': 'rgba(192, 94, 10, 0.28)', 'border': '#ccd3ba' },
    dark: { 'ground': '#1c2230', 'surface': '#272f41', 'elevated': '#323b50', 'ink': '#eef2f8', 'ink-secondary': '#c5cfde', 'accent': '#e9a56c', 'accent-strong': '#f2bd8d', 'focus': '#efb584', 'live': '#6fd7a8', 'glow': 'rgba(245, 184, 75, 0.15)', 'border': '#3e4a63' },
  },
  clouds: {
    light: { 'ground': '#e6edf4', 'surface': '#fbfdff', 'elevated': '#eff4f9', 'ink': '#223246', 'ink-secondary': '#4b5c72', 'accent': '#9c5a10', 'accent-strong': '#8a4d0c', 'focus': '#8f5210', 'live': '#176348', 'glow': 'rgba(192, 94, 10, 0.28)', 'border': '#cddae6' },
    dark: { 'ground': '#101a2c', 'surface': '#18263a', 'elevated': '#1f2f47', 'ink': '#eaf1fa', 'ink-secondary': '#c3d2e4', 'accent': '#f0b264', 'accent-strong': '#f6c786', 'focus': '#f2bb79', 'live': '#6fd7a8', 'glow': 'rgba(245, 184, 75, 0.15)', 'border': '#34465f' },
  },

} as const;

const HUD_TODAY = {
  'evoliga': {
    '--hud-glass': 'rgba(12, 122, 160, 0.46)',
    '--hud-glass-sheen': 'rgba(190, 244, 250, 0.28)',
    '--hud-glass-border': 'rgba(200, 244, 250, 0.42)',
    '--hud-track': 'rgba(3, 34, 48, 0.58)',
    '--hud-track-border': 'rgba(2, 20, 30, 0.45)',
    '--hud-panel-glass': 'rgba(6, 82, 110, 0.8)',
    '--hud-ink': '#f0fdfa',
    '--hud-ink-muted': 'rgba(240, 253, 250, 0.82)',
    '--hud-chip-hover': 'rgba(255, 255, 255, 0.12)',
    '--hud-chip-active': 'rgba(94, 234, 212, 0.22)',
    '--hud-chip-active-ring': 'rgba(153, 246, 228, 0.55)',
    '--hud-chip-active-ink': '#ecfeff',
    '--hud-focus': '#5eead4',
    '--hud-shadow': '0 10px 28px rgba(4, 40, 56, 0.3)',
    '--hud-selection': 'rgba(45, 212, 191, 0.35)',
  },
  'evoliga:dark': {
    '--hud-glass': 'rgba(8, 90, 122, 0.5)',
    '--hud-glass-sheen': 'rgba(94, 234, 212, 0.2)',
    '--hud-glass-border': 'rgba(94, 234, 212, 0.4)',
    '--hud-track': 'rgba(1, 18, 28, 0.62)',
    '--hud-track-border': 'rgba(0, 8, 14, 0.55)',
    '--hud-panel-glass': 'rgba(5, 62, 86, 0.84)',
    '--hud-ink': '#f0fdfa',
    '--hud-ink-muted': 'rgba(240, 253, 250, 0.78)',
    '--hud-chip-hover': 'rgba(240, 253, 250, 0.1)',
    '--hud-chip-active': 'rgba(94, 234, 212, 0.2)',
    '--hud-chip-active-ring': 'rgba(94, 234, 212, 0.6)',
    '--hud-chip-active-ink': '#ecfeff',
    '--hud-focus': '#5eead4',
    '--hud-shadow': '0 12px 32px rgba(0, 12, 14, 0.5)',
    '--hud-selection': 'rgba(45, 212, 191, 0.4)',
  },
  'sakura': {
    '--hud-glass': 'rgba(150, 52, 92, 0.42)',
    '--hud-glass-sheen': 'rgba(255, 226, 236, 0.3)',
    '--hud-glass-border': 'rgba(255, 214, 228, 0.44)',
    '--hud-track': 'rgba(46, 12, 28, 0.58)',
    '--hud-track-border': 'rgba(30, 8, 18, 0.45)',
    '--hud-panel-glass': 'rgba(88, 30, 54, 0.8)',
    '--hud-ink': '#fff1f6',
    '--hud-ink-muted': 'rgba(255, 241, 246, 0.82)',
    '--hud-chip-hover': 'rgba(255, 255, 255, 0.12)',
    '--hud-chip-active': 'rgba(244, 114, 182, 0.24)',
    '--hud-chip-active-ring': 'rgba(251, 146, 190, 0.55)',
    '--hud-chip-active-ink': '#fff0f5',
    '--hud-focus': '#f472b6',
    '--hud-shadow': '0 10px 28px rgba(56, 10, 32, 0.32)',
    '--hud-selection': 'rgba(244, 114, 182, 0.35)',
  },
  'sakura:dark': {
    '--hud-glass': 'rgba(96, 34, 62, 0.5)',
    '--hud-glass-sheen': 'rgba(244, 114, 182, 0.2)',
    '--hud-glass-border': 'rgba(244, 114, 182, 0.38)',
    '--hud-track': 'rgba(16, 8, 18, 0.62)',
    '--hud-track-border': 'rgba(8, 4, 10, 0.55)',
    '--hud-panel-glass': 'rgba(62, 22, 44, 0.84)',
    '--hud-ink': '#fff1f6',
    '--hud-ink-muted': 'rgba(255, 241, 246, 0.78)',
    '--hud-chip-hover': 'rgba(255, 241, 246, 0.1)',
    '--hud-chip-active': 'rgba(244, 114, 182, 0.2)',
    '--hud-chip-active-ring': 'rgba(244, 114, 182, 0.6)',
    '--hud-chip-active-ink': '#fff0f5',
    '--hud-focus': '#f472b6',
    '--hud-shadow': '0 12px 32px rgba(10, 4, 8, 0.5)',
    '--hud-selection': 'rgba(244, 114, 182, 0.4)',
  },
  'mountain': {
    '--hud-glass': 'rgba(20, 96, 96, 0.42)',
    '--hud-glass-sheen': 'rgba(214, 242, 238, 0.3)',
    '--hud-glass-border': 'rgba(206, 236, 230, 0.44)',
    '--hud-track': 'rgba(10, 32, 32, 0.58)',
    '--hud-track-border': 'rgba(6, 20, 20, 0.45)',
    '--hud-panel-glass': 'rgba(14, 66, 66, 0.8)',
    '--hud-ink': '#f0fdfc',
    '--hud-ink-muted': 'rgba(240, 253, 252, 0.82)',
    '--hud-chip-hover': 'rgba(255, 255, 255, 0.12)',
    '--hud-chip-active': 'rgba(94, 212, 200, 0.24)',
    '--hud-chip-active-ring': 'rgba(146, 232, 220, 0.55)',
    '--hud-chip-active-ink': '#ecfffc',
    '--hud-focus': '#5ed4c8',
    '--hud-shadow': '0 10px 28px rgba(8, 40, 38, 0.32)',
    '--hud-selection': 'rgba(94, 212, 200, 0.35)',
  },
  'mountain:dark': {
    '--hud-glass': 'rgba(14, 62, 66, 0.5)',
    '--hud-glass-sheen': 'rgba(94, 212, 200, 0.2)',
    '--hud-glass-border': 'rgba(94, 212, 200, 0.38)',
    '--hud-track': 'rgba(6, 16, 20, 0.62)',
    '--hud-track-border': 'rgba(3, 8, 10, 0.55)',
    '--hud-panel-glass': 'rgba(10, 48, 52, 0.84)',
    '--hud-ink': '#f0fdfc',
    '--hud-ink-muted': 'rgba(240, 253, 252, 0.78)',
    '--hud-chip-hover': 'rgba(240, 253, 252, 0.1)',
    '--hud-chip-active': 'rgba(94, 212, 200, 0.2)',
    '--hud-chip-active-ring': 'rgba(94, 212, 200, 0.6)',
    '--hud-chip-active-ink': '#ecfffc',
    '--hud-focus': '#5ed4c8',
    '--hud-shadow': '0 12px 32px rgba(2, 8, 10, 0.5)',
    '--hud-selection': 'rgba(94, 212, 200, 0.4)',
  },
  'clouds': {
    '--hud-glass': 'rgba(30, 104, 150, 0.42)',
    '--hud-glass-sheen': 'rgba(219, 240, 252, 0.3)',
    '--hud-glass-border': 'rgba(206, 234, 250, 0.44)',
    '--hud-track': 'rgba(8, 34, 52, 0.58)',
    '--hud-track-border': 'rgba(5, 22, 34, 0.45)',
    '--hud-panel-glass': 'rgba(12, 70, 106, 0.8)',
    '--hud-ink': '#f0f9ff',
    '--hud-ink-muted': 'rgba(240, 249, 255, 0.82)',
    '--hud-chip-hover': 'rgba(255, 255, 255, 0.12)',
    '--hud-chip-active': 'rgba(124, 212, 240, 0.24)',
    '--hud-chip-active-ring': 'rgba(166, 228, 248, 0.55)',
    '--hud-chip-active-ink': '#ecfaff',
    '--hud-focus': '#7cd4f0',
    '--hud-shadow': '0 10px 28px rgba(8, 42, 64, 0.32)',
    '--hud-selection': 'rgba(124, 212, 240, 0.35)',
  },
  'clouds:dark': {
    '--hud-glass': 'rgba(12, 52, 82, 0.5)',
    '--hud-glass-sheen': 'rgba(124, 212, 240, 0.2)',
    '--hud-glass-border': 'rgba(124, 212, 240, 0.38)',
    '--hud-track': 'rgba(4, 14, 24, 0.62)',
    '--hud-track-border': 'rgba(2, 8, 14, 0.55)',
    '--hud-panel-glass': 'rgba(8, 40, 64, 0.84)',
    '--hud-ink': '#f0f9ff',
    '--hud-ink-muted': 'rgba(240, 249, 255, 0.78)',
    '--hud-chip-hover': 'rgba(240, 249, 255, 0.1)',
    '--hud-chip-active': 'rgba(124, 212, 240, 0.2)',
    '--hud-chip-active-ring': 'rgba(124, 212, 240, 0.6)',
    '--hud-chip-active-ink': '#ecfaff',
    '--hud-focus': '#7cd4f0',
    '--hud-shadow': '0 12px 32px rgba(0, 4, 10, 0.5)',
    '--hud-selection': 'rgba(124, 212, 240, 0.4)',
  },
} as const;

describe('Layer 0: palette cores', () => {
  it('declares every core exactly once per mode, and nowhere else', () => {
    for (const mode of ['light', 'dark'] as const) {
      const selector = mode === 'light' ? ':root' : '[data-theme="dark"]';
      const counts = new Map<string, number>();
      for (const rule of rulesFor(selector)) {
        for (const [name] of rule.list) if (name.startsWith('--palette-')) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      expect([...counts.keys()].sort(), mode).toEqual([...CORE_NAMES].sort());
      for (const [name, n] of counts) expect(n, `${mode} ${name}`).toBe(1);
    }
    const elsewhere = RULES.filter(
      (r) => r.selector !== ':root' && r.selector !== '[data-theme="dark"]' && r.list.some(([n]) => n.startsWith('--palette-')),
    ).map((r) => r.selector);
    expect(elsewhere).toEqual([]);
  });
});

describe('Layers 1-2: every palette defines every base token in both modes', () => {
  it('plaza (Layer 1) declares the full set in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const rule = layer1(mode);
      for (const name of BASE_TOKEN_NAMES) expect(rule.decls.has(name), `plaza ${mode} ${name}`).toBe(true);
    }
  });

  it('each html[data-palette] block declares the full set in light and dark', () => {
    for (const id of SITE_PALETTE_IDS) {
      if (id === 'plaza') continue;
      for (const mode of ['light', 'dark'] as const) {
        const rule = paletteBlock(id, mode);
        for (const name of BASE_TOKEN_NAMES) expect(rule.decls.has(name), `${id} ${mode} ${name}`).toBe(true);
      }
    }
  });

  it('no html[data-palette="plaza"] block exists (absent attribute = plaza)', () => {
    expect(RULES.filter((r) => r.selector.includes('data-palette="plaza"'))).toEqual([]);
    expect(CSS).not.toContain('data-palette="plaza"');
  });

  it('only the three non-plaza palettes have Layer 2 blocks', () => {
    const selectors = RULES.map((r) => r.selector).filter((s) => s.includes('data-palette')).sort();
    expect(selectors).toEqual(
      ['sakura', 'mountain', 'clouds']
        .flatMap((id) => [`html[data-palette="${id}"]`, `html[data-palette="${id}"][data-theme="dark"]`])
        .sort(),
    );
  });
});

describe('CSS <-> TS parity (values resolve to SITE_PALETTE_TOKENS)', () => {
  for (const id of SITE_PALETTE_IDS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${id} ${mode}`, () => {
        const rule = id === 'plaza' ? layer1(mode) : paletteBlock(id, mode);
        const resolved = Object.fromEntries(BASE_TOKEN_NAMES.map((n) => [n, resolve(rule.decls.get(n) ?? '', rule.decls, mode)]));
        expect(resolved).toEqual(SITE_PALETTE_TOKENS[id][mode]);
      });
    }
  }

  it('the dark non-plaza blocks carry exactly the moment-chip overrides; nothing else overrides moments', () => {
    const overrideNames = Object.keys(SITE_PALETTE_DARK_MOMENT_OVERRIDES).sort();
    for (const id of ['sakura', 'mountain', 'clouds'] as const) {
      const dark = paletteBlock(id, 'dark');
      for (const [name, value] of Object.entries(SITE_PALETTE_DARK_MOMENT_OVERRIDES)) {
        expect(dark.decls.get(name), `${id} dark ${name}`).toBe(value);
      }
      const darkMoments = dark.list.map(([n]) => n).filter((n) => n.startsWith('--poke-moment-')).sort();
      expect(darkMoments, `${id} dark moment keys`).toEqual(overrideNames);
      expect(paletteBlock(id, 'light').list.some(([n]) => n.startsWith('--poke-moment-')), `${id} light`).toBe(false);
    }
  });

  it('Layer 1 declares the moment chips SITE_MOMENT_TOKENS models (the contrast suite reads them)', () => {
    for (const mode of ['light', 'dark'] as const) {
      const decls = layer1(mode).decls;
      const declared = [...decls.keys()].filter((n) => n.startsWith('--poke-moment-')).sort();
      const modeled = SITE_MOMENT_NAMES.flatMap((name) => [`--poke-moment-${name}`, `--poke-moment-${name}-bg`]).sort();
      expect(declared, `${mode} moment keys`).toEqual(modeled);
      for (const name of SITE_MOMENT_NAMES) {
        expect(decls.get(`--poke-moment-${name}`), `${mode} ${name}`).toBe(SITE_MOMENT_TOKENS[mode][name].ink);
        expect(decls.get(`--poke-moment-${name}-bg`), `${mode} ${name}-bg`).toBe(SITE_MOMENT_TOKENS[mode][name].bg);
      }
    }
  });
});

describe('Layer 3: world render unchanged (I2, D4)', () => {
  it('the Layer 1 :where pin lists name exactly the themed world namespaces', () => {
    const expected = themedNamespaces().sort();
    expect(expected).toEqual(['clouds', 'evoliga', 'mountain', 'sakura']);
    expect(whereList(layer1('light').selector).sort()).toEqual(expected);
    expect(whereList(layer1('dark').selector).sort()).toEqual(expected);
  });

  it('the DOM-only default world pins nothing, so it follows the site palette', () => {
    const fallback = fallbackNamespace();
    expect(fallback).toBe('default');
    expect(themedNamespaces()).not.toContain(fallback);
    const pinning = RULES.filter(
      (r) => r.selector.includes(`[data-world="${fallback}"]`)
        && r.list.some(([n]) => n.startsWith('--world-') || n.startsWith('--poke-') || n === '--background'),
    ).map((r) => r.selector);
    expect(pinning).toEqual([]);
    // With no pin, the default world reads the root aliases (--world-* = --poke-*).
    const root = RULES.filter((r) => r.selector === ':root' && r.decls.has('--world-ground'));
    expect(root).toHaveLength(1);
    expect(root[0].decls.get('--world-ground')).toBe('var(--poke-base)');
  });

  for (const world of Object.keys(WORLD_TODAY) as Array<keyof typeof WORLD_TODAY>) {
    it(`${world}: pins all 11 --world-* to the cores and resolves to today's values`, () => {
      const own = world === 'evoliga' ? 'plaza' : world;
      const rule = onlyRule(`[data-world="${world}"]`);
      for (const role of WORLD_ROLES) {
        const core = role === 'glow' ? 'plaza' : own;
        expect(rule.decls.get(`--world-${role}`), `${world} --world-${role}`).toBe(`var(--palette-${core}-${role})`);
      }
      for (const mode of ['light', 'dark'] as const) {
        const resolved = Object.fromEntries(
          WORLD_ROLES.map((role) => [role, resolve(rule.decls.get(`--world-${role}`) ?? '', rule.decls, mode)]),
        );
        expect(resolved, `${world} ${mode}`).toEqual(WORLD_TODAY[world][mode]);
      }
    });
  }

  it('no dark world block declares a --world-* (the cores carry moonlit values)', () => {
    const offenders = RULES.filter(
      (r) => /^\[data-theme="dark"\] \[data-world="[a-z-]+"\]$/.test(r.selector) && r.list.some(([n]) => n.startsWith('--world-')),
    ).map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  it('every world block keeps its --hud-* declarations byte for byte', () => {
    for (const [key, hud] of Object.entries(HUD_TODAY)) {
      const [world, dark] = key.split(':');
      const rule = onlyRule(dark ? `[data-theme="dark"] [data-world="${world}"]` : `[data-world="${world}"]`);
      const actual = Object.fromEntries(rule.list.filter(([n]) => n.startsWith('--hud-')));
      expect(actual, key).toEqual(hud);
    }
  });
});

describe('chrome and scene guards', () => {
  it('the dark navbar glass reads --poke-elevated, no hex', () => {
    const rule = onlyRule('[data-theme="dark"] [data-navbar-glass]');
    const bg = rule.decls.get('background-color') ?? '';
    expect(bg).toContain('var(--poke-elevated)');
    expect(bg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('I3: the scene observer still watches only data-theme', () => {
    const provider = read(join(SRC, 'components', 'world', 'route', 'WorldStateProvider.tsx'));
    expect(provider).toContain("attributeFilter: ['data-theme']");
    expect(provider).not.toContain('data-palette');
  });
});
