/**
 * Draft Kill Token purchases with a line rate, replayed on a real Postgres
 * (supabase/migrations/20261027193000_draft_token_participation_rate.sql). Opt-in and maintainer-only, local stack only
 * (see ./local-db.ts):
 *
 *   LOCAL_DB_URL=http://127.0.0.1:54321 LOCAL_DB_SERVICE_ROLE_KEY=<local service_role key> \
 *     npx vitest run src/lib/draft/__tests__/draft-token-participation-rate.live-db.test.ts
 *
 * Every scenario seeds its own league (players, season, rules, a completed initial pool, one tracker per line) through
 * PostgREST and calls epb_purchase_draft_token as the application does. The rows are removed afterwards; the
 * append-only draft audit rows (draft_action_log has no foreign keys and refuses deletes) stay behind with random ids,
 * harmless on a local stack.
 *
 * The league uses the defaults of format_rules: 3 points per token, 2 tokens per player, one purchase per line.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callRpc, connectLocalDb, LOCAL_DB_OPTED_IN } from './local-db';

const TAG = randomUUID().slice(0, 8);
const PRICE = 3;
const MAX = 2;
const BUDGET = 100;
const NEXT_THRESHOLD = 5;

let db: SupabaseClient;
const seasonIds: string[] = [];
const playerIds: string[] = [];

async function must<T extends { error: { message: string } | null }>(label: string, query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

interface Seeded {
  seasonId: string;
  playerId: string;
  /** Line ids: two normal lines and one line that is bought at a rate. */
  lines: { normalA: string; normalB: string; rated: string };
}

/** A fresh league with one trainer who owns three lines, a completed initial pool and the given point budget. */
async function seed(budget = BUDGET): Promise<Seeded> {
  const seasonId = randomUUID();
  const playerId = randomUUID();
  const n = seasonIds.length;
  seasonIds.push(seasonId);
  playerIds.push(playerId);
  await must('player', db.from('players').insert({ id: playerId, name: `dkr_${TAG}_${n}`, is_guest: true }));
  await must('season', db.from('seasons').insert({ id: seasonId, name: `dkr ${TAG} ${n}`, format_type: 'evolution_point_buy', status: 'active' }));
  await must('format_rules', db.from('format_rules').insert({ season_id: seasonId }));
  await must('pool', db.from('draft_pools').insert({ season_id: seasonId, draft_type: 'snake', kind: 'initial', phase: 'complete', point_budget: budget }));
  const lines = { normalA: `na${n}--nb${n}`, normalB: `ma${n}--mb${n}`, rated: `pa${n}--pb${n}` };
  await must(
    'trackers',
    db.from('evolution_tracker').insert(
      Object.values(lines).map((line_id) => ({ season_id: seasonId, player_id: playerId, base_pokemon: line_id.split('--')[0], current_form: line_id.split('--')[0], line_id })),
    ),
  );
  return { seasonId, playerId, lines };
}

interface PurchaseResult {
  points_spent: number;
  tokens_used: number;
  progress?: number;
  remaining_points?: number;
  replay: boolean;
}

/** Buys one token; `rate` undefined leaves p_tokens_per_progress out (the default 1, an older caller). */
async function buy(s: Seeded, lineId: string, rate?: number, requestId: string = randomUUID()): Promise<PurchaseResult> {
  return (await callRpc(db, 'epb_purchase_draft_token', {
    p_season_id: s.seasonId,
    p_player_id: s.playerId,
    p_actor_id: s.playerId,
    p_line_id: lineId,
    p_next_threshold: NEXT_THRESHOLD,
    p_client_request_id: requestId,
    ...(rate === undefined ? {} : { p_tokens_per_progress: rate }),
  })) as PurchaseResult;
}

async function remaining(s: Seeded): Promise<number> {
  return (await callRpc(db, 'epb__season_remaining_points', { p_season_id: s.seasonId, p_player_id: s.playerId })) as number;
}

async function ledger(s: Seeded): Promise<{ points_spent: number; tokens_used: number }[]> {
  const { data } = await must('ledger', db.from('epb_draft_token_purchases').select('points_spent, tokens_used').eq('season_id', s.seasonId));
  return data ?? [];
}

describe.skipIf(!LOCAL_DB_OPTED_IN)('epb_purchase_draft_token: a line rate (local stack, LOCAL_DB_URL)', () => {
  beforeAll(() => {
    db = connectLocalDb(); // throws for a non-local URL
  });

  afterAll(async () => {
    if (!db) return;
    const attempt = async (what: string, q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q;
      if (error) console.warn(`[draft-token-participation-rate.live-db] cleanup ${what}: ${error.message}`);
    };
    if (seasonIds.length) {
      await attempt('epb_draft_token_purchases', db.from('epb_draft_token_purchases').delete().in('season_id', seasonIds));
      await attempt('evolution_progress_log', db.from('evolution_progress_log').delete().in('season_id', seasonIds));
      await attempt('evolution_tracker', db.from('evolution_tracker').delete().in('season_id', seasonIds));
      await attempt('draft_pools', db.from('draft_pools').delete().in('season_id', seasonIds));
      await attempt('format_rules', db.from('format_rules').delete().in('season_id', seasonIds));
      await attempt('seasons', db.from('seasons').delete().in('id', seasonIds));
    }
    await attempt('players', db.from('players').delete().in('id', playerIds));
  });

  it('a normal line (rate omitted or 1) costs 1 x the price and counts as 1 token', async () => {
    const s = await seed();
    const bought = await buy(s, s.lines.normalA);
    expect(bought).toMatchObject({ points_spent: PRICE, tokens_used: 1, progress: 1, remaining_points: BUDGET - PRICE, replay: false });
    expect(await ledger(s)).toEqual([{ points_spent: PRICE, tokens_used: 1 }]);
    expect(await remaining(s)).toBe(BUDGET - PRICE);
    // An explicit rate of 1 is the same thing, and two tokens fit the allowance.
    expect(await buy(s, s.lines.normalB, 1)).toMatchObject({ points_spent: PRICE, tokens_used: 1 });
  });

  it('a rated line (rate 2) costs 2 x the price, counts as 2 tokens and still gives +1 progress', async () => {
    const s = await seed();
    const bought = await buy(s, s.lines.rated, 2);
    expect(bought).toMatchObject({ points_spent: 2 * PRICE, tokens_used: 2, progress: 1, remaining_points: BUDGET - 2 * PRICE });
    expect(await ledger(s)).toEqual([{ points_spent: 2 * PRICE, tokens_used: 2 }]);
    expect(await remaining(s)).toBe(BUDGET - 2 * PRICE);
    const { data } = await must('tracker', db.from('evolution_tracker').select('total_kos, draft_tokens').eq('season_id', s.seasonId).eq('line_id', s.lines.rated));
    expect(data).toEqual([{ total_kos: 1, draft_tokens: 1 }]);
  });

  it('the allowance counts tokens: with one token left a 2-token line is refused, a normal line is not', async () => {
    const s = await seed();
    await buy(s, s.lines.normalA);
    await expect(buy(s, s.lines.rated, 2)).rejects.toThrow('TOKEN_PLAYER_LIMIT');
    expect(await buy(s, s.lines.normalB)).toMatchObject({ tokens_used: 1 });
    expect(await ledger(s)).toHaveLength(2);
  });

  it('a 2-token line uses the whole allowance of 2: nothing else can be bought afterwards', async () => {
    const s = await seed();
    await buy(s, s.lines.rated, 2);
    await expect(buy(s, s.lines.normalA)).rejects.toThrow('TOKEN_PLAYER_LIMIT');
    expect(MAX).toBe(2);
  });

  it('keeps one purchase per line', async () => {
    const s = await seed();
    await buy(s, s.lines.normalA);
    await expect(buy(s, s.lines.normalA)).rejects.toThrow('TOKEN_LINE_LIMIT');
  });

  it('refuses a purchase the unspent points cannot pay at the scaled price', async () => {
    const s = await seed(2 * PRICE - 1);
    await expect(buy(s, s.lines.rated, 2)).rejects.toThrow('TOKEN_POINTS_SHORT');
    // The same balance still pays one normal token.
    expect(await buy(s, s.lines.normalA)).toMatchObject({ points_spent: PRICE, remaining_points: PRICE - 1 });
  });

  it('refuses a rate outside 1..10', async () => {
    const s = await seed();
    for (const rate of [0, 11, -1]) await expect(buy(s, s.lines.normalA, rate)).rejects.toThrow('INVALID_CONFIG');
    expect(await ledger(s)).toEqual([]);
  });

  it('replays the first purchase of a request id with its tokens_used and takes nothing twice', async () => {
    const s = await seed();
    const requestId = randomUUID();
    const first = await buy(s, s.lines.rated, 2, requestId);
    const again = await buy(s, s.lines.rated, 2, requestId);
    expect(first.replay).toBe(false);
    expect(again).toMatchObject({ replay: true, points_spent: 2 * PRICE, tokens_used: 2 });
    expect(await ledger(s)).toHaveLength(1);
    expect(await remaining(s)).toBe(BUDGET - 2 * PRICE);
  });
});
