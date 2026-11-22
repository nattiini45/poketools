import { DEV_SEED_LEAGUE_NAME, DEV_SEED_TOURNAMENT_NAME } from '../../src/lib/dev-seed/constants';
import { serviceClient } from './stack';

export interface SeededLeague {
  seasonId: string;
  tournamentId: string;
  roundId: string;
}

/** The league `npm run dev:seed` made (global setup runs it first), found by its name. */
export async function seededLeague(): Promise<SeededLeague> {
  const db = serviceClient();
  const season = await db.from('seasons').select('id').eq('name', DEV_SEED_LEAGUE_NAME).limit(1).maybeSingle();
  if (season.error || !season.data) throw new Error(`[e2e] seeded league "${DEV_SEED_LEAGUE_NAME}" not found: ${season.error?.message ?? 'no row'}`);
  const tournament = await db
    .from('tournaments')
    .select('id')
    .eq('season_id', season.data.id)
    .eq('name', DEV_SEED_TOURNAMENT_NAME)
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
 * A new scheduled match in a fresh round of the seeded tournament, so every run (and rerun) starts from a match
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
