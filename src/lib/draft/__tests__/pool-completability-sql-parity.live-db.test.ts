/**
 * SQL-vs-TS parity of the pool completability search (lead decision N-5, round 2). Opt-in and
 * maintainer-only, local stack only (see ./local-db.ts):
 *
 *   LOCAL_DB_URL=http://127.0.0.1:54321 LOCAL_DB_SERVICE_ROLE_KEY=<local service_role key> \
 *     npx vitest run src/lib/draft/__tests__/pool-completability-sql-parity.live-db.test.ts
 *
 * draft__completable_search (supabase/migrations/20261018140200_draft_pool_completability.sql) and poolCompletability
 * (src/lib/draft/completability.ts) are step-for-step twins: on every shared vector (fixtures/completability-vectors.json)
 * and on seeded random pools both must return the same status AND the same step count. Inputs are passed the way
 * draft__pool_completable builds them: participants in order as p_slots / p_budget, p_elig participant-major over the
 * listed line order. Pure function calls: nothing is written.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import vectorsFile from './fixtures/completability-vectors.json';
import { callRpc, connectLocalDb, inBatches, LOCAL_DB_OPTED_IN } from './local-db';
import { poolCompletability, type PoolLine, type PoolParticipant } from '../completability';

interface Case {
  id: string;
  lines: [string, number][];
  participants: { slots: number; budget: number; excluded: string[] }[];
  node_limit?: number;
}

interface Vector extends Case {
  status: 'completable' | 'not_completable' | 'undecided';
  nodes: number;
}

const VECTORS = (vectorsFile as unknown as { vectors: Vector[] }).vectors;

/** Deterministic LCG (the one completability.test.ts uses). */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Seeded random pools: small ones (every outcome, restrictions, done and broke participants) and league-sized ones. */
function randomCases(count: number, seed: number): Case[] {
  const r = rng(seed);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  return Array.from({ length: count }, (_, t) => {
    const large = t % 4 === 3;
    const n = large ? ri(18, 40) : ri(0, 9);
    const lines: [string, number][] = Array.from({ length: n }, (_, i) => [`l${t}x${i}--y`, large ? ri(8, 30) : ri(1, 12)]);
    const participants = Array.from({ length: large ? ri(3, 6) : ri(1, 4) }, () => ({
      slots: large ? ri(2, 6) : ri(0, 3),
      budget: large ? ri(40, 120) : ri(-2, 24),
      excluded: lines.filter(() => r() < (large ? 0.1 : 0.2)).map(([id]) => id),
    }));
    // A few small caps to reach `undecided` on both sides.
    return { id: `random-${seed}-${t}`, lines, participants, ...(t % 25 === 24 ? { node_limit: ri(1, 40) } : {}) };
  });
}

function tsResult(c: Case): { status: string; nodes: number } {
  const lines: PoolLine[] = c.lines.map(([lineId, price]) => ({ lineId, price }));
  const participants: PoolParticipant[] = c.participants.map((p, i) => ({
    playerId: `p${i + 1}`,
    openSlots: p.slots,
    budget: p.budget,
    excludedLineIds: new Set(p.excluded),
  }));
  const r = poolCompletability({ lines, participants, nodeLimit: c.node_limit });
  return { status: r.status, nodes: r.nodes };
}

let db: SupabaseClient;

async function sqlResult(c: Case): Promise<{ status: string; nodes: number }> {
  const elig = c.participants.flatMap((p) => c.lines.map(([id]) => !p.excluded.includes(id)));
  const raw = await callRpc(db, 'draft__completable_search', {
    p_price: c.lines.map(([, price]) => price),
    p_line: c.lines.map(([id]) => id),
    p_slots: c.participants.map((p) => p.slots),
    p_budget: c.participants.map((p) => p.budget),
    p_elig: elig,
    ...(c.node_limit === undefined ? {} : { p_node_limit: c.node_limit }),
  });
  if (typeof raw !== 'object' || raw === null) throw new Error(`draft__completable_search returned ${JSON.stringify(raw)}`);
  const { status, nodes } = raw as { status?: unknown; nodes?: unknown };
  if (typeof status !== 'string' || typeof nodes !== 'number') throw new Error(`malformed result ${JSON.stringify(raw)}`);
  return { status, nodes };
}

describe.skipIf(!LOCAL_DB_OPTED_IN)('pool completability: SQL search vs TS twin (local stack, LOCAL_DB_URL)', () => {
  beforeAll(() => {
    db = connectLocalDb();                                              // throws for a non-local URL
  });

  it.each(VECTORS.map((v) => [v.id, v] as const))('shared vector %s', async (_id, v) => {
    expect(await sqlResult(v)).toEqual({ status: v.status, nodes: v.nodes });
    expect(tsResult(v)).toEqual({ status: v.status, nodes: v.nodes });
  });

  it('agrees step for step on 1600 seeded random pools (small and league-sized, some capped)', async () => {
    const cases = [...randomCases(800, 7), ...randomCases(800, 1018)];
    const sql = await inBatches(cases.map((c) => () => sqlResult(c)));
    const mismatches = cases
      .map((c, i) => ({ id: c.id, sql: sql[i], ts: tsResult(c) }))
      .filter((m) => m.sql.status !== m.ts.status || m.sql.nodes !== m.ts.nodes);
    expect(mismatches).toEqual([]);
    // The sample reaches every outcome (otherwise it proves less than it claims).
    expect(new Set(sql.map((r) => r.status))).toEqual(new Set(['completable', 'not_completable', 'undecided']));
  }, 600_000);
});
