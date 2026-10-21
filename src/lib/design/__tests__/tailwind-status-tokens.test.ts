import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import config from '../../../../tailwind.config';

/**
 * Site palettes — Tailwind status colours (docs/design.md § Site palettes).
 *
 * The status hues (poke.blue/green/yellow/danger and their hovers) follow
 * the site palette through `color-mix(… var(--poke-x) calc(<alpha-value> *
 * 100%) …)`, so `/NN` modifiers keep working. The `art.*` statics stay hex:
 * html2canvas (the MatchHighlightCard export) cannot parse the `color(srgb
 * …)` value Chrome computes for color-mix, and the franchise ball red must
 * not follow a palette.
 *
 * The pipeline runs through the typed public API (postcss + tailwindcss);
 * never import tailwindcss/lib/* (no .d.ts, breaks tsc).
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

type ColorScale = Record<string, string>;

function colors(): Record<string, ColorScale> {
  const extend = config.theme?.extend as { colors?: Record<string, ColorScale> } | undefined;
  expect(extend?.colors, 'theme.extend.colors').toBeDefined();
  return extend?.colors ?? {};
}

describe('tailwind.config status colours', () => {
  it('the status hues are variable-backed and keep <alpha-value>', () => {
    const poke = colors().poke;
    const tokens: Record<string, string> = {
      blue: '--poke-blue',
      'blue-hover': '--poke-blue-hover',
      green: '--poke-green',
      'green-hover': '--poke-green-hover',
      yellow: '--poke-yellow',
      danger: '--poke-danger',
      'danger-hover': '--poke-danger-hover',
    };
    for (const [key, variable] of Object.entries(tokens)) {
      expect(poke[key], key).toContain(`var(${variable})`);
      expect(poke[key], key).toContain('<alpha-value>');
    }
  });

  it('the on-colours and the Alert ink are plain var() tokens', () => {
    const poke = colors().poke;
    expect(poke['on-blue']).toBe('var(--poke-on-blue)');
    expect(poke['on-green']).toBe('var(--poke-on-green)');
    expect(poke['on-danger']).toBe('var(--poke-on-danger)');
    expect(poke['yellow-ink']).toBe('var(--poke-yellow-ink)');
    expect(poke['danger-ink']).toBe('var(--poke-danger-ink)');
    expect(poke['danger-tint-ink']).toBe('var(--poke-danger-tint-ink)');
    expect(poke['amber-ink']).toBe('var(--poke-amber-ink)');
  });

  it('the art statics are hex, never var()', () => {
    const art = colors().art;
    expect(art['ball-red']).toBe('#DC2626');
    expect(art['card-blue']).toBe('#3B82F6');
    for (const value of Object.values(art)) expect(value).not.toContain('var(');
  });

  it('every other poke token stays a plain var() (no alpha: 185 dropped utilities must stay dropped)', () => {
    const poke = colors().poke;
    const statusKeys = new Set(['blue', 'blue-hover', 'green', 'green-hover', 'yellow', 'danger', 'danger-hover']);
    for (const [key, value] of Object.entries(poke)) {
      if (statusKeys.has(key) || key.startsWith('type-')) continue;
      expect(value, key).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe('generated utilities (postcss + tailwindcss)', () => {
  async function generate(raw: string): Promise<string> {
    const result = await postcss([
      tailwindcss({
        ...config,
        content: [{ raw, extension: 'html' }],
        corePlugins: { preflight: false },
      }),
    ]).process('@tailwind utilities;', { from: undefined });
    return result.css;
  }

  function ruleBody(css: string, selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1] : null;
  }

  it('emits color-mix rules for the status hues and rgb() for art, and still drops var()/NN', async () => {
    const css = await generate(
      'bg-poke-blue bg-poke-blue/20 border-poke-blue/40 from-poke-blue text-poke-on-blue bg-art-card-blue/10 bg-poke-surface/50',
    );
    expect(ruleBody(css, '.bg-poke-blue\\/20')).toContain(
      'color-mix(in srgb, var(--poke-blue) calc(0.2 * 100%), transparent)',
    );
    expect(ruleBody(css, '.bg-poke-blue')).toContain('calc(var(--tw-bg-opacity, 1) * 100%)');
    expect(ruleBody(css, '.border-poke-blue\\/40')).toContain('calc(0.4 * 100%)');
    expect(ruleBody(css, '.text-poke-on-blue')).toContain('var(--poke-on-blue)');
    expect(ruleBody(css, '.bg-art-card-blue\\/10')).toContain('rgb(59 130 246 / 0.1)');
    // §1g defect pinned: a variable token with /NN generates nothing. Fixing it
    // silently would make ~185 invisible styles appear in plaza.
    expect(ruleBody(css, '.bg-poke-surface\\/50')).toBeNull();
    expect(css).not.toContain('bg-poke-surface\\/50');
  });
});

describe('artwork stays off the palette', () => {
  const STATUS_CLASS = /poke-(blue|blue-hover|green|green-hover|yellow|danger|danger-hover)\b/;

  it('nothing inside the MatchHighlightCard export subtree uses a variable-backed status class', () => {
    const source = read(join(SRC, 'components', 'replay', 'MatchHighlightCard.tsx'));
    const refAt = source.indexOf('ref={cardRef}');
    expect(refAt, 'ref={cardRef}').toBeGreaterThan(0);
    const openAt = source.lastIndexOf('<div', refAt);
    const lineStart = source.lastIndexOf('\n', openAt) + 1;
    const indent = source.slice(lineStart, openAt);
    expect(indent).toMatch(/^ +$/);
    const closeAt = source.indexOf(`\n${indent}</div>`, refAt);
    expect(closeAt, 'closing </div> of the card').toBeGreaterThan(refAt);
    const card = source.slice(openAt, closeAt);
    expect(card).toContain('bg-art-card-blue/10');
    expect(card).not.toMatch(STATUS_CLASS);
  });

  it('the Pokéball red half is the static art colour', () => {
    const source = read(join(SRC, 'components', 'shared', 'Pokeball.tsx'));
    expect(source).toContain('bg-art-ball-red');
    expect(source).not.toContain('bg-poke-danger');
  });
});
