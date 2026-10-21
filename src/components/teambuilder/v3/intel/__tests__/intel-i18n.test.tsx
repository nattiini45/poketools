/**
 * English / German rendering of the Intel panel, the validation panel and the team card (T13,
 * i18n-core §8.2 rule 2). Effects do not run under `renderToStaticMarkup`, so the data tabs render
 * their first (loading / empty) state, which is what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { EditorContext } from '../../editor/EditorContext';
import { createInitialState, type EditorState } from '../../editor/state';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import CalcTab from '../CalcTab';
import IntelPanel from '../IntelPanel';
import OverviewTab from '../OverviewTab';
import SetsTab from '../SetsTab';
import SpeedTab from '../SpeedTab';
import ValidationPanel from '../../validation/ValidationPanel';
import TeamCardPrimitive from '../../primitives/TeamCardPrimitive';

const CHARIZARD: PokemonSet = {
  name: '',
  species: 'Charizard',
  gender: '',
  item: '',
  ability: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Timid',
  level: 100,
  moves: ['Flamethrower'],
};

function withEditor(ui: ReactElement, filled = true): ReactElement {
  const base = createInitialState();
  const team = [...base.team];
  if (filled) team[0] = CHARIZARD;
  const state: EditorState = { ...base, team, format: 'gen9t13test' };
  return <EditorContext.Provider value={{ state, dispatch: () => {} }}>{ui}</EditorContext.Provider>;
}

describe('IntelPanel tabs', () => {
  it('labels the tabs in both languages', () => {
    const en = renderToStaticMarkup(withEditor(<IntelPanel />));
    for (const label of ['Overview', 'Sets', 'Calc', 'Speed']) expect(en).toContain(label);
    const de = renderWithI18n(withEditor(<IntelPanel />), { locale: 'de' });
    expect(de).toContain('Übersicht');
  });
});

describe('Intel tabs, first render', () => {
  it('overview: empty and loading states', () => {
    expect(renderWithI18n(withEditor(<OverviewTab />, false))).toContain('Add Pokémon to see type coverage.');
    expect(renderWithI18n(withEditor(<OverviewTab />, false), { locale: 'de' })).toContain(
      'Füge Pokémon hinzu, um die Typabdeckung zu sehen.',
    );
    expect(renderWithI18n(withEditor(<OverviewTab />), { locale: 'de' })).toContain('Typen werden analysiert …');
  });

  it('sets: empty state', () => {
    expect(renderWithI18n(withEditor(<SetsTab />, false), { locale: 'de' })).toContain(
      'Füge ein Pokémon hinzu, um Beispiel-Sets zu sehen.',
    );
  });

  it('calc: field conditions and the matchup header', () => {
    const en = renderWithI18n(withEditor(<CalcTab />));
    expect(en).toContain('Field Conditions');
    expect(en).toContain('>Sun<');
    expect(en).toContain('>Electric<');
    expect(en).toContain('Charizard vs. Top Threats');
    expect(en).toContain('Loading threats…');

    const de = renderWithI18n(withEditor(<CalcTab />), { locale: 'de' });
    expect(de).toContain('Feldbedingungen');
    expect(de).toContain('>Sonne<');
    expect(de).toContain('>Elektrofeld<');
    expect(de).toContain('Glurak vs. Top-Bedrohungen');
    expect(de).toContain('Bedrohungen werden geladen …');
  });

  it('speed: loading state', () => {
    expect(renderWithI18n(withEditor(<SpeedTab />))).toContain('Loading speed tiers…');
    expect(renderWithI18n(withEditor(<SpeedTab />), { locale: 'de' })).toContain('Speed-Tiers werden geladen …');
  });
});

describe('ValidationPanel', () => {
  const invalid: TeamValidationResult = {
    valid: false,
    issues: [
      { pokemon_index: 0, species: 'Charizard', issue: 'Banned', severity: 'error' },
      { pokemon_index: 0, species: 'Charizard', issue: 'Odd EVs', severity: 'warning' },
      { pokemon_index: 0, species: 'Charizard', issue: 'Odd IVs', severity: 'warning' },
    ],
    team_issues: [],
  };

  it('keeps the English summary and pluralizes in German', () => {
    const en = renderToStaticMarkup(<ValidationPanel validation={invalid} />);
    expect(en).toContain('1 error');
    expect(en).toContain('/ 2 warnings');
    expect(en).toContain('Slot 1: Charizard');
    const de = renderWithI18n(<ValidationPanel validation={invalid} />, { locale: 'de' });
    expect(de).toContain('1 Fehler');
    expect(de).toContain('/ 2 Warnungen');
    expect(de).toContain('Slot 1: Glurak');
    // Issue texts come from the validation API and stay as given
    expect(de).toContain('Banned');
  });

  it('idle and valid states', () => {
    expect(renderWithI18n(<ValidationPanel validation={null} />, { locale: 'de' })).toContain('Prüfung');
    const valid = renderWithI18n(<ValidationPanel validation={{ valid: true, issues: [], team_issues: [] }} />, {
      locale: 'de',
    });
    expect(valid).toContain('Team ist gültig');
    expect(valid).toContain('Keine Probleme gefunden. Alles startklar!');
  });
});

describe('TeamCardPrimitive', () => {
  it('localizes names and labels; the nickname stays as typed', () => {
    const set: PokemonSet = { ...CHARIZARD, name: 'Blaze' };
    const en = renderToStaticMarkup(<TeamCardPrimitive set={set} index={0} />);
    expect(en).toContain('aria-label="Blaze (Charizard), slot 1"');
    expect(en).toContain('Flamethrower');
    const de = renderWithI18n(<TeamCardPrimitive set={set} index={0} />, { locale: 'de' });
    expect(de).toContain('aria-label="Blaze (Glurak), Slot 1"');
    expect(de).toContain('Flammenwurf');
    expect(de).toContain('Scheu');
    expect(renderWithI18n(<TeamCardPrimitive set={null} index={1} />, { locale: 'de' })).toContain(
      'aria-label="Leerer Slot 2"',
    );
  });
});
