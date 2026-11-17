import { defineMachine } from '@/lib/state-machine/machine';
import { tournamentMachine } from '@/lib/tournament/tournament-state';

export const phaseMachine = defineMachine({
  id: 'league_phase',
  title: 'League phase',
  storage: 'league_phases.status (enum phase_status)',
  summary: 'A phase-owned competition starts, completes and reopens through the same pure lifecycle rules as a standalone tournament. Its writers use only phase-owned persistence; the native path stays dormant until cutover.',
  doc: 'docs/phase-separation.md',
  states: tournamentMachine.spec.states,
  initial: tournamentMachine.spec.initial,
  terminal: tournamentMachine.spec.terminal,
  actors: tournamentMachine.spec.actors,
  transitions: tournamentMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: transition.event === 'regenerate_bracket'
      ? ['src/lib/supabase/queries/phase-rounds.ts', 'supabase/migrations/20261117110000_phase_lifecycle.sql#phase_bracket_write']
      : ['src/lib/supabase/queries/league-phases.ts', 'supabase/migrations/20261117110000_phase_lifecycle.sql'],
    note: 'The native writer checks the expected current state under the phase lock; no tournament mechanics row is used.',
  })),
});

export type PhaseActor = (typeof phaseMachine.spec.actors)[number];
