import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PokemonSet, StatSpread } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';

// ── Mocks ─────────��────────────────────────────────────────────────

vi.mock('../dex', () => ({
  getSpecies: vi.fn(),
  getMove: vi.fn(),
  getItem: vi.fn(),
  getAbility: vi.fn(),
}));

import { getSpecies, getMove, getItem, getAbility } from '../dex';
import { validateTeam, validateDraftOwnership } from '../validation';

// ── Helpers ────────────────────────────────────────────────────────

const DEFAULT_EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function makePokemonSet(overrides?: Partial<PokemonSet>): PokemonSet {
  return {
    name: '',
    species: 'Garchomp',
    gender: '',
    item: 'Leftovers',
    ability: 'Rough Skin',
    evs: { ...DEFAULT_EVS, hp: 252, spe: 252, atk: 4 },
    ivs: { ...DEFAULT_IVS },
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot'],
    ...overrides,
  };
}

function makeRuleset(overrides?: Partial<Ruleset>): Ruleset {
  return {
    id: 'ruleset-1',
    name: 'Gen 9 OU',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: ['Species Clause'],
    bans: {
      pokemon: [],
      moves: [],
      items: [],
      abilities: [],
    },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

function setupDexMocks() {
  vi.mocked(getSpecies).mockImplementation(((name: string) => {
    const species: Record<string, { name: string; types: string[]; baseSpecies?: string }> = {
      'Garchomp': { name: 'Garchomp', types: ['Dragon', 'Ground'] },
      'Tyranitar': { name: 'Tyranitar', types: ['Rock', 'Dark'] },
      'Dragonite': { name: 'Dragonite', types: ['Dragon', 'Flying'] },
      'Rotom-Wash': { name: 'Rotom-Wash', types: ['Electric', 'Water'], baseSpecies: 'Rotom' },
      'Rotom-Heat': { name: 'Rotom-Heat', types: ['Electric', 'Fire'], baseSpecies: 'Rotom' },
      'Pikachu': { name: 'Pikachu', types: ['Electric'] },
      'Charizard': { name: 'Charizard', types: ['Fire', 'Flying'] },
    };
    return species[name] ?? undefined;
  }) as typeof getSpecies);

  vi.mocked(getMove).mockImplementation(((name: string) => {
    const moves: Record<string, { name: string }> = {
      'Earthquake': { name: 'Earthquake' },
      'Dragon Claw': { name: 'Dragon Claw' },
      'Swords Dance': { name: 'Swords Dance' },
      'Scale Shot': { name: 'Scale Shot' },
      'Stealth Rock': { name: 'Stealth Rock' },
      'Baton Pass': { name: 'Baton Pass' },
    };
    return moves[name] ?? undefined;
  }) as typeof getMove);

  vi.mocked(getItem).mockImplementation(((name: string) => {
    const items: Record<string, { name: string }> = {
      'Leftovers': { name: 'Leftovers' },
      'Choice Band': { name: 'Choice Band' },
      'Focus Sash': { name: 'Focus Sash' },
    };
    return items[name] ?? undefined;
  }) as typeof getItem);

  vi.mocked(getAbility).mockImplementation(((name: string) => {
    const abilities: Record<string, { name: string }> = {
      'Rough Skin': { name: 'Rough Skin' },
      'Sand Stream': { name: 'Sand Stream' },
      'Multiscale': { name: 'Multiscale' },
      'Moody': { name: 'Moody' },
    };
    return abilities[name] ?? undefined;
  }) as typeof getAbility);
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setupDexMocks();
});

describe('validateDraftOwnership', () => {
  it('returns empty issues when all pokemon are in roster', () => {
    const pokemon = [makePokemonSet({ species: 'Garchomp' }), makePokemonSet({ species: 'Tyranitar' })];
    const result = validateDraftOwnership(pokemon, ['Garchomp', 'Tyranitar', 'Dragonite']);
    expect(result).toEqual([]);
  });

  it('returns issue for pokemon not in draft roster', () => {
    const pokemon = [makePokemonSet({ species: 'Garchomp' }), makePokemonSet({ species: 'Pikachu' })];
    const result = validateDraftOwnership(pokemon, ['Garchomp', 'Tyranitar']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Pikachu');
    expect(result[0]).toContain('not in your draft roster');
  });

  it('performs case-insensitive matching', () => {
    const pokemon = [makePokemonSet({ species: 'Garchomp' })];
    const result = validateDraftOwnership(pokemon, ['garchomp']);
    expect(result).toEqual([]);
  });
});

describe('validateTeam', () => {
  it('returns valid for a legal team', () => {
    const team = [makePokemonSet()];
    const result = validateTeam(team, makeRuleset());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.team_issues).toEqual([]);
  });

  it('rejects empty team', () => {
    const result = validateTeam([], makeRuleset());
    expect(result.valid).toBe(false);
    expect(result.team_issues).toContain('Team must have at least 1 Pokémon');
  });

  it('flags team with more than 6 pokemon', () => {
    const team = Array.from({ length: 7 }, () => makePokemonSet());
    const result = validateTeam(team, makeRuleset());
    expect(result.team_issues.some((i) => i.includes('more than 6'))).toBe(true);
  });

  it('flags unknown species', () => {
    vi.mocked(getSpecies).mockReturnValueOnce(null as never);
    const team = [makePokemonSet({ species: 'FakeMon' })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issue).toContain('Unknown species');
  });

  it('flags banned pokemon', () => {
    const ruleset = makeRuleset({ bans: { pokemon: ['Garchomp'], moves: [], items: [], abilities: [] } });
    const team = [makePokemonSet({ species: 'Garchomp' })];
    const result = validateTeam(team, ruleset);
    expect(result.issues.some((i) => i.issue.includes('banned'))).toBe(true);
  });

  it('flags pokemon with no moves', () => {
    const team = [makePokemonSet({ moves: [] })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues.some((i) => i.issue.includes('at least 1 move'))).toBe(true);
  });

  it('flags pokemon with more than 4 moves', () => {
    const team = [makePokemonSet({ moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot', 'Stealth Rock'] })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues.some((i) => i.issue.includes('more than 4'))).toBe(true);
  });

  it('flags unknown moves', () => {
    vi.mocked(getMove).mockReturnValue(null as never);
    const team = [makePokemonSet({ moves: ['FakeMove'] })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues.some((i) => i.issue.includes('Unknown move'))).toBe(true);
  });

  it('flags banned moves', () => {
    const ruleset = makeRuleset({ bans: { pokemon: [], moves: ['Baton Pass'], items: [], abilities: [] } });
    const team = [makePokemonSet({ moves: ['Baton Pass'] })];
    const result = validateTeam(team, ruleset);
    expect(result.issues.some((i) => i.issue.includes('banned'))).toBe(true);
  });

  it('flags unknown items as warning', () => {
    vi.mocked(getItem).mockReturnValueOnce(null as never);
    const team = [makePokemonSet({ item: 'FakeItem' })];
    const result = validateTeam(team, makeRuleset());
    const itemIssue = result.issues.find((i) => i.issue.includes('Unknown item'));
    expect(itemIssue).toBeDefined();
    expect(itemIssue!.severity).toBe('warning');
  });

  it('flags banned items', () => {
    const ruleset = makeRuleset({ bans: { pokemon: [], moves: [], items: ['Focus Sash'], abilities: [] } });
    const team = [makePokemonSet({ item: 'Focus Sash' })];
    const result = validateTeam(team, ruleset);
    expect(result.issues.some((i) => i.issue.includes('banned'))).toBe(true);
  });

  it('flags unknown abilities as warning', () => {
    vi.mocked(getAbility).mockReturnValueOnce(null as never);
    const team = [makePokemonSet({ ability: 'FakeAbility' })];
    const result = validateTeam(team, makeRuleset());
    const abilityIssue = result.issues.find((i) => i.issue.includes('Unknown ability'));
    expect(abilityIssue).toBeDefined();
    expect(abilityIssue!.severity).toBe('warning');
  });

  it('flags banned abilities', () => {
    const ruleset = makeRuleset({ bans: { pokemon: [], moves: [], items: [], abilities: ['Moody'] } });
    const team = [makePokemonSet({ ability: 'Moody' })];
    const result = validateTeam(team, ruleset);
    expect(result.issues.some((i) => i.issue.includes('banned'))).toBe(true);
  });

  it('flags EV total exceeding 510', () => {
    const team = [makePokemonSet({
      evs: { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 },
    })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues.some((i) => i.issue.includes('exceeds 510'))).toBe(true);
  });

  it('flags individual EV exceeding 252', () => {
    const team = [makePokemonSet({
      evs: { hp: 300, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    })];
    const result = validateTeam(team, makeRuleset());
    expect(result.issues.some((i) => i.issue.includes('exceed 252'))).toBe(true);
  });

  it('enforces Species Clause', () => {
    const team = [
      makePokemonSet({ species: 'Garchomp' }),
      makePokemonSet({ species: 'Garchomp' }),
    ];
    const ruleset = makeRuleset({ clauses: ['Species Clause'] });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues.some((i) => i.includes('Species Clause'))).toBe(true);
  });

  it('Species Clause catches same base species (Rotom forms)', () => {
    const team = [
      makePokemonSet({ species: 'Rotom-Wash' }),
      makePokemonSet({ species: 'Rotom-Heat' }),
    ];
    const ruleset = makeRuleset({ clauses: ['Species Clause'] });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues.some((i) => i.includes('Species Clause') && i.includes('Rotom'))).toBe(true);
  });

  it('enforces Item Clause', () => {
    const team = [
      makePokemonSet({ species: 'Garchomp', item: 'Leftovers' }),
      makePokemonSet({ species: 'Tyranitar', item: 'Leftovers' }),
    ];
    const ruleset = makeRuleset({ clauses: ['Item Clause'] });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues.some((i) => i.includes('Item Clause'))).toBe(true);
  });

  it('does not enforce Item Clause when clause not present', () => {
    const team = [
      makePokemonSet({ species: 'Garchomp', item: 'Leftovers' }),
      makePokemonSet({ species: 'Tyranitar', item: 'Leftovers' }),
    ];
    const ruleset = makeRuleset({ clauses: [] });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues).toEqual([]);
  });

  it('enforces min_shared_type_pct', () => {
    // 2 pokemon, 100% must share a type. They don't.
    const team = [
      makePokemonSet({ species: 'Garchomp' }),   // Dragon/Ground
      makePokemonSet({ species: 'Pikachu' }),     // Electric
    ];
    const ruleset = makeRuleset({ min_shared_type_pct: 100 });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues.some((i) => i.includes('Shared Type'))).toBe(true);
  });

  it('passes min_shared_type_pct when types match', () => {
    // Both have Dragon type
    const team = [
      makePokemonSet({ species: 'Garchomp' }),    // Dragon/Ground
      makePokemonSet({ species: 'Dragonite' }),   // Dragon/Flying
    ];
    const ruleset = makeRuleset({ min_shared_type_pct: 100 });
    const result = validateTeam(team, ruleset);
    expect(result.team_issues.filter((i) => i.includes('Shared Type'))).toEqual([]);
  });

  it('enforces draft ownership when provided', () => {
    const team = [
      makePokemonSet({ species: 'Garchomp' }),
      makePokemonSet({ species: 'Pikachu' }),
    ];
    const result = validateTeam(team, makeRuleset(), ['Garchomp', 'Tyranitar']);
    expect(result.team_issues.some((i) => i.includes('Pikachu') && i.includes('draft roster'))).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('overall valid is false if any error-severity issue exists', () => {
    const ruleset = makeRuleset({ bans: { pokemon: ['Garchomp'], moves: [], items: [], abilities: [] } });
    const team = [makePokemonSet({ species: 'Garchomp' })];
    const result = validateTeam(team, ruleset);
    expect(result.valid).toBe(false);
  });

  it('overall valid is true if only warning-severity issues', () => {
    vi.mocked(getItem).mockReturnValueOnce(undefined); // unknown item = warning
    const team = [makePokemonSet({ item: 'Mystery Item' })];
    const result = validateTeam(team, makeRuleset());
    expect(result.valid).toBe(true);
  });
});
