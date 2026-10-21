/**
 * The ruleset detail and the builder's leaf editors in both languages (i18n
 * T11): labels from the `ruleset` namespace, banned names from the pkmn layer,
 * Showdown clause and format names unchanged, a `labels` prop still
 * overriding. Rendered through react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RulesetDetail, { DEFAULT_RULESET_DETAIL_LABELS, rulesetDetailLabels } from '../RulesetDetail';
import BanlistEditor from '../BanlistEditor';
import ClauseToggleGrid from '../ClauseToggleGrid';
import FormatSelector from '../FormatSelector';
import RulesetBuilder from '../RulesetBuilder';
import TeamConstraintsEditor from '../TeamConstraintsEditor';
import { renderWithI18n } from '@/test/i18n';
import type { Ruleset } from '@/types/ruleset';

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULESET: Ruleset = {
  id: 'rs-1',
  name: 'Spring OU',
  base_format: 'gen9ou',
  is_doubles: true,
  clauses: ['Species Clause'],
  bans: { pokemon: ['Charizard'], moves: ['Flamethrower'], items: ['Leftovers'], abilities: ['Intimidate'] },
  additions: { pokemon: ['Charizard-Mega-X'] },
  custom_rules_string: '',
  min_shared_type_pct: 50,
  team_constraints: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('RulesetDetail', () => {
  it('keeps the English labels and names without a provider', () => {
    const text = textOf(renderToStaticMarkup(<RulesetDetail ruleset={RULESET} />));
    for (const s of [
      'Doubles',
      'Clauses',
      'Species Clause',
      'Banned Pokémon (1)',
      'Charizard',
      'Banned Moves (1)',
      'Flamethrower',
      'Banned Items (1)',
      'Leftovers',
      'Banned Abilities (1)',
      'Intimidate',
      'Added Pokémon (1)',
      '50% of team must share a type',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('renders German labels and German Pokémon-data names; clause names stay English', () => {
    const text = textOf(renderWithI18n(<RulesetDetail ruleset={RULESET} />, { locale: 'de' }));
    for (const s of [
      'Doppel',
      'Klauseln',
      'Species Clause',
      'Gebannte Pokémon (1)',
      'Glurak',
      'Gebannte Attacken (1)',
      'Flammenwurf',
      'Gebannte Items (1)',
      'Überreste',
      'Gebannte Fähigkeiten (1)',
      'Bedroher',
      'Zusätzlich erlaubte Pokémon (1)',
      '50 % des Teams müssen einen Typ teilen',
    ]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain('Flamethrower');
  });

  it('lets a labels prop override the viewer language (functions resolved on the server side)', () => {
    const text = textOf(
      renderWithI18n(<RulesetDetail ruleset={RULESET} labels={DEFAULT_RULESET_DETAIL_LABELS} />, { locale: 'de' }),
    );
    expect(text).toContain('Banned Pokémon (1)');
    expect(text).toContain('50% of team must share a type');
    // Names still follow the data locale.
    expect(text).toContain('Glurak');
  });

  it('builds the label set for a locale', () => {
    expect(rulesetDetailLabels('de').sharedTypeRule(30)).toBe('30 % des Teams müssen einen Typ teilen');
    expect(rulesetDetailLabels('en').sharedTypeRule(30)).toBe('30% of team must share a type');
  });

  it('keeps the route-world block tag', () => {
    const html = renderWithI18n(<RulesetDetail ruleset={RULESET} blockTag="div" />, { locale: 'de' });
    expect(html).not.toContain('<section');
  });
});

describe('ruleset builder editors', () => {
  it('translates the builder chrome and keeps English without a provider', () => {
    const en = textOf(renderToStaticMarkup(<RulesetBuilder />));
    for (const s of ['Format & Name', 'Ruleset Name', 'Base Format', 'Generation', 'Previous', 'Next']) {
      expect(en).toContain(s);
    }
    const de = textOf(renderWithI18n(<RulesetBuilder />, { locale: 'de' }));
    for (const s of ['Klauseln', 'Übersicht', 'Name des Regelwerks', 'Basisformat', 'Zurück', 'Weiter', 'Ausgewählt:']) {
      expect(de).toContain(s);
    }
  });

  it('shows the selected format in a rich sentence', () => {
    const html = renderWithI18n(<FormatSelector value="gen9ou" onChange={() => {}} />, { locale: 'de' });
    expect(html).toMatch(/Ausgewählt: <span class="text-poke-text-primary font-medium">[^<]+<\/span>/);
  });

  it('labels the clause grid', () => {
    expect(textOf(renderWithI18n(<ClauseToggleGrid selected={[]} onChange={() => {}} />, { locale: 'de' }))).toContain(
      'Klauseln',
    );
  });

  it('shows banned names in the data locale with a translated placeholder and remove label', () => {
    const html = renderWithI18n(
      <BanlistEditor label="Gebannte Pokémon" searchType="species" items={['Charizard']} onChange={() => {}} />,
      { locale: 'de' },
    );
    expect(textOf(html)).toContain('Glurak');
    expect(html).toContain('placeholder="Pokémon suchen …"');
    expect(html).toContain('aria-label="Glurak entfernen"');

    const en = renderToStaticMarkup(
      <BanlistEditor label="Banned Moves" searchType="moves" items={['Flamethrower']} onChange={() => {}} />,
    );
    expect(en).toContain('placeholder="Search moves..."');
    expect(textOf(en)).toContain('Flamethrower');
  });

  it('translates the team constraints with Pokémon-data names from the pkmn layer', () => {
    const de = textOf(
      renderWithI18n(
        <TeamConstraintsEditor
          value={{ type_quotas: { source: 'fixed', min_per_type: 2, allow_multi_count: true, fixed_types: ['Fire'] } }}
          onChange={() => {}}
        />,
        { locale: 'de' },
      ),
    );
    for (const s of ['Team-Regeln aktivieren', 'Evolith-Tier-Grenze', 'Feste Typen', 'Feuer', 'Volcanion = Feuer + Wasser']) {
      expect(de).toContain(s);
    }
    const en = textOf(renderToStaticMarkup(<TeamConstraintsEditor value={{}} onChange={() => {}} />));
    expect(en).toContain('Eviolite tier cap');
    expect(en).toContain('Enable team constraints');
  });
});
