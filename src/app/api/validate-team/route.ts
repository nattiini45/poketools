import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { validateTeamSchema, formatZodErrors } from '@/lib/validation';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getSeasonById, getParticipantCore } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getPicksByPlayer } from '@/lib/supabase/queries/drafts';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { validateTeam } from '@/lib/pkmn/validation';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { validateEpbTeamForSeason } from '@/lib/draft/epb-team-validation';
import type { ApiResult } from '@/types/api';
import type { TeamValidationResult, SetIssue, TeamIssue, PokemonSet } from '@/types/team';

/**
 * Stable key for a `SetIssue`, used to dedup when unioning two validation
 * results. Only the semantic fields matter — `issue_id` is a UX-only handle
 * and is intentionally excluded.
 */
function setIssueKey(issue: SetIssue): string {
  return `${issue.pokemon_index}|${issue.species}|${issue.issue}|${issue.severity}`;
}

/** Dedup identical `SetIssue` objects (by the semantic key above). */
function dedupIssues(issues: SetIssue[]): SetIssue[] {
  const seen = new Set<string>();
  const out: SetIssue[] = [];
  for (const issue of issues) {
    const key = setIssueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

/** Coded team issues of a result; plain strings when the details are missing or misaligned. */
function teamIssuesOf(result: TeamValidationResult): TeamIssue[] {
  const details = result.team_issue_details;
  if (details && details.length === result.team_issues.length) return details;
  return result.team_issues.map((issue) => ({ issue }));
}

/** Dedup identical team-wide issues by their English text, preserving first-seen order. */
function dedupTeamIssues(items: TeamIssue[]): TeamIssue[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.issue)) return false;
    seen.add(item.issue);
    return true;
  });
}

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
    // Season resolved inside the tournament branch is hoisted here so the EPB
    // enforcement branch below can reuse it without a duplicate fetch.
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

    // If this is a draft season, enforce ownership constraints
    let draftedPokemon: string[] | undefined;
    if (resolvedSeasonId) {
      // The caller's own pool: the season's, or their group's in a league with groups.
      const pool = await getInitialPoolForPlayer(resolvedSeasonId, player.playerId);
      if (pool) {
        const picks = await getPicksByPlayer(pool.id, player.playerId);
        draftedPokemon = picks.map((p) => p.pokemon_name);
      }
    }

    // ─── Fetch the player's assigned core triple (Core Liga) ─────────
    // The validator uses this for `type_quotas.source === 'player_core'`
    // and `tera_match === 'player_core'`. ALWAYS fetched server-side from
    // `season_participants.core_types` — never trusted from the client.
    let playerCore: import('@/types/season').CoreTriple | null = null;
    if (resolvedSeasonId) {
      try {
        playerCore = await getParticipantCore(resolvedSeasonId, player.playerId);
      } catch {
        playerCore = null;
      }
    }

    const result = validateTeam(body.pokemon as PokemonSet[], ruleset, {
      playerCore,
      draftedPokemon,
    });

    // ─── EPB format_rules enforcement ──────────────────────────────────
    // Evolution Point Buy seasons layer format_rules-driven constraints
    // (banned moves/items, Item Clause, stage-2 STAB-only tera) on top of
    // the core ruleset check. We union the EPB result with the core result so
    // the teambuilder live-check surfaces both sources at once, returning a
    // fresh merged object (the core `result` is left untouched).
    //
    // Sleep Clause and stage-3 tera ('none') are battle-runtime rules and are
    // intentionally NOT enforced here — they have no representation at
    // team-build time (see src/lib/draft/epb-team-validation.ts).
    if (resolvedSeasonId) {
      // Under tournament context use ONLY the tournament-resolved season
      // (tournamentBranchSeason — which may be null if the tournament has no
      // season). Do NOT fall back to a client-supplied season_id, which could
      // apply EPB rules from an unrelated, client-chosen season. Without
      // tournament context we fetch via the caller-supplied season_id as before.
      const season = body.tournament_id ? tournamentBranchSeason : await getSeasonById(resolvedSeasonId);
      if (season && isEvolutionPointBuy(season.format_type)) {
        const epbResult = await validateEpbTeamForSeason(
          resolvedSeasonId,
          player.playerId,
          body.pokemon as PokemonSet[],
        );
        // Merge: union both result sets, deduping identical entries, and
        // require BOTH validators to be clean for the team to be valid.
        const teamIssues = dedupTeamIssues([...teamIssuesOf(result), ...teamIssuesOf(epbResult)]);
        return NextResponse.json<ApiResult<TeamValidationResult>>({
          success: true,
          data: {
            valid: result.valid && epbResult.valid,
            issues: dedupIssues([...result.issues, ...epbResult.issues]),
            team_issues: teamIssues.map((i) => i.issue),
            team_issue_details: teamIssues,
          },
        });
      }
    }

    return NextResponse.json<ApiResult<TeamValidationResult>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to validate team');
  }
}
