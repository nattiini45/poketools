import type { SeasonStatus } from '@/types/season';
import type { TournamentStatus } from '@/types/tournament';

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
