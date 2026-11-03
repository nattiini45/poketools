import { describe, expect, it } from 'vitest';
import type { PokemonSet } from '@/types/team';
import { formatShowdownSet } from '../showdown-set';

const set: PokemonSet = {
  name: 'Landshark',
  species: 'Garchomp',
  gender: '',
  item: 'Rocky Helmet',
  ability: 'Rough Skin',
  evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 0 },
  nature: 'Jolly',
  level: 100,
  moves: ['Earthquake', 'Dragon Claw', '', 'Swords Dance'],
  tera_type: 'Steel',
};

describe('formatShowdownSet', () => {
  it('writes English Showdown paste text', () => {
    expect(formatShowdownSet(set)).toBe(
      [
        'Landshark (Garchomp) @ Rocky Helmet',
        'Ability: Rough Skin',
        'Tera Type: Steel',
        'EVs: 4 HP / 252 Atk / 252 Spe',
        'Jolly Nature',
        'IVs: 0 Spe',
        '- Earthquake',
        '- Dragon Claw',
        '- Swords Dance',
      ].join('\n'),
    );
  });

  it('omits what a set does not have', () => {
    expect(formatShowdownSet({ ...set, name: '', item: '', ability: '', tera_type: undefined, level: 50, evs: undefined as never, ivs: undefined as never, nature: '', moves: [] })).toBe(
      ['Garchomp', 'Level: 50'].join('\n'),
    );
  });
});