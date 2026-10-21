import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESIDENCY_QUIET_MS,
  WINDOW_LEAD_STATIONS,
  advanceFigureMixer,
  residencySettled,
  stepPopulationCeiling,
  windowDormant,
  windowResidency,
} from '../residency';

/**
 * D23 complete-at-reveal residency (LOOK-PLAN §2 seat R): every window is
 * resident from t0 and shown from the ceremony on; the window only decides
 * dormancy (ROLLOUT-PLAN §3.2 E2 removed the theme worlds' visibility latch).
 */

const STATIONS = [0, 1, 2, 3, 4] as const;

/** Every window the four worlds declare today (call sites of the window hooks). */
const WINDOWS: readonly { world: string; name: string; from: number; to: number }[] = [
  { world: 'plaza', name: 'teams aces', from: 1, to: 3 },
  { world: 'plaza', name: 'hero props', from: 2, to: 4 },
  { world: 'plaza', name: 'gate crests', from: 2, to: 4 },
  ...(['sakura', 'mountain', 'clouds'] as const).flatMap((world) => [
    { world, name: 'pulse group', from: 0, to: 4 },
    { world, name: 'wilds 1', from: 1, to: 4 },
    { world, name: 'wilds 2', from: 2, to: 4 },
    { world, name: 'wilds 3', from: 3, to: 4 },
    { world, name: 'wilds 4 / props', from: 4, to: 4 },
  ]),
];

describe('residency: every window is resident at t0', () => {
  it.each(WINDOWS)('$world $name [$from,$to] is resident from every load station', ({ from, to }) => {
    for (const station of STATIONS) {
      expect(windowResidency(station, from, to).resident).toBe(true);
    }
  });
});

describe('residency: dormancy per station', () => {
  it('is awake inside the window and its one-station lead, dormant beyond', () => {
    expect(WINDOW_LEAD_STATIONS).toBe(1);
    // A rules-only group [4,4]: awake at schedule (lead) and rules, dormant at pulse..teams.
    expect(STATIONS.map((s) => windowDormant(s, 4, 4))).toEqual([true, true, true, false, false]);
    // A roster group [1,4]: awake everywhere (pulse is its lead station).
    expect(STATIONS.map((s) => windowDormant(s, 1, 4))).toEqual([false, false, false, false, false]);
    // A pulse-only group [0,0]: dormant from teams on.
    expect(STATIONS.map((s) => windowDormant(s, 0, 0))).toEqual([false, false, true, true, true]);
  });

  it('the lead wakes a group one station ahead, from either direction', () => {
    // [2,2]: travelling down, the group wakes at roster (1) before teams (2);
    // travelling up, it wakes at schedule (3).
    expect(windowDormant(0, 2, 2)).toBe(true);
    expect(windowDormant(1, 2, 2)).toBe(false);
    expect(windowDormant(3, 2, 2)).toBe(false);
    expect(windowDormant(4, 2, 2)).toBe(true);
    // Without a lead the same group would still be asleep one station out.
    expect(windowDormant(1, 2, 2, 0)).toBe(true);
  });

  it('reports inWindow as the old entry test, never as a mount', () => {
    expect(windowResidency(0, 2, 4)).toEqual({ resident: true, inWindow: false, dormant: true });
    expect(windowResidency(3, 2, 4)).toEqual({ resident: true, inWindow: true, dormant: false });
  });
});

describe('residency: dormant figures do no frame work', () => {
  it('does not advance a dormant mixer', () => {
    let advanced = 0;
    const mixer = { update: (dt: number) => (advanced += dt) };
    expect(advanceFigureMixer(mixer, 0.016, true)).toBe(false);
    expect(advanced).toBe(0);
    expect(advanceFigureMixer(mixer, 0.016, false)).toBe(true);
    expect(advanced).toBeCloseTo(0.016);
    expect(advanceFigureMixer(null, 0.016, false)).toBe(false);
  });
});

describe('residency: governor population ceiling (plan item 7)', () => {
  it('follows the governor while loading', () => {
    expect(stepPopulationCeiling(null, 10, false, false)).toBe(10);
    expect(stepPopulationCeiling(10, 3, false, false)).toBe(3);
  });

  it('never adds after live', () => {
    expect(stepPopulationCeiling(3, 10, true, true)).toBe(3);
  });

  it('removes after live only when the removed instances are off-camera', () => {
    expect(stepPopulationCeiling(10, 3, true, false)).toBe(10);
    expect(stepPopulationCeiling(10, 3, true, true)).toBe(3);
  });
});

describe('residency: completion rule', () => {
  const settled = { registered: 4, pending: 0, preloadsPending: 0 };
  it('needs a registered world, nothing pending and a quiet window', () => {
    expect(residencySettled(settled, 0, RESIDENCY_QUIET_MS)).toBe(true);
    expect(residencySettled(settled, 0, RESIDENCY_QUIET_MS - 1)).toBe(false);
    expect(residencySettled({ ...settled, registered: 0 }, 0, 10_000)).toBe(false);
    expect(residencySettled({ ...settled, pending: 1 }, 0, 10_000)).toBe(false);
    expect(residencySettled({ ...settled, preloadsPending: 1 }, 0, 10_000)).toBe(false);
  });
});

describe('residency: the window hooks no longer latch', () => {
  const root = path.resolve(__dirname, '../../../..');
  const hooks = [
    'src/components/world/evoliga/route/useStationWindow.ts',
    'src/components/world/themes/sakura/furniture/useSakuraStationWindow.ts',
    'src/components/world/themes/mountain/furniture/useMountainStationWindow.ts',
    'src/components/world/themes/clouds/furniture/useCloudsStationWindow.ts',
  ];
  it.each(hooks)('%s drops the idle lead, the skip gate and the per-window warm compile', (file) => {
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const name of ['useStationLead', 'useSkipGate', 'useWarmCompile']) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\(`));
    }
    // ENGINE r2: the flags come from `useWindowFlags` (residency-store),
    // which applies `windowResidency` and re-renders only on a flip.
    expect(source).toMatch(/useWindowFlags\(/);
    // ROLLOUT-PLAN §3.2 E2: no visibility latch after the reveal (D23 pop-in).
    expect(source).not.toMatch(/stepShownLatch|themeGroupShown|useRevealArmedTransition/);
  });
});
