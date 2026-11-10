import { defineMachine } from '@/lib/state-machine/machine';
import type { MatchOutcome } from '@/types/match-outcome';

const OUTCOME_SQL = 'supabase/migrations/20261104090000_match_outcomes.sql#match_outcome_record';

/**
 * How a match ended (`match_outcomes`, one row per match, absent = none) as a machine. The state is the row's kind,
 * with a played row an admin set (`source = 'admin'`) apart from one the finalize wrote, because the only writer,
 * `match_outcome_record`, decides by source: a system write (`p_force = false`: finalize, the replay engine) never
 * replaces an admin row, an admin write (`p_force = true`) replaces any row. Forfeit and no-show rows are always admin
 * rows (the format cron's deadline forfeit writes one too, without a person). Deletes go through `deleteMatchOutcome`,
 * fenced on the row's `set_at`. SQL-owned: `outcome-state-sql.test.ts` pins this definition to the function.
 */
export const matchOutcomeMachine = defineMachine({
  id: 'match_outcome',
  title: 'Match outcome',
  storage: "match_outcomes.kind with source = 'admin' (row absent = none)",
  summary:
    'How a decided or unresolvable match ended, next to matches.winner_id. A system write never replaces an admin row (it is kept, the RPC answers kept); an admin result is staged before its status write and only while the match is not completed (p_open_only), and is taken back when that write loses. Standings score the outcome of a completed match only.',
  doc: 'docs/match.md',
  states: ['none', 'played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
  initial: ['none'],
  terminal: [],
  actors: ['system', 'admin'],
  transitions: [
    {
      event: 'record_played',
      from: ['none', 'played', 'unresolved'],
      to: 'played',
      actors: ['system'],
      writers: ['src/lib/match/finalize.ts', OUTCOME_SQL],
      note: 'Finalize of a completed match: the faint tally of its games (source replay or manual).',
    },
    {
      event: 'replace_admin_row',
      from: ['none', 'played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
      to: 'played',
      actors: ['admin'],
      writers: ['src/lib/match/finalize.ts', OUTCOME_SQL],
      note: 'Finalize asked to replace an admin row (replaceAdminRow): a forced write of the played tally.',
    },
    {
      event: 'flag_unresolved',
      from: ['none', 'played', 'unresolved'],
      to: 'unresolved',
      actors: ['system'],
      writers: ['src/lib/pkmn/game-pipeline.ts', 'src/lib/match/finalize.ts', OUTCOME_SQL],
      note: 'A replay engine tie disputes the match; the row is never scored.',
    },
    {
      event: 'set_played',
      from: ['none', 'played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
      to: 'admin_played',
      actors: ['admin'],
      writers: ['src/app/api/admin/matches/[id]/result/route.ts', 'src/lib/match/finalize.ts', OUTCOME_SQL],
      note: 'An admin records the result as played, with a reason.',
    },
    {
      event: 'set_forfeit',
      from: ['none', 'played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
      to: 'forfeit',
      actors: ['admin'],
      writers: [
        'src/app/api/admin/matches/[id]/result/route.ts',
        'src/lib/format-engine/runtime/cron.ts',
        'src/lib/match/finalize.ts',
        OUTCOME_SQL,
      ],
      note: 'An admin records a forfeit, or the format cron a deadline forfeit.',
    },
    {
      event: 'set_no_show',
      from: ['none', 'played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
      to: 'no_show',
      actors: ['admin'],
      writers: ['src/app/api/admin/matches/[id]/result/route.ts', 'src/lib/match/finalize.ts', OUTCOME_SQL],
    },
    {
      event: 'take_back',
      from: ['played', 'unresolved', 'admin_played', 'forfeit', 'no_show'],
      to: 'none',
      actors: ['system', 'admin'],
      writers: [
        'src/lib/match/outcome-takeback.ts',
        'src/lib/match/finalize.ts',
        'src/app/api/admin/matches/[id]/result/route.ts',
        'src/lib/supabase/queries/match-outcomes.ts',
      ],
      note: 'The match leaves completed or disputed (reset, reopen, a game change), or a staged admin row whose status write lost; deleted by its set_at.',
    },
  ],
});

export type MatchOutcomeState = (typeof matchOutcomeMachine.spec.states)[number];

/** The machine state of a stored outcome row (null: no row). */
export function matchOutcomeState(outcome: Pick<MatchOutcome, 'kind' | 'source'> | null): MatchOutcomeState {
  if (!outcome) return 'none';
  if (outcome.kind === 'played') return outcome.source === 'admin' ? 'admin_played' : 'played';
  return outcome.kind;
}
