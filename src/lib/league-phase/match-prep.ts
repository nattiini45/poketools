import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertEpbTeamCompliant, assertNoSuspendedLinesInTeam } from '@/lib/draft/epb-team-validation';
import { KitStageSpecError, stageOf } from '@/lib/format-engine/load';
import { buildRuntimeState } from '@/lib/format-engine/runtime/state';
import { evaluateConstraints, mergeConstraintIssues } from '@/lib/format-engine/runtime/team';
import { resolveTeamMembers } from '@/lib/format-engine/runtime/team-server';
import { logger } from '@/lib/logger';
import { expirePhaseReads, expirePublicTags, publicTags } from '@/lib/revalidation';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { getPhaseById, isPlayerPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getPlayerPhaseMatchPrep, writePhaseTeam } from '@/lib/supabase/queries/phase-teams';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getSeasonFormat } from '@/lib/supabase/queries/season-formats';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { checkTeam } from '@/lib/team/check.server';
import { TeamChangedError } from '@/lib/team/completed-match-lock';
import type { KitTeamAdvisory } from '@/lib/team/kit-team-gate';
import type { MatchPrepInput } from '@/lib/validation/schemas';
import type { SessionPlayer } from '@/types/auth';
import type { CompetitionOwner } from '@/types/competition-owner';
import type { Json } from '@/types/database';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import commonErrors from '@/i18n/messages/errors/common/en';
import matchErrors from '@/i18n/messages/errors/matches/en';
import seasonErrors from '@/i18n/messages/errors/seasons/en';
import teamErrors from '@/i18n/messages/errors/teams/en';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';

type PhaseOwner = Extract<CompetitionOwner, { kind: 'phase' }>;

async function loadScope(owner: PhaseOwner, matchId: string, player: SessionPlayer) {
  const match = await getPhaseMatchById(matchId);
  if (!match || match.id !== matchId || match.phase_id !== owner.phase_id) {
    throw new UserFacingError(matchErrors.match_not_found, { code: 'match_not_found', status: 404 });
  }
  const playerIds = [match.player_1_id, match.player_2_id];
  if (!player.isAdmin && (!playerIds.includes(player.playerId)
    || !await isPlayerPhaseParticipant(player.playerId, owner.phase_id))) {
    throw new UserFacingError(teamErrors.match_prep_not_participant, { code: 'match_prep_not_participant', status: 403 });
  }
  const [phase, round] = await Promise.all([getPhaseById(owner.phase_id), getPhaseRoundById(match.round_id, owner.phase_id)]);
  if (!phase || phase.id !== owner.phase_id || phase.season_id !== owner.season_id) {
    throw new UserFacingError(seasonErrors.PHASE_NOT_FOUND, { code: 'PHASE_NOT_FOUND', status: 404 });
  }
  if (!round || round.id !== match.round_id || round.phase_id !== phase.id || round.round_number < 1) {
    throw new UserFacingError(tournamentErrors.round_not_found, { code: 'round_not_found', status: 404 });
  }
  return { match, phase, round, playerIds };
}

export async function getNativeMatchPrep(owner: PhaseOwner, matchId: string, player: SessionPlayer) {
  const { playerIds } = await loadScope(owner, matchId, player);
  return playerIds.includes(player.playerId) ? getPlayerPhaseMatchPrep(matchId, player.playerId) : null;
}

function staleFormat() {
  return new UserFacingError(seasonErrors.format_context_stale, { code: 'format_context_stale', status: 409 });
}

async function loadPinnedRuleset(rulesetId: string) {
  const ruleset = await getRulesetById(rulesetId);
  if (!ruleset || ruleset.id !== rulesetId) {
    throw new UserFacingError(tournamentErrors.ruleset_not_found, { code: 'ruleset_not_found', status: 404 });
  }
  return ruleset;
}

async function loadTeamPolicy(
  { phase, round }: Awaited<ReturnType<typeof loadScope>>,
  checkCompliance?: { playerId: string; pokemon: PokemonSet[] },
) {
  const season = await getSeasonById(phase.season_id);
  if (!season || season.id !== phase.season_id) {
    throw new UserFacingError(seasonErrors.season_not_found, { code: 'season_not_found', status: 404 });
  }
  if (checkCompliance && isEvolutionPointBuy(season.format_type)) {
    await assertEpbTeamCompliant(season.id, checkCompliance.playerId, checkCompliance.pokemon);
    await assertNoSuspendedLinesInTeam(season.id, checkCompliance.playerId, round.round_number, checkCompliance.pokemon);
  }

  const ruleset = await loadPinnedRuleset(phase.ruleset_id);

  const format = season.format_type === 'custom' ? await getSeasonFormat(season.id) : null;
  if (season.format_type === 'custom' && !format) {
    throw new UserFacingError(seasonErrors.format_not_attached, { code: 'format_not_attached', status: 409 });
  }
  if (format && format.season_id !== season.id) throw staleFormat();
  let stage;
  if (format?.engine === 'kit') {
    if (phase.format_stage_key === null) throw staleFormat();
    try {
      stage = await stageOf({ ...phase, format_stage_key: phase.format_stage_key });
    } catch (error) {
      if (!(error instanceof KitStageSpecError)) throw error;
      logger.error('phase/match-prep', 'Cannot read the materialized Kit stage', { phaseId: phase.id, error });
      throw staleFormat();
    }
    if (stage.key !== phase.format_stage_key) throw staleFormat();
  }

  const kit = format && stage && (stage.constraints?.length || format.spec.domains?.length || format.spec.resources?.length)
    ? { format, stage, round: round.round_number } : null;
  return { ruleset, season, kit };
}

async function evaluateTeamPolicy(
  { ruleset, season, kit }: Awaited<ReturnType<typeof loadTeamPolicy>>,
  playerId: string,
  pokemon: PokemonSet[],
): Promise<TeamValidationResult> {
  const input = { pokemon, ruleset, playerId, seasonId: season.id, season };
  if (!kit) return checkTeam(input);
  const { format, stage, round } = kit;
  const [base, runtime] = await Promise.all([checkTeam(input), getFormatRuntime(season.id)]);
  const { state, tunableIssues } = buildRuntimeState(format.spec, runtime, {
    tunables: format.tunables as Json,
    amendments: format.amendments as Json,
  });
  const members = resolveTeamMembers(pokemon, ruleset.gen, ruleset.rules.universe === 'national');
  const issues = evaluateConstraints({
    constraints: stage.constraints ?? [], def: format.spec, state, seed: format.seed,
    playerId, round, members,
  });
  const failedExpressions = issues.filter(issue => issue.code === 'kit_constraint_expr');
  if (tunableIssues.length || failedExpressions.length) {
    throw Object.assign(staleFormat(), { cause: { tunableIssues, failedExpressions } });
  }
  return mergeConstraintIssues(base, issues, members);
}

export async function validateNativeMatchPrep(owner: PhaseOwner, matchId: string, player: SessionPlayer, pokemon: PokemonSet[]) {
  const scope = await loadScope(owner, matchId, player);
  if (!scope.playerIds.includes(player.playerId)) {
    return checkTeam({ pokemon, ruleset: await loadPinnedRuleset(scope.phase.ruleset_id) });
  }
  return evaluateTeamPolicy(await loadTeamPolicy(scope), player.playerId, pokemon);
}

async function checkNativeTeam(
  scope: Awaited<ReturnType<typeof loadScope>>,
  playerId: string,
  pokemon: PokemonSet[],
  showAdvisory: boolean,
): Promise<KitTeamAdvisory> {
  const policy = await loadTeamPolicy(scope, { playerId, pokemon });
  if (!showAdvisory || !policy.kit) return {};
  try {
    const verdict = await evaluateTeamPolicy(policy, playerId, pokemon);
    return verdict.valid ? {} : { team_check: { status: 'unmet', verdict } };
  } catch (error) {
    logger.error('phase/match-prep', 'Team advisory could not be computed', { phaseId: scope.phase.id, playerId, error });
    return { team_check: { status: 'unavailable' } };
  }
}

export async function saveNativeMatchPrep(owner: PhaseOwner, player: SessionPlayer, body: MatchPrepInput) {
  const scope = await loadScope(owner, body.match_id.toLowerCase(), player);
  const { match, phase, playerIds } = scope;
  if (match.status === 'completed' && !player.isAdmin) {
    throw new UserFacingError(teamErrors.match_prep_match_completed, { code: 'match_prep_match_completed', status: 409 });
  }
  const playerId = player.isAdmin && body.player_id ? body.player_id.toLowerCase() : player.playerId;
  if (!playerIds.includes(playerId)) {
    throw new UserFacingError(teamErrors.match_prep_target_not_participant, { code: 'match_prep_target_not_participant', status: 400 });
  }

  const pokemon: PokemonSet[] = body.pokemon;
  const advisory = await checkNativeTeam(scope, playerId, pokemon, match.status !== 'completed' && playerId === player.playerId);
  const team = await writePhaseTeam({
    p_operation: 'match_prep', p_phase_id: phase.id, p_match_id: match.id, p_player_id: playerId,
    p_actor: player.isAdmin ? 'admin' : 'participant', p_pokemon: pokemon as unknown as Json,
    p_import_source: body.import_source,
  }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'message' in error && error.message === 'phase_storage_not_ready') {
      throw Object.assign(new UserFacingError(commonErrors.phase_storage_unavailable, { code: 'phase_storage_unavailable', status: 503 }), { cause: error });
    }
    throw error;
  });

  try {
    expirePhaseReads(phase.id, owner.season_id);
    if (team && match.status === 'completed') {
      expirePublicTags([
        publicTags.aggregates('phase', phase.id),
        publicTags.aggregates('league', owner.season_id),
        publicTags.aggregates('all_time', null),
      ]);
    }
  } catch (error) {
    logger.error('phase/match-prep', 'Could not expire cached reads after saving prep', { phaseId: phase.id, matchId: match.id, error });
  }
  const prep = await getPlayerPhaseMatchPrep(match.id, playerId);
  if (!prep) throw new TeamChangedError();
  return { prep, ...advisory };
}
