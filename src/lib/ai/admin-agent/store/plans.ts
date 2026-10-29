/**
 * The Plan document (plan 4.3) and its append-only revision history.
 *
 * A revision write is a compare-and-set on `revision`: the plan row advances only if it is still at the revision the
 * writer read (a lost race is 409 `plan_stale`, the caller re-reads and re-applies). The statements around it are not one
 * transaction (PostgREST), so the order is chosen so that no failure looks like a failed write once the plan has moved:
 *
 *  1. the pending Build proposals for an OLDER revision are superseded FIRST. Any writer that wins the compare-and-set
 *     supersedes them, so doing it before is harmless when this write then loses the race (a card for the newer revision
 *     is not touched), and a failure afterwards can never leave a Build card pending for an old revision (the approve
 *     path also compares `plan_revision`);
 *  2. the compare-and-set advances the plan: from here the write has happened;
 *  3. the history row is appended, retried once, and a failure is logged and swallowed: `plan_revisions` is evidence, not
 *     the source of truth (a missing row only makes `plan_revert` to that revision answer a clean refusal).
 *
 * A SQL function would make all three one transaction (open item for the schema owner).
 */
import { isValidUuid } from '@/lib/utils/uuid';
import { PLAN_COLUMNS, PLAN_REVISION_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreError, unwrap, unwrapRow } from './errors';
import { assertAdminId, type AdminId } from './ids';
import { assertPayloadAllowed } from './payload-guard';
import type { NewPlan, PlanRecord, PlanRevisionRecord, PlanRevisionWrite, PlanRevisionWritten, PlanStatus } from './types';

export const REVISION_LIST_MAX = 100;

/** Runs a write that must not fail the caller: once more on an error, then logged and given up. */
async function afterAdvance(label: string, write: () => Promise<void>): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await write();
      return true;
    } catch (error) {
      if (attempt === 2) console.error(`[admin-agent] store: ${label} failed after the plan advanced`, error);
    }
  }
  return false;
}

export function planRepository(ctx: StoreContext) {
  async function getPlan(adminId: AdminId, planId: string): Promise<PlanRecord | null> {
    assertAdminId(adminId);
    if (!isValidUuid(planId)) return null;
    return unwrap('plans.get', await ctx.db.from('admin_agent_plans').select(PLAN_COLUMNS).eq('id', planId).eq('admin_id', adminId).maybeSingle());
  }

  return {
    getPlan,

    /** Creates the plan at revision 1 (with its history row) and makes it the conversation's active plan. */
    async createPlan(adminId: AdminId, input: NewPlan): Promise<PlanRecord> {
      assertAdminId(adminId);
      const conversation = await ownedConversation(ctx, adminId, input.conversationId);
      assertPayloadAllowed('plan.doc', input.doc);
      const plan = unwrapRow(
        'plans.create',
        await ctx.db
          .from('admin_agent_plans')
          .insert({
            conversation_id: conversation.id,
            admin_id: adminId,
            admin_name: conversation.admin_name,
            mode: input.mode,
            doc: input.doc,
            doc_hash: input.docHash,
          })
          .select(PLAN_COLUMNS)
          .single(),
      );
      // The plan is the conversation's active plan only once this succeeds; a failure leaves an unused row and a retry starts clean.
      const active = await afterAdvance('plans.setActive', async () => {
        unwrap('plans.setActive', await ctx.db.from('admin_agent_conversations').update({ active_plan_id: plan.id }).eq('id', conversation.id).eq('admin_id', adminId));
      });
      if (!active) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'plan_not_activated' });
      await afterAdvance('plans.createRevision', async () => {
        unwrap('plans.createRevision', await ctx.db.from('admin_agent_plan_revisions').insert({ plan_id: plan.id, revision: 1, doc: input.doc, patch: null, author: input.author ?? 'agent' }));
      });
      return plan;
    },

    /** The conversation's active plan, or `null` when it has none. */
    async getActivePlan(adminId: AdminId, conversationId: string): Promise<PlanRecord | null> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const row = unwrap(
        'plans.activeId',
        await ctx.db.from('admin_agent_conversations').select('active_plan_id').eq('id', conversationId).eq('admin_id', adminId).maybeSingle(),
      );
      return row?.active_plan_id ? getPlan(adminId, row.active_plan_id) : null;
    },

    /**
     * Writes revision `expectedRevision + 1`: the pending Build proposals of the plan become `superseded` (plan 4.3: any
     * revision invalidates them; approve checks the revision again anyway), the plan advances only from `expectedRevision`
     * (otherwise `plan_stale`), and the history gets its row. See the header for why this order and what a failure leaves.
     */
    async writePlanRevision(adminId: AdminId, planId: string, write: PlanRevisionWrite): Promise<PlanRevisionWritten> {
      assertAdminId(adminId);
      if (!isValidUuid(planId)) throw new AdminAgentStoreError('conversation_not_found', undefined, { reason: 'plan_not_found' });
      assertPayloadAllowed('plan.doc', write.doc);
      if (write.patch) assertPayloadAllowed('plan.patch', write.patch);
      const next = write.expectedRevision + 1;

      const superseded = unwrap(
        'plans.supersedeBuilds',
        await ctx.db
          .from('admin_agent_proposals')
          .update({ status: 'superseded' })
          .eq('plan_id', planId)
          .eq('admin_id', adminId)
          .eq('kind', 'build')
          .eq('status', 'proposed')
          // Only cards for an older revision: a Build staged against a newer one (a concurrent writer won) is not ours to kill.
          .lt('plan_revision', next)
          .select('id'),
      );

      const plan = unwrap(
        'plans.writeRevision',
        await ctx.db
          .from('admin_agent_plans')
          .update({ doc: write.doc, doc_hash: write.docHash, revision: next, ...(write.status ? { status: write.status } : {}) })
          .eq('id', planId)
          .eq('admin_id', adminId)
          .eq('revision', write.expectedRevision)
          .select(PLAN_COLUMNS)
          .maybeSingle(),
      );
      if (!plan) {
        const current = await getPlan(adminId, planId);
        if (!current) throw new AdminAgentStoreError('conversation_not_found', undefined, { reason: 'plan_not_found' });
        throw new AdminAgentStoreError('plan_stale', undefined, { detail: { expectedRevision: write.expectedRevision, currentRevision: current.revision } });
      }

      await afterAdvance('plans.appendRevision', async () => {
        unwrap(
          'plans.appendRevision',
          await ctx.db
            .from('admin_agent_plan_revisions')
            .insert({ plan_id: planId, revision: next, doc: write.doc, patch: write.patch ?? null, author: write.author }),
        );
      });
      return { plan, supersededProposals: superseded?.length ?? 0 };
    },

    /** Moves the plan through its lifecycle (`ready`, `building`, `partial`, `built`, `abandoned`). */
    async setPlanStatus(
      adminId: AdminId,
      planId: string,
      status: PlanStatus,
      stamps: { buildStartedAt?: Date | null; buildFinishedAt?: Date | null } = {},
    ): Promise<PlanRecord> {
      assertAdminId(adminId);
      if (!isValidUuid(planId)) throw new AdminAgentStoreError('conversation_not_found', undefined, { reason: 'plan_not_found' });
      const plan = unwrap(
        'plans.setStatus',
        await ctx.db
          .from('admin_agent_plans')
          .update({
            status,
            ...(stamps.buildStartedAt !== undefined ? { build_started_at: stamps.buildStartedAt?.toISOString() ?? null } : {}),
            ...(stamps.buildFinishedAt !== undefined ? { build_finished_at: stamps.buildFinishedAt?.toISOString() ?? null } : {}),
          })
          .eq('id', planId)
          .eq('admin_id', adminId)
          .select(PLAN_COLUMNS)
          .maybeSingle(),
      );
      if (!plan) throw new AdminAgentStoreError('conversation_not_found', undefined, { reason: 'plan_not_found' });
      return plan;
    },

    /** The plan's history, newest first. */
    async listRevisions(adminId: AdminId, planId: string, limit = 50): Promise<PlanRevisionRecord[]> {
      assertAdminId(adminId);
      if (!(await getPlan(adminId, planId))) throw new AdminAgentStoreError('conversation_not_found', undefined, { reason: 'plan_not_found' });
      const count = Math.min(Math.max(Math.trunc(limit), 1), REVISION_LIST_MAX);
      const rows = unwrap(
        'plans.listRevisions',
        await ctx.db.from('admin_agent_plan_revisions').select(PLAN_REVISION_COLUMNS).eq('plan_id', planId).order('revision', { ascending: false }).limit(count),
      );
      return rows ?? [];
    },

    /** One historical revision of the plan, or `null`. */
    async getRevision(adminId: AdminId, planId: string, revision: number): Promise<PlanRevisionRecord | null> {
      assertAdminId(adminId);
      if (!(await getPlan(adminId, planId))) return null;
      return unwrap(
        'plans.getRevision',
        await ctx.db.from('admin_agent_plan_revisions').select(PLAN_REVISION_COLUMNS).eq('plan_id', planId).eq('revision', revision).maybeSingle(),
      );
    },
  };
}

export type PlanRepository = ReturnType<typeof planRepository>;
