/**
 * `observedOffTeam` fed with the species rows a real replay parse produces (real Pokédex, no mocks): a forme change and
 * an Illusion team, so the species view is checked against `parseReplayLog` output and not only against typed names.
 */
import { describe, expect, it } from 'vitest';
import { parseReplayLog } from '@/lib/pkmn/replay';
import type { TeamMember } from '../team';
import { observedOffTeam } from '../team-audit';

const member = (species: string, baseSpecies = species): TeamMember => ({
  name: species,
  species,
  baseName: baseSpecies,
  baseSpecies,
  types: [],
  item: '',
  itemName: '',
  teraType: null,
  evolution: 'fe',
});

/** The species of the Pokémon the player brought, as the battle_stats rows hold them. */
const brought = (log: string, side: 0 | 1): string[] =>
  parseReplayLog(log).players[side].pokemon.filter((p) => p.was_brought).map((p) => p.pokemon_name);

const ILLUSION_LOG = [
  '|poke|p2|Zoroark-Hisui, M|',
  '|poke|p2|Lycanroc-Midnight, M|',
  '|switch|p1a: Alpha|Alpha|100/100',
  '|switch|p2a: Howler|Lycanroc-Midnight, M|100/100',
  '|turn|1',
  '|move|p2a: Howler|Bitter Malice|p1a: Alpha',
  '|-damage|p1a: Alpha|0 fnt',
  '|faint|p1a: Alpha',
  '|switch|p1a: Beta|Beta|100/100',
  '|turn|2',
  '|move|p1a: Beta|Stored Power|p2a: Howler',
  '|-damage|p2a: Howler|0 fnt',
  '|replace|p2a: Masque|Zoroark-Hisui, M',
  '|-end|p2a: Masque|Illusion',
  '|faint|p2a: Masque',
  '|switch|p2a: Howler|Lycanroc-Midnight, M|100/100',
  '|turn|3',
  '|move|p2a: Howler|Stone Edge|p1a: Beta',
  '|-damage|p1a: Beta|0 fnt',
  '|faint|p1a: Beta',
  '|win|Player2',
].join('\n');

describe('observedOffTeam on parsed replays', () => {
  it('finds no mismatch for an Illusion team that registered both the user and the copied species', () => {
    const names = brought(ILLUSION_LOG, 1);
    expect(names).toEqual(expect.arrayContaining(['Zoroark-Hisui', 'Lycanroc-Midnight']));
    expect(observedOffTeam(names, [member('zoroarkhisui', 'zoroark'), member('lycanrocmidnight', 'lycanroc')])).toEqual([]);
  });

  it('flags the Illusion user when the team registered only the copied species', () => {
    const names = brought(ILLUSION_LOG, 1);
    expect(observedOffTeam(names, [member('lycanrocmidnight', 'lycanroc')])).toEqual(['Zoroark-Hisui']);
  });

  it('does not flag a forme change on the base species of the registered Pokémon', () => {
    const log = [
      '|switch|p1a: Alpha|Alpha|100/100',
      '|switch|p2a: Mon|Ogerpon-Wellspring|100/100',
      '|turn|1',
      '|move|p2a: Mon|Tackle|p1a: Alpha',
      '|-damage|p1a: Alpha|0 fnt',
      '|faint|p1a: Alpha',
      '|switch|p1a: Beta|Beta|100/100',
      '|detailschange|p2a: Mon|Ogerpon-Wellspring-Tera',
      '|turn|2',
      '|win|Player2',
    ].join('\n');
    const names = brought(log, 1);
    expect(names).toEqual(['Ogerpon-Wellspring']);
    expect(observedOffTeam(names, [member('ogerponwellspring', 'ogerpon')])).toEqual([]);
    expect(observedOffTeam(names, [member('ogerpon', 'ogerpon')])).toEqual([]);
    expect(observedOffTeam(names, [member('garchomp')])).toEqual(['Ogerpon-Wellspring']);
  });
});
