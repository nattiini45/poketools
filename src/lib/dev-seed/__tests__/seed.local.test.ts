import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { DEV_SEED_ADMIN, DEV_SEED_LEAGUE_NAME, DEV_SEED_PASSWORD, devSeedPlayerEmail } from '../constants';

// LIVE-LOCAL test of `npm run dev:seed`: the seed runs twice against a LOCAL Supabase stack and must leave exactly one
// admin, one league and one tournament behind (idempotent). Runs through `npm run test:db`; it never loads `.env`
// and refuses a non-loopback Supabase URL.
const optIn = localStackOptIn('LOCAL_DEV_SEED');

if (optIn) assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

describe.skipIf(!optIn)('dev seed (local stack)', () => {
  const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'));
  let seed: typeof import('../seed');

  beforeAll(async () => {
    seed = await import('../seed');
  }, 120_000);

  it('creates a confirmed admin, the league and its matches, and a second run changes nothing', async () => {
    const first = await seed.runDevSeed();
    const second = await seed.runDevSeed();

    expect(second.leagueCreated).toBe(false);
    expect(second.leagueId).toBe(first.leagueId);
    expect(second.tournamentId).toBe(first.tournamentId);
    expect(second.adminPlayerId).toBe(first.adminPlayerId);
    expect(second.rulesetsCreated).toBe(0);

    const db = admin();
    const adminRows = await db.from('players').select('id, is_admin, auth_user_id').eq('id', first.adminPlayerId);
    expect(adminRows.data).toHaveLength(1);
    expect(adminRows.data?.[0]).toMatchObject({ is_admin: true });
    const authUsers = await db.auth.admin.listUsers({ perPage: 1000 });
    const seeded = authUsers.data.users.filter((u) => u.email === DEV_SEED_ADMIN.email);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].email_confirmed_at).toBeTruthy();

    const leagues = await db.from('seasons').select('id').eq('name', DEV_SEED_LEAGUE_NAME);
    expect(leagues.data).toHaveLength(1);
    const participants = await db.from('season_participants').select('player_id').eq('season_id', first.leagueId);
    expect(participants.data).toHaveLength(8);
    const matches = await db.from('matches').select('status').eq('tournament_id', first.tournamentId);
    expect((matches.data ?? []).map((m) => m.status).sort()).toEqual(['completed', 'completed', 'scheduled', 'scheduled']);
  }, 180_000);

  it('rebuilds a league that an interrupted run left without its matches', async () => {
    const before = await seed.runDevSeed();
    const db = admin();
    const removed = await db.from('matches').delete().eq('tournament_id', before.tournamentId);
    expect(removed.error).toBeNull();

    const repaired = await seed.runDevSeed();
    expect(repaired.leagueCreated).toBe(true);
    const leagues = await db.from('seasons').select('id').eq('name', DEV_SEED_LEAGUE_NAME);
    expect(leagues.data).toHaveLength(1);
    const matches = await db.from('matches').select('status').eq('tournament_id', repaired.tournamentId);
    expect((matches.data ?? []).map((m) => m.status).sort()).toEqual(['completed', 'completed', 'scheduled', 'scheduled']);

    const again = await seed.runDevSeed();
    expect(again.leagueCreated).toBe(false);
    expect(again.leagueId).toBe(repaired.leagueId);
  }, 180_000);

  it('signs the seeded admin in with email and password', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, requireLocalKey('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
    const { error } = await anon.auth.signInWithPassword({ email: DEV_SEED_ADMIN.email, password: DEV_SEED_ADMIN.password });
    expect(error).toBeNull();

    const player = await anon.auth.signInWithPassword({ email: devSeedPlayerEmail(8), password: DEV_SEED_PASSWORD });
    expect(player.error).toBeNull();
  });
});
