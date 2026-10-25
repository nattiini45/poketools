import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARTICIPANTS_CHANGED_EVENT,
  announceParticipantsChanged,
  subscribeParticipantsChanged,
  summarizeParticipants,
  type ParticipantsSummary,
} from '../participants-events';

describe('summarizeParticipants', () => {
  it('counts seeded rows (seed !== null) and lists the ids', () => {
    expect(
      summarizeParticipants([
        { id: 'a', seed: 1 },
        { id: 'b', seed: null },
        { id: 'c', seed: 0 },
      ])
    ).toEqual({ count: 3, seededCount: 2, playerIds: ['a', 'b', 'c'] });
  });

  it('summarizes an empty roster', () => {
    expect(summarizeParticipants([])).toEqual({ count: 0, seededCount: 0, playerIds: [] });
  });
});

describe('with a window', () => {
  const original = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = new EventTarget();
  });

  afterEach(() => {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
  });

  const summary: ParticipantsSummary = { count: 2, seededCount: 1, playerIds: ['a', 'b'] };

  it('delivers the summary to a subscriber of the same tournament only', () => {
    const mine = vi.fn();
    const other = vi.fn();
    subscribeParticipantsChanged('t1', mine);
    subscribeParticipantsChanged('t2', other);

    announceParticipantsChanged('t1', summary);

    expect(mine).toHaveBeenCalledTimes(1);
    expect(mine).toHaveBeenCalledWith(summary);
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeParticipantsChanged('t1', listener);
    announceParticipantsChanged('t1', summary);
    unsubscribe();
    announceParticipantsChanged('t1', summary);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dispatches under a stable event name', () => {
    expect(PARTICIPANTS_CHANGED_EVENT).toBe('tournament:participants-changed');
    const seen = vi.fn();
    (window as unknown as EventTarget).addEventListener(PARTICIPANTS_CHANGED_EVENT, seen);
    announceParticipantsChanged('t1', summary);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('without a window', () => {
  it('announce and subscribe are no-ops', () => {
    expect(typeof window).toBe('undefined');
    expect(() => announceParticipantsChanged('t1', { count: 0, seededCount: 0, playerIds: [] })).not.toThrow();
    const unsubscribe = subscribeParticipantsChanged('t1', () => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
