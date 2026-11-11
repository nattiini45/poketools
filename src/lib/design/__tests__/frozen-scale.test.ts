import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { frozenScaleCss, frozenScaleDeclarations } from '../frozen-scale';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const SOURCES = [read('node_modules/tailwindcss/theme.css'), read('src/app/globals.css')] as const;

describe('frozen-surface scale (redesign F3)', () => {
  it('is regenerated from the current theme (npx --no-install tsx scripts/design/frozen-scale.mts)', () => {
    expect(read('src/app/frozen-scale.css')).toBe(frozenScaleCss(...SOURCES));
  });

  it('resolves the rem tokens frozen surfaces use at their 18 px root', () => {
    const decls = new Map(frozenScaleDeclarations(...SOURCES));
    expect(decls.get('--spacing')).toBe('4.5px');
    expect(decls.get('--text-sm')).toBe('15.75px');
    expect(decls.get('--text-sm--line-height')).toBe('22.5px');
    expect(decls.get('--radius')).toBe('9px');
    expect(decls.get('--container-md')).toBe('504px');
    for (const value of decls.values()) expect(value).not.toMatch(/rem\b/);
  });

  it('keeps the site root at 16 px, and the draft room pages at 18 px', () => {
    const globals = SOURCES[1];
    expect(globals).toMatch(/html \{\s*font-size: 100%;/);
    expect(globals).toMatch(/html:has\(\[data-frozen="draft-room"\]\) \{\s*font-size: 18px;/);
    expect(read('src/app/layout.tsx')).toMatch(/import "\.\/frozen-pins\.css";\nimport "\.\/frozen-scale\.css";/);
  });

  it('rejects a token declared with two different rem values', () => {
    expect(() => frozenScaleDeclarations(':root { --x: 1rem; }', ':root { --x: 2rem; }')).toThrow(/--x/);
  });
});
