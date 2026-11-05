import 'server-only';

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import type { ApiError } from '@/types/api';
import type { Ruleset } from '@/types/ruleset';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

/** The slice of a tournament row the gate reads (`getTournamentById`). */
export interface KitTeamGateTournament {
  id: string;
  season_id: string | null;
  season_format_type?: string | null;
}

export interface KitTeamGateInput {
  /** The phase row the caller has read, or its id (read here). */
  tournament: KitTeamGateTournament | string;
  playerId: string;
  pokemon: PokemonSet[];
  /** The round the team is for; omitted = the phase's latest round (1 before it has one). */
  roundNumber?: number;
  /** The phase's pinned ruleset when the caller has read it. */
  ruleset?: Ruleset | null;
}

/** Only a custom league can run the kit engine, so any other league needs no read at all. */
export function isKitTeamCandidate(tournament: KitTeamGateTournament | null | undefined): tournament is KitTeamGateTournament & { season_id: string } {
  return tournament != null && tournament.season_id !== null && tournament.season_format_type === 'custom';
}

/**
 * The 400 for a team that breaks the rules of a kit league: the English texts in `error`, the whole verdict in
 * `team_check` so a client can render each issue by its code.
 */
export function kitTeamRefusal(result: TeamValidationResult, context: Record<string, string>): NextResponse<ApiError> {
  const texts = [...result.team_issues, ...result.issues.filter((i) => i.severity === 'error').map((i) => `${i.species}: ${i.issue}`)];
  const issues = texts.join(' | ');
  logger.warn('api/team-check', 'Team refused by the league rules', { ...context, issues });
  return NextResponse.json<ApiError>(
    {
      success: false,
      error: `This team does not meet the rules of this league: ${issues}`,
      code: 'team_check_failed',
      params: { issues },
      team_check: result,
    },
    { status: 400 },
  );
}

/** The merged verdict of a kit phase for a team, or null when the phase is not a kit phase with rules to check. */
export async function kitTeamVerdict(input: KitTeamGateInput): Promise<TeamValidationResult | null> {
  const tournament = typeof input.tournament === 'string' ? await getTournamentById(input.tournament) : input.tournament;
  if (!isKitTeamCandidate(tournament)) return null;
  const roundNumber = input.roundNumber ?? (await currentPhaseRound(tournament.id));
  const { applies, result } = await evaluateTeam({
    seasonId: tournament.season_id,
    phaseId: tournament.id,
    playerId: input.playerId,
    roundNumber,
    pokemon: input.pokemon,
    ...(input.ruleset !== undefined ? { ruleset: input.ruleset } : {}),
  });
  return applies ? result : null;
}

/** The refusal response for a kit phase whose rules the team breaks, else null (not a kit phase, or the team passes). */
export async function refuseInvalidKitTeam(input: KitTeamGateInput): Promise<NextResponse<ApiError> | null> {
  const result = await kitTeamVerdict(input);
  if (result === null || result.valid) return null;
  return kitTeamRefusal(result, { tournamentId: typeof input.tournament === 'string' ? input.tournament : input.tournament.id, playerId: input.playerId });
}
