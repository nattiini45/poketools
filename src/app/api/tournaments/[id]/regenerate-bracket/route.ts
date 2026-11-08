import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { regenerateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { expireTournamentReads, revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import {
  announceKitRound,
  assertPhaseReadyForFirstRound,
  isKitEnginePhase,
  loadKitPhaseOfTournament,
  wantsForcedStart,
} from '@/lib/format-engine/route-guards';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/tournaments/[id]/regenerate-bracket — wipe and rebuild SE/DE bracket */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Bracket regeneration only applies to elimination formats', code: 'bracket_regenerate_elim_only' },
        { status: 400 }
      );
    }

    // A custom league without an attached format cannot start: refuse before anything is written (a phase of an unattached
    // custom league would otherwise be started by hand, and the league could then neither attach a format nor activate).
    const kitPhase = await loadKitPhaseOfTournament(tournament);

    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = cascadeActionSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    const cascade = parsed.data.cascade === true;
    // A bracket that has no round yet is the phase's first start: the format's set-up gate applies, like for a generated round.
    const forcedStart = await assertPhaseReadyForFirstRound(tournament, kitPhase, {
      force: wantsForcedStart(request),
      actor: { id: admin.playerId, name: admin.name },
    });
    let result: Awaited<ReturnType<typeof regenerateEliminationBracket>> | undefined;
    try {
      result = await regenerateEliminationBracket(tournament, participants, { cascade, adminId: admin.playerId });
    } finally {
      // A cascade resets played matches one by one (ratings, aggregates, player reads), and the caller of a reset expires the
      // pages: do it whatever the rest did, so a failure part-way leaves no rolled-back result on the public pages. Best effort.
      expireTournamentReads(id, tournament.season_id);
      if (cascade) {
        await revalidateMatchPages(id).catch((error: unknown) => {
          logger.error('regenerate-bracket', 'could not expire the pages of the reset matches', { tournamentId: id, error });
        });
      }
      // Wiping a bracket leaves a trace for the other admins, also when a cascade stopped half way (`completed: false`).
      if (cascade || result !== undefined) {
        logAuditEvent({
          actor_id: admin.playerId,
          actor_name: admin.name,
          action: 'bracket.generate',
          resource_type: 'tournament',
          resource_id: id,
          resource_name: tournament.name,
          metadata: {
            regenerated: true,
            cascade,
            completed: result !== undefined,
            ...(result !== undefined ? { rounds_created: result.rounds_created, matches_materialized: result.matches_materialized } : {}),
            ...(result?.format_revert_failed ? { format_revert_failed: true } : {}),
          },
        });
      }
    }

    // The format reacts to the opened phase like it does to a generated round (`stage_start`, `round_start` of the first
    // round, the forced-start audit); idempotent by key, so a regenerate of a started phase repeats nothing.
    if (isKitEnginePhase(kitPhase)) {
      const rounds = await getRoundsByTournament(id);
      const first = rounds.reduce((lowest, round) => Math.min(lowest, round.round_number), Number.POSITIVE_INFINITY);
      await announceKitRound(tournament, kitPhase, { roundNumber: Number.isFinite(first) ? first : 1 }, tournament.status === 'upcoming', forcedStart);
    }

    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to regenerate bracket');
  }
}
