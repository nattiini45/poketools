import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { startSeasonIfUpcoming } from '@/lib/season/start-season';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { parseGenerateOptions } from '@/lib/tournament/generate-options';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
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

/**
 * POST /api/tournaments/[id]/generate-bracket
 * Admin: generate the full elimination bracket (SE/DE).
 * Optional JSON body `{ "start_round": true }` also starts the first round (best effort); the response then
 * carries `started_round_id`.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireResourceAdmin('tournament', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID');
    if (invalidId) return invalidId;
    const options = await parseGenerateOptions(request);
    if (!options.ok) return options.response;

    const tournament = await getTournamentById(id);
    if (!tournament) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
        { status: 404 }
      );
    }

    // A custom league without an attached format cannot start: refuse before the bracket is written. The season
    // type is already joined onto the tournament, so every other league type takes no extra read. The kit phase it
    // answers with is what the format's own set-up gate and the announcement below work from.
    const kitPhase = await loadKitPhaseOfTournament(tournament);

    if (tournament.bracket_type !== 'single_elim' && tournament.bracket_type !== 'double_elim') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Full bracket generation only applies to elimination formats', code: 'bracket_generate_elim_only' },
        { status: 400 }
      );
    }

    if (tournament.status === 'completed') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Tournament is already completed', code: 'tournament_already_completed' },
        { status: 400 }
      );
    }

    const participants = await getParticipants(id);
    if (participants.length < 2) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Need at least 2 participants', code: 'tournament_participants_too_few' },
        { status: 400 }
      );
    }
    // The first round waits for the format's own set-up (a draw, the actions players owe), like the round generators: an
    // admin may force it, and the override is audited once the bracket is written (`announceKitRound`).
    const forcedStart = await assertPhaseReadyForFirstRound(tournament, kitPhase, {
      force: wantsForcedStart(request),
      actor: { id: admin.playerId, name: admin.name },
    });
    // The bracket writes its rounds and matches one by one, and the league status follows: the public reads expire in a
    // finally, so a failure part-way (or the league write after the bracket) still shows what was written.
    let result: Awaited<ReturnType<typeof generateEliminationBracket>>;
    try {
      result = await generateEliminationBracket(tournament, participants, {
        startFirstRound: options.startRound,
      });

      if (tournament.season_id) await startSeasonIfUpcoming(tournament.season_id);
    } finally {
      expireTournamentReads(id, tournament.season_id);
    }

    // A kit league's format reacts to the opened phase like it does to a generated round: `stage_start`, `round_start` of the
    // first round, the forced-start audit. The bracket writes every round at once, so the first one is announced.
    // Best effort and logged inside; a phase that is not on the kit engine is left alone.
    if (isKitEnginePhase(kitPhase)) {
      const rounds = await getRoundsByTournament(id);
      const first = rounds.reduce((lowest, round) => Math.min(lowest, round.round_number), Number.POSITIVE_INFINITY);
      // The phase opens only when this call moved it out of upcoming; a status another writer moved meanwhile is not replayed.
      const startsPhase = tournament.status === 'upcoming' && !result.status_moved_elsewhere;
      await announceKitRound(tournament, kitPhase, { roundNumber: Number.isFinite(first) ? first : 1 }, startsPhase, forcedStart);
    }

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'bracket.generate',
      resource_type: 'tournament',
      resource_id: id,
      resource_name: tournament.name,
      metadata: {
        rounds_created: result.rounds_created,
        matches_materialized: result.matches_materialized,
        started: result.started_round_id !== undefined,
      },
    });

    const roundPayload = {
      event_type: 'round_generated' as const,
      tournament_id: id,
      season_id: tournament.season_id,
      data: {
        kind: 'round_generated' as const,
        tournament_name: tournament.name,
        round_name: 'Full bracket',
        pairings: [],
      },
    };
    void emitDiscordEvent(roundPayload);
    void emitSocialEvent(roundPayload);

    return NextResponse.json<ApiResult<typeof result>>(
      { success: true, data: result },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to generate bracket');
  }
}
