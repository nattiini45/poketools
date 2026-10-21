import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// LIVE-LOCAL test for supabase/migrations/20261018130000_match_finalize_integrity.sql
// (code review C2, H2). It runs the real query functions against a LOCAL
// Supabase stack (after `supabase db reset`) to prove:
//   - UNIQUE (match_id, game_number) refuses a duplicate game number and
//     createGame maps that exact violation to GameNumberConflictError (409),
//     including two inserts racing for the same number;
//   - matches.finalized_at: status writes clear it, markMatchFinalized stamps
//     it only on a completed match, listMatchesNeedingFinalize finds the
//     completed-but-unfinalized row;
//   - the keyset filters PostgREST must parse (CR-2 worklist cursor, CR-4
//     rating replay cursor past 1000 rows) return every row exactly once in
//     order;
//   - the live rating writer (rating_apply_match_result, round 3) writes both
//     players or nothing and refuses a stale fence, and rollback_game_aggregates
//     decrements a counted game exactly once under concurrent calls.
// Opt-in only, never in CI, and it never loads `.env`: every value comes from
// the command line.
//
//   LOCAL_SUPABASE_FINALIZE=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/supabase/queries/__tests__/match-finalize-integrity.local.test.ts
const optIn = process.env.LOCAL_SUPABASE_FINALIZE === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[match-finalize-integrity.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[match-finalize-integrity.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`,
    );
  }
}

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error(
      '[match-finalize-integrity.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY on the command line',
    );
  }
}

type ClientMod = typeof import('@/lib/supabase/client');
type GamesMod = typeof import('@/lib/supabase/queries/games');
type MatchesMod = typeof import('@/lib/supabase/queries/matches');
type RatingsMod = typeof import('@/lib/supabase/queries/ratings');
type UpdateRatingsMod = typeof import('@/lib/rating/updateRatings');

let client: ClientMod['supabase'];
let games: GamesMod;
let matches: MatchesMod;
let ratings: RatingsMod;
let updateRatingsMod: UpdateRatingsMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  tournament: randomUUID(),
  round: randomUUID(),
  match: randomUUID(),
};

describe.skipIf(!optIn)('match finalize integrity (local stack)', () => {
  beforeAll(async () => {
    assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

    ({ supabase: client } = await import('@/lib/supabase/client'));
    games = await import('@/lib/supabase/queries/games');
    matches = await import('@/lib/supabase/queries/matches');
    ratings = await import('@/lib/supabase/queries/ratings');
    updateRatingsMod = await import('@/lib/rating/updateRatings');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };

    await run('rulesets', client.from('rulesets').insert({ id: ids.ruleset, name: `Finalize ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert([
        { id: ids.p1, name: `Finalize ${RUN} Ada`, discord_id: `finalize-${RUN}-d1` },
        { id: ids.p2, name: `Finalize ${RUN} Bram`, discord_id: `finalize-${RUN}-d2` },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert({ id: ids.tournament, name: `Finalize ${RUN} Open`, bracket_type: 'swiss', ruleset_id: ids.ruleset }),
    );
    await run(
      'rounds',
      client.from('rounds').insert({ id: ids.round, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 3 }),
    );
    await run(
      'matches',
      client.from('matches').insert({
        id: ids.match, round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2, status: 'in_progress',
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    const { data: tournamentMatches, error: listError } = await client
      .from('matches')
      .select('id')
      .eq('tournament_id', ids.tournament);
    if (listError) failures.push(`list matches: ${JSON.stringify(listError)}`);
    const matchIds = (tournamentMatches ?? []).map((m) => m.id);
    for (let i = 0; i < matchIds.length; i += 150) {
      await del('games', client.from('games').delete().in('match_id', matchIds.slice(i, i + 150)));
    }
    // rating_history and player_ratings rows go with their matches and players (ON DELETE CASCADE).
    await del('matches', client.from('matches').delete().eq('tournament_id', ids.tournament));
    await del('rounds', client.from('rounds').delete().eq('id', ids.round));
    await del('tournaments', client.from('tournaments').delete().eq('id', ids.tournament));
    await del('rulesets', client.from('rulesets').delete().eq('id', ids.ruleset));
    await del('players', client.from('players').delete().in('id', [ids.p1, ids.p2]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  const gameInput = (gameNumber: number) => ({
    match_id: ids.match,
    game_number: gameNumber,
    winner_id: ids.p1,
    source: 'manual' as const,
    exclude_all_time: false,
  });

  it('refuses a second game with the same (match_id, game_number) as GameNumberConflictError', async () => {
    const first = await games.createGame(gameInput(1));
    expect(first.game_number).toBe(1);

    const duplicate = games.createGame(gameInput(1));
    await expect(duplicate).rejects.toBeInstanceOf(games.GameNumberConflictError);
    await expect(games.createGame(gameInput(1))).rejects.toMatchObject({
      code: 'match_result_conflict',
      statusCode: 409,
    });

    const { count, error } = await client
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', ids.match)
      .eq('game_number', 1);
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  it('lets exactly one of two racing inserts for the same game number win', async () => {
    const results = await Promise.allSettled([games.createGame(gameInput(2)), games.createGame(gameInput(2))]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(games.GameNumberConflictError);
  });

  it('tracks finalized_at through completion, marker and reset', async () => {
    const completed = await matches.updateMatchStatus(ids.match, 'completed', ids.p1, undefined, undefined, 'in_progress');
    expect(completed?.status).toBe('completed');

    const readMarker = async () => {
      const { data, error } = await client.from('matches').select('finalized_at').eq('id', ids.match).single();
      expect(error).toBeNull();
      return data!.finalized_at;
    };
    expect(await readMarker()).toBeNull();

    // A far-future cutoff: the row qualifies regardless of the grace period.
    const worklist = await matches.listMatchesNeedingFinalize('2999-01-01T00:00:00.000Z', 1000);
    expect(worklist.map((m) => m.id)).toContain(ids.match);

    expect(await matches.markMatchFinalized(ids.match)).toBe(true);
    expect(await readMarker()).not.toBeNull();
    const after = await matches.listMatchesNeedingFinalize('2999-01-01T00:00:00.000Z', 1000);
    expect(after.map((m) => m.id)).not.toContain(ids.match);

    // Leaving `completed` clears the marker, and the marker write refuses a non-completed match.
    await matches.resetMatchFields(ids.match);
    expect(await readMarker()).toBeNull();
    expect(await matches.markMatchFinalized(ids.match)).toBe(false);
    expect(await readMarker()).toBeNull();

    // updateMatchPlayers is a status write too: it clears the marker (CR-2).
    await matches.updateMatchStatus(ids.match, 'completed', ids.p1);
    expect(await matches.markMatchFinalized(ids.match)).toBe(true);
    await matches.updateMatchPlayers(ids.match, ids.p1, ids.p2);
    expect(await readMarker()).toBeNull();
  });

  it('pages the finalize worklist with the keyset cursor: every row once, oldest first (CR-2)', async () => {
    const extra = Array.from({ length: 5 }, () => randomUUID());
    const { error } = await client.from('matches').insert(
      extra.map((id) => ({
        id, round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2,
        status: 'completed' as const, winner_id: ids.p1,
      })),
    );
    expect(error).toBeNull();

    const seen: Array<{ id: string; updated_at: string }> = [];
    let cursor: { updated_at: string; id: string } | undefined;
    for (let page = 0; page < 1000; page += 1) {
      const rows = await matches.listMatchesNeedingFinalize('2999-01-01T00:00:00.000Z', 2, cursor);
      if (rows.length === 0) break;
      seen.push(...rows.map((row) => ({ id: row.id, updated_at: row.updated_at })));
      const last = rows[rows.length - 1];
      cursor = { updated_at: last.updated_at, id: last.id };
    }

    const ids_ = seen.map((row) => row.id);
    expect(new Set(ids_).size).toBe(ids_.length);
    for (const id of extra) expect(ids_).toContain(id);
    const sorted = [...seen].sort((a, b) =>
      a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : Date.parse(a.updated_at) - Date.parse(b.updated_at),
    );
    expect(ids_).toEqual(sorted.map((row) => row.id));
  });

  it('reads more than 1000 completed matches for the rating replay with the keyset cursor, dated first (CR-4)', async () => {
    // 1003 dated matches (pairs share a date_played to exercise the created_at / id tie-breaks) and 2 undated ones.
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const dated = Array.from({ length: 1003 }, (_, i) => ({
      id: randomUUID(), round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2,
      status: 'completed' as const, winner_id: i % 2 === 0 ? ids.p1 : ids.p2,
      date_played: new Date(base + Math.floor(i / 2) * 60_000).toISOString(),
    }));
    const undated = Array.from({ length: 2 }, () => ({
      id: randomUUID(), round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p2, player_2_id: ids.p1,
      status: 'completed' as const, winner_id: ids.p2, date_played: null,
    }));
    const { error } = await client.from('matches').insert([...dated, ...undated]);
    expect(error).toBeNull();

    const replay = await ratings.getCompletedMatchesForRatingReplay(ids.p1);
    const inserted = new Set<string>([...dated, ...undated].map((m) => m.id));
    expect(replay.filter((row) => inserted.has(row.id))).toHaveLength(1005);
    expect(new Set(replay.map((row) => row.id)).size).toBe(replay.length);

    // Order: date_played desc (nulls last), created_at desc, id desc.
    for (let i = 1; i < replay.length; i += 1) {
      const a = replay[i - 1];
      const b = replay[i];
      if (a.date_played !== null && b.date_played === null) continue;
      expect(a.date_played === null && b.date_played !== null).toBe(false);
      const ad = a.date_played === null ? 0 : Date.parse(a.date_played);
      const bd = b.date_played === null ? 0 : Date.parse(b.date_played);
      if (ad !== bd) {
        expect(ad).toBeGreaterThan(bd);
      } else if (a.created_at !== b.created_at) {
        expect(Date.parse(a.created_at)).toBeGreaterThan(Date.parse(b.created_at));
      } else {
        expect(a.id > b.id).toBe(true);
      }
    }
    expect(replay.slice(-2).every((row) => row.date_played === null)).toBe(true);
  }, 60000);

  it('writes the live rating update as one statement per table, and refuses a bad pair whole (CR-4)', async () => {
    const ratedMatch = randomUUID();
    const { error } = await client.from('matches').insert({
      id: ratedMatch, round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2,
      status: 'completed', winner_id: ids.p1,
    });
    expect(error).toBeNull();

    const first = await updateRatingsMod.updateRatings(ids.p1, ids.p2, false, ratedMatch);
    const history = await ratings.getRatingHistoryByMatch(ratedMatch);
    expect(history.map((row) => row.player_id).sort()).toEqual([ids.p1, ids.p2].sort());

    // A second call for the same match is a no-op that reports the stored change.
    const again = await updateRatingsMod.updateRatings(ids.p1, ids.p2, false, ratedMatch);
    expect(again).toEqual(first);
    expect(await ratings.getRatingHistoryByMatch(ratedMatch)).toHaveLength(2);

    // One bad history row refuses the whole apply: no ratings, no one-sided history.
    const otherMatch = randomUUID();
    const { error: insertError } = await client.from('matches').insert({
      id: otherMatch, round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2,
      status: 'completed', winner_id: ids.p2,
    });
    expect(insertError).toBeNull();
    const ratingsBefore = await Promise.all([ratings.getPlayerRating(ids.p1), ratings.getPlayerRating(ids.p2)]);
    const entry = (playerId: string, opponentId: string, result: 'win' | 'loss', stored: (typeof ratingsBefore)[number]) => ({
      playerId,
      expected: ratings.toExpectedRatingState(stored),
      state: {
        rating: 1400, rd: 300, volatility: 0.06, peak_rating: 1700, peak_date: null, wins: 9, losses: 9, draws: 0,
        last_match_at: null,
      },
      history: { rating_before: 1500, rating_after: 1400, rd_before: 300, rd_after: 300, opponent_id: opponentId, opponent_rating: 1500, result },
    });
    await expect(
      ratings.applyMatchRatingResult(otherMatch, [
        entry(ids.p2, ids.p1, 'win', ratingsBefore[1]),
        { ...entry(ids.p1, ids.p2, 'loss', ratingsBefore[0]), history: { ...entry(ids.p1, ids.p2, 'loss', ratingsBefore[0]).history, result: 'forfeit' as never } },
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await ratings.getRatingHistoryByMatch(otherMatch)).toHaveLength(0);
    expect(await Promise.all([ratings.getPlayerRating(ids.p1), ratings.getPlayerRating(ids.p2)])).toEqual(ratingsBefore);

    // A fence that no longer matches the stored row writes nothing ('stale').
    await expect(
      ratings.applyMatchRatingResult(otherMatch, [
        { ...entry(ids.p2, ids.p1, 'win', ratingsBefore[1]), expected: null },
        entry(ids.p1, ids.p2, 'loss', ratingsBefore[0]),
      ]),
    ).resolves.toBe('stale');
    expect(await ratings.getRatingHistoryByMatch(otherMatch)).toHaveLength(0);
  });

  it('rolls a counted game back exactly once, fenced on its marker (rollback_game_aggregates)', async () => {
    const aggregates = await import('@/lib/supabase/queries/aggregates');
    const game = await games.createGame({ ...gameInput(7) });
    const marker = '2026-10-18T10:00:00.123456+00:00';
    const { error: markError } = await client.from('games').update({ aggregate_applied_at: marker }).eq('id', game.id);
    expect(markError).toBeNull();
    const scopeRow = {
      scope_type: 'tournament' as const, scope_id: ids.tournament, pokemon_name: `Rollback${RUN}`, total_appearances: 2,
      total_brought: 2, total_led: 0, total_kos_dealt: 1, total_koed: 0, total_wins: 2, total_games: 2, move_counts: {},
    };
    const { error: aggError } = await client.from('aggregates').insert(scopeRow);
    expect(aggError).toBeNull();
    const deltas = {
      aggregateDeltas: [{
        scope_type: 'tournament', scope_id: ids.tournament, pokemon_name: scopeRow.pokemon_name, appearances: 1, brought: 1,
        led: 0, kos_dealt: 1, koed: 0, wins: 1, games: 1, move_counts: {},
      }],
      playerDeltas: [],
    };
    const readCount = async () => {
      const { data, error } = await client.from('aggregates').select('total_appearances')
        .eq('scope_type', 'tournament').eq('scope_id', ids.tournament).eq('pokemon_name', scopeRow.pokemon_name);
      if (error) throw error;
      return data.map((row) => row.total_appearances);
    };

    try {
      // A stale marker (a concurrent re-apply) changes nothing.
      await expect(aggregates.rollbackGameAggregates(game.id, '2026-10-18T09:00:00+00:00', deltas)).resolves.toBe('marker_changed');
      expect(await readCount()).toEqual([2]);
      // Two concurrent rollbacks with the same marker: exactly one decrements.
      const outcomes = await Promise.all([
        aggregates.rollbackGameAggregates(game.id, marker, deltas),
        aggregates.rollbackGameAggregates(game.id, marker, deltas),
      ]);
      expect([...outcomes].sort()).toEqual(['not_applied', 'rolled_back']);
      expect(await readCount()).toEqual([1]);
      expect((await games.getGameById(game.id))?.aggregate_applied_at).toBeNull();
    } finally {
      await client.from('aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament);
    }
  });
});
