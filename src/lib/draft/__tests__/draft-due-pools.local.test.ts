import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof of public.draft_list_due_pools (supabase/migrations/20261102150000_draft_list_due_pools.sql):
// the draft-ticks cron gets the pools with work due, however many idle pools are open. Seeds LOCAL rows through
// supabase-js, never loads `.env`, cleans up after itself.
//
//   LOCAL_DRAFT_DUE_POOLS=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/draft/__tests__/draft-due-pools.local.test.ts
//
// (`npm run test:db` passes all three from `supabase status`.)
const optIn = localStackOptIn('LOCAL_DRAFT_DUE_POOLS');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[draft-due-pools.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY');
  }
}

const RUN = randomUUID().slice(0, 8);
const HOUR = 3_600_000;
const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
const ANCIENT = '2000-01-01T00:00:00.000Z';

let db: SupabaseClient;
let playerId = '';
const seasonIds: string[] = [];

async function must<T extends { error: { message: string } | null }>(label: string, op: PromiseLike<T>): Promise<T> {
  const result = await op;
  if (result.error) throw new Error(`[draft-due-pools.local ${label}] ${result.error.message}`);
  return result;
}

interface PoolSeed {
  engine?: 'legacy' | 'queue';
  kind?: 'initial' | 'redraft';
  phase: 'setup' | 'submissions' | 'drafting';
  status?: 'pending' | 'in_progress';
  paused?: boolean;
  submissionDeadline?: string;
  /** `deadline_at` of an active slot; omitted = no slot. */
  slotDeadline?: string;
  refusedAtVersion?: boolean;
}

/** One league with one pool; returns the pool id. */
async function seedPool(label: string, p: PoolSeed): Promise<string> {
  const seasonId = randomUUID();
  seasonIds.push(seasonId);
  await must('season', db.from('seasons').insert({ id: seasonId, name: `due ${RUN} ${label}`, format_type: 'singles', status: 'active' }));
  const poolId = randomUUID();
  const row: Record<string, unknown> = {
    id: poolId,
    season_id: seasonId,
    draft_type: 'snake',
    engine: p.engine ?? 'queue',
    kind: p.kind ?? 'initial',
    phase: p.phase,
    status: p.status ?? (p.phase === 'drafting' ? 'in_progress' : 'pending'),
    submission_deadline_at: p.submissionDeadline ?? null,
    paused_at: p.paused ? iso(-HOUR) : null,
    pause_reason: p.paused ? 'admin' : null,
  };
  if (p.refusedAtVersion) {
    row.publish_refused_at = iso(-60_000);
    row.publish_refused_version = 0;
  }
  await must('pool', db.from('draft_pools').insert(row));
  if (p.slotDeadline) {
    await must(
      'slot',
      db.from('draft_slots').insert({
        draft_pool_id: poolId,
        player_id: playerId,
        sort_key: 1,
        round: 1,
        nominal_pick_number: 1,
        status: 'active',
        deadline_at: p.slotDeadline,
      }),
    );
  }
  return poolId;
}

async function dueIds(limit: number): Promise<string[]> {
  const { data, error } = await db.rpc('draft_list_due_pools', { p_limit: limit });
  if (error) throw new Error(`draft_list_due_pools: ${error.message}`);
  return (data as { id: string }[]).map((r) => r.id);
}

describe.skipIf(!optIn)('draft_list_due_pools (local stack)', () => {
  const ids: Record<string, string> = {};
  let overdueFirst = '';

  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    playerId = randomUUID();
    await must('player', db.from('players').insert({ id: playerId, name: `due ${RUN}`, discord_id: `due-${RUN}` }));

    // Idle pools: 24 slow drafts whose slot deadline is days away, plus one of each other kind of idle pool.
    for (let i = 0; i < 24; i++) ids[`slow-${i}`] = await seedPool(`slow ${i}`, { phase: 'drafting', slotDeadline: iso(48 * HOUR) });
    ids.pausedOverdue = await seedPool('paused', { phase: 'drafting', paused: true, slotDeadline: iso(-HOUR) });
    ids.setup = await seedPool('setup', { phase: 'setup' });
    ids.legacy = await seedPool('legacy', { engine: 'legacy', phase: 'drafting', slotDeadline: iso(-HOUR) });
    ids.redraftBeforeDeadline = await seedPool('redraft early', { kind: 'redraft', phase: 'submissions', submissionDeadline: iso(48 * HOUR) });
    ids.redraftBackoff = await seedPool('redraft backoff', {
      kind: 'redraft',
      phase: 'submissions',
      submissionDeadline: iso(-HOUR),
      refusedAtVersion: true,
    });
    // The 30th open queue pool, the only one with an overdue slot (ancient, so it leads whatever the local data holds).
    ids.overdue = await seedPool('overdue', { phase: 'drafting', slotDeadline: ANCIENT });
    overdueFirst = ids.overdue;
    ids.redraftDue = await seedPool('redraft due', { kind: 'redraft', phase: 'submissions', submissionDeadline: iso(-2 * HOUR) });
  });

  afterAll(async () => {
    if (!db) return;
    // draft_pools.season_id restricts the season delete: the pools (and their slots) go first, in one statement.
    const failures: string[] = [];
    const attempt = async (what: string, op: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await op;
      if (error) failures.push(`${what}: ${error.message}`);
    };
    if (seasonIds.length > 0) await attempt('draft_pools', db.from('draft_pools').delete().in('season_id', seasonIds));
    if (seasonIds.length > 0) await attempt('seasons', db.from('seasons').delete().in('id', seasonIds));
    if (playerId) await attempt('players', db.from('players').delete().eq('id', playerId));
    if (failures.length > 0) throw new Error(`[draft-due-pools.local] cleanup left fixture rows behind: ${failures.join('; ')}`);
  });

  it('a limit below the open pool count still returns the pools with work due, not the idle ones', async () => {
    // Other suites or earlier interrupted runs may leave their own due pools in the shared local database: size the
    // limit from them, so exactly this suite's two due pools must fit in the list and the idle ones must not crowd them out.
    const mine = new Set(Object.values(ids));
    const foreignDue = (await dueIds(1000)).filter((id) => !mine.has(id)).length;
    const limit = foreignDue + 2;
    const list = await dueIds(limit);
    expect(list.length).toBeLessThanOrEqual(limit);
    expect(list).toEqual(expect.arrayContaining([overdueFirst, ids.redraftDue]));
  });

  it('returns exactly the pools with work due, and none of the idle ones', async () => {
    const mine = new Set(Object.values(ids));
    const list = (await dueIds(1000)).filter((id) => mine.has(id));
    expect(new Set(list)).toEqual(new Set([ids.overdue, ids.redraftDue]));
    // earliest due first: the ancient slot before the redraft deadline two hours ago
    expect(list).toEqual([ids.overdue, ids.redraftDue]);
  });

  it('paused, not-due, setup, legacy and backed-off publish pools are not returned', async () => {
    const list = new Set(await dueIds(1000));
    for (const key of ['pausedOverdue', 'setup', 'legacy', 'redraftBeforeDeadline', 'redraftBackoff', 'slow-0', 'slow-23']) {
      expect(list.has(ids[key]), key).toBe(false);
    }
  });

  it('honours the limit', async () => {
    const all = await dueIds(1000);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(await dueIds(1)).toEqual(all.slice(0, 1));
    expect(await dueIds(2)).toEqual(all.slice(0, 2));
    expect(await dueIds(0)).toEqual([]);
  });

  it('draft_tick on an idle or backed-off pool still reports nothing due (the helpers behave as the inline predicates did)', async () => {
    const idle = await db.rpc('draft_tick', { p_pool_id: ids['slow-0'] });
    expect(idle.error).toBeNull();
    expect(idle.data).toMatchObject({ timeouts: 0, published: false });
    const backoff = await db.rpc('draft_tick', { p_pool_id: ids.redraftBackoff });
    expect(backoff.error).toBeNull();
    expect(backoff.data).toMatchObject({ timeouts: 0, published: false, publish_backoff: true });
  });

  it('is executable by service_role only', async () => {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anon) return;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anon, { auth: { persistSession: false } });
    const { error } = await client.rpc('draft_list_due_pools', { p_limit: 5 });
    expect(error).not.toBeNull();
  });
});
