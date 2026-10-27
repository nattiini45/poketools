/**
 * Fire-and-forget audit log writer.
 *
 * Usage — never await in the main write path:
 *   logAuditEvent({ actor_id, actor_name, action, resource_type, ... });
 *
 * Errors are swallowed silently. The audit log never blocks or breaks
 * the calling API route.
 */

import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/types/database';

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
  | 'bracket.generate'
  | 'tournament.seeds.update'
  | 'phase.create'
  | 'phase.update'
  | 'phase.delete'
  | 'phase.reorder'
  | 'season.participant.substitute'
  | 'season.phase.groups.repair'
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
  // Fire-and-forget: catch all errors so the caller is never disrupted
  const row: Database['public']['Tables']['audit_log']['Insert'] = {
    actor_id: entry.actor_id,
    actor_name: entry.actor_name,
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    resource_name: entry.resource_name ?? null,
    changes: entry.changes as unknown as Database['public']['Tables']['audit_log']['Insert']['changes'],
    metadata: entry.metadata as unknown as Database['public']['Tables']['audit_log']['Insert']['metadata'],
    ip_address: entry.ip_address ?? null,
  };
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

// ─── Helpers ─────────────────────────────────────────────────────

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