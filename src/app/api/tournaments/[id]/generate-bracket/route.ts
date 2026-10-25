import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTournamentById,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { parseGenerateOptions } from '@/lib/tournament/generate-options';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
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
    const result = await generateEliminationBracket(tournament, participants, {
      startFirstRound: options.startRound,
    });

    if (tournament.season_id) {
      const season = await getSeasonById(tournament.season_id);
      if (season && season.status === 'upcoming') {
        await updateSeason(season.id, { status: 'active' });
      }
    }
    expireTournamentReads(id, tournament.season_id);

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
