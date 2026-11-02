import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof of the roster lock (supabase/migrations/20261102140000_legacy_draft_roster_lock.sql): while a
// legacy pool is in progress the database refuses a join and a removal with SEASON_DRAFT_LOCKED, and a league delete
// and its recycle-bin restore are not blocked. Seeds LOCAL rows through supabase-js, never loads `.env`, cleans up.
//
//   LOCAL_LEGACY_ROSTER_LOCK=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/draft/__tests__/legacy-roster-lock.local.test.ts
//
// (`npm run test:db` passes all three from `supabase status`.)
const optIn = localStackOptIn('LOCAL_LEGACY_ROSTER_LOCK');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[legacy-roster-lock.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY');
  }
}

const RUN = randomUUID().slice(0, 8);

let db: SupabaseClient;
const playerIds: string[] = [];
const seasonIds: string[] = [];
const trashIds: string[] = [];

async function must<T extends { error: { message: string } | null }>(label: string, op: PromiseLike<T>): Promise<T> {
  const result = await op;
  if (result.error) throw new Error(`[legacy-roster-lock.local ${label}] ${result.error.message}`);
  return result;
}

async function newPlayer(label: string): Promise<string> {
  const id = randomUUID();
  playerIds.push(id);
  await must('player', db.from('players').insert({ id, name: `lock ${RUN} ${label}`, discord_id: `lock-${RUN}-${label}` }));
  return id;
}

/** A league with the given pool and two trainers on the roster; returns the ids. */
async function seedLeague(
  label: string,
  pool: { engine: 'legacy' | 'queue'; status: 'pending' | 'in_progress' | 'complete'; phase?: string } | null,
): Promise<{ seasonId: string; poolId: string | null; a: string; b: string }> {
  const seasonId = randomUUID();
  seasonIds.push(seasonId);
  await must('season', db.from('seasons').insert({ id: seasonId, name: `lock ${RUN} ${label}`, format_type: 'singles', status: 'active' }));
  const a = await newPlayer(`${label}-a`);
  const b = await newPlayer(`${label}-b`);
  await must('roster', db.from('season_participants').insert([{ season_id: seasonId, player_id: a }, { season_id: seasonId, player_id: b }]));
  let poolId: string | null = null;
  if (pool) {
    poolId = randomUUID();
    await must(
      'pool',
      db.from('draft_pools').insert({
        id: poolId,
        season_id: seasonId,
        draft_type: 'snake',
        engine: pool.engine,
        phase: pool.phase ?? (pool.engine === 'queue' ? 'setup' : 'setup'),
        status: pool.status,
      }),
    );
  }
  return { seasonId, poolId, a, b };
}

const rosterSize = async (seasonId: string): Promise<number> => {
  const { count } = await must('count', db.from('season_participants').select('player_id', { count: 'exact', head: true }).eq('season_id', seasonId));
  return count ?? 0;
};

describe.skipIf(!optIn)('legacy draft roster lock (local stack)', () => {
  beforeAll(() => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (trashIds.length > 0) await db.from('league_trash').delete().in('id', trashIds);
    if (seasonIds.length > 0) await db.from('seasons').delete().in('id', seasonIds);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  it('refuses a removal and a join while a legacy pool is in progress, and writes nothing', async () => {
    const { seasonId, a } = await seedLeague('live', { engine: 'legacy', status: 'in_progress' });
    const extra = await newPlayer('live-extra');

    const removal = await db.rpc('season_participant_remove', { p_season_id: seasonId, p_player_id: a });
    expect(removal.error?.message).toContain('SEASON_DRAFT_LOCKED');
    expect(removal.error?.code).toBe('P0001');

    const join = await db.from('season_participants').insert({ season_id: seasonId, player_id: extra });
    expect(join.error?.message).toContain('SEASON_DRAFT_LOCKED');

    expect(await rosterSize(seasonId)).toBe(2);
  });

  it.each(['pending', 'complete'] as const)('allows a join and a removal while the legacy pool is %s', async (status) => {
    const { seasonId, a } = await seedLeague(`legacy-${status}`, { engine: 'legacy', status });
    const extra = await newPlayer(`legacy-${status}-extra`);

    await must('join', db.from('season_participants').insert({ season_id: seasonId, player_id: extra }));
    const removal = await db.rpc('season_participant_remove', { p_season_id: seasonId, p_player_id: a });
    expect(removal.error).toBeNull();
    expect(removal.data).toBe(true);
    expect(await rosterSize(seasonId)).toBe(2);
  });

  it('allows both when the league has no pool, and for an in-progress queue pool', async () => {
    for (const [label, pool] of [
      ['nopool', null],
      ['queue', { engine: 'queue', status: 'in_progress', phase: 'drafting' } as const],
    ] as const) {
      const { seasonId, a } = await seedLeague(label, pool);
      const extra = await newPlayer(`${label}-extra`);
      await must('join', db.from('season_participants').insert({ season_id: seasonId, player_id: extra }));
      const removal = await db.rpc('season_participant_remove', { p_season_id: seasonId, p_player_id: a });
      expect(removal.error, label).toBeNull();
      expect(await rosterSize(seasonId), label).toBe(2);
    }
  });

  it('refuses again the moment the pool goes live, and frees the roster when it moves back to pending', async () => {
    const { seasonId, poolId, a } = await seedLeague('toggle', { engine: 'legacy', status: 'pending' });
    await must('start', db.from('draft_pools').update({ status: 'in_progress' }).eq('id', poolId!));
    const locked = await db.rpc('season_participant_remove', { p_season_id: seasonId, p_player_id: a });
    expect(locked.error?.message).toContain('SEASON_DRAFT_LOCKED');

    await must('back', db.from('draft_pools').update({ status: 'pending' }).eq('id', poolId!));
    const freed = await db.rpc('season_participant_remove', { p_season_id: seasonId, p_player_id: a });
    expect(freed.error).toBeNull();
  });

  it('a league with a legacy pool in progress still goes to the recycle bin and comes back from it', async () => {
    const { seasonId, poolId } = await seedLeague('trash', { engine: 'legacy', status: 'in_progress' });
    const deleted = await db.rpc('league_trash_delete', { p_season_id: seasonId, p_actor: null, p_retention_days: 90 });
    expect(deleted.error).toBeNull();
    const trashId = (deleted.data as { trash_id: string }).trash_id;
    trashIds.push(trashId);
    expect(await rosterSize(seasonId)).toBe(0);

    await must('rebuild', db.rpc('league_trash_rebuild_done', { p_trash_id: trashId }));

    const restored = await db.rpc('league_trash_restore', { p_trash_id: trashId });
    expect(restored.error).toBeNull();
    expect(await rosterSize(seasonId)).toBe(2);
    const { data: pool } = await must('pool', db.from('draft_pools').select('id').eq('id', poolId!).maybeSingle());
    expect(pool?.id).toBe(poolId);
  });

  it('season__legacy_draft_live is executable by service_role only', async () => {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anon) return;
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anon, { auth: { persistSession: false } });
    const { error } = await client.rpc('season__legacy_draft_live', { p_season_id: randomUUID() });
    expect(error).not.toBeNull();
  });
});
