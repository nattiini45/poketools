import 'server-only';
/**
 * The server side of the start-up checklist (`startup-checklist.ts`, which stays pure and client-safe): the loader that
 * assembles `StartupChecklistInput` from the database, for a read that has no browser to ask. The round manager assembles the
 * same input from its props (the admin page's reads plus the participant list the manager announces); this loader reads
 * the same things through the same query modules, so `buildStartupChecklist` answers the same for both:
 *
 *  - a standalone tournament pairs by its own groups (`groupsInUse` = it has groups) and mirrors no league groups;
 *  - a league phase also counts the league's groups (`groupsInUse` = the phase or the league has groups), and a Swiss or
 *    round robin phase of a league with groups places each player by the league membership (`leagueGroupOf`).
 *
 * One difference is deliberate: the manager first re-syncs a phase's roster from the standings of the previous phase on
 * load (a write). This read never writes; it sees the roster as stored.
 *
 * The assistant fingerprints `startupChecklistState` before a start or a bracket and refuses a start the checklist blocks
 * (`proposals/golive.ts`).
 */
import type { JsonValue } from '@/lib/studio-core/json';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonGroupMembership, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getParticipants, getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import type { Round } from '@/types/round';
import type { BracketType, TournamentWithDetails } from '@/types/tournament';
import type { StartupChecklist, StartupChecklistInput } from './startup-checklist';

/** What the checklist is built from, as the queries return it. */
export interface StartupSources {
  tournament: Pick<TournamentWithDetails, 'bracket_type' | 'status' | 'ruleset_id' | 'ruleset_name' | 'best_of_default' | 'season_id'>;
  rounds: readonly Pick<Round, 'name' | 'round_number' | 'status' | 'bracket_side'>[];
  /** The roster as stored: the player id and the seed. */
  participants: ReadonlyArray<{ id: string; seed: number | null }>;
  /** The tournament's own groups. */
  groupCount: number;
  /** The league's groups (`false` for a standalone tournament). */
  leagueHasGroups: boolean;
  /** Player id to league group id, read only for a Swiss or round robin phase of a league with groups. */
  leagueGroupOf: Readonly<Record<string, string>> | null;
}

/** Whether a phase pairs within league groups and so needs the membership read. */
export const needsLeagueMembership = (bracketType: BracketType, leagueHasGroups: boolean): boolean =>
  leagueHasGroups && (bracketType === 'swiss' || bracketType === 'round_robin');

/** The pure assembly: the same fields the admin pages hand to the round manager. */
export function assembleStartupInput(sources: StartupSources): StartupChecklistInput {
  const { tournament, participants } = sources;
  return {
    bracketType: tournament.bracket_type,
    tournamentStatus: tournament.status,
    rulesetSet: Boolean(tournament.ruleset_id),
    rulesetName: tournament.ruleset_name,
    bestOfDefault: tournament.best_of_default,
    participants: {
      count: participants.length,
      seededCount: participants.filter((row) => row.seed !== null).length,
      playerIds: participants.map((row) => row.id),
    },
    rounds: sources.rounds,
    groupsInUse: sources.groupCount > 0 || sources.leagueHasGroups,
    leagueGroupOf: needsLeagueMembership(tournament.bracket_type, sources.leagueHasGroups) ? sources.leagueGroupOf : null,
  };
}

/** Reads what the checklist needs for one tournament or league phase; `null` when there is none. */
export async function loadStartupInput(tournamentId: string): Promise<StartupChecklistInput | null> {
  const tournament = await getTournamentWithDetails(tournamentId);
  if (tournament === null) return null;
  const [rounds, participants, groups, leagueHasGroups] = await Promise.all([
    getRoundsByTournament(tournament.id),
    getParticipants(tournament.id),
    getGroupsByTournament(tournament.id),
    tournament.season_id === null ? Promise.resolve(false) : seasonHasGroups(tournament.season_id),
  ]);
  const leagueGroupOf =
    tournament.season_id !== null && needsLeagueMembership(tournament.bracket_type, leagueHasGroups) ? await getSeasonGroupMembership(tournament.season_id) : null;
  return assembleStartupInput({ tournament, rounds, participants, groupCount: groups.length, leagueHasGroups, leagueGroupOf });
}

/**
 * The fingerprint state of a checklist: every item with its state and values, in the checklist's own order. Links are
 * presentation and not part of it.
 */
export function startupChecklistState(checklist: StartupChecklist): JsonValue {
  return {
    blocked: checklist.blocked,
    items: checklist.items.map((item) => ({ id: item.id, state: item.state, params: { ...item.params } })),
  };
}
