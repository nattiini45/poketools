/**
 * Draft-save snapshots (plan 4.6): the previous Format Studio or Ruleset Studio draft document before a D-tool save,
 * kept 30 days for the draft-save undo. One snapshot per ledger row (`action_id` is unique). The table has no admin
 * column, so every call proves the ledger row is this admin's first.
 */
import { isValidUuid } from '@/lib/utils/uuid';
import { SNAPSHOT_COLUMNS } from './columns';
import type { StoreContext } from './context';
import { AdminAgentStoreError, isUniqueViolation, mapStoreDbError, unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';
import { assertPayloadAllowed } from './payload-guard';
import type { Json, SnapshotRecord } from './types';

export function snapshotRepository(ctx: StoreContext) {
  async function ownsAction(adminId: AdminId, actionId: string): Promise<boolean> {
    if (!isValidUuid(actionId)) return false;
    const row = unwrap(
      'snapshots.actionOwned',
      await ctx.db.from('admin_agent_actions').select('id').eq('id', actionId).eq('admin_id', adminId).maybeSingle(),
    );
    return row !== null;
  }

  return {
    /** Stores the previous draft document for a ledger row. A second snapshot for the same row returns the first. */
    async insertSnapshot(adminId: AdminId, input: { actionId: string; document: Json; docHash: string }): Promise<SnapshotRecord> {
      assertAdminId(adminId);
      if (!(await ownsAction(adminId, input.actionId))) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'action_not_found' });
      assertPayloadAllowed('snapshot.document', input.document);
      const { data, error } = await ctx.db
        .from('admin_agent_snapshots')
        .insert({ action_id: input.actionId, document: input.document, doc_hash: input.docHash })
        .select(SNAPSHOT_COLUMNS)
        .single();
      if (!error) return data;
      if (isUniqueViolation(error)) {
        const existing = unwrap(
          'snapshots.existing',
          await ctx.db.from('admin_agent_snapshots').select(SNAPSHOT_COLUMNS).eq('action_id', input.actionId).maybeSingle(),
        );
        if (existing) return existing;
      }
      throw mapStoreDbError('snapshots.insert', error);
    },

    /** The snapshot of a ledger row while it has not expired (30 days), else `null`. */
    async getSnapshot(adminId: AdminId, actionId: string): Promise<SnapshotRecord | null> {
      assertAdminId(adminId);
      if (!(await ownsAction(adminId, actionId))) return null;
      return unwrap(
        'snapshots.get',
        await ctx.db
          .from('admin_agent_snapshots')
          .select(SNAPSHOT_COLUMNS)
          .eq('action_id', actionId)
          .gt('expires_at', ctx.now().toISOString())
          .maybeSingle(),
      );
    },
  };
}

export type SnapshotRepository = ReturnType<typeof snapshotRepository>;
