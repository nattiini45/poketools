import { describe, it, expect, vi } from 'vitest';

// getRulesetById is invoked only when a ruleset_id is passed; the existing
// format-only tests below never trigger it, so they are unaffected by this mock.
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => null),
}));

import { validateTeam } from '../validate';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { ValidateTeamInput } from '../schemas';
import type { Ruleset } from '@/types/ruleset';

const legalGarchomp: ValidateTeamInput['team'][number] = {
  species: 'Garchomp',
  item: 'Leftovers',
  ability: 'Rough Skin',
  nature: 'Jolly',
  evs: { atk: 252, spe: 252, hp: 4 },
  moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Stealth Rock'],
};

const legalRotomWash: ValidateTeamInput['team'][number] = {
  species: 'Rotom-Wash',
  item: 'Leftovers',
  ability: 'Levitate',
  nature: 'Bold',
  evs: { hp: 252, def: 252, spa: 4 },
  moves: ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Pain Split'],
};

describe('validateTeam', () => {
  it('passes a simple legal gen9ou team', async () => {
    const input: ValidateTeamInput = {
      format: 'gen9ou',
      team: [legalGarchomp, legalRotomWash],
    };
    const result = await validateTeam(input);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.team_issues).toHaveLength(0);
  });

  it('flags a 7-Pokémon team as invalid', async () => {
    const input: ValidateTeamInput = {
      format: 'gen9ou',
      team: Array.from({ length: 7 }, (_, i) => ({
        ...legalGarchomp,
        // Distinct species so Species Clause isn't the (only) failure reason.
        species: ['Garchomp', 'Rotom-Wash', 'Dragapult', 'Corviknight', 'Toxapex', 'Great Tusk', 'Kingambit'][i],
        ability: undefined,
        moves: ['Tackle'],
      })),
    };
    const result = await validateTeam(input);
    expect(result.valid).toBe(false);
    expect(result.team_issues.some((m) => /more than 6/i.test(m))).toBe(true);
  });

  it('flags a move the species cannot legally learn', async () => {
    const input: ValidateTeamInput = {
      format: 'gen9ou',
      team: [
        {
          species: 'Magikarp',
          moves: ['Hydro Pump'], // Magikarp cannot learn Hydro Pump
        },
      ],
    };
    const result = await validateTeam(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /cannot legally learn/i.test(i.issue))).toBe(true);
  });

  it('flags an unknown move as invalid', async () => {
    const input: ValidateTeamInput = {
      format: 'gen9ou',
      team: [{ species: 'Garchomp', moves: ['Notarealmove'] }],
    };
    const result = await validateTeam(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /unknown move/i.test(i.issue))).toBe(true);
  });
});

const teraCoreRuleset: Ruleset = {
  id: 'rs-core', name: 'Type Triangle League', base_format: 'gen9ou', is_doubles: false,
  clauses: ['Species Clause'],
  bans: { pokemon: [], moves: [], items: [], abilities: [] },
  additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
  team_constraints: { tera_match: 'player_core' },
  created_by: null, created_at: '', updated_at: '',
};

describe('validateTeam (league ruleset + player core)', () => {
  it('flags a tera type outside the assigned core', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(teraCoreRuleset);

    const result = await validateTeam({
      format: 'gen9ou',
      ruleset_id: 'rs-core',
      player_core: ['Fire', 'Water', 'Grass'],
      team: [{ species: 'Garchomp', moves: ['Earthquake'], teraType: 'Dragon' }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /Tera type Dragon/.test(i.issue))).toBe(true);
  });

  it('accepts a tera type within the assigned core', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(teraCoreRuleset);

    const result = await validateTeam({
      format: 'gen9ou',
      ruleset_id: 'rs-core',
      player_core: ['Fire', 'Water', 'Grass'],
      team: [{ species: 'Garchomp', moves: ['Earthquake'], teraType: 'Fire' }],
    });

    expect(result.issues.some((i) => /Tera type/.test(i.issue))).toBe(false);
  });

  it('does not call getRulesetById when no ruleset_id is supplied', async () => {
    vi.mocked(getRulesetById).mockClear();
    await validateTeam({
      format: 'gen9ou',
      team: [{ species: 'Garchomp', moves: ['Earthquake'] }],
    });
    expect(getRulesetById).not.toHaveBeenCalled();
  });
});
