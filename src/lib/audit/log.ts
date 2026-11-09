/**
 * Fire-and-forget audit log writer.
 *
 * Usage — never await in the main write path:
 *   logAuditEvent({ actor_id, actor_name, action, resource_type, ... });
 *
 * Errors are swallowed silently. The audit log never blocks or breaks
 * the calling API route.
 *
 * The single exception is `logAuditEventStrict` below: it awaits the insert and rejects on failure, and is used only
 * by the unmask read of hidden relations, which must fail closed (no audit row, no data).
 */

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';
import { getAgentAuditContext } from './agent-context';

// ─── Types ─────────────────────────────────────────────────────────

export type AuditAction =
  | 'player.create'
  | 'player.update'
  | 'player.delete'
  | 'player.ban'
  | 'player.suspend'
  | 'player.unsuspend'
  | 'player.suspension_expired'
  | 'player.role.assign'
  | 'player.role.revoke'
  | 'player.claim'
  | 'player.sessions_revoke'
  | 'tournament.create'
  | 'tournament.update'
  | 'tournament.delete'
  | 'game.edit'
  | 'game.delete'
  | 'game.import_replay'
  | 'match.reset'
  | 'match.schedule'
  | 'match.dispute'
  | 'match.reopen'
  | 'match.override'
  | 'match.admin_result'
  | 'match.replay_unresolved'
  // Matches list bulk actions: one event per changed match, plus one `match.bulk_action` summary per batch.
  | 'match.bulk_confirm'
  | 'match.bulk_schedule'
  | 'match.bulk_note'
  | 'match.bulk_action'
  | 'match.repair'
  | 'match.auto_confirm'
  | 'match.propagation_failed'
  | 'match.finalize_failed'
  | 'match.finalize_healed'
  | 'match.proposal.create'
  | 'match.proposal.accept'
  | 'match.proposal.reject'
  | 'round.reset'
  | 'round.delete'
  | 'round.generate'
  | 'round.force_complete'
  | 'bracket.generate'
  | 'tournament.seeds.update'
  | 'phase.create'
  | 'phase.update'
  | 'phase.delete'
  | 'phase.reorder'
  | 'season.participant.substitute'
  | 'season.phase.groups.repair'
  | 'season.phase.advance'
  | 'phase.enrollment.sync'
  | 'phase.roster.force'
  | 'season.groups.replace'
  | 'season.group.rename'
  | 'season.group.member.place'
  | 'discord_webhook.create'
  | 'discord_webhook.update'
  | 'discord_webhook.delete'
  | 'discord_webhook.test'
  | 'admin.achievement.create'
  | 'admin.achievement.update'
  | 'admin.achievement.delete'
  | 'admin.backfill'
  | 'admin.import'
  | 'admin.export'
  | 'cast_session.delete'
  | 'broadcast_preset.update'
  | 'wiki.note.create'
  | 'wiki.note.update'
  | 'wiki.note.approve'
  | 'wiki.note.reject'
  | 'wiki.note.delete'
  | 'wiki.note.report'
  | 'wiki.note.block_resubmission'
  | 'wiki.note.unblock_resubmission'
  | 'wiki.report.update'
  | 'resource_admin.grant'
  | 'resource_admin.revoke'
  | 'season.format_rules.update'
  | 'season.bind_point_buy_list'
  | 'season.auto_bind_point_buy_list'
  | 'season.auto_create_battle_ruleset'
  | 'season.clear_battle_ruleset_bans'
  | 'season.create'
  | 'season.update'
  | 'season.clone'
  | 'season.clone_failed'
  | 'season.set_test_flag'
  | 'season.delete'
  | 'season.restore'
  | 'season.purge'
  | 'season.rebuild'
  | 'season.format.attach'
  | 'season.format.detach'
  | 'season.format.engine'
  // Live format of a kit league (api/seasons/[id]/format/{actions,challenges,adjustments,checks,relations}); ids and
  // codes in the metadata, never picks, notes or hidden relation pairs.
  | 'season.format.action.submit'
  // A pick the engine cron drew for a player whose action window closed (`seeded_random_pick`); System actor, `metadata.via`.
  | 'season.format.action.auto_pick'
  | 'season.format.challenge.make'
  | 'season.format.challenge.answer'
  | 'season.format.challenge.withdraw'
  | 'season.format.adjustment'
  | 'season.format.check.resolve'
  | 'season.format.relations.view_hidden'
  // A league admin started the first round of a phase although the format reported it not ready (api/generate-round,
  // generate-all-rounds, rounds/manual with `?force=true`); the reason codes the guard reported in the metadata.
  | 'season.format.round.force_start'
  | 'format.create'
  | 'format.fork'
  | 'format.publish'
  | 'format.visibility'
  | 'format.delete'
  | 'ruleset.create'
  | 'ruleset.fork'
  | 'ruleset.publish'
  | 'ruleset.visibility'
  | 'ruleset.delete'
  | 'ruleset.pin'
  | 'ruleset.seed'
  | 'point_buy_list.create'
  | 'point_buy_list.deactivate'
  | 'draft.pick.on_behalf'
  | 'draft.pick_order.free'
  | 'draft.pool.delete'
  | 'draft.order.roll'
  // The Admin Assistant's own events (docs/poketools-spec.md §18, "Audit"); the routes it
  // dispatches write their usual events, tagged through the agent audit context.
  | 'agent.propose'
  | 'agent.approve'
  | 'agent.decline'
  | 'agent.expire'
  | 'agent.step.execute'
  | 'agent.step.fail'
  | 'agent.step.unknown'
  | 'agent.draft.write'
  | 'agent.budget.block'
  | 'agent.model.refusal'
  // Actions of a pack extension's own routes (docs/format-packs.md, "Pack extensions"). They have
  // no `auditActions` label: the extension labels them (`auditActionLabels`, localized), and the
  // audit log humanizes any it leaves out (`auditActionLabel`).
  | `extension.${string}`;

export interface AuditLogEntry {
  actor_id: string | null;
  actor_name: string;
  action: AuditAction;
  resource_type: string;
  resource_id: string | null;
  resource_name?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
  ip_address?: string;
}

// ─── Writer ───────────────────────────────────────────────────────

/**
 * Insert an audit log entry. Fire-and-forget — caller must NOT await.
 *
 * @example
 *   logAuditEvent({
 *     actor_id: player.playerId,
 *     actor_name: player.name,
 *     action: 'player.delete',
 *     resource_type: 'player',
 *     resource_id: targetPlayerId,
 *     resource_name: targetPlayerName,
 *     ip_address: request.headers.get('x-forwarded-for') ?? undefined,
 *   });
 */
export function logAuditEvent(entry: AuditLogEntry): void {
  const row = buildAuditRow(entry);
  // Fire-and-forget: catch all errors so the caller is never disrupted
  try {
    Promise.resolve(supabase.from('audit_log').insert(row))
      .then(({ error }) => {
        if (error) {
          // Swallow the error — audit log failures must never break the write path
          console.error('[audit] Failed to write audit entry:', error);
        }
      })
      .catch((error: unknown) => {
        console.error('[audit] Failed to write audit entry:', error);
      });
  } catch (error) {
    console.error('[audit] Failed to write audit entry:', error);
  }
}

/**
 * Insert an audit log entry and WAIT for it: resolves once the row is written, rejects when the write fails.
 *
 * For the few reads whose audit entry is the price of the data (the unmask read of hidden relations): the caller
 * awaits this BEFORE it returns the data, and answers a failure with an error and no data (fail-closed). Every other
 * write path keeps using {@link logAuditEvent}, which must never break the caller. The rejection carries a generic
 * message (the database error is logged here, not passed on), so a route may hand it to `safeErrorResponse`.
 */
export async function logAuditEventStrict(entry: AuditLogEntry): Promise<void> {
  const row = buildAuditRow(entry);
  let failure: unknown = null;
  try {
    const { error } = await supabase.from('audit_log').insert(row);
    failure = error;
  } catch (error) {
    failure = error;
  }
  if (failure) {
    console.error('[audit] Failed to write audit entry:', failure);
    throw new Error('Audit entry could not be written');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

/** The `audit_log` row of an entry. Inside an Admin Assistant dispatch it carries the agent's provenance. */
function buildAuditRow(entry: AuditLogEntry): Database['public']['Tables']['audit_log']['Insert'] {
  // The agent's provenance wins over the route's own metadata, so a route cannot claim or hide `via: 'agent'`.
  // Outside a dispatch, the metadata is passed through untouched.
  const agentContext = getAgentAuditContext();
  const metadata = agentContext
    ? { ...entry.metadata, ...definedFields(agentContext), via: 'agent' }
    : entry.metadata;

  return {
    actor_id: entry.actor_id,
    actor_name: entry.actor_name,
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    resource_name: entry.resource_name ?? null,
    changes: entry.changes as unknown as Database['public']['Tables']['audit_log']['Insert']['changes'],
    metadata: metadata as unknown as Database['public']['Tables']['audit_log']['Insert']['metadata'],
    ip_address: entry.ip_address ?? null,
  };
}

/** The own fields of `fields` that are not `undefined` (an unset optional context field adds no key). */
function definedFields(fields: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** Add a before/after diff for a field if values differ. Mutates changes. */
export function diffField(
  changes: Record<string, { before: unknown; after: unknown }>,
  field: string,
  before: unknown,
  after: unknown,
): void {
  if (before !== after) {
    changes[field] = { before, after };
  }
}