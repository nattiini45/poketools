import { DEV_SEED_PLAYER_COUNT, DEV_SEED_TOURNAMENT_NAME } from '../../src/lib/dev-seed/constants';
import { serviceClient } from './stack';

export interface SeededLeague {
  seasonId: string;
  tournamentId: string;
  roundId: string;
}

/**
 * The league the e2e suite owns (issue #145): created once by the global setup after the dev seed
 * (its players and rulesets are reused), and only the specs write to it — the dev seed's league is
 * local-development data and the seed tests that delete and reset it own it alone.
 */
export const E2E_LEAGUE_NAME = 'E2E League';
export const E2E_TOURNAMENT_NAME = 'E2E Regular Season';

/**
 * Creates the e2e league's missing pieces; a rerun (or a retry after a failed first
 * create) fills in whatever is absent and leaves the played rounds as they are.
 */
export async function ensureE2ELeague(): Promise<void> {
  const db = serviceClient();

  // The dev seed ran first: its tournament carries the standard ruleset version this league reuses.
  const devStage = await db.from('tournaments').select('ruleset_id').eq('name', DEV_SEED_TOURNAMENT_NAME).limit(1).maybeSingle();
  if (devStage.error || !devStage.data) {
    throw new Error(`[e2e] dev-seed tournament not found for the ruleset id: ${devStage.error?.message ?? 'no row'}`);
  }
  const rulesetId = devStage.data.ruleset_id;

  let season = await db.from('seasons').select('id').eq('name', E2E_LEAGUE_NAME).limit(1).maybeSingle();
  if (season.error) throw new Error(`[e2e] could not read the e2e league: ${season.error.message}`);
  if (!season.data) {
    const created = await db
      .from('seasons')
      .insert({
        name: E2E_LEAGUE_NAME,
        description: 'Created by the e2e global setup. Local test data only.',
        format_type: 'singles',
        ruleset_id: rulesetId,
        language: 'en',
        status: 'active',
        is_test_season: true,
      })
      .select('id')
      .single();
    if (created.error || !created.data) throw new Error(`[e2e] could not create the e2e league: ${created.error?.message ?? 'no row'}`);
    season = created;
  }
  const seasonId = season.data.id;

  let tournament = await db
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId)
    .eq('name', E2E_TOURNAMENT_NAME)
    .limit(1)
    .maybeSingle();
  if (tournament.error) throw new Error(`[e2e] could not read the e2e tournament: ${tournament.error.message}`);
  if (!tournament.data) {
    const created = await db
      .from('tournaments')
      .insert({
        name: E2E_TOURNAMENT_NAME,
        season_id: seasonId,
        bracket_type: 'round_robin',
        ruleset_id: rulesetId,
        best_of_default: 1,
        is_doubles: false,
        team_visibility: 'hidden_until_match',
        stage_order: 0,
        status: 'active',
        current_round: 1,
      })
      .select('id')
      .single();
    if (created.error || !created.data) throw new Error(`[e2e] could not create the e2e tournament: ${created.error?.message ?? 'no row'}`);
    tournament = created;
  }
  const tournamentId = tournament.data.id;

  const playerIds: string[] = [];
  for (let n = 1; n <= DEV_SEED_PLAYER_COUNT; n += 1) playerIds.push(await seedPlayerId(`Seed Player ${n}`));

  const enrolled = await db.from('season_participants').select('player_id').eq('season_id', seasonId);
  if (enrolled.error) throw new Error(`[e2e] could not read the e2e league's enrolment: ${enrolled.error.message}`);
  const missing = playerIds.filter((id) => !(enrolled.data ?? []).some((row) => row.player_id === id));
  if (missing.length > 0) {
    const rows = await db
      .from('season_participants')
      .insert(missing.map((player_id) => ({ season_id: seasonId, player_id })));
    if (rows.error) throw new Error(`[e2e] could not enrol the e2e league: ${rows.error.message}`);
  }

  const stageEnrolled = await db.from('tournament_participants').select('player_id').eq('tournament_id', tournamentId);
  if (stageEnrolled.error) throw new Error(`[e2e] could not read the e2e tournament's enrolment: ${stageEnrolled.error.message}`);
  const stageMissing = playerIds.filter((id) => !(stageEnrolled.data ?? []).some((row) => row.player_id === id));
  if (stageMissing.length > 0) {
    const rows = await db
      .from('tournament_participants')
      .insert(stageMissing.map((player_id) => ({ tournament_id: tournamentId, player_id })));
    if (rows.error) throw new Error(`[e2e] could not enrol the e2e tournament: ${rows.error.message}`);
  }

  const rounds = await db.from('rounds').select('id').eq('tournament_id', tournamentId).limit(1);
  if (rounds.error) throw new Error(`[e2e] could not read the e2e rounds: ${rounds.error.message}`);
  if ((rounds.data ?? []).length === 0) {
    const round = await db
      .from('rounds')
      .insert({ tournament_id: tournamentId, name: 'Round 1', round_number: 1, best_of: 1 })
      .select('id')
      .single();
    if (round.error || !round.data) throw new Error(`[e2e] could not create the e2e round: ${round.error?.message ?? 'no row'}`);
  }
}

/** The league the e2e global setup created, found by its name. */
export async function seededLeague(): Promise<SeededLeague> {
  const db = serviceClient();
  const season = await db.from('seasons').select('id').eq('name', E2E_LEAGUE_NAME).limit(1).maybeSingle();
  if (season.error || !season.data) throw new Error(`[e2e] seeded league "${E2E_LEAGUE_NAME}" not found: ${season.error?.message ?? 'no row'}`);
  const tournament = await db
    .from('tournaments')
    .select('id')
    .eq('season_id', season.data.id)
    .eq('name', E2E_TOURNAMENT_NAME)
    .limit(1)
    .maybeSingle();
  if (tournament.error || !tournament.data) throw new Error(`[e2e] seeded tournament not found: ${tournament.error?.message ?? 'no row'}`);
  const round = await db.from('rounds').select('id').eq('tournament_id', tournament.data.id).order('round_number').limit(1).maybeSingle();
  if (round.error || !round.data) throw new Error(`[e2e] seeded round not found: ${round.error?.message ?? 'no row'}`);
  return { seasonId: season.data.id, tournamentId: tournament.data.id, roundId: round.data.id };
}

/** A seeded player's row id, by the display name the seed gives them ("Seed Player 7"). */
export async function seedPlayerId(name: string): Promise<string> {
  const { data, error } = await serviceClient().from('players').select('id').eq('name', name).not('auth_user_id', 'is', null).limit(1).maybeSingle();
  if (error || !data) throw new Error(`[e2e] seeded player "${name}" not found: ${error?.message ?? 'no row'}`);
  return data.id;
}

/**
 * A new scheduled match in a fresh round of the e2e tournament, so every run (and rerun) starts from a match
 * nobody has reported. The seeded round is not reused: a second match for one pairing in one round is refused by
 * `matches_round_pair_unique` (issue #131), and a rerun inserts the same pair.
 */
export async function createScheduledMatch(league: SeededLeague, player1Id: string, player2Id: string): Promise<string> {
  const db = serviceClient();
  const latest = await db
    .from('rounds')
    .select('round_number')
    .eq('tournament_id', league.tournamentId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(`[e2e] could not read the rounds: ${latest.error.message}`);
  const roundNumber = (latest.data?.round_number ?? 0) + 1;
  const round = await db
    .from('rounds')
    .insert({ tournament_id: league.tournamentId, name: `E2E Round ${roundNumber}`, round_number: roundNumber, best_of: 1, pairings_generated: true })
    .select('id')
    .single();
  if (round.error || !round.data) throw new Error(`[e2e] could not create a round: ${round.error?.message ?? 'no row'}`);
  const { data, error } = await db
    .from('matches')
    .insert({ round_id: round.data.id, tournament_id: league.tournamentId, player_1_id: player1Id, player_2_id: player2Id })
    .select('id')
    .single();
  if (error || !data) throw new Error(`[e2e] could not create a match: ${error?.message ?? 'no row'}`);
  return data.id;
}
