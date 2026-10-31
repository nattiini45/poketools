/**
 * Proposals: the staged, hash-bound confirmation records (plan 4.5).
 *
 * Staging inserts one immutable row (the triggers freeze everything but the status and the approval and execution
 * stamps). The approval token is never stored or read here: a proposal row holds its sha256, and `claimProposal`
 * compares it inside the claiming statement. Records never carry `token_hash`, `approved_ip_hash` or
 * `approved_user_agent`.
 *
 * `claimProposal` is the replay protection: one UPDATE that flips `proposed` to `executing` only for the proposing
 * admin, an unexpired proposal and the right token; zero rows re-read the row to answer with the precise catalogued
 * error. The partial unique index "one executing proposal per conversation" turns a second claim in the same
 * conversation into `proposal_conflict_executing`. Expiry uses the app clock for both the stamp and the comparison.
 */
import { timingSafeEqual } from 'node:crypto';
import { isValidUuid } from '@/lib/utils/uuid';
import { PROPOSAL_COLUMNS, PROPOSAL_SUMMARY_COLUMNS } from './columns';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreError, isUniqueViolation, unwrap, unwrapRow } from './errors';
import { assertAdminId, type AdminId } from './ids';
import { assertPayloadAllowed } from './payload-guard';
import type { NewProposal, ProposalClaim, ProposalFinalStatus, ProposalRecord, ProposalStatus, ProposalSummary } from './types';

const EXECUTING_INDEX = 'uq_admin_agent_proposals_executing';
const USER_AGENT_MAX = 512;
export const PROPOSAL_LIST_MAX = 100;

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function proposalRepository(ctx: StoreContext) {
  async function getProposal(adminId: AdminId, proposalId: string): Promise<ProposalRecord | null> {
    assertAdminId(adminId);
    if (!isValidUuid(proposalId)) return null;
    return unwrap(
      'proposals.get',
      await ctx.db.from('admin_agent_proposals').select(PROPOSAL_COLUMNS).eq('id', proposalId).eq('admin_id', adminId).maybeSingle(),
    );
  }

  /** Pending proposals of a conversation; with `supersedeKey`, only those that carry that key. */
  async function countPending(adminId: AdminId, conversationId: string, supersedeKey?: string): Promise<number> {
    assertAdminId(adminId);
    await ownedConversation(ctx, adminId, conversationId);
    let query = ctx.db
      .from('admin_agent_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('admin_id', adminId)
      .eq('status', 'proposed')
      .gt('expires_at', ctx.now().toISOString());
    if (supersedeKey !== undefined) query = query.eq('supersede_key', supersedeKey);
    const { count, error } = await query;
    unwrap('proposals.countPending', { data: null, error });
    return count ?? 0;
  }

  /** Why a claim matched no row: the precise catalogued error. */
  async function claimRefusal(adminId: AdminId, proposalId: string, tokenHash: string): Promise<AdminAgentStoreError> {
    const row = unwrap(
      'proposals.claimReread',
      await ctx.db
        .from('admin_agent_proposals')
        .select('status, expires_at, token_hash')
        .eq('id', proposalId)
        .eq('admin_id', adminId)
        .maybeSingle(),
    );
    if (!row) return new AdminAgentStoreError('proposal_not_found');
    if (row.status !== 'proposed') return new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: row.status } });
    if (!sameHash(row.token_hash, tokenHash)) return new AdminAgentStoreError('proposal_token_invalid');
    if (new Date(row.expires_at).getTime() <= ctx.now().getTime()) return new AdminAgentStoreError('proposal_expired');
    // Proposed, unexpired and the right token, yet no row: it changed between the two statements.
    return new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: 'changed' } });
  }

  return {
    getProposal,
    countPending,

    /**
     * Stages one proposal (status `proposed`). The token hash is the caller's; the store never sees the token. When
     * `supersedeKey` is set, older pending proposals with the same key become `superseded`. `maxPending` refuses with
     * `agent_cap_reached` when the conversation already holds that many pending proposals, not counting the ones the
     * new proposal replaces (staging the same tool and target again is allowed at the cap).
     */
    async stageProposal(adminId: AdminId, input: NewProposal): Promise<ProposalRecord> {
      assertAdminId(adminId);
      const conversation = await ownedConversation(ctx, adminId, input.conversationId);
      assertPayloadAllowed('proposal.steps', input.steps);
      assertPayloadAllowed('proposal.preview', input.preview);
      if (input.planId) {
        if (!isValidUuid(input.planId)) throw new AdminAgentStoreError('plan_stale', undefined, { reason: 'plan_not_found' });
        const plan = unwrap(
          'proposals.planOwned',
          await ctx.db.from('admin_agent_plans').select('id').eq('id', input.planId).eq('admin_id', adminId).eq('conversation_id', conversation.id).maybeSingle(),
        );
        if (!plan) throw new AdminAgentStoreError('plan_stale', undefined, { reason: 'plan_not_found' });
      }
      if (input.maxPending !== undefined) {
        // A proposal with the same key replaces the older one below, so the older one does not count against the cap.
        const pending = await countPending(adminId, conversation.id);
        const replaced = input.supersedeKey ? await countPending(adminId, conversation.id, input.supersedeKey) : 0;
        if (pending - replaced >= input.maxPending) throw new AdminAgentStoreError('agent_cap_reached', { limit: input.maxPending });
      }

      // Supersede before the insert (the order `writePlanRevision` uses): a failure here refuses a staging that wrote nothing,
      // and a failed insert afterwards leaves at worst the older card retired, never a live card the caller was told failed.
      if (input.supersedeKey) {
        unwrap(
          'proposals.supersede',
          await ctx.db
            .from('admin_agent_proposals')
            .update({ status: 'superseded' })
            .eq('conversation_id', conversation.id)
            .eq('admin_id', adminId)
            .eq('supersede_key', input.supersedeKey)
            .eq('status', 'proposed'),
        );
      }

      const proposal = unwrapRow(
        'proposals.stage',
        await ctx.db
          .from('admin_agent_proposals')
          .insert({
            ...(input.id === undefined ? {} : { id: input.id }),
            conversation_id: conversation.id,
            admin_id: adminId,
            admin_name: conversation.admin_name,
            kind: input.kind,
            class: input.class,
            plan_id: input.planId ?? null,
            plan_revision: input.planRevision ?? null,
            tool_registry_version: input.toolRegistryVersion,
            steps: input.steps,
            proposal_hash: input.proposalHash,
            preview: input.preview,
            preview_hash: input.previewHash,
            token_hash: input.tokenHash,
            acks_required: input.acksRequired ?? [],
            expires_at: input.expiresAt.toISOString(),
            supersede_key: input.supersedeKey ?? null,
            locale: input.locale,
          })
          .select(PROPOSAL_COLUMNS)
          .single(),
      );
      return proposal;
    },

    /** The proposal with its steps, when it is this admin's (another admin's is `null`: 404 `proposal_not_found`). */
    async getProposalOrThrow(adminId: AdminId, proposalId: string): Promise<ProposalRecord> {
      const proposal = await getProposal(adminId, proposalId);
      if (!proposal) throw new AdminAgentStoreError('proposal_not_found');
      return proposal;
    },

    /** The conversation's proposals, newest first, without `steps`. `statuses` narrows the list. */
    async listProposals(
      adminId: AdminId,
      conversationId: string,
      options: { statuses?: readonly ProposalStatus[]; limit?: number } = {},
    ): Promise<ProposalSummary[]> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), PROPOSAL_LIST_MAX);
      let query = ctx.db
        .from('admin_agent_proposals')
        .select(PROPOSAL_SUMMARY_COLUMNS)
        .eq('conversation_id', conversationId)
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });
      if (options.statuses && options.statuses.length > 0) query = query.in('status', [...options.statuses]);
      return unwrap('proposals.list', await query.limit(limit)) ?? [];
    },

    /** Proposals still waiting for the admin: `proposed` and not past `expires_at`. */
    async listPendingProposals(adminId: AdminId, conversationId: string): Promise<ProposalSummary[]> {
      assertAdminId(adminId);
      await ownedConversation(ctx, adminId, conversationId);
      return (
        unwrap(
          'proposals.listPending',
          await ctx.db
            .from('admin_agent_proposals')
            .select(PROPOSAL_SUMMARY_COLUMNS)
            .eq('conversation_id', conversationId)
            .eq('admin_id', adminId)
            .eq('status', 'proposed')
            .gt('expires_at', ctx.now().toISOString())
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .limit(PROPOSAL_LIST_MAX),
        ) ?? []
      );
    },

    /** Marks this admin's overdue `proposed` proposals `expired` (one conversation, or all of the admin's). Returns their ids. */
    async expireProposals(adminId: AdminId, conversationId?: string): Promise<string[]> {
      assertAdminId(adminId);
      if (conversationId !== undefined) await ownedConversation(ctx, adminId, conversationId);
      let query = ctx.db
        .from('admin_agent_proposals')
        .update({ status: 'expired' })
        .eq('admin_id', adminId)
        .eq('status', 'proposed')
        .lt('expires_at', ctx.now().toISOString());
      if (conversationId !== undefined) query = query.eq('conversation_id', conversationId);
      return (unwrap('proposals.expire', await query.select('id')) ?? []).map((row) => row.id);
    },

    /** Declines a pending proposal. A handled one is `proposal_not_pending`; another admin's is `proposal_not_found`. */
    async declineProposal(adminId: AdminId, proposalId: string): Promise<ProposalRecord> {
      assertAdminId(adminId);
      if (!isValidUuid(proposalId)) throw new AdminAgentStoreError('proposal_not_found');
      const row = unwrap(
        'proposals.decline',
        await ctx.db
          .from('admin_agent_proposals')
          .update({ status: 'declined', finished_at: ctx.now().toISOString() })
          .eq('id', proposalId)
          .eq('admin_id', adminId)
          .eq('status', 'proposed')
          .select(PROPOSAL_COLUMNS)
          .maybeSingle(),
      );
      if (row) return row;
      const current = await getProposal(adminId, proposalId);
      if (!current) throw new AdminAgentStoreError('proposal_not_found');
      throw new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: current.status } });
    },

    /**
     * The atomic claim of the approve route: `proposed` to `executing`, stamped with the approver, the time and the
     * client fingerprint (a keyed IP hash and a truncated user agent), only for an unexpired proposal of this admin whose
     * token hash matches. The error says which condition failed (`proposal_not_found`, `proposal_not_pending`,
     * `proposal_token_invalid`, `proposal_expired`), or `proposal_conflict_executing` when the conversation already has
     * an executing proposal.
     */
    async claimProposal(adminId: AdminId, proposalId: string, claim: ProposalClaim): Promise<ProposalRecord> {
      assertAdminId(adminId);
      if (!isValidUuid(proposalId)) throw new AdminAgentStoreError('proposal_not_found');
      const now = ctx.now().toISOString();
      const { data, error } = await ctx.db
        .from('admin_agent_proposals')
        .update({
          status: 'executing',
          approved_by: adminId,
          approved_at: now,
          approved_ip_hash: claim.ipHash ?? null,
          approved_user_agent: claim.userAgent ? claim.userAgent.slice(0, USER_AGENT_MAX) : null,
          executing_started_at: now,
        })
        .eq('id', proposalId)
        .eq('admin_id', adminId)
        .eq('status', 'proposed')
        .eq('token_hash', claim.tokenHash)
        .gt('expires_at', now)
        .select(PROPOSAL_COLUMNS)
        .maybeSingle();
      if (error) {
        if (isUniqueViolation(error, EXECUTING_INDEX)) throw new AdminAgentStoreError('proposal_conflict_executing');
        unwrap('proposals.claim', { data: null, error });
      }
      if (data) return data;
      throw await claimRefusal(adminId, proposalId, claim.tokenHash);
    },

    /** Ends an executing proposal (`completed`, `partial`, `failed`, `stale`, `unknown`). Anything else is `proposal_not_pending`. */
    async finishProposal(adminId: AdminId, proposalId: string, status: ProposalFinalStatus): Promise<ProposalRecord> {
      assertAdminId(adminId);
      if (!isValidUuid(proposalId)) throw new AdminAgentStoreError('proposal_not_found');
      const row = unwrap(
        'proposals.finish',
        await ctx.db
          .from('admin_agent_proposals')
          .update({ status, finished_at: ctx.now().toISOString() })
          .eq('id', proposalId)
          .eq('admin_id', adminId)
          .eq('status', 'executing')
          .select(PROPOSAL_COLUMNS)
          .maybeSingle(),
      );
      if (row) return row;
      const current = await getProposal(adminId, proposalId);
      if (!current) throw new AdminAgentStoreError('proposal_not_found');
      throw new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: current.status } });
    },

    /**
     * The reaper: this admin's `executing` proposals that started before `olderThan` (the resume window plus one request) become
     * `unknown`, so a crash between the claim and the first ledger row cannot hold the one-executing-proposal index.
     * Returns the reaped ids (the caller appends the harness event).
     */
    async reapExecutingProposals(adminId: AdminId, olderThan: Date): Promise<string[]> {
      assertAdminId(adminId);
      const rows = unwrap(
        'proposals.reap',
        await ctx.db
          .from('admin_agent_proposals')
          .update({ status: 'unknown', finished_at: ctx.now().toISOString() })
          .eq('admin_id', adminId)
          .eq('status', 'executing')
          .lt('executing_started_at', olderThan.toISOString())
          .select('id'),
      );
      return (rows ?? []).map((row) => row.id);
    },
  };
}

export type ProposalRepository = ReturnType<typeof proposalRepository>;
