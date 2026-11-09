/**
 * The forced roster change of a started format phase: the request shape (`force` and `reason` in the body), what a guard
 * hands back when it accepted the override, and the audit entry the route writes once the change is made. The guard that
 * decides is `assertFormatPhaseRosterOpen` (`phase-guards.ts`); this module has no database access of its own besides the
 * fire-and-forget audit write, so a route test that mocks the guards still gets the request parsing.
 */
import { logAuditEvent } from '@/lib/audit/log';

/** What a roster request says about the override: `force` is honoured only as the boolean `true`. */
export interface RosterOverrideRequest {
  force: boolean;
  reason?: unknown;
}

/** The override a guard accepted: the reason the admin gave, trimmed. */
export interface RosterOverride {
  reason: string;
}

/** The change a forced roster request makes (the `change` of its audit entry). */
export type RosterChange = 'add' | 'remove' | 'seeds' | 'sync' | 'seed_by_rating';

/** The `force` and `reason` members of a request body (any other shape of body, or a non-boolean `force`, is no override). */
export function rosterOverrideOf(rawBody: unknown): RosterOverrideRequest {
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) return { force: false };
  const { force, reason } = rawBody as { force?: unknown; reason?: unknown };
  return { force: force === true, reason };
}

/** The audit entry of a forced roster change (who, which change, on which phase, why). Fire and forget. */
export function auditRosterOverride(
  actor: { playerId: string; name: string },
  seasonId: string,
  phase: { id: string; name?: string },
  override: RosterOverride,
  change: RosterChange,
  detail: Record<string, unknown> = {},
): void {
  logAuditEvent({
    actor_id: actor.playerId,
    actor_name: actor.name,
    action: 'phase.roster.force',
    resource_type: 'phase',
    resource_id: phase.id,
    resource_name: phase.name,
    metadata: { season_id: seasonId, change, reason: override.reason, ...detail },
  });
}
