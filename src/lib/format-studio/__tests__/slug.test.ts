import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN } from '@/lib/format-kit/keys';
import { slugFromName, withSlugSuffix } from '../slug';

describe('slugFromName', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugFromName('Swiss Cup 2026')).toBe('swiss-cup-2026');
    expect(slugFromName('  Round   Robin -- Finals  ')).toBe('round-robin-finals');
  });

  it('folds umlauts and accents to ASCII', () => {
    expect(slugFromName('Größe Ärzte Übung')).toBe('grosse-arzte-ubung');
    expect(slugFromName('Café Déjà Vu')).toBe('cafe-deja-vu');
    expect(slugFromName('Æther Øl Łódź')).toBe('aether-ol-lodz');
  });

  it('falls back to "format" when nothing usable is left', () => {
    expect(slugFromName('')).toBe('format');
    expect(slugFromName('   ')).toBe('format');
    expect(slugFromName('🔥🔥🔥')).toBe('format');
    expect(slugFromName('---')).toBe('format');
    expect(slugFromName('日本語')).toBe('format');
  });

  it('cuts a long name to 63 characters without a trailing hyphen', () => {
    const slug = slugFromName(`${'a'.repeat(62)} bbbb`);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith('-')).toBe(false);
    expect(slugFromName('x'.repeat(500))).toHaveLength(63);
    // The cut falls right after a separator: no trailing hyphen is left behind.
    expect(slugFromName(`${'a'.repeat(62)}-zzz`)).toBe('a'.repeat(62));
  });

  it('keeps digits and drops punctuation', () => {
    expect(slugFromName('Best-of-3: Top 8!')).toBe('best-of-3-top-8');
    expect(slugFromName('2026')).toBe('2026');
  });

  it.each(['', '🔥', 'Größe', 'x'.repeat(300), 'A_B C', '---a---', '\u0000nul', '../../etc', 'Ünïcödé Nämé', 'a'.repeat(62) + ' b'])(
    'always matches the kit slug pattern: %j',
    (name) => {
      expect(slugFromName(name)).toMatch(SLUG_PATTERN);
    },
  );
});

describe('withSlugSuffix', () => {
  it('attempt 1 is the base itself', () => {
    expect(withSlugSuffix('swiss-cup', 1)).toBe('swiss-cup');
  });

  it('adds -2 to -9 for the next attempts', () => {
    expect(withSlugSuffix('swiss-cup', 2)).toBe('swiss-cup-2');
    expect(withSlugSuffix('swiss-cup', 9)).toBe('swiss-cup-9');
  });

  it('uses the caller-supplied four hex characters from attempt 10', () => {
    expect(withSlugSuffix('swiss-cup', 10, 'a1b2')).toBe('swiss-cup-a1b2');
  });

  it('derives a deterministic suffix when no valid draw is given', () => {
    expect(withSlugSuffix('swiss-cup', 10)).toBe('swiss-cup-000a');
    expect(withSlugSuffix('swiss-cup', 10, 'zzzz')).toBe('swiss-cup-000a');
    expect(withSlugSuffix('swiss-cup', 10)).toBe(withSlugSuffix('swiss-cup', 10));
  });

  it('keeps a full-length base within 63 characters', () => {
    const base = 'a'.repeat(63);
    for (const attempt of [2, 9, 10]) {
      const slug = withSlugSuffix(base, attempt, 'ffff');
      expect(slug.length).toBeLessThanOrEqual(63);
      expect(slug).toMatch(SLUG_PATTERN);
    }
    expect(withSlugSuffix(base, 2)).toBe(`${'a'.repeat(61)}-2`);
  });

  it('never leaves a double hyphen where the base was cut', () => {
    const base = `${'a'.repeat(60)}-bc`;
    const slug = withSlugSuffix(base, 10, 'abcd');
    expect(slug).not.toContain('--');
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it('rejects an attempt below 1', () => {
    expect(() => withSlugSuffix('a', 0)).toThrow(RangeError);
    expect(() => withSlugSuffix('a', 1.5)).toThrow(RangeError);
  });
});
