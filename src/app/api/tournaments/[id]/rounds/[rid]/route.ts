import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import {
  getRoundById,
  updateRoundStatus,
  completeRound,
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
import { UserFacingError } from '@/lib/api/user-facing-error';
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

    // `rounds.status` is a manual flag that every generate route trusts, so completing is where unfinished matches
    // are caught: before any write, in every format. A resource admin can force it with a reason (audited below),
    // which is the only way to close a round whose match can never be played.
    // A round that is already completed has nothing left to refuse or to force: a repeat only answers with it.
    let forcedOpenMatches = 0;
    let roundMatches: Awaited<ReturnType<typeof getMatchesByRound>> = [];
    if (body.status === 'completed' && round.status !== 'completed') {
      roundMatches = await getMatchesByRound(rid);
      const unfinished = roundMatches.filter((match) => match.status !== 'completed');
      if (unfinished.length > 0) {
        if (body.force !== true) {
          throw new UserFacingError(
            `${round.name} still has ${unfinished.length} unfinished match(es). Finish them, or complete the round anyway with a reason.`,
            {
              code: 'round_matches_unfinished',
              params: { round: round.name, count: unfinished.length },
              status: 409,
            }
          );
        }
        forcedOpenMatches = unfinished.length;
      }
    }

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

    const statusBefore = round.status;
    // Side effects of a completion belong to the one call that really made the transition. The conditional claim
    // gives overlapping submissions the same guarantee as a sequential repeat.
    let completedNow = false;
    if (body.status === 'completed') {
      if (round.status !== 'completed') {
        const claimed = await completeRound(rid);
        if (claimed) {
          round = claimed;
          completedNow = true;
        } else {
          const current = await getRoundById(rid);
          if (!current) {
            return NextResponse.json<ApiResult<never>>(
              { success: false, error: 'Round not found', code: 'round_not_found' },
              { status: 404 }
            );
          }
          round = current;
        }
      }
    } else if (body.status) {
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

    if (completedNow && forcedOpenMatches > 0) {
      logAuditEvent({
        actor_id: admin.playerId,
        actor_name: admin.name,
        action: 'round.force_complete',
        resource_type: 'round',
        resource_id: rid,
        resource_name: round.name,
        changes: { status: { before: statusBefore, after: round.status } },
        metadata: {
          tournament_id: id,
          round_number: round.round_number,
          unfinished_matches: forcedOpenMatches,
          reason: body.reason,
        },
      });
    }

    // Emit round_completed Discord event when this call completed the round
    if (completedNow) {
      try {
        if (tournament) {
          const [allMatchRecords, participants] = await Promise.all([
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
        logger.error('discord', 'Failed to assemble round_completed event', {
          tournamentId: id,
          roundId: rid,
          error: err,
        });
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
