import { z } from 'zod';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPhaseById, isPlayerPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getSeasonById, getParticipantCore } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getAgentPhaseHistory, getAgentPhasePrep } from '@/lib/supabase/queries/agent-player-context';
import { decideMatchRosterVisibility } from '@/lib/team/visibility';
import { agentResourceRefSchema, competitionRefSchema } from './resource-ref';

export const nativePlayerContextSchema = z.strictObject({
  generation: z.literal('native-phase-v1'),
  match: agentResourceRefSchema.options[2].extend({ owner: competitionRefSchema.options[1] }),
});
export type NativePlayerContext = z.output<typeof nativePlayerContextSchema>;

export async function authorizeNativePlayerMatch(input: unknown) {
  const context = nativePlayerContextSchema.parse(input);
  const { match: ref } = context;
  const player = await requirePlayer();
  const match = await getPhaseMatchById(ref.id);
  if (!match || match.id !== ref.id || match.phase_id !== ref.owner.phaseId ||
      (match.player_1_id !== player.playerId && match.player_2_id !== player.playerId)) {
    throw new Error('Native player match unavailable');
  }
  const [phase, round] = await Promise.all([getPhaseById(match.phase_id), getPhaseRoundById(match.round_id)]);
  if (!phase || phase.id !== match.phase_id || phase.season_id !== ref.owner.seasonId ||
      !round || round.id !== match.round_id || round.phase_id !== phase.id ||
      !await isPlayerPhaseParticipant(player.playerId, phase.id)) throw new Error('Native player phase unavailable');
  const season = await getSeasonById(phase.season_id);
  if (!season || season.id !== phase.season_id) throw new Error('Native player league unavailable');
  return { context, player, match, phase, round, season };
}

type Scope = Awaited<ReturnType<typeof authorizeNativePlayerMatch>>;

async function loadTeams({ player, match, phase, season }: Scope) {
  const opponentId = match.player_1_id === player.playerId ? match.player_2_id : match.player_1_id;
  const [prep, own, opponent] = await Promise.all([
    getAgentPhasePrep(match.id, player.playerId),
    getPlayerPhaseTeamForMatch(player.playerId, match),
    getPlayerPhaseTeamForMatch(opponentId, match),
  ]);
  const coherent = (team: typeof own, id: string) => team && team.player_id === id &&
    team.phase_id === phase.id && team.season_id === season.id &&
    (team.match_id === null || team.match_id === match.id);
  const ownPokemon = prep ?? (coherent(own, player.playerId) ? own!.pokemon : null);
  const visibleOpponent = coherent(opponent, opponentId) && decideMatchRosterVisibility(
    opponent!, { viewerId: player.playerId, isAdmin: false }, match, phase.team_visibility,
  );
  return { own: ownPokemon, opponent: visibleOpponent ? opponent!.pokemon : null };
}

async function loadHistory(scope: Scope, headToHead: boolean) {
  const { player, match, phase } = scope;
  const opponentId = match.player_1_id === player.playerId ? match.player_2_id : match.player_1_id;
  const history = await getAgentPhaseHistory(phase.id, player.playerId, headToHead ? opponentId : undefined);
  return { ...history, matches: history.matches.map(({ id, ...row }) => ({ ...row,
    ref: { resource: 'match' as const, owner: { kind: 'phase' as const, seasonId: phase.season_id, phaseId: phase.id }, id },
  })) };
}

export async function getNativePlayerHistory(input: unknown) {
  return loadHistory(await authorizeNativePlayerMatch(input), false);
}

export async function getNativePlayerHeadToHead(input: unknown) {
  return loadHistory(await authorizeNativePlayerMatch(input), true);
}

export async function getNativePlayerTeams(input: unknown) {
  return loadTeams(await authorizeNativePlayerMatch(input));
}

export async function buildNativePlayerContext(input: unknown) {
  const scope = await authorizeNativePlayerMatch(input);
  const { context, player, match, phase, round, season } = scope;
  const [ruleset, teams, history, headToHead, core] = await Promise.all([
    getRulesetById(phase.ruleset_id), loadTeams(scope), loadHistory(scope, false), loadHistory(scope, true),
    getParticipantCore(season.id, player.playerId),
  ]);
  if (!ruleset || ruleset.id !== phase.ruleset_id) throw new Error('Native pinned ruleset unavailable');
  return {
    generation: context.generation,
    match_ref: context.match,
    player_id: player.playerId,
    league: { id: season.id, name: season.name, description: season.description },
    phase: { id: phase.id, name: phase.name, description: phase.description, is_doubles: phase.is_doubles },
    round: { id: round.id, name: round.name, best_of: round.best_of },
    match: { status: match.status, scheduled_at: match.scheduled_at, player_1_id: match.player_1_id,
      player_2_id: match.player_2_id, player_1_name: match.player_1_name, player_2_name: match.player_2_name },
    ruleset: { id: ruleset.id, name: ruleset.name, base_format: ruleset.base_format,
      clauses: ruleset.clauses, bans: ruleset.bans, allow: ruleset.allow,
      additions: ruleset.additions, team_constraints: ruleset.team_constraints,
      custom_rules_string: ruleset.custom_rules_string },
    player_core: core, teams, history, head_to_head: headToHead,
  };
}
