import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The per-game markers that fence derived data (docs/match.md "Aggregate Queue", docs/evolution-point-buy.md). Every
 * move of the first three happens inside a SQL function that locks the game row and checks the marker; the TS side
 * only calls those functions, and `src/lib/match/__tests__/game-marker-state.test.ts` pins each function's guards to
 * these definitions. A route never writes the marker columns itself.
 */

const PIPELINE = 'src/lib/pkmn/game-pipeline.ts';
const GAMES = 'src/lib/supabase/queries/games.ts';
const CREDIT_MIGRATION = 'supabase/migrations/20261021100100_epb_game_kill_credit_ledger.sql';
const EVALUATOR = 'src/lib/match/evolution-match-evaluator.ts';
const LEASE_MIGRATION = 'supabase/migrations/20261019100000_games_edit_lease.sql';

export const gameAggregateMarkerMachine = defineMachine({
  id: 'game.aggregate_applied_at',
  title: 'Game aggregate marker',
  storage: 'games.aggregate_applied_at (NULL = uncounted)',
  summary:
    "Whether a game's battle stats are counted in `aggregates` and `player_aggregates`. The counts and the marker change in one transaction under the game row lock. A game is deleted only while uncounted (`deleteUncountedGameRow`); a league restore re-inserts its games uncounted and queues one job each. A scope rebuild re-derives the counts without touching the marker, so it skips games with a live job.",
  doc: 'docs/match.md',
  states: ['uncounted', 'counted'],
  initial: ['uncounted'],
  terminal: [],
  actors: ['queue', 'admin'],
  transitions: [
    {
      event: 'apply',
      from: ['uncounted'],
      to: 'counted',
      actors: ['queue', 'admin'],
      writers: [
        'supabase/migrations/20261018130100_aggregate_apply_atomic.sql#apply_aggregate_job',
        'src/lib/supabase/queries/aggregates.ts',
        'src/lib/match/aggregate-queue.ts',
      ],
      note: 'The queue worker, or an admin game edit re-applying the new stats; a counted game answers already_applied.',
    },
    {
      event: 'rollback',
      from: ['counted'],
      to: 'uncounted',
      actors: ['admin'],
      writers: [
        'supabase/migrations/20261018170000_aggregate_rollback_atomic.sql#rollback_game_aggregates',
        'src/lib/supabase/queries/aggregates.ts',
        PIPELINE,
      ],
      note: 'Admin game edit, game delete or match reset; fenced on the marker the deltas were built under (marker_changed otherwise).',
    },
  ],
});

export const gameEvolutionCreditMachine = defineMachine({
  id: 'game.evolution_applied_at',
  title: 'Game evolution credit marker',
  storage: 'games.evolution_applied_at + games.evolution_credits',
  summary:
    'Whether the real kills of an Evolution Point Buy game are credited to the trackers. `credited` holds the ledger of what was credited (evolution_credits); `legacy_credited` is a marker from before the ledger (evolution_credits NULL), debited from the caller\'s debits until the season is rebuilt once. Credit, uncredit and the season sync lock the game rows; the sync is fenced on the season epoch.',
  doc: 'docs/evolution-point-buy.md',
  states: ['uncredited', 'credited', 'legacy_credited'],
  initial: ['uncredited', 'legacy_credited'],
  terminal: [],
  actors: ['system', 'admin', 'rebuild'],
  transitions: [
    {
      event: 'credit',
      from: ['uncredited'],
      to: 'credited',
      actors: ['system'],
      writers: [`${CREDIT_MIGRATION}#epb_credit_game_kills`, 'src/lib/supabase/queries/evolutions.ts', EVALUATOR, 'src/lib/match/finalize.ts'],
      note: 'The finalize step epb_real_kills, once the match is completed (match_not_completed otherwise).',
    },
    {
      event: 'uncredit',
      from: ['credited', 'legacy_credited'],
      to: 'uncredited',
      actors: ['admin'],
      writers: [`${CREDIT_MIGRATION}#epb_uncredit_game_kills`, 'src/lib/supabase/queries/evolutions.ts', EVALUATOR, PIPELINE],
      note: 'An admin game edit that moves a completed match out of completed; fenced on the expected marker.',
    },
    {
      event: 'sync_mark',
      from: ['uncredited'],
      to: 'credited',
      actors: ['rebuild'],
      writers: [`${CREDIT_MIGRATION}#epb_sync_game_kill_credit`, 'src/lib/reconcile/evolution-rebuild.ts'],
      note: 'The season evolution rebuild marks the games of completed matches it credited.',
    },
    {
      event: 'sync_rewrite',
      from: ['credited', 'legacy_credited'],
      to: 'credited',
      actors: ['rebuild'],
      writers: [`${CREDIT_MIGRATION}#epb_sync_game_kill_credit`, 'src/lib/reconcile/evolution-rebuild.ts'],
      note: 'The rebuild rewrites the ledger of a credited game (a legacy marker gets its ledger).',
    },
    {
      event: 'sync_clear',
      from: ['credited', 'legacy_credited'],
      to: 'uncredited',
      actors: ['rebuild'],
      writers: [`${CREDIT_MIGRATION}#epb_sync_game_kill_credit`, 'src/lib/reconcile/evolution-rebuild.ts'],
      note: 'The rebuild clears games of matches that are no longer completed.',
    },
  ],
});

export const gameEditLeaseMachine = defineMachine({
  id: 'game.edit_lease',
  title: 'Game edit lease',
  storage: 'games.edit_lease_token + games.edit_lease_until (both NULL or both set)',
  summary:
    'One admin edit of a game at a time. Only `editGame` takes the lease; game delete, match reset and winner edits rely on the aggregate marker fence instead. `expired` is a lease whose edit_lease_until has passed: free in effect, cleared lazily by the next claim or the release.',
  doc: 'docs/match.md',
  states: ['free', 'leased', 'expired'],
  initial: ['free'],
  terminal: [],
  actors: ['admin', 'clock'],
  transitions: [
    {
      event: 'claim',
      from: ['free', 'expired'],
      to: 'leased',
      actors: ['admin'],
      writers: [`${LEASE_MIGRATION}#claim_game_edit_lease`, GAMES, PIPELINE],
      note: "Together with the editor's version (updated_at): leased or stale otherwise (409 admin_game_edit_in_progress / admin_game_edit_stale).",
    },
    {
      event: 'release',
      from: ['leased', 'expired'],
      to: 'free',
      actors: ['admin'],
      writers: [`${LEASE_MIGRATION}#release_game_edit_lease`, GAMES, PIPELINE],
      note: 'The edit releases its own token in finally; another token releases nothing.',
    },
    {
      event: 'lapse',
      from: ['leased'],
      to: 'expired',
      actors: ['clock'],
      writers: [LEASE_MIGRATION],
      note: 'edit_lease_until passes (TTL 120 s), for example after a crashed edit.',
    },
  ],
});

export const gameStatsLockMachine = defineMachine({
  id: 'game.stats_locked',
  title: 'Game stats lock',
  storage: 'games.stats_locked',
  summary:
    'An admin replaced the battle stats of a game by hand, so re-parse tooling (scripts/reparse-game.ts) leaves it alone unless forced. Advisory: no route checks it. One-way in the app; an unlock is a manual database edit.',
  doc: 'docs/match.md',
  states: ['unlocked', 'locked'],
  initial: ['unlocked'],
  terminal: [],
  actors: ['admin'],
  transitions: [
    {
      event: 'lock',
      from: ['unlocked', 'locked'],
      to: 'locked',
      actors: ['admin'],
      writers: [GAMES, PIPELINE],
      note: 'An admin game edit that replaces the battle stats (not a winner-only edit), after the re-apply.',
    },
  ],
});
