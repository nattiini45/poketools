import { defineMachine } from '@/lib/state-machine/machine';
import { roundMachine } from '@/lib/tournament/round-state';

export const phaseRoundMachine = defineMachine({
  id: 'phase_round',
  title: 'League phase round',
  storage: 'phase_rounds.status (enum round_status)',
  summary: 'A native phase round shares the pure pending, active and completed transition rules with a tournament round. Completion checks the phase-owned matches under the round lock; every update compares the current state.',
  doc: 'docs/phase-separation.md',
  states: roundMachine.spec.states,
  initial: roundMachine.spec.initial,
  terminal: roundMachine.spec.terminal,
  actors: roundMachine.spec.actors,
  transitions: roundMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: ['src/lib/supabase/queries/phase-rounds.ts',
      transition.event === 'reset' ? 'supabase/migrations/20261118113000_phase_round_reset_finish.sql'
        : 'supabase/migrations/20261117110000_phase_lifecycle.sql'],
    note: 'The native round writer uses phase_rounds and phase_matches only and retains the current-state guard.',
  })),
});

export type PhaseRoundActor = (typeof phaseRoundMachine.spec.actors)[number];
