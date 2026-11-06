import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { validateTeamSchema, formatZodErrors } from '@/lib/validation';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { checkTeam } from '@/lib/team/check.server';
import { isKitTeamCandidate, kitTeamVerdict } from '@/lib/team/kit-team-gate';
import { isMatchParticipant, roundOfMatch } from '@/lib/team/match-round';
import type { ApiResult } from '@/types/api';
import type { TeamValidationResult } from '@/types/team';

/** Per player: well above one debounced check per 600 ms of continuous editing, far below a scripted flood. */
const VALIDATE_TEAM_LIMIT = { limit: 240, windowSeconds: 60 } as const;

/**
 * POST /api/validate-team — the teambuilder's live legality check.
 *
 * This route only decides WHICH ruleset and WHICH league context apply (and refuses a tournament or ruleset that does
 * not exist); the check itself is `checkTeam` (`src/lib/team/check.server.ts`), the same function the import preview
 * and the AI agent's tool call, so they cannot disagree about one team. The body's `pokemon` is shape-checked by
 * `validateTeamSchema` first: a malformed set is a coded 400, never a 500.
 *
 * Which round a kit league's team rules are checked for: the round of `match_id` when the team is built for a match
 * (the caller must play that match or be an admin, and the match must belong to `tournament_id`), else `round_number`,
 * else the phase's current round. An admin who does not play the match gets the ruleset verdict only: the stage's rules
 * read the CALLER's gifts and pools, which are not those of the match's players.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();
    // The teambuilder asks again after every debounced edit and each ask reads the league's runtime state.
    const rate = await checkRateLimit('validate-team', player.playerId, VALIDATE_TEAM_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const rawBody = await request.json();
    const zodResult = validateTeamSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const body = zodResult.data;

    if (body.match_id !== undefined && !body.tournament_id) {
      const issues = 'match_id: needs tournament_id';
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    // ─── The ruleset to enforce ──────────────────────────────────────
    // With tournament context the phase's own PIN is enforced: `tournaments.ruleset_id` is the id of an immutable
    // ruleset version, so what a phase enforces never depends on how a ruleset was edited since, on the name of the
    // league, or on a client-supplied id (a stale id from the UI is ignored). A tournament that does not exist is a 404:
    // validating against some other ruleset instead would hide the mistake.
    //
    // Without tournament context (the free teambuilder, ad-hoc format validation) the caller names a ruleset version;
    // it is served only when that ruleset is meant to be seen (shared, or pinned by a league).
    let ruleset = null as Awaited<ReturnType<typeof getRulesetById>>;
    let resolvedSeasonId: string | null = body.season_id ?? null;
    // Season resolved inside the tournament branch. Under tournament context ONLY this season may switch on the
    // Evolution Point Buy rules (it is passed to the check as known; a client-chosen season could apply the rules of an
    // unrelated league). Without tournament context the check reads the season of the caller-supplied `season_id`.
    let tournamentBranchSeason: Awaited<ReturnType<typeof getSeasonById>> = null;
    let kitTournament: Awaited<ReturnType<typeof getTournamentById>> = null;
    if (body.tournament_id) {
      const tournament = await getTournamentById(body.tournament_id);
      if (!tournament) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Tournament not found', code: 'tournament_not_found' },
          { status: 404 }
        );
      }
      const season = tournament.season_id ? await getSeasonById(tournament.season_id) : null;
      if (season) resolvedSeasonId = season.id;
      tournamentBranchSeason = season;
      kitTournament = tournament;
      ruleset = await getRulesetById(tournament.ruleset_id);
    } else {
      ruleset = await readExposedRuleset(body.ruleset_id);
    }

    if (!ruleset) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Ruleset not found', code: 'ruleset_not_found' },
        { status: 404 }
      );
    }

    // A match names its own round (it wins over `round_number`). A match of another tournament is the same 404 as a
    // missing one; a stranger to the match is refused, an admin who is a stranger gets the ruleset verdict only.
    let roundNumber = body.round_number;
    let stageRulesApply = true;
    // Only a kit league's rules depend on the round, so no other league reads the match.
    if (body.match_id !== undefined && body.tournament_id && isKitTeamCandidate(kitTournament)) {
      const found = await roundOfMatch(body.match_id, body.tournament_id);
      if (found.status === 'not_found') {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Match not found', code: 'match_not_found' },
          { status: 404 }
        );
      }
      if (!isMatchParticipant(found.match, player.playerId)) {
        if (!player.isAdmin) {
          return NextResponse.json<ApiResult<never>>(
            { success: false, error: 'You are not a participant in this match', code: 'match_prep_not_participant' },
            { status: 403 }
          );
        }
        stageRulesApply = false;
      }
      roundNumber = found.roundNumber;
    }

    // A kit league's phase answers the ruleset check merged with its stage constraints and the player's resources
    // (null for any other phase, which keeps the plain check below).
    const kitResult =
      kitTournament && stageRulesApply
        ? await kitTeamVerdict({
            tournament: kitTournament,
            playerId: player.playerId,
            pokemon: body.pokemon,
            ...(roundNumber !== undefined ? { roundNumber } : {}),
            ruleset,
          })
        : null;

    const result =
      kitResult ??
      (await checkTeam({
        pokemon: body.pokemon,
        ruleset,
        playerId: player.playerId,
        seasonId: resolvedSeasonId,
        season: body.tournament_id ? tournamentBranchSeason : undefined,
      }));

    return NextResponse.json<ApiResult<TeamValidationResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to validate team');
  }
}
