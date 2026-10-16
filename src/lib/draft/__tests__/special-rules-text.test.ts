import { describe, expect, it } from 'vitest';
import { epbPack, lineOverrideFor } from '@/lib/format-pack';
import type { AppliedOverride } from '../league-overrides';
import fixture from './fixtures/example-list.json';
import { proseHash, SPECIAL_RULES_EN, specialRulesTextFor } from '../special-rules-text';

// The public suite runs on the example pack: two authored English entries, one German-only line.
const withText = fixture.entries.filter((e) => e.special_rules_text);

function entry(lineId: string) {
  const found = fixture.entries.find((e) => e.line_id === lineId);
  if (!found) throw new Error(`fixture has no ${lineId}`);
  return found;
}

describe('proseHash', () => {
  it('is FNV-1a 32-bit hex over the NFC text', () => {
    expect(proseHash('')).toBe('811c9dc5');
    expect(proseHash('a')).toBe('e40c292c');
    expect(proseHash('Flabébé')).toBe(proseHash('Flabébé'));
  });
});

describe('specialRulesTextFor', () => {
  it('reads the authored English from the pack, each entry current for its fixture line', () => {
    expect(SPECIAL_RULES_EN).toBe(epbPack.specialRulesEn);
    expect(withText).toHaveLength(3);
    for (const [lineId, en] of Object.entries(SPECIAL_RULES_EN)) {
      expect(en.de_hash, lineId).toBe(proseHash(entry(lineId).special_rules_text ?? ''));
    }
  });

  it('returns the authored English in English and the workbook German in German', () => {
    const grubbin = entry('grubbin--vikavolt');
    expect(specialRulesTextFor(grubbin, 'en')).toEqual({ text: SPECIAL_RULES_EN['grubbin--vikavolt'].en, lang: 'en' });
    expect(specialRulesTextFor(grubbin, 'de')).toEqual({ text: grubbin.special_rules_text, lang: 'de' });
  });

  it('falls back to the German text with lang de when the stored German changed (stale hash)', () => {
    const edited = { line_id: 'grubbin--vikavolt', special_rules_text: 'Charjabug braucht ab sofort drei KOs.' };
    expect(specialRulesTextFor(edited, 'en')).toEqual({ text: 'Charjabug braucht ab sofort drei KOs.', lang: 'de' });
  });

  it('falls back to German for text with no English entry, and is null for a line without text', () => {
    const gastly = entry('gastly--gengar');
    expect(SPECIAL_RULES_EN['gastly--gengar']).toBeUndefined();
    expect(specialRulesTextFor(gastly, 'en')).toEqual({ text: gastly.special_rules_text, lang: 'de' });
    expect(specialRulesTextFor({ line_id: 'mareep--ampharos', special_rules_text: null }, 'en')).toEqual({
      text: null,
      lang: 'en',
    });
    expect(specialRulesTextFor({ line_id: 'mareep--ampharos', special_rules_text: null }, 'de')).toEqual({
      text: null,
      lang: 'de',
    });
  });

  it('appends the league override reason in the requested language', () => {
    const [override] = epbPack.lineOverrides;
    expect(lineOverrideFor(override.line_id)).toBe(override);
    const overrides: AppliedOverride[] = [
      { field: 'kills_to_stage2', sheet_value: 1, applied_value: override.kills_to_stage2 ?? 0, reason: override.reason },
    ];
    const line = { ...entry(override.line_id), overrides };
    const en = specialRulesTextFor(line, 'en');
    expect(en.lang).toBe('en');
    expect(en.text).toContain(SPECIAL_RULES_EN[override.line_id].en);
    expect(en.text).toContain(override.reason.en);
    const de = specialRulesTextFor(line, 'de');
    expect(de.text).toContain(line.special_rules_text ?? '');
    expect(de.text).toContain(override.reason.de);
  });
});
