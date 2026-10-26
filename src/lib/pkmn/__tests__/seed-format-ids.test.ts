import { describe, expect, it } from 'vitest';
import { PRESETS } from '../format-catalog';
import { SEED_FORMAT_IDS } from '../seed-format-ids';

describe('SEED_FORMAT_IDS', () => {
  it('is the 88 formats of the catalog before the draft and National Dex family were added', () => {
    expect(SEED_FORMAT_IDS).toHaveLength(88);
    expect(new Set(SEED_FORMAT_IDS).size).toBe(88);
    expect(SEED_FORMAT_IDS).toEqual(expect.arrayContaining(['gen1ou', 'gen9ou', 'gen91v1', 'gen9nationaldex', 'gen8nationaldex', 'gen9doublesou', 'gen9vgc']));
  });

  it('only names presets of the catalog, and none of the Smogon draft formats or the newer National Dex and doubles formats', () => {
    const catalog = new Map(PRESETS.map((preset) => [preset.id, preset]));
    for (const id of SEED_FORMAT_IDS) {
      expect(catalog.get(id)?.source, id).toBe('showdown');
    }
    for (const id of ['gen9draft', 'gen9natdexdraft', 'gen9doublesubers', 'gen9doubleslc', 'gen9nationaldexubers', 'gen9nationaldexuu', 'gen9nationaldexag', 'gen8nationaldexru']) {
      expect(SEED_FORMAT_IDS, id).not.toContain(id);
    }
  });
});
