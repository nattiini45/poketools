import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { validateTeamSchema, formatZodErrors } from '@/lib/validation';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { checkTeam } from '@/lib/team/check.server';
import type { ApiResult } from '@/types/api';
import type { TeamValidationResult } from '@/types/team';

/**
 * POST /api/validate-team — the teambuilder's live legality check.
 *
 * This route only decides WHICH ruleset and WHICH league context apply (and refuses a tournament or ruleset that does
 * not exist); the check itself is `checkTeam` (`src/lib/team/check.server.ts`), the same function the import preview
 * and the AI agent's tool call, so they cannot disagree about one team. The body's `pokemon` is shape-checked by
 * `validateTeamSchema` first: a malformed set is a coded 400, never a 500.
 */
export async function POST(request: NextRequest) {
  try {
    const player = await requirePlayer();
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

    const result = await checkTeam({
      pokemon: body.pokemon,
      ruleset,
      playerId: player.playerId,
      seasonId: resolvedSeasonId,
      season: body.tournament_id ? tournamentBranchSeason : undefined,
    });

    return NextResponse.json<ApiResult<TeamValidationResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to validate team');
  }
}
