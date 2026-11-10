import { defineMachine } from '@/lib/state-machine/machine';

const LG = 'supabase/migrations/20261018180000_league_groups.sql';
const CP = 'supabase/migrations/20261018140200_draft_pool_completability.sql';
const TK = 'supabase/migrations/20261027193000_draft_token_participation_rate.sql';

/**
 * The Draft Kill Token purchase window as a machine (ADR 0004). It is derived, never stored:
 * `draftKillTokenWindow` (`src/lib/draft/tokens.ts`) computes it from the initial pool's phase, its
 * `token_purchase_closes_at` and whether a league match is confirmed, and its SQL twin inside
 * `epb_purchase_draft_token` refuses a purchase outside `open` with TOKEN_WINDOW_CLOSED {window}.
 * `__tests__/token-window-state.test.ts` holds the two twins and this definition together. Client-safe.
 */
export const draftKillTokenWindowMachine = defineMachine({
  id: 'draft.kill_token_window',
  title: 'Draft Kill Token window',
  storage: "derived: the initial pool's phase, draft_pools.token_purchase_closes_at and the league's completed matches",
  summary:
    "before until the player's Initial draft is complete; then open until token_purchase_closes_at (or, without one, until the first league match is completed); then closed. Writers are the inputs' writers: the window moves when they change, and is recomputed wherever it is read (tokens overview, TokenCenter, the purchase RPC).",
  doc: 'docs/draft-room.md',
  states: ['before', 'open', 'closed'],
  initial: ['before'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'initial_complete',
      from: ['before'],
      to: 'open',
      actors: ['system'],
      writers: [`${CP}#draft__activate_next`, 'src/lib/draft/tokens.ts', `${TK}#epb_purchase_draft_token`],
      note: 'The Initial draft completes while the close date is ahead (or none is set and no match is completed).',
    },
    {
      event: 'initial_complete_late',
      from: ['before'],
      to: 'closed',
      actors: ['system'],
      writers: [`${CP}#draft__activate_next`, 'src/lib/draft/tokens.ts', `${TK}#epb_purchase_draft_token`],
      note: 'The Initial draft completes after the close date (or after the first completed match).',
    },
    {
      event: 'close',
      from: ['open'],
      to: 'closed',
      actors: ['system'],
      writers: ['src/lib/draft/tokens.ts', `${TK}#epb_purchase_draft_token`],
      note: 'The close date passes, or without one the first league match is completed.',
    },
    {
      event: 'move_close_date',
      from: ['open', 'closed'],
      to: 'open',
      actors: ['admin'],
      writers: [`${LG}#draft_configure`, 'src/app/api/drafts/[id]/config/route.ts'],
      note: 'token_purchase_closes_at is editable in every phase: a later date reopens a closed window (also after matches were played).',
    },
    {
      event: 'move_close_date_past',
      from: ['open'],
      to: 'closed',
      actors: ['admin'],
      writers: [`${LG}#draft_configure`, 'src/app/api/drafts/[id]/config/route.ts'],
      note: 'An earlier close date closes the window at once.',
    },
    {
      event: 'reopen_initial',
      from: ['open', 'closed'],
      to: 'before',
      actors: ['admin'],
      writers: [`${LG}#draft_admin_void_pick`],
      note: 'Voiding a pick of the complete Initial draft reopens it (draft_pool.phase reopen).',
    },
  ],
});
