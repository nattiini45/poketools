/**
 * The body of the base-format change confirmation. Radix portals render
 * nothing in static markup, so the summary is a separate component and is
 * rendered on its own (vitest 'node' env, no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { FormatChangeSummary } from '../FormatChangeDialog';
import type { FormatSwitchImpact } from '../ruleset-form';

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN: FormatSwitchImpact = {
  customised: true,
  doublesDiffers: true,
  baselineKnown: true,
  changes: [
    { key: 'clauses', added: 0, removed: 1, total: 4 },
    { key: 'banned_pokemon', added: 2, removed: 3, total: 9 },
  ],
};

const UNKNOWN: FormatSwitchImpact = {
  customised: true,
  doublesDiffers: false,
  baselineKnown: false,
  changes: [
    { key: 'banned_moves', added: 5, removed: 0, total: 5 },
    { key: 'added_pokemon', added: 1, removed: 0, total: 1 },
  ],
};

describe('FormatChangeSummary', () => {
  it('lists the lost categories with +added / -removed counts in English', () => {
    const text = textOf(renderToStaticMarkup(<FormatChangeSummary format="gen9vgc" impact={KNOWN} />));
    expect(text).toContain('Gen 9 VGC');
    expect(text).toContain('Clauses: +0 / −1 compared with the current format');
    expect(text).toContain('Banned Pokémon: +2 / −3 compared with the current format');
    expect(text).toContain('Doubles flag differs from the current format');
    expect(text).toContain('Only the format label changes.');
    expect(text).not.toContain('could not be loaded');
  });

  it('lists the lost categories in German', () => {
    const text = textOf(renderWithI18n(<FormatChangeSummary format="gen9vgc" impact={KNOWN} />, { locale: 'de' }));
    expect(text).toContain('Klauseln: +0 / −1 gegenüber dem aktuellen Format');
    expect(text).toContain('Gebannte Pokémon: +2 / −3 gegenüber dem aktuellen Format');
    expect(text).toContain('Das Doppel-Kennzeichen weicht vom aktuellen Format ab');
  });

  it('shows total entries and the unknown-baseline note when the current defaults are unknown', () => {
    const en = textOf(renderToStaticMarkup(<FormatChangeSummary format="gen9ou" impact={UNKNOWN} />));
    expect(en).toContain('Banned Moves: 5 entries');
    expect(en).toContain('Added Pokémon: 1 entry');
    expect(en).toContain('every non-empty list counts as customised');
    expect(en).not.toContain('compared with the current format');
    expect(en).not.toContain('Doubles flag differs');

    const de = textOf(renderWithI18n(<FormatChangeSummary format="gen9ou" impact={UNKNOWN} />, { locale: 'de' }));
    expect(de).toContain('Gebannte Attacken: 5 Einträge');
    expect(de).toContain('gilt jede nicht leere Liste als angepasst');
  });
});
