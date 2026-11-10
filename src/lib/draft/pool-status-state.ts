import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The legacy-engine draft pool (`draft_pools.status` where `engine = 'legacy'`) as an explicit machine (ADR 0004).
 * Every write is a plain PostgREST UPDATE, so the writers enforce it: `PATCH /api/drafts/[id]` asserts the move for
 * the admin and `updateDraftPoolStatus` guards the UPDATE with the status it read; the system's completion
 * (`completeLegacyPoolIfRunning`) guards with `sourcesOf('complete', 'system')`. Client-safe.
 *
 * Queue-engine pools keep `status` only as a twin of their phase (`draftPoolPhaseMachine`, `DRAFT_PHASE_STATUS`);
 * the PATCH route refuses them before it asks this machine.
 */
export const draftPoolStatusMachine = defineMachine({
  id: 'draft_pool.status',
  title: 'Draft pool (legacy engine)',
  storage: "draft_pools.status (enum draft_pool_status) where engine = 'legacy'",
  summary:
    "A pre-queue draft board: an admin opens it to picks, the last pick (or the first state read after it) completes it. The trigger trg_draft_pools_sync_legacy_phase mirrors every status write into phase. An admin may still reopen a complete pool or move a pool back to pending (docs/draft-room.md: retiring a legacy pool of a point-buy season), so no state is terminal; pending → complete is refused (an admin ends a running draft instead).",
  doc: 'docs/draft-room.md',
  states: ['pending', 'in_progress', 'complete'],
  initial: ['pending'],
  terminal: [],
  actors: ['admin', 'system'],
  transitions: [
    {
      event: 'start',
      from: ['pending'],
      to: 'in_progress',
      actors: ['admin'],
      writers: ['src/app/api/drafts/[id]/route.ts', 'src/lib/supabase/queries/drafts.ts'],
      note: 'DraftBoard Start (and the admin agent\'s staged propose_draft_activate_legacy_pool). A pool of a point-buy season answers POOL_ENGINE_LEGACY_EPB.',
    },
    {
      event: 'complete',
      from: ['in_progress'],
      to: 'complete',
      actors: ['admin', 'system'],
      writers: [
        'src/app/api/drafts/[id]/route.ts',
        'src/app/api/drafts/[id]/picks/route.ts',
        'src/app/api/drafts/[id]/state/route.ts',
        'src/lib/supabase/queries/drafts.ts',
      ],
      note: 'An admin ends the draft (DraftBoard End draft), or the system after the last pick: the pick route, else the first GET /api/drafts/[id]/state.',
    },
    {
      event: 'reopen',
      from: ['complete'],
      to: 'in_progress',
      actors: ['admin'],
      writers: ['src/app/api/drafts/[id]/route.ts', 'src/lib/supabase/queries/drafts.ts'],
      note: 'API only (no button): reopens a finished draft, e.g. to undo its last pick. The next state read completes it again while every pick is made.',
    },
    {
      event: 'reset',
      from: ['in_progress', 'complete'],
      to: 'pending',
      actors: ['admin'],
      writers: ['src/app/api/drafts/[id]/route.ts', 'src/lib/supabase/queries/drafts.ts'],
      note: 'API only (no button): docs/draft-room.md moves a legacy pool of a point-buy season back to pending so it can be deleted.',
    },
  ],
});

export type LegacyDraftPoolStatus = (typeof draftPoolStatusMachine.spec.states)[number];
