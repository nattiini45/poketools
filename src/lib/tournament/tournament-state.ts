import { defineMachine } from '@/lib/state-machine/machine';
import type { TournamentStatus } from '@/types/tournament';

/**
 * The status of a standalone tournament or of a league phase (a tournament with `season_id`): docs/state-machines.md,
 * ADR 0004. Admin moves go through `updateTournamentWithStatus` (src/lib/tournament/tournament-transition.ts), which
 * checks this table, writes with a compare-and-set on the status it read and runs the format reaction, the auto advance
 * and the completion announcement for both PATCH routes. The SQL writers keep their own guards;
 * `src/lib/tournament/__tests__/tournament-machine-sql-parity.test.ts` holds them equal to the system moves here.
 */
export const tournamentMachine = defineMachine({
  id: 'tournament',
  title: 'Tournament and league phase',
  storage: 'tournaments.status (enum tournament_status)',
  summary:
    'A standalone tournament or a league phase from set-up to its result. The first round (or the bracket) starts it; an admin, or the format at a stage end, completes it; an admin may reopen it. Re-sending the current status (active or completed) through the admin route is no move: it replays the format reaction. Nothing moves a phase back to upcoming.',
  doc: 'docs/tournament.md',
  states: ['upcoming', 'active', 'completed'],
  initial: ['upcoming'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'start',
      from: ['upcoming'],
      to: 'active',
      actors: ['admin', 'system'],
      writers: [
        'supabase/migrations/20261106090000_format_challenges.sql#round_write',
        'src/lib/tournament/bracket-generate.ts',
        'src/lib/tournament/tournament-transition.ts',
        'src/lib/dev-seed/seed.ts',
      ],
      note: 'The first round written (round_write, in the same transaction) or the bracket generated; an admin PATCH may also set it. Fires the format stage_start.',
    },
    {
      event: 'complete',
      from: ['active'],
      to: 'completed',
      actors: ['admin', 'system'],
      writers: [
        'src/lib/tournament/tournament-transition.ts',
        'supabase/migrations/20261106090000_format_challenges.sql#phase_complete_at_stage_end',
      ],
      note: 'Mark completed, or the format at a stage end (only while no unseen match is unfinished). Fires stage_end, the auto advance and the tournament_completed announcement.',
    },
    {
      event: 'complete',
      from: ['upcoming'],
      to: 'completed',
      actors: ['admin'],
      writers: ['src/lib/tournament/tournament-transition.ts'],
      note: 'Mark completed on a phase or tournament that never started (the admin page offers it).',
    },
    {
      event: 'reopen',
      from: ['completed'],
      to: 'active',
      actors: ['admin'],
      writers: ['src/lib/tournament/tournament-transition.ts'],
      note: 'Writes the status only: matches, results and standings are kept; completing again announces again.',
    },
    {
      event: 'regenerate_bracket',
      from: ['completed'],
      to: 'active',
      actors: ['system'],
      writers: ['src/lib/tournament/bracket-generate.ts'],
      note: 'Regenerating the bracket of a completed tournament or non-format phase restarts it (the regenerate route refuses a completed format phase).',
    },
  ],
});

export type TournamentActor = (typeof tournamentMachine.spec.actors)[number];

/** Whether a tournament or phase has not started yet: its structure (order, deletion) is still free to change. */
export function isTournamentUnstarted(status: TournamentStatus): boolean {
  return tournamentMachine.spec.initial.includes(status);
}

/** Whether `actor` may perform `event` from `status`: what the admin UI offers. */
export function canTournamentEvent(status: TournamentStatus, event: 'start' | 'complete' | 'reopen', actor: TournamentActor): boolean {
  return tournamentMachine.transitionsFrom(status, actor).some((t) => t.event === event);
}
