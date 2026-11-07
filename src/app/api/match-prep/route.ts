import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logger } from '@/lib/logger';
import { matchPrepSchema, formatZodErrors } from '@/lib/validation';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  getMatchPrepTeam,
  upsertMatchPrepTeam,
} from '@/lib/supabase/queries/match-prep-teams';
import { upsertTeamForMatch } from '@/lib/supabase/queries/teams';
import { expireItemUsageReads } from '@/lib/team/item-usage-cache';
import { assertNoSuspendedLinesInTeam, assertEpbTeamCompliant } from '@/lib/draft/epb-team-validation';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { adviseKitTeam, isKitTeamCandidate, type KitTeamAdvisory } from '@/lib/team/kit-team-gate';
import { roundNumberOfMatch } from '@/lib/team/match-round';
import type { ApiResult } from '@/types/api';
import type { MatchPrepTeam } from '@/types/match-prep';
import type { PokemonSet } from '@/types/team';

/** GET /api/match-prep?match_id=X — get current player's prep team for a match */
export async function GET(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const matchId = request.nextUrl.searchParams.get('match_id');

    if (!matchId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'match_id is required', code: 'MISSING_PARAM', params: { name: 'match_id' } },
        { status: 400 }
      );
    }

    const prep = await getMatchPrepTeam(matchId, player.playerId);
    return NextResponse.json<ApiResult<MatchPrepTeam | null>>({
      success: true,
      data: prep,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch match prep team');
  }
}

/** POST /api/match-prep — create or update prep team */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const rawBody = await request.json();
    const zodResult = matchPrepSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;
    const pokemon = body.pokemon as PokemonSet[];

    // Verify player is a participant in this match
    const match = await getMatchById(body.match_id);
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 }
      );
    }

    const isParticipant =
      match.player_1_id === player.playerId ||
      match.player_2_id === player.playerId;
    if (!isParticipant && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You are not a participant in this match', code: 'match_prep_not_participant' },
        { status: 403 }
      );
    }

    // A completed match's registered rosters are public (spec §7) and feed EPB
    // participation: a participant can no longer rewrite them. Site admins
    // keep the correction path.
    if (match.status === 'completed' && !player.isAdmin) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'This match is completed; its registered team can no longer be changed',
          code: 'match_prep_match_completed',
        },
        { status: 409 }
      );
    }

    // Determine which player the team is for
    // Admins can specify a target player_id; participants always save for themselves
    let targetPlayerId = player.playerId;
    if (body.player_id && player.isAdmin) {
      // Validate target is a match participant
      if (body.player_id !== match.player_1_id && body.player_id !== match.player_2_id) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Target player is not a participant in this match',
            code: 'match_prep_target_not_participant',
          },
          { status: 400 }
        );
      }
      targetPlayerId = body.player_id;
    }

    const tournament = await getTournamentById(match.tournament_id);
    if (
      tournament?.season_id &&
      isEvolutionPointBuy(tournament.season_format_type ?? '')
    ) {
      // Enforce format_rules bans (moves/items) + stage-aware tera for EPB.
      // Throws UserFacingError → caught below → safeErrorResponse → 400.
      // Runs unconditionally for every EPB team so an invalid team can never
      // reach persistence — even when the round/matchday is unknown (a missing
      // round must not bypass format-rule enforcement).
      await assertEpbTeamCompliant(tournament.season_id, targetPlayerId, pokemon);
      const round = await getRoundById(match.round_id);
      const matchday = round?.round_number;
      if (matchday !== undefined) {
        // Suspended-line enforcement is matchday-dependent, so it stays gated
        // on a known round_number.
        await assertNoSuspendedLinesInTeam(
          tournament.season_id,
          targetPlayerId,
          matchday,
          pokemon
        );
      }
    }

    // A kit league's stage constraints and the player's resources (rounds change what is allowed): advice, never a
    // refusal. A completed match's rewrite is an admin correction and gets no advisory, as the rules have moved on since.
    // The verdict reads the target player's own gifts and pools (own-visibility resources whose giver is hidden), so
    // an admin saving a team for the opponent gets none: it would leak their holdings (`validate-team` withholds it too).
    let advisory: KitTeamAdvisory = {};
    if (isKitTeamCandidate(tournament) && match.status !== 'completed' && targetPlayerId === player.playerId) {
      const context = { tournamentId: tournament.id, playerId: targetPlayerId };
      try {
        // The rules of the match's round, never the phase's latest one. A round that cannot be read is no reason to
        // refuse the save, and no reason to judge the team by another round: the advisory is reported unavailable.
        const roundNumber = await roundNumberOfMatch(match);
        if (roundNumber === undefined) {
          // The match's round row is gone: never fall back to the phase's round.
          logger.warn('api/team-check', 'Match round not found for the team advisory', { ...context, matchId: match.id });
          advisory = { team_check: { status: 'unavailable' } };
        } else {
          advisory = await adviseKitTeam({ tournament, playerId: targetPlayerId, pokemon, roundNumber }, context);
        }
      } catch (roundError) {
        logger.error('api/team-check', 'Match round could not be read for the team advisory', { ...context, matchId: match.id, error: roundError });
        advisory = { team_check: { status: 'unavailable' } };
      }
    }

    const prep = await upsertMatchPrepTeam(
      body.match_id,
      targetPlayerId,
      pokemon,
      body.import_source || 'manual'
    );

    // Also persist to teams table so the team appears in saved teams / TeamPicker
    let syncedTeam = null;
    try {
      syncedTeam = await upsertTeamForMatch(
        targetPlayerId,
        body.match_id,
        match.tournament_id,
        pokemon,
        body.import_source || 'manual',
        // A site admin's rewrite is a correction: the database lock on completed
        // matches' rosters (teams_completed_match_lock) lets only it through.
        { correction: player.isAdmin }
      );
    } catch (syncErr) {
      // Non-fatal — the prep team is already saved; log for observability
      logger.error('api', 'Failed to sync prep team to teams table', {
        matchId: body.match_id,
        playerId: targetPlayerId,
        error: syncErr,
      });
    }

    // Item usage (H9) counts match-linked rows of COMPLETED matches: a rewrite
    // of such a row must expire the cached counts (never fails the request).
    if (syncedTeam && match.status === 'completed') {
      await expireItemUsageReads(syncedTeam, 'api/match-prep');
    }

    return NextResponse.json<ApiResult<MatchPrepTeam>>({
      success: true,
      data: prep,
      ...advisory,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to save match prep team');
  }
}
