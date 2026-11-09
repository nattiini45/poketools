import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE_TOKEN_NAMES, SITE_PALETTE_IDS } from '../site-palettes';
import { SITE_PALETTE_TOKENS } from '../site-palette-tokens';

const CSS = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../app/frozen-pins.css'), 'utf8');

/** Every rule of the stylesheet as selector and declarations, comments dropped. */
function rules(css: string): Array<{ selector: string; decls: Map<string, string> }> {
  const out: Array<{ selector: string; decls: Map<string, string> }> = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const decl of match[2].split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
    out.push({ selector: match[1].trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

const THEMED = ':is([data-world="evoliga"], [data-world="sakura"], [data-world="mountain"], [data-world="clouds"])';
const OUT_OF_WORLD = `[data-frozen]:not(${THEMED}, ${THEMED} *)`;
const RULES = rules(CSS);

function pinsFor(palette: string, mode: 'light' | 'dark') {
  const p = palette === 'plaza' ? ':not([data-palette])' : `[data-palette="${palette}"]`;
  const t = mode === 'dark' ? '[data-theme="dark"]' : ':not([data-theme="dark"])';
  return RULES.find((rule) => rule.selector === `:root${p}${t} ${OUT_OF_WORLD}`);
}

describe('frozen-surface pins (redesign F1)', () => {
  it('has one block per palette and mode, and one shared block, all scoped to frozen roots outside themed worlds', () => {
    expect(RULES).toHaveLength(SITE_PALETTE_IDS.length * 2 + 2);
    for (const rule of RULES) expect(rule.selector.replace(/^:where\((.*)\)$/, '$1').endsWith(OUT_OF_WORLD)).toBe(true);
  });

  for (const palette of SITE_PALETTE_IDS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`pins every base token of ${palette} ${mode} to the value <html> computes today`, () => {
        const pins = pinsFor(palette, mode);
        expect(pins).toBeDefined();
        for (const name of BASE_TOKEN_NAMES) {
          expect(pins!.decls.get(name)?.toLowerCase(), name).toBe(SITE_PALETTE_TOKENS[palette][mode][name].toLowerCase());
        }
        for (const value of pins!.decls.values()) expect(value).not.toMatch(/var\(/);
      });
    }
  }

  it('re-derives the default world aliases from the pinned tokens and pins the radius at an 18 px root', () => {
    const shared = RULES.find((rule) => rule.selector === OUT_OF_WORLD);
    expect(shared?.decls.get('--radius')).toBe('9px');
    expect(shared?.decls.get('--world-surface')).toBe('var(--poke-surface)');
    expect(shared?.decls.get('--world-ink')).toBe('var(--poke-text-primary)');
  });

  it('gives frozen roots the colour and font they inherit from <body> today, at zero specificity', () => {
    const inherited = RULES.find((rule) => rule.selector === `:where(${OUT_OF_WORLD})`);
    expect(inherited?.decls.get('color')).toBe('var(--poke-text-primary)');
    expect(inherited?.decls.get('font-family')).toBe('var(--font-body-face), system-ui, sans-serif');
  });
});
