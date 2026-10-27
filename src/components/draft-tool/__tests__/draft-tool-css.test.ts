import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The draft tool's colour guard (draft-frontend §5.4; design rules "no dark slabs" and "red only
 * means drafted"). Every colour comes from the world / palette tokens; the only literal hex values are
 * the violet CTA (SPEC:393-397) with its white ink and the four light price-tab pastels with their ink.
 */
const CSS = readFileSync(path.resolve(__dirname, '../draft-tool.module.css'), 'utf8');
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const ALLOWED_HEX = new Set(['#7C3AED', '#8B5CF6', '#6D28D9', '#FFFFFF', '#FCE7A6', '#FBCFA6', '#C3DBF6', '#C4E9CD', '#241A0C']);

describe('draft-tool.module.css', () => {
  it('uses only the whitelisted hex colours', () => {
    const hexes = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.filter((h) => !ALLOWED_HEX.has(h))).toEqual([]);
  });

  it('keeps the spec CTA hexes', () => {
    expect(code).toMatch(/--draft-cta:\s*#7C3AED/i);
    expect(code).toMatch(/--draft-cta-hover:\s*#8B5CF6/i);
    expect(code).toMatch(/--draft-cta-pressed:\s*#6D28D9/i);
  });

  it('reserves violet (--draft-cta) for the DRAFT call to action: only .cta / .ctaAdmin rules use it', () => {
    const rules = [...code.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^{}]*)\}/g)].map((m) => ({ selector: m[2].trim(), body: m[3] }));
    const violet = rules.filter((r) => /var\(--draft-cta/.test(r.body)).map((r) => r.selector);
    expect(violet.length).toBeGreaterThan(0);
    // The CTA's own rules, also under the dark theme (`:global([data-theme="dark"]) .ctaAdmin`).
    expect(violet.filter((sel) => !/(^|\s)\.cta(Admin)?\b/.test(sel))).toEqual([]);
    // The clock bar's "on the clock" / "next" banner is neutral; only the paused banner is tinted (amber).
    const banner = rules.find((r) => r.selector === '.banner');
    expect(banner?.body).toMatch(/background: var\(--draft-elevated\)/);
  });

  it('has no fixed dark fills (no black, no rgb(a) below 25% lightness as a background)', () => {
    // Masks use black as alpha only; they paint nothing.
    const painted = code.replace(/(?:-webkit-)?mask[\w-]*:[^;]*;/g, '');
    expect(painted).not.toMatch(/\bblack\b/i);
    for (const m of code.matchAll(/background(?:-color)?:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(Math.max(r, g, b)).toBeGreaterThan(64);
    }
  });

  it('reserves the danger (red) tokens for drafted lines', () => {
    const uses = [...code.matchAll(/^\s*(--[\w-]+):[^;]*var\(--poke-danger[\w-]*\)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((name) => name.startsWith('--draft-taken-'))).toBe(true);
    // No rule outside the token block reaches for the danger palette directly.
    const rules = code.slice(code.indexOf('}') + 1);
    expect(rules).not.toMatch(/var\(--poke-danger/);
  });

  it('derives the favourite star gold from the palette yellow (both themes), never a literal colour or red', () => {
    const star = /--draft-star:\s*([^;]+);/.exec(code)?.[1] ?? '';
    expect(star).toMatch(/^color-mix\(in srgb, var\(--poke-yellow\) \d+%, var\(--poke-yellow-ink\)\)$/);
    // The footer blob and plate are tinted with neutral/accent mixes (soft, never a dark slab, never the danger palette).
    for (const selector of ['cardFooterBlob', 'cardFooterPlate']) {
      const body = new RegExp(String.raw`\n\.${selector} \{([^}]*)\}`).exec(code)?.[1] ?? '';
      expect(body).toMatch(/background: color-mix\(in srgb, var\(--draft-(?:ink|accent)\)/);
    }
  });

  it('tints the team weakness cells amber (weak), green (resist) and neutral (immune), never red', () => {
    // The last rule of the selector: the shared ink rule lists all four classes, the tint comes after it.
    const body = (selector: string) => [...code.matchAll(new RegExp(String.raw`
\.${selector} \{([^}]*)\}`, 'g'))].at(-1)?.[1] ?? '';
    expect(body('weaknessWeak')).toMatch(/background: color-mix\(in srgb, var\(--poke-yellow\)/);
    expect(body('weaknessQuad')).toMatch(/background: color-mix\(in srgb, var\(--poke-yellow\)/);
    expect(body('weaknessResist')).toMatch(/background: color-mix\(in srgb, var\(--poke-green\)/);
    expect(body('weaknessImmune')).toMatch(/background: var\(--draft-elevated\)/);
  });

  it('shares the tokens with a position-free `.tokens` class for portalled and sibling pieces', () => {
    // Toasts and the players sheet sit outside the screen root; `.root`'s `position: relative` must not reach
    // them (it would beat Tailwind's `fixed` on the sheet).
    const shared = code.slice(code.indexOf('.tokens,'), code.indexOf('}', code.indexOf('.tokens,')));
    expect(shared).toMatch(/^\.tokens,\s*\.root \{/);
    expect(shared).toMatch(/--draft-surface:/);
    expect(shared).not.toMatch(/\bposition:/);
    expect(code).toMatch(/(?:^|\n)\.root \{[^}]*position: relative;/);
    expect(code).toMatch(/:global\(\[data-theme="dark"\]\) \.tokens,\s*:global\(\[data-theme="dark"\]\) \.root \{/);
  });

  it('redefines the theme-dependent tokens under the dark theme and gates motion', () => {
    expect(code).toMatch(/:global\(\[data-theme="dark"\]\) \.root \{/);
    expect(code).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(code).toMatch(/\.caps \{\s*text-transform: uppercase;/);
  });
});
