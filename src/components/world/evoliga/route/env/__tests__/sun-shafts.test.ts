import { describe, expect, it } from 'vitest';
import { QUALITY_LADDER } from '@/lib/route-world/quality';
import { SHAFT_MAX, SHAFT_MAX_LINEAR, plazaShaftSeats } from '@/lib/route-world/light-shafts';
import { SHAFT_FRAGMENT, SHAFT_VERTEX, shaftColorLinear, shaftCount, shaftStrength } from '../SunShafts';

/**
 * LOOK-PLAN §2 SEAT M item 1 — the rules shafts' runtime contract: count
 * follows `quality.lightShafts` (a draw-count change only), the additive
 * ceiling is +0.08 linear per channel, off at night, calm-masked, static.
 */
describe('SunShafts', () => {
  it('count follows quality.lightShafts on every rung, capped by the seated table', () => {
    const seats = plazaShaftSeats();
    const counts = QUALITY_LADDER.map((step) => shaftCount(step.lightShafts, seats));
    expect(counts[0]).toBe(Math.min(3, seats.length));
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    // R6 E9: rung 2 keeps one shaft (the hero seat), none from rung 3 down.
    expect(counts[2]).toBeLessThanOrEqual(1);
    expect(counts.slice(3)).toEqual([0, 0]);
    expect(shaftCount(99, seats)).toBeLessThanOrEqual(SHAFT_MAX);
    expect(shaftCount(-1, seats)).toBe(0);
  });

  it('strength never exceeds the cap, scales with the station key and is 0 at night', () => {
    expect(shaftStrength(1, false)).toBeCloseTo(SHAFT_MAX_LINEAR);
    expect(shaftStrength(5, false)).toBeLessThanOrEqual(SHAFT_MAX_LINEAR);
    expect(shaftStrength(0.5, false)).toBeCloseTo(SHAFT_MAX_LINEAR * 0.5);
    expect(shaftStrength(1, true)).toBe(0);
    const c = shaftColorLinear();
    expect(Math.max(c.r, c.g, c.b)).toBeCloseTo(1, 6);
    for (const channel of [c.r, c.g, c.b]) expect(channel * shaftStrength(1, false)).toBeLessThanOrEqual(SHAFT_MAX_LINEAR + 1e-9);
  });

  it('is calm-masked, fog-free by construction and static (no time term)', () => {
    expect(SHAFT_FRAGMENT).toContain('calmAt( gl_FragCoord.xy )');
    expect(SHAFT_FRAGMENT).toContain('( 1.0 - calm )');
    for (const src of [SHAFT_VERTEX, SHAFT_FRAGMENT]) expect(src).not.toMatch(/uTime/);
  });
});
