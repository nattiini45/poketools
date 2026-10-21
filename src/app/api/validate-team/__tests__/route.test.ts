import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
  resolveEffectiveRuleset: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getParticipantCore: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolBySeasonGroup: vi.fn(),
  getPicksByPlayer: vi.fn(),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));

// League groups: the caller's group (a league with groups only).
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn() }));

vi.mock('@/lib/pkmn/validation', () => ({
  validateTeam: vi.fn(),
}));

vi.mock('@/lib/draft/epb-team-validation', () => ({
  validateEpbTeamForSeason: vi.fn(),
}));

import { POST } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import {
  getRulesetById,
  resolveEffectiveRuleset,
} from '@/lib/supabase/queries/rulesets';
import { getSeasonById, getParticipantCore } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  getPicksByPlayer,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';
import { validateTeam } from '@/lib/pkmn/validation';
import { validateEpbTeamForSeason } from '@/lib/draft/epb-team-validation';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

// ── Fixtures ───────────────────────────────────────────────────────────

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const MISSING_RULESET_ID = '00000000-0000-4000-8000-000000009999';

const PLAYER = {
  playerId: '00000000-0000-4000-8000-000000000010',
  name: 'Test',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

const RULESET = {
  id: RULESET_ID,
  name: 'Gen 9 OU',
  base_format: 'gen9ou',
  is_doubles: false,
  clauses: [],
  bans: { pokemon: [], moves: [], abilities: [], items: [] },
  additions: { pokemon: [], moves: [], abilities: [], items: [] },
  custom_rules_string: null,
  min_shared_type_pct: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const POKEMON = [
  { species: 'Garchomp', ability: 'Rough Skin', item: 'Rocky Helmet', moves: ['Earthquake'] },
];

const VALID_RESULT = { valid: true, issues: [], team_issues: [] };

const EPB_SEASON = {
  id: SEASON_ID,
  name: 'EPB League',
  description: '',
  format_type: 'evolution_point_buy',
  ruleset_id: RULESET_ID,
  start_date: null,
  end_date: null,
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: false,
  core_pool: null,
  point_buy_list_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const NON_EPB_SEASON = { ...EPB_SEASON, id: SEASON_ID, format_type: 'draft', name: 'Draft League' };

describe('POST /api/validate-team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER as never);
    // Defaults: no tournament context, no player core, no draft picks.
    vi.mocked(getTournamentById).mockResolvedValue(null);
    vi.mocked(getSeasonById).mockResolvedValue(null);
    vi.mocked(resolveEffectiveRuleset).mockResolvedValue(null);
    vi.mocked(getParticipantCore).mockResolvedValue(null);
    vi.mocked(validateEpbTeamForSeason).mockResolvedValue(VALID_RESULT as never);
  });

  // ── Auth ──────────────────────────────────────────────────────────

  it('returns auth error when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })('Not authenticated', 401),
    );

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Not authenticated');
  });

  // ── Validation ────────────────────────────────────────────────────

  it('returns 400 when pokemon is missing', async () => {
    const res = await POST(makeRequest({ ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('pokemon');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 when ruleset_id is missing', async () => {
    const res = await POST(makeRequest({ pokemon: POKEMON }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('ruleset_id');
  });

  it('returns 404 when ruleset is not found', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(null);

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: MISSING_RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Ruleset not found');
    expect(body.code).toBe('ruleset_not_found');
  });

  // ── Happy path (no draft) ────────────────────────────────────────

  it('validates team without draft constraints', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual(VALID_RESULT);
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ playerCore: null, draftedPokemon: undefined }),
    );
  });

  // ── Happy path (with draft) ──────────────────────────────────────

  it('validates team with draft ownership constraints', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([
      { pokemon_name: 'Garchomp' } as never as never,
      { pokemon_name: 'Dragonite' } as never,
    ]);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(getDraftPoolBySeason).toHaveBeenCalledWith(SEASON_ID);
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-1', PLAYER.playerId);
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ draftedPokemon: ['Garchomp', 'Dragonite'] }),
    );
  });

  it('league groups: checks ownership against the caller’s own group’s pool', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getDraftPoolBySeason).mockRejectedValueOnce(new GroupedLeaguePoolLookupError(SEASON_ID));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValueOnce({ id: 'group-b', season_id: SEASON_ID, name: 'Group B', sort_order: 2 });
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValueOnce({ id: 'pool-b' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never]);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }));
    expect((await res.json()).success).toBe(true);
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON_ID, 'group-b', 'initial');
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-b', expect.any(String));
    expect(validateTeam).toHaveBeenCalledWith(POKEMON, RULESET, expect.objectContaining({ draftedPokemon: ['Garchomp'] }));
  });

  it('passes empty draftedPokemon when season has no draft pool', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ draftedPokemon: undefined }),
    );
  });

  // ── Tournament context: effective ruleset + playerCore ──────────

  it('resolves the effective ruleset and passes playerCore when tournament_id is provided', async () => {
    const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000020';
    const SEASON_FOR_TOURNEY = '00000000-0000-4000-8000-000000000021';
    const CUSTOM_RULESET = { ...RULESET, id: '00000000-0000-4000-8000-000000000099', name: 'Type Triangle League' };

    vi.mocked(getTournamentById).mockResolvedValue({
      id: TOURNAMENT_ID,
      ruleset_id: RULESET_ID, // incorrectly points at base; resolver should fix
      season_id: SEASON_FOR_TOURNEY,
      bracket_type: 'round_robin',
    } as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: SEASON_FOR_TOURNEY,
      name: 'Type Triangle League',
      ruleset_id: RULESET_ID,
    } as never);
    vi.mocked(resolveEffectiveRuleset).mockResolvedValue({
      ruleset: CUSTOM_RULESET as never,
      rulesetId: CUSTOM_RULESET.id,
      source: 'name-match',
      fellBack: false,
    });
    vi.mocked(getParticipantCore).mockResolvedValue(
      ['Fire', 'Water', 'Grass'] as never,
    );
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({
        pokemon: POKEMON,
        ruleset_id: RULESET_ID,
        tournament_id: TOURNAMENT_ID,
      }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);

    // The resolver MUST have been called with the tournament + season context.
    expect(resolveEffectiveRuleset).toHaveBeenCalledWith(
      expect.objectContaining({
        tournamentRulesetId: RULESET_ID,
        tournamentBracketType: 'round_robin',
        season: expect.objectContaining({ id: SEASON_FOR_TOURNEY }),
      }),
    );

    // The validator MUST receive the custom ruleset + the player's core triple.
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      CUSTOM_RULESET,
      expect.objectContaining({
        playerCore: ['Fire', 'Water', 'Grass'],
        draftedPokemon: undefined,
      }),
    );

    // Never trust the caller's stale ruleset_id alone — must NOT call
    // getRulesetById for the raw id when tournament_id is present.
    expect(getRulesetById).not.toHaveBeenCalled();
  });

  it('does NOT call resolveEffectiveRuleset and passes playerCore=null when only season_id is provided', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(resolveEffectiveRuleset).not.toHaveBeenCalled();
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ playerCore: null }),
    );
  });

  // ── EPB format_rules enforcement ──────────────────────────────────

  it('EPB season: merges a banned-move EPB issue and marks the team invalid', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getSeasonById).mockResolvedValue(EPB_SEASON as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);
    const bannedMoveIssue = {
      pokemon_index: 0,
      species: 'Garchomp',
      issue: 'Baton Pass is banned by the season format rules',
      severity: 'error',
    };
    vi.mocked(validateEpbTeamForSeason).mockResolvedValue({
      valid: false,
      issues: [bannedMoveIssue],
      team_issues: [],
    } as never);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(false);
    expect(body.data.issues.some((i: { issue: string }) => i.issue.includes('Baton Pass is banned'))).toBe(true);
    expect(validateEpbTeamForSeason).toHaveBeenCalledWith(SEASON_ID, PLAYER.playerId, POKEMON);
  });

  it('EPB season: merges coded team issues, deduped by text and aligned with team_issues', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getSeasonById).mockResolvedValue(EPB_SEASON as never);
    const clause = {
      issue: 'Item Clause: duplicate Leftovers (slots 1 and 2)',
      code: 'item_clause',
      params: { item: 'Leftovers', slotA: 1, slotB: 2 },
    };
    vi.mocked(validateTeam).mockReturnValue({
      valid: false,
      issues: [],
      team_issues: [clause.issue],
      team_issue_details: [clause],
    } as never);
    // An older producer without details: its string is kept without a code.
    vi.mocked(validateEpbTeamForSeason).mockResolvedValue({
      valid: false,
      issues: [],
      team_issues: [clause.issue, 'Legacy team issue'],
    } as never);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.data.team_issues).toEqual([clause.issue, 'Legacy team issue']);
    expect(body.data.team_issue_details).toEqual([clause, { issue: 'Legacy team issue' }]);
  });

  it('EPB season: team is valid when both core and EPB validators are clean', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getSeasonById).mockResolvedValue(EPB_SEASON as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);
    vi.mocked(validateEpbTeamForSeason).mockResolvedValue(VALID_RESULT as never);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.issues).toEqual([]);
    expect(body.data.team_issues).toEqual([]);
  });

  it('non-EPB season: does NOT call validateEpbTeamForSeason and returns the core result unchanged', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
    vi.mocked(getSeasonById).mockResolvedValue(NON_EPB_SEASON as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual(VALID_RESULT);
    expect(validateEpbTeamForSeason).not.toHaveBeenCalled();
  });

  it('tournament with no season: does NOT fall back to a client-supplied season_id for EPB enforcement', async () => {
    // Regression: under tournament context the EPB branch must use ONLY the
    // tournament-resolved season (tournamentBranchSeason). When the tournament
    // has no season, EPB enforcement must be skipped entirely — even if the
    // client supplies a conflicting season_id that would otherwise resolve to
    // an EPB season. The result is the core validateTeam result, unmerged.
    const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000030';
    const CLIENT_SEASON_ID = '00000000-0000-4000-8000-000000000031';

    // Tournament exists but has NO season → tournamentBranchSeason is null.
    vi.mocked(getTournamentById).mockResolvedValue({
      id: TOURNAMENT_ID,
      ruleset_id: RULESET_ID,
      season_id: null,
      bracket_type: 'round_robin',
    } as never);
    // The client-supplied season_id resolves to an EPB season. The OLD code
    // would fetch this via the resolvedSeasonId fallback and apply EPB rules.
    vi.mocked(getSeasonById).mockResolvedValue(EPB_SEASON as never);
    vi.mocked(resolveEffectiveRuleset).mockResolvedValue({
      ruleset: RULESET as never,
      rulesetId: RULESET_ID,
      source: 'tournament',
      fellBack: false,
    });
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({
        pokemon: POKEMON,
        ruleset_id: RULESET_ID,
        tournament_id: TOURNAMENT_ID,
        season_id: CLIENT_SEASON_ID, // conflicting client-chosen season
      }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    // Core result returned unchanged — no EPB merge.
    expect(body.data).toEqual(VALID_RESULT);
    // EPB enforcement must NOT have run for the client-supplied season.
    expect(validateEpbTeamForSeason).not.toHaveBeenCalled();
  });

  // ── Error path ────────────────────────────────────────────────────

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getRulesetById).mockRejectedValue(new Error('DB down'));

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to validate team');
  });
});
