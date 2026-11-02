import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof of uq_draft_pool_entries_season_folded_name
// (supabase/migrations/20261102150200_draft_pool_entries_folded_name_unique.sql): a season's pool list cannot hold the
// same Pokémon in two spellings, in one insert or across two, while other seasons keep their own list.
// Seeds LOCAL rows through supabase-js, never loads `.env`, cleans up after itself.
//
//   LOCAL_POOL_ENTRY_NAMES=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/draft/__tests__/pool-entry-name-unique.local.test.ts
//
// (`npm run test:db` passes all three from `supabase status`.)
const optIn = localStackOptIn('LOCAL_POOL_ENTRY_NAMES');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[pool-entry-name-unique.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY');
  }
}

const RUN = randomUUID().slice(0, 8);

let db: SupabaseClient;
const seasonIds: string[] = [];

async function newSeason(label: string): Promise<string> {
  const id = randomUUID();
  seasonIds.push(id);
  const { error } = await db.from('seasons').insert({ id, name: `entries ${RUN} ${label}`, format_type: 'singles', status: 'active' });
  if (error) throw new Error(`[pool-entry-name-unique.local season] ${error.message}`);
  return id;
}

const entry = (season_id: string, pokemon_name: string) => ({ season_id, pokemon_name });

describe.skipIf(!optIn)('uq_draft_pool_entries_season_folded_name (local stack)', () => {
  beforeAll(() => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (db && seasonIds.length > 0) await db.from('seasons').delete().in('id', seasonIds);
  });

  it('refuses a second spelling of a listed Pokémon with 23505 on the folded-name index', async () => {
    const season = await newSeason('spelling');
    expect((await db.from('draft_pool_entries').insert(entry(season, 'Mr. Mime'))).error).toBeNull();

    const clash = await db.from('draft_pool_entries').insert(entry(season, 'mrmime'));
    expect(clash.error?.code).toBe('23505');
    expect(clash.error?.message).toContain('uq_draft_pool_entries_season_folded_name');
  });

  it('refuses two spellings inside one bulk insert and writes none of them', async () => {
    const season = await newSeason('batch');
    const clash = await db.from('draft_pool_entries').insert([entry(season, 'Ho-Oh'), entry(season, 'Eevee'), entry(season, 'hooh')]);
    expect(clash.error?.code).toBe('23505');

    const { count } = await db.from('draft_pool_entries').select('id', { count: 'exact', head: true }).eq('season_id', season);
    expect(count).toBe(0);
  });

  it('lets two seasons list the same Pokémon', async () => {
    const a = await newSeason('a');
    const b = await newSeason('b');
    expect((await db.from('draft_pool_entries').insert(entry(a, 'Garchomp'))).error).toBeNull();
    expect((await db.from('draft_pool_entries').insert(entry(b, 'garchomp'))).error).toBeNull();
  });
});
