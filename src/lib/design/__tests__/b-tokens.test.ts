import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const GLOBALS = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule with this exact selector that declares --page. */
function block(selector: string): Map<string, string> {
  for (const match of GLOBALS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim() !== selector || !/--page:/.test(match[2])) continue;
    return new Map(match[2].split(';').filter((d) => d.includes(':')).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
  }
  throw new Error('no Direction B block for ' + selector);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const MODES = { sunlit: block(':root'), moonlit: block('[data-theme="dark"]') };

describe('Direction B tokens (redesign F3)', () => {
  for (const [mode, tokens] of Object.entries(MODES)) {
    const t = (name: string) => tokens.get(name) ?? MODES.sunlit.get(name)!;

    it(`${mode}: both inks, the accent ink and the status inks read at 4.5:1 on every ground`, () => {
      for (const ground of ['--page', '--surface', '--elevated', '--sunken', '--hover', '--selected']) {
        for (const ink of ['--fg', '--fg-muted', '--accent-ink', '--live', '--loss']) {
          expect(contrast(t(ink), t(ground)), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${mode}: status inks read on their washes, plate ink on every tier plate and the accent fill`, () => {
      expect(contrast(t('--win'), t('--win-bg'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t('--loss'), t('--loss-bg'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t('--accent-ink'), t('--accent-subtle'))).toBeGreaterThanOrEqual(4.5);
      for (const plate of ['--tier-1', '--tier-2', '--tier-3', '--tier-4', '--tier-1-soft', '--tier-2-soft', '--tier-3-soft', '--tier-4-soft', '--accent-fill']) {
        expect(contrast(t('--tier-ink'), t(plate)), plate).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${mode}: every colour is solid hex except the scrim`, () => {
      for (const [name, value] of tokens) {
        if (name === '--scrim' || name.startsWith('--poke-') || ['--background', '--foreground', '--skew'].includes(name) || name.startsWith('--motion-')) continue;
        expect(value, name).toMatch(/^#[0-9A-F]{6}$/i);
      }
    });
  }

  it('aliases the legacy site names onto the new set', () => {
    for (const [legacy, token] of [['--poke-base', '--page'], ['--poke-text-primary', '--fg'], ['--poke-accent', '--accent-ink'], ['--background', '--page']]) {
      expect(MODES.sunlit.get(legacy)).toBe(`var(${token})`);
      expect(MODES.moonlit.get(legacy)).toBe(`var(${token})`);
    }
  });
});
