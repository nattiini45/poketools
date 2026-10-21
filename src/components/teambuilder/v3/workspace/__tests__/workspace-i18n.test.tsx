/**
 * English / German rendering of the v3 set workspace (T13, i18n-core §8.2 rule 2).
 * English stays as it was (also unwrapped: no provider = English, D13); German UI text comes from
 * `teambuilder-intel`, Pokémon data names from the pkmn layer. Stored values stay English.
 */
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { EditorContext } from '../../editor/EditorContext';
import { createInitialState, type EditorState } from '../../editor/state';
import type { PokemonSet } from '@/types/team';
import MoveSection from '../MoveSection';
import NaturePicker from '../NaturePicker';
import SetWorkspace from '../SetWorkspace';
import StatEditor from '../StatEditor';
import TeraTypePicker from '../TeraTypePicker';
import { formatUsagePct } from '../usagePercent';

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

function withEditor(ui: ReactElement, patch: Partial<EditorState> = {}): ReactElement {
  const base = createInitialState();
  const team = [...base.team];
  team[0] = CHARIZARD;
  const state: EditorState = { ...base, team, activeSlot: 0, ...patch };
  return <EditorContext.Provider value={{ state, dispatch: () => {} }}>{ui}</EditorContext.Provider>;
}

describe('StatEditor', () => {
  it('renders English labels unwrapped, as before', () => {
    const html = renderToStaticMarkup(withEditor(<StatEditor slot={0} set={CHARIZARD} />));
    expect(html).toContain('Stats');
    expect(html).toContain('508/510 EVs');
    expect(html).toContain('>SpA<');
    expect(html).toContain('Quick presets');
    expect(html).toContain('title="252 SpA / 252 Spe Timid"');
    expect(html).toContain('title="Trick Room (252 Atk / 252 HP)"');
    expect(html).toContain('title="Bulky (252 HP / 252 SpA Modest)"');
  });

  it('renders German UI text, stat names and natures', () => {
    const html = renderWithI18n(withEditor(<StatEditor slot={0} set={CHARIZARD} />), { locale: 'de' });
    expect(html).toContain('Statuswerte');
    expect(html).toContain('Basis');
    expect(html).toContain('Gesamt');
    expect(html).toContain('>Sp.-Angr.<');
    expect(html).toContain('Schnellauswahl');
    expect(html).toContain('>Scheu<');
    expect(html).toContain('title="252 Sp.-Angr. / 252 Init. Scheu"');
    expect(html).toContain('title="Bizarroraum (252 Angr. / 252 KP)"');
  });
});

describe('NaturePicker', () => {
  it('shows the nature and its effect in both languages; the value stays English', () => {
    const en = renderWithI18n(<NaturePicker value="Timid" onChange={() => {}} />);
    expect(en).toContain('Timid');
    expect(en).toContain('+Spe -Atk');
    const de = renderWithI18n(<NaturePicker value="Timid" onChange={() => {}} />, { locale: 'de' });
    expect(de).toContain('Scheu');
    expect(de).toContain('+Init. -Angr.');
    expect(renderWithI18n(<NaturePicker value="" onChange={() => {}} />, { locale: 'de' })).toContain('Keine');
  });

  it('keeps English natures when the viewer keeps Pokémon terms in English', () => {
    const html = renderWithI18n(<NaturePicker value="Timid" onChange={() => {}} />, { locale: 'de', dataLocale: 'en' });
    expect(html).toContain('Timid');
    expect(html).toContain('+Spe -Atk');
  });
});

describe('TeraTypePicker', () => {
  it('localizes the tooltip and the empty label', () => {
    const en = renderWithI18n(withEditor(<TeraTypePicker value="Fire" onChange={() => {}} />));
    expect(en).toContain('title="Tera: Fire"');
    const de = renderWithI18n(withEditor(<TeraTypePicker value="Fire" onChange={() => {}} />), { locale: 'de' });
    expect(de).toContain('title="Tera-Typ: Feuer"');
    const empty = renderWithI18n(withEditor(<TeraTypePicker value={null} onChange={() => {}} />), { locale: 'de' });
    expect(empty).toContain('title="Tera-Typ wählen"');
  });
});

describe('MoveSection', () => {
  it('shows German move names and slot labels', () => {
    const en = renderWithI18n(withEditor(<MoveSection slot={0} set={CHARIZARD} />));
    expect(en).toContain('Moves');
    expect(en).toContain('Flamethrower');
    expect(en).toContain('+ Move 2');
    const de = renderWithI18n(withEditor(<MoveSection slot={0} set={CHARIZARD} />), { locale: 'de' });
    expect(de).toContain('Attacken');
    expect(de).toContain('Flammenwurf');
    expect(de).toContain('+ Attacke 2');
    expect(de).toContain('aria-label="Attacke 1 entfernen"');
  });
});

describe('SetWorkspace', () => {
  it('renders the workspace chrome and the species in German', () => {
    const de = renderWithI18n(withEditor(<SetWorkspace />), { locale: 'de' });
    expect(de).toContain('Glurak');
    expect(de).toContain('Fähigkeit');
    expect(de).toContain('Wesen');
    expect(de).toContain('Pokémon entfernen');
    expect(de).toContain('aria-label="Zurück zur Teamübersicht"');
    const en = renderWithI18n(withEditor(<SetWorkspace />));
    expect(en).toContain('Charizard');
    expect(en).toContain('Remove Pokémon');
    expect(en).toContain('/ Slot 1');
  });
});

describe('formatUsagePct', () => {
  it('keeps the old English output and formats German numbers', () => {
    expect(formatUsagePct(0.123, 'en')).toBe('12.3%');
    expect(formatUsagePct(0.12, 'en')).toBe('12.0%');
    expect(formatUsagePct(0.5, 'en', 0)).toBe('50%');
    expect(formatUsagePct(0.123, 'de')).toMatch(/^12,3\s%$/u);
  });
});
