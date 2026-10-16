/**
 * Showdown export stays English (i18n-core §11.3 T12, pkmn-l10n §5.5): the
 * exported text is byte-identical under 'en' and 'de', even with German
 * Pokémon terms; only the surrounding button labels are translated.
 */
import { describe, it, expect } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { ExportPanel } from '../EditorDialogs';
import { exportTeamText } from '@/lib/pkmn/teams';
import type { PokemonSet } from '@/types/team';

const GARCHOMP: PokemonSet = {
  name: '',
  species: 'Garchomp',
  gender: '',
  item: 'Rocky Helmet',
  ability: 'Rough Skin',
  evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly',
  level: 100,
  moves: ['Earthquake', 'Dragon Claw', 'Stealth Rock', 'Toxic'],
  tera_type: 'Steel',
};

const CHARIZARD: PokemonSet = {
  ...GARCHOMP,
  species: 'Charizard',
  item: 'Heavy-Duty Boots',
  ability: 'Solar Power',
  nature: 'Timid',
  moves: ['Flamethrower', 'Air Slash', 'Focus Blast', 'Roost'],
  tera_type: 'Fire',
};

const TEAM: (PokemonSet | null)[] = [GARCHOMP, null, CHARIZARD, null, null, null];

/** The textarea's content (React renders a controlled textarea's value as its text). */
function exportedText(html: string): string {
  const match = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/);
  if (!match) throw new Error('no textarea rendered');
  return match[1];
}

describe('ExportPanel', () => {
  it('exports the same Showdown text in English and German', () => {
    const en = renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'en' });
    const de = renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'de' });
    const deEnglishTerms = renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'de', dataLocale: 'en' });

    expect(exportedText(de)).toBe(exportedText(en));
    expect(exportedText(deEnglishTerms)).toBe(exportedText(en));
  });

  it('keeps English Pokémon, item, ability, nature and move names under de', () => {
    const text = exportedText(renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'de' }));

    expect(text).toContain('Garchomp @ Rocky Helmet');
    expect(text).toContain('Ability: Rough Skin');
    expect(text).toContain('Jolly Nature');
    expect(text).toContain('- Earthquake');
    expect(text).toContain('Charizard @ Heavy-Duty Boots');
    expect(text).not.toContain('Knakrack');
    expect(text).not.toContain('Glurak');
    expect(text).not.toContain('Erdbeben');
  });

  it('matches exportTeamText for the filled slots', () => {
    const text = exportedText(renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'de' }));
    const expected = exportTeamText([GARCHOMP, CHARIZARD]);
    const html = renderWithI18n(<textarea readOnly value={expected} />);
    expect(text).toBe(exportedText(html));
  });

  it('translates only the button labels', () => {
    const en = renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'en' });
    const de = renderWithI18n(<ExportPanel team={TEAM} />, { locale: 'de' });

    expect(en).toContain('Copy to Clipboard');
    expect(en).toContain('Download .txt');
    expect(de).toContain('In die Zwischenablage kopieren');
    expect(de).toContain('.txt herunterladen');
    expect(de).not.toContain('Copy to Clipboard');
  });
});
