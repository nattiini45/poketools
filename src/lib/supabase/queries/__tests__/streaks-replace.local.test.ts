import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof of the fenced streak write (supabase/migrations/20261102130000_streaks_replace_player.sql):
//   - a call whose expected match-id set differs from the player's completed matches raises PT409
//     (StreaksStaleError) and writes nothing;
//   - two finalizations of one player running at once (each completes a match, then rebuilds the player's
//     streaks) end with BOTH matches counted, with no zeroed row in between that a reader can keep.
// Opt-in only, never in CI without LOCAL_STACK_CI=1, and it never loads `.env`: every value comes from the
// command line.
//
//   LOCAL_SUPABASE_STREAKS=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/supabase/queries/__tests__/streaks-replace.local.test.ts
const optIn = localStackOptIn('LOCAL_SUPABASE_STREAKS');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error(
      '[streaks-replace.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY on the command line',
    );
  }
}

type ClientMod = typeof import('@/lib/supabase/client');
type StreaksQueries = typeof import('@/lib/supabase/queries/streaks');
type StreaksLib = typeof import('@/lib/gamification/streaks');

let client: ClientMod['supabase'];
let queries: StreaksQueries;
let lib: StreaksLib;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  tournament: randomUUID(),
  round: randomUUID(),
  matches: [randomUUID(), randomUUID(), randomUUID()],
  games: [randomUUID(), randomUUID(), randomUUID()],
};

const STATS = [
  { kosDealt: 3, wasKoed: false },
  { kosDealt: 3, wasKoed: false },
  { kosDealt: 0, wasKoed: true },
];

const ZERO_ROW = {
  current_win_streak: 0,
  best_win_streak: 0,
  current_loss_streak: 0,
  best_loss_streak: 0,
  current_ko_streak: 0,
  best_ko_streak: 0,
  current_flawless_streak: 0,
  best_flawless_streak: 0,
  last_match_id: null,
};

describe.skipIf(!optIn)('streaks_replace_player: fence and concurrent finalizes (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    queries = await import('@/lib/supabase/queries/streaks');
    lib = await import('@/lib/gamification/streaks');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };
    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Streaks ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert([
        { id: ids.p1, name: `Streaks ${RUN} Ada`, discord_id: `streaks-${RUN}-d1` },
        { id: ids.p2, name: `Streaks ${RUN} Bram`, discord_id: `streaks-${RUN}-d2` },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert({ id: ids.tournament, name: `Streaks ${RUN} Open`, bracket_type: 'swiss', ruleset_id: ids.ruleset }),
    );
    await run(
      'rounds',
      client.from('rounds').insert({ id: ids.round, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 1 }),
    );
    await run(
      'matches',
      client.from('matches').insert(
        ids.matches.map((id, i) => ({
          id,
          round_id: ids.round,
          tournament_id: ids.tournament,
          player_1_id: ids.p1,
          player_2_id: ids.p2,
          status: 'in_progress' as const,
          date_played: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
        })),
      ),
    );
    await run(
      'games',
      client.from('games').insert(
        ids.matches.map((matchId, i) => ({ id: ids.games[i], match_id: matchId, game_number: 1, replay_url: '', source: 'manual' as const })),
        { defaultToNull: false },
      ),
    );
    // The first two matches are clean KO wins; the third has no KO dealt and one lost, which breaks both streaks.
    // A rebuild that read the third match's history without its stats would wrongly keep them running.
    await run(
      'battle_stats',
      client.from('battle_stats').insert(
        STATS.map((stat, i) => ({
          game_id: ids.games[i],
          player_id: ids.p1,
          pokemon_name: 'Pikachu',
          kos_dealt: stat.kosDealt,
          was_koed: stat.wasKoed,
        })),
        { defaultToNull: false },
      ),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    await del('player_streaks', client.from('player_streaks').delete().in('player_id', [ids.p1, ids.p2]));
    await del('battle_stats', client.from('battle_stats').delete().in('game_id', ids.games));
    await del('games', client.from('games').delete().in('id', ids.games));
    await del('matches', client.from('matches').delete().in('id', ids.matches));
    await del('rounds', client.from('rounds').delete().eq('id', ids.round));
    await del('tournaments', client.from('tournaments').delete().eq('id', ids.tournament));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', [ids.p1, ids.p2]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  async function complete(matchId: string): Promise<void> {
    const { error } = await client.from('matches').update({ status: 'completed', winner_id: ids.p1 }).eq('id', matchId);
    if (error) throw error;
  }

  it('refuses a fence that disagrees with the completed matches (PT409) and writes nothing', async () => {
    await complete(ids.matches[0]);
    await expect(queries.replacePlayerStreaks(ids.p1, { ...ZERO_ROW, best_win_streak: 9 }, [])).rejects.toBeInstanceOf(
      queries.StreaksStaleError,
    );
    expect(await queries.getPlayerStreaks(ids.p1)).toBeNull();

    await queries.replacePlayerStreaks(ids.p1, { ...ZERO_ROW, current_win_streak: 1, best_win_streak: 1, last_match_id: ids.matches[0] }, [
      ids.matches[0],
    ]);
    expect((await queries.getPlayerStreaks(ids.p1))?.best_win_streak).toBe(1);
  });

  it('counts both matches, with their battle stats, when two finalizations of one player run at once', async () => {
    await Promise.all(
      [ids.matches[1], ids.matches[2]].map(async (matchId) => {
        await complete(matchId);
        await lib.recomputeStreaks(ids.p1);
      }),
    );

    const row = await queries.getPlayerStreaks(ids.p1);
    expect(row?.current_win_streak).toBe(3);
    expect(row?.best_win_streak).toBe(3);
    expect(row?.last_match_id).toBe(ids.matches[2]);
    // The third match's stats break the KO and flawless streaks of the first two; a rebuild that missed them
    // would leave both at 2.
    expect(row?.best_ko_streak).toBe(2);
    expect(row?.current_ko_streak).toBe(0);
    expect(row?.best_flawless_streak).toBe(2);
    expect(row?.current_flawless_streak).toBe(0);
  });

  it('reads the stats of the matches it is given, completed or not', async () => {
    const totals = await queries.getPlayerStatTotalsByMatch(ids.p1, ids.matches);
    expect([...totals.keys()].sort()).toEqual([...ids.matches].sort());
    expect(totals.get(ids.matches[2])).toEqual({ total_kos_dealt: 0, total_kos_lost: 1 });
    expect((await queries.getPlayerStatTotalsByMatch(ids.p1, [ids.matches[0]])).size).toBe(1);
  });

  it('is replay-safe: a second rebuild leaves the row identical', async () => {
    const before = await queries.getPlayerStreaks(ids.p1);
    await lib.recomputeStreaks(ids.p1);
    expect(await queries.getPlayerStreaks(ids.p1)).toEqual(before);
  });
});
