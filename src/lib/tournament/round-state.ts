import { defineMachine } from '@/lib/state-machine/machine';
import type { RoundStatus } from '@/types/round';

/**
 * The status of a round (`rounds.status`): docs/state-machines.md, ADR 0004. Players see Submit only in an active round,
 * so the state is not cosmetic. Completion is the `round_complete` function (unfinished-match check under the round lock,
 * force audited by the route); every other move goes through `updateRoundStatus` with the status the writer read, as a
 * compare-and-set. `src/lib/tournament/__tests__/round-machine-sql-parity.test.ts` holds the SQL guard equal to this table.
 */
export const roundMachine = defineMachine({
  id: 'round',
  title: 'Round',
  storage: 'rounds.status (enum round_status)',
  summary:
    'A round of a tournament or phase: written pending, started to open it to play, completed by an admin. A match reopened in a completed round reopens the round; an admin reset of its matches puts it back to pending.',
  doc: 'docs/tournament.md',
  states: ['pending', 'active', 'completed'],
  initial: ['pending'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'start',
      from: ['pending'],
      to: 'active',
      actors: ['admin', 'system'],
      writers: [
        'src/app/api/tournaments/[id]/rounds/[rid]/route.ts',
        'src/app/api/generate-round/[tid]/route.ts',
        'src/app/api/tournaments/[id]/generate-all-rounds/route.ts',
        'src/lib/tournament/bracket-generate.ts',
      ],
      note: 'Start in the round manager, or a generate that was asked to start its round (best effort).',
    },
    {
      event: 'complete',
      from: ['active'],
      to: 'completed',
      actors: ['admin'],
      writers: ['supabase/migrations/20261106090000_format_challenges.sql#round_complete'],
      note: 'Refused while a match is unfinished unless forced with a reason (audited round.force_complete).',
    },
    {
      event: 'complete_unstarted',
      from: ['pending'],
      to: 'completed',
      actors: ['admin'],
      writers: ['supabase/migrations/20261106090000_format_challenges.sql#round_complete'],
      note: 'The API accepts completing a round that was never started (round_complete only refuses a completed one); the round manager does not offer it.',
    },
    {
      event: 'reset',
      from: ['active', 'completed'],
      to: 'pending',
      actors: ['admin'],
      writers: ['src/lib/pkmn/game-pipeline.ts', 'src/app/api/tournaments/[id]/rounds/[rid]/route.ts'],
      note: 'Reset in the round manager (resetRound: every played match back to scheduled), or a status PATCH.',
    },
    {
      event: 'revert',
      from: ['completed'],
      to: 'pending',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts'],
      note: 'revertRoundIfCompleted: a match of a completed round changed (reopened, a game deleted or edited).',
    },
  ],
});

export type RoundActor = (typeof roundMachine.spec.actors)[number];

/** Whether `actor` may perform `event` from `status`: what the round manager offers. */
export function canRoundEvent(status: RoundStatus, event: 'start' | 'complete' | 'reset', actor: RoundActor): boolean {
  return roundMachine.transitionsFrom(status, actor).some((t) => t.event === event);
}
