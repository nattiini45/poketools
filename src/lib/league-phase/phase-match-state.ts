import { defineMachine } from '@/lib/state-machine/machine';
import { matchMachine } from '@/lib/tournament/match-state';

export const phaseMatchMachine = defineMachine({
  ...matchMachine.spec,
  id: 'phase_match',
  title: 'League phase match',
  storage: 'phase_matches.status with confirmed_at, auto_confirm_at, date_played and finalized_at',
  transitions: matchMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: [
      'src/lib/supabase/queries/phase-matches.ts',
      ...(transition.event === 'forfeit'
        ? ['supabase/migrations/20261117127000_phase_format_cron.sql#phase_format_forfeit_complete']
        : []),
    ],
  })),
});

export type PhaseMatchActor = (typeof phaseMatchMachine.spec.actors)[number];
