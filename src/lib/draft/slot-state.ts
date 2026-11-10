import { defineMachine } from '@/lib/state-machine/machine';
import type { SlotStatus } from '@/types/draft-queue';

const LG = 'supabase/migrations/20261018180000_league_groups.sql';
const CP = 'supabase/migrations/20261018140200_draft_pool_completability.sql';
const RPC = 'supabase/migrations/20261012024916_draft_rpcs.sql';

/**
 * One turn in the queue engine's pick order (`draft_slots.status`) as an explicit machine (ADR 0004). Client-safe.
 * Only SQL writes it, inside the `draft_*` RPCs under `draft__lock`; `__tests__/pool-phase-state-sql.test.ts`
 * holds the definition equal to their guards.
 */
export const draftSlotMachine = defineMachine({
  id: 'draft_slot.status',
  title: 'Draft slot',
  storage: 'draft_slots.status',
  summary:
    "A slot is inserted pending (draft_start, the Redraft publish, a timeout's make-up slot, a voided pick's requeued slot). At most one slot of a pool is current (uq_draft_slots_one_current). draft_end and redraft_admin_restore_drop delete pending and active slots instead of moving them. Retired: blocked and forfeited (RETIRED_SLOT_STATUSES) are still allowed by the CHECK and the SlotStatus type, but nothing writes them any more, so they are not states of this machine.",
  doc: 'docs/draft-room.md',
  states: ['pending', 'active', 'done', 'timed_out'],
  initial: ['pending'],
  terminal: ['done', 'timed_out'],
  actors: ['player', 'admin', 'system'],
  transitions: [
    {
      event: 'activate',
      from: ['pending'],
      to: 'active',
      actors: ['system'],
      writers: [`${CP}#draft__activate_next`],
      note: 'The first pending slot by sort_key gets the clock (none while another slot is current: ACTIVE_SLOT_EXISTS).',
    },
    {
      event: 'activate_replacement',
      from: ['pending'],
      to: 'active',
      actors: ['admin'],
      writers: [`${LG}#draft_admin_void_pick`],
      note: 'A correction activates the requeued slot and commits the replacement pick in the same statement.',
    },
    {
      event: 'pick',
      from: ['active'],
      to: 'done',
      actors: ['player', 'admin'],
      writers: [`${LG}#draft__commit_pick`, `${CP}#draft_confirm_pick`],
      note: 'The player on the clock, or an admin override, picks; a wrong slot answers STALE_SLOT.',
    },
    {
      event: 'time_out',
      from: ['active'],
      to: 'timed_out',
      actors: ['system'],
      writers: [`${RPC}#draft__resolve_timeouts`],
      note: 'The deadline passed in an unpaused drafting pool; a make-up slot is queued behind the next player.',
    },
    {
      event: 'requeue',
      from: ['active'],
      to: 'pending',
      actors: ['admin'],
      writers: [`${LG}#draft_admin_void_pick`],
      note: 'A void puts the current slot back in the queue behind the requeued one.',
    },
  ],
});

/** Values the `draft_slots.status` CHECK and `SlotStatus` still allow but no writer produces (retired with the blocked-slot flow). */
export const RETIRED_SLOT_STATUSES = ['blocked', 'forfeited'] as const satisfies readonly SlotStatus[];
