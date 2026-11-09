import { defineMachine } from '@/lib/state-machine/machine';
import type { SeasonStatus } from '@/types/season';
import type { TournamentStatus } from '@/types/tournament';

/**
 * The status of a league (`seasons.status`): docs/state-machines.md, ADR 0004. The admin status control
 * (LeagueStatusControl) and the admin agent's propose_league_status offer every status from every status, so every admin
 * move is legal; the admin route writes it as a compare-and-set on the status it read. The system starts an upcoming
 * league when its first round or bracket is written (`startSeasonIfUpcoming`), guarded on `upcoming` so an admin's
 * move in between wins. The database adds one rule: a custom league without an attached format cannot become active
 * (trigger `trg_seasons_require_attached_format`, 409 FORMAT_NOT_ATTACHED).
 */
export const seasonMachine = defineMachine({
  id: 'season',
  title: 'League',
  storage: 'seasons.status (enum season_status)',
  summary:
    'A league from set-up to its end. The first round or bracket of a phase starts it; an admin sets any status from the status control. Nothing completes a league automatically, and a completed league leaves its phases as they are. Closed (isSeasonClosed) means completed or archived.',
  doc: 'docs/season.md',
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
        'src/app/api/seasons/[id]/route.ts',
        'src/lib/season/start-season.ts',
        'src/lib/dev-seed/seed.ts',
      ],
      note: 'The first round (generate-round) or bracket (generate-bracket) of a phase, as a compare-and-set on upcoming; or the admin status control. A custom league needs an attached format (FORMAT_NOT_ATTACHED).',
    },
    {
      event: 'complete',
      from: ['upcoming', 'active'],
      to: 'completed',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/route.ts'],
      note: 'The admin closes the league; its phases keep their status.',
    },
    {
      event: 'reopen',
      from: ['completed'],
      to: 'active',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/route.ts'],
    },
    {
      event: 'reset',
      from: ['active', 'completed'],
      to: 'upcoming',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/route.ts'],
      note: 'Offered by the admin status control. A league with phases past upcoming or with rounds still counts as started (isSeasonStarted).',
    },
  ],
});

export type SeasonActor = (typeof seasonMachine.spec.actors)[number];

/**
 * Whether a league has started. Pure and client-safe. The SQL twin is `public.format_season_started()`
 * (`supabase/migrations/20261024100200_season_formats_and_stage_columns.sql`); keep the two rules in step.
 */
export interface SeasonStartSignals {
  status: SeasonStatus;
  /** One entry per phase of the league, with how many rounds the phase has. */
  phases: ReadonlyArray<{ status: TournamentStatus; rounds_total: number }>;
}

/**
 * A league has started when its status is active or completed, any phase has left `upcoming`, or any phase has at
 * least one round (this also covers a running league an admin flipped back to upcoming). Participants and draft
 * pools deliberately do not count.
 */
export function isSeasonStarted(signals: SeasonStartSignals): boolean {
  if (signals.status === 'active' || signals.status === 'completed') return true;
  return signals.phases.some((phase) => phase.status !== 'upcoming' || phase.rounds_total > 0);
}

/** A league that takes no more player writes: completed, or archived. */
export function isSeasonClosed(season: { status: SeasonStatus; archived: boolean }): boolean {
  return season.status === 'completed' || season.archived;
}
