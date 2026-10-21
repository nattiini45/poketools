import { describe, expect, it } from 'vitest';
import { dueNotifications, SLOW_REMINDERS_MS, type NotifyKind } from '@/lib/draft-ui/notify-schedule';

const H = 3_600_000;

/** A sent-log the way storage.ts keeps it (slot + kind). */
function log() {
  const sent = new Set<string>();
  return {
    alreadySent: (slotId: string, kind: NotifyKind) => sent.has(`${slotId}:${kind}`),
    record(slotId: string, kinds: NotifyKind[]) {
      for (const kind of kinds) sent.add(`${slotId}:${kind}`);
    },
  };
}

function due(
  l: ReturnType<typeof log>,
  over: Partial<Parameters<typeof dueNotifications>[0]> = {},
): NotifyKind[] {
  const kinds = dueNotifications({
    onClock: true,
    slotId: 's1',
    mode: 'slow',
    paused: false,
    remainingMs: 12 * H,
    alreadySent: l.alreadySent,
    ...over,
  });
  l.record(over.slotId ?? 's1', kinds);
  return kinds;
}

describe('dueNotifications', () => {
  it('has the 8/4/1 h thresholds', () => {
    expect(SLOW_REMINDERS_MS).toEqual([8 * H, 4 * H, H]);
  });

  it('sends "turn" once per slot', () => {
    const l = log();
    expect(due(l, { mode: 'live', remainingMs: 300_000 })).toEqual(['turn']);
    expect(due(l, { mode: 'live', remainingMs: 200_000 })).toEqual([]);
    expect(due(l, { mode: 'live', slotId: 's2', remainingMs: 300_000 })).toEqual(['turn']);
  });

  it('sends nothing when the viewer is not on the clock or there is no slot', () => {
    const l = log();
    expect(due(l, { onClock: false })).toEqual([]);
    expect(due(l, { slotId: null })).toEqual([]);
  });

  it('sends each slow reminder once, in order', () => {
    const l = log();
    expect(due(l, { remainingMs: 12 * H })).toEqual(['turn']);
    expect(due(l, { remainingMs: 8 * H + 1 })).toEqual([]);
    expect(due(l, { remainingMs: 8 * H })).toEqual(['remind-8h']);
    expect(due(l, { remainingMs: 7 * H })).toEqual([]);
    expect(due(l, { remainingMs: 4 * H - 1000 })).toEqual(['remind-4h']);
    expect(due(l, { remainingMs: 2 * H })).toEqual([]);
    expect(due(l, { remainingMs: H })).toEqual(['remind-1h']);
    expect(due(l, { remainingMs: 10_000 })).toEqual([]);
  });

  it('sends only the most urgent reminder (plus "turn") after a long hide, and never an older one later', () => {
    const l = log();
    expect(due(l, { remainingMs: 30 * 60_000 })).toEqual(['turn', 'remind-1h']);
    expect(due(l, { remainingMs: 20 * 60_000 })).toEqual([]);
  });

  it('sends no reminders in live drafts', () => {
    const l = log();
    expect(due(l, { mode: 'live', remainingMs: 30_000 })).toEqual(['turn']);
  });

  it('sends nothing while paused', () => {
    const l = log();
    expect(due(l, { paused: true, remainingMs: 30 * 60_000 })).toEqual([]);
    expect(due(l, { paused: false, remainingMs: 30 * 60_000 })).toEqual(['turn', 'remind-1h']);
  });

  it('defers everything while quiet hours hold the clock, then sends it once the clock runs', () => {
    const l = log();
    expect(due(l, { held: true, remainingMs: 30 * 60_000 })).toEqual([]);
    expect(due(l, { held: false, remainingMs: 30 * 60_000 })).toEqual(['turn', 'remind-1h']);
  });

  it('skips reminders that are not below the slot total', () => {
    const l = log();
    expect(due(l, { remainingMs: 6 * H, totalMs: 6 * H })).toEqual(['turn']);
    expect(due(l, { remainingMs: 4 * H, totalMs: 6 * H })).toEqual(['remind-4h']);
  });
});
