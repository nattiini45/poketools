import { defineMachine } from '@/lib/state-machine/machine';
import type { WikiNote } from '@/types/wiki';

/**
 * Wiki note moderation (docs/state-machines.md, "Wiki note moderation"). There is no status column: the state is
 * derived from `approved`, `rejected_at` and `resubmission_blocked_at` by `noteModerationState`, the one place
 * that reads them as a state. Client-safe.
 */
const ROUTE = 'src/app/api/wiki/notes/[id]/route.ts';
const QUERIES = 'src/lib/supabase/queries/wiki-notes.ts';

export const noteModerationMachine = defineMachine({
  id: 'wiki_note.moderation',
  title: 'Wiki note moderation',
  storage: 'wiki_notes.approved + rejected_at + resubmission_blocked_at (derived by noteModerationState)',
  summary:
    'A community note from submission to a moderator verdict. Only an approved note is public. A moderator approve or reject is compare-and-set against the state and the updated_at the moderator saw, so a verdict on text the author edited meanwhile is refused (wiki_note_changed). A site admin editing the text keeps the state (not a transition); deleting a note removes the row from any state.',
  doc: 'docs/wiki.md',
  states: ['pending', 'approved', 'rejected', 'blocked'],
  initial: ['pending'],
  terminal: [],
  actors: ['author', 'admin', 'superadmin'],
  transitions: [
    {
      event: 'resubmit',
      from: ['pending', 'approved', 'rejected'],
      to: 'pending',
      actors: ['author'],
      writers: [ROUTE, QUERIES],
      note: 'The author edits the text: the note goes back to the queue until a moderator sees it. A blocked note refuses it (wiki_note_resubmission_blocked).',
    },
    {
      event: 'approve',
      from: ['pending', 'rejected', 'blocked'],
      to: 'approved',
      actors: ['admin'],
      writers: [ROUTE, QUERIES],
      note: 'Publishes the note; approving a blocked note clears the block.',
    },
    {
      event: 'reject',
      from: ['pending'],
      to: 'rejected',
      actors: ['admin'],
      writers: [ROUTE, QUERIES],
    },
    {
      event: 'unpublish',
      from: ['approved'],
      to: 'rejected',
      actors: ['admin'],
      writers: [ROUTE, QUERIES],
      note: 'Takes a live note out of public view, usually in answer to a report.',
    },
    {
      event: 'block',
      from: ['rejected'],
      to: 'blocked',
      actors: ['superadmin'],
      writers: [ROUTE, QUERIES],
      note: 'Closes a rejected note for resubmission; it stays rejected.',
    },
    {
      event: 'unblock',
      from: ['blocked'],
      to: 'rejected',
      actors: ['superadmin'],
      writers: [ROUTE, QUERIES],
    },
  ],
});

export type NoteModerationState = (typeof noteModerationMachine.spec.states)[number];

export const NOTE_MODERATION_STATES = noteModerationMachine.spec.states;

/** The moderation state of a note row: approved wins, a block implies rejected (table CHECK). */
export function noteModerationState(
  note: Pick<WikiNote, 'approved' | 'rejected_at' | 'resubmission_blocked_at'>,
): NoteModerationState {
  if (note.approved) return 'approved';
  if (note.resubmission_blocked_at) return 'blocked';
  if (note.rejected_at) return 'rejected';
  return 'pending';
}
