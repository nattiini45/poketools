/**
 * German rendering of the teambuilder chrome (i18n-core §8.2 rule 2). English
 * stays as it was, including unwrapped renders (no provider = English, D13).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import LegalityBadge from '@/components/teambuilder/LegalityBadge';
import TeamCoachPanel from '../../ai/TeamCoachPanel';
import SlotCoachPanel from '../../ai/SlotCoachPanel';
import BudgetMeter from '../../browser/BudgetMeter';
import { EditorContext } from '../EditorContext';
import { createInitialState, type DraftEditorContext } from '../state';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

const CHARIZARD: PokemonSet = {
  name: '',
  species: 'Charizard',
  gender: '',
  item: 'Heavy-Duty Boots',
  ability: 'Solar Power',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Timid',
  level: 100,
  moves: ['Flamethrower', 'Air Slash', 'Focus Blast', 'Roost'],
};

const ILLEGAL: TeamValidationResult = {
  valid: false,
  issues: [{ pokemon_index: 0, species: 'Charizard', issue: 'Banned', severity: 'error' }],
  team_issues: [],
};

describe('LegalityBadge', () => {
  it('renders English unwrapped, as before', () => {
    const html = renderToStaticMarkup(<LegalityBadge validation={{ valid: true, issues: [], team_issues: [] }} />);
    expect(html).toContain('Legal');
  });

  it('renders the status in German and the species with its German name', () => {
    const html = renderWithI18n(<LegalityBadge validation={ILLEGAL} />, { locale: 'de' });
    expect(html).toContain('Illegal');
    expect(html).toContain('Glurak: ');
  });

  it('keeps English species names when the viewer keeps Pokémon terms in English', () => {
    const html = renderWithI18n(<LegalityBadge validation={ILLEGAL} />, { locale: 'de', dataLocale: 'en' });
    expect(html).toContain('Charizard: ');
  });
});

describe('Coach panels', () => {
  it('team coach: English and German', () => {
    const team = [CHARIZARD, null, null, null, null, null];
    const en = renderWithI18n(<TeamCoachPanel team={team} format="gen9ou" generation={9} />);
    const de = renderWithI18n(<TeamCoachPanel team={team} format="gen9ou" generation={9} />, { locale: 'de' });
    expect(en).toContain('Team Coach');
    expect(en).toContain('Analyze Team');
    expect(en).toContain('for a holistic review of your 1-Pokémon team.');
    expect(de).toContain('Team-Coach');
    expect(de).toContain('Team analysieren');
    expect(de).toContain('deines Teams mit 1 Pokémon');
  });

  it('slot coach shows the localized species', () => {
    const de = renderWithI18n(
      <SlotCoachPanel set={CHARIZARD} team={[CHARIZARD]} format="gen9ou" generation={9} />,
      { locale: 'de' },
    );
    expect(de).toContain('Slot-Coach – Glurak');
    expect(de).toContain('für dieses Glurak-Set');
    const en = renderWithI18n(<SlotCoachPanel set={CHARIZARD} team={[CHARIZARD]} format="gen9ou" generation={9} />);
    expect(en).toContain('Slot Coach — Charizard');
  });
});

describe('BudgetMeter', () => {
  it('renders the over-budget note in German', () => {
    const draft: DraftEditorContext = {
      poolId: 'pool-1',
      budget: 100,
      defaultPointCost: null,
      spent: 112,
      roster: [],
      entries: [],
      takenPokemon: [],
    };
    const state = { ...createInitialState(), draft };
    const ui = (
      <EditorContext.Provider value={{ state, dispatch: () => {} }}>
        <BudgetMeter />
      </EditorContext.Provider>
    );
    expect(renderWithI18n(ui)).toContain('Over budget by 12');
    expect(renderWithI18n(ui, { locale: 'de' })).toContain('Budget um 12 überschritten');
  });
});

