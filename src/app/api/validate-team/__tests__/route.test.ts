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

// The phase's pin is read by id; an id from the request is read through the exposure check.
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

vi.mock('@/lib/ruleset-studio/exposure', () => ({
  readExposedRuleset: vi.fn(),
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

// The route runs the shared check (`checkTeam`); its leaves are faked here: the synchronous core, the learnset layer
// and the Evolution Point Buy reads. The pipeline itself is pinned in `src/lib/team/__tests__/check.test.ts`.
vi.mock('@/lib/pkmn/validation', () => ({
  validateTeam: vi.fn(),
  codedIssue: (code: string, params?: Record<string, unknown>) => (params ? { code, params } : { code }),
}));

vi.mock('@/lib/pkmn/team-legality', () => ({
  checkTeamLegality: vi.fn(async () => []),
}));

vi.mock('@/lib/draft/epb-team-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/draft/epb-team-validation')>()),
  validateEpbTeamForSeason: vi.fn(),
  loadEpbSeasonState: vi.fn(async () => ({ formatRules: null, trackers: [], lines: [] })),
}));

import { POST } from '../route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
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
  {
    name: '',
    species: 'Garchomp',
    gender: '',
    item: 'Rocky Helmet',
    ability: 'Rough Skin',
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake'],
  },
];

const VALID_RESULT = { valid: true, issues: [], team_issues: [] };
/** What the route answers for a clean check against a stored ruleset. */
const VALID_ANSWER = { ...VALID_RESULT, team_issue_details: [], ruleset_source: { kind: 'ruleset' } };

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
    vi.mocked(getRulesetById).mockResolvedValue(null);
    vi.mocked(readExposedRuleset).mockResolvedValue(null);
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

  // ── Shape of the team (#51): a coded 400, never a 500 ───────────────

  const MALFORMED: [string, unknown][] = [
    ['a set without evs', [{ ...POKEMON[0], evs: undefined }]],
    ['a set without moves', [{ ...POKEMON[0], moves: undefined }]],
    ['a negative EV', [{ ...POKEMON[0], evs: { ...POKEMON[0].evs, hp: -760 } }]],
    ['an EV above 252', [{ ...POKEMON[0], evs: { ...POKEMON[0].evs, atk: 253 } }]],
    ['an IV above 31', [{ ...POKEMON[0], ivs: { ...POKEMON[0].ivs, spe: 32 } }]],
    ['level 0', [{ ...POKEMON[0], level: 0 }]],
    ['level 101', [{ ...POKEMON[0], level: 101 }]],
    ['five moves', [{ ...POKEMON[0], moves: ['a', 'b', 'c', 'd', 'e'] }]],
    ['a species of 101 characters', [{ ...POKEMON[0], species: 'x'.repeat(101) }]],
    ['a move that is not text', [{ ...POKEMON[0], moves: [42] }]],
    ['a set that is null', [null]],
    ['a set that is a string', ['Garchomp']],
    ['pokemon that is not a list', { species: 'Garchomp' }],
    ['an empty team', []],
    ['seven sets', Array.from({ length: 7 }, () => POKEMON[0])],
  ];

  it.each(MALFORMED)('answers 400 validation_failed for %s, and never reaches a validator', async (_label, pokemon) => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);

    const res = await POST(makeRequest({ pokemon, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(validateTeam).not.toHaveBeenCalled();
  });

  it('accepts what the teambuilder sends: a set under construction (no moves, empty strings, no nature)', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);
    const blank = { ...POKEMON[0], item: '', ability: '', nature: '', moves: [], gender: '', name: '' };

    const res = await POST(makeRequest({ pokemon: [blank], ruleset_id: RULESET_ID }));

    expect(res.status).toBe(200);
    expect(validateTeam).toHaveBeenCalledWith([blank], RULESET, expect.anything());
  });

  it('returns 404 when ruleset is not found', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(null);

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: MISSING_RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Ruleset not found');
    expect(body.code).toBe('ruleset_not_found');
  });

  // ── Happy path (no draft) ────────────────────────────────────────

  it('validates team without draft constraints', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual(VALID_ANSWER);
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ playerCore: null, draftedPokemon: undefined }),
    );
  });

  // ── Happy path (with draft) ──────────────────────────────────────

  it('validates team with draft ownership constraints', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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

  it('follows a pin that was moved: the next check reads the new version, the old one is not read again', async () => {
    const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000030';
    const V1 = { ...RULESET, id: '00000000-0000-4000-8000-0000000000a1', name: 'Spring OU' };
    const V2 = { ...RULESET, id: '00000000-0000-4000-8000-0000000000a2', name: 'Spring OU' };
    const tournament = { id: TOURNAMENT_ID, ruleset_id: V1.id, season_id: null, bracket_type: 'round_robin' };
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getRulesetById).mockImplementation((async (id: string) => [V1, V2].find((v) => v.id === id) ?? null) as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, tournament_id: TOURNAMENT_ID }));
    expect(validateTeam).toHaveBeenLastCalledWith(POKEMON, V1, expect.anything());

    // The pins route moves the phase to the next version; nothing else changes.
    vi.mocked(getTournamentById).mockResolvedValue({ ...tournament, ruleset_id: V2.id } as never);
    vi.mocked(getRulesetById).mockClear();
    await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, tournament_id: TOURNAMENT_ID }));
    expect(validateTeam).toHaveBeenLastCalledWith(POKEMON, V2, expect.anything());
    expect(getRulesetById).toHaveBeenCalledTimes(1);
    expect(getRulesetById).toHaveBeenCalledWith(V2.id);
  });

  it('enforces the phase\'s pinned ruleset and passes playerCore when tournament_id is provided', async () => {
    const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000020';
    const SEASON_FOR_TOURNEY = '00000000-0000-4000-8000-000000000021';
    const CUSTOM_RULESET = { ...RULESET, id: '00000000-0000-4000-8000-000000000099', name: 'Sample Custom League' };

    vi.mocked(getTournamentById).mockResolvedValue({
      id: TOURNAMENT_ID,
      ruleset_id: CUSTOM_RULESET.id, // the phase's pin: an immutable ruleset version
      season_id: SEASON_FOR_TOURNEY,
      bracket_type: 'round_robin',
    } as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: SEASON_FOR_TOURNEY,
      name: 'Sample Custom League',
      ruleset_id: RULESET_ID,
    } as never);
    vi.mocked(getRulesetById).mockResolvedValue(CUSTOM_RULESET as never);
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

    // The phase's own pin is what is read.
    expect(getRulesetById).toHaveBeenCalledWith(CUSTOM_RULESET.id);

    // The validator MUST receive the custom ruleset + the player's core triple.
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      CUSTOM_RULESET,
      expect.objectContaining({
        playerCore: ['Fire', 'Water', 'Grass'],
        draftedPokemon: undefined,
      }),
    );

    // Never trust the caller's ruleset_id when tournament_id is present.
    expect(readExposedRuleset).not.toHaveBeenCalled();
  });

  it('reads the requested ruleset (exposure checked) and passes playerCore=null when only season_id is provided', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(getRulesetById).not.toHaveBeenCalled();
    expect(validateTeam).toHaveBeenCalledWith(
      POKEMON,
      RULESET,
      expect.objectContaining({ playerCore: null }),
    );
  });

  // ── EPB format_rules enforcement ──────────────────────────────────

  it('EPB season: merges a banned-move EPB issue and marks the team invalid', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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
    expect(validateEpbTeamForSeason).toHaveBeenCalledWith(SEASON_ID, PLAYER.playerId, POKEMON, expect.anything());
  });

  it('EPB season: merges coded team issues, deduped by text and aligned with team_issues', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
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
    vi.mocked(readExposedRuleset).mockResolvedValue(RULESET as never);
    vi.mocked(getSeasonById).mockResolvedValue(NON_EPB_SEASON as never);
    vi.mocked(validateTeam).mockReturnValue(VALID_RESULT);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, season_id: SEASON_ID }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual(VALID_ANSWER);
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
    vi.mocked(getRulesetById).mockResolvedValue(RULESET as never);
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
    expect(body.data).toEqual(VALID_ANSWER);
    // EPB enforcement must NOT have run for the client-supplied season.
    expect(validateEpbTeamForSeason).not.toHaveBeenCalled();
  });

  it('answers 404 tournament_not_found for an unknown tournament_id (never validates against another ruleset)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID, tournament_id: '00000000-0000-4000-8000-000000000077' }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('tournament_not_found');
    expect(readExposedRuleset).not.toHaveBeenCalled();
    expect(validateTeam).not.toHaveBeenCalled();
  });

  // ── Error path ────────────────────────────────────────────────────

  it('returns 500 on unexpected error', async () => {
    vi.mocked(readExposedRuleset).mockRejectedValue(new Error('DB down'));

    const res = await POST(makeRequest({ pokemon: POKEMON, ruleset_id: RULESET_ID }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to validate team');
  });
});
