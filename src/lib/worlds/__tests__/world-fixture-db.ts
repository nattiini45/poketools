/**
 * Test-only fixture database for the league page / world route data tests.
 *
 * Two seasons: an Evolution Point Buy league (evoliga world: point-buy list,
 * trackers with evolution points, two stages, three matchdays so the
 * previous-matchday table and `rank_change` are exercised) and a singles
 * league (sakura world: team-lead aces). Player rows deliberately carry
 * private values (discord ids, auth ids, ban reasons, suspensions, admin and
 * test flags) so a leak is visible in any payload built from them.
 *
 * Rows are PostgREST-shaped: embeds are pre-attached under their relation
 * names. `fake-postgrest.ts` serves them.
 */
import type { FakeTables, FakeRow } from './fake-postgrest';

export const EPB_SEASON_ID = '11111111-1111-4111-8111-111111111111';
export const SAKURA_SEASON_ID = '22222222-2222-4222-8222-222222222222';

const ISO = '2026-09-01T12:00:00.000Z';

function player(id: string, name: string, extra: Partial<FakeRow> = {}): FakeRow {
  return {
    id,
    name,
    discord_id: `discord-${id}`,
    auth_user_id: `auth-${id}`,
    ps_username: `ps-${name.toLowerCase().replace(/\s+/g, '')}`,
    champions_username: `champ-${id}`,
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: ISO,
    avatar_url: `https://cdn.example.test/avatars/${id}.png`,
    avatar_config: { skin: 'a', hair: 'b' },
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    world_experience: 'auto',
    created_at: ISO,
    updated_at: ISO,
    ...extra,
  };
}

export const PLAYERS: FakeRow[] = [
  player('p1', 'Mara Feldkamp', { is_admin: true }),
  player('p2', 'Jonas Riedl', {
    status: 'suspended',
    suspended_until: '2026-12-31T00:00:00.000Z',
    ban_reason: 'Private moderation note: repeated no-shows',
  }),
  player('p3', 'Lea Brandt', { is_test_account: true, avatar_url: null }),
  player('p4', 'Timo Kessler', { is_creator: true }),
];

const playerById = new Map(PLAYERS.map((p) => [p.id as string, p]));

function participant(seasonId: string, playerId: string, gym: string | null, core: string[] | null): FakeRow {
  return {
    season_id: seasonId,
    player_id: playerId,
    gym_type: gym,
    core_types: core,
    core_assigned_at: core ? ISO : null,
    players: playerById.get(playerId),
  };
}

function season(id: string, name: string, format: string, extra: Partial<FakeRow>, participantIds: string[], stageIds: string[]): FakeRow {
  return {
    id,
    name,
    description: `${name} description`,
    format_type: format,
    ruleset_id: 'ruleset-1',
    start_date: '2026-09-01',
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    route_theme: 'auto',
    created_at: ISO,
    updated_at: ISO,
    rulesets: { name: 'Liga-Regelwerk', name_text: 'Liga-Regelwerk' },
    season_participants: participantIds.map((player_id) => ({ player_id })),
    tournaments: stageIds.map((tid) => ({ id: tid })),
    ...extra,
  };
}

function stage(id: string, seasonId: string, seasonName: string, name: string, order: number, participantIds: string[]): FakeRow {
  return {
    id,
    name,
    description: '',
    season_id: seasonId,
    bracket_type: 'round_robin',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: order,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: ISO,
    updated_at: ISO,
    rulesets: { name: 'Bühnen-Regelwerk', name_text: 'Bühnen-Regelwerk' },
    seasons: { name: seasonName },
    tournament_participants: participantIds.map((player_id) => ({ player_id })),
  };
}

let gameSeq = 0;
function match(
  id: string,
  tournamentId: string,
  roundId: string,
  p1: string,
  p2: string,
  winner: string | null,
  status: 'completed' | 'scheduled',
  scheduledAt: string,
): FakeRow {
  const games =
    status === 'completed'
      ? [
          {
            id: `g-${id}-${++gameSeq}`,
            game_number: 1,
            winner_id: winner,
            replay_url: '',
            source: 'manual',
            stats_locked: false,
          },
        ]
      : [];
  return {
    id,
    round_id: roundId,
    tournament_id: tournamentId,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status,
    submitter_id: status === 'completed' ? p1 : null,
    date_played: status === 'completed' ? scheduledAt : null,
    scheduled_at: scheduledAt,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: null,
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: ISO,
    updated_at: ISO,
    player_1: { name: playerById.get(p1)?.name, avatar_url: playerById.get(p1)?.avatar_url ?? null },
    player_2: { name: playerById.get(p2)?.name, avatar_url: playerById.get(p2)?.avatar_url ?? null },
    winner: winner ? { name: playerById.get(winner)?.name } : null,
    games,
    round: { status: status === 'completed' ? 'completed' : 'pending' },
  };
}

function tracker(id: string, playerId: string, base: string, form: string, stageNo: number, kos: number, points: number): FakeRow {
  return {
    id,
    season_id: EPB_SEASON_ID,
    player_id: playerId,
    base_pokemon: base,
    current_form: form,
    total_kos: kos,
    current_stage: stageNo,
    evolved_at: stageNo > 1 ? ISO : null,
    created_at: ISO,
    updated_at: ISO,
    real_kills: kos,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: points,
    locked_stage3_pokemon: null,
  };
}

function entry(id: string, line: number, base: string, price: number, group: string): FakeRow {
  return {
    id,
    list_version_id: 'list-1',
    line_number: line,
    base_pokemon: base,
    stage2_pokemon: `${base}-2`,
    stage3_pokemon: `${base}-3`,
    price,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: group,
    early_rating: 3,
    mid_rating: 3,
    late_rating: 3,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
  };
}

function set(species: string): FakeRow {
  return {
    name: '',
    species,
    gender: '',
    item: 'Leftovers',
    ability: 'Pressure',
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Calm',
    level: 50,
    moves: ['Protect', 'Toxic', 'Roost', 'Scald'],
  };
}

function team(id: string, seasonId: string, playerId: string, species: string[], updatedAt: string): FakeRow {
  return {
    id,
    player_id: playerId,
    name: '',
    tournament_id: null,
    season_id: seasonId,
    match_id: null,
    pokemon: species.map(set),
    import_source: 'manual',
    locked: false,
    is_draft_team: false,
    draft_pool_id: null,
    share_token: null,
    share_enabled_at: null,
    library_published_at: null,
    library_title: null,
    library_description: null,
    library_tags: null,
    forked_from_team_id: null,
    created_at: ISO,
    updated_at: updatedAt,
    // Embedded relations for `getTeamVisibilityFacts` (spec §7): every
    // fixture team counts as played in a completed match, so the public world
    // shows its lead exactly as the golden captured it.
    match: { status: 'completed' },
    tournament: null,
  };
}

const EPB_STAGES = ['e-stage-1', 'e-stage-2'];
const SAKURA_STAGES = ['s-stage-1'];
const ALL = ['p1', 'p2', 'p3', 'p4'];

export function buildFixtureTables(): FakeTables {
  gameSeq = 0;
  return {
    seasons: [
      season(EPB_SEASON_ID, 'EvoLiga Herbst', 'evolution_point_buy', { point_buy_list_id: 'list-1' }, ALL, EPB_STAGES),
      season(SAKURA_SEASON_ID, 'Sakura Cup', 'singles', {}, ALL, SAKURA_STAGES),
    ],
    tournaments: [
      stage('e-stage-1', EPB_SEASON_ID, 'EvoLiga Herbst', 'Hinrunde', 0, ALL),
      stage('e-stage-2', EPB_SEASON_ID, 'EvoLiga Herbst', 'Rückrunde', 1, ALL),
      stage('s-stage-1', SAKURA_SEASON_ID, 'Sakura Cup', 'Gruppenphase', 0, ALL),
    ],
    season_participants: [
      participant(EPB_SEASON_ID, 'p1', 'Fire', null),
      participant(EPB_SEASON_ID, 'p2', 'Water', null),
      participant(EPB_SEASON_ID, 'p3', null, null),
      participant(EPB_SEASON_ID, 'p4', 'Grass', null),
      participant(SAKURA_SEASON_ID, 'p1', 'Dragon', ['Dragon', 'Fairy', 'Steel']),
      participant(SAKURA_SEASON_ID, 'p2', null, null),
      participant(SAKURA_SEASON_ID, 'p3', 'Ice', null),
      participant(SAKURA_SEASON_ID, 'p4', null, null),
    ],
    players: PLAYERS,
    matches: [
      // EPB Hinrunde: matchday 1 and 2 completed.
      match('m1', 'e-stage-1', 'r1', 'p1', 'p2', 'p1', 'completed', '2026-09-05T18:00:00.000Z'),
      match('m2', 'e-stage-1', 'r1', 'p3', 'p4', 'p4', 'completed', '2026-09-05T19:00:00.000Z'),
      match('m3', 'e-stage-1', 'r2', 'p1', 'p3', 'p3', 'completed', '2026-09-12T18:00:00.000Z'),
      match('m4', 'e-stage-1', 'r2', 'p2', 'p4', 'p2', 'completed', '2026-09-12T19:00:00.000Z'),
      // Sakura group stage, interleaved to prove per-stage grouping.
      match('s1', 's-stage-1', 'sr1', 'p1', 'p4', 'p4', 'completed', '2026-09-06T18:00:00.000Z'),
      // EPB Rückrunde: matchday 3 completed, matchday 4 scheduled.
      match('m5', 'e-stage-2', 'r3', 'p1', 'p4', 'p4', 'completed', '2026-09-19T18:00:00.000Z'),
      match('m6', 'e-stage-2', 'r3', 'p2', 'p3', null, 'completed', '2026-09-19T19:00:00.000Z'),
      match('m7', 'e-stage-2', 'r4', 'p1', 'p2', null, 'scheduled', '2026-09-26T18:00:00.000Z'),
      match('s2', 's-stage-1', 'sr1', 'p2', 'p3', 'p2', 'completed', '2026-09-06T19:00:00.000Z'),
      match('s3', 's-stage-1', 'sr2', 'p1', 'p2', null, 'scheduled', '2026-09-13T18:00:00.000Z'),
    ],
    evolution_tracker: [
      tracker('t1', 'p1', 'Charmander', 'Charmeleon', 2, 4, 2),
      tracker('t2', 'p1', 'Dratini', 'Dratini', 1, 1, 0),
      tracker('t3', 'p2', 'Squirtle', 'Wartortle', 2, 3, 1),
      tracker('t4', 'p3', 'Bulbasaur', 'Bulbasaur', 1, 0, 0),
      tracker('t5', 'p4', 'Gastly', 'Haunter', 2, 5, 2),
    ],
    point_buy_list_entries: [
      entry('line-2', 2, 'Squirtle', 24, 'hoch'),
      entry('line-1', 1, 'Charmander', 27, 'premium'),
      entry('line-3', 3, 'Gastly', 20, 'mittel'),
    ],
    format_rules: [],
    draft_pools: [
      {
        id: 'pool-1',
        season_id: EPB_SEASON_ID,
        draft_type: 'snake',
        point_budget: null,
        pool_mode: 'tier',
        default_point_cost: null,
        team_size_mode: null,
        team_size_exact: null,
        team_size_min: null,
        team_size_max: null,
        status: 'complete',
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    teams: [
      team('team-a', SAKURA_SEASON_ID, 'p1', ['Dragonite', 'Clefable'], '2026-09-02T00:00:00.000Z'),
      team('team-b', SAKURA_SEASON_ID, 'p1', ['Garchomp', 'Togekiss'], '2026-09-03T00:00:00.000Z'),
      team('team-c', SAKURA_SEASON_ID, 'p2', ['Vaporeon'], '2026-09-02T00:00:00.000Z'),
      team('team-d', SAKURA_SEASON_ID, 'p3', [], '2026-09-04T00:00:00.000Z'),
      team('team-e', SAKURA_SEASON_ID, 'p3', ['Lapras'], '2026-09-01T00:00:00.000Z'),
      team('team-f', EPB_SEASON_ID, 'p4', ['Haunter'], '2026-09-02T00:00:00.000Z'),
    ],
  };
}

/** Every private player column that must never reach a client payload. */
export const PRIVATE_PLAYER_FIELDS = [
  'discord_id',
  'auth_user_id',
  'ban_reason',
  'suspended_until',
  'is_admin',
  'is_test_account',
  'status',
] as const;
