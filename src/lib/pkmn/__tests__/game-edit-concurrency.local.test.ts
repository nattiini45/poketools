import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL proof of the editGame concurrency guard (version claim plus edit
// lease, supabase/migrations/20261019100000_games_edit_lease.sql):
//   - two concurrent edits of ONE game (a double submit of Save, two admins)
//     carrying the same editor version: exactly one claims the version and the
//     lease and is saved; the other answers 409 (`admin_game_edit_in_progress`
//     while the winner runs, `admin_game_edit_stale` once it finished) with
//     nothing written, so the game's battle_stats are exactly the winner's and
//     the aggregates count the game exactly once, with the winner's stats.
//     Proven for a counted game (marker set: the winner rolls back and
//     re-applies) and for an uncounted game without stats (marker NULL: no
//     rollback fence exists, only the claim);
//   - an editor RELOADED while an edit runs (it holds the current version) is
//     refused by the running edit's lease, deterministically: the running edit
//     is paused right after its claim;
//   - a lease left behind (an edit whose process died) expires.
// It runs the real pipeline against a LOCAL Supabase stack.
// Opt-in only, never in CI, and it never loads `.env`: every value comes from
// the command line.
//
//   LOCAL_SUPABASE_GAME_EDIT=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/pkmn/__tests__/game-edit-concurrency.local.test.ts
const optIn = process.env.LOCAL_SUPABASE_GAME_EDIT === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[game-edit-concurrency.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[game-edit-concurrency.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`,
    );
  }
}

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error(
      '[game-edit-concurrency.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY on the command line',
    );
  }
}

/**
 * A pause point inside a running edit: `editGame` cancels the game's queued
 * aggregate jobs right after it claimed its lease, so a test can hold an edit
 * there (lease held, nothing else written yet) and act while it runs.
 */
const pause = vi.hoisted(() => ({
  hold: null as null | { gameId: string; reached: () => void; release: Promise<void> },
}));

vi.mock('@/lib/match/aggregate-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/match/aggregate-queue')>();
  return {
    ...actual,
    cancelAggregateJobsForGame: async (gameId: string) => {
      const hold = pause.hold;
      if (hold && hold.gameId === gameId) {
        pause.hold = null;
        hold.reached();
        await hold.release;
      }
      return actual.cancelAggregateJobsForGame(gameId);
    },
  };
});

type ClientMod = typeof import('@/lib/supabase/client');
type GamesMod = typeof import('@/lib/supabase/queries/games');
type AggregatesMod = typeof import('@/lib/supabase/queries/aggregates');
type QueueMod = typeof import('@/lib/match/aggregate-queue');
type PipelineMod = typeof import('@/lib/pkmn/game-pipeline');

let client: ClientMod['supabase'];
let games: GamesMod;
let aggregates: AggregatesMod;
let queue: QueueMod;
let pipeline: PipelineMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  admin: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  tournament: randomUUID(),
  round: randomUUID(),
  match: randomUUID(),
};
// Run-unique species names: the tournament scope rows of this run only.
const MON_A = `EditRaceA${RUN}`;
const MON_B = `EditRaceB${RUN}`;
const MON_SEED = `EditRaceSeed${RUN}`;

interface AggregateRow {
  pokemon_name: string;
  total_appearances: number;
  total_kos_dealt: number;
}

describe.skipIf(!optIn)('editGame concurrency: version claim and edit lease (local stack)', () => {
  beforeAll(async () => {
    assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    ({ supabase: client } = await import('@/lib/supabase/client'));
    games = await import('@/lib/supabase/queries/games');
    aggregates = await import('@/lib/supabase/queries/aggregates');
    queue = await import('@/lib/match/aggregate-queue');
    pipeline = await import('@/lib/pkmn/game-pipeline');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };

    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `EditRace ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert([
        { id: ids.admin, name: `EditRace ${RUN} Admin`, discord_id: `editrace-${RUN}-d0` },
        { id: ids.p1, name: `EditRace ${RUN} Ada`, discord_id: `editrace-${RUN}-d1` },
        { id: ids.p2, name: `EditRace ${RUN} Bram`, discord_id: `editrace-${RUN}-d2` },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert({ id: ids.tournament, name: `EditRace ${RUN} Open`, bracket_type: 'swiss', ruleset_id: ids.ruleset }),
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
    // battle_stats and aggregate_jobs go with their games (ON DELETE CASCADE).
    await del('games', client.from('games').delete().eq('match_id', ids.match));
    await del('aggregates', client.from('aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament));
    await del(
      'player_aggregates',
      client.from('player_aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament),
    );
    await del('matches', client.from('matches').delete().eq('id', ids.match));
    await del('rounds', client.from('rounds').delete().eq('id', ids.round));
    await del('tournaments', client.from('tournaments').delete().eq('id', ids.tournament));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', [ids.admin, ids.p1, ids.p2]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  async function tournamentAggregates(): Promise<AggregateRow[]> {
    const { data, error } = await client
      .from('aggregates')
      .select('pokemon_name, total_appearances, total_kos_dealt')
      .eq('scope_type', 'tournament')
      .eq('scope_id', ids.tournament)
      .order('pokemon_name');
    if (error) throw error;
    return data;
  }

  async function statsOf(gameId: string): Promise<{ pokemon_name: string; kos_dealt: number }[]> {
    const { data, error } = await client
      .from('battle_stats')
      .select('pokemon_name, kos_dealt')
      .eq('game_id', gameId)
      .order('pokemon_name');
    if (error) throw error;
    return data;
  }

  /** A game of this run's match; all_time excluded, no season: only the tournament scope is counted. */
  async function newGame(gameNumber: number) {
    return games.createGame({
      match_id: ids.match,
      game_number: gameNumber,
      winner_id: ids.p1,
      source: 'manual',
      exclude_all_time: true,
    });
  }

  /** Two concurrent saves of the same editor version with different stats. */
  async function raceTwoEdits(gameId: string, version: string) {
    const edit = (mon: string, kos: number) =>
      pipeline.editGame({
        game_id: gameId,
        admin_id: ids.admin,
        winner_id: ids.p1,
        battle_stats: [{ player_id: ids.p1, pokemon_name: mon, kos_dealt: kos }],
        expected_updated_at: version,
      });
    return Promise.allSettled([edit(MON_A, 1), edit(MON_B, 2)]);
  }

  function expectOneSavedOneStale(results: PromiseSettledResult<unknown>[]): 'A' | 'B' {
    const fulfilled = results.findIndex((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toBeGreaterThanOrEqual(0);
    expect(rejected).toHaveLength(1);
    // While the winner runs its lease refuses the loser; after it finished, the moved version does.
    expect(['admin_game_edit_in_progress', 'admin_game_edit_stale']).toContain(
      (rejected[0].reason as { code?: string }).code,
    );
    expect(rejected[0].reason).toMatchObject({ statusCode: 409 });
    return fulfilled === 0 ? 'A' : 'B';
  }

  async function leaseOf(gameId: string): Promise<{ edit_lease_token: string | null; edit_lease_until: string | null }> {
    const { data, error } = await client
      .from('games')
      .select('edit_lease_token, edit_lease_until')
      .eq('id', gameId)
      .single();
    if (error) throw error;
    return data;
  }

  it('a counted game: one edit wins, the other is refused with nothing written; counted exactly once', async () => {
    const game = await newGame(1);
    const seedStats = await games.createBattleStats([
      {
        game_id: game.id, player_id: ids.p1, pokemon_name: MON_SEED, was_brought: true, was_lead: true,
        kos_dealt: 3, was_koed: false, moves_used: [], turns_active: 4, match_won: true,
      },
    ]);
    await queue.applyGameAggregatesNow(
      game.id, ids.tournament, null,
      aggregates.buildGameAggregateDeltas(seedStats, ids.tournament, null, { excludeAllTime: true }),
    );
    const counted = await games.getGameById(game.id);
    expect(counted?.aggregate_applied_at).not.toBeNull();
    expect(await tournamentAggregates()).toEqual([
      { pokemon_name: MON_SEED, total_appearances: 1, total_kos_dealt: 3 },
    ]);

    const winner = expectOneSavedOneStale(await raceTwoEdits(game.id, counted!.updated_at));
    const [mon, kos] = winner === 'A' ? [MON_A, 1] : [MON_B, 2];

    // Exactly the winner's stats (no interleaving), counted exactly once; the seed stats rolled back once.
    expect(await statsOf(game.id)).toEqual([{ pokemon_name: mon, kos_dealt: kos }]);
    expect(await tournamentAggregates()).toEqual([{ pokemon_name: mon, total_appearances: 1, total_kos_dealt: kos }]);
    const after = await games.getGameById(game.id);
    expect(after?.aggregate_applied_at).not.toBeNull();
    expect(after?.aggregate_applied_at).not.toBe(counted!.aggregate_applied_at);
  }, 60000);

  it('an uncounted game without stats: one edit wins, the other is refused; no duplicate stats, counted once', async () => {
    // Clean the tournament scope of the previous case so this one starts at zero.
    await client.from('aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament);
    await client.from('player_aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament);

    const game = await newGame(2);
    const fresh = await games.getGameById(game.id);
    expect(fresh?.aggregate_applied_at).toBeNull();

    const winner = expectOneSavedOneStale(await raceTwoEdits(game.id, fresh!.updated_at));
    const [mon, kos] = winner === 'A' ? [MON_A, 1] : [MON_B, 2];

    expect(await statsOf(game.id)).toEqual([{ pokemon_name: mon, kos_dealt: kos }]);
    expect(await tournamentAggregates()).toEqual([{ pokemon_name: mon, total_appearances: 1, total_kos_dealt: kos }]);
  }, 60000);

  it('a save from an editor opened before the last change is refused (stale version), nothing written', async () => {
    const game = await newGame(3);
    const opened = await games.getGameById(game.id);
    // Another admin saves first (it claims and moves the version on).
    await pipeline.editGame({
      game_id: game.id, admin_id: ids.admin, winner_id: ids.p2,
      battle_stats: [{ player_id: ids.p2, pokemon_name: MON_A, kos_dealt: 1 }],
      expected_updated_at: opened!.updated_at,
    });
    const before = await statsOf(game.id);

    await expect(
      pipeline.editGame({
        game_id: game.id, admin_id: ids.admin, winner_id: ids.p1,
        battle_stats: [{ player_id: ids.p1, pokemon_name: MON_B, kos_dealt: 2 }],
        expected_updated_at: opened!.updated_at,
      }),
    ).rejects.toMatchObject({ code: 'admin_game_edit_stale', statusCode: 409 });

    expect(await statsOf(game.id)).toEqual(before);
    expect((await games.getGameById(game.id))?.winner_id).toBe(ids.p2);
  }, 60000);

  it('an editor reloaded while an edit runs is refused by the lease (409 in progress), nothing written; the running edit wins', async () => {
    // Uncounted, no stats: the case no rollback fence covers.
    await client.from('aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament);
    await client.from('player_aggregates').delete().eq('scope_type', 'tournament').eq('scope_id', ids.tournament);
    const game = await newGame(4);
    const opened = await games.getGameById(game.id);
    expect(opened?.aggregate_applied_at).toBeNull();

    let reached!: () => void;
    const atPause = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    pause.hold = { gameId: game.id, reached, release: released };

    // Edit A starts and is held right after its claim.
    const editA = pipeline.editGame({
      game_id: game.id, admin_id: ids.admin, winner_id: ids.p1,
      battle_stats: [{ player_id: ids.p1, pokemon_name: MON_A, kos_dealt: 1 }],
      expected_updated_at: opened!.updated_at,
    });
    const settledA = editA.then(() => 'fulfilled' as const, (err: unknown) => err);
    await atPause;

    try {
      // A holds the lease, and its claim moved the version on.
      const running = await games.getGameById(game.id);
      expect(running!.updated_at).not.toBe(opened!.updated_at);
      const lease = await leaseOf(game.id);
      expect(lease.edit_lease_token).not.toBeNull();
      expect(new Date(lease.edit_lease_until!).getTime()).toBeGreaterThan(Date.now() - 5000);

      // Editor B is reloaded NOW: it holds the CURRENT version, so only the lease can refuse it.
      await expect(
        pipeline.editGame({
          game_id: game.id, admin_id: ids.admin, winner_id: ids.p2,
          battle_stats: [{ player_id: ids.p2, pokemon_name: MON_B, kos_dealt: 2 }],
          expected_updated_at: running!.updated_at,
        }),
      ).rejects.toMatchObject({ code: 'admin_game_edit_in_progress', statusCode: 409 });

      // B wrote nothing: same version, same lease, no stats yet.
      expect((await games.getGameById(game.id))!.updated_at).toBe(running!.updated_at);
      expect((await leaseOf(game.id)).edit_lease_token).toBe(lease.edit_lease_token);
      expect(await statsOf(game.id)).toEqual([]);
    } finally {
      release();
    }

    expect(await settledA).toBe('fulfilled');
    // Exactly A's stats, counted once; the lease is released.
    expect(await statsOf(game.id)).toEqual([{ pokemon_name: MON_A, kos_dealt: 1 }]);
    expect(await tournamentAggregates()).toEqual([{ pokemon_name: MON_A, total_appearances: 1, total_kos_dealt: 1 }]);
    expect(await leaseOf(game.id)).toEqual({ edit_lease_token: null, edit_lease_until: null });
    const after = await games.getGameById(game.id);
    expect(after!.winner_id).toBe(ids.p1);
  }, 60000);

  it('a lease left behind by an edit that died expires: the next edit claims it', async () => {
    const game = await newGame(5);
    // An edit whose process died after its claim: lease token set, expiry passed.
    const { error } = await client
      .from('games')
      .update({ edit_lease_token: randomUUID(), edit_lease_until: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', game.id);
    if (error) throw error;
    const current = await games.getGameById(game.id);

    await pipeline.editGame({
      game_id: game.id, admin_id: ids.admin, winner_id: ids.p2,
      battle_stats: [{ player_id: ids.p2, pokemon_name: MON_B, kos_dealt: 2 }],
      expected_updated_at: current!.updated_at,
    });

    expect(await statsOf(game.id)).toEqual([{ pokemon_name: MON_B, kos_dealt: 2 }]);
    expect(await leaseOf(game.id)).toEqual({ edit_lease_token: null, edit_lease_until: null });
  }, 60000);
});
