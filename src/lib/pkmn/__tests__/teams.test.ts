import { describe, it, expect, vi } from 'vitest';

// ── Mock @pkmn/sets ────────────────────────────────────────────────

vi.mock('@pkmn/sets', () => ({
  Teams: {
    importTeam: vi.fn(),
  },
  Sets: {
    exportSet: vi.fn(),
  },
}));

import { Teams, Sets } from '@pkmn/sets';
import { parseTeamText, exportSetText, exportTeamText } from '../teams';
import type { PokemonSet } from '@/types/team';

// ── parseTeamText ──────────────────────────────────────────────────

describe('parseTeamText', () => {
  it('returns empty array for empty string', () => {
    expect(parseTeamText('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseTeamText('   \n  \n  ')).toEqual([]);
  });

  it('returns empty array when @pkmn/sets returns null', () => {
    vi.mocked(Teams.importTeam).mockReturnValue(null as never);
    expect(parseTeamText('Some invalid text')).toEqual([]);
  });

  it('returns empty array when team is empty', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({ team: [] } as never);
    expect(parseTeamText('Some text')).toEqual([]);
  });

  it('normalises a single pokemon set with defaults', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [
        {
          name: '',
          species: 'Garchomp',
          gender: 'M',
          item: 'Leftovers',
          ability: 'Rough Skin',
          evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 0, spe: 252 },
          nature: 'Jolly',
          moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot'],
          shiny: false,
          teraType: 'Ground',
        },
      ],
    } as never);

    const result = parseTeamText('Garchomp paste text');

    expect(result).toHaveLength(1);
    expect(result[0].species).toBe('Garchomp');
    expect(result[0].ability).toBe('Rough Skin');
    expect(result[0].nature).toBe('Jolly');
    expect(result[0].level).toBe(100); // default
    expect(result[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }); // default
    expect(result[0].tera_type).toBe('Ground');
  });

  it('fills in missing EVs with zeros', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [
        {
          species: 'Pikachu',
          evs: { hp: 4 }, // only hp provided
          moves: ['Thunderbolt'],
        },
      ],
    } as never);

    const result = parseTeamText('Pikachu text');
    expect(result[0].evs.hp).toBe(4);
    expect(result[0].evs.atk).toBe(0);
    expect(result[0].evs.spe).toBe(0);
  });

  it('fills in missing IVs with 31', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [
        {
          species: 'Pikachu',
          ivs: { atk: 0 }, // only atk provided (for special attacker)
          moves: ['Thunderbolt'],
        },
      ],
    } as never);

    const result = parseTeamText('Pikachu text');
    expect(result[0].ivs.atk).toBe(0);
    expect(result[0].ivs.hp).toBe(31);
    expect(result[0].ivs.spe).toBe(31);
  });

  it('handles multiple pokemon in a team paste', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [
        { species: 'Garchomp', moves: ['Earthquake'] },
        { species: 'Tyranitar', moves: ['Stone Edge'] },
        { species: 'Dragonite', moves: ['Dragon Dance'] },
      ],
    } as never);

    const result = parseTeamText('Full team paste');
    expect(result).toHaveLength(3);
    expect(result[0].species).toBe('Garchomp');
    expect(result[1].species).toBe('Tyranitar');
    expect(result[2].species).toBe('Dragonite');
  });

  it('defaults shiny to false when not present', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [{ species: 'Pikachu', moves: ['Thunderbolt'] }],
    } as never);

    const result = parseTeamText('Pikachu');
    expect(result[0].shiny).toBe(false);
  });

  it('preserves custom level when specified', () => {
    vi.mocked(Teams.importTeam).mockReturnValue({
      team: [{ species: 'Pikachu', level: 50, moves: ['Thunderbolt'] }],
    } as never);

    const result = parseTeamText('Pikachu Level 50');
    expect(result[0].level).toBe(50);
  });
});

// ── exportSetText ──────────────────────────────────────────────────

describe('exportSetText', () => {
  it('calls Sets.exportSet with correct fields', () => {
    vi.mocked(Sets.exportSet).mockReturnValue('Garchomp @ Leftovers\n...');

    const set: PokemonSet = {
      name: '',
      species: 'Garchomp',
      gender: 'M',
      item: 'Leftovers',
      ability: 'Rough Skin',
      evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: 'Jolly',
      level: 100,
      moves: ['Earthquake', 'Dragon Claw'],
      shiny: false,
      tera_type: 'Ground',
    };

    const result = exportSetText(set);

    expect(Sets.exportSet).toHaveBeenCalledWith(expect.objectContaining({
      species: 'Garchomp',
      item: 'Leftovers',
      ability: 'Rough Skin',
      teraType: 'Ground',
    }));
    expect(result).toBe('Garchomp @ Leftovers\n...');
  });

  it('omits level when it is 100 (default)', () => {
    vi.mocked(Sets.exportSet).mockReturnValue('');

    exportSetText({
      name: '',
      species: 'Garchomp',
      gender: '',
      item: '',
      ability: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: '',
      level: 100,
      moves: [],
    });

    expect(Sets.exportSet).toHaveBeenCalledWith(expect.objectContaining({
      level: undefined,
    }));
  });

  it('includes level when not 100', () => {
    vi.mocked(Sets.exportSet).mockReturnValue('');

    exportSetText({
      name: '',
      species: 'Pikachu',
      gender: '',
      item: '',
      ability: '',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: '',
      level: 50,
      moves: [],
    });

    expect(Sets.exportSet).toHaveBeenCalledWith(expect.objectContaining({
      level: 50,
    }));
  });
});

// ── exportTeamText ─────────────────────────────────────────────────

describe('exportTeamText', () => {
  it('exports multiple sets separated by newlines', () => {
    vi.mocked(Sets.exportSet).mockReturnValueOnce('Garchomp @ Leftovers\n...');
    vi.mocked(Sets.exportSet).mockReturnValueOnce('Tyranitar @ Choice Band\n...');

    const result = exportTeamText([
      {
        name: '', species: 'Garchomp', gender: '', item: 'Leftovers', ability: '',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: '', level: 100, moves: [],
      },
      {
        name: '', species: 'Tyranitar', gender: '', item: 'Choice Band', ability: '',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: '', level: 100, moves: [],
      },
    ]);

    expect(result).toBe('Garchomp @ Leftovers\n...\nTyranitar @ Choice Band\n...');
  });

  it('returns empty string for empty team', () => {
    const result = exportTeamText([]);
    expect(result).toBe('');
  });
});
