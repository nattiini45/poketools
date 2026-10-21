'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useStore, useThree } from '@react-three/fiber';
import { getBallPhase, hasBallLoader } from '../scene-progress';
import {
  clearLeftoverFrames,
  createDrivenClock,
  createFrameCapState,
  driveClock,
  FRAME_CAP_MODES,
  frameCapDuringCeremony,
  type FrameCapMode,
  frameCapMode,
  frameCapReadout,
  noteFrameCapCredit,
  noteFrameCapDriver,
  noteParkedFrame,
  onDrivenFrameloopChange,
  restartDrivenClock,
  setFrameCapMode,
  stepFrameCap,
} from '../frame-cap';
import { getThemeVeilPhase } from '../theme-veil-store';

/**
 * The D38 / D40 frame-cap driver (see frame-cap.ts).
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * D38 frame-cap window (see frame-cap.ts): after the reveal — the ball done
 * (or no ball) and no theme veil up — or, with the dev switch
 * `?routeFrameCapCeremony=1`, from the first frame.
 */
function frameCapWindowOpen(): boolean {
  if (frameCapDuringCeremony()) return true;
  if (getThemeVeilPhase() !== 'idle') return false;
  return !hasBallLoader() || getBallPhase() === 'done';
}

type FrameCapHost = Window & {
  __routeFrameCap?: { readout: () => ReturnType<typeof frameCapReadout>; set: (mode: FrameCapMode) => boolean };
};

/**
 * D38 / D40 frame-cap driver (ENGINE-A4; frame-cap.ts). Mounted unless the page
 * opted out (`?routeFrameCap=off`; D40: `even40` is the default): the canvas
 * then runs r3f's `frameloop="never"` and this rAF advances it — every rAF
 * inside the
 * ceremony, and after the reveal only the frames the mode keeps. A skipped rAF
 * does the cap's bookkeeping and nothing else. The r3f clock is advanced on
 * the rAF timestamp from the driver's start (seconds), so frame deltas and
 * elapsed time stay continuous. Debug / dev: `window.__routeFrameCap`.
 */
export function FrameCapDriver({ enabled }: { enabled: boolean }) {
  const get = useThree((state) => state.get);
  /**
   * The driven clock, kept across park / unpark (ENGINE-A4R, verify-a4: a
   * run that restarted at 0 handed r3f a negative delta and rewound every
   * clip mixer). See `driveClock` in frame-cap.ts.
   */
  const [clock] = useState(createDrivenClock);
  const store = useStore();
  /**
   * ENGINE-A5 fix (verify-a5: an unpark handed every mixer a ~29,584 s delta).
   * r3f's own rAF loop must never advance this root under `never`: the
   * listener runs synchronously inside r3f's `setFrameloop` (before any rAF),
   * clears the parked `demand` loop's leftover frames and keeps the clock
   * continuous across park / unpark (`onDrivenFrameloopChange`). Mounted for
   * the canvas's life, parked or not.
   */
  useLayoutEffect(() => {
    clearLeftoverFrames(store.getState());
    return store.subscribe((next, previous) => {
      if (next.frameloop !== previous.frameloop) onDrivenFrameloopChange(clock, next, previous.frameloop, performance.now());
    });
  }, [clock, store]);
  // Parked (`demand`) frames: the clock the unpark resumes from.
  useFrame((root) => {
    if (root.frameloop !== 'never') noteParkedFrame(clock, root.clock.elapsedTime, performance.now());
  });
  useEffect(() => {
    if (!enabled) return;
    const state = createFrameCapState();
    noteFrameCapDriver(true, state, clock);
    clearLeftoverFrames(get());
    restartDrivenClock(clock);
    let raf = 0;
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick);
      const root = get();
      // Every rAF, rendered or skipped: r3f's loop never runs this root under `never`.
      clearLeftoverFrames(root);
      if (!stepFrameCap(state, ts, frameCapMode(), frameCapWindowOpen())) return;
      noteFrameCapCredit(state.creditMs);
      const { seconds, seat } = driveClock(clock, ts, root.clock.elapsedTime);
      if (seat !== null) root.clock.elapsedTime = seat;
      root.advance(seconds, true);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      noteFrameCapDriver(false, null);
    };
  }, [clock, enabled, get]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && new URLSearchParams(window.location.search).get('routeDebug') !== '1') return;
    const host = window as FrameCapHost;
    host.__routeFrameCap = {
      readout: frameCapReadout,
      set: (mode: FrameCapMode) => {
        if (!FRAME_CAP_MODES.includes(mode)) return false;
        setFrameCapMode(mode);
        return true;
      },
    };
    return () => {
      delete host.__routeFrameCap;
    };
  }, []);
  return null;
}
