/**
 * The action ledger (plan 4.5, "no ledger, no write"): every real write and every private draft write has a row, and
 * the row is inserted BEFORE the dispatch. The unique keys `(conversation_id, tool_use_id)` and
 * `(proposal_id, step_key)` give at-most-once dispatch: `insertAction` reports `inserted: false` when the key already
 * exists, and the caller must not dispatch. The insert is awaited and a failure stops the step (the caller maps it to
 * `ledger_unavailable`); the row is then completed with the outcome. The triggers freeze `args`, `args_hash`, the step
 * key, the tool and the class at insert, and a row never returns to `executing`.
 */
import { isValidUuid } from '@/lib/utils/uuid';
import { ACTION_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreError, isUniqueViolation, mapStoreDbError, unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';
import { assertPayloadAllowed } from './payload-guard';
import type { ActionOutcome, ActionRecord, InsertedAction, NewAction } from './types';

export const ACTION_LIST_MAX = 500;

export function actionRepository(ctx: StoreContext) {
  return {
    /**
     * Inserts the ledger row in status `executing`. `inserted: false` means the dispatch key (tool_use_id or
     * proposal step) was already taken: that call was dispatched before, so this one must not be.
     */
    async insertAction(adminId: AdminId, input: NewAction): Promise<InsertedAction> {
      assertAdminId(adminId);
      if ((input.proposalId == null) !== (input.stepKey == null)) {
        throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'proposal_and_step_key_go_together' });
      }
      const conversation = await ownedConversation(ctx, adminId, input.conversationId);
      assertPayloadAllowed('action.args', input.args);
      if (input.proposalId) {
        const proposal = isValidUuid(input.proposalId)
          ? unwrap(
              'actions.proposalOwned',
              await ctx.db
                .from('admin_agent_proposals')
                .select('id')
                .eq('id', input.proposalId)
                .eq('admin_id', adminId)
                .eq('conversation_id', conversation.id)
                .maybeSingle(),
            )
          : null;
        if (!proposal) throw new AdminAgentStoreError('proposal_not_found');
      }
      const { data, error } = await ctx.db
        .from('admin_agent_actions')
        .insert({
          conversation_id: conversation.id,
          admin_id: adminId,
          admin_name: conversation.admin_name,
          tool_use_id: input.toolUseId ?? null,
          tool_name: input.toolName,
          class: input.class,
          proposal_id: input.proposalId ?? null,
          step_key: input.stepKey ?? null,
          method: input.method ?? null,
          path: input.path ?? null,
          args: input.args,
          args_hash: input.argsHash,
        })
        .select(ACTION_COLUMNS)
        .single();
      if (!error) return { inserted: true, action: data };
      if (isUniqueViolation(error, 'admin_agent_actions_tool_use_key') || isUniqueViolation(error, 'admin_agent_actions_step_key')) {
        return { inserted: false };
      }
      throw mapStoreDbError('actions.insert', error);
    },

    /** Records the outcome of a dispatched call (status, HTTP status, the allow-listed result, before/after, the undo recipe, the read-back). */
    async completeAction(adminId: AdminId, actionId: string, outcome: ActionOutcome): Promise<ActionRecord> {
      assertAdminId(adminId);
      if (!isValidUuid(actionId)) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'action_not_found' });
      for (const [label, value] of [
        ['action.result', outcome.result],
        ['action.before', outcome.before],
        ['action.after', outcome.after],
        ['action.undo', outcome.undo],
        ['action.verify', outcome.verify],
      ] as const) {
        if (value) assertPayloadAllowed(label, value);
      }
      const patch = {
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        ...(outcome.httpStatus !== undefined ? { http_status: outcome.httpStatus } : {}),
        ...(outcome.outcomeKind !== undefined ? { outcome_kind: outcome.outcomeKind } : {}),
        ...(outcome.errorCode !== undefined ? { error_code: outcome.errorCode } : {}),
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        ...(outcome.before !== undefined ? { before: outcome.before } : {}),
        ...(outcome.after !== undefined ? { after: outcome.after } : {}),
        ...(outcome.afterFingerprint !== undefined ? { after_fingerprint: outcome.afterFingerprint } : {}),
        ...(outcome.undo !== undefined ? { undo: outcome.undo } : {}),
        ...(outcome.reversibility !== undefined ? { reversibility: outcome.reversibility } : {}),
        ...(outcome.verify !== undefined ? { verify: outcome.verify } : {}),
        ...(outcome.entityType !== undefined ? { entity_type: outcome.entityType } : {}),
        ...(outcome.entityId !== undefined ? { entity_id: outcome.entityId } : {}),
      };
      const row = unwrap(
        'actions.complete',
        await ctx.db.from('admin_agent_actions').update(patch).eq('id', actionId).eq('admin_id', adminId).select(ACTION_COLUMNS).maybeSingle(),
      );
      if (!row) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'action_not_found' });
      return row;
    },

    /** The ledger row of a model tool call (D tools), or `null`. */
    async getActionByToolUse(adminId: AdminId, conversationId: string, toolUseId: string): Promise<ActionRecord | null> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      return unwrap(
        'actions.getByToolUse',
        await ctx.db.from('admin_agent_actions').select(ACTION_COLUMNS).eq('conversation_id', conversationId).eq('tool_use_id', toolUseId).maybeSingle(),
      );
    },

    /** One ledger row of this admin, or `null`. */
    async getAction(adminId: AdminId, actionId: string): Promise<ActionRecord | null> {
      assertAdminId(adminId);
      if (!isValidUuid(actionId)) return null;
      return unwrap('actions.get', await ctx.db.from('admin_agent_actions').select(ACTION_COLUMNS).eq('id', actionId).eq('admin_id', adminId).maybeSingle());
    },

    /** A conversation's ledger in time order (up to 500 rows). */
    async listActions(adminId: AdminId, conversationId: string, limit = 200): Promise<ActionRecord[]> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const count = Math.min(Math.max(Math.trunc(limit), 1), ACTION_LIST_MAX);
      return (
        unwrap(
          'actions.list',
          await ctx.db
            .from('admin_agent_actions')
            .select(ACTION_COLUMNS)
            .eq('conversation_id', conversationId)
            .eq('admin_id', adminId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(count),
        ) ?? []
      );
    },

    /** The ledger rows of one proposal, in step order of insertion. */
    async listProposalActions(adminId: AdminId, proposalId: string): Promise<ActionRecord[]> {
      assertAdminId(adminId);
      if (!isValidUuid(proposalId)) return [];
      return (
        unwrap(
          'actions.listProposal',
          await ctx.db
            .from('admin_agent_actions')
            .select(ACTION_COLUMNS)
            .eq('proposal_id', proposalId)
            .eq('admin_id', adminId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(ACTION_LIST_MAX),
        ) ?? []
      );
    },
  };
}

export type ActionRepository = ReturnType<typeof actionRepository>;
