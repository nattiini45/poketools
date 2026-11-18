import 'server-only';
import { UserFacingError } from '@/lib/api/user-facing-error';
import aiErrors from '@/i18n/messages/errors/ai/en';
import { getPhaseById, getPhasesBySeasonId } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseGamesByMatch, getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getPhasePlayerPrepTeam } from '@/lib/supabase/queries/phase-ai-artifacts';
import { getSeasonById, getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getAggregates, getTotalGamesInScope, getTotalGamesInMixedScope } from '@/lib/supabase/queries/aggregates';
import { assertValidUuid } from '@/lib/utils/uuid';
import { fetchReplay } from '@/lib/pkmn/replay';
import { extractBattleFrames } from '@/lib/pkmn/replay-frames';
import { decideMatchRosterVisibility } from '@/lib/team/visibility';
import { logger } from '@/lib/logger';
import { getTeamTypeAnalysis } from '@/lib/pkmn/dex';
import { renderCoreAssignments } from './league-context';
import { parseGenFromFormat } from './format';
import { buildSystemPrompt, buildScoutingSystemPrompt, buildRulesetSection, buildMetaSection,
  buildTeamSection, buildBattleStatsSection, buildOpponentHistorySection, buildCondensedFrameSection,
  buildTypeAnalysisSection, extractSpeciesFromContext } from './context-builder';
import { withOutputLanguage } from './language';

export async function loadPhaseRoundScope(phaseId: string, roundId: string) {
  assertValidUuid(phaseId);
  assertValidUuid(roundId);
  const [phase, round] = await Promise.all([getPhaseById(phaseId), getPhaseRoundById(roundId)]);
  if (!phase) throw new Error('Phase not found');
  if (!round || round.phase_id !== phaseId) throw new Error('Round not found in phase');
  const [season, ruleset] = await Promise.all([getSeasonById(phase.season_id), getRulesetById(phase.ruleset_id)]);
  if (!season) throw new Error('Phase league not found');
  if (!ruleset) throw new Error('Pinned phase ruleset not found');
  return { phase, round, season, ruleset, gen: parseGenFromFormat(ruleset.base_format) };
}

export async function loadPhaseMatchScope(phaseId: string, matchId: string) {
  assertValidUuid(phaseId);
  assertValidUuid(matchId);
  const match = await getPhaseMatchById(matchId);
  if (!match || match.phase_id !== phaseId) throw new Error('Match not found in phase');
  return { ...await loadPhaseRoundScope(phaseId, match.round_id), match };
}

async function phaseSections(scope: Awaited<ReturnType<typeof loadPhaseMatchScope>>, scouting = false) {
  const { phase, season, ruleset, gen, match, round } = scope;
  const [participants, aggregates, total] = await Promise.all([
    getPublicSeasonParticipants(season.id), getAggregates(scouting ? 'league' : 'phase', scouting ? season.id : phase.id),
    scouting ? getTotalGamesInMixedScope('league', season.id) : getTotalGamesInScope('phase', phase.id),
  ]);
  const sides = [match.player_1_id, match.player_2_id].map(id => participants.find(p => p.id === id));
  return [
    `## LEAGUE CONTEXT\nLeague: ${season.name}\n${season.description ?? ''}`,
    ...sides.filter(p => p?.gym_type).map(p => `Gym Leader Typings: ${p!.name}: ${p!.gym_type}`),
    ...renderCoreAssignments(sides.flatMap(p => p ? [{ name: p.name, core: p.core_types }] : [])),
    `## PHASE CONTEXT\nPhase: ${phase.name}\n${phase.description}\nRound: ${round.name} | Best of ${round.best_of}`,
    buildRulesetSection(ruleset, phase.is_doubles, gen), buildMetaSection(aggregates, total, scouting),
  ];
}

export async function gatherPhaseMatchContext(phaseId: string, matchId: string) {
  const scope = await loadPhaseMatchScope(phaseId, matchId);
  const { match, gen } = scope;
  const sections = await phaseSections(scope);
  const [games, stats] = await Promise.all([getPhaseGamesByMatch(matchId), getPhaseBattleStatsByMatch(matchId)]);
  sections.push(`## MATCH: ${match.player_1_name} vs ${match.player_2_name}\nWinner: ${match.winner_name ?? 'TBD'}`);
  const teams = await Promise.all([match.player_1_id, match.player_2_id].map(id => getPlayerPhaseTeamForMatch(id, match)));
  teams.forEach((team, i) => {
    const visible = team && decideMatchRosterVisibility(team, { viewerId: null, isAdmin: false }, match, scope.phase.team_visibility);
    const name = i === 0 ? match.player_1_name : match.player_2_name;
    const id = i === 0 ? match.player_1_id : match.player_2_id;
    if (visible) sections.push(buildTeamSection(name, team.pokemon));
    const species = extractSpeciesFromContext(stats, id, visible ? team.pokemon : undefined);
    if (species.length) sections.push(buildTypeAnalysisSection(name, getTeamTypeAnalysis(species, gen)));
  });
  for (const game of games) {
    sections.push(`## GAME ${game.game_number}\nWinner: ${game.winner_id === match.player_1_id ? match.player_1_name : game.winner_id === match.player_2_id ? match.player_2_name : 'Unknown'}`);
    for (const [id, name] of [[match.player_1_id, match.player_1_name], [match.player_2_id, match.player_2_name]]) {
      sections.push(buildBattleStatsSection(name, (stats[game.id] ?? []).filter(s => s.player_id === id)));
    }
    if (game.replay_url && game.source === 'ps_replay') {
      try {
        const replay = await fetchReplay(game.replay_url);
        sections.push(buildCondensedFrameSection(extractBattleFrames(replay.log)));
      } catch (error) {
        logger.warn('ai/phase-context', 'Replay frames unavailable; using stored battle stats', { error, gameId: game.id });
      }
    }
  }
  return { context: sections.join('\n'), gen, locale: scope.season.language === 'en' ? 'en' as const : 'de' as const };
}

export async function buildPhaseMatchAnalysisPrompt(phaseId: string, matchId: string) {
  const { context, gen, locale } = await gatherPhaseMatchContext(phaseId, matchId);
  return { systemPrompt: withOutputLanguage(buildSystemPrompt(gen), locale), userPrompt: context };
}

export async function gatherPhaseMatchPrepContext(
  phaseId: string, matchId: string, playerId: string, options?: { scheduledOnly: boolean },
) {
  const scope = await loadPhaseMatchScope(phaseId, matchId);
  const { match, gen } = scope;
  if (playerId !== match.player_1_id && playerId !== match.player_2_id) throw new Error('Scouting perspective must be a match participant');
  if (options?.scheduledOnly && match.status !== 'scheduled') {
    throw new UserFacingError(aiErrors.ai_scouting_scheduled_only.replace('{status}', match.status),
      { code: 'ai_scouting_scheduled_only', params: { status: match.status } });
  }
  const opponentId = playerId === match.player_1_id ? match.player_2_id : match.player_1_id;
  const ownName = playerId === match.player_1_id ? match.player_1_name : match.player_2_name;
  const opponentName = playerId === match.player_1_id ? match.player_2_name : match.player_1_name;
  const sections = await phaseSections(scope, true);
  sections.push(`## UPCOMING MATCH: ${ownName} (you) vs ${opponentName}`);
  const history = (await getMatchesByPhase(phaseId)).filter(m => m.phase_id === phaseId && m.status === 'completed' &&
    m.id !== matchId && (m.player_1_id === opponentId || m.player_2_id === opponentId));
  const historyStats = await Promise.all(history.map(m => getPhaseBattleStatsByMatch(m.id)));
  const opponentStats = historyStats.flatMap(s => Object.values(s).flat()).filter(s => s.player_id === opponentId);
  if (opponentStats.length < 3) {
    const siblings = (await getPhasesBySeasonId(scope.season.id)).filter(p => p.id !== phaseId);
    const siblingMatches = (await Promise.all(siblings.map(p => getMatchesByPhase(p.id)))).flat()
      .filter(m => m.status === 'completed' && (m.player_1_id === opponentId || m.player_2_id === opponentId));
    const siblingStats = await Promise.all(siblingMatches.map(m => getPhaseBattleStatsByMatch(m.id)));
    opponentStats.push(...siblingStats.flatMap(s => Object.values(s).flat()).filter(s => s.player_id === opponentId));
  }
  sections.push(buildOpponentHistorySection(opponentName, opponentStats));
  const prep = await getPhasePlayerPrepTeam(phaseId, matchId, playerId);
  const own = prep?.pokemon.length ? prep : await getPlayerPhaseTeamForMatch(playerId, match);
  if (own) {
    sections.push(buildTeamSection(`${ownName} (you)`, own.pokemon));
    if (own.pokemon.length) sections.push(buildTypeAnalysisSection(`${ownName} (you)`, getTeamTypeAnalysis(own.pokemon.map(p => p.species), gen)));
  }
  let opponentSpecies = [...new Set(opponentStats.map(s => s.pokemon_name))];
  if (match.status === 'completed') {
    const opponent = await getPlayerPhaseTeamForMatch(opponentId, match);
    if (opponent) {
      sections.push(buildTeamSection(opponentName, opponent.pokemon));
      opponentSpecies = opponent.pokemon.map(p => p.species);
    }
  }
  if (opponentSpecies.length) sections.push(buildTypeAnalysisSection(opponentName, getTeamTypeAnalysis(opponentSpecies, gen)));
  return { context: sections.join('\n'), gen, hasUserTeam: Boolean(prep?.pokemon.length),
    locale: scope.season.language === 'en' ? 'en' as const : 'de' as const };
}

export async function buildPhaseMatchPrepPrompt(
  phaseId: string, matchId: string, playerId: string, options?: { scheduledOnly: boolean },
) {
  const { context, gen, hasUserTeam, locale } = await gatherPhaseMatchPrepContext(phaseId, matchId, playerId, options);
  return { systemPrompt: withOutputLanguage(buildScoutingSystemPrompt(gen), locale), userPrompt: context, hasUserTeam };
}
