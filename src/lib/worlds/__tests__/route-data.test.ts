/**
 * C-091: the generic, format-flexed world data contract.
 *
 * `assembleWorldRouteData` is the pure core every format flows through, so the
 * per-format behavior is unit-testable without a database: singles, doubles
 * and draft resolve the sakura world with `rosterLines: null` (the painters'
 * participant fallback), evolution_point_buy keeps the point-buy lines 1:1,
 * and a standalone tournament (`league: null`) assembles with the stage's
 * ruleset. `buildWorldRouteData` is the fetch fan-out over the EXISTING query
 * modules — mocked here, never re-implemented. (Payload parity with the
 * pre-D36 implementation and the query budget are proven against an
 * in-memory PostgREST in `route-data-golden.test.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonParticipant, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import type { EvolutionTracker } from '@/types/evolution';
import type { DraftPool } from '@/types/draft';
import type { Team, PokemonSet } from '@/types/team';
import type { LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { WorldRouteDataInput } from '@/lib/worlds/route-data';

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: vi.fn(),
  getPublicSeasonParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/league-standings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/league-standings')>();
  return { assembleLeagueSchedule: vi.fn(), toLeagueScheduleGroups: actual.toLeagueScheduleGroups };
});
vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroups: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournamentIds: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolsBySeason: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  listSeasonTeamLeadsWithFacts: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
  getTeamByShareToken: vi.fn(),
}));

import {
  assembleWorldRouteData,
  buildWorldRouteData,
  deriveRosterTiles,
  deriveTeamAcesFromLeads,
  teamToLead,
} from '@/lib/worlds/route-data';
import { getSeasonWithDetails, getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { assembleLeagueSchedule } from '@/lib/supabase/queries/league-standings';
import { getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import {
  getTeamVisibilityFacts,
  listSeasonTeamLeadsWithFacts,
  type TeamLead,
  type TeamVisibilityFacts,
} from '@/lib/supabase/queries/teams';

// ── Row factories (strict: full literals + Partial overrides) ─────────

const ISO = '2026-09-01T12:00:00.000Z';

function makeLeague(overrides: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: 'season-1',
    name: 'Test Liga',
    description: '',
    format_type: 'evolution_point_buy',
    ruleset_id: 'ruleset-1',
    start_date: null,
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: 'list-1',
    language: 'de',
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'EvoLiga Standard',
    participant_count: 2,
    tournament_count: 1,
    ...overrides,
  };
}

function makeStage(overrides: Partial<TournamentWithDetails> = {}): TournamentWithDetails {
  return {
    id: 'stage-1',
    name: 'Hinrunde',
    description: '',
    season_id: 'season-1',
    bracket_type: 'round_robin',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: 0,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    ruleset_name: 'Bühnen-Regelwerk',
    season_name: 'Test Liga',
    participant_count: 2,
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<SeasonParticipant> = {}): SeasonParticipant {
  return {
    id: 'player-1',
    name: 'Mara Feldkamp',
    discord_id: null,
    auth_user_id: null,
    ps_username: 'mara',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: ISO,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: ISO,
    updated_at: ISO,
    gym_type: 'Fire',
    core_types: null,
    core_assigned_at: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const entry: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: 'line-1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price: 27,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'premium',
    early_rating: 4,
    mid_rating: 3,
    late_rating: 5,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  };
  return { ...entry, line_id: lineIdOfEntry(entry) };
}

function makeStanding(overrides: Partial<LeagueStanding> = {}): LeagueStanding {
  return {
    player_id: 'player-1',
    player_name: 'Mara Feldkamp',
    player_avatar_url: null,
    gym_type: 'Fire',
    wins: 2,
    losses: 1,
    draws: 0,
    points: 6,
    buchholz: 0,
    games_played: 9,
    kill_differential: 4,
    eliminated: false,
    rank_change: null,
    ...overrides,
  };
}

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 'season-1',
    player_id: 'player-1',
    base_pokemon: 'Charmander',
    current_form: 'Charmeleon',
    total_kos: 3,
    current_stage: 2,
    evolved_at: ISO,
    created_at: ISO,
    updated_at: ISO,
    real_kills: 3,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 1,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

function makeSet(species: string): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Serious',
    level: 100,
    moves: [],
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    player_id: 'player-1',
    name: '',
    tournament_id: null,
    season_id: 'season-1',
    match_id: null,
    pokemon: [makeSet('Charizard')],
    import_source: 'manual',
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

const DRAFT_POOL: DraftPool = {
  id: 'pool-1',
  season_id: 'season-1',
  draft_type: 'snake',
  pick_order: 'snake',
  point_budget: null,
  pool_mode: 'tier',
  default_point_cost: null,
  team_size_mode: null,
  team_size_exact: null,
  team_size_min: null,
  team_size_max: null,
  status: 'pending',
  created_at: ISO,
  updated_at: ISO,
  engine: 'legacy',
  kind: 'initial',
  mode: 'live',
  phase: 'setup',
  list_version_id: null,
  parent_pool_id: null,
  roster_size: null,
  pick_seconds: null,
  makeup_seconds: null,
  slow_ladder_seconds: [],
  extension_seconds: [],
  extensions_enabled: true,
  redraft_max_lines: null,
  redraft_lock_no_redraft_lines: true,
  submission_deadline_at: null,
  submissions_published_at: null,
  token_purchase_closes_at: null,
  paused_at: null,
  paused_by: null,
  pause_reason: null,
  state_version: 0,
  publish_notified_at: null,
  started_at: null,
  ended_at: null,
  created_by: null,
};

/** Baseline input for `assembleWorldRouteData` — EPB unless overridden. */
function makeInput(overrides: Partial<WorldRouteDataInput> = {}): WorldRouteDataInput {
  return {
    league: makeLeague(),
    stages: [makeStage()],
    participants: [makeParticipant()],
    rosterLines: [makeEntry()],
    trackers: [makeTracker()],
    standings: [makeStanding()],
    fixtures: [],
    formatRules: null,
    hasDraftPool: false,
    teamLeads: [],
    ...overrides,
  };
}

// ── assembleWorldRouteData: per-format resolution ─────────────────────

describe('assembleWorldRouteData (per format)', () => {
  it.each(['singles', 'doubles', 'draft'] as const)(
    '%s resolves the sakura world and nulls rosterLines',
    (format) => {
      const data = assembleWorldRouteData(
        makeInput({
          league: makeLeague({ format_type: format, point_buy_list_id: null }),
          rosterLines: [makeEntry()],
        }),
      );

      expect(data.format).toBe(format);
      expect(data.world.id).toBe('sakura');
      // The capability gate wins even when list rows were supplied.
      expect(data.rosterLines).toBeNull();
    },
  );

  it('evolution_point_buy resolves the evoliga world and keeps the point-buy lines', () => {
    const entry = makeEntry();
    const data = assembleWorldRouteData(makeInput({ rosterLines: [entry] }));

    expect(data.format).toBe('evolution_point_buy');
    expect(data.world.id).toBe('evoliga');
    expect(data.rosterLines).toEqual([entry]);
  });

  it('an explicit format override beats the season row (and re-gates the roster)', () => {
    const data = assembleWorldRouteData(makeInput({ format: 'draft' }));

    expect(data.format).toBe('draft');
    expect(data.world.id).toBe('sakura');
    expect(data.rosterLines).toBeNull();
  });

  it('a standalone tournament (league null) defaults to singles on the sakura world', () => {
    const data = assembleWorldRouteData(
      makeInput({ league: null, rosterLines: null, stages: [makeStage()] }),
    );

    expect(data.league).toBeNull();
    expect(data.format).toBe('singles');
    expect(data.world.id).toBe('sakura');
  });

  it('rulesetName prefers the league row, then the first stage, then null', () => {
    const fromLeague = assembleWorldRouteData(
      makeInput({
        league: makeLeague({ ruleset_name: 'Liga-Regelwerk' }),
        stages: [makeStage({ ruleset_name: 'Bühnen-Regelwerk' })],
      }),
    );
    expect(fromLeague.rulesetName).toBe('Liga-Regelwerk');

    const fromStage = assembleWorldRouteData(
      makeInput({
        league: null,
        rosterLines: null,
        stages: [makeStage({ ruleset_name: 'Bühnen-Regelwerk' })],
      }),
    );
    expect(fromStage.rulesetName).toBe('Bühnen-Regelwerk');

    const neither = assembleWorldRouteData(
      makeInput({ league: null, rosterLines: null, stages: [] }),
    );
    expect(neither.rulesetName).toBeNull();
  });

  it('the contract stays JSON-serializable (RSC props cross as plain data)', () => {
    const data = assembleWorldRouteData(makeInput());
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

// ── deriveTeamAces (full teams through teamToLead) ────────────────────

/** The full-team ace derivation: every full team crosses `teamToLead` first, as the route preview does. */
function deriveTeamAces(teams: Team[]): Record<string, string> {
  return deriveTeamAcesFromLeads(teams.map(teamToLead));
}

describe('deriveTeamAces', () => {
  it("takes the first set's species of each player's most recently updated team", () => {
    const aces = deriveTeamAces([
      makeTeam({ id: 'team-old', updated_at: '2026-09-01T00:00:00.000Z' }),
      makeTeam({
        id: 'team-new',
        updated_at: '2026-09-02T00:00:00.000Z',
        pokemon: [makeSet('Venusaur'), makeSet('Charizard')],
      }),
    ]);

    expect(aces).toEqual({ 'player-1': 'Venusaur' });
  });

  it('breaks updated_at ties by the greater team id, independent of input order', () => {
    const bFirst = deriveTeamAces([
      makeTeam({ id: 'team-b', pokemon: [makeSet('Blastoise')] }),
      makeTeam({ id: 'team-a', pokemon: [makeSet('Venusaur')] }),
    ]);
    const aFirst = deriveTeamAces([
      makeTeam({ id: 'team-a', pokemon: [makeSet('Venusaur')] }),
      makeTeam({ id: 'team-b', pokemon: [makeSet('Blastoise')] }),
    ]);

    expect(bFirst).toEqual(aFirst);
    expect(aFirst).toEqual({ 'player-1': 'Blastoise' });
  });

  it('ignores teams without sets and players without teams', () => {
    const aces = deriveTeamAces([
      makeTeam({ id: 'team-empty', player_id: 'player-1', pokemon: [] }),
      makeTeam({ id: 'team-2', player_id: 'player-2', pokemon: [makeSet('Pikachu')] }),
    ]);

    expect(aces).toEqual({ 'player-2': 'Pikachu' });
  });
});

// ── deriveTeamAcesFromLeads: the narrow (lead-species) read ──────────

describe('deriveTeamAcesFromLeads', () => {
  function lead(overrides: Partial<TeamLead> = {}): TeamLead {
    return { id: 'team-1', player_id: 'player-1', updated_at: ISO, lead_species: 'Charizard', ...overrides };
  }

  it('teamToLead keeps every slice the ace derivation reads (empty, blank and newest teams)', () => {
    const teams = [
      makeTeam({ id: 'team-old', updated_at: '2026-09-01T00:00:00.000Z', pokemon: [makeSet('Charizard')] }),
      makeTeam({ id: 'team-new', updated_at: '2026-09-02T00:00:00.000Z', pokemon: [makeSet('Venusaur')] }),
      makeTeam({ id: 'team-empty', player_id: 'player-2', updated_at: '2026-09-03T00:00:00.000Z', pokemon: [] }),
      makeTeam({ id: 'team-p2', player_id: 'player-2', pokemon: [makeSet('Pikachu')] }),
      makeTeam({ id: 'team-blank', player_id: 'player-3', pokemon: [makeSet('')] }),
    ];

    expect(teams.map(teamToLead).map((lead) => lead.lead_species)).toEqual([
      'Charizard',
      'Venusaur',
      null,
      'Pikachu',
      '',
    ]);
    expect(deriveTeamAcesFromLeads(teams.map(teamToLead))).toEqual({ 'player-1': 'Venusaur', 'player-2': 'Pikachu' });
  });

  it('a null lead (empty team) never shadows an older team with sets', () => {
    const aces = deriveTeamAcesFromLeads([
      lead({ id: 'team-new', updated_at: '2026-09-09T00:00:00.000Z', lead_species: null }),
      lead({ id: 'team-old', updated_at: '2026-09-01T00:00:00.000Z', lead_species: 'Lapras' }),
    ]);
    expect(aces).toEqual({ 'player-1': 'Lapras' });
  });

  it("a blank lead species ('') still counts as the newest team, with no ace", () => {
    const aces = deriveTeamAcesFromLeads([
      lead({ id: 'team-new', updated_at: '2026-09-09T00:00:00.000Z', lead_species: '' }),
      lead({ id: 'team-old', updated_at: '2026-09-01T00:00:00.000Z', lead_species: 'Lapras' }),
    ]);
    expect(aces).toEqual({});
  });
});

// ── the participant boundary ─────────────────────────────────────────

describe('assembleWorldRouteData (participant boundary)', () => {
  it('narrows full participant rows to the public shape', () => {
    const data = assembleWorldRouteData(
      makeInput({
        participants: [
          makeParticipant({
            discord_id: 'discord-secret',
            auth_user_id: 'auth-secret',
            ban_reason: 'private note',
            suspended_until: '2099-01-01T00:00:00.000Z',
            is_admin: true,
            is_test_account: true,
          }),
        ],
      }),
    );

    expect(data.participants).toEqual([{ id: 'player-1', name: 'Mara Feldkamp', gym_type: 'Fire' }]);
    const serialized = JSON.stringify(data);
    for (const secret of ['discord-secret', 'auth-secret', 'private note', 'discord_id', 'ban_reason']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

// ── deriveRosterTiles: EPB lines vs participant fallback ─────────────

describe('deriveRosterTiles', () => {
  it('EPB mirrors the point-buy lines 1:1 — name, band, price unchanged', () => {
    const tiles = deriveRosterTiles({
      rosterLines: [makeEntry(), makeEntry({ id: 'line-2', line_number: 2, base_pokemon: 'Squirtle', price_group: 'hoch', price: 24 })],
      participants: [makeParticipant()],
      teamAces: { 'player-1': 'Charizard' },
    });

    expect(tiles).toEqual([
      { id: 'line-1', line: 1, name: 'Charmander', band: 'premium', price: 27 },
      { id: 'line-2', line: 2, name: 'Squirtle', band: 'hoch', price: 24 },
    ]);
  });

  it('null rosterLines derives one participant tile each: ace species + gym band', () => {
    const withAce = makeParticipant({ id: 'player-1', name: 'Mara Feldkamp', gym_type: 'Fire' });
    const withoutAce = makeParticipant({ id: 'player-2', name: 'Jonas Riedl', gym_type: null });

    const tiles = deriveRosterTiles({
      rosterLines: null,
      participants: [withAce, withoutAce],
      teamAces: { 'player-1': 'Charizard' },
    });

    expect(tiles).toEqual([
      { id: 'player-1', line: 1, name: 'Charizard', band: 'Fire', price: null },
      { id: 'player-2', line: 2, name: 'Jonas Riedl', band: 'open', price: null },
    ]);
  });

  it('an EMPTY rosterLines array takes the participant fallback, not an empty roster', () => {
    // Reachable state: an EPB season whose point-buy list is bound but not
    // yet filled (or not bound at all — buildWorldRouteData passes []).
    const tiles = deriveRosterTiles({
      rosterLines: [],
      participants: [makeParticipant({ id: 'player-1', gym_type: 'Fire' })],
      teamAces: { 'player-1': 'Charizard' },
    });

    expect(tiles).toEqual([
      { id: 'player-1', line: 1, name: 'Charizard', band: 'Fire', price: null },
    ]);
  });

  it('EPB with no bound list keeps [] in the contract but derives participant tiles', () => {
    const data = assembleWorldRouteData(
      makeInput({
        league: makeLeague({ point_buy_list_id: null }),
        rosterLines: [],
        teamLeads: [teamToLead(makeTeam())],
      }),
    );

    expect(data.format).toBe('evolution_point_buy');
    expect(data.rosterLines).toEqual([]);
    expect(deriveRosterTiles(data)).toEqual([
      { id: 'player-1', line: 1, name: 'Charizard', band: 'Fire', price: null },
    ]);
  });
});

// ── buildWorldRouteData: fetch fan-out over the EXISTING queries ─────

describe('buildWorldRouteData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockHappyPath(overrides: {
    league?: SeasonWithDetails | null;
    entries?: PointBuyListEntry[];
    teams?: Team[] | Error;
    pool?: DraftPool | null;
    facts?: Record<string, TeamVisibilityFacts>;
  }): void {
    vi.mocked(getSeasonWithDetails).mockResolvedValue(overrides.league === undefined ? makeLeague() : overrides.league);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([makeStage()]);
    vi.mocked(getPublicSeasonParticipants).mockResolvedValue([
      { id: 'player-1', name: 'Mara Feldkamp', gym_type: 'Fire', avatar_url: null, core_types: null },
    ]);
    vi.mocked(getListEntries).mockResolvedValue(overrides.entries ?? [makeEntry()]);
    vi.mocked(getFormatRules).mockResolvedValue(null);
    vi.mocked(getSeasonTrackers).mockResolvedValue([makeTracker()]);
    vi.mocked(getMatchesByTournamentIds).mockResolvedValue(new Map());
    vi.mocked(assembleLeagueSchedule).mockReturnValue({ standings: [makeStanding()], fixtures: [] });
    vi.mocked(getDraftPoolsBySeason).mockResolvedValue(
      overrides.pool === undefined || overrides.pool === null
        ? []
        : [
            {
              id: overrides.pool.id,
              engine: 'queue',
              kind: 'initial',
              phase: 'drafting',
              mode: 'live',
              status: overrides.pool.status,
            },
          ],
    );
    vi.mocked(getSeasonGroups).mockResolvedValue([]);
    // Default: every team is linked to a completed match (publicly visible).
    vi.mocked(listSeasonTeamLeadsWithFacts).mockImplementation(async () => {
      if (overrides.teams instanceof Error) throw overrides.teams;
      return (overrides.teams ?? []).map((team) => ({
        ...teamToLead(team),
        facts: overrides.facts?.[team.id] ?? COMPLETED_FACTS,
      }));
    });
  }

  const COMPLETED_FACTS: TeamVisibilityFacts = {
    match_status: 'completed',
    tournament_visibility: 'hidden_until_match',
  };

  it('a league without groups: no group fields, the payload is unchanged', async () => {
    mockHappyPath({});
    const data = await buildWorldRouteData('season-1');
    expect(vi.mocked(assembleLeagueSchedule).mock.calls[0][0].groups).toEqual([]);
    expect(data).not.toHaveProperty('groupStandings');
    expect(data).not.toHaveProperty('standingsRanking');
  });

  it('a league with groups: group tables and the combined ranking reach the payload; any group pool counts', async () => {
    mockHappyPath({ pool: DRAFT_POOL });
    vi.mocked(getSeasonGroups).mockResolvedValue([
      { id: 'sg-1', season_id: 'season-1', name: 'Gold', sort_order: 1, player_ids: ['player-1'] },
    ]);
    const groupStandings = [{ groupId: 'sg-1', name: 'Gold', standings: [makeStanding()] }];
    vi.mocked(assembleLeagueSchedule).mockReturnValue({
      standings: [makeStanding()],
      fixtures: [],
      groupStandings,
      standingsRanking: 'points_per_match',
    });

    const data = await buildWorldRouteData('season-1');

    expect(vi.mocked(assembleLeagueSchedule).mock.calls[0][0].groups).toEqual([
      { id: 'sg-1', name: 'Gold', sort_order: 1, player_ids: ['player-1'] },
    ]);
    expect(data?.groupStandings).toEqual(groupStandings);
    expect(data?.standingsRanking).toBe('points_per_match');
    expect(data?.hasDraftPool).toBe(true);
  });

  it('a failed league-groups read fails the world (the group tables are the standings)', async () => {
    mockHappyPath({});
    vi.mocked(getSeasonGroups).mockRejectedValue(new Error('groups read failed'));
    await expect(buildWorldRouteData('season-1')).rejects.toThrow('groups read failed');
  });

  it('a failed draft pool read fails the world: hasDraftPool is never guessed (lead ruling round 4)', async () => {
    mockHappyPath({ pool: DRAFT_POOL });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getDraftPoolsBySeason).mockRejectedValue(new Error('draft pools read failed'));
    await expect(buildWorldRouteData('season-1')).rejects.toThrow('draft pools read failed');
    expect(spy.mock.calls.some((call) => String(call[0]).includes('hasDraftPool'))).toBe(false);
    spy.mockRestore();
  });

  it('a failed format-rules read fails the world: the format defaults never stand in (lead ruling round 5)', async () => {
    mockHappyPath({});
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(getFormatRules).mockRejectedValue(new Error('format rules read failed'));
      await expect(buildWorldRouteData('season-1')).rejects.toThrow('format rules read failed');
      // No disclosed-fallback log either: the error propagates to the caller instead.
      expect(spy.mock.calls.some((call) => String(call[0]).includes('getFormatRules'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('a league without format rules reads null and renders with the format defaults', async () => {
    mockHappyPath({});
    const data = await buildWorldRouteData('season-1');
    expect(data?.formatRules).toBeNull();
  });

  it('returns null for a missing season without touching any other query', async () => {
    vi.mocked(getSeasonWithDetails).mockResolvedValue(null);

    await expect(buildWorldRouteData('missing')).resolves.toBeNull();
    expect(getListEntries).not.toHaveBeenCalled();
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
  });

  it('EPB: fetches the bound list and threads the lines through the contract', async () => {
    const entry = makeEntry();
    mockHappyPath({ entries: [entry], pool: DRAFT_POOL });

    const data = await buildWorldRouteData('season-1');

    expect(getListEntries).toHaveBeenCalledWith('list-1');
    expect(data).not.toBeNull();
    expect(data?.format).toBe('evolution_point_buy');
    expect(data?.world.id).toBe('evoliga');
    expect(data?.rosterLines).toEqual([entry]);
    expect(data?.hasDraftPool).toBe(true);
    expect(data?.rulesetName).toBe('EvoLiga Standard');
  });

  it('non-EPB: skips the list fetch entirely and delivers rosterLines null', async () => {
    mockHappyPath({ league: makeLeague({ format_type: 'singles', point_buy_list_id: null }) });

    const data = await buildWorldRouteData('season-1');

    expect(getListEntries).not.toHaveBeenCalled();
    expect(data?.format).toBe('singles');
    expect(data?.world.id).toBe('sakura');
    expect(data?.rosterLines).toBeNull();
  });

  it('a failed team-lead read fails the world: aces are never silently replaced by names (AGENTS.md rule 5)', async () => {
    mockHappyPath({ teams: new Error('teams unavailable') });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(buildWorldRouteData('season-1')).rejects.toThrow('teams unavailable');
      // No disclosed-fallback log either: the error propagates to the caller instead.
      expect(spy.mock.calls.some((call) => String(call[0]).includes('listSeasonTeamLeadsWithFacts'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('teams feed the ace derivation for the participant roster fallback', async () => {
    mockHappyPath({ teams: [makeTeam({ pokemon: [makeSet('Charizard')] })] });

    const data = await buildWorldRouteData('season-1');

    expect(data?.teamAces).toEqual({ 'player-1': 'Charizard' });
  });

  it('spec §7: a planned (hidden) team never names a public ace tile', async () => {
    mockHappyPath({
      league: makeLeague({ format_type: 'singles', point_buy_list_id: null }),
      teams: [makeTeam({ id: 'planned', pokemon: [makeSet('Kingambit')] })],
      facts: { planned: { match_status: null, tournament_visibility: 'hidden_until_match' } },
    });

    const data = await buildWorldRouteData('season-1');

    expect(listSeasonTeamLeadsWithFacts).toHaveBeenCalledWith('season-1', ['stage-1']);
    expect(getTeamVisibilityFacts).not.toHaveBeenCalled();
    expect(data?.teamAces).toEqual({});
    const tiles = data ? deriveRosterTiles(data) : [];
    expect(tiles.map((tile) => tile.name)).toEqual(['Mara Feldkamp']);
    expect(JSON.stringify(data)).not.toContain('Kingambit');
  });

  it('spec §7: a scheduled-match team stays hidden; an always_public tournament shows its lead', async () => {
    mockHappyPath({
      teams: [makeTeam({ id: 'scheduled', pokemon: [makeSet('Kingambit')] })],
      facts: { scheduled: { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' } },
    });
    expect((await buildWorldRouteData('season-1'))?.teamAces).toEqual({});

    mockHappyPath({
      teams: [makeTeam({ id: 'open', pokemon: [makeSet('Kingambit')] })],
      facts: { open: { match_status: null, tournament_visibility: 'always_public' } },
    });
    expect((await buildWorldRouteData('season-1'))?.teamAces).toEqual({ 'player-1': 'Kingambit' });
  });

  it('spec §7: the newest VISIBLE team names the ace, not a newer planned one', async () => {
    mockHappyPath({
      teams: [
        makeTeam({ id: 'played', updated_at: '2026-09-01T00:00:00.000Z', pokemon: [makeSet('Charizard')] }),
        makeTeam({ id: 'planned', updated_at: '2026-09-05T00:00:00.000Z', pokemon: [makeSet('Kingambit')] }),
      ],
      facts: { planned: { match_status: null, tournament_visibility: 'hidden_until_match' } },
    });

    const data = await buildWorldRouteData('season-1');

    expect(data?.teamAces).toEqual({ 'player-1': 'Charizard' });
  });

  it('a hidden_until_match league: the teams of its completed matches name the aces (stage rows read too)', async () => {
    const stageTeam = (id: string, playerId: string, species: string) =>
      makeTeam({ id, player_id: playerId, season_id: null, tournament_id: 'stage-1', pokemon: [makeSet(species)] });
    mockHappyPath({
      league: makeLeague({ format_type: 'singles', point_buy_list_id: null }),
      teams: [stageTeam('played', 'player-1', 'Garchomp'), stageTeam('upcoming', 'player-2', 'Kingambit')],
      facts: {
        played: { match_status: 'completed', tournament_visibility: 'hidden_until_match' },
        upcoming: { match_status: 'scheduled', tournament_visibility: 'hidden_until_match' },
      },
    });

    const data = await buildWorldRouteData('season-1');

    expect(listSeasonTeamLeadsWithFacts).toHaveBeenCalledWith('season-1', ['stage-1']);
    expect(data?.teamAces).toEqual({ 'player-1': 'Garchomp' });
    expect(JSON.stringify(data)).not.toContain('Kingambit');
  });

  it('EPB standings get the evolution points summed from the trackers already read', async () => {
    mockHappyPath({});
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      makeTracker({ id: 't-1', player_id: 'player-1', evolution_points_awarded: 2 }),
      makeTracker({ id: 't-2', player_id: 'player-1', evolution_points_awarded: 1 }),
      makeTracker({ id: 't-3', player_id: 'player-2', evolution_points_awarded: 4 }),
    ]);

    await buildWorldRouteData('season-1');

    expect(assembleLeagueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          formatType: 'evolution_point_buy',
          evolutionPoints: { 'player-1': 3, 'player-2': 4 },
        },
      }),
    );
    expect(getMatchesByTournamentIds).toHaveBeenCalledWith(['stage-1']);
  });

  it('a non-EPB season computes standings without evolution points', async () => {
    mockHappyPath({ league: makeLeague({ format_type: 'singles', point_buy_list_id: null }) });

    await buildWorldRouteData('season-1');

    expect(assembleLeagueSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ context: { formatType: 'singles' } }),
    );
  });

  it('preloaded rows are used as-is: no season, stage or participant read', async () => {
    mockHappyPath({});

    const data = await buildWorldRouteData('season-1', {
      league: makeLeague(),
      stages: [makeStage({ id: 'stage-9' })],
      participants: [{ id: 'player-7', name: 'Pre Loaded', gym_type: null, avatar_url: null, core_types: null }],
    });

    expect(getSeasonWithDetails).not.toHaveBeenCalled();
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(getPublicSeasonParticipants).not.toHaveBeenCalled();
    expect(getMatchesByTournamentIds).toHaveBeenCalledWith(['stage-9']);
    expect(data?.participants).toEqual([{ id: 'player-7', name: 'Pre Loaded', gym_type: null }]);
  });
});
