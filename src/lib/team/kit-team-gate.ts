/**
 * The team rules of a kit league as advice. A team write is never refused for them: the routes that save a team ask
 * `adviseKitTeam` for the verdict and return it next to the saved team (`team_check`), and the post-match audit
 * (`format-engine/runtime/team-audit-server.ts`) is where a played team that breaks the stage's constraints reaches an
 * admin. `kitTeamVerdict` is the raw verdict (the live validation route uses it as is).
 */
import 'server-only';

import { logger } from '@/lib/logger';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { currentPhaseRound, evaluateTeam } from '@/lib/format-engine/runtime/team-server';
import type { TeamCheckAdvisory } from '@/types/api';
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

/** What a team write tells the editor about the league's rules (the `team_check` field of the success envelope). */
export type KitTeamAdvisory = { team_check?: TeamCheckAdvisory };

/**
 * The advisory for a team write in a kit league: empty when the league has no team rules or the team meets them,
 * `unmet` with the whole verdict when it does not, `unavailable` when the verdict could not be computed. Never throws:
 * an advisory must not stop a save, and a failed read is logged with its original error and never reported as "meets
 * the rules".
 */
export async function adviseKitTeam(input: KitTeamGateInput, context: Record<string, string>): Promise<KitTeamAdvisory> {
  try {
    const verdict = await kitTeamVerdict(input);
    if (verdict === null || verdict.valid) return {};
    // Not logged: a strict stage produces this on every save (the logger has no debug level).
    return { team_check: { status: 'unmet', verdict } };
  } catch (error) {
    logger.error('api/team-check', 'Team advisory could not be computed', { ...context, error });
    return { team_check: { status: 'unavailable' } };
  }
}
