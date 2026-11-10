import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileUtilities, themeColors } from '@/test/tailwind-theme';

/**
 * Site palettes — Tailwind status colours (docs/design.md § Site palettes).
 *
 * Every site colour is a plain `var(--poke-x)` token that follows the site
 * palette; Tailwind 4 alpha-blends any colour, so `/NN` modifiers work on all
 * of them. On Tailwind 3 only the status hues (poke.blue/green/yellow/danger
 * and their hovers) rendered `/NN`, so the source scan below keeps the other
 * tokens free of modifiers until they come back as deliberate changes. The
 * `art.*` statics stay hex: artwork such as the franchise ball red must not
 * follow a palette.
 *
 * The theme and the pipeline come from src/test/tailwind-theme.ts, so this
 * file does not depend on where the theme is declared.
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

const STATUS_HUES = ['blue', 'blue-hover', 'green', 'green-hover', 'yellow', 'danger', 'danger-hover'];

describe('theme status colours', () => {
  it('the status hues are plain var() tokens', () => {
    const colors = themeColors();
    for (const hue of STATUS_HUES) expect(colors[`poke-${hue}`], hue).toBe(`var(--poke-${hue})`);
  });

  it('the on-colours and the Alert ink are plain var() tokens', () => {
    const colors = themeColors();
    expect(colors['poke-on-blue']).toBe('var(--poke-on-blue)');
    expect(colors['poke-on-green']).toBe('var(--poke-on-green)');
    expect(colors['poke-on-danger']).toBe('var(--poke-on-danger)');
    expect(colors['poke-yellow-ink']).toBe('var(--poke-yellow-ink)');
    expect(colors['poke-danger-ink']).toBe('var(--poke-danger-ink)');
    expect(colors['poke-danger-tint-ink']).toBe('var(--poke-danger-tint-ink)');
    expect(colors['poke-amber-ink']).toBe('var(--poke-amber-ink)');
  });

  it('the art statics are hex, never var()', () => {
    const colors = themeColors();
    expect(colors['art-ball-red']).toBe('#DC2626');
    expect(colors['art-card-blue']).toBe('#3B82F6');
    const art = Object.entries(colors).filter(([name]) => name.startsWith('art-'));
    expect(art.length).toBeGreaterThan(0);
    for (const [, value] of art) expect(value).not.toContain('var(');
  });

  it('every poke token except the type colours is a plain var()', () => {
    for (const [name, value] of Object.entries(themeColors())) {
      if (!name.startsWith('poke-') || name.startsWith('poke-type-')) continue;
      expect(value, name).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe('source stays free of dead opacity modifiers', () => {
  const REPO = join(SRC, '..');
  const PREFIXES =
    'bg|text|border|ring-offset|ring|divide|fill|stroke|outline|from|via|to|placeholder|decoration|shadow|accent|caret';

  /** Colours whose /NN modifier generated nothing on Tailwind 3.4 (a plain var() other than the status hues) and renders on Tailwind 4. */
  function plainVarColours(): string[] {
    const statusNames = new Set(STATUS_HUES.map((hue) => `poke-${hue}`));
    const names = new Set(['poke-primary']);
    for (const [name, value] of Object.entries(themeColors())) if (value.startsWith('var(') && !statusNames.has(name)) names.add(name);
    return [...names];
  }

  function deadModifiers(source: string, names: string[]): string[] {
    const alternation = [...names]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const pattern = new RegExp(
      `(?<![\\w-])(?:[^\\s"'\`:]+:)*(?:${PREFIXES})(?:-[trblxyse])?-(?:${alternation})/(?:\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])(?![\\w-])`,
      'g',
    );
    return [...source.matchAll(pattern)].map((match) => match[0]);
  }

  it('the scan finds a dead modifier and ignores the status hues and the art statics', () => {
    const names = plainVarColours();
    expect(names).toEqual(expect.arrayContaining(['poke-surface', 'poke-primary', 'arena-ground', 'muted-foreground']));
    expect(deadModifiers('hover:bg-poke-surface/50 md:ring-poke-border-focus/20 bg-arena-ground/80', names)).toEqual([
      'hover:bg-poke-surface/50',
      'md:ring-poke-border-focus/20',
      'bg-arena-ground/80',
    ]);
    expect(
      deadModifiers('bg-poke-blue/20 border-poke-danger-hover/40 bg-art-card-blue/10 bg-poke-surface', names),
    ).toEqual([]);
  });

  it('no tracked source file under src/ (tests excluded) puts an opacity modifier on a plain var() colour', () => {
    const names = plainVarColours();
    const files = execFileSync('git', ['ls-files', '-z', '--', 'src'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
      .split('\0')
      .filter((file) => /\.(tsx?|jsx?|mjs|cjs|css|mdx?)$/.test(file) && !/(\.test\.|__tests__\/)/.test(file));
    expect(files.length).toBeGreaterThan(1000);
    const offenders: string[] = [];
    for (const file of files) {
      const found = deadModifiers(read(join(REPO, file)), names);
      if (found.length > 0) offenders.push(`${file}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders, 'Tailwind 3 dropped <var colour>/NN and Tailwind 4 renders it, so each one is a visible change: use a solid token or a status hue').toEqual([]);
  });
});

describe('generated utilities (postcss + @tailwindcss/postcss)', () => {
  function ruleBody(css: string, selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : null;
  }

  it('reads every colour through its variable, mixes /NN with transparent, and keeps art hex', async () => {
    const css = await compileUtilities(
      'bg-poke-blue bg-poke-blue/20 border-poke-blue/40 from-poke-blue text-poke-on-blue bg-art-card-blue/10 bg-poke-surface/50',
    );
    expect(ruleBody(css, '.bg-poke-blue')).toContain('background-color: var(--poke-blue)');
    expect(ruleBody(css, '.bg-poke-blue\\/20')).toContain('color-mix(in oklab, var(--poke-blue) 20%, transparent)');
    expect(ruleBody(css, '.border-poke-blue\\/40')).toContain('var(--poke-blue) 40%');
    expect(ruleBody(css, '.text-poke-on-blue')).toContain('var(--poke-on-blue)');
    expect(ruleBody(css, '.bg-art-card-blue\\/10')).toContain('#3B82F6 10%');
    // A plain token with /NN now renders, which is why the source scan above forbids such classes.
    expect(ruleBody(css, '.bg-poke-surface\\/50')).toContain('var(--poke-surface) 50%');
  });
});

describe('artwork stays off the palette', () => {
  it('the Pokéball red half is the static art colour', () => {
    const source = read(join(SRC, 'components', 'shared', 'Pokeball.tsx'));
    expect(source).toContain('bg-art-ball-red');
    expect(source).not.toContain('bg-poke-danger');
  });
});
