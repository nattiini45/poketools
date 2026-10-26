import { describe, expect, it } from 'vitest';
import { PRESETS } from '@/lib/pkmn/format-catalog';
import { START_KINDS, offersTourOverlay, presetStartBody } from '../../editor/starts';

describe('the starts', () => {
  it('are the four ways, in the order the dialog offers them', () => {
    expect([...START_KINDS]).toEqual(['blank', 'preset', 'fork', 'import']);
  });

  it('offer the Smogon tour toggle for exactly the presets the catalog flags', () => {
    for (const preset of PRESETS) expect(offersTourOverlay(preset.id), preset.id).toBe(preset.tourOverlay);
    expect(offersTourOverlay('gen9natdexdraft')).toBe(true);
    expect(offersTourOverlay('gen9ou')).toBe(false);
    expect(offersTourOverlay('blank')).toBe(false);
    expect(offersTourOverlay('nonsense')).toBe(false);
  });
});

describe('presetStartBody', () => {
  it('uses the preset\'s own name when the author typed none', () => {
    expect(presetStartBody({ preset: 'gen9ou', name: '   ', language: 'en', tourOverlay: false })).toEqual({
      name: 'Gen 9 OU',
      base_locale: 'en',
      preset: 'gen9ou',
    });
  });

  it('keeps the typed name, trimmed, and the author\'s language', () => {
    expect(presetStartBody({ preset: 'gen9ou', name: '  Spring OU ', language: 'de', tourOverlay: false })).toMatchObject({
      name: 'Spring OU',
      base_locale: 'de',
    });
  });

  it('sends the tour toggle only when it is on AND the preset has documented extras', () => {
    expect(presetStartBody({ preset: 'gen9natdexdraft', name: '', language: 'en', tourOverlay: true })).toMatchObject({ tour_overlay: true });
    expect(presetStartBody({ preset: 'gen9natdexdraft', name: '', language: 'en', tourOverlay: false })).not.toHaveProperty('tour_overlay');
    // A stale toggle after switching to a preset without extras sends nothing.
    expect(presetStartBody({ preset: 'gen9ou', name: '', language: 'en', tourOverlay: true })).not.toHaveProperty('tour_overlay');
  });

  it('is null for a preset the catalog does not know', () => {
    expect(presetStartBody({ preset: 'gen99xx', name: 'x', language: 'en', tourOverlay: false })).toBeNull();
    expect(presetStartBody({ preset: 'blank', name: 'x', language: 'en', tourOverlay: false })).toBeNull();
  });
});
