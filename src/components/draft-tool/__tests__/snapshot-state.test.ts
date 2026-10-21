import { describe, expect, it } from 'vitest';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import { initialSnapshotState, reduceSnapshotResult } from '../hooks/use-draft-snapshot';
import { parsePrefs } from '../hooks/use-finder-state';
import { clockTickMs } from '../hooks/use-clock';
import { computeClock } from '@/lib/draft-ui/clock';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');

describe('useDraftSnapshot transitions (§5.1)', () => {
  const seeded = initialSnapshotState(snapshot(), NOW + 500);

  it('takes the server offset from the seed', () => {
    expect(seeded.serverOffsetMs).toBe(-500);
    expect(initialSnapshotState(null, NOW)).toMatchObject({ dto: null, serverOffsetMs: 0 });
  });

  it('applies a newer full snapshot and never goes back to an older one', () => {
    const newer = reduceSnapshotResult(seeded, { kind: 'full', dto: snapshot({ state_version: 50 }) }, NOW);
    expect(newer.state.dto?.state_version).toBe(50);
    expect(newer.outcome).toBe('live');
    const older = reduceSnapshotResult(newer.state, { kind: 'full', dto: snapshot({ state_version: 49 }) }, NOW);
    expect(older.state.dto?.state_version).toBe(50);
  });

  it('only moves the clock on an unchanged answer', () => {
    const next = reduceSnapshotResult(
      { ...seeded, stale: true },
      { kind: 'unchanged', version: 42, serverNow: '2026-10-09T12:00:03.000Z' },
      NOW + 3000,
    );
    expect(next.state.dto).toBe(seeded.dto);
    expect(next.state).toMatchObject({ stale: false, serverOffsetMs: 0 });
  });

  it('stops on 401/403 (spectator) and keeps the last state on errors', () => {
    const auth = reduceSnapshotResult(seeded, { kind: 'auth' }, NOW);
    expect(auth).toMatchObject({ outcome: 'stop', state: { authBlocked: true } });
    expect(auth.state.dto).toBe(seeded.dto);
    const error = reduceSnapshotResult(seeded, { kind: 'error', error: { code: 'network_error' } }, NOW);
    expect(error.state).toMatchObject({ stale: true });
    expect(error.state.dto).toBe(seeded.dto);
  });

  it('reports a complete pool so the poller stops its cadence', () => {
    const base = snapshot();
    const done = reduceSnapshotResult(seeded, { kind: 'full', dto: snapshot({ state_version: 60, pool: { ...base.pool, status: 'complete' } }) }, NOW);
    expect(done.outcome).toBe('complete');
  });
});

describe('finder preferences', () => {
  it('keeps only valid stored values', () => {
    expect(parsePrefs({ stageMode: 'anywhere', sort: 'spe', showDrafted: false })).toEqual({
      stageMode: 'anywhere',
      sort: 'spe',
      showDrafted: false,
    });
    expect(parsePrefs({ stageMode: 'everywhere', sort: 'name', showDrafted: 'yes' })).toEqual({});
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs(['anywhere'])).toEqual({});
  });
});

describe('clock tick cadence', () => {
  const slot = snapshot().active_slot;

  it('ticks every second above 10 minutes and every 250 ms below, not at all while paused', () => {
    expect(clockTickMs(computeClock(slot, NOW))).toBe(250);
    const slow = slot ? { ...slot, duration_ms: 43_200_000, deadline_at: '2026-10-09T19:42:00.000Z' } : null;
    expect(clockTickMs(computeClock(slow, NOW))).toBe(1000);
    const paused = slot ? { ...slot, deadline_at: null, remaining_ms_at_pause: 83_000 } : null;
    expect(clockTickMs(computeClock(paused, NOW))).toBeNull();
    expect(clockTickMs(null)).toBeNull();
  });

  it('while quiet hours hold the clock, waits until the window ends (capped, at least a second)', () => {
    const quiet = { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' };
    const held = slot ? { ...slot, deadline_at: '2026-10-18T04:15:00Z', quiet_hours: quiet } : null;
    const at0500 = Date.parse('2026-10-18T03:00:00Z'); // 05:00 Berlin
    expect(clockTickMs(computeClock(held, at0500), at0500)).toBe(3_600_000);
    const at0100 = Date.parse('2026-10-17T23:00:00Z'); // 5 h before the end: capped at 6 h anyway
    expect(clockTickMs(computeClock(held, at0100), at0100)).toBe(5 * 3_600_000);
    const at0559 = Date.parse('2026-10-18T03:59:59.900Z');
    expect(clockTickMs(computeClock(held, at0559), at0559)).toBe(1000);
    // Running again after 06:00: the normal cadence.
    const at0610 = Date.parse('2026-10-18T04:10:00Z'); // 5 min left
    expect(clockTickMs(computeClock(held, at0610), at0610)).toBe(250);
  });
});
