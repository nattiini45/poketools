import { describe, expect, it } from 'vitest';
import { groupDraftGate } from '../_components/panels/DraftGroupGate';

const lines = (n: number, price: number) => Array.from({ length: n }, (_, i) => ({ lineId: `l${i}`, price }));
const base = { budget: 100, rosterSize: 6, minSeats: 2, maxSeats: 32 };

describe('groupDraftGate (pre-create check of a league group)', () => {
  it('seat bounds first: empty, too few, too many', () => {
    expect(groupDraftGate({ ...base, memberCount: 0, lines: lines(100, 10) })).toEqual({ kind: 'empty' });
    expect(groupDraftGate({ ...base, memberCount: 1, lines: lines(100, 10) })).toEqual({ kind: 'tooFew', count: 1 });
    expect(groupDraftGate({ ...base, memberCount: 33, lines: lines(400, 10) })).toEqual({ kind: 'tooMany', count: 33 });
  });

  it('a group of seven at 100 points / 6 lines on a 60-line list is ready', () => {
    expect(groupDraftGate({ ...base, memberCount: 7, lines: lines(60, 15) })).toEqual({ kind: 'ready' });
  });

  it('fourteen trainers on the same list cannot complete (too few lines): split into groups', () => {
    const gate = groupDraftGate({ ...base, memberCount: 14, lines: lines(60, 15) });
    expect(gate).toMatchObject({ kind: 'notCompletable', totals: { participants: 14, slots: 84, lines: 60 } });
  });

  it('enough lines but too expensive is not completable either', () => {
    expect(groupDraftGate({ ...base, memberCount: 2, lines: lines(18, 30) }).kind).toBe('notCompletable');
  });
});
