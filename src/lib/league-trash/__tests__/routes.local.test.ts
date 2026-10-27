import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedLeague, type Client, type LeagueIds } from './local-fixture';
import { deleteLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test of the APP layer of the league recycle bin: the real route handlers (league DELETE, restore, pending
// rebuild, expiry cron, player and ruleset DELETE) run against a LOCAL Supabase stack with a seeded league. Only the
// session guards (`requireAdmin`, `requireSuperadmin`) and the Next cache calls are replaced; the queries, the
// database functions, the rebuild (aggregates queue drain, ratings, streaks), the audit log and the storage sweep are
// the real code. Companion of `league-trash.local.test.ts`, which proves the database functions themselves.
//
// It seeds LOCAL data only (after `supabase db reset`), never loads `.env`, never runs in CI, and cleans up after itself.
//
//   LOCAL_LEAGUE_TRASH=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/league-trash/__tests__/routes.local.test.ts
//
// The local key comes from `supabase status -o env` (SERVICE_ROLE_KEY).
const optIn = process.env.LOCAL_LEAGUE_TRASH === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack and the key was passed on the command line. */
function assertLocalStack(): string {
  let host = '';
  try {
    host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    throw new Error('[routes.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[routes.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[routes.local] refusing to run: pass the LOCAL SUPABASE_SERVICE_ROLE_KEY on the command line');
  }
  return key;
}

if (optIn) assertLocalStack();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const session = vi.hoisted(() => ({ playerId: '' }));

vi.mock('@/lib/auth/helpers', () => {
  const player = () => ({
    playerId: session.playerId,
    name: 'Local Admin',
    isAdmin: true,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active' as const,
  });
  return {
    requireAdmin: vi.fn(async () => player()),
    requireSuperadmin: vi.fn(async () => player()),
    requireAuth: vi.fn(async () => ({ player: player() })),
    isSuperadmin: vi.fn(() => true),
  };
});

const MINUTE = 60_000;
const DAY = 86_400_000;
const SLOW = 15 * MINUTE;
const CRON_SECRET = 'local-routes-test-secret';

type NextRequestLike = import('next/server').NextRequest;
const asRequest = (request: Request) => request as unknown as NextRequestLike;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!optIn)('league recycle bin: the routes against the local stack', () => {
  let admin: Client;
  const created: LeagueIds[] = [];

  let seasonRoute: typeof import('@/app/api/seasons/[id]/route');
  let restoreRoute: typeof import('@/app/api/admin/league-trash/[id]/restore/route');
  let rebuildRoute: typeof import('@/app/api/admin/league-trash/[id]/rebuild/route');
  let cronRoute: typeof import('@/app/api/cron/expire-league-trash/route');
  let playerRoute: typeof import('@/app/api/players/[id]/route');
  let rulesetRoute: typeof import('@/app/api/rulesets/[id]/route');
  let queries: typeof import('@/lib/supabase/queries/league-trash');

  async function count(table: string, column: string, value: string): Promise<number> {
    const { count: n, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return n ?? 0;
  }

  async function seed(name: string): Promise<LeagueIds> {
    const ids = await seedLeague(admin, { players: 8, phases: 2, rounds: 2, name });
    created.push(ids);
    session.playerId = ids.adminId;
    return ids;
  }

  /** The audit rows are written fire-and-forget: wait until the one the route logged is readable. */
  async function auditRows(action: string, resourceId: string) {
    let rows: { action: string; actor_name: string; actor_id: string | null; resource_name: string | null; metadata: Record<string, unknown> | null }[] = [];
    await vi.waitFor(
      async () => {
        const { data, error } = await admin
          .from('audit_log')
          .select('action, actor_name, actor_id, resource_name, metadata')
          .eq('action', action)
          .eq('resource_id', resourceId);
        if (error) throw new Error(error.message);
        rows = (data ?? []) as typeof rows;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 200 },
    );
    return rows;
  }

  async function backdate(trashId: string): Promise<void> {
    const { error } = await admin
      .from('league_trash')
      .update({ deleted_at: new Date(Date.now() - 2 * DAY).toISOString(), purge_after: new Date(Date.now() - MINUTE).toISOString() })
      .eq('id', trashId);
    if (error) throw new Error(`backdate: ${error.message}`);
  }

  async function dispose(ids: LeagueIds): Promise<void> {
    const attempt = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await run();
      if (error) console.warn(`[routes.local] cleanup ${what}: ${error.message}`);
    };
    const { data: live } = await admin.from('seasons').select('id').eq('id', ids.seasonId);
    if (live && live.length > 0) {
      const trash = await queries.moveLeagueToTrash(ids.seasonId, ids.adminId);
      await queries.markLeagueTrashRebuildDone(trash.trash_id);
      await backdate(trash.trash_id);
    } else {
      const entry = await queries.getLeagueTrashBySeason(ids.seasonId);
      if (entry) {
        await queries.markLeagueTrashRebuildDone(entry.id);
        await backdate(entry.id);
      }
    }
    await queries.markLeagueRestoreRebuildDone(ids.seasonId);
    await queries.expireLeagueTrash(new Date());
    await attempt('agent_suggestions', () => admin.from('agent_suggestions').delete().eq('id', ids.outside.suggestionId));
    await attempt('agent_conversations', () => admin.from('agent_conversations').delete().eq('player_id', ids.adminId));
    await attempt('cast_sessions', () => admin.from('cast_sessions').delete().eq('id', ids.outside.castSessionId));
    await attempt('teams', () => admin.from('teams').delete().in('id', [ids.outside.forkTeamId, ids.outside.pointerTeamId]));
    await attempt('player_streaks', () => admin.from('player_streaks').delete().in('player_id', ids.playerIds));
    await attempt('audit_log', () => admin.from('audit_log').delete().eq('resource_id', ids.seasonId));
    await attempt('players', () => admin.from('players').delete().in('id', ids.playerIds));
    await attempt('rulesets', () => deleteLocalRuleset(admin, ids.rulesetId));
    await attempt('point_buy_list_versions', () => admin.from('point_buy_list_versions').delete().eq('id', ids.listVersionId));
  }

  beforeAll(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, assertLocalStack(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    queries = await import('@/lib/supabase/queries/league-trash');
    seasonRoute = await import('@/app/api/seasons/[id]/route');
    restoreRoute = await import('@/app/api/admin/league-trash/[id]/restore/route');
    rebuildRoute = await import('@/app/api/admin/league-trash/[id]/rebuild/route');
    cronRoute = await import('@/app/api/cron/expire-league-trash/route');
    playerRoute = await import('@/app/api/players/[id]/route');
    rulesetRoute = await import('@/app/api/rulesets/[id]/route');
  }, SLOW);

  afterAll(async () => {
    delete process.env.CRON_SECRET;
    for (const ids of created.reverse()) await dispose(ids).catch((e: unknown) => console.warn('[routes.local] cleanup failed', e));
  }, SLOW);

  describe('delete, blocks, pending rebuild, restore', () => {
    let league: LeagueIds;
    let trashId: string;

    beforeAll(async () => {
      league = await seed('LTR routes');
    }, SLOW);

    it('DELETE /api/seasons/[id] moves the league to the trash, rebuilds, confirms and audits', async () => {
      const response = await seasonRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.seasonId));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.success).toBe(true);
      trashId = body.data.trash.id;
      expect(new Date(body.data.trash.purge_after).getTime()).toBeGreaterThan(Date.now() + 89 * DAY);
      // The derived-data rebuild ran on this synthetic league without a warning; if it ever warns, the cause is in the log.
      expect(body.data.rebuild_warning).toBeNull();

      expect(await count('seasons', 'id', league.seasonId)).toBe(0);
      expect(await count('tournaments', 'season_id', league.seasonId)).toBe(0);
      const { data: row } = await admin.from('league_trash').select('rebuild_pending, season_name').eq('id', trashId).single();
      expect(row).toEqual({ rebuild_pending: false, season_name: 'LTR routes' });
      expect(await queries.listPendingLeagueRebuilds()).toEqual([]);

      const audit = await auditRows('season.delete', league.seasonId);
      expect(audit[0].actor_id).toBe(league.adminId);
      expect(audit[0].metadata).toMatchObject({ trash_id: trashId, rebuild_error: null });
    }, SLOW);

    it('answers 404 for a league that is already in the trash, with nothing changed', async () => {
      const response = await seasonRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.seasonId));

      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe('SEASON_NOT_FOUND');
      expect(await count('league_trash', 'season_id', league.seasonId)).toBe(1);
    });

    it('blocks deleting a player and a ruleset the trashed league uses, with the precise 409s', async () => {
      const refs = await (await import('@/lib/supabase/queries/players')).getPlayerCompetitiveRefs(league.playerIds[1]);
      expect(refs.trashedLeagues).toBe(1);

      const player = await playerRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.playerIds[1]));
      expect(player.status).toBe(409);
      expect((await player.json()).code).toBe('player_still_referenced');
      expect(await count('players', 'id', league.playerIds[1])).toBe(1);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const ruleset = await rulesetRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.rulesetId));
        expect(ruleset.status).toBe(409);
        expect((await ruleset.json()).code).toBe('ruleset_in_trashed_league');
        expect(await count('ruleset_definition_versions', 'id', league.rulesetId)).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('refuses to restore while the rebuild after the delete is unconfirmed, and the pending rebuild route clears it', async () => {
      await admin.from('league_trash').update({ rebuild_pending: true }).eq('id', trashId);
      expect((await queries.listPendingLeagueRebuilds()).map((p) => [p.kind, p.trash_id])).toEqual([['delete', trashId]]);

      const refused = await restoreRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe('LEAGUE_TRASH_REBUILD_PENDING');
      expect(await count('seasons', 'id', league.seasonId)).toBe(0);

      const run = await rebuildRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));
      const runBody = await run.json();
      expect(run.status, JSON.stringify(runBody)).toBe(200);
      expect(runBody.data).toEqual({ kind: 'delete', rebuild_warning: null });
      expect(await queries.listPendingLeagueRebuilds()).toEqual([]);

      const again = await rebuildRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));
      expect(again.status).toBe(404);
      expect((await again.json()).code).toBe('LEAGUE_TRASH_NOT_FOUND');
      expect((await auditRows('season.rebuild', league.seasonId))[0].metadata).toMatchObject({ trash_id: trashId, kind: 'delete' });
    }, SLOW);

    it('POST restore brings the league back, drains the aggregate queue and confirms the rebuild', async () => {
      const response = await restoreRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.data).toMatchObject({ season_id: league.seasonId, season_name: 'LTR routes', rebuild_warning: null });
      expect(body.data.paused_pools).toBeGreaterThan(0);

      expect(await count('seasons', 'id', league.seasonId)).toBe(1);
      expect(await count('league_trash', 'id', trashId)).toBe(0);
      expect(await queries.listPendingLeagueRebuilds()).toEqual([]);

      // The restore queued one increment job per game with stats; the route's drain applied them.
      const { count: pendingJobs } = await admin.from('aggregate_jobs').select('*', { count: 'exact', head: true }).in('status', ['pending', 'processing']);
      expect(pendingJobs).toBe(0);
      const { count: unapplied } = await admin
        .from('games')
        .select('*', { count: 'exact', head: true })
        .in('id', league.gameIds)
        .is('aggregate_applied_at', null);
      expect(unapplied).toBe(0);

      const audit = await auditRows('season.restore', league.seasonId);
      const metadata = audit[0].metadata as { queued_aggregate_jobs: number; rebuild: { aggregateJobs: { processed: number; remaining: number }; ratingsSettled: boolean } };
      expect(audit[0].metadata).toMatchObject({ trash_id: trashId, rebuild_error: null });
      expect(metadata.queued_aggregate_jobs).toBeGreaterThan(0);
      // The drain applied every job the restore queued (and the rebuild summary says so).
      expect(metadata.rebuild.aggregateJobs.processed).toBeGreaterThanOrEqual(metadata.queued_aggregate_jobs);
      expect(metadata.rebuild.aggregateJobs.remaining).toBe(0);
      expect(metadata.rebuild.ratingsSettled).toBe(true);
    }, SLOW);

    it('answers 404 for a trash id that no longer exists', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await restoreRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));

        expect(response.status).toBe(404);
        expect((await response.json()).code).toBe('LEAGUE_TRASH_NOT_FOUND');
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('expiry cron', () => {
    let league: LeagueIds;
    let trashId: string;
    const objectName = `${crypto.randomUUID()}.png`;

    const cron = (secret: string | null) =>
      new Request('http://localhost/api/cron/expire-league-trash', {
        method: 'POST',
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      });

    beforeAll(async () => {
      league = await seed('LTR cron');
      const deleted = await seasonRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.seasonId));
      trashId = (await deleted.json()).data.trash.id;
      const bucket = admin.storage.from('social-images');
      const png = new Uint8Array([137, 80, 78, 71]);
      for (const path of [`matches/${league.matchIds[0]}/${objectName}`, `matches/${league.matchIds[1]}.png`]) {
        const { error } = await bucket.upload(path, png, { contentType: 'image/png', upsert: true });
        if (error) throw new Error(`upload ${path}: ${error.message}`);
      }
    }, SLOW);

    it('rejects a missing or wrong secret and touches nothing', async () => {
      expect((await cronRoute.POST(cron(null))).status).toBe(401);
      expect((await cronRoute.POST(cron('wrong'))).status).toBe(401);
      expect(await count('league_trash', 'id', trashId)).toBe(1);
    });

    it('leaves an entry inside its window alone', async () => {
      const response = await cronRoute.POST(cron(CRON_SECRET));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.leagues.find((l: { trash_id: string }) => l.trash_id === trashId)).toBeUndefined();
      expect(await count('league_trash', 'id', trashId)).toBe(1);
    });

    it('removes an entry past its window for good, sweeps its social images and audits as System', async () => {
      await backdate(trashId);

      const response = await cronRoute.POST(cron(CRON_SECRET));
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);
      const mine = body.data.leagues.find((l: { trash_id: string }) => l.trash_id === trashId);
      expect(mine).toBeDefined();
      expect(mine.social_images.errors).toEqual([]);
      expect(mine.social_images.removed).toBe(2);

      expect(await count('league_trash', 'id', trashId)).toBe(0);
      expect(await count('league_trash_tables', 'trash_id', trashId)).toBe(0);
      const bucket = admin.storage.from('social-images');
      const { data: folder } = await bucket.list(`matches/${league.matchIds[0]}`);
      expect(folder).toEqual([]);
      const { data: legacy } = await bucket.list('matches', { search: `${league.matchIds[1]}.png` });
      expect(legacy).toEqual([]);

      const audit = await auditRows('season.purge', league.seasonId);
      expect(audit[0]).toMatchObject({ actor_name: 'System', actor_id: null, resource_name: 'LTR cron' });
      expect(audit[0].metadata).toMatchObject({ trash_id: trashId });
    }, SLOW);

    it('is idempotent: a second run finds nothing due', async () => {
      const body = await (await cronRoute.POST(cron(CRON_SECRET))).json();

      expect(body.data.leagues.find((l: { trash_id: string }) => l.trash_id === trashId)).toBeUndefined();
    });

    it('a restore of the purged entry answers 404 LEAGUE_TRASH_NOT_FOUND', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await restoreRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));

        expect(response.status).toBe(404);
        expect((await response.json()).code).toBe('LEAGUE_TRASH_NOT_FOUND');
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('restore after the window', () => {
    it('answers 410 LEAGUE_TRASH_EXPIRED for an entry the cron has not removed yet', async () => {
      const league = await seed('LTR expired');
      const deleted = await seasonRoute.DELETE(asRequest(new Request('http://localhost/x', { method: 'DELETE' })), ctx(league.seasonId));
      const trashId = (await deleted.json()).data.trash.id;
      await backdate(trashId);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await restoreRoute.POST(asRequest(new Request('http://localhost/x', { method: 'POST' })), ctx(trashId));

        expect(response.status).toBe(410);
        expect((await response.json()).code).toBe('LEAGUE_TRASH_EXPIRED');
        expect(await count('seasons', 'id', league.seasonId)).toBe(0);
      } finally {
        errorSpy.mockRestore();
      }
    }, SLOW);
  });
});
