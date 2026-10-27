/**
 * Order of an Initial queue draft, replayed on a real Postgres: the pick order is drawn again every two rounds
 * (supabase/migrations/20261027190000_draft_start_reroll_every_two_rounds.sql). Opt-in and maintainer-only, local stack
 * only (see ./local-db.ts):
 *
 *   LOCAL_DB_URL=http://127.0.0.1:54321 LOCAL_DB_SERVICE_ROLE_KEY=<local service_role key> \
 *     npx vitest run src/lib/draft/__tests__/draft-start-reroll.live-db.test.ts
 *
 * Every scenario seeds its own league (players, list, season) through PostgREST, creates the pool with draft_create_pool,
 * starts it with draft_start and reads the queue back. The rows are removed afterwards; the append-only draft audit rows
 * (draft_action_log has no foreign keys and refuses deletes) stay behind with random ids, harmless on a local stack.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callRpc, connectLocalDb, LOCAL_DB_OPTED_IN } from './local-db';

const TAG = randomUUID().slice(0, 8);
const ROSTER_MAX_PLAYERS = 10;
const LINES = 200;

let db: SupabaseClient;
const seasonIds: string[] = [];
const poolIds: string[] = [];
let listVersionId = '';
let playerIds: string[] = [];

async function must<T extends { error: { message: string } | null }>(label: string, query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

interface Seeded {
  seasonId: string;
  poolId: string;
  /** The seated players, seat 1 first. */
  seats: string[];
}

/** A fresh evolution point-buy league with `n` participants seated in the order of `playerIds`, and its Initial pool. */
async function seedInitialPool(n: number, rosterSize: number): Promise<Seeded> {
  const seats = playerIds.slice(0, n);
  const seasonId = randomUUID();
  seasonIds.push(seasonId);
  await must('season', db.from('seasons').insert({ id: seasonId, name: `rr ${TAG} ${seasonId.slice(0, 6)}`, format_type: 'evolution_point_buy', status: 'active', point_buy_list_id: listVersionId }));
  await must('format_rules', db.from('format_rules').insert({ season_id: seasonId }));
  await must('season_participants', db.from('season_participants').insert(seats.map((player_id) => ({ season_id: seasonId, player_id }))));
  const poolId = (await callRpc(db, 'draft_create_pool', {
    p_season_id: seasonId,
    p_kind: 'initial',
    p_actor_id: seats[0],
    p_config: { roster_size: rosterSize, budget: 500 },
    p_seats: seats.map((player_id, i) => ({ player_id, seat: i + 1, standing_rank: i + 1 })),
  })) as string;
  poolIds.push(poolId);
  return { seasonId, poolId, seats };
}

interface Slot {
  player_id: string;
  round: number;
  sort_key: number;
  nominal_pick_number: number;
}

async function slotsOf(poolId: string): Promise<Slot[]> {
  const { data } = await must('slots', db.from('draft_slots').select('player_id, round, sort_key, nominal_pick_number').eq('draft_pool_id', poolId).order('sort_key'));
  return (data ?? []).map((s) => ({ ...(s as Slot), sort_key: Number(s.sort_key), nominal_pick_number: Number(s.nominal_pick_number) }));
}

const roundOf = (slots: Slot[], round: number): string[] => slots.filter((s) => s.round === round).map((s) => s.player_id);
const reversed = <T>(xs: readonly T[]): T[] => [...xs].reverse();

async function startedAudit(poolId: string): Promise<{ order_mode: string; pair_orders: string[][] }> {
  const { data } = await must('audit', db.from('draft_action_log').select('after').eq('draft_pool_id', poolId).eq('action', 'draft_started'));
  expect(data).toHaveLength(1);
  return data![0].after as { order_mode: string; pair_orders: string[][] };
}

describe.skipIf(!LOCAL_DB_OPTED_IN)('draft_start: the order is drawn again every two rounds (local stack, LOCAL_DB_URL)', () => {
  beforeAll(async () => {
    db = connectLocalDb(); // throws for a non-local URL
    listVersionId = randomUUID();
    await must('list', db.from('point_buy_list_versions').insert({ id: listVersionId, name: `rr list ${TAG}` }));
    await must('entries', db.from('point_buy_list_entries').insert(
      Array.from({ length: LINES }, (_, k) => ({
        list_version_id: listVersionId, line_number: k + 1, base_pokemon: `mon${k + 1}`, stage2_pokemon: `mon${k + 1}b`,
        price: 5, kills_to_stage2: 3, price_group: 'A', line_id: `mon${k + 1}--mon${k + 1}b`,
      })),
    ));
    playerIds = Array.from({ length: ROSTER_MAX_PLAYERS }, () => randomUUID());
    await must('players', db.from('players').insert(playerIds.map((id, i) => ({ id, name: `rr_${TAG}_${i}`, is_guest: true }))));
  });

  afterAll(async () => {
    if (!db) return;
    const attempt = async (what: string, q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q;
      if (error) console.warn(`[draft-start-reroll.live-db] cleanup ${what}: ${error.message}`);
    };
    if (poolIds.length) {
      await attempt('redraft_submissions', db.from('redraft_submissions').delete().in('draft_pool_id', poolIds));
      await attempt('draft_line_restrictions', db.from('draft_line_restrictions').delete().in('draft_pool_id', poolIds));
    }
    if (seasonIds.length) {
      await attempt('redraft_slots', db.from('redraft_slots').delete().in('season_id', seasonIds));
      await attempt('redraft_history', db.from('redraft_history').delete().in('season_id', seasonIds));
      await attempt('evolution_tracker', db.from('evolution_tracker').delete().in('season_id', seasonIds));
      await attempt('draft_pools (redraft)', db.from('draft_pools').delete().in('season_id', seasonIds).eq('kind', 'redraft'));
      await attempt('draft_pools', db.from('draft_pools').delete().in('season_id', seasonIds));
      await attempt('season_participants', db.from('season_participants').delete().in('season_id', seasonIds));
      await attempt('format_rules', db.from('format_rules').delete().in('season_id', seasonIds));
      await attempt('seasons', db.from('seasons').delete().in('id', seasonIds));
    }
    await attempt('players', db.from('players').delete().in('id', playerIds));
    await attempt('list entries', db.from('point_buy_list_entries').delete().eq('list_version_id', listVersionId));
    await attempt('list', db.from('point_buy_list_versions').delete().eq('id', listVersionId));
  });

  it.each([
    ['even roster, 8 trainers, 8 rounds', 8, 8],
    ['odd roster, 9 trainers, 9 rounds', 9, 9],
    ['odd roster, 8 trainers, 7 rounds', 8, 7],
    ['one round only', 4, 1],
    ['a lone second round', 3, 2],
  ])('%s: seats first, then a fresh permutation per pair, reversed in its second round', async (_label, n, rounds) => {
    const { poolId, seats } = await seedInitialPool(n, rounds);
    await callRpc(db, 'draft_start', { p_pool_id: poolId, p_actor_id: seats[0] });
    const slots = await slotsOf(poolId);

    // One slot per participant per round, running index 1..N*R for sort_key and nominal pick number.
    expect(slots).toHaveLength(n * rounds);
    expect(slots.map((s) => s.sort_key)).toEqual(Array.from({ length: n * rounds }, (_, i) => i + 1));
    expect(slots.map((s) => s.nominal_pick_number)).toEqual(slots.map((s) => s.sort_key));
    for (let round = 1; round <= rounds; round += 1) expect([...roundOf(slots, round)].sort()).toEqual([...seats].sort());

    // Rounds 1-2 follow the seats as they were at Start.
    expect(roundOf(slots, 1)).toEqual(seats);
    if (rounds >= 2) expect(roundOf(slots, 2)).toEqual(reversed(seats));

    // Every pair: second round = reverse of the first; a lone last round has no partner. The audit row records the pairs.
    const audit = await startedAudit(poolId);
    expect(audit.order_mode).toBe('snake_reroll');
    expect(audit.pair_orders).toHaveLength(Math.ceil(rounds / 2));
    expect(audit.pair_orders[0]).toEqual(seats);
    audit.pair_orders.forEach((order, k) => {
      expect([...order].sort()).toEqual([...seats].sort());
      expect(roundOf(slots, 2 * k + 1)).toEqual(order);
      if (2 * k + 2 <= rounds) expect(roundOf(slots, 2 * k + 2)).toEqual(reversed(order));
      else expect(rounds % 2).toBe(1); // the lone last round (odd roster size) runs forward only
    });
  });

  it('draws the later pairs at random (they are not the seat order again)', async () => {
    let differing = 0;
    let pairs = 0;
    for (let start = 0; start < 4; start += 1) {
      const { poolId, seats } = await seedInitialPool(8, 8);
      await callRpc(db, 'draft_start', { p_pool_id: poolId, p_actor_id: seats[0] });
      const { pair_orders } = await startedAudit(poolId);
      for (const order of pair_orders.slice(1)) {
        pairs += 1;
        if (order.join() !== seats.join()) differing += 1;
      }
    }
    expect(pairs).toBe(12);
    // Each later pair equals the seat order with probability 1/8! (and all twelve of them: never).
    expect(differing).toBeGreaterThanOrEqual(11);
  }, 60_000); // four seeded leagues over PostgREST: well past the 5 s default

  it('a Redraft is untouched: draft_start refuses it and its publish still queues the plain snake over the standings seats', async () => {
    const { seasonId, poolId, seats } = await seedInitialPool(6, 3);
    await must('complete', db.from('draft_pools').update({ phase: 'complete', status: 'complete' }).eq('id', poolId));
    // Worst-ranked trainer first: the seats are the standings order, reversed here (seat 1 = the last player).
    const redraftId = (await callRpc(db, 'draft_create_pool', {
      p_season_id: seasonId,
      p_kind: 'redraft',
      p_actor_id: seats[0],
      p_config: { submission_deadline_at: new Date(Date.now() + 2 * 86_400_000).toISOString() },
      p_seats: seats.map((player_id, i) => ({ player_id, seat: seats.length - i, standing_rank: i + 1 })),
    })) as string;
    poolIds.push(redraftId);

    const refused = await db.rpc('draft_start', { p_pool_id: redraftId, p_actor_id: seats[0] });
    expect(refused.error?.message).toContain('SUBMISSION_PHASE');

    // Players 1-4 drop two lines, players 5-6 one.
    for (let p = 0; p < seats.length; p += 1) {
      for (let q = 1; q <= (p < 4 ? 2 : 1); q += 1) {
        const line = `mon${(p + 1) * 10 + q}--mon${(p + 1) * 10 + q}b`;
        const { data } = await must('tracker', db.from('evolution_tracker').insert({ season_id: seasonId, player_id: seats[p], base_pokemon: `mon${(p + 1) * 10 + q}`, current_form: `mon${(p + 1) * 10 + q}`, line_id: line }).select('id'));
        await must('submission', db.from('redraft_submissions').insert({ draft_pool_id: redraftId, player_id: seats[p], tracker_id: data![0].id, line_id: line }));
      }
    }
    await callRpc(db, 'redraft_publish', { p_pool_id: redraftId, p_actor_id: seats[0], p_force: true, p_reason: 'order proof' });

    const { data: seatRows } = await must('seats', db.from('draft_participants').select('player_id, seat').eq('draft_pool_id', redraftId));
    const seatOf = new Map((seatRows ?? []).map((r) => [r.player_id as string, Number(r.seat)]));
    const queue = (await slotsOf(redraftId)).map((s) => `${s.round}:${seatOf.get(s.player_id)}`);
    // Seats 1-2 (players 6, 5) have one drop, seats 3-6 two: round 1 seats ascending, round 2 descending, no re-roll.
    expect(queue).toEqual(['1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '2:6', '2:5', '2:4', '2:3']);
    const { data: log } = await must('log', db.from('draft_action_log').select('after').eq('draft_pool_id', redraftId));
    expect(JSON.stringify(log)).not.toContain('pair_orders');
  });
});
