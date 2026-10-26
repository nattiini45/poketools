/**
 * The ruleset detail, the format selector and the team constraints editor in both languages (i18n
 * T11): labels from the `ruleset` namespace, banned names from the pkmn layer,
 * Showdown clause and format names unchanged, a `labels` prop still
 * overriding. Rendered through react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RulesetDetail, { DEFAULT_RULESET_DETAIL_LABELS, rulesetDetailLabels } from '../RulesetDetail';
import FormatSelector, { nextFormatForGen, nextFormatForTier } from '../FormatSelector';
import TeamConstraintsEditor from '../TeamConstraintsEditor';
import { renderWithI18n } from '@/test/i18n';
import type { Ruleset } from '@/types/ruleset';
import { makeRuleset as buildRuleset } from '@/test/ruleset-fixtures';

function textOf(html: string): string {
  // `&amp;` is decoded last so an escaped entity such as `&amp;nbsp;` is not double-unescaped.
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;| | /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULESET: Ruleset = buildRuleset({
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
});

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

describe('ruleset editors', () => {
  it('shows the selected format in a rich sentence', () => {
    const html = renderWithI18n(<FormatSelector value="gen9ou" onChange={() => {}} />, { locale: 'de' });
    expect(html).toMatch(/Ausgewählt: <span class="text-poke-text-primary font-medium">[^<]+<\/span>/);
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

  it('hints that an empty block is saved as no team constraints', () => {
    const hint = 'No rule is selected yet. A ruleset saved like this has no team constraints.';
    expect(textOf(renderToStaticMarkup(<TeamConstraintsEditor value={{}} onChange={() => {}} />))).toContain(hint);
    expect(
      textOf(renderWithI18n(<TeamConstraintsEditor value={{}} onChange={() => {}} />, { locale: 'de' })),
    ).toContain('Ein so gespeichertes Regelwerk hat keine Team-Regeln.');
    // A block with a rule, and a disabled block, show no hint.
    expect(
      textOf(renderToStaticMarkup(<TeamConstraintsEditor value={{ tera_match: 'none' }} onChange={() => {}} />)),
    ).not.toContain(hint);
    expect(textOf(renderToStaticMarkup(<TeamConstraintsEditor value={null} onChange={() => {}} />))).not.toContain(hint);
  });
});

describe('FormatSelector selection', () => {
  it('returns null for the selected generation and tier', () => {
    expect(nextFormatForGen('gen9ou', 9)).toBeNull();
    expect(nextFormatForGen('blank', 0)).toBeNull();
    expect(nextFormatForTier('gen9ou', 'gen9ou')).toBeNull();
  });

  it('returns the first tier of another generation, blank for generation 0', () => {
    expect(nextFormatForGen('gen9ou', 8)).toBe('gen8ou');
    expect(nextFormatForGen('gen9vgc', 3)).toBe('gen3ou');
    expect(nextFormatForGen('gen9ou', 0)).toBe('blank');
    expect(nextFormatForGen('blank', 9)).toBe('gen9ou');
  });

  it('returns the tier for another tier of the same generation', () => {
    expect(nextFormatForTier('gen9ou', 'gen9vgc')).toBe('gen9vgc');
  });

  it('derives the highlighted generation and tier from value (gen9vgc keeps Gen 9 and VGC)', () => {
    const html = renderToStaticMarkup(<FormatSelector value="gen9vgc" onChange={() => {}} />);
    const selected = /<button[^>]*class="[^"]*bg-poke-accent[^"]*"[^>]*>(.*?)<\/button>/g;
    const labels = [...html.matchAll(selected)].map((m) => textOf(m[1]));
    expect(labels).toHaveLength(2);
    expect(labels[0].startsWith('9')).toBe(true);
    expect(labels[1]).toBe('VGC');
  });

  it('highlights Custom for the blank format', () => {
    const html = renderWithI18n(<FormatSelector value="blank" onChange={() => {}} />, { locale: 'de' });
    const selected = [...html.matchAll(/<button[^>]*class="[^"]*bg-poke-accent[^"]*"[^>]*>(.*?)<\/button>/g)];
    expect(selected).toHaveLength(1);
    expect(textOf(selected[0][1])).toBe('Eigenes');
  });
});
