import { describe, expect, it } from 'vitest';
import { GOVERNOR, governorInLoadGrace } from '../quality';
import { BALL_TIMING, HANDOFF_COMPOSITE } from '../ball-loader-state';

/**
 * W7 — the frame governor must not spend a rung (it never climbs back) on
 * compile/upload hitches while the scene loads or right after it presents.
 */
describe('GOVERNOR load grace', () => {
  it('holds while the scene has not presented', () => {
    expect(governorInLoadGrace(null)).toBe(true);
  });

  it('holds for loadGraceMs after presented, then counts again', () => {
    expect(governorInLoadGrace(0)).toBe(true);
    expect(governorInLoadGrace(GOVERNOR.loadGraceMs - 1)).toBe(true);
    expect(governorInLoadGrace(GOVERNOR.loadGraceMs)).toBe(false);
  });

  it('covers the whole reveal window (the full ceremony with its flight + the handoff composite frames)', () => {
    // D23: the gate has no assets cap any more (it arms on the complete
    // world), so the grace covers the ceremony itself with generous slack.
    const compositeFrames = HANDOFF_COMPOSITE.fallbackFrames * 50;
    expect(GOVERNOR.loadGraceMs).toBeGreaterThanOrEqual(BALL_TIMING.flightMs + BALL_TIMING.openMs + compositeFrames);
    expect(GOVERNOR.loadGraceMs).toBe(4000);
  });

  it('stays short enough that a genuinely slow device still steps down promptly', () => {
    expect(GOVERNOR.loadGraceMs).toBeLessThanOrEqual(5000);
  });
});
