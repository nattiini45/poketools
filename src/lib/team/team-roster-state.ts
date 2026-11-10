import { defineMachine } from '@/lib/state-machine/machine';

/**
 * Write locks of a team's roster (`teams.pokemon`, `name`, `import_source`, and the row itself), as one machine.
 *
 * The lock state is not stored: it is derived from the row and its context on every write (`teamLockState`), in this
 * order of precedence:
 *
 * 1. `locked`: the manual flag `teams.locked` (no code path sets it today; a row restored from the recycle bin keeps
 *    its flag).
 * 2. `closed` / `closed_planned`: the team's tournament is completed or archived, or its league is completed or
 *    archived (`teamWritesClosed`), and the team is linked to a match (`closed`) or to none (`closed_planned`).
 * 3. `match_completed`: the team is linked to a completed match (`isCompletedMatchLocked`; the database enforces it
 *    as well, trigger `teams_completed_match_lock`).
 * 4. `open`.
 *
 * Every write is a transition: an edit is a self-loop, a delete moves to `deleted`. The actors are the team's
 * `owner` (teambuilder: `PATCH` / `DELETE /api/teams/[id]`), a match `participant` saving the registered team of one
 * of their matches (`POST /api/match-prep`, which checks the match but not the closure) and a site `admin` (every
 * admin write is a correction through `team_correct_update` / `team_correct_delete`).
 *
 * Client-safe: the dashboard team page derives whether the editor opens read-only from it.
 */

export type TeamLockState = 'open' | 'match_completed' | 'closed' | 'closed_planned' | 'locked';
export type TeamRosterActor = 'owner' | 'participant' | 'admin';
export type TeamWriteOp = 'edit' | 'delete';

/** Why a tournament takes no more team writes from its players (`teamWritesClosed`). */
export type TeamClosure = 'tournament_completed' | 'tournament_archived' | 'league_closed';

const CORRECTION_SQL = 'supabase/migrations/20261019120000_teams_completed_match_lock.sql';
const ID_ROUTE = 'src/app/api/teams/[id]/route.ts';
const MATCH_PREP_ROUTE = 'src/app/api/match-prep/route.ts';
const QUERIES = 'src/lib/supabase/queries/teams.ts';

export const teamRosterMachine = defineMachine({
  id: 'team.roster',
  title: 'Team roster write locks',
  storage:
    'derived: teams.locked, teams.match_id -> matches.status, teams.tournament_id -> tournaments.status/archived -> seasons.status/archived',
  summary:
    'Whether a team row may still be edited or deleted, and by whom. The lock is derived on every write from the manual flag teams.locked (no code path sets it today), the closure of its tournament or league (completed or archived) and the status of its linked match, in that order of precedence (teamLockState), so every lock state is an initial state and only the writes themselves are transitions (an edit is a self-loop). Routes ask resolveTeamWriteVerdict, which reads only the facts that can still change the answer. A refusal answers 409 team_locked, 403 with the closure code (team_submission_closed, team_submission_tournament_archived, team_submission_league_closed) or 409 team_match_completed. Creating a team (POST /api/teams) is gated by the closure before any row exists and is not part of this machine. teams.is_draft_team and teams.draft_pool_id are written by no code path and take part in no lock.',
  doc: 'docs/teambuilder-reference.md',
  states: ['open', 'match_completed', 'closed', 'closed_planned', 'locked', 'deleted'],
  initial: ['open', 'match_completed', 'closed', 'closed_planned', 'locked'],
  terminal: ['deleted'],
  actors: ['owner', 'participant', 'admin'],
  transitions: [
    {
      event: 'edit',
      from: ['open'],
      to: 'open',
      actors: ['owner', 'participant', 'admin'],
      writers: [ID_ROUTE, MATCH_PREP_ROUTE, QUERIES],
      note: 'The UPDATE is guarded with locked = false; a row locked or deleted in between answers 409 team_changed.',
    },
    {
      event: 'correct',
      from: ['match_completed'],
      to: 'match_completed',
      actors: ['admin'],
      writers: [ID_ROUTE, MATCH_PREP_ROUTE, `${CORRECTION_SQL}#team_correct_update`],
      note: 'Only an admin correction passes the teams_completed_match_lock trigger; the owner gets 409 team_match_completed, a participant 409 match_prep_match_completed.',
    },
    {
      event: 'edit_closed',
      from: ['closed'],
      to: 'closed',
      actors: ['participant', 'admin'],
      writers: [MATCH_PREP_ROUTE, ID_ROUTE, `${CORRECTION_SQL}#team_correct_update`],
      note: 'The owner gets 403 with the closure code; match prep does not read the closure, so a participant may still save the team of a match that is not completed.',
    },
    {
      event: 'correct_planned',
      from: ['closed_planned'],
      to: 'closed_planned',
      actors: ['admin'],
      writers: [ID_ROUTE, `${CORRECTION_SQL}#team_correct_update`],
      note: 'A planned team (no match) of a closed tournament or league; the owner gets 403 with the closure code.',
    },
    {
      event: 'delete',
      from: ['open', 'closed_planned'],
      to: 'deleted',
      actors: ['owner', 'admin'],
      writers: [ID_ROUTE, QUERIES, `${CORRECTION_SQL}#team_correct_delete`],
      note: 'The owner may delete a planned team nobody played with even in a closed tournament; the DELETE is guarded with locked = false.',
    },
    {
      event: 'force_delete',
      from: ['match_completed', 'closed', 'locked'],
      to: 'deleted',
      actors: ['admin'],
      writers: [ID_ROUTE, QUERIES, `${CORRECTION_SQL}#team_correct_delete`],
      note: 'A site admin deletes any team as a correction.',
    },
  ],
});

/** The facts the lock is derived from. */
export interface TeamLockFacts {
  locked: boolean;
  /** `teams.match_id` is set. */
  linkedToMatch: boolean;
  /** The tournament's or league's closure, or null when open (or the team has no tournament). */
  closure: TeamClosure | null;
  /** The linked match is completed. */
  matchCompleted: boolean;
}

/** The lock state of a row, by precedence: manual lock, closure, completed match. */
export function teamLockState(facts: TeamLockFacts): TeamLockState {
  if (facts.locked) return 'locked';
  if (facts.closure) return facts.linkedToMatch ? 'closed' : 'closed_planned';
  if (facts.linkedToMatch && facts.matchCompleted) return 'match_completed';
  return 'open';
}

/** Whether `actor` may perform `op` on a row in `state`. */
export function canWriteTeam(state: TeamLockState, op: TeamWriteOp, actor: TeamRosterActor): boolean {
  return teamRosterMachine.can(state, op === 'delete' ? 'deleted' : state, actor);
}

export type TeamWriteVerdict = { ok: true } | { ok: false; state: TeamLockState; closure: TeamClosure | null };

/**
 * The verdict for one write, reading only the facts that can still change it. The manual lock comes from the row;
 * the closure and the match status are read, in precedence order, only while the states they decide between give
 * different answers for this actor and operation: a site admin's edit or delete reads nothing, and an owner's delete
 * of a team linked to no match reads nothing either (`open` and `closed_planned` both allow it).
 */
export async function resolveTeamWriteVerdict(input: {
  op: TeamWriteOp;
  actor: TeamRosterActor;
  locked: boolean;
  linkedToMatch: boolean;
  loadClosure: () => Promise<TeamClosure | null>;
  loadMatchCompleted: () => Promise<boolean>;
}): Promise<TeamWriteVerdict> {
  const { op, actor, locked, linkedToMatch } = input;
  const verdict = (state: TeamLockState, closure: TeamClosure | null): TeamWriteVerdict =>
    canWriteTeam(state, op, actor) ? { ok: true } : { ok: false, state, closure };
  const allowedInEvery = (states: TeamLockState[]) => states.every((s) => canWriteTeam(s, op, actor));

  if (locked) return verdict('locked', null);

  const unclosed: TeamLockState[] = linkedToMatch ? ['match_completed', 'open'] : ['open'];
  if (allowedInEvery([linkedToMatch ? 'closed' : 'closed_planned', ...unclosed])) return { ok: true };
  const closure = await input.loadClosure();
  if (closure) return verdict(linkedToMatch ? 'closed' : 'closed_planned', closure);

  if (allowedInEvery(unclosed)) return { ok: true };
  const matchCompleted = await input.loadMatchCompleted();
  return verdict(teamLockState({ locked, linkedToMatch, closure: null, matchCompleted }), null);
}
