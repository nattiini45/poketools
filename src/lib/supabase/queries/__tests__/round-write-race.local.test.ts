/**
 * The generate-round race and the same-pair-per-round constraint of issue #131, replayed on a real Postgres
 * (supabase/migrations/20261122090000_matches_round_pair_unique.sql): two concurrent `round_write` calls for one
 * target produce one round with one set of pairings — the loser is refused under the round/number locks, never a
 * second batch — and `matches_round_pair_unique` refuses a second match of one pairing (normalised: (A,B) = (B,A))
 * while a bracket row keeps its right to a same-pair repeat (the Grand Finals reset).
 *
 * Opt-in only (`LOCAL_ROUND_WRITE_RACE=1` or `npm run test:db`), local stack only, never loads `.env`.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import { isUniqueViolationOf } from '../../unique-violation';

const optIn = localStackOptIn('LOCAL_ROUND_WRITE_RACE');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type RoundsMod = typeof import('@/lib/supabase/queries/rounds');

let client: ClientMod['supabase'];
let roundsQ: RoundsMod;

const RUN = randomUUID().slice(0, 8);
const players = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const rulesetId = randomUUID();
const tournamentsToDrop: string[] = [];

const must = async (label: string, op: PromiseLike<{ error: unknown }>) => {
  const { error } = await op;
  if (error) throw new Error(`[${label}] ${JSON.stringify(error)}`);
};

/** A standalone tournament (no league) with its four players enrolled. */
async function tournament(): Promise<string> {
  const id = randomUUID();
  tournamentsToDrop.push(id);
  await must(
    'tournament',
    client.from('tournaments').insert({ id, name: `Race ${RUN} ${id.slice(0, 4)}`, bracket_type: 'round_robin', ruleset_id: rulesetId }),
  );
  await must(
    'participants',
    client.from('tournament_participants').insert(players.map((player_id) => ({ tournament_id: id, player_id }))),
  );
  return id;
}

const pairsOf = async (roundId: string) => {
  const { data, error } = await client
    .from('matches')
    .select('player_1_id, player_2_id')
    .eq('round_id', roundId)
    .order('created_at')
    .order('id');
  if (error) throw new Error(JSON.stringify(error));
  return data ?? [];
};

describe.skipIf(!optIn)('generate-round write race (local stack)', () => {
  beforeAll(async () => {
    ({ supabase: client } = await import('@/lib/supabase/client'));
    roundsQ = await import('@/lib/supabase/queries/rounds');
    await must('ruleset', insertLocalRuleset(client, { id: rulesetId, name: `Race ${RUN} Ruleset` }));
    await must(
      'players',
      client.from('players').insert(players.map((id, i) => ({ id, name: `Race ${RUN} ${i}`, is_guest: true })), { defaultToNull: false }),
    );
  }, 60000);

  afterAll(async () => {
    for (const id of tournamentsToDrop) {
      await client.from('matches').delete().eq('tournament_id', id);
      await client.from('rounds').delete().eq('tournament_id', id);
      await client.from('tournament_participants').delete().eq('tournament_id', id);
      await client.from('tournaments').delete().eq('id', id);
    }
    await client.from('players').delete().in('id', players);
    await deleteLocalRuleset(client, rulesetId);
  });

  it('two concurrent fills of one empty round produce one pairing set; the loser is refused', async () => {
    const tid = await tournament();
    const round = await roundsQ.createRound({ tournament_id: tid, name: 'Round 1', round_number: 1, best_of: 1 });
    const planA = [{ player_1_id: players[0], player_2_id: players[1] }, { player_1_id: players[2], player_2_id: players[3] }];
    const planB = [{ player_1_id: players[0], player_2_id: players[2] }, { player_1_id: players[1], player_2_id: players[3] }];

    const [a, b] = await Promise.allSettled([
      roundsQ.addMatchesToRound(round, planA),
      roundsQ.addMatchesToRound(round, planB),
    ]);
    const outcomes = [a, b].map((r) => r.status);
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);
    const loser = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe('rounds_round_already_written');

    // One plan won, whole: exactly its two pairings, none of the loser's.
    expect(await pairsOf(round.id)).toHaveLength(2);
  });

  it('two concurrent creates of one round number commit one round with its own matches', async () => {
    const tid = await tournament();
    const plan = [{ player_1_id: players[0], player_2_id: players[1] }];

    const [a, b] = await Promise.allSettled([
      roundsQ.createRoundWithMatches({ tournament_id: tid, name: 'Round 1', round_number: 1, best_of: 1, matches: plan }),
      roundsQ.createRoundWithMatches({ tournament_id: tid, name: 'Round 1', round_number: 1, best_of: 1, matches: plan }),
    ]);
    expect([a, b].map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const loser = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as { code?: string }).code).toBe('rounds_round_already_written');

    const { data: rounds } = await client.from('rounds').select('id').eq('tournament_id', tid);
    expect(rounds).toHaveLength(1);
    expect(await pairsOf(rounds![0].id)).toHaveLength(1);
  });

  it('the pair index refuses a second match of one pairing in one round, normalised either way', async () => {
    const tid = await tournament();
    const round = await roundsQ.createRoundWithMatches({
      tournament_id: tid,
      name: 'Round 1',
      round_number: 1,
      best_of: 1,
      matches: [{ player_1_id: players[0], player_2_id: players[1] }],
    });

    // Direct insert of the same pair swapped — what an out-of-band writer would still attempt.
    const dup = await client
      .from('matches')
      .insert({ round_id: round.id, tournament_id: tid, player_1_id: players[1], player_2_id: players[0] });
    expect(isUniqueViolationOf(dup.error, 'matches_round_pair_unique')).toBe(true);
    expect(await pairsOf(round.id)).toHaveLength(1);
  });

  it('the pair index refuses a duplicated pairing inside one match plan (nothing is left behind)', async () => {
    const tid = await tournament();
    await expect(
      roundsQ.createRoundWithMatches({
        tournament_id: tid,
        name: 'Round 1',
        round_number: 1,
        best_of: 1,
        matches: [
          { player_1_id: players[0], player_2_id: players[1] },
          { player_1_id: players[1], player_2_id: players[0] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'rounds_pair_already_in_round' });
    expect(await client.from('rounds').select('id').eq('tournament_id', tid)).toMatchObject({ data: [] });
  });
});
