import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeagueTrashDbError, leagueTrashBlockOf } from '../db-error';
import { seedLeague, type Client, type LeagueIds } from './local-fixture';
import { DERIVED_SPECS, OWNED_SPECS, countsByKey, fingerprintLeague, readClocks } from './local-readers';
import { deleteLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test of the league recycle bin (supabase/migrations/20261026091000_league_trash.sql and its siblings):
// seeds real leagues into a LOCAL Supabase stack through supabase-js and proves, against the real functions behind
// PostgREST (so under the same 8 s statement limit production has):
//   * delete leaves ZERO rows by every key (owned and derived tables), touches nothing else, nulls the outside pointers
//     and freezes the running draft;
//   * (the read-only archive redraft_trade_requests is covered by the SQL lab, scripts/league-trash-lab/06_service_role.sql)
//   * the junction tables make the database refuse to delete a player (also through claim_guest_player), a ruleset
//     (also through the Showdown ruleset cleanup) and a point-buy list version while the league sits in the trash;
//   * restore is row-identical (count + md5 per owned table, minus shifted clocks, the aggregate marker and the freeze
//     columns), shifts EVERY running deadline by the time in the trash, queues one increment job per restored game, keeps
//     the draft paused and re-links the outside rows;
//   * restore twice, restore with the season id taken again and restore with a corrupted snapshot (LEAGUE_TRASH_PLAN_MISMATCH)
//     are refused and restore nothing;
//   * a restore racing an expiry ends in exactly one consistent state;
//   * timings of a realistic league (and, with LOCAL_LEAGUE_TRASH_HUGE=1, of a ~118k battle_stats league).
// Schema drift needs DDL, which supabase-js cannot run: see scripts/league-trash-lab/ (04_schema_drift.sql).
//
// It seeds LOCAL data only (after `supabase db reset`), never loads `.env`, never runs in CI, and cleans up after itself.
//
//   LOCAL_LEAGUE_TRASH=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/league-trash/__tests__/league-trash.local.test.ts
//
// The local key comes from `supabase status -o env` (SERVICE_ROLE_KEY). Add LOCAL_LEAGUE_TRASH_HUGE=1 for the big timing.
const optIn = process.env.LOCAL_LEAGUE_TRASH === '1' && process.env.CI !== 'true';
const hugeOptIn = optIn && process.env.LOCAL_LEAGUE_TRASH_HUGE === '1';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[league-trash.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[league-trash.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`);
  }
}

/** A key passed on the command line, never the vitest placeholder. */
function localServiceKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value === 'dummy-service-role-key') {
    throw new Error('[league-trash.local] refusing to run: pass the LOCAL SUPABASE_SERVICE_ROLE_KEY on the command line');
  }
  return value;
}

if (optIn) {
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  localServiceKey();
}

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Every test below may seed and read many rows. */
const SLOW = 15 * MINUTE;

type Queries = typeof import('@/lib/supabase/queries/league-trash');

describe.skipIf(!optIn)('league recycle bin on the local stack', () => {
  let admin: Client;
  let q: Queries;
  const created: LeagueIds[] = [];
  const timings: string[] = [];

  async function seed(players: number, phases: number, rounds: number, name: string): Promise<LeagueIds> {
    const ids = await seedLeague(admin, { players, phases, rounds, name });
    created.push(ids);
    return ids;
  }

  /** A head count query: the filters the tests need and the awaited result. */
  interface HeadCount extends PromiseLike<{ count: number | null; error: { message: string } | null }> {
    eq(column: string, value: string): HeadCount;
    is(column: string, value: null): HeadCount;
  }

  async function count(table: string, filter?: (query: HeadCount) => HeadCount): Promise<number> {
    const base = admin.from(table).select('*', { count: 'exact', head: true }) as unknown as HeadCount;
    const { count: n, error } = await (filter ? filter(base) : base);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return n ?? 0;
  }

  /** Row counts of everything a league delete must leave alone. */
  async function others(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of ['players', 'ruleset_definition_versions', 'point_buy_list_versions', 'point_buy_list_entries', 'audit_log', 'cast_sessions', 'agent_suggestions', 'agent_conversations', 'player_streaks']) {
      out[table] = await count(table);
    }
    out['teams outside any league'] = await count('teams', (query) => query.is('season_id', null));
    return out;
  }

  async function rpc<T = Record<string, unknown>>(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    return { data: data as T | null, error };
  }

  async function trashRowExists(trashId: string): Promise<boolean> {
    return (await count('league_trash', (query) => query.eq('id', trashId))) === 1;
  }

  async function seasonExists(seasonId: string): Promise<boolean> {
    return (await count('seasons', (query) => query.eq('id', seasonId))) === 1;
  }

  /** Makes a trash entry purgeable by the real clock without waiting 90 days. */
  async function backdate(trashId: string): Promise<void> {
    const { error } = await admin
      .from('league_trash')
      .update({ deleted_at: new Date(Date.now() - 2 * DAY).toISOString(), purge_after: new Date(Date.now() - MINUTE).toISOString() })
      .eq('id', trashId);
    if (error) throw new Error(`backdate: ${error.message}`);
  }

  /** Removes a seeded league and the rows that point at it from outside; best effort (a leftover only clutters the local stack). */
  async function dispose(ids: LeagueIds): Promise<void> {
    const attempt = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await run();
      if (error) console.warn(`[league-trash.local] cleanup ${what}: ${error.message}`);
    };
    if (await seasonExists(ids.seasonId)) {
      const trash = await q.moveLeagueToTrash(ids.seasonId, ids.adminId);
      await q.markLeagueTrashRebuildDone(trash.trash_id);
      await backdate(trash.trash_id);
    } else {
      const entry = await q.getLeagueTrashBySeason(ids.seasonId);
      if (entry) {
        await q.markLeagueTrashRebuildDone(entry.id);
        await backdate(entry.id);
      }
    }
    await q.markLeagueRestoreRebuildDone(ids.seasonId);
    await q.expireLeagueTrash(new Date());
    await attempt('agent_suggestions', () => admin.from('agent_suggestions').delete().eq('id', ids.outside.suggestionId));
    await attempt('agent_conversations', () => admin.from('agent_conversations').delete().eq('player_id', ids.adminId));
    await attempt('cast_sessions', () => admin.from('cast_sessions').delete().eq('id', ids.outside.castSessionId));
    await attempt('teams', () => admin.from('teams').delete().in('id', [ids.outside.forkTeamId, ids.outside.pointerTeamId]));
    await attempt('player_streaks', () => admin.from('player_streaks').delete().in('player_id', ids.playerIds));
    await attempt('players', () => admin.from('players').delete().in('id', ids.playerIds));
    await attempt('rulesets', () => deleteLocalRuleset(admin, ids.rulesetId));
    await attempt('point_buy_list_versions', () => admin.from('point_buy_list_versions').delete().eq('id', ids.listVersionId));
  }

  beforeAll(async () => {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, localServiceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    // The app's own query module, against the same local stack (the env above is what its client reads).
    q = await import('@/lib/supabase/queries/league-trash');
  }, SLOW);

  afterAll(async () => {
    for (const ids of created.reverse()) await dispose(ids).catch((e: unknown) => console.warn('[league-trash.local] cleanup failed', e));
    if (timings.length > 0) console.log(`[league-trash.local] timings through PostgREST:\n  ${timings.join('\n  ')}`);
  }, SLOW);

  it('the specs here list exactly the tables of league_trash__inventory()', async () => {
    const { data, error } = await admin.rpc('league_trash__inventory');
    expect(error).toBeNull();
    const rows = data as { rel: string; cls: string }[];
    expect(rows.filter((r) => r.cls === 'owned').map((r) => r.rel).sort()).toEqual(OWNED_SPECS.map((s) => s.table).sort());
    expect(rows.filter((r) => r.cls === 'derived').map((r) => r.rel).sort()).toEqual(DERIVED_SPECS.map((s) => s.table).sort());
  });

  describe('delete, junction blocks, restore', () => {
    let league: LeagueIds;
    let bystander: LeagueIds;
    let trash: Awaited<ReturnType<Queries['moveLeagueToTrash']>>;
    let before: Awaited<ReturnType<typeof fingerprintLeague>>;
    let bystanderBefore: Awaited<ReturnType<typeof fingerprintLeague>>;
    let clocksBefore: Awaited<ReturnType<typeof readClocks>>;
    let othersBefore: Record<string, number>;
    let draftLogBefore: number;
    let registeredPlayerId: string;
    let restoreShiftSeconds = 0;

    beforeAll(async () => {
      league = await seed(12, 3, 3, 'LTT small');
      bystander = await seed(4, 1, 2, 'LTT bystander');
      registeredPlayerId = league.playerIds[3];
      const { error } = await admin.from('players').update({ is_guest: false, discord_id: `ltt-${registeredPlayerId}` }).eq('id', registeredPlayerId);
      if (error) throw new Error(`registering a player: ${error.message}`);
      before = await fingerprintLeague(admin, league);
      bystanderBefore = await fingerprintLeague(admin, bystander);
      clocksBefore = await readClocks(admin, league);
      othersBefore = await others();
      draftLogBefore = await count('draft_action_log');
    }, SLOW);

    it('the fixture touches every owned table (but the read-only archive, which only the SQL lab can seed)', () => {
      const empty = Object.entries(before).filter(([, f]) => f.n === 0).map(([table]) => table);
      expect(empty).toEqual(['redraft_trade_requests']);
    });

    it('delete leaves zero rows by every key and touches nothing else', async () => {
      const t0 = Date.now();
      trash = await q.moveLeagueToTrash(league.seasonId, league.adminId);
      timings.push(`small (${league.counts.matches} matches, ${league.counts.battleStats} battle_stats): delete ${Date.now() - t0} ms`);

      expect(trash.frozen_pools).toBe(1);
      expect([...trash.player_ids].sort()).toEqual([...league.playerIds].sort());
      expect([...trash.phase_ids].sort()).toEqual([...league.phaseIds].sort());
      expect(trash.counts.matches).toBe(league.counts.matches);
      expect(trash.counts.battle_stats).toBe(league.counts.battleStats);
      expect(trash.schema_version).toBe(await q.getLeagueTrashSchemaVersion());

      for (const spec of [...OWNED_SPECS, ...DERIVED_SPECS]) {
        expect(await countsByKey(admin, spec, league), spec.table).toEqual(spec.by.map(() => 0));
      }

      expect(await others()).toEqual(othersBefore);
      expect(await count('draft_action_log')).toBe(draftLogBefore + trash.frozen_pools);
      expect(await fingerprintLeague(admin, bystander)).toEqual(bystanderBefore);
    }, SLOW);

    it('nulls the outside rows that pointed into the league', async () => {
      const cast = await admin.from('cast_sessions').select('season_id, tournament_id, match_id').eq('id', league.outside.castSessionId).single();
      expect(cast.data).toEqual({ season_id: null, tournament_id: null, match_id: null });
      const suggestion = await admin.from('agent_suggestions').select('match_id').eq('id', league.outside.suggestionId).single();
      expect(suggestion.data).toEqual({ match_id: null });
      const teams = await admin.from('teams').select('id, forked_from_team_id, match_id').in('id', [league.outside.forkTeamId, league.outside.pointerTeamId]);
      expect(teams.data?.every((t) => t.forked_from_team_id === null && t.match_id === null)).toBe(true);
      const streaks = await admin.from('player_streaks').select('last_match_id').in('player_id', league.outside.streakPlayerIds);
      expect(streaks.data?.length).toBe(league.outside.streakPlayerIds.length);
      expect(streaks.data?.every((s) => s.last_match_id === null)).toBe(true);
    });

    it('lists the entry without its snapshot and holds the parents', async () => {
      const listed = (await q.listLeagueTrash()).find((item) => item.id === trash.trash_id);
      expect(listed).toMatchObject({
        season_id: league.seasonId,
        season_name: 'LTT small',
        deleted_by: league.adminId,
        rebuild_pending: true,
        schema_version: trash.schema_version,
      });
      expect(Object.keys(listed ?? {})).not.toContain('unlinked');
      expect(listed?.counts.matches).toBe(league.counts.matches);
      expect(new Date(listed?.purge_after ?? 0).getTime() - new Date(listed?.deleted_at ?? 0).getTime()).toBe(90 * DAY);
      expect(await count('league_trash_tables', (query) => query.eq('trash_id', trash.trash_id))).toBe(50);
      expect(await count('league_trash_players', (query) => query.eq('trash_id', trash.trash_id))).toBe(league.playerIds.length);
      expect(await count('league_trash_rulesets', (query) => query.eq('trash_id', trash.trash_id))).toBe(1);
      expect(await count('league_trash_point_buy_versions', (query) => query.eq('trash_id', trash.trash_id))).toBe(1);
      expect(await q.countLeagueTrashForPlayer(league.playerIds[0])).toBe(1);
      const pending = await q.listPendingLeagueRebuilds();
      expect(pending.find((p) => p.trash_id === trash.trash_id)).toMatchObject({ kind: 'delete', season_id: league.seasonId });
      expect(await q.getPendingLeagueRebuild(trash.trash_id)).toMatchObject({
        kind: 'delete',
        trash_id: trash.trash_id,
        season_id: league.seasonId,
        season_name: 'LTT small',
      });
      expect(await q.getLeagueTrashBySeason(league.seasonId)).toMatchObject({ id: trash.trash_id, season_name: 'LTT small' });
    });

    it('the database refuses to delete a player, a ruleset or a list version of a trashed league', async () => {
      const player = await admin.from('players').delete().eq('id', league.playerIds[5]);
      expect(player.error?.code).toBe('23503');
      expect(leagueTrashBlockOf(player.error)).toBe('player');

      // A ruleset is a definition with versions; the pinned version is what the junction holds, so the delete of the
      // definition cascades over it and is refused.
      const ruleset = await deleteLocalRuleset(admin, league.rulesetId);
      expect((ruleset.error as { code?: string } | null)?.code).toBe('23503');
      expect(leagueTrashBlockOf(ruleset.error)).toBe('ruleset');

      const version = await admin.from('point_buy_list_versions').delete().eq('id', league.listVersionId);
      expect(version.error?.code).toBe('23503');
      expect(leagueTrashBlockOf(version.error)).toBe('point_buy_version');

      // The rule-preset ruleset cleanup of Format Studio deletes league-owned rulesets nothing references. A version the
      // trash holds is a reference, so the cleanup keeps the definition instead of failing on the junction key.
      const cleanup = await rpc('format_delete_unused_preset_rulesets', { p_recorded: { gen9ou: league.rulesetDefinitionId }, p_kept: {} });
      expect(cleanup.error).toBeNull();
      expect(cleanup.data).toEqual([]);
      expect(await count('ruleset_definitions', (query) => query.eq('id', league.rulesetDefinitionId))).toBe(1);

      // A guest claim deletes the registered source account: refused while the source is in a trashed league.
      await admin.from('player_streaks').delete().eq('player_id', registeredPlayerId);
      const claim = await rpc('claim_guest_player', { p_guest_id: bystander.playerIds[0], p_source_id: registeredPlayerId });
      expect(claim.error?.code).toBe('23503');
      expect(leagueTrashBlockOf(claim.error)).toBe('player');

      expect(await count('players', (query) => query.eq('id', league.playerIds[5]))).toBe(1);
    });

    it('restore is row-identical, shifts every running deadline, queues the games and re-links the outside rows', async () => {
      // The rebuild after the delete is not confirmed yet: the database itself refuses, and changes nothing.
      await expect(q.restoreLeagueFromTrash(trash.trash_id)).rejects.toMatchObject({ code: 'LEAGUE_TRASH_REBUILD_PENDING' });
      expect(await trashRowExists(trash.trash_id)).toBe(true);
      expect(await seasonExists(league.seasonId)).toBe(false);
      expect(await q.markLeagueTrashRebuildDone(trash.trash_id)).toBe(true);
      expect(await q.getPendingLeagueRebuild(trash.trash_id)).toBeNull();

      const restoreNow = new Date(Date.now() + 30 * DAY).toISOString();
      const t0 = Date.now();
      const restored = await rpc<{
        season_id: string;
        restored: Record<string, number>;
        shift_seconds: number;
        paused_pools: number;
        queued_aggregate_jobs: number;
        warnings: unknown[];
      }>('league_trash_restore', { p_trash_id: trash.trash_id, p_now: restoreNow });
      timings.push(`small: restore ${Date.now() - t0} ms`);
      expect(restored.error).toBeNull();
      const result = restored.data as NonNullable<typeof restored.data>;
      restoreShiftSeconds = result.shift_seconds;
      expect(result.season_id).toBe(league.seasonId);
      expect(result.warnings).toEqual([]);
      expect(result.restored).toEqual(Object.fromEntries(Object.entries(trash.counts).filter(([, n]) => n > 0)));
      expect(result.paused_pools).toBe(1);
      expect(result.queued_aggregate_jobs).toBe(league.counts.games);
      expect(restoreShiftSeconds).toBeGreaterThan(30 * 86_400 - 1);

      // Row-identical: count and md5 of every owned table, minus the columns that legitimately change.
      const after = await fingerprintLeague(admin, league);
      for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);

      // Every running deadline moved by exactly the time in the trash (an overdue one too).
      const clocksAfter = await readClocks(admin, league);
      for (const [key, rows] of Object.entries(clocksBefore)) {
        for (const [id, value] of Object.entries(rows)) {
          const now = clocksAfter[key][id];
          if (value === null) expect(now, `${key} ${id}`).toBeNull();
          else expect(new Date(now as string).getTime() - new Date(value).getTime(), `${key} ${id}`).toBeCloseTo(restoreShiftSeconds * 1000, -3);
        }
      }
      expect(Object.values(clocksBefore).flatMap((rows) => Object.values(rows)).filter((v) => v !== null).length).toBeGreaterThan(0);

      // The running draft comes back paused with its slot frozen.
      const pool = await admin.from('draft_pools').select('paused_at, paused_by, pause_reason').eq('id', league.poolIds[0]).single();
      expect(pool.data).toMatchObject({ paused_by: league.adminId, pause_reason: 'admin' });
      expect(pool.data?.paused_at).not.toBeNull();
      const slot = await admin.from('draft_slots').select('deadline_at, remaining_ms_at_pause').eq('draft_pool_id', league.poolIds[0]).eq('status', 'active').single();
      expect(slot.data?.deadline_at).toBeNull();
      expect(slot.data?.remaining_ms_at_pause).toBeGreaterThan(0);
      expect(slot.data?.remaining_ms_at_pause).toBeLessThanOrEqual(40 * MINUTE);

      // Games come back unmarked with exactly one pending increment job each (the worker rebuilds the scopes atomically).
      const games = await admin.from('games').select('id, aggregate_applied_at').in('id', league.gameIds.slice(0, 50));
      expect(games.data?.every((g) => g.aggregate_applied_at === null)).toBe(true);
      const jobs = await admin.from('aggregate_jobs').select('game_id, operation, status', { count: 'exact' }).eq('season_id', league.seasonId).limit(5000);
      expect(jobs.count).toBe(league.counts.games);
      expect(new Set(jobs.data?.map((j) => j.game_id)).size).toBe(jobs.data?.length);
      expect(jobs.data?.every((j) => j.operation === 'increment' && j.status === 'pending')).toBe(true);

      // Outside rows are re-linked; the derived streak pointers are not (the app recomputes them).
      const cast = await admin.from('cast_sessions').select('season_id, tournament_id, match_id').eq('id', league.outside.castSessionId).single();
      expect(cast.data).toEqual({ season_id: league.seasonId, tournament_id: league.phaseIds[0], match_id: league.matchIds[0] });
      const suggestion = await admin.from('agent_suggestions').select('match_id').eq('id', league.outside.suggestionId).single();
      expect(suggestion.data).toEqual({ match_id: league.matchIds[0] });
      const fork = await admin.from('teams').select('forked_from_team_id').eq('id', league.outside.forkTeamId).single();
      expect(fork.data).toEqual({ forked_from_team_id: league.teamIds[0] });
      const pointer = await admin.from('teams').select('match_id').eq('id', league.outside.pointerTeamId).single();
      expect(pointer.data?.match_id).not.toBeNull();
      const streaks = await admin.from('player_streaks').select('last_match_id').in('player_id', league.outside.streakPlayerIds.filter((p) => p !== registeredPlayerId));
      expect(streaks.data?.every((s) => s.last_match_id === null)).toBe(true);

      // The trash row, its captured rows and its junction rows are gone; the tombstone waits for the app's rebuild.
      expect(await trashRowExists(trash.trash_id)).toBe(false);
      expect(await q.countLeagueTrashForPlayer(league.playerIds[0])).toBe(0);
      const pending = await q.listPendingLeagueRebuilds();
      expect(pending.find((p) => p.season_id === league.seasonId)).toMatchObject({ kind: 'restore', trash_id: trash.trash_id });
      expect(await q.getPendingLeagueRebuild(trash.trash_id)).toMatchObject({ kind: 'restore', season_id: league.seasonId });
      expect(await q.markLeagueRestoreRebuildDone(league.seasonId)).toBe(true);
      expect(await q.markLeagueRestoreRebuildDone(league.seasonId)).toBe(false);

      expect(await fingerprintLeague(admin, bystander)).toEqual(bystanderBefore);
      // The one streak row the claim test removed is the only difference.
      expect(await others()).toEqual({ ...othersBefore, player_streaks: othersBefore.player_streaks - 1 });
    }, SLOW);

    it('restoring the same entry again says it is gone', async () => {
      await expect(q.restoreLeagueFromTrash(trash.trash_id)).rejects.toBeInstanceOf(LeagueTrashDbError);
      await expect(q.restoreLeagueFromTrash(trash.trash_id)).rejects.toMatchObject({ code: 'LEAGUE_TRASH_NOT_FOUND' });
    });

    it('refuses a taken season id and a corrupted snapshot, and restores nothing', async () => {
      const second = await q.moveLeagueToTrash(league.seasonId, league.adminId);
      await q.markLeagueTrashRebuildDone(second.trash_id);
      const mutate = (rel: string, patch: Record<string, unknown>) => admin.from('league_trash_tables').update(patch).eq('trash_id', second.trash_id).eq('rel', rel);

      // A captured table whose row count disagrees with what comes back.
      await mutate('format_rules', { n: 2 });
      const mismatch = await q.restoreLeagueFromTrash(second.trash_id).catch((e: unknown) => e);
      expect(mismatch).toMatchObject({ code: 'LEAGUE_TRASH_PLAN_MISMATCH' });
      expect((mismatch as LeagueTrashDbError).detail).toEqual({ mismatched: [{ rel: 'format_rules', captured: 2, restored: 1 }] });
      await mutate('format_rules', { n: 1 });

      // A captured table the restore plan does not know.
      await mutate('format_rules', { rel: 'lt_unknown_table' });
      const missing = await q.restoreLeagueFromTrash(second.trash_id).catch((e: unknown) => e);
      expect(missing).toMatchObject({ code: 'LEAGUE_TRASH_PLAN_MISMATCH', detail: { missing: ['lt_unknown_table'] } });
      await admin.from('league_trash_tables').update({ rel: 'format_rules' }).eq('trash_id', second.trash_id).eq('rel', 'lt_unknown_table');

      // The season id taken again.
      const squatter = await admin.from('seasons').insert({ id: league.seasonId, name: 'squatter', format_type: 'singles' });
      expect(squatter.error).toBeNull();
      await expect(q.restoreLeagueFromTrash(second.trash_id)).rejects.toMatchObject({ code: 'LEAGUE_TRASH_SEASON_EXISTS' });
      await admin.from('seasons').delete().eq('id', league.seasonId);

      // None of the failed attempts left anything behind.
      expect(await seasonExists(league.seasonId)).toBe(false);
      expect(await trashRowExists(second.trash_id)).toBe(true);
      for (const spec of OWNED_SPECS) expect(await countsByKey(admin, spec, league), spec.table).toEqual(spec.by.map(() => 0));

      // ... and the entry still restores, identical to the first time.
      await q.restoreLeagueFromTrash(second.trash_id);
      const after = await fingerprintLeague(admin, league);
      for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table]);
      await q.markLeagueRestoreRebuildDone(league.seasonId);
      expect(restoreShiftSeconds).toBeGreaterThan(0);
    }, SLOW);
  });

  describe('restore racing an expiry', () => {
    it.each([0, 15, 40, 90])('ends in exactly one consistent state (expiry starts %i ms after the restore)', async (delayMs) => {
      const ids = await seed(4, 1, 2, `LTT race ${delayMs}`);
      const fingerprint = await fingerprintLeague(admin, ids);
      const trash = await q.moveLeagueToTrash(ids.seasonId, ids.adminId);
      await q.markLeagueTrashRebuildDone(trash.trash_id);
      await backdate(trash.trash_id);
      // The restore is asked for a moment before the end of the retention, the expiry runs on the real clock after it.
      const restoreNow = new Date(Date.now() - 2 * MINUTE).toISOString();

      const [restored, expired] = await Promise.all([
        rpc('league_trash_restore', { p_trash_id: trash.trash_id, p_now: restoreNow }),
        new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => rpc<{ id: string }[]>('league_trash_expire', { p_now: new Date().toISOString(), p_limit: 20 })),
      ]);
      expect(expired.error).toBeNull();
      const purgedIds = (expired.data ?? []).map((row) => row.id);
      timings.push(`race, expiry ${delayMs} ms after the restore: ${restored.error === null ? 'restore won' : 'expiry won'}`);

      if (restored.error === null) {
        expect(purgedIds, 'a restored entry must not also be purged').not.toContain(trash.trash_id);
        expect(await seasonExists(ids.seasonId)).toBe(true);
        expect(await trashRowExists(trash.trash_id)).toBe(false);
        const after = await fingerprintLeague(admin, ids);
        for (const table of Object.keys(fingerprint)) expect(after[table], table).toEqual(fingerprint[table]);
      } else {
        expect(restored.error.message).toBe('LEAGUE_TRASH_NOT_FOUND');
        expect(purgedIds).toContain(trash.trash_id);
        expect(await seasonExists(ids.seasonId)).toBe(false);
        expect(await trashRowExists(trash.trash_id)).toBe(false);
        expect(await count('league_trash_tables', (query) => query.eq('trash_id', trash.trash_id))).toBe(0);
        expect(await count('league_trash_players', (query) => query.eq('trash_id', trash.trash_id))).toBe(0);
      }
    }, SLOW);

    it('an expiry skips an entry whose rebuild is still pending', async () => {
      const ids = await seed(4, 1, 2, 'LTT pending rebuild');
      const trash = await q.moveLeagueToTrash(ids.seasonId, ids.adminId);
      await backdate(trash.trash_id);
      const first = await q.expireLeagueTrash(new Date());
      expect(first.map((row) => row.id)).not.toContain(trash.trash_id);
      expect(await trashRowExists(trash.trash_id)).toBe(true);
      await q.markLeagueTrashRebuildDone(trash.trash_id);
      const second = await q.expireLeagueTrash(new Date());
      const row = second.find((r) => r.id === trash.trash_id);
      expect(row?.season_id).toBe(ids.seasonId);
      expect([...(row?.match_ids ?? [])].sort()).toEqual([...ids.matchIds].sort());
      expect(await trashRowExists(trash.trash_id)).toBe(false);
    }, SLOW);
  });

  describe('timings', () => {
    async function timeCycle(label: string, ids: LeagueIds): Promise<void> {
      const t0 = Date.now();
      const trash = await q.moveLeagueToTrash(ids.seasonId, ids.adminId);
      const deleteMs = Date.now() - t0;
      await q.markLeagueTrashRebuildDone(trash.trash_id);
      const t1 = Date.now();
      const restored = await q.restoreLeagueFromTrash(trash.trash_id);
      const restoreMs = Date.now() - t1;
      timings.push(`${label} (${ids.counts.matches} matches, ${ids.counts.games} games, ${ids.counts.battleStats} battle_stats): delete ${deleteMs} ms, restore ${restoreMs} ms`);
      expect(restored.restored.battle_stats).toBe(ids.counts.battleStats);
      // Through PostgREST every call is ONE statement under the 8 s limit of the authenticator role.
      expect(deleteMs).toBeLessThan(8000);
      expect(restoreMs).toBeLessThan(8000);
      await q.markLeagueRestoreRebuildDone(ids.seasonId);
    }

    it('a realistic large league (32 players, 3 phases of 12 rounds)', async () => {
      await timeCycle('realistic', await seed(32, 3, 12, 'LTT realistic'));
    }, SLOW);

    it.skipIf(!hugeOptIn)('a huge league (96 players, 3 phases of 40 rounds)', async () => {
      await timeCycle('huge', await seed(96, 3, 40, 'LTT huge'));
    }, SLOW);
  });
});
