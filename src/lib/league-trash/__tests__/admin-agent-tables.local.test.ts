import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteLocalRuleset } from '@/test/local-rulesets';
import { seedLeague, type LeagueIds } from './local-fixture';

// LIVE-LOCAL test of the Admin Assistant tables (supabase/migrations/20261027100000_admin_agent_tables.sql): the
// triggers, the purge, the turn lease, the blast-radius counters, the usage reservation and the recycle-bin rule,
// against the real functions behind PostgREST of a LOCAL Supabase stack. The static twins are
// `src/lib/supabase/__tests__/admin-agent-tables-migration.test.ts` and the last block of `inventory.test.ts`.
//   * forbidden updates raise, deletes are refused (service_role holds no DELETE, and the trigger refuses anyway);
//   * deleting an admin who used the assistant succeeds and keeps the rows (admin_id NULL, admin_name kept);
//   * eight concurrent callers: exactly one wins the lease, exactly cap-many pass the counters, the reservation never
//     passes the cap;
//   * the retention purge nulls message content, scrubs the approver data, drops expired snapshots and old conversations;
//   * a league moved to the trash and restored while ledger rows name it: the rows stay, the delete never meets them.
// The triggers' flag handling (a forged `app.retention_purge`, TRUNCATE, anon) needs SQL a PostgREST client cannot send;
// it was checked in psql against the same stack (see the report of the change).
//
// It seeds LOCAL data only, never loads `.env`, never runs in CI. Rows cannot be deleted through the API on purpose, so
// cleanup is the real retention purge: the test conversations are aged past the audit window first, and the purge drops
// them with everything below them. The only residue are `admin_agent_usage` rows of the reservation test (settled at
// cost 0, admin_id NULL once the test player is gone): usage is kept for two years by design.
//
//   LOCAL_ADMIN_AGENT_TABLES=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/league-trash/__tests__/admin-agent-tables.local.test.ts
//
// The local key comes from `supabase status -o env` (SERVICE_ROLE_KEY).
const optIn = process.env.LOCAL_ADMIN_AGENT_TABLES === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[admin-agent-tables.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[admin-agent-tables.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`);
  }
}

/** A key passed on the command line, never the vitest placeholder. */
function localServiceKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value === 'dummy-service-role-key') {
    throw new Error('[admin-agent-tables.local] refusing to run: pass the LOCAL SUPABASE_SERVICE_ROLE_KEY on the command line');
  }
  return value;
}

if (optIn) {
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  localServiceKey();
}

const DAY = 86_400_000;
const SLOW = 5 * 60_000;
const HASH = (c: string) => c.repeat(64);
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

type Queries = typeof import('@/lib/supabase/queries/league-trash');
interface Lease {
  out_lease_until: string | null;
  out_busy: string | null;
}
interface Claim {
  out_ok: boolean;
  out_counter: string | null;
  out_value: number | null;
  out_cap: number | null;
}
interface Reservation {
  out_usage_id: string | null;
  out_exceeded: string | null;
  out_used: number | null;
  out_cap: number | null;
}

describe.skipIf(!optIn)('Admin Assistant tables on the local stack', () => {
  let db: SupabaseClient;
  let q: Queries;
  const players: string[] = [];
  const conversations: string[] = [];
  const leagues: LeagueIds[] = [];

  /** Throws on a PostgREST error and returns the data. */
  async function ok<T>(run: PromiseLike<{ data: T; error: { message: string; details?: string } | null }>, what: string): Promise<NonNullable<T>> {
    const { data, error } = await run;
    if (error) throw new Error(`${what}: ${error.message} ${error.details ?? ''}`);
    if (data === null || data === undefined) throw new Error(`${what}: no data`);
    return data;
  }

  async function newPlayer(name: string): Promise<string> {
    const id = randomUUID();
    await ok(db.from('players').insert({ id, name: `aat_${name}_${id.slice(0, 8)}`, is_guest: true }).select('id'), `player ${name}`);
    players.push(id);
    return id;
  }

  async function newConversation(adminId: string | null, adminName: string, lastMessageAt: string = new Date().toISOString()): Promise<string> {
    const id = randomUUID();
    await ok(
      db
        .from('admin_agent_conversations')
        .insert({
          id,
          admin_id: adminId,
          admin_name: adminName,
          ui_locale: 'en',
          model: 'test-model',
          effort: 'medium',
          tool_set: 'site',
          tool_registry_version: 'r1',
          system_prompt_version: 'p1',
          last_message_at: lastMessageAt,
        })
        .select('id'),
      'conversation',
    );
    conversations.push(id);
    return id;
  }

  async function newAction(conversationId: string, adminId: string | null, extra: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await ok(
      db
        .from('admin_agent_actions')
        .insert({
          id,
          conversation_id: conversationId,
          admin_id: adminId,
          admin_name: 'Test Admin',
          tool_name: 'league_create',
          class: 'B',
          method: 'POST',
          path: '/api/seasons',
          args_hash: HASH('a'),
          ...extra,
        })
        .select('id'),
      'action',
    );
    return id;
  }

  async function count(table: string, column: string, value: string): Promise<number> {
    const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return n ?? 0;
  }

  /** Removes a seeded league and what points at it from outside; best effort (a leftover only clutters the local stack). */
  async function disposeLeague(ids: LeagueIds): Promise<void> {
    const attempt = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await run();
      if (error) console.warn(`[admin-agent-tables.local] cleanup ${what}: ${error.message}`);
    };
    const exists = (await count('seasons', 'id', ids.seasonId)) === 1;
    const backdate = async (trashId: string) => {
      await attempt('backdate', () =>
        db.from('league_trash').update({ deleted_at: ago(2), purge_after: ago(0.001) }).eq('id', trashId),
      );
    };
    if (exists) {
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
    await attempt('agent_suggestions', () => db.from('agent_suggestions').delete().eq('id', ids.outside.suggestionId));
    await attempt('agent_conversations', () => db.from('agent_conversations').delete().eq('player_id', ids.adminId));
    await attempt('cast_sessions', () => db.from('cast_sessions').delete().eq('id', ids.outside.castSessionId));
    await attempt('teams', () => db.from('teams').delete().in('id', [ids.outside.forkTeamId, ids.outside.pointerTeamId]));
    await attempt('player_streaks', () => db.from('player_streaks').delete().in('player_id', ids.playerIds));
    await attempt('players', () => db.from('players').delete().in('id', ids.playerIds));
    await attempt('rulesets', () => deleteLocalRuleset(db, ids.rulesetId));
    await attempt('point_buy_list_versions', () => db.from('point_buy_list_versions').delete().eq('id', ids.listVersionId));
  }

  beforeAll(async () => {
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, localServiceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    q = await import('@/lib/supabase/queries/league-trash');
  }, SLOW);

  afterAll(async () => {
    // Age every conversation of the test past the audit window (last_message_at is a mutable column), then let the real
    // purge delete them with their tree. Rows cannot be deleted any other way.
    for (const id of conversations) {
      await db.from('admin_agent_conversations').update({ last_message_at: ago(800) }).eq('id', id);
    }
    for (let i = 0; i < 5; i += 1) {
      const { data, error } = await db.rpc('admin_agent_retention_purge', {});
      if (error) {
        console.warn(`[admin-agent-tables.local] cleanup purge: ${error.message}`);
        break;
      }
      if ((data as { conversations_deleted: number }).conversations_deleted === 0) break;
    }
    for (const league of leagues.reverse()) await disposeLeague(league).catch((e: unknown) => console.warn('[admin-agent-tables.local] league cleanup failed', e));
    const { error } = await db.from('players').delete().in('id', players);
    if (error) console.warn(`[admin-agent-tables.local] cleanup players: ${error.message}`);
  }, SLOW);

  describe('immutability', () => {
    it('refuses a change of an immutable column, accepts a whitelisted one, and cannot delete', async () => {
      const adminId = await newPlayer('immutable');
      const id = await newConversation(adminId, 'Immutable Admin');

      const bad = await db.from('admin_agent_conversations').update({ model: 'other' }).eq('id', id);
      expect(bad.error?.message).toBe('ADMIN_AGENT_IMMUTABLE');
      const renamed = await db.from('admin_agent_conversations').update({ admin_name: 'Someone Else' }).eq('id', id);
      expect(renamed.error?.message).toBe('ADMIN_AGENT_IMMUTABLE');
      const good = await db.from('admin_agent_conversations').update({ title: 'A title', seq_head: 1 }).eq('id', id);
      expect(good.error).toBeNull();

      await ok(db.from('admin_agent_messages').insert({ conversation_id: id, seq: 1, role: 'user', kind: 'chat', content: [{ type: 'text', text: 'hi' }] }).select('seq'), 'message');
      const nulled = await db.from('admin_agent_messages').update({ content: null }).eq('conversation_id', id);
      expect(nulled.error?.message).toBe('ADMIN_AGENT_IMMUTABLE');
      const del = await db.from('admin_agent_messages').delete().eq('conversation_id', id);
      expect(del.error).not.toBeNull();
      expect(await count('admin_agent_messages', 'conversation_id', id)).toBe(1);
      const delConv = await db.from('admin_agent_conversations').delete().eq('id', id);
      expect(delConv.error).not.toBeNull();
      expect(await count('admin_agent_conversations', 'id', id)).toBe(1);
    });

    it('a counter never goes down, a proposal never returns to proposed, a ledger row never returns to executing', async () => {
      const adminId = await newPlayer('monotonic');
      const id = await newConversation(adminId, 'Monotonic Admin');
      await ok(db.from('admin_agent_conversations').update({ seq_head: 3 }).eq('id', id).select('id'), 'seq_head up');
      const down = await db.from('admin_agent_conversations').update({ seq_head: 2 }).eq('id', id);
      expect(down.error?.message).toBe('ADMIN_AGENT_COUNTER_DECREASE');

      const proposalId = randomUUID();
      await ok(
        db
          .from('admin_agent_proposals')
          .insert({
            id: proposalId,
            conversation_id: id,
            admin_id: adminId,
            admin_name: 'Monotonic Admin',
            kind: 'action',
            class: 'G',
            tool_registry_version: 'r1',
            steps: [{ key: 's1' }],
            proposal_hash: HASH('b'),
            preview: {},
            preview_hash: HASH('c'),
            token_hash: HASH('d'),
            expires_at: ahead(60_000),
            locale: 'en',
          })
          .select('id'),
        'proposal',
      );
      await ok(db.from('admin_agent_proposals').update({ status: 'executing', executing_started_at: new Date().toISOString() }).eq('id', proposalId).select('id'), 'claim');
      const back = await db.from('admin_agent_proposals').update({ status: 'proposed' }).eq('id', proposalId);
      expect(back.error?.message).toBe('ADMIN_AGENT_STATUS_REGRESS');
      const steps = await db.from('admin_agent_proposals').update({ steps: [{ key: 's2' }] }).eq('id', proposalId);
      expect(steps.error?.message).toBe('ADMIN_AGENT_IMMUTABLE');
      // One executing proposal per conversation.
      const second = await db.from('admin_agent_proposals').insert({
        conversation_id: id,
        admin_name: 'Monotonic Admin',
        kind: 'action',
        class: 'B',
        tool_registry_version: 'r1',
        steps: [{ key: 's1' }],
        proposal_hash: HASH('b'),
        preview: {},
        preview_hash: HASH('c'),
        token_hash: HASH('d'),
        expires_at: ahead(60_000),
        locale: 'en',
        status: 'executing',
      });
      expect(second.error?.code).toBe('23505');

      const actionId = await newAction(id, adminId, { proposal_id: proposalId, step_key: 's1' });
      await ok(db.from('admin_agent_actions').update({ status: 'ok', http_status: 201 }).eq('id', actionId).select('id'), 'action ok');
      const reopen = await db.from('admin_agent_actions').update({ status: 'executing' }).eq('id', actionId);
      expect(reopen.error?.message).toBe('ADMIN_AGENT_STATUS_REGRESS');
      const dispatchTwice = await db.from('admin_agent_actions').insert({
        conversation_id: id,
        admin_name: 'Monotonic Admin',
        tool_name: 'league_create',
        class: 'B',
        proposal_id: proposalId,
        step_key: 's1',
        args_hash: HASH('a'),
      });
      expect(dispatchTwice.error?.code).toBe('23505');
    });
  });

  describe('deleting an admin who used the assistant', () => {
    it('succeeds and keeps every row with admin_id NULL and admin_name', async () => {
      const adminId = await newPlayer('leaver');
      const convId = await newConversation(adminId, 'Leaver');
      const planId = randomUUID();
      await ok(
        db.from('admin_agent_plans').insert({ id: planId, conversation_id: convId, admin_id: adminId, admin_name: 'Leaver', mode: 'create', doc: {}, doc_hash: HASH('e') }).select('id'),
        'plan',
      );
      const proposalId = randomUUID();
      await ok(
        db
          .from('admin_agent_proposals')
          .insert({
            id: proposalId,
            conversation_id: convId,
            admin_id: adminId,
            admin_name: 'Leaver',
            kind: 'build',
            class: 'B',
            plan_id: planId,
            plan_revision: 1,
            tool_registry_version: 'r1',
            steps: [{ key: 's1' }],
            proposal_hash: HASH('b'),
            preview: {},
            preview_hash: HASH('c'),
            token_hash: HASH('d'),
            expires_at: ahead(60_000),
            locale: 'en',
          })
          .select('id'),
        'proposal',
      );
      await ok(
        db.from('admin_agent_proposals').update({ approved_by: adminId, approved_at: new Date().toISOString(), status: 'completed' }).eq('id', proposalId).select('id'),
        'approve',
      );
      const actionId = await newAction(convId, adminId);
      await ok(
        db.from('admin_agent_usage').insert({ admin_id: adminId, admin_name: 'Leaver', conversation_id: convId, purpose: 'turn', model: 'test-model', settled_at: new Date().toISOString() }).select('id'),
        'usage',
      );

      const del = await db.from('players').delete().eq('id', adminId);
      expect(del.error).toBeNull();
      expect(await count('players', 'id', adminId)).toBe(0);

      const conv = await ok(db.from('admin_agent_conversations').select('admin_id, admin_name').eq('id', convId).single(), 'conversation');
      expect(conv).toEqual({ admin_id: null, admin_name: 'Leaver' });
      const plan = await ok(db.from('admin_agent_plans').select('admin_id, admin_name').eq('id', planId).single(), 'plan');
      expect(plan).toEqual({ admin_id: null, admin_name: 'Leaver' });
      const proposal = await ok(db.from('admin_agent_proposals').select('admin_id, admin_name, approved_by').eq('id', proposalId).single(), 'proposal');
      expect(proposal).toEqual({ admin_id: null, admin_name: 'Leaver', approved_by: null });
      const action = await ok(db.from('admin_agent_actions').select('admin_id, admin_name').eq('id', actionId).single(), 'action');
      expect(action).toEqual({ admin_id: null, admin_name: 'Test Admin' });
      const usage = await ok(db.from('admin_agent_usage').select('admin_id, admin_name').eq('conversation_id', convId).single(), 'usage');
      expect(usage).toEqual({ admin_id: null, admin_name: 'Leaver' });
    });
  });

  describe('the turn lease', () => {
    const acquire = (conversationId: string, adminId: string, seconds = 60) =>
      db.rpc('admin_agent_acquire_turn_lease', { p_conversation_id: conversationId, p_admin_id: adminId, p_lease_seconds: seconds });

    it('of eight concurrent turns on one conversation exactly one runs', async () => {
      const adminId = await newPlayer('lease');
      const id = await newConversation(adminId, 'Lease Admin');
      const results = await Promise.all(Array.from({ length: 8 }, () => acquire(id, adminId)));
      const rows = results.map((r) => ((r.data as Lease[] | null) ?? [])[0]);
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(rows.filter((r) => r.out_lease_until !== null)).toHaveLength(1);
      expect(rows.filter((r) => r.out_busy === 'conversation_busy')).toHaveLength(7);
    });

    it('hands the lease token back through a JSON round trip, releases only the holder, and then lets the next turn in', async () => {
      const adminId = await newPlayer('release');
      const id = await newConversation(adminId, 'Release Admin');
      const first = ((await acquire(id, adminId)).data as Lease[])[0];
      const token = first.out_lease_until as string;
      const wrong = await db.rpc('admin_agent_release_turn_lease', { p_conversation_id: id, p_lease_until: ago(0) });
      expect(wrong.data).toBe(false);
      const right = await db.rpc('admin_agent_release_turn_lease', { p_conversation_id: id, p_lease_until: new Date(token).toISOString() });
      expect(right.data).toBe(true);
      const again = ((await acquire(id, adminId)).data as Lease[])[0];
      expect(again.out_lease_until).not.toBeNull();
    });

    it('allows one turn in flight per admin across conversations, and shows a conversation only to its admin', async () => {
      const adminId = await newPlayer('lease-a');
      const otherId = await newPlayer('lease-b');
      const c1 = await newConversation(adminId, 'Lease A');
      const c2 = await newConversation(adminId, 'Lease A');
      const results = await Promise.all([acquire(c1, adminId), acquire(c2, adminId), acquire(c1, adminId), acquire(c2, adminId)]);
      const rows = results.map((r) => ((r.data as Lease[]) ?? [])[0]);
      expect(rows.filter((r) => r.out_lease_until !== null)).toHaveLength(1);
      expect(rows.filter((r) => r.out_busy !== null).every((r) => r.out_busy === 'admin_busy' || r.out_busy === 'conversation_busy')).toBe(true);
      const foreign = ((await acquire(c1, otherId)).data as Lease[])[0];
      expect(foreign).toEqual({ out_lease_until: null, out_busy: 'not_found' });
    });
  });

  describe('the blast-radius counters', () => {
    const claim = (conversationId: string, claims: { counter: string; amount: number; cap: number }[]) =>
      db.rpc('admin_agent_claim_budget', { p_conversation_id: conversationId, p_claims: claims });

    it('of eight concurrent claims against a cap of three exactly three pass', async () => {
      const adminId = await newPlayer('claims');
      const id = await newConversation(adminId, 'Claims Admin');
      const results = await Promise.all(Array.from({ length: 8 }, () => claim(id, [{ counter: 'league_creates', amount: 1, cap: 3 }])));
      const rows = results.map((r) => ((r.data as Claim[]) ?? [])[0]);
      expect(results.every((r) => r.error === null)).toBe(true);
      expect(rows.filter((r) => r.out_ok)).toHaveLength(3);
      expect(rows.filter((r) => !r.out_ok).every((r) => r.out_counter === 'league_creates' && r.out_value === 3 && r.out_cap === 3)).toBe(true);
      const row = await ok(db.from('admin_agent_conversations').select('blast_league_creates').eq('id', id).single(), 'counter');
      expect(row.blast_league_creates).toBe(3);
    });

    it('is all or nothing across counters, and refuses an unknown counter', async () => {
      const adminId = await newPlayer('claims-2');
      const id = await newConversation(adminId, 'Claims Admin 2');
      expect(((await claim(id, [{ counter: 'tournament_creates', amount: 3, cap: 3 }])).data as Claim[])[0].out_ok).toBe(true);
      const mixed = ((await claim(id, [
        { counter: 'pin_targets', amount: 2, cap: 50 },
        { counter: 'tournament_creates', amount: 1, cap: 3 },
      ])).data as Claim[])[0];
      expect(mixed).toEqual({ out_ok: false, out_counter: 'tournament_creates', out_value: 3, out_cap: 3 });
      const row = await ok(db.from('admin_agent_conversations').select('blast_pin_targets, blast_tournament_creates').eq('id', id).single(), 'counters');
      expect(row).toEqual({ blast_pin_targets: 0, blast_tournament_creates: 3 });
      const bogus = await claim(id, [{ counter: 'bogus', amount: 1, cap: 3 }]);
      expect(bogus.error?.message).toBe('ADMIN_AGENT_BAD_CLAIMS');
      const missing = await claim(randomUUID(), [{ counter: 'league_creates', amount: 1, cap: 3 }]);
      expect(missing.error?.message).toBe('ADMIN_AGENT_CONVERSATION_NOT_FOUND');
    });
  });

  describe('the usage reservation', () => {
    const reserve = (adminId: string, conversationId: string, estimate: number, caps: { conversation?: number; day?: number } = {}) =>
      db.rpc('admin_agent_reserve_usage', {
        p_admin_id: adminId,
        p_admin_name: 'Usage Admin',
        p_conversation_id: conversationId,
        p_purpose: 'turn',
        p_model: 'test-model',
        p_estimate_usd_micro: estimate,
        p_cap_conversation: caps.conversation ?? 5_000_000,
        p_cap_admin_day: caps.day ?? 20_000_000,
        p_cap_admin_month: 120_000_000,
        p_cap_global_day: 80_000_000_000,
        p_day_since: ago(1),
        p_month_since: ago(30),
      });
    const settle = (usageId: string, cost: number) =>
      db.rpc('admin_agent_settle_usage', {
        p_usage_id: usageId,
        p_input_tokens: 10,
        p_cache_write_5m_tokens: 0,
        p_cache_write_1h_tokens: 0,
        p_cache_read_tokens: 5,
        p_output_tokens: 20,
        p_cost_usd_micro: cost,
        p_stop_reason: 'end_turn',
      });

    it('never passes the conversation cap, however many calls race for it, and counts a settled row at its cost', async () => {
      const adminId = await newPlayer('usage');
      const id = await newConversation(adminId, 'Usage Admin');
      const results = await Promise.all(Array.from({ length: 6 }, () => reserve(adminId, id, 2_000_000)));
      const rows = results.map((r) => ((r.data as Reservation[]) ?? [])[0]);
      expect(results.every((r) => r.error === null)).toBe(true);
      const reserved = rows.filter((r) => r.out_usage_id !== null);
      expect(reserved).toHaveLength(2);
      expect(rows.filter((r) => r.out_usage_id === null).every((r) => r.out_exceeded === 'conversation' && r.out_cap === 5_000_000)).toBe(true);

      // Settle one at a small cost and one at zero: the freed room is usable at once.
      expect((await settle(reserved[0].out_usage_id as string, 500_000)).error).toBeNull();
      expect((await settle(reserved[1].out_usage_id as string, 0)).error).toBeNull();
      const twice = await settle(reserved[0].out_usage_id as string, 1);
      expect(twice.error?.message).toBe('ADMIN_AGENT_USAGE_NOT_FOUND');
      const frozen = await db.from('admin_agent_usage').update({ cost_usd_micro: 0 }).eq('id', reserved[0].out_usage_id as string);
      expect(frozen.error?.message).toBe('ADMIN_AGENT_USAGE_SETTLED');

      const next = ((await reserve(adminId, id, 4_000_000)).data as Reservation[])[0];
      expect(next.out_usage_id).not.toBeNull();
      expect((await settle(next.out_usage_id as string, 0)).error).toBeNull();
      const over = ((await reserve(adminId, id, 4_600_000)).data as Reservation[])[0];
      expect(over).toEqual({ out_usage_id: null, out_exceeded: 'conversation', out_used: 500_000, out_cap: 5_000_000 });
    });

    it('requires every cap (a missing cap would silently disable it)', async () => {
      const adminId = await newPlayer('usage-caps');
      const res = await db.rpc('admin_agent_reserve_usage', {
        p_admin_id: adminId,
        p_admin_name: 'Usage Admin',
        p_conversation_id: null,
        p_purpose: 'title',
        p_model: 'test-model',
        p_estimate_usd_micro: 1,
        p_cap_conversation: null,
        p_cap_admin_day: 1,
        p_cap_admin_month: 1,
        p_cap_global_day: 1,
        p_day_since: ago(1),
        p_month_since: ago(30),
      });
      expect(res.error?.message).toBe('ADMIN_AGENT_CAP_REQUIRED');
    });
  });

  describe('the retention purge', () => {
    it('nulls old message content and approver data, drops expired snapshots and refs, and then drops a two-year-old conversation with its tree', async () => {
      const adminId = await newPlayer('purge');
      const id = await newConversation(adminId, 'Purge Admin', ago(200));
      await ok(
        db.from('admin_agent_messages').insert({ conversation_id: id, seq: 1, role: 'user', kind: 'chat', content: [{ type: 'text', text: 'secret' }], ui: { t: 1 } }).select('seq'),
        'message',
      );
      const planId = randomUUID();
      await ok(db.from('admin_agent_plans').insert({ id: planId, conversation_id: id, admin_id: adminId, admin_name: 'Purge Admin', mode: 'create', doc: {}, doc_hash: HASH('e') }).select('id'), 'plan');
      const proposalId = randomUUID();
      await ok(
        db
          .from('admin_agent_proposals')
          .insert({
            id: proposalId,
            conversation_id: id,
            admin_id: adminId,
            admin_name: 'Purge Admin',
            kind: 'action',
            class: 'G',
            tool_registry_version: 'r1',
            steps: [{ key: 's1' }],
            proposal_hash: HASH('b'),
            preview: {},
            preview_hash: HASH('c'),
            token_hash: HASH('d'),
            expires_at: ago(100),
            locale: 'en',
          })
          .select('id'),
        'proposal',
      );
      await ok(
        db
          .from('admin_agent_proposals')
          .update({ approved_by: adminId, approved_at: ago(100), approved_ip_hash: 'iphash', approved_user_agent: 'ua', status: 'completed' })
          .eq('id', proposalId)
          .select('id'),
        'approve',
      );
      const actionId = await newAction(id, adminId, { proposal_id: proposalId, step_key: 's1' });
      await ok(db.from('admin_agent_snapshots').insert({ action_id: actionId, document: { a: 1 }, doc_hash: HASH('f'), expires_at: ago(1) }).select('id'), 'snapshot');
      await ok(db.from('admin_agent_refs').insert({ conversation_id: id, ref_kind: 'season', ref_id: randomUUID(), source: 'user_message' }).select('ref_id'), 'ref');

      const first = await db.rpc('admin_agent_retention_purge', {});
      expect(first.error).toBeNull();
      expect((first.data as { messages_nulled: number }).messages_nulled).toBeGreaterThanOrEqual(1);

      const msg = await ok(db.from('admin_agent_messages').select('content, ui, content_purged_at').eq('conversation_id', id).single(), 'message');
      expect(msg.content).toBeNull();
      expect(msg.ui).toBeNull();
      expect(msg.content_purged_at).not.toBeNull();
      const proposal = await ok(db.from('admin_agent_proposals').select('approved_ip_hash, approved_user_agent, approved_by').eq('id', proposalId).single(), 'proposal');
      expect(proposal).toEqual({ approved_ip_hash: null, approved_user_agent: null, approved_by: adminId });
      expect(await count('admin_agent_snapshots', 'action_id', actionId)).toBe(0);
      expect(await count('admin_agent_refs', 'conversation_id', id)).toBe(0);
      expect(await count('admin_agent_actions', 'id', actionId)).toBe(1);

      // Two years after the last message the whole tree goes (the cascade passes the append-only triggers).
      await ok(db.from('admin_agent_conversations').update({ last_message_at: ago(800) }).eq('id', id).select('id'), 'age');
      const second = await db.rpc('admin_agent_retention_purge', {});
      expect(second.error).toBeNull();
      expect((second.data as { conversations_deleted: number }).conversations_deleted).toBeGreaterThanOrEqual(1);
      for (const [table, column] of [
        ['admin_agent_conversations', 'id'],
        ['admin_agent_messages', 'conversation_id'],
        ['admin_agent_plans', 'conversation_id'],
        ['admin_agent_proposals', 'conversation_id'],
        ['admin_agent_actions', 'conversation_id'],
      ] as const) {
        expect(await count(table, column, id), table).toBe(0);
      }
    });

    it('refuses arguments that could wipe the tables', async () => {
      const tooShort = await db.rpc('admin_agent_retention_purge', { p_audit_days: 1 });
      expect(tooShort.error?.message).toBe('ADMIN_AGENT_BAD_ARGUMENT');
      const noLimit = await db.rpc('admin_agent_retention_purge', { p_limit: 0 });
      expect(noLimit.error?.message).toBe('ADMIN_AGENT_BAD_ARGUMENT');
    });

    it('refuses a clock that runs ahead when called through the API, accepts the present and the past', async () => {
      const future = await db.rpc('admin_agent_retention_purge', { p_now: '2100-01-01T00:00:00Z' });
      expect(future.error?.message).toBe('ADMIN_AGENT_BAD_ARGUMENT');
      const soon = await db.rpc('admin_agent_retention_purge', { p_now: new Date(Date.now() + 10 * 60_000).toISOString() });
      expect(soon.error?.message).toBe('ADMIN_AGENT_BAD_ARGUMENT');
      const past = await db.rpc('admin_agent_retention_purge', { p_now: new Date(Date.now() - 86_400_000).toISOString() });
      expect(past.error).toBeNull();
    });
  });

  describe('a league moved to the recycle bin while ledger rows name it', () => {
    it('is deleted and restored without touching the ledger, whose entity_id keeps pointing at the same ids', async () => {
      const league = await seedLeague(db, { players: 4, phases: 1, rounds: 1, name: 'AAT trash' });
      leagues.push(league);
      const convId = await newConversation(league.adminId, 'League Admin');
      const leagueAction = await newAction(convId, league.adminId, { entity_type: 'season', entity_id: league.seasonId, status: 'ok' });
      const phaseAction = await newAction(convId, league.adminId, { tool_name: 'phase_create', entity_type: 'tournament', entity_id: league.phaseIds[0], status: 'ok' });
      const ledger = async () =>
        ok(db.from('admin_agent_actions').select('id, entity_type, entity_id, status').eq('conversation_id', convId).order('entity_type'), 'ledger');
      const before = await ledger();
      expect(before).toHaveLength(2);

      const trash = await q.moveLeagueToTrash(league.seasonId, league.adminId);
      expect(await count('seasons', 'id', league.seasonId)).toBe(0);
      expect(await ledger()).toEqual(before);
      expect(await count('admin_agent_conversations', 'id', convId)).toBe(1);

      await q.markLeagueTrashRebuildDone(trash.trash_id);
      const restored = await q.restoreLeagueFromTrash(trash.trash_id);
      expect(restored.season_id).toBe(league.seasonId);
      expect(await count('seasons', 'id', league.seasonId)).toBe(1);
      expect(await ledger()).toEqual(before);
      const ids = (await ledger()).map((r) => r.id).sort();
      expect(ids).toEqual([leagueAction, phaseAction].sort());
      await q.markLeagueRestoreRebuildDone(league.seasonId);
    }, SLOW);
  });
});
