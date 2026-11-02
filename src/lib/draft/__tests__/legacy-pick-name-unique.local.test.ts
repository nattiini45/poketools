import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof of uq_draft_picks_legacy_name_live (supabase/migrations/20261102140100_legacy_pick_name_unique.sql):
// two live legacy picks of one pool cannot hold the same Pokémon in two spellings, and the index does not block voided
// picks or line (queue/EPB) picks. Seeds LOCAL rows through supabase-js, never loads `.env`, cleans up after itself.
//
//   LOCAL_LEGACY_PICK_NAMES=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/draft/__tests__/legacy-pick-name-unique.local.test.ts
//
// (`npm run test:db` passes all three from `supabase status`.)
const optIn = localStackOptIn('LOCAL_LEGACY_PICK_NAMES');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[legacy-pick-name-unique.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY');
  }
}

const RUN = randomUUID().slice(0, 8);

let db: SupabaseClient;
let seasonId = '';
let poolId = '';
let queuePoolId = '';
const playerIds: string[] = [];

async function must<T extends { error: { message: string } | null }>(label: string, op: PromiseLike<T>): Promise<T> {
  const result = await op;
  if (result.error) throw new Error(`[legacy-pick-name-unique.local ${label}] ${result.error.message}`);
  return result;
}

let nextPick = 1;
const insertPick = (pool: string, pokemon: string, extra: Record<string, unknown> = {}) =>
  db.from('draft_picks').insert({
    draft_pool_id: pool,
    player_id: playerIds[0],
    pokemon_name: pokemon,
    pick_number: nextPick++,
    round: 1,
    ...extra,
  });

describe.skipIf(!optIn)('uq_draft_picks_legacy_name_live (local stack)', () => {
  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    seasonId = randomUUID();
    await must('season', db.from('seasons').insert({ id: seasonId, name: `names ${RUN}`, format_type: 'singles', status: 'active' }));
    const id = randomUUID();
    playerIds.push(id);
    await must('player', db.from('players').insert({ id, name: `names ${RUN}`, discord_id: `names-${RUN}` }));
    poolId = randomUUID();
    await must('pool', db.from('draft_pools').insert({ id: poolId, season_id: seasonId, draft_type: 'snake', engine: 'legacy', status: 'in_progress' }));
    queuePoolId = randomUUID();
    await must(
      'queue pool',
      db.from('draft_pools').insert({ id: queuePoolId, season_id: seasonId, draft_type: 'snake', engine: 'queue', kind: 'redraft', phase: 'setup', status: 'pending' }),
    );
  });

  afterAll(async () => {
    if (!db) return;
    if (seasonId) await db.from('seasons').delete().eq('id', seasonId);
    if (playerIds.length > 0) await db.from('players').delete().in('id', playerIds);
  });

  it('refuses a second live legacy pick of the same Pokémon in another spelling (23505 on the index name)', async () => {
    await must('first', insertPick(poolId, 'Garchomp'));

    for (const spelling of ['garchomp', 'GARCHOMP', ' Garchomp ']) {
      const { error } = await insertPick(poolId, spelling);
      expect(error?.code, spelling).toBe('23505');
      expect(error?.message, spelling).toContain('uq_draft_picks_legacy_name_live');
    }
  });

  it('folds punctuation, accents and gender signs as epb_fold_id does', async () => {
    await must('mime', insertPick(poolId, 'Mr. Mime'));
    for (const spelling of ['Mr.Mime', 'mrmime', 'MR MIME']) {
      const { error } = await insertPick(poolId, spelling);
      expect(error?.message, spelling).toContain('uq_draft_picks_legacy_name_live');
    }
    await must('flabebe', insertPick(poolId, 'Flabébé'));
    expect((await insertPick(poolId, 'flabebe')).error?.code).toBe('23505');
  });

  it('does not confuse two different Pokémon', async () => {
    await must('galar', insertPick(poolId, 'Mr. Mime-Galar'));
  });

  it('a voided pick frees the name again', async () => {
    const name = 'Snorlax';
    await must('first', insertPick(poolId, name));
    expect((await insertPick(poolId, 'snorlax')).error?.code).toBe('23505');
    await must('void', db.from('draft_picks').update({ voided_at: new Date().toISOString(), void_reason: 'test' }).eq('draft_pool_id', poolId).eq('pokemon_name', name));
    await must('again', insertPick(poolId, 'snorlax'));
  });

  it('the same Pokémon may be live in another pool', async () => {
    const otherSeason = randomUUID();
    const otherPool = randomUUID();
    await must('season', db.from('seasons').insert({ id: otherSeason, name: `names ${RUN} other`, format_type: 'singles', status: 'active' }));
    try {
      await must('pool', db.from('draft_pools').insert({ id: otherPool, season_id: otherSeason, draft_type: 'snake', engine: 'legacy', status: 'pending' }));
      await must('pick', insertPick(otherPool, 'Garchomp'));
    } finally {
      await db.from('seasons').delete().eq('id', otherSeason);
    }
  });

  it('is not enforced for line picks (queue engine and Evolution Point Buy store the line base name)', async () => {
    const line = (suffix: string) => ({ line_id: `oshawott--samurott${suffix}` });
    await must('first', insertPick(queuePoolId, 'Oshawott', line('')));
    await must('second', insertPick(queuePoolId, 'Oshawott', line('hisui')));
  });

  it('pick-number collisions keep their own index (uq_draft_picks_pool_number_live)', async () => {
    const number = 900;
    await must('first', db.from('draft_picks').insert({ draft_pool_id: poolId, player_id: playerIds[0], pokemon_name: 'Eevee', pick_number: number, round: 1 }));
    const { error } = await db
      .from('draft_picks')
      .insert({ draft_pool_id: poolId, player_id: playerIds[0], pokemon_name: 'Ditto', pick_number: number, round: 1 });
    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('uq_draft_picks_pool_number_live');
  });
});
