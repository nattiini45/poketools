import { defineMachine } from '@/lib/state-machine/machine';
import { gameEvolutionCreditMachine, gameEditLeaseMachine, gameStatsLockMachine } from '@/lib/match/game-marker-state';

export const phaseGameEvolutionCreditMachine = defineMachine({
  ...gameEvolutionCreditMachine.spec,
  id: 'phase_game.evolution_applied_at',
  title: 'Phase game evolution credit marker',
  storage: 'phase_games.evolution_applied_at + phase_games.evolution_credits',
  transitions: gameEvolutionCreditMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: [
      'src/lib/league-phase/epb-storage.ts',
      'src/lib/supabase/queries/phase-epb.ts',
      'src/lib/supabase/queries/evolutions.ts',
      `supabase/migrations/20261117124000_phase_epb_game_credits.sql#${
        transition.event === 'credit' ? 'phase_epb_credit_game_kills'
          : transition.event === 'uncredit' ? 'phase_epb_uncredit_game_kills'
            : 'phase_epb_sync_game_kill_credit'}`,
      ...(transition.event.startsWith('sync_')
        ? ['supabase/migrations/20261117124000_phase_epb_game_credits.sql#epb_sync_mixed_game_kill_credit']
        : []),
    ],
  })),
});

export const phaseGameEditLeaseMachine = defineMachine({
  ...gameEditLeaseMachine.spec,
  id: 'phase_game.edit_lease',
  title: 'Phase game edit lease',
  storage: 'phase_games.edit_lease_token + phase_games.edit_lease_until',
  transitions: gameEditLeaseMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: [
      'src/lib/supabase/queries/phase-games.ts',
      `supabase/migrations/20261117120000_phase_match_game_pipeline.sql${
        transition.event === 'claim' ? '#claim_phase_game_edit_lease'
          : transition.event === 'release' ? '#release_phase_game_edit_lease' : ''}`,
    ],
  })),
});

export const phaseGameStatsLockMachine = defineMachine({
  ...gameStatsLockMachine.spec,
  id: 'phase_game.stats_locked',
  title: 'Phase game stats lock',
  storage: 'phase_games.stats_locked',
  transitions: gameStatsLockMachine.spec.transitions.map((transition) => ({ ...transition, writers: ['src/lib/supabase/queries/phase-games.ts'] })),
});
