/**
 * `pokemonSetSchema` / `teamPokemonSchema`: the shape every team boundary (create, update, live check, match prep)
 * enforces. They must refuse what would crash or fool the validator, and must NOT refuse what the teambuilder and the
 * Showdown importer produce.
 */
import { describe, expect, it } from 'vitest';
import { pokemonSetSchema, teamPokemonSchema, teamCreateSchema, teamUpdateSchema, validateTeamSchema, matchPrepSchema } from '../schemas';
import { exportTeamText, parseTeamText } from '@/lib/pkmn/teams';
import { makeSet } from '@/test/team-fixtures';

const UUID = '00000000-0000-4000-8000-000000000001';

const SHOWDOWN_PASTE = `Garchomp @ Rocky Helmet
Ability: Rough Skin
Tera Type: Steel
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Swords Dance
- Stealth Rock

Rotom-Wash (F) @ Leftovers
Ability: Levitate
Level: 50
Shiny: Yes
Happiness: 200
EVs: 252 HP / 252 Def / 4 SpA
IVs: 0 Atk
Bold Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Pain Split

Pikachu
Ability: Static
- Thunderbolt
`;

describe('pokemonSetSchema accepts what the app produces', () => {
  it('parses a Showdown paste into sets that pass (round trip through parseTeamText)', () => {
    const sets = parseTeamText(SHOWDOWN_PASTE);
    expect(sets).toHaveLength(3);
    const parsed = teamPokemonSchema.safeParse(sets);
    expect(parsed.success).toBe(true);
    // The parse keeps every value the importer set.
    if (parsed.success) {
      expect(parsed.data[1]).toMatchObject({ species: 'Rotom-Wash', level: 50, shiny: true, happiness: 200, ivs: { atk: 0, hp: 31 } });
      expect(parsed.data[0].tera_type).toBe('Steel');
    }
  });

  it('round-trips the exported text of a parsed team', () => {
    const sets = parseTeamText(exportTeamText(parseTeamText(SHOWDOWN_PASTE)));
    expect(teamPokemonSchema.safeParse(sets).success).toBe(true);
  });

  it('accepts the blank set the editor creates for a new slot', () => {
    const blank = { name: '', species: 'Garchomp', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] };
    expect(pokemonSetSchema.safeParse(blank).success).toBe(true);
  });

  it('accepts the boundary values', () => {
    const edge = makeSet('Garchomp', { level: 1, evs: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: ['a', 'b', 'c', 'd'] });
    expect(pokemonSetSchema.safeParse(edge).success).toBe(true);
    expect(pokemonSetSchema.safeParse({ ...edge, level: 100, happiness: 255 }).success).toBe(true);
  });

  it('fills a stat left out of a spread (0 EVs, 31 IVs) instead of refusing a partial spread', () => {
    const parsed = pokemonSetSchema.parse({ ...makeSet(), evs: { atk: 252 }, ivs: { atk: 0 } });
    expect(parsed.evs).toEqual({ hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(parsed.ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  it('drops keys it does not know instead of storing them', () => {
    const parsed = pokemonSetSchema.parse({ ...makeSet(), notes: 'x'.repeat(10_000), __proto__: { a: 1 } });
    expect(parsed).not.toHaveProperty('notes');
  });
});

describe('pokemonSetSchema refuses what would crash or fool the validator', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['no evs', { evs: undefined }],
    ['no ivs', { ivs: undefined }],
    ['no moves', { moves: undefined }],
    ['no species', { species: undefined }],
    ['an empty species', { species: '   ' }],
    ['a negative EV', { evs: { hp: -760, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 } }],
    ['an EV of 253', { evs: { hp: 0, atk: 253, def: 0, spa: 0, spd: 0, spe: 0 } }],
    ['a fractional EV', { evs: { hp: 0.5, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }],
    ['an EV that is text', { evs: { hp: '252', atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }],
    ['an IV of -1', { ivs: { hp: -1, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } }],
    ['an IV of 32', { ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 32 } }],
    ['level 0', { level: 0 }],
    ['level 101', { level: 101 }],
    ['a fractional level', { level: 50.5 }],
    ['a null level', { level: null }],
    ['five moves', { moves: ['a', 'b', 'c', 'd', 'e'] }],
    ['a move of 101 characters', { moves: ['x'.repeat(101)] }],
    ['a move that is not text', { moves: [1] }],
    ['an item of 101 characters', { item: 'x'.repeat(101) }],
    ['an ability of 101 characters', { ability: 'x'.repeat(101) }],
    ['a nickname of 101 characters', { name: 'x'.repeat(101) }],
    ['a gender of "X"', { gender: 'X' }],
    ['happiness 256', { happiness: 256 }],
    ['happiness -1', { happiness: -1 }],
    ['shiny as text', { shiny: 'yes' }],
    ['a tera type of 51 characters', { tera_type: 'x'.repeat(51) }],
  ];

  it.each(bad)('%s', (_label, override) => {
    expect(pokemonSetSchema.safeParse({ ...makeSet(), ...override }).success).toBe(false);
  });

  it.each([null, 'Garchomp', 7, [], undefined])('a set that is %j', (value) => {
    expect(pokemonSetSchema.safeParse(value).success).toBe(false);
  });
});

describe('the team boundaries use the team schema', () => {
  const team = [makeSet()];
  const malformed = [{ ...makeSet(), evs: undefined }];

  it('teamPokemonSchema takes one to six sets', () => {
    expect(teamPokemonSchema.safeParse([]).success).toBe(false);
    expect(teamPokemonSchema.safeParse(Array.from({ length: 6 }, () => makeSet())).success).toBe(true);
    expect(teamPokemonSchema.safeParse(Array.from({ length: 7 }, () => makeSet())).success).toBe(false);
  });

  it.each([
    ['POST /api/teams', (pokemon: unknown) => teamCreateSchema.safeParse({ pokemon })],
    ['PATCH /api/teams/[id]', (pokemon: unknown) => teamUpdateSchema.safeParse({ pokemon, import_source: 'manual' })],
    ['POST /api/validate-team', (pokemon: unknown) => validateTeamSchema.safeParse({ pokemon, ruleset_id: UUID })],
    ['POST /api/match-prep', (pokemon: unknown) => matchPrepSchema.safeParse({ pokemon, match_id: UUID })],
  ])('%s refuses a malformed set and accepts a good team', (_route, parse) => {
    expect(parse(team).success).toBe(true);
    expect(parse(malformed).success).toBe(false);
    expect(parse('Garchomp').success).toBe(false);
  });
});
