import { describe, expect, it } from 'vitest';
import { formatStatSpread, hasCustomIv, hasEv } from '../stat-spread';

const EVS = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
const IVS = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 };

describe('formatStatSpread', () => {
  it('keeps the English Showdown abbreviations for en', () => {
    expect(formatStatSpread(EVS, hasEv, 'en')).toBe('252 Atk / 4 SpD / 252 Spe');
    expect(formatStatSpread(IVS, hasCustomIv, 'en')).toBe('0 Atk');
  });

  it('uses the German stat abbreviations for de', () => {
    const de = formatStatSpread(EVS, hasEv, 'de');
    expect(de).not.toContain('Atk');
    expect(de.split(' / ')).toHaveLength(3);
    expect(de.startsWith('252 ')).toBe(true);
  });
});
