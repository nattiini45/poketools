import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// LIVE-LOCAL proof of the PostgREST shapes behind the admin match list
// (`listAdminMatchesPage`) that the mocked unit tests cannot prove:
//   - the anti-join `games=is.null` ("no games recorded"), and the same combined
//     with the embedded filter `games.replay_url=neq.` ("no replay");
//   - `tournaments.or=(season_id.is.null,season_id.not.in.(...))` through
//     `or(..., { referencedTable })` (test leagues hidden, standalone kept);
//   - the nested path `tournaments.seasons.format_type` with `seasons!inner`;
//   - the to-one embed order `rounds(deadline)` with nulls last;
//   - the two-step read: a filter on the `games` embed never shrinks the
//     `games` of a returned row.
// It seeds its own run-unique rows into a LOCAL Supabase stack and removes them
// again. Opt-in only, never in CI, and it never loads `.env`: every value comes
// from the command line.
//
//   LOCAL_SUPABASE_MATCH_LIST=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/supabase/queries/__tests__/matches-admin-list.local.test.ts
const optIn = process.env.LOCAL_SUPABASE_MATCH_LIST === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[matches-admin-list.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[matches-admin-list.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`,
    );
  }
}

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error(
      '[matches-admin-list.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY on the command line',
    );
  }
}

type ClientMod = typeof import('@/lib/supabase/client');
type MatchesMod = typeof import('@/lib/supabase/queries/matches');

let client: ClientMod['supabase'];
let queries: MatchesMod;

const RUN = randomUUID().slice(0, 8);
const id = () => randomUUID();
const ids = {
  rulesetA: id(),
  rulesetB: id(),
  pA: id(),
  pB: id(),
  pC: id(),
  seasonLive: id(),
  seasonTest: id(),
  seasonArchived: id(),
  tLive: id(),
  tTest: id(),
  tArchivedLeague: id(),
  tArchived: id(),
  tSolo: id(),
  rLive1: id(),
  rLive2: id(),
  rLive3: id(),
  rTest: id(),
  rArchivedLeague: id(),
  rArchived: id(),
  rSolo: id(),
  m1: id(),
  m2: id(),
  m3: id(),
  m4: id(),
  m5: id(),
  m6: id(),
  m7: id(),
  m8: id(),
  m9: id(),
};
const allTournaments = [ids.tLive, ids.tTest, ids.tArchivedLeague, ids.tArchived, ids.tSolo];

const REPLAY = 'https://replay.pokemonshowdown.com/gen9ou-1';

describe.skipIf(!optIn)('admin match list: PostgREST shapes (local stack)', () => {
  beforeAll(async () => {
    assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    ({ supabase: client } = await import('@/lib/supabase/client'));
    queries = await import('@/lib/supabase/queries/matches');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };

    await run(
      'rulesets',
      client.from('rulesets').insert([
        { id: ids.rulesetA, name: `MatchList ${RUN} Ruleset A` },
        { id: ids.rulesetB, name: `MatchList ${RUN} Ruleset B` },
      ]),
    );
    await run(
      'players',
      client.from('players').insert(
        [
          { id: ids.pA, name: `MatchList ${RUN} Ada`, discord_id: `matchlist-${RUN}-a` },
          { id: ids.pB, name: `MatchList ${RUN} Bram`, discord_id: `matchlist-${RUN}-b` },
          { id: ids.pC, name: `MatchList ${RUN} Cleo`, discord_id: `matchlist-${RUN}-c` },
        ],
        { defaultToNull: false },
      ),
    );
    await run(
      'seasons',
      client.from('seasons').insert([
        { id: ids.seasonLive, name: `MatchList ${RUN} Live`, format_type: 'draft' },
        { id: ids.seasonTest, name: `MatchList ${RUN} Test`, format_type: 'singles', is_test_season: true },
        { id: ids.seasonArchived, name: `MatchList ${RUN} Archived`, format_type: 'singles', archived: true },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert([
        { id: ids.tLive, name: `ML ${RUN} live`, bracket_type: 'swiss', ruleset_id: ids.rulesetA, season_id: ids.seasonLive },
        { id: ids.tTest, name: `ML ${RUN} test`, bracket_type: 'round_robin', ruleset_id: ids.rulesetB, season_id: ids.seasonTest },
        // Archiving a league archives its tournaments (archiveTournamentsBySeason), and a phase can be archived alone.
        { id: ids.tArchivedLeague, name: `ML ${RUN} archived league`, bracket_type: 'swiss', ruleset_id: ids.rulesetA, season_id: ids.seasonArchived, archived: true },
        { id: ids.tArchived, name: `ML ${RUN} archived`, bracket_type: 'swiss', ruleset_id: ids.rulesetA, season_id: ids.seasonLive, archived: true },
        { id: ids.tSolo, name: `ML ${RUN} solo`, bracket_type: 'single_elim', ruleset_id: ids.rulesetA },
      ], { defaultToNull: false }),
    );
    await run(
      'rounds',
      client.from('rounds').insert([
        { id: ids.rLive1, tournament_id: ids.tLive, name: 'Round 1', round_number: 1, best_of: 3, deadline: '2026-01-01T00:00:00Z' },
        { id: ids.rLive2, tournament_id: ids.tLive, name: 'Round 2', round_number: 2, best_of: 3, deadline: '2026-06-01T00:00:00Z' },
        { id: ids.rLive3, tournament_id: ids.tLive, name: 'Round 3', round_number: 3, best_of: 5 },
        { id: ids.rTest, tournament_id: ids.tTest, name: 'Round 1', round_number: 1, best_of: 3 },
        { id: ids.rArchivedLeague, tournament_id: ids.tArchivedLeague, name: 'Round 1', round_number: 1, best_of: 3 },
        { id: ids.rArchived, tournament_id: ids.tArchived, name: 'Round 1', round_number: 1, best_of: 3 },
        { id: ids.rSolo, tournament_id: ids.tSolo, name: 'Round 1', round_number: 1, best_of: 1 },
      ], { defaultToNull: false }),
    );

    const match = (
      matchId: string,
      tournament: string,
      round: string,
      p1: string,
      p2: string,
      extra: Record<string, unknown> = {},
    ) => ({ id: matchId, tournament_id: tournament, round_id: round, player_1_id: p1, player_2_id: p2, ...extra });
    await run(
      'matches',
      client.from('matches').insert([
        // m1: scheduled, no games, scheduled time set.
        match(ids.m1, ids.tLive, ids.rLive1, ids.pA, ids.pB, { scheduled_at: '2026-10-25T12:00:00Z' }),
        // m2: in progress, one hand-edited game with a replay and one without.
        match(ids.m2, ids.tLive, ids.rLive1, ids.pA, ids.pC, { status: 'in_progress' }),
        // m3: completed, one manual game without a replay, admin notes.
        match(ids.m3, ids.tLive, ids.rLive1, ids.pB, ids.pC, { status: 'completed', notes: 'checked' }),
        // m4: a test league's match, m5/m9: archived league / archived tournament.
        match(ids.m4, ids.tTest, ids.rTest, ids.pA, ids.pB),
        match(ids.m5, ids.tArchivedLeague, ids.rArchivedLeague, ids.pA, ids.pC),
        match(ids.m9, ids.tArchived, ids.rArchived, ids.pB, ids.pC),
        // m6: standalone.
        match(ids.m6, ids.tSolo, ids.rSolo, ids.pB, ids.pC, { status: 'disputed' }),
        // m7 / m8: rounds with a later deadline and with none.
        match(ids.m7, ids.tLive, ids.rLive2, ids.pA, ids.pB, { status: 'pending_confirmation' }),
        match(ids.m8, ids.tLive, ids.rLive3, ids.pA, ids.pB),
      ], { defaultToNull: false }),
    );
    await run(
      'games',
      client.from('games').insert([
        { match_id: ids.m2, game_number: 1, replay_url: REPLAY, stats_locked: true, source: 'ps_replay' },
        { match_id: ids.m2, game_number: 2, replay_url: '', stats_locked: false, source: 'manual' },
        { match_id: ids.m3, game_number: 1, replay_url: '', stats_locked: false, source: 'manual' },
      ], { defaultToNull: false }),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    const matchIds = [ids.m1, ids.m2, ids.m3, ids.m4, ids.m5, ids.m6, ids.m7, ids.m8, ids.m9];
    await del('games', client.from('games').delete().in('match_id', matchIds));
    await del('matches', client.from('matches').delete().in('id', matchIds));
    await del('rounds', client.from('rounds').delete().in('tournament_id', allTournaments));
    await del('tournaments', client.from('tournaments').delete().in('id', allTournaments));
    await del('seasons', client.from('seasons').delete().in('id', [ids.seasonLive, ids.seasonTest, ids.seasonArchived]));
    await del('rulesets', client.from('rulesets').delete().in('id', [ids.rulesetA, ids.rulesetB]));
    await del('players', client.from('players').delete().in('id', [ids.pA, ids.pB, ids.pC]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  /** Ids of this run's matches that a request returns (other rows of the local database are out of scope). */
  async function list(params: Partial<import('@/lib/supabase/queries/matches').AdminMatchListParams> = {}) {
    const result = await queries.listAdminMatchesPage({
      tournamentIds: allTournaments,
      page: 1,
      pageSize: 100,
      includeTest: true,
      includeArchived: true,
      ...params,
    });
    const nameOf = new Map<string, string>(Object.entries(ids).map(([name, value]) => [value, name]));
    return { ...result, names: result.rows.map((row) => nameOf.get(row.id) ?? row.id) };
  }

  const sorted = (names: string[]) => [...names].sort();

  it('"no games recorded": the anti-join returns exactly the matches without a game', async () => {
    const { names, total } = await list({ noGames: true });
    expect(sorted(names)).toEqual(['m1', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(total).toBe(7);
  });

  it('"no replay": no game with a replay URL, which keeps a manual game without one', async () => {
    const { names, total } = await list({ replay: 'none' });
    // m3 has a game, but none with a replay; m2 has one with a replay and must be gone.
    expect(sorted(names)).toEqual(['m1', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(total).toBe(8);
  });

  it('"has replay" and "hand-edited" read the same game row, and the row keeps all its games', async () => {
    const has = await list({ replay: 'has' });
    expect(has.names).toEqual(['m2']);
    expect(has.total).toBe(1);
    // The filter narrowed the embed only for the id read: the hydrated row still has both games.
    expect(has.rows[0].games).toHaveLength(2);

    expect((await list({ handEdited: true })).names).toEqual(['m2']);
    expect((await list({ replay: 'has', handEdited: true })).names).toEqual(['m2']);
  });

  it('admin notes are a column of the match', async () => {
    expect((await list({ hasNotes: true })).names).toEqual(['m3']);
  });

  it('hides test leagues (standalone kept) and archived leagues and tournaments, until asked', async () => {
    const hidden = await list({ includeTest: false, includeArchived: false });
    expect(sorted(hidden.names)).toEqual(['m1', 'm2', 'm3', 'm6', 'm7', 'm8']);
    expect(hidden.total).toBe(6);

    expect(sorted((await list({ includeTest: true, includeArchived: false })).names)).toEqual([
      'm1', 'm2', 'm3', 'm4', 'm6', 'm7', 'm8',
    ]);
    expect(sorted((await list({ includeTest: false, includeArchived: true })).names)).toEqual([
      'm1', 'm2', 'm3', 'm5', 'm6', 'm7', 'm8', 'm9',
    ]);
  });

  it('maps the test and archived flags of the row', async () => {
    const { rows } = await list();
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.m4)).toMatchObject({ season_is_test: true, archived: false });
    expect(byId.get(ids.m5)).toMatchObject({ season_is_test: false, archived: true });
    expect(byId.get(ids.m9)).toMatchObject({ archived: true });
    expect(byId.get(ids.m1)).toMatchObject({ season_is_test: false, archived: false, round_name: 'Round 1', best_of: 3 });
    expect(byId.get(ids.m6)).toMatchObject({ season_id: null, season_is_test: false });
  });

  it('league format goes through the nested seasons embed; standalone tournaments have none', async () => {
    expect(sorted((await list({ formatType: 'draft' })).names)).toEqual(['m1', 'm2', 'm3', 'm7', 'm8', 'm9']);
    expect(sorted((await list({ formatType: 'singles' })).names)).toEqual(['m4', 'm5']);
    expect((await list({ formatType: 'doubles' })).names).toEqual([]);
  });

  it('bracket type, ruleset and best of filter through their embeds', async () => {
    expect(sorted((await list({ bracketType: 'round_robin' })).names)).toEqual(['m4']);
    expect(sorted((await list({ bracketType: 'single_elim' })).names)).toEqual(['m6']);
    expect(sorted((await list({ rulesetId: ids.rulesetB })).names)).toEqual(['m4']);
    expect(sorted((await list({ bestOf: 5 })).names)).toEqual(['m8']);
    expect(sorted((await list({ bestOf: 1 })).names)).toEqual(['m6']);
  });

  it('orders by the round deadline through the to-one embed, matches without a deadline last', async () => {
    const scope = { tournamentIds: [ids.tLive] };
    const asc = await list({ ...scope, sort: 'deadline_asc' });
    // Deadlines: round 1 (m1, m2, m3) < round 2 (m7) < none (m8).
    expect(sorted(asc.names.slice(0, 3))).toEqual(['m1', 'm2', 'm3']);
    expect(asc.names.slice(3)).toEqual(['m7', 'm8']);
    const desc = await list({ ...scope, sort: 'deadline_desc' });
    // The latest deadline first, and still no deadline last.
    expect(desc.names[0]).toBe('m7');
    expect(sorted(desc.names.slice(1, 4))).toEqual(['m1', 'm2', 'm3']);
    expect(desc.names.at(-1)).toBe('m8');
  });

  it('overdue: a round deadline in the past, never for completed matches', async () => {
    const { names } = await list({ preset: 'overdue', now: new Date('2026-07-01T00:00:00Z') });
    // m1, m2 (round 1, 2026-01-01) and m7 (round 2, 2026-06-01) are past due; m3 is completed; m8 has no deadline.
    expect(sorted(names)).toEqual(['m1', 'm2', 'm7']);
    const earlier = await list({ preset: 'overdue', now: new Date('2026-03-01T00:00:00Z') });
    expect(sorted(earlier.names)).toEqual(['m1', 'm2']);
  });

  it('matches a player in either seat and a head-to-head in either order', async () => {
    expect(sorted((await list({ playerId: ids.pA })).names)).toEqual(['m1', 'm2', 'm4', 'm5', 'm7', 'm8']);
    expect(sorted((await list({ playerId: ids.pA, player2Id: ids.pB })).names)).toEqual(['m1', 'm4', 'm7', 'm8']);
    expect(sorted((await list({ playerId: ids.pB, player2Id: ids.pA })).names)).toEqual(['m1', 'm4', 'm7', 'm8']);
  });

  it('a date window and "date not set" on the scheduled time', async () => {
    const window = await list({ date: { field: 'scheduled', from: '2026-10-25T00:00:00Z', to: '2026-10-26T00:00:00Z' } });
    expect(window.names).toEqual(['m1']);
    const unset = await list({ date: { field: 'scheduled', none: true } });
    expect(sorted(unset.names)).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });

  it('status priority: disputed first, completed last, with the exact total', async () => {
    const { names, total } = await list({ sort: 'status_priority' });
    expect(total).toBe(9);
    expect(names[0]).toBe('m6'); // disputed
    expect(names[1]).toBe('m7'); // pending_confirmation
    expect(names[2]).toBe('m2'); // in_progress
    expect(names.at(-1)).toBe('m3'); // completed

    const secondPage = await queries.listAdminMatchesPage({
      tournamentIds: allTournaments,
      page: 2,
      pageSize: 4,
      includeTest: true,
      includeArchived: true,
      sort: 'status_priority',
    });
    expect(secondPage.total).toBe(9);
    expect(secondPage.rows.map((row) => row.id)).toEqual(names.slice(4, 8).map((name) => ids[name as keyof typeof ids]));
  });

  it('a page past the last row reports the real total', async () => {
    const result = await queries.listAdminMatchesPage({
      tournamentIds: allTournaments,
      page: 50,
      pageSize: 25,
      includeTest: true,
      includeArchived: true,
    });
    expect(result).toEqual({ rows: [], total: 9 });
  });

  it('lists the rounds of a tournament in play order and the names of the filter players', async () => {
    const rounds = await queries.listAdminMatchRounds(ids.tLive);
    expect(rounds.map((round) => round.name)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    const players = await queries.listMatchFilterPlayers([ids.pA, ids.pB], { visibleOnly: true });
    expect(players.map((player) => player.name).sort()).toEqual([`MatchList ${RUN} Ada`, `MatchList ${RUN} Bram`]);
  });

  it('lists the rulesets of the tournaments in scope', async () => {
    const options = await queries.listAdminMatchFilterOptions({ tournamentIds: allTournaments, seasonIds: [] });
    expect(options.rulesets.map((ruleset) => ruleset.id).sort()).toEqual([ids.rulesetA, ids.rulesetB].sort());
    expect(options.tournaments.find((t) => t.id === ids.tSolo)?.ruleset_id).toBe(ids.rulesetA);
  });
});
