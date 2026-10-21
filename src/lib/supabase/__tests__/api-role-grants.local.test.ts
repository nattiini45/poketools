import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@/types/database';
import { PRIVATE_MATCH_FIELDS, PUBLIC_MATCH_FIELDS } from '@/lib/match/public-match';
import { PRIVATE_MATCH_SENTINELS } from '@/lib/match/__tests__/private-match-fields';

// LIVE-LOCAL test: proves the DATABASE refuses schema `public` to the API
// roles (`anon`, `authenticated`), whatever the app does. The anon key ships
// in the browser bundle, so this is what a direct `/rest/v1/*` caller meets.
// It covers public.matches (20261008081402_revoke_anon_private_match_columns)
// and the rest of public (20261008081443_close_public_api_roles): the private
// `players` columns, `match_evolution_snapshots` and the rpc endpoints.
// It seeds rows into a LOCAL Supabase stack only (after `supabase db reset`),
// never loads `.env`, and never runs in CI.
//
//   LOCAL_SUPABASE_GRANTS=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/supabase/__tests__/api-role-grants.local.test.ts
//
// The local keys come from `supabase status -o env` (ANON_KEY,
// SERVICE_ROLE_KEY). Before the two migrations above, every "cannot" case
// fails: that is how the test was shown to see the leak (2026-10-07).
const optIn = process.env.LOCAL_SUPABASE_GRANTS === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[api-role-grants.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[api-role-grants.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`,
    );
  }
}

/** A key passed on the command line, never the vitest placeholder. */
function localKey(name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value || value === 'dummy-service-role-key') {
    throw new Error(`[api-role-grants.local] refusing to run: pass the LOCAL ${name} on the command line`);
  }
  return value;
}

if (optIn) {
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  localKey('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  localKey('SUPABASE_SERVICE_ROLE_KEY');
}

type MatchColumn = keyof Database['public']['Tables']['matches']['Row'];

/** The `matches` columns `PublicMatch` carries (its other fields are joined or derived). */
const PUBLIC_MATCH_COLUMNS = [
  'id',
  'round_id',
  'tournament_id',
  'player_1_id',
  'player_2_id',
  'winner_id',
  'status',
  'date_played',
  'scheduled_at',
  'social_image_url',
  'bracket_side',
  'bracket_pos',
  'created_at',
  'updated_at',
] as const satisfies readonly (MatchColumn & (typeof PUBLIC_MATCH_FIELDS)[number])[];

/**
 * Server-internal `matches` columns that never reach the domain `Match` type
 * (`toMatch` does not copy them), so no route can serialize them; the API
 * roles must not read them either. finalized_at: the match finalize marker
 * (20261018130000_match_finalize_integrity).
 */
const INTERNAL_MATCH_COLUMNS = ['finalized_at'] as const satisfies readonly MatchColumn[];

// Compile-time: every `matches` column is listed above, in PRIVATE_MATCH_FIELDS
// or in INTERNAL_MATCH_COLUMNS.
type Assert<T extends true> = T;
type _MatchColumnsClassified = Assert<
  [Exclude<
    MatchColumn,
    | (typeof PUBLIC_MATCH_COLUMNS)[number]
    | (typeof PRIVATE_MATCH_FIELDS)[number]
    | (typeof INTERNAL_MATCH_COLUMNS)[number]
  >] extends [never]
    ? true
    : false
>;

type Db = SupabaseClient<Database>;
type ApiRole = 'anon' | 'authenticated';

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let service: Db;
const api: Partial<Record<ApiRole, Db>> = {};
let authUserId: string | null = null;

function client(role: ApiRole): Db {
  const db = api[role];
  if (!db) throw new Error(`[api-role-grants.local] no ${role} client (beforeAll failed)`);
  return db;
}

interface Probe {
  data: unknown;
  error: { code?: string; message: string } | null;
  status: number;
}

const RUN = randomUUID().slice(0, 8);
/** Private player values seeded below; none may appear in an API-role response. */
const PLAYER_SECRET = `PLAYER-SECRET-${RUN}`;

/** The database refused: SQLSTATE 42501, HTTP 401 or 403, and no private value in the body. */
function expectDenied(label: string, res: Probe): void {
  console.info(`[grants] ${label}: HTTP ${res.status} ${res.error?.code ?? 'no error'} ${res.error?.message ?? ''}`);
  expect(res.error?.code, label).toBe('42501');
  expect([401, 403], label).toContain(res.status);
  const body = JSON.stringify(res.data ?? null);
  expect(body, label).not.toContain('MATCH-SECRET');
  expect(body, label).not.toContain(PLAYER_SECRET);
}

const ids = {
  ruleset: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  tournament: randomUUID(),
  round: randomUUID(),
  match: randomUUID(),
};

describe.skipIf(!optIn)('API-role privileges on schema public (local stack)', () => {
  beforeAll(async () => {
    assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = localKey('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    service = createClient<Database>(url, localKey('SUPABASE_SERVICE_ROLE_KEY'), NO_SESSION);
    api.anon = createClient<Database>(url, anonKey, NO_SESSION);

    // `authenticated`: anyone can sign up with the public anon key, so a fresh
    // self-signed-up user is the attacker's view (local stack: confirmations off).
    const signUp = await createClient<Database>(url, anonKey, NO_SESSION).auth.signUp({
      email: `grants-${RUN}@example.test`,
      password: `${randomUUID()}-Aa1`,
    });
    if (signUp.error) throw signUp.error;
    authUserId = signUp.data.user?.id ?? null;
    const token = signUp.data.session?.access_token;
    if (!token) {
      throw new Error('[api-role-grants.local] sign-up returned no session: the local stack needs enable_confirmations = false');
    }
    api.authenticated = createClient<Database>(url, anonKey, {
      ...NO_SESSION,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const seed = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };
    await seed('rulesets', service.from('rulesets').insert({ id: ids.ruleset, name: `Grants ${RUN} Ruleset` }));
    await seed(
      'players',
      service.from('players').insert([
        { id: ids.p1, name: `Grants ${RUN} Ada`, discord_id: `${PLAYER_SECRET}-d1`, ban_reason: `${PLAYER_SECRET} ban` },
        { id: ids.p2, name: `Grants ${RUN} Bram`, discord_id: `${PLAYER_SECRET}-d2` },
      ]),
    );
    await seed(
      'tournaments',
      service.from('tournaments').insert({
        id: ids.tournament,
        name: `Grants ${RUN} Open`,
        bracket_type: 'single_elim',
        ruleset_id: ids.ruleset,
      }),
    );
    await seed(
      'rounds',
      service.from('rounds').insert({ id: ids.round, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 3 }),
    );
    await seed(
      'matches',
      service.from('matches').insert({
        id: ids.match,
        round_id: ids.round,
        tournament_id: ids.tournament,
        player_1_id: ids.p1,
        player_2_id: ids.p2,
        winner_id: ids.p1,
        status: 'completed',
        submitter_id: ids.p1,
        date_played: '2026-09-01T12:00:00.000Z',
        notes: PRIVATE_MATCH_SENTINELS.notes,
        auto_confirm_at: PRIVATE_MATCH_SENTINELS.auto_confirm_at,
        confirmed_at: PRIVATE_MATCH_SENTINELS.confirmed_at,
      }),
    );
    await seed(
      'match_evolution_snapshots',
      service.from('match_evolution_snapshots').insert({
        match_id: ids.match,
        player_id: ids.p1,
        base_pokemon: 'Charmander',
        species_at_match: 'Charmander',
        stage_at_match: 1,
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (!service) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    await del('match_evolution_snapshots', service.from('match_evolution_snapshots').delete().eq('match_id', ids.match));
    await del('matches', service.from('matches').delete().eq('id', ids.match));
    await del('rounds', service.from('rounds').delete().eq('id', ids.round));
    await del('tournaments', service.from('tournaments').delete().eq('id', ids.tournament));
    await del('players', service.from('players').delete().in('id', [ids.p1, ids.p2]));
    await del('rulesets', service.from('rulesets').delete().eq('id', ids.ruleset));
    if (authUserId) await del('auth user', service.auth.admin.deleteUser(authUserId));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  it('service_role still reads the full rows, private columns included (control)', async () => {
    const match = await service.from('matches').select('*').eq('id', ids.match).single();
    expect(match.error).toBeNull();
    expect(match.data?.notes).toBe(PRIVATE_MATCH_SENTINELS.notes);
    const player = await service.from('players').select('discord_id, ban_reason').eq('id', ids.p1).single();
    expect(player.error).toBeNull();
    expect(player.data?.ban_reason).toBe(`${PLAYER_SECRET} ban`);
    const snapshots = await service.from('match_evolution_snapshots').select('id').eq('match_id', ids.match);
    expect(snapshots.error).toBeNull();
    expect(snapshots.data).toHaveLength(1);
  }, 30000);

  it('service_role can still call the rpc endpoints (control)', async () => {
    const games = await service.rpc('get_total_games_in_scope', { p_scope_id: ids.tournament, p_scope_type: 'tournament' });
    expect(games.error).toBeNull();
    expect(games.data).toBe(0);
  }, 30000);

  for (const role of ['anon', 'authenticated'] as const) {
    describe(role, () => {
      it('cannot read any private match column', async () => {
        for (const column of [...PRIVATE_MATCH_FIELDS, ...INTERNAL_MATCH_COLUMNS]) {
          expectDenied(`${role} select=${column}`, await client(role).from('matches').select(column).eq('id', ids.match));
        }
      }, 30000);

      it('cannot read matches select=*', async () => {
        expectDenied(`${role} select=*`, await client(role).from('matches').select('*').eq('id', ids.match));
      }, 30000);

      it('cannot filter or sort on a private match column', async () => {
        expectDenied(`${role} filter notes`, await client(role).from('matches').select('id').ilike('notes', '%SECRET%'));
        expectDenied(`${role} order confirmed_at`, await client(role).from('matches').select('id').order('confirmed_at'));
      }, 30000);

      it('cannot embed through the private submitter foreign key', async () => {
        expectDenied(
          `${role} embed submitter`,
          await client(role).from('matches').select('id, submitter:players!matches_submitter_id_fkey(id)').eq('id', ids.match),
        );
      }, 30000);

      it('cannot reach matches through an embed from another table', async () => {
        expectDenied(
          `${role} tournaments -> matches(notes)`,
          await client(role).from('tournaments').select('id, matches(id, notes)').eq('id', ids.tournament),
        );
      }, 30000);

      it('cannot insert, update or delete matches', async () => {
        expectDenied(
          `${role} insert`,
          await client(role).from('matches').insert({
            round_id: ids.round,
            tournament_id: ids.tournament,
            player_1_id: ids.p1,
            player_2_id: ids.p2,
          }),
        );
        expectDenied(`${role} update`, await client(role).from('matches').update({ notes: 'overwritten' }).eq('id', ids.match));
        expectDenied(`${role} delete`, await client(role).from('matches').delete().eq('id', ids.match));
        const after = await service.from('matches').select('notes').eq('id', ids.match).single();
        expect(after.data?.notes).toBe(PRIVATE_MATCH_SENTINELS.notes);
      }, 30000);

      it('reads no match column at all, public ones included', async () => {
        expectDenied(
          `${role} public match columns`,
          await client(role).from('matches').select(PUBLIC_MATCH_COLUMNS.join(', ')).eq('id', ids.match),
        );
      }, 30000);

      it('cannot read players, private columns or public ones', async () => {
        expectDenied(
          `${role} players.discord_id`,
          await client(role).from('players').select('discord_id, auth_user_id, is_admin, ban_reason').eq('id', ids.p1),
        );
        expectDenied(`${role} players select=id,name`, await client(role).from('players').select('id, name').eq('id', ids.p1));
      }, 30000);

      it('cannot read or write match_evolution_snapshots, or call its replace rpc', async () => {
        expectDenied(`${role} snapshots select`, await client(role).from('match_evolution_snapshots').select('id').eq('match_id', ids.match));
        expectDenied(
          `${role} snapshots insert`,
          await client(role).from('match_evolution_snapshots').insert({
            match_id: ids.match,
            player_id: ids.p1,
            base_pokemon: 'Charmander',
            species_at_match: 'Charmander',
            stage_at_match: 1,
          }),
        );
        expectDenied(
          `${role} snapshots delete`,
          await client(role).from('match_evolution_snapshots').delete().eq('match_id', ids.match),
        );
        expectDenied(
          `${role} rpc epb_replace_match_snapshots`,
          await client(role).rpc('epb_replace_match_snapshots', { p_match_id: ids.match, p_snapshots: [] }),
        );
        const after = await service.from('match_evolution_snapshots').select('id').eq('match_id', ids.match);
        expect(after.data, `${role}: the seeded snapshot survives`).toHaveLength(1);
      }, 30000);

      it('cannot read the other public-read tables or call rpc endpoints', async () => {
        expectDenied(`${role} seasons`, await client(role).from('seasons').select('id').limit(1));
        expectDenied(`${role} tournaments`, await client(role).from('tournaments').select('id').eq('id', ids.tournament));
        expectDenied(
          `${role} rpc get_total_games_in_scope`,
          await client(role).rpc('get_total_games_in_scope', { p_scope_id: ids.tournament, p_scope_type: 'tournament' }),
        );
      }, 30000);
    });
  }
});
