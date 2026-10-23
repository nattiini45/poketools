import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getRoundById,
  updateRoundStatus,
  updateRoundBestOf,
  updateRoundDeadline,
} from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';
import { BYE_PLAYER_ID } from '@/lib/tournament/types';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { triggerTournamentReport } from '@/lib/ai/trigger';
import { expireTournamentReads } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { toPublicMatches } from '@/lib/match/public-match';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import type { ApiResult } from '@/types/api';
import type { RoundWithMatches } from '@/types/round';
import type { RoundCompletedData } from '@/types/discord';
import { roundUpdateSchema, formatZodErrors } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string; rid: string }>;
}

/** Two stored timestamps name the same instant (Postgres and the API spell one instant differently). */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

// Public: no auth required — round detail with matches (public match shape only)
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, rid } = await params;

    // A malformed id names no row. Answer 404 before the query, with the code
    // of the segment that is malformed: Postgres rejects a non-UUID filter,
    // which used to surface as a 500.
    const invalid =
      rejectInvalidPathId(id, 'INVALID_TOURNAMENT_ID') ?? rejectInvalidPathId(rid, 'INVALID_ROUND_ID');
    if (invalid) return invalid;

    const round = await getRoundById(rid);

    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 }
      );
    }
    if (round.tournament_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round does not belong to this tournament', code: 'round_wrong_tournament' },
        { status: 404 }
      );
    }

    // Anyone may call this route: matches leave as `PublicMatch`, never with
    // the admin notes, submitter or confirmation timestamps.
    const matches = toPublicMatches(await getMatchesByRound(rid));

    const result: RoundWithMatches = { ...round, matches };
    return NextResponse.json<ApiResult<RoundWithMatches>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch round');
  }
}

// Admin — update round status, best_of and/or deadline
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, rid } = await params;
    const admin = await requireResourceAdmin('tournament', id);
    const invalidRound = rejectInvalidPathId(rid, 'INVALID_ROUND_ID');
    if (invalidRound) return invalidRound;

    const rawBody = await request.json();
    const zodResult = roundUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    let round = await getRoundById(rid);
    if (!round) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round not found', code: 'round_not_found' },
        { status: 404 }
      );
    }
    if (round.tournament_id !== id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Round does not belong to this tournament', code: 'round_wrong_tournament' },
        { status: 404 }
      );
    }

    const deadlineBefore = round.deadline;

    // Read before any write: its league (if any) is expired after the write,
    // and the round_completed event below reuses it.
    const tournament = await getTournamentById(id);

    // best_of can only be changed on pending rounds
    if (body.best_of) {
      if (round.status !== 'pending') {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Can only change best_of on pending rounds', code: 'round_best_of_locked' },
          { status: 400 }
        );
      }
      round = await updateRoundBestOf(rid, body.best_of);
    }

    if (body.status) {
      round = await updateRoundStatus(rid, body.status);
    }

    // `undefined` leaves the deadline alone; `null` clears it.
    if (body.deadline !== undefined) {
      round = await updateRoundDeadline(rid, body.deadline);
    }
    // The public match page shows the deadline, so its reads expire too.
    expireTournamentReads(id, tournament?.season_id);

    if (body.deadline !== undefined && !sameInstant(deadlineBefore, round.deadline)) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'tournament.update',
        resource_type: 'round',
        resource_id: rid,
        resource_name: round.name,
        changes: { deadline: { before: deadlineBefore, after: round.deadline } },
        metadata: { tournament_id: id, field: 'deadline' },
      });
    }

    // Emit round_completed Discord event when round is marked completed
    if (body.status === 'completed') {
      try {
        if (tournament) {
          const [roundMatches, allMatchRecords, participants] = await Promise.all([
            getMatchesByRound(rid),
            getCompletedMatchRecords(id),
            getParticipants(id),
          ]);

          const participantIds = participants.map((p) => p.id);
          const participantNames: Record<string, string> = {};
          for (const p of participants) {
            participantNames[p.id] = p.name;
          }

          // Current standings (all completed matches including this round)
          // Format-aware: EPB seasons use the evolution-points tiebreakers
          // A Swiss stage scores its stored byes as wins (maxRound trims them below).
          const byes = await loadScoringByes(tournament);
          const currentStandings = await computeStandingsForSeason(
            tournament.season_id, participantIds, participantNames, allMatchRecords, {}, { byes }
          );

          // Previous standings (up to round before this one) for position diff
          let previousPositions: Map<string, number> | null = null;
          if (round.round_number > 1) {
            const prevStandings = await computeStandingsForSeason(
              tournament.season_id,
              participantIds,
              participantNames,
              allMatchRecords,
              {},
              { maxRound: round.round_number - 1, byes },
            );
            previousPositions = new Map(prevStandings.map((s, i) => [s.player_id, i + 1]));
          }

          // Build match results from completed matches in this round
          const matchResults: RoundCompletedData['match_results'] = roundMatches
            .filter((m) =>
              m.status === 'completed' &&
              m.player_1_id !== BYE_PLAYER_ID &&
              m.player_2_id !== BYE_PLAYER_ID
            )
            .map((m) => {
              const p1Wins = m.games.filter((g) => g.winner_id === m.player_1_id).length;
              const p2Wins = m.games.filter((g) => g.winner_id === m.player_2_id).length;
              return {
                player_1_name: m.player_1_name,
                player_2_name: m.player_2_name,
                score: `${p1Wins}:${p2Wins}`,
                winner_name: m.winner_id === m.player_1_id
                  ? m.player_1_name
                  : m.winner_id === m.player_2_id
                    ? m.player_2_name
                    : null,
              };
            });

          // Build standings with position changes
          const standings: RoundCompletedData['standings'] = currentStandings.map((s, i) => {
            const currentPos = i + 1;
            let positionChange: number | null = null;
            if (previousPositions) {
              const prevPos = previousPositions.get(s.player_id);
              positionChange = prevPos != null ? prevPos - currentPos : 0;
            }
            return {
              position: currentPos,
              player_name: s.player_name,
              wins: s.wins,
              losses: s.losses,
              draws: s.draws,
              points: s.points,
              position_change: positionChange,
            };
          });

          const roundCompletedPayload = {
            event_type: 'round_completed' as const,
            tournament_id: id,
            season_id: tournament.season_id,
            data: {
              kind: 'round_completed' as const,
              tournament_name: tournament.name,
              round_name: round.name,
              round_number: round.round_number,
              match_results: matchResults,
              standings,
            },
          };
          void emitDiscordEvent(roundCompletedPayload);
          void emitSocialEvent(roundCompletedPayload);
        }
      } catch (err) {
        // Discord event assembly failure should not break the round update response
        console.error('[Discord] Failed to assemble round_completed event:', err);
      }

      // Trigger AI round recap (fire-and-forget)
      triggerTournamentReport(id, rid, 'round_recap');
    }

    return NextResponse.json<ApiResult<typeof round>>({
      success: true,
      data: round,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update round');
  }
}
