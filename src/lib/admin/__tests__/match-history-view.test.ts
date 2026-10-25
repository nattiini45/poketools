import { describe, expect, it } from 'vitest';
import { describeHistoryChanges, type HistoryPlayer } from '../match-history-view';

const PLAYERS: HistoryPlayer[] = [
  { id: 'p1', name: 'Mara' },
  { id: 'p2', name: 'Jonas' },
];

describe('describeHistoryChanges', () => {
  it('is empty for no changes', () => {
    expect(describeHistoryChanges(null, PLAYERS)).toEqual([]);
    expect(describeHistoryChanges(undefined, PLAYERS)).toEqual([]);
    expect(describeHistoryChanges({}, PLAYERS)).toEqual([]);
  });

  it('maps winner ids to the player names, and a cleared winner to null', () => {
    expect(
      describeHistoryChanges({ winner_id: { before: 'p1', after: null } }, PLAYERS),
    ).toEqual([{ kind: 'winner', before: 'Mara', after: null }]);
    expect(
      describeHistoryChanges({ winner_id: { before: null, after: 'p2' } }, PLAYERS),
    ).toEqual([{ kind: 'winner', before: null, after: 'Jonas' }]);
  });

  it('keeps status values raw and formats scheduled_at changes as instants', () => {
    const items = describeHistoryChanges(
      {
        status: { before: 'completed', after: 'in_progress' },
        scheduled_at: { before: null, after: '2026-10-24T10:00:00.000Z' },
      },
      PLAYERS,
    );
    expect(items).toEqual([
      { kind: 'status', before: 'completed', after: 'in_progress' },
      { kind: 'scheduled', before: null, after: '2026-10-24T10:00:00.000Z' },
    ]);
  });

  it('lists the fields in a fixed order whatever the order of the keys', () => {
    const items = describeHistoryChanges(
      {
        notes: { before: '', after: 'Replay checked' },
        scheduled_at: { before: '2026-10-24T10:00:00.000Z', after: null },
        winner_id: { before: null, after: 'p1' },
        status: { before: 'scheduled', after: 'completed' },
      },
      PLAYERS,
    );
    expect(items.map((item) => item.kind)).toEqual(['status', 'winner', 'scheduled', 'notes']);
    expect(items[3]).toEqual({ kind: 'notes', before: null, after: 'Replay checked' });
  });

  it('skips unknown fields', () => {
    expect(
      describeHistoryChanges(
        { submitter_id: { before: 'p1', after: null }, status: { before: 'completed', after: 'scheduled' } },
        PLAYERS,
      ),
    ).toEqual([{ kind: 'status', before: 'completed', after: 'scheduled' }]);
  });

  it('skips malformed entries: wrong types, a bad instant, a winner of neither side, a non-pair', () => {
    expect(
      describeHistoryChanges(
        {
          status: { before: 3, after: 'completed' },
          winner_id: { before: 'someone-else', after: 'p1' },
          scheduled_at: { before: 'not a date', after: null },
          notes: 'plain string' as unknown as { before: unknown; after: unknown },
        },
        PLAYERS,
      ),
    ).toEqual([]);
  });

  it('skips a field whose value did not change', () => {
    expect(
      describeHistoryChanges(
        { notes: { before: 'same', after: 'same' }, status: { before: 'disputed', after: 'disputed' } },
        PLAYERS,
      ),
    ).toEqual([]);
  });
});
