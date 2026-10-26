import { describe, expect, it } from 'vitest';
import { PRESETS, getValidFormats } from '../format-catalog';
import { generationOf, generationOrDefault, parseFormatId } from '../format-id';
import { KEY_PATTERN } from '@/lib/studio-core/keys';

describe('parseFormatId', () => {
  it('reads the generation and the tier key of an ordinary id', () => {
    expect(parseFormatId('gen9ou')).toEqual({ gen: 9, key: 'ou' });
    expect(parseFormatId('gen1uu')).toEqual({ gen: 1, key: 'uu' });
    expect(parseFormatId('gen9vgc2025')).toEqual({ gen: 9, key: 'vgc2025' });
    expect(parseFormatId('gen9doublesou')).toEqual({ gen: 9, key: 'doublesou' });
  });

  it('reads exactly ONE generation digit, so a key that starts with a digit stays a key', () => {
    // A greedy /^gen(\d+)/ reads these as generation 91, 96 and 94 and every dex lookup behind it fails.
    expect(parseFormatId('gen91v1')).toEqual({ gen: 9, key: '1v1' });
    expect(parseFormatId('gen96v6doublesdraft')).toEqual({ gen: 9, key: '6v6doublesdraft' });
    expect(parseFormatId('gen94v4doublesdraft')).toEqual({ gen: 9, key: '4v4doublesdraft' });
    expect(parseFormatId('gen8natdex4v4doublesdraft')).toEqual({ gen: 8, key: 'natdex4v4doublesdraft' });
    expect(generationOf('gen91v1')).toBe(9);
  });

  it('accepts a bare generation (the point-buy base format) with an empty key', () => {
    expect(parseFormatId('gen9')).toEqual({ gen: 9, key: '' });
    expect(generationOf('gen3')).toBe(3);
  });

  it('rejects everything that is not a format id', () => {
    for (const id of ['blank', '', 'ou', 'gen0ou', 'gen', 'GEN9OU', 'Gen9ou', 'gen9 ou', 'gen9-ou', 'gen9_ou', ' gen9ou', 'gen9ou\n', 'xgen9ou']) {
      expect(parseFormatId(id), JSON.stringify(id)).toBeNull();
    }
    for (const value of [undefined, null, 9, {}, ['gen9ou']]) expect(parseFormatId(value)).toBeNull();
  });

  it('reads a two-digit generation as generation 1..9 plus a key, never as a bigger generation', () => {
    expect(parseFormatId('gen10ou')).toEqual({ gen: 1, key: '0ou' });
    expect(parseFormatId('gen42test')).toEqual({ gen: 4, key: '2test' });
  });
});

describe('generationOf / generationOrDefault', () => {
  it('answers null for a non-id and the default for generationOrDefault', () => {
    expect(generationOf('blank')).toBeNull();
    expect(generationOf(undefined)).toBeNull();
    expect(generationOrDefault('blank')).toBe(9);
    expect(generationOrDefault(undefined)).toBe(9);
    expect(generationOrDefault('blank', 8)).toBe(8);
    expect(generationOrDefault('gen3ou')).toBe(3);
  });
});

describe('the catalog ids', () => {
  it('round-trip through the parser and satisfy the kit key pattern', () => {
    for (const preset of PRESETS) {
      expect(parseFormatId(preset.id), preset.id).toEqual({ gen: preset.gen, key: preset.tier });
      expect(preset.id, preset.id).toMatch(KEY_PATTERN);
    }
  });

  it('are exactly the valid formats except blank', () => {
    expect(getValidFormats().filter((id) => id !== 'blank').sort()).toEqual(PRESETS.map((preset) => preset.id).sort());
    expect(parseFormatId('blank')).toBeNull();
  });

  it('include the ids whose key starts with a digit', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual(expect.arrayContaining(['gen91v1', 'gen61v1']));
    expect(PRESETS.find((preset) => preset.id === 'gen91v1')?.gen).toBe(9);
  });
});
