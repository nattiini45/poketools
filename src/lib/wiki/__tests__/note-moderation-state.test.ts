import { describe, expect, it } from 'vitest';
import { wikiNotePatchSchema, wikiReportStatusSchema } from '@/lib/validation/schemas';
import { NOTE_MODERATION_STATES, noteModerationMachine, noteModerationState } from '../note-moderation-state';
import { noteReportMachine } from '../note-report-state';

describe('noteModerationState', () => {
  it('derives the state from the moderation fields', () => {
    expect(noteModerationState({ approved: false, rejected_at: null })).toBe('pending');
    expect(noteModerationState({ approved: true, rejected_at: null })).toBe('approved');
    expect(noteModerationState({ approved: false, rejected_at: '2026-01-02T00:00:00Z' })).toBe('rejected');
    expect(
      noteModerationState({ approved: false, rejected_at: '2026-01-02T00:00:00Z', resubmission_blocked_at: '2026-01-03T00:00:00Z' }),
    ).toBe('blocked');
  });

  it('reads an approved note as approved even with a stray rejected_at (the public read filters on approved)', () => {
    expect(noteModerationState({ approved: true, rejected_at: '2026-01-02T00:00:00Z' })).toBe('approved');
  });
});

describe('noteModerationMachine', () => {
  it('lets the author resubmit from every state but blocked, which is what updateNote filters on (resubmission_blocked_at IS NULL)', () => {
    expect(noteModerationMachine.sourcesOf('pending', 'author').sort()).toEqual(['approved', 'pending', 'rejected']);
  });

  it('keeps the request schema in step with the states', () => {
    expect(wikiNotePatchSchema.shape.expected_state.unwrap().options).toEqual([...NOTE_MODERATION_STATES]);
  });

  it('offers a moderator approve and reject on a pending note, approve only once rejected', () => {
    expect(noteModerationMachine.nextStates('pending', 'admin').sort()).toEqual(['approved', 'rejected']);
    expect(noteModerationMachine.nextStates('rejected', 'admin')).toEqual(['approved']);
    expect(noteModerationMachine.nextStates('blocked', 'admin')).toEqual(['approved']);
    expect(noteModerationMachine.transitionsFrom('approved', 'admin').map((t) => t.event)).toEqual(['unpublish']);
  });
});

describe('noteReportMachine', () => {
  it('keeps the request schema in step with the states', () => {
    expect(wikiReportStatusSchema.options).toEqual([...noteReportMachine.spec.states]);
  });

  it('lets only the reporter reopen a closed report', () => {
    expect(noteReportMachine.can('dismissed', 'open', 'reporter')).toBe(true);
    expect(noteReportMachine.can('dismissed', 'open', 'admin')).toBe(false);
    expect(noteReportMachine.can('reviewed', 'dismissed', 'admin')).toBe(false);
  });
});
