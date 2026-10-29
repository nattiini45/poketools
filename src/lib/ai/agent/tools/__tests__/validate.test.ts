import { describe, it, expect, vi } from 'vitest';

// readExposedRuleset is invoked only when a ruleset_id is passed; the existing
// format-only tests below never trigger it, so they are unaffected by this mock.
vi.mock('@/lib/ruleset-studio/exposure', () => ({
  readExposedRuleset: vi.fn(async () => null),
}));

import { validateTeam } from '../validate';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import type { ValidateTeamInput } from '../schemas';
import type { Ruleset } from '@/types/ruleset';
import { makeRuleset as buildRuleset } from '@/test/ruleset-fixtures';

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

  it('reads a mixed-case format as the same generation as its lower-case form', async () => {
    const team = [{ species: 'Sprigatito', moves: ['Tackle'] }];
    const lower = await validateTeam({ format: 'gen8ou', team });
    const mixed = await validateTeam({ format: 'Gen8OU', team });
    // Sprigatito does not exist in generation 8, so a mixed-case id must not fall back to generation 9.
    expect(lower.valid).toBe(false);
    expect({ ...mixed, format: lower.format }).toEqual(lower);
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

const teraCoreRuleset: Ruleset = buildRuleset({
  id: 'rs-core', name: 'Sample Custom League', base_format: 'gen9ou', is_doubles: false,
  clauses: ['Species Clause'],
  bans: { pokemon: [], moves: [], items: [], abilities: [] },
  additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
  team_constraints: { tera_match: 'player_core' },
  created_by: null, created_at: '', updated_at: '',
});

describe('validateTeam (league ruleset + player core)', () => {
  it('flags a tera type outside the assigned core', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(teraCoreRuleset);

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
    vi.mocked(readExposedRuleset).mockResolvedValue(teraCoreRuleset);

    const result = await validateTeam({
      format: 'gen9ou',
      ruleset_id: 'rs-core',
      player_core: ['Fire', 'Water', 'Grass'],
      team: [{ species: 'Garchomp', moves: ['Earthquake'], teraType: 'Fire' }],
    });

    expect(result.issues.some((i) => /Tera type/.test(i.issue))).toBe(false);
  });

  it('does not call readExposedRuleset when no ruleset_id is supplied', async () => {
    vi.mocked(readExposedRuleset).mockClear();
    await validateTeam({
      format: 'gen9ou',
      team: [{ species: 'Garchomp', moves: ['Earthquake'] }],
    });
    expect(readExposedRuleset).not.toHaveBeenCalled();
  });
});

describe('validateTeam: the shared team check (same rules as the editor)', () => {
  const GARCHOMP = { ...legalGarchomp };

  it('says which rules ran', async () => {
    const plain = await validateTeam({ format: 'gen9ou', team: [GARCHOMP] });
    expect(plain.ruleset_source).toEqual({ kind: 'format_preset', format: 'gen9ou' });

    vi.mocked(readExposedRuleset).mockResolvedValue(buildRuleset({ base_format: 'gen9ou' }));
    const league = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-1', team: [GARCHOMP] });
    expect(league.ruleset_source).toEqual({ kind: 'ruleset' });
    vi.mocked(readExposedRuleset).mockReset();
  });

  it('applies the format tier bans when there is no league ruleset', async () => {
    const result = await validateTeam({
      format: 'gen9ou',
      team: [{ species: 'Koraidon', item: 'Choice Band', ability: 'Orichalcum Pulse', moves: ['Collision Course'] }],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /Koraidon is banned/.test(i.issue))).toBe(true);
  });

  it('flags an ability the species cannot have', async () => {
    const result = await validateTeam({ format: 'gen9ou', team: [{ ...GARCHOMP, ability: 'Levitate' }] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /cannot have the ability Levitate/.test(i.issue))).toBe(true);
  });

  it('flags a move named twice', async () => {
    const result = await validateTeam({ format: 'gen9ou', team: [{ ...GARCHOMP, moves: ['Earthquake', 'Earthquake'] }] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /Earthquake is listed more than once/.test(i.issue))).toBe(true);
  });

  it('applies the Item Clause by canonical item id when the ruleset has it', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(buildRuleset({ base_format: 'gen9ou', clauses: ['Species Clause', 'Item Clause'] }));
    const result = await validateTeam({
      format: 'gen9ou',
      ruleset_id: 'rs-1',
      team: [{ ...GARCHOMP, item: 'Choice Scarf' }, { ...legalRotomWash, item: 'choicescarf' }],
    });
    expect(result.valid).toBe(false);
    expect(result.team_issues.some((m) => /Item Clause/.test(m))).toBe(true);
    vi.mocked(readExposedRuleset).mockReset();
  });

  it.each([
    ['is not found', async (): Promise<null> => null, 'ruleset_not_found'],
    ['fails to load', async (): Promise<never> => { throw new Error('db down'); }, 'ruleset_load_failed'],
  ] as const)('a ruleset id that %s is reported, never silently replaced by weaker rules', async (_label, read, fallback) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readExposedRuleset).mockImplementation(read as never);

    const result = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-gone', team: [GARCHOMP] });

    expect(result.valid).toBe(false);
    expect(result.ruleset_source).toEqual({ kind: 'format_preset', format: 'gen9ou', fallback });
    expect(result.team_issues.some((m) => /could not be used/.test(m))).toBe(true);
    log.mockRestore();
    vi.mocked(readExposedRuleset).mockReset();
  });

  it('keeps its result shape: valid, format, issues with four fields, team_issues', async () => {
    const result = await validateTeam({ format: 'gen9ou', team: [{ species: 'Magikarp', moves: ['Hydro Pump'] }] });
    expect(Object.keys(result).sort()).toEqual(['format', 'issues', 'ruleset_source', 'team_issues', 'valid']);
    expect(Object.keys(result.issues[0]).sort()).toEqual(['issue', 'pokemon_index', 'severity', 'species']);
  });
});

describe('validateTeam through the dispatcher: never cached', () => {
  it('runs again for an identical call, so changed league state or a recovered ruleset read is seen', async () => {
    const { executeTool, __clearToolResultCache } = await import('../execute');
    __clearToolResultCache();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input = { format: 'gen9ou', ruleset_id: 'rs-1', team: [legalGarchomp] };

    // First the ruleset read fails (a transient fault), then it recovers.
    vi.mocked(readExposedRuleset).mockRejectedValueOnce(new Error('db blip'));
    vi.mocked(readExposedRuleset).mockResolvedValueOnce(buildRuleset({ base_format: 'gen9ou' }));

    const first = await executeTool('validateTeam', input);
    const second = await executeTool('validateTeam', input);

    expect(readExposedRuleset).toHaveBeenCalledTimes(2);
    expect(first.ok && first.data).toMatchObject({ valid: false, ruleset_source: { fallback: 'ruleset_load_failed' } });
    expect(second.ok && second.data).toMatchObject({ valid: true, ruleset_source: { kind: 'ruleset' } });
    expect(second.ok && second.cached).toBeFalsy();
    log.mockRestore();
    vi.mocked(readExposedRuleset).mockReset();
  });
});
