import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { PokemonSet } from '@/types/team';
import StatDisplay from '@/components/teambuilder/StatDisplay';
import TypeBadge from '../TypeBadge';
import TypeIcon from '../TypeIcon';
import TypeSprite from '../TypeSprite';
import PokemonSprite from '../PokemonSprite';
import GymTypedName from '../GymTypedName';

/** Shared Pokémon-data chokepoints (design pkmn-l10n.md §5.1, PK-4): labels localize, keys and URLs stay English. */

const attr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

describe('<TypeBadge>', () => {
  it("renders the German type name under a 'de' provider and keeps the English style key", () => {
    const html = renderWithI18n(<TypeBadge type="Fire" />, { locale: 'de' });
    expect(html).toContain('>Feuer</span>');
    expect(html).not.toContain('>Fire<');
    expect(html).toContain('bg-poke-type-fire');
  });

  it('the compact size drops the minimum width and tightens the box; the default keeps the pill metrics', () => {
    const compact = renderToStaticMarkup(<TypeBadge type="Fire" size="compact" />);
    expect(compact).toContain('min-w-0');
    expect(compact).not.toContain('min-w-[4.5rem]');
    const normal = renderToStaticMarkup(<TypeBadge type="Fire" />);
    expect(normal).toContain('min-w-[4.5rem]');
    expect(normal).toContain('tracking-wide');
  });

  it('renders English without a provider', () => {
    const html = renderToStaticMarkup(<TypeBadge type="Fire" />);
    expect(html).toContain('>Fire</span>');
    expect(html).toContain('bg-poke-type-fire');
  });

  it('an explicit locale prop beats the provider', () => {
    expect(renderWithI18n(<TypeBadge type="Fire" locale="en" />, { locale: 'de' })).toContain('>Fire</span>');
    expect(renderWithI18n(<TypeBadge type="Water" locale="de" />, { locale: 'en' })).toContain('>Wasser</span>');
  });

  it('follows the data locale ("Keep Pokémon terms in English")', () => {
    expect(renderWithI18n(<TypeBadge type="Dark" />, { locale: 'de', dataLocale: 'en' })).toContain('>Dark</span>');
    expect(renderWithI18n(<TypeBadge type="Dark" />, { locale: 'de' })).toContain('>Unlicht</span>');
  });

  it('passes unknown types through with the neutral style', () => {
    const html = renderWithI18n(<TypeBadge type="???" />, { locale: 'de' });
    expect(html).toContain('>???</span>');
    expect(html).toContain('bg-poke-muted');
  });
});

describe('<TypeIcon>', () => {
  it('localizes aria-label and title', () => {
    const de = renderWithI18n(<TypeIcon type="Fire" />, { locale: 'de' });
    expect(attr(de, 'aria-label')).toEqual(['Typ Feuer']);
    expect(attr(de, 'title')).toEqual(['Feuer']);
    expect(de).toContain('bg-poke-type-fire');

    const en = renderWithI18n(<TypeIcon type="Fire" />, { locale: 'en' });
    expect(attr(en, 'aria-label')).toEqual(['Fire type']);
    expect(attr(en, 'title')).toEqual(['Fire']);
  });

  it('renders English without a provider', () => {
    expect(attr(renderToStaticMarkup(<TypeIcon type="Fire" />), 'aria-label')).toEqual(['Fire type']);
  });

  it('German sentence frame with English type names when Pokémon terms stay English', () => {
    const html = renderWithI18n(<TypeIcon type="Fire" />, { locale: 'de', dataLocale: 'en' });
    expect(attr(html, 'aria-label')).toEqual(['Typ Fire']);
  });
});

describe('<TypeSprite> and <GymTypedName>', () => {
  it('localizes the alt text; the sprite URL stays English', () => {
    const de = renderWithI18n(<TypeSprite type="fire" />, { locale: 'de' });
    expect(attr(de, 'alt')).toEqual(['Typ Feuer']);
    expect(de).toContain('sprites/types/Fire.png');

    expect(attr(renderToStaticMarkup(<TypeSprite type="Water" />), 'alt')).toEqual(['Water type']);
  });

  it('GymTypedName inherits the localized sprite alt', () => {
    const html = renderWithI18n(<GymTypedName name="Ash" gymType="Fire" />, { locale: 'de' });
    expect(html).toContain('>Ash</span>');
    expect(attr(html, 'alt')).toEqual(['Typ Feuer']);
  });
});

describe('<PokemonSprite>', () => {
  it('localizes the alt text; the sprite URL stays English', () => {
    const de = renderWithI18n(<PokemonSprite name="Charizard" />, { locale: 'de' });
    expect(attr(de, 'alt')).toEqual(['Glurak']);
    expect(de.toLowerCase()).toContain('charizard');

    expect(attr(renderToStaticMarkup(<PokemonSprite name="Charizard" />), 'alt')).toEqual(['Charizard']);
  });

  it('falls back to "Pokémon" for an empty name', () => {
    expect(attr(renderToStaticMarkup(<PokemonSprite name="" />), 'alt')).toEqual(['Pokémon']);
  });
});

describe('<StatDisplay>', () => {
  const set: PokemonSet = {
    name: '',
    species: 'Charizard',
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Timid',
    level: 100,
    moves: [],
  };
  const baseStats = { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 };
  const labels = (html: string) => [...html.matchAll(/font-semibold[^"]*">([^<]+)<\/span>/g)].map((m) => m[1]);

  it('keeps the English short labels without a provider', () => {
    const html = renderToStaticMarkup(<StatDisplay set={set} baseStats={baseStats} />);
    expect(labels(html).filter((l) => !/^\d+$/.test(l))).toEqual(['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe']);
  });

  it("renders the German short labels under 'de'", () => {
    const html = renderWithI18n(<StatDisplay set={set} baseStats={baseStats} compact />, { locale: 'de' });
    expect(labels(html).filter((l) => !/^\d+$/.test(l))).toEqual([
      'KP',
      'Angr.',
      'Vert.',
      'Sp.-Angr.',
      'Sp.-Vert.',
      'Init.',
    ]);
  });
});
