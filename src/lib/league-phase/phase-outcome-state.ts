import { defineMachine } from '@/lib/state-machine/machine';
import { matchOutcomeMachine } from '@/lib/match/outcome-state';

export const phaseMatchOutcomeMachine = defineMachine({
  ...matchOutcomeMachine.spec,
  id: 'phase_match_outcome',
  title: 'League phase match outcome',
  storage: "phase_match_outcomes.kind with source = 'admin' (row absent = none)",
  transitions: matchOutcomeMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: transition.event === 'take_back'
      ? [
          'src/lib/match/outcome-takeback.ts',
          'src/lib/match/finalization-core.ts',
          'src/lib/supabase/queries/phase-match-outcomes.ts',
        ]
      : [
          'src/lib/match/finalization-core.ts',
          'src/lib/pkmn/game-pipeline.ts',
          'src/lib/supabase/queries/phase-match-outcomes.ts',
          'supabase/migrations/20261117120000_phase_match_game_pipeline.sql#phase_match_outcome_record',
        ],
  })),
});
