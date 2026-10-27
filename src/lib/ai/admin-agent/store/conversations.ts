/**
 * Conversations, the turn lease (plan 3.4) and the blast-radius counters (plan 6.4).
 *
 * The lease is `admin_agent_acquire_turn_lease` / a scoped release: one turn per conversation, and one per admin across
 * conversations, taken at request start and released in `finally`; it also expires on its own (320 s, `maxDuration`
 * plus margin). The loop is NOT tied to the request's abort signal (spike S7): the lease, not the connection, is what
 * keeps a second turn out, so `withTurnLease` releases when the work finishes, however long the client stayed.
 */
import { isValidUuid } from '@/lib/utils/uuid';
import { CONVERSATION_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreDbError, AdminAgentStoreError, mapStoreDbError, unwrap, unwrapRow } from './errors';
import { assertAdminId, type AdminId } from './ids';
import type { BlastClaim, ClaimBudgetResult, ConversationRecord, ConversationStatus, NewConversation, TurnLeaseResult } from './types';

/** Lease length in seconds: the chat route's `maxDuration` (300) plus margin. */
export const TURN_LEASE_SECONDS = 320;

export const CONVERSATION_LIST_MAX = 100;

export interface ListConversationsOptions {
  status?: ConversationStatus;
  /** 1 to 100, default 50. */
  limit?: number;
  offset?: number;
}

export interface ConversationPage {
  items: ConversationRecord[];
  total: number;
}

export interface TurnLease {
  /** The expiry the database granted (millisecond precision); hand it back to release. */
  leaseUntil: string;
}

/** Busy and not-found reasons as the catalogued error (409 `agent_conversation_busy` / `agent_admin_busy`, 404). */
export function turnLeaseError(reason: 'conversation_busy' | 'admin_busy' | 'not_found'): AdminAgentStoreError {
  if (reason === 'conversation_busy') return new AdminAgentStoreError('agent_conversation_busy');
  if (reason === 'admin_busy') return new AdminAgentStoreError('agent_admin_busy');
  return new AdminAgentStoreError('conversation_not_found');
}

function firstRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export function conversationRepository(ctx: StoreContext) {
  const api = {
    /** Creates a conversation with the model, effort and versions it will keep for its whole life. */
    async createConversation(adminId: AdminId, input: NewConversation): Promise<ConversationRecord> {
      assertAdminId(adminId);
      const row = unwrapRow(
        'conversations.create',
        await ctx.db
          .from('admin_agent_conversations')
          .insert({
            admin_id: adminId,
            admin_name: input.adminName,
            ui_locale: input.uiLocale,
            context: input.context ?? {},
            model: input.model,
            effort: input.effort,
            tool_set: input.toolSet,
            tool_registry_version: input.toolRegistryVersion,
            system_prompt_version: input.systemPromptVersion,
          })
          .select(CONVERSATION_COLUMNS)
          .single(),
      );
      return row;
    },

    /** The conversation when it is this admin's, else `null` (another admin's row is "not found" too). */
    async getConversation(adminId: AdminId, conversationId: string): Promise<ConversationRecord | null> {
      assertAdminId(adminId);
      if (!isValidUuid(conversationId)) return null;
      return unwrap(
        'conversations.get',
        await ctx.db.from('admin_agent_conversations').select(CONVERSATION_COLUMNS).eq('id', conversationId).eq('admin_id', adminId).maybeSingle(),
      );
    },

    /** This admin's conversations, newest activity first. */
    async listConversations(adminId: AdminId, options: ListConversationsOptions = {}): Promise<ConversationPage> {
      assertAdminId(adminId);
      const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), CONVERSATION_LIST_MAX);
      const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
      let query = ctx.db
        .from('admin_agent_conversations')
        .select(CONVERSATION_COLUMNS, { count: 'exact' })
        .eq('admin_id', adminId)
        .order('last_message_at', { ascending: false })
        .order('id', { ascending: true });
      if (options.status) query = query.eq('status', options.status);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw mapStoreDbError('conversations.list', error);
      return { items: data ?? [], total: count ?? 0 };
    },

    /**
     * Title and status edits compare-and-set on `version`: the write applies only if the conversation is still at
     * `expectedVersion`, and bumps it. A version that moved on returns `null` (re-read and retry); a conversation
     * that is not this admin's throws `conversation_not_found`.
     */
    async updateConversation(
      adminId: AdminId,
      conversationId: string,
      patch: { title?: string | null; status?: ConversationStatus },
      expectedVersion: number,
    ): Promise<ConversationRecord | null> {
      assertAdminId(adminId);
      if (!isValidUuid(conversationId)) throw new AdminAgentStoreError('conversation_not_found');
      const row = unwrap(
        'conversations.update',
        await ctx.db
          .from('admin_agent_conversations')
          .update({
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            version: expectedVersion + 1,
          })
          .eq('id', conversationId)
          .eq('admin_id', adminId)
          .eq('version', expectedVersion)
          .select(CONVERSATION_COLUMNS)
          .maybeSingle(),
      );
      if (row) return row;
      await ownedConversation(ctx, adminId, conversationId);
      return null;
    },

    /**
     * Takes the turn lease. `ok: false` says why: `conversation_busy` (a turn is running here), `admin_busy` (another
     * conversation of this admin has one) or `not_found` (no such conversation, or not this admin's).
     */
    async acquireTurnLease(adminId: AdminId, conversationId: string, seconds: number = TURN_LEASE_SECONDS): Promise<TurnLeaseResult> {
      assertAdminId(adminId);
      if (!isValidUuid(conversationId)) return { ok: false, reason: 'not_found' };
      const { data, error } = await ctx.db.rpc('admin_agent_acquire_turn_lease', {
        p_conversation_id: conversationId,
        p_admin_id: adminId,
        p_lease_seconds: seconds,
      });
      if (error) throw mapStoreDbError('conversations.acquireTurnLease', error);
      const row = firstRow(data);
      if (row?.out_lease_until) return { ok: true, leaseUntil: row.out_lease_until };
      const reason = row?.out_busy;
      if (reason === 'conversation_busy' || reason === 'admin_busy' || reason === 'not_found') return { ok: false, reason };
      throw new AdminAgentStoreDbError('conversations.acquireTurnLease', new Error('lease function answered neither a lease nor a reason'));
    },

    /**
     * Releases the lease if it is still ours (a successor that took over after expiry keeps its own). Scoped to the
     * admin like every other call; returns whether a lease was cleared.
     */
    async releaseTurnLease(adminId: AdminId, conversationId: string, leaseUntil: string): Promise<boolean> {
      assertAdminId(adminId);
      if (!isValidUuid(conversationId) || Number.isNaN(Date.parse(leaseUntil))) return false;
      const rows = unwrap(
        'conversations.releaseTurnLease',
        await ctx.db
          .from('admin_agent_conversations')
          .update({ turn_lease_until: null })
          .eq('id', conversationId)
          .eq('admin_id', adminId)
          .eq('turn_lease_until', leaseUntil)
          .select('id'),
      );
      return (rows?.length ?? 0) > 0;
    },

    /**
     * Runs `work` under the turn lease and releases it in `finally`. A busy or missing conversation throws the
     * catalogued error before `work` starts. A failed release is logged and never replaces `work`'s result or error:
     * the lease expires on its own.
     */
    async withTurnLease<T>(adminId: AdminId, conversationId: string, work: (lease: TurnLease) => Promise<T>, seconds?: number): Promise<T> {
      const lease = await api.acquireTurnLease(adminId, conversationId, seconds);
      if (!lease.ok) throw turnLeaseError(lease.reason);
      try {
        return await work({ leaseUntil: lease.leaseUntil });
      } finally {
        await api.releaseTurnLease(adminId, conversationId, lease.leaseUntil).catch((error: unknown) => {
          console.error('[admin-agent] turn lease release failed; it expires on its own', error);
        });
      }
    },

    /**
     * Claims blast-radius counters for a proposal, all or nothing (`admin_agent_claim_budget`). The counters count
     * claims, not successes: there is no refund. `ok: false` names the first counter over its cap.
     */
    async claimBudget(adminId: AdminId, conversationId: string, claims: readonly BlastClaim[]): Promise<ClaimBudgetResult> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const { data, error } = await ctx.db.rpc('admin_agent_claim_budget', {
        p_conversation_id: conversationId,
        p_claims: claims.map((c) => ({ counter: c.counter, amount: c.amount, cap: c.cap })),
      });
      if (error) throw mapStoreDbError('conversations.claimBudget', error);
      const row = firstRow(data);
      if (row?.out_ok) return { ok: true };
      if (row && row.out_counter) return { ok: false, counter: row.out_counter, value: row.out_value, cap: row.out_cap };
      throw new AdminAgentStoreDbError('conversations.claimBudget', new Error('claim function answered neither success nor a counter'));
    },
  };
  return api;
}

export type ConversationRepository = ReturnType<typeof conversationRepository>;
