import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getPlayerTrackers: vi.fn(),
}));

vi.mock('@/lib/draft/epb-thresholds', () => ({
  getSeasonLineThresholds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));

import {
  assertNoSuspendedLinesInTeam,
  hasLineupEvidence,
  isLineBrought,
  validateEpbTeam,
  assertEpbTeamCompliant,
} from '../epb-team-validation';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import type { EvolutionTracker } from '@/types/evolution';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import { DEFAULT_BANNED_MOVES, type TeraRules } from '@/types/format-rules';

const mockGetPlayerTrackers = vi.mocked(getPlayerTrackers);
const mockGetSeasonLineThresholds = vi.mocked(getSeasonLineThresholds);
const mockGetFormatRules = vi.mocked(getFormatRules);

const GASTLY_LINE = {
  base_pokemon: 'Gastly',
  stage2_pokemon: 'Haunter',
  stage3_pokemon: 'Gengar',
  stage2_kos: 3,
  stage3_kos: 11,
};

describe('isLineBrought (registered team OR battle rows)', () => {
  it('detects evolved forms in battle stats', () => {
    expect(
      isLineBrought(GASTLY_LINE, { playerId: 'p1', registeredSpecies: null, battleStats: [{ player_id: 'p1', pokemon_name: 'Haunter' }] }, null)
    ).toBe(true);
  });

  it('counts a form in the registered team without any battle data', () => {
    expect(isLineBrought(GASTLY_LINE, { playerId: 'p1', registeredSpecies: ['Abra', 'Gengar'], battleStats: [] })).toBe(true);
  });

  it('counts the locked final stage of the line', () => {
    const branched = { ...GASTLY_LINE, stage3_pokemon: null };
    expect(isLineBrought(branched, { playerId: 'p1', registeredSpecies: ['Gengar'], battleStats: [] }, 'Gengar')).toBe(true);
    expect(isLineBrought(branched, { playerId: 'p1', registeredSpecies: ['Gengar'], battleStats: [] }, null)).toBe(false);
  });

  it('ignores the opponent’s battle rows and other species', () => {
    expect(
      isLineBrought(GASTLY_LINE, {
        playerId: 'p1',
        registeredSpecies: ['Abra'],
        battleStats: [{ player_id: 'p2', pokemon_name: 'Gastly' }, { player_id: 'p1', pokemon_name: 'Abra' }],
      })
    ).toBe(false);
  });

  it('is false with no evidence at all', () => {
    expect(isLineBrought(GASTLY_LINE, { playerId: 'p1', registeredSpecies: null, battleStats: [] })).toBe(false);
  });
});

describe('hasLineupEvidence', () => {
  it('needs a non-empty registered team or an own battle row', () => {
    expect(hasLineupEvidence({ playerId: 'p1', registeredSpecies: null, battleStats: [] })).toBe(false);
    expect(hasLineupEvidence({ playerId: 'p1', registeredSpecies: [], battleStats: [] })).toBe(false);
    expect(hasLineupEvidence({ playerId: 'p1', registeredSpecies: null, battleStats: [{ player_id: 'p2', pokemon_name: 'Abra' }] })).toBe(false);
    expect(hasLineupEvidence({ playerId: 'p1', registeredSpecies: ['Abra'], battleStats: [] })).toBe(true);
    expect(hasLineupEvidence({ playerId: 'p1', registeredSpecies: null, battleStats: [{ player_id: 'p1', pokemon_name: 'Abra' }] })).toBe(true);
  });
});

describe('assertNoSuspendedLinesInTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeasonLineThresholds.mockResolvedValue([
      {
        base_pokemon: 'Gastly',
        stage2_pokemon: 'Haunter',
        stage3_pokemon: 'Gengar',
        stage2_kos: 3,
        stage3_kos: 11,
      },
    ]);
  });

  it('rejects a final team containing a suspended line', async () => {
    mockGetPlayerTrackers.mockResolvedValue([
      {
        base_pokemon: 'Gastly',
        suspended_until_matchday: 3,
        locked_stage3_pokemon: null,
      } as EvolutionTracker,
    ]);

    await expect(
      assertNoSuspendedLinesInTeam('s1', 'p1', 3, [{ species: 'Haunter' } as never])
    ).rejects.toThrow('suspended for matchday 3');
  });

  it('allows teams when no line is suspended on the matchday', async () => {
    mockGetPlayerTrackers.mockResolvedValue([
      {
        base_pokemon: 'Gastly',
        suspended_until_matchday: 4,
        locked_stage3_pokemon: null,
      } as EvolutionTracker,
    ]);

    await expect(
      assertNoSuspendedLinesInTeam('s1', 'p1', 3, [{ species: 'Haunter' } as never])
    ).resolves.toBeUndefined();
  });
});

// ── format_rules enforcement (validateEpbTeam + async wrappers) ────────

/** Minimal valid PokemonSet for the pure core tests. */
function makeSet(overrides: Partial<PokemonSet> & { species: string }): PokemonSet {
  return {
    name: '',
    species: overrides.species,
    gender: '',
    item: overrides.item ?? '',
    ability: overrides.ability ?? '',
    evs: overrides.evs ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: overrides.ivs ?? { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: overrides.nature ?? 'Hardy',
    level: overrides.level ?? 100,
    moves: overrides.moves ?? ['Tackle'],
    tera_type: overrides.tera_type,
  };
}

/** Explicit rules for the mechanism tests (independent of the active format pack's defaults). */
const STAGE2_STAB_ONLY: TeraRules = { stage1: 'any', stage2: 'stab_only', stage3: 'any' };

/** A format_rules row that sets only the Tera rules (no bans). */
function teraOnlyRow(tera_rules: TeraRules) {
  return {
    id: 'fr1',
    season_id: 's1',
    banned_moves: [],
    banned_items: [],
    tera_rules,
    tiebreaker_order: ['match_points'],
    draft_budget: 100,
    draft_picks: 6,
    draft_token_ratio: 5,
    draft_token_max: 1,
    draft_token_max_per_line: 1,
    redraft_phase_open: false,
    created_at: '',
  } as never;
}

describe('validateEpbTeam (pure core)', () => {
  it('accepts a three-move set the editor saved with an empty fourth slot (the match-prep gate)', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', ''] })],
      { bannedMoves: ['Baton Pass'], bannedItems: [], teraRules: STAGE2_STAB_ONLY, stageByIndex: [null] },
    );

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('flags a banned move present in a set', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', moves: ['Earthquake', 'Baton Pass'] })],
      {
        bannedMoves: ['Baton Pass'],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [null],
      },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.issue.includes('Baton Pass is banned'))).toBe(true);
  });

  it('flags a banned item on a set', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', item: 'Quick Claw' })],
      {
        bannedMoves: [],
        bannedItems: ['Quick Claw'],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [null],
      },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.issue.includes('Quick Claw is banned'))).toBe(true);
  });

  it('enforces Item Clause: duplicate item across two sets is a team_issue', () => {
    const result = validateEpbTeam(
      [
        makeSet({ species: 'Garchomp', item: 'Leftovers' }),
        makeSet({ species: 'Charizard', item: 'Leftovers' }),
      ],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [null, null],
      },
    );

    expect(result.valid).toBe(false);
    expect(result.team_issues.some((m) => m.startsWith('Item Clause: duplicate Leftovers'))).toBe(true);
  });

  it('flags a stage-2 set whose tera_type is not a STAB type', () => {
    // Garchomp is Dragon/Ground; 'Fairy' is not STAB.
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Fairy' })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [2],
      },
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.issue.includes("Stage 2 STAB-only tera: Fairy is not one of Garchomp's types")),
    ).toBe(true);
  });

  it('allows a stage-2 set whose tera_type IS a STAB type', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Dragon', moves: ['Earthquake'] })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [2],
      },
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.issue.includes('STAB-only tera'))).toBe(false);
  });

  it('does not restrict a stage-1 set: any tera_type is allowed', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Fairy', moves: ['Earthquake'] })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [1],
      },
    );

    expect(result.valid).toBe(true);
  });

  it('does NOT enforce stage-3 tera at team-build (battle-runtime rule)', () => {
    // Stage 3 rule is 'none' — intentionally not enforced here.
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Fairy', moves: ['Earthquake'] })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: { ...STAGE2_STAB_ONLY, stage3: 'none' },
        stageByIndex: [3],
      },
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.issue.includes('STAB-only tera'))).toBe(false);
  });

  it('enforces a stab_only rule at any stage, with the stage-aware code off stage 2', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Fairy', moves: ['Earthquake'] })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: { stage1: 'any', stage2: 'any', stage3: 'stab_only' },
        stageByIndex: [3],
      },
    );

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === 'epb_stage_tera');
    expect(issue?.params).toMatchObject({ stage: 3, type: 'Fairy', species: 'Garchomp' });
    expect(issue?.issue).toContain("Stage 3 STAB-only tera: Fairy is not one of Garchomp's types");
  });

  it('skips the tera check for a slot with an unresolved (null) stage', () => {
    const result = validateEpbTeam(
      [makeSet({ species: 'Garchomp', tera_type: 'Fairy', moves: ['Earthquake'] })],
      {
        bannedMoves: [],
        bannedItems: [],
        teraRules: STAGE2_STAB_ONLY,
        stageByIndex: [null],
      },
    );

    expect(result.valid).toBe(true);
  });
});

describe('assertEpbTeamCompliant (async wrapper, fallbacks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeasonLineThresholds.mockResolvedValue([
      {
        base_pokemon: 'Gible',
        stage2_pokemon: 'Gabite',
        stage3_pokemon: 'Garchomp',
        stage2_kos: 3,
        stage3_kos: 11,
      },
    ]);
  });

  it('throws UserFacingError (code epb_team_invalid) when the team is invalid', async () => {
    // No format_rules row → falls back to the active format pack's DEFAULT_BANNED_MOVES.
    mockGetFormatRules.mockResolvedValue(null);
    const banned = DEFAULT_BANNED_MOVES[0];
    expect(banned).toBeTruthy();
    mockGetPlayerTrackers.mockResolvedValue([
      {
        base_pokemon: 'Gible',
        total_kos: 0,
        locked_stage3_pokemon: null,
      } as EvolutionTracker,
    ]);

    await expect(
      assertEpbTeamCompliant('s1', 'p1', [makeSet({ species: 'Garchomp', moves: [banned] })]),
    ).rejects.toMatchObject({ code: 'epb_team_invalid', statusCode: 400 });
  });

  it('resolves when the team is valid', async () => {
    mockGetFormatRules.mockResolvedValue(null);
    mockGetPlayerTrackers.mockResolvedValue([
      {
        base_pokemon: 'Gible',
        total_kos: 20, // past the stage-3 threshold → stage 3
        locked_stage3_pokemon: null,
      } as EvolutionTracker,
    ]);

    await expect(
      assertEpbTeamCompliant('s1', 'p1', [makeSet({ species: 'Garchomp', moves: ['Earthquake'] })]),
    ).resolves.toBeUndefined();
  });

  it('uses the season format_rules when present (custom banned move)', async () => {
    mockGetFormatRules.mockResolvedValue({
      id: 'fr1',
      season_id: 's1',
      banned_moves: ['Earthquake'],
      banned_items: [],
      tera_rules: STAGE2_STAB_ONLY,
      tiebreaker_order: ['match_points'],
      draft_budget: 100,
      draft_picks: 6,
      draft_token_ratio: 5,
      draft_token_max: 1,
      draft_token_max_per_line: 1,
      redraft_phase_open: false,
      created_at: '',
    } as never);
    mockGetPlayerTrackers.mockResolvedValue([
      { base_pokemon: 'Gible', total_kos: 0, locked_stage3_pokemon: null } as EvolutionTracker,
    ]);

    await expect(
      assertEpbTeamCompliant('s1', 'p1', [makeSet({ species: 'Garchomp', moves: ['Earthquake'] })]),
    ).rejects.toMatchObject({ code: 'epb_team_invalid' });
  });
});

describe('validateEpbTeamForSeason (non-throwing variant)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeasonLineThresholds.mockResolvedValue([
      {
        base_pokemon: 'Gible',
        stage2_pokemon: 'Gabite',
        stage3_pokemon: 'Garchomp',
        stage2_kos: 3,
        stage3_kos: 11,
      },
    ]);
  });

  it('returns a TeamValidationResult without throwing', async () => {
    mockGetFormatRules.mockResolvedValue(teraOnlyRow(STAGE2_STAB_ONLY));
    mockGetPlayerTrackers.mockResolvedValue([
      { base_pokemon: 'Gible', total_kos: 8, locked_stage3_pokemon: null } as EvolutionTracker,
    ]);
    // total_kos 8 → stage 2 (>= 4, < 14); Garchomp is Dragon/Ground, 'Fairy' is non-STAB.
    const { validateEpbTeamForSeason } = await import('../epb-team-validation');

    const result: TeamValidationResult = await validateEpbTeamForSeason('s1', 'p1', [
      makeSet({ species: 'Garchomp', tera_type: 'Fairy', moves: ['Earthquake'] }),
    ]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.issue.includes('STAB-only tera'))).toBe(true);
  });
});
