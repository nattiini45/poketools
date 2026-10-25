import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { tournamentUpdateSchema, formatZodErrors } from '@/lib/validation';
import { z } from 'zod';
import {
  getTournamentById,
  getTournamentWithDetails,
  updateTournament,
  deleteTournament,
  getParticipants,
  getStagesBySeasonId,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { PhaseGuardError, assertPhaseNameFree } from '@/lib/tournament/league-phase';
import {
  assertStandaloneSettingsEditable,
  changesStandaloneLockedField,
  isTournamentStarted,
} from '@/lib/tournament/standalone-lock';
import {
  syncBracketResetSetting,
  type BracketResetSyncResult,
} from '@/lib/tournament/bracket-propagation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { logAuditEvent, diffField } from '@/lib/audit/log';
import { expireTournamentReads } from '@/lib/revalidation';
import {
  toDeleteRebuildWarning,
  type DeleteRebuildWarning,
  type EntityDeleteResult,
} from '@/lib/api/delete-rebuild-warning';
import {
  rebuildAfterTournamentDelete,
  type EntityDeleteRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import type { ApiResult } from '@/types/api';
import type { Tournament, TournamentWithDetails } from '@/types/tournament';
import type { TournamentUpdateInput } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function assertSeasonPhaseTournamentEditable(
  before: Tournament,
  body: TournamentUpdateInput
): void {
  if (!before.season_id) return;

  if (body.bracket_type !== undefined && body.bracket_type !== before.bracket_type) {
    if (before.status !== 'upcoming') {
      throw new PhaseGuardError(
        'Bracket type cannot be changed once the phase has started',
        'PHASE_BRACKET_LOCKED'
      );
    }
  }

  if (body.stage_order !== undefined && body.stage_order !== before.stage_order) {
    if (before.status !== 'upcoming') {
      throw new UserFacingError(
        'Stage order cannot be changed once the phase has started',
        { code: 'PHASE_STAGE_ORDER_LOCKED' }
      );
    }
  }

  if (before.status === 'completed' && body.status !== 'active') {
    const lockedFields = [
      'name',
      'bracket_type',
      'ruleset_id',
      'best_of_default',
      'bo_overrides',
      'is_doubles',
      'team_visibility',
    ] as const;
    for (const field of lockedFields) {
      if (body[field] !== undefined) {
        throw new UserFacingError(
          'Completed phases are locked. Reopen to active first.',
          { code: 'PHASE_COMPLETED_LOCKED' }
        );
      }
    }
  }
}

/** A comparable string of an override map (key-sorted entries): `diffField` compares with `!==`, which fails on objects. */
function boOverridesKey(overrides: Record<string, number> | null | undefined): string {
  return JSON.stringify(Object.entries(overrides ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

// The DELETE handler rebuilds all derived data (aggregates, ratings, streaks,
// EPB evolution) after the cascade — allow long-running rebuilds.
export const maxDuration = 300;

// Public — no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const tournament = await getTournamentWithDetails(id);

    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResult<TournamentWithDetails>>({
      success: true,
      data: tournament,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch tournament');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = tournamentUpdateSchema
      .extend({ archived: z.boolean().optional() })
      .safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    const before = await getTournamentById(id);
    if (!before) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    assertSeasonPhaseTournamentEditable(before, body);

    if (before.season_id) {
      // A league phase may not take another phase's name; saving its own
      // name again passes, so a league that holds duplicates stays editable.
      if (body.name !== undefined && body.name.toLowerCase() !== before.name.trim().toLowerCase()) {
        assertPhaseNameFree(body.name, await getStagesBySeasonId(before.season_id), id);
      }
    } else if (changesStandaloneLockedField(before, body)) {
      // A standalone tournament locks its bracket type, ruleset and doubles
      // setting once it started. The rounds are only read when one of those
      // fields really changes; everything else stays editable at any status.
      const rounds = await getRoundsByTournament(id);
      assertStandaloneSettingsEditable(
        before,
        body,
        isTournamentStarted({ status: before.status, rounds_total: rounds.length })
      );
    }

    const archivedBefore = before.archived;
    const archivedAfter = body.archived !== undefined ? body.archived : archivedBefore;

    const tournament = await updateTournament(id, body);

    // Bracket reset toggle changed: apply it to an existing DE bracket now
    // (delete scheduled reset matches on disable; repair-materialize on enable).
    // Deliberately allowed at any phase status — the toggle only affects future
    // materialization and never rewrites played results.
    const resetToggleChanged =
      body.bracket_reset_enabled !== undefined &&
      body.bracket_reset_enabled !== (before.bracket_reset_enabled ?? true);
    let bracketResetSync: BracketResetSyncResult | null = null;
    let bracketResetSyncError: string | null = null;
    if (resetToggleChanged) {
      try {
        bracketResetSync = await syncBracketResetSetting(
          tournament,
          await getParticipants(id)
        );
      } catch (err) {
        console.error('bracket reset sync failed after tournament update', err);
        bracketResetSyncError = 'bracket_reset_sync_failed';
      }
    }

    // Status, name and settings show on the next view of the public pages.
    // Expired after the reset sync, which can add or delete a reset match.
    expireTournamentReads(id, before.season_id);

    // Audit log: record significant field changes
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    diffField(changes, 'name', before.name, body.name ?? before.name);
    diffField(changes, 'status', before.status, body.status ?? before.status);
    diffField(changes, 'archived', archivedBefore, archivedAfter);
    if (body.bracket_reset_enabled !== undefined) {
      diffField(
        changes,
        'bracket_reset_enabled',
        before.bracket_reset_enabled ?? true,
        body.bracket_reset_enabled
      );
    }
    // The description is never copied into the row.
    diffField(changes, 'bracket_type', before.bracket_type, body.bracket_type ?? before.bracket_type);
    diffField(changes, 'ruleset_id', before.ruleset_id, body.ruleset_id ?? before.ruleset_id);
    diffField(
      changes,
      'best_of_default',
      before.best_of_default,
      body.best_of_default ?? before.best_of_default
    );
    diffField(changes, 'is_doubles', before.is_doubles, body.is_doubles ?? before.is_doubles);
    diffField(
      changes,
      'team_visibility',
      before.team_visibility,
      body.team_visibility ?? before.team_visibility
    );
    if (
      body.bo_overrides !== undefined &&
      boOverridesKey(before.bo_overrides) !== boOverridesKey(body.bo_overrides)
    ) {
      changes.bo_overrides = { before: before.bo_overrides ?? {}, after: body.bo_overrides };
    }
    if (Object.keys(changes).length > 0) {
      logAuditEvent({
        action: 'tournament.update',
        actor_id: admin.playerId,
        actor_name: admin.name,
        resource_type: 'tournament',
        resource_id: id,
        resource_name: tournament.name,
        changes,
        metadata:
          bracketResetSync || bracketResetSyncError
            ? {
                bracket_reset_sync: bracketResetSync,
                bracket_reset_sync_error: bracketResetSyncError,
              }
            : undefined,
      });
    }

    // Emit Discord + social event on status transition
    if (body.status && before.status !== body.status) {
      if (body.status === 'completed') {
        const completedPayload = {
          event_type: 'tournament_completed' as const,
          tournament_id: id,
          season_id: tournament.season_id,
          data: {
            kind: 'tournament_status' as const,
            tournament_name: tournament.name,
            new_status: 'completed' as const,
          },
        };
        void emitDiscordEvent(completedPayload);
        void emitSocialEvent(completedPayload);
      }
    }

    return NextResponse.json<ApiResult<typeof tournament>>({
      success: true,
      data: tournament,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update tournament');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const tournament = await getTournamentById(id);
    // Capture participants BEFORE the delete: the cascade removes the
    // participant rows, and they define whose ratings/streaks must be rebuilt.
    const participants = await getParticipants(id);
    await deleteTournament(id);
    expireTournamentReads(id, tournament?.season_id);

    // Rebuild derived data built from the deleted tournament's matches. The
    // delete has already committed, so a rebuild failure must not read as a
    // failed delete: the response carries it as `rebuild_warning` (the admin
    // runs the reconcile repair), and the server log and audit record keep it.
    let rebuild: EntityDeleteRebuildSummary | null = null;
    let rebuildWarning: DeleteRebuildWarning | null = null;
    try {
      rebuild = await rebuildAfterTournamentDelete({
        tournamentId: id,
        seasonId: tournament?.season_id ?? null,
        playerIds: participants.map((p) => p.id),
      });
    } catch (err) {
      console.error('tournament delete derived-data rebuild failed:', err);
      // Reported to the admin in the response (catalogued code, e.g.
      // rating_history_incomplete) and kept in the audit record.
      rebuildWarning = toDeleteRebuildWarning(err);
    }

    logAuditEvent({
      action: 'tournament.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'tournament',
      resource_id: id,
      resource_name: tournament?.name ?? id,
      metadata: {
        season_id: tournament?.season_id ?? null,
        rebuild,
        rebuild_error: rebuildWarning?.code ?? null,
      },
    });
    return NextResponse.json<ApiResult<EntityDeleteResult>>({
      success: true,
      data: { rebuild_warning: rebuildWarning },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete tournament');
  }
}