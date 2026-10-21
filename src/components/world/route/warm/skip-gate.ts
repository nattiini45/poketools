'use client';

import { useEffect, useState } from 'react';
import { useWorldHandoff, useWorldState } from '../WorldStateProvider';
import { type SkipThrough, skipThroughOf } from '../useScrollConductor';
import { MOUNT_SLICE_BUDGET_MS, MOUNT_SLICE_TIMEOUT_MS, onIdleSlice } from './staggered-mount';
import { type IdleHandle, STATION_LEAD_IDLE_MS } from './station-lead';

/**
 * The skip-through window gate and the window-latch queue.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

// ── Skip-through window gate (wave 2, W6 residual 1) ───────────────────────
//
// A nav-chip jump lands the nearest station on the target in one sample, so
// every window containing the target used to latch at once, mid-flight — the
// plaza pulse → schedule jump froze 250–267 ms as the roster/teams
// populations it only skims past mounted. While the conductor's skip-through
// (`skipThroughOf`) is in flight each window is classified once per jump by
// the station its population belongs to (`windowStation`):
// - `target` — the jump's target: latches once `smooth` has covered
//   SKIP_APPROACH of the jump, through the shared latch queue (one window per
//   idle slice, at least a frame apart; the compile guard and the warm
//   window then hold and warm it before its first draw);
// - `passed` — strictly between the start and the target: never latches
//   during the jump, nor at its landing. It resumes latching (queued) when
//   the visitor's station changes, or (so the residency the control capture
//   expects still arrives) after resting STATION_LEAD_IDLE_MS on the landing
//   station with the route live — through the same queue, never a burst;
// - `other` (a prefetch window beyond the target, or one behind the start) —
//   held until the jump ends, then queued.
// A jump released by visitor input (wheel / touch / key, or a scroll off the
// target) is no longer a skip: the camera resumes flying the real path, so
// every held or passed window that wants to latch is queued at once — normal
// latching, minus the burst. A second chip click re-aims: the new jump
// re-classifies every window.
//
// Honest limits: the classification is by ONE station per window, supplied
// by the window hook (plaza: `from + 1`, its C-089 one-station-lead contract;
// themes: `from`). A population that belongs to several stations (a window
// sized for content seen from two of them) is gated by the one it names.
// The gate moves WHEN a latch commits, not what that commit costs.

/** A window's role in the skip in flight. */
export type SkipWindowRole = 'target' | 'passed' | 'other';

/** Classify a window's station against a jump from `from` (smooth) to `to`. */
export function skipWindowRole(from: number, to: number, windowStation: number): SkipWindowRole {
  if (windowStation === to) return 'target';
  const start = Math.round(from);
  const lo = Math.min(start, to);
  const hi = Math.max(start, to);
  return windowStation > lo && windowStation < hi ? 'passed' : 'other';
}

/**
 * Gate modes: `free` = latching is the window's own business (open);
 * `target` / `held` / `passed` = closed for the jump in flight (see above);
 * `queued` = waiting for its turn in the latch queue.
 */
export type SkipGateMode = 'free' | 'target' | 'held' | 'passed' | 'queued';

export interface SkipGateState {
  mode: SkipGateMode;
  /** The skip token this state has classified (or adopted). */
  token: number;
  /** The station a `passed` window was skipped at (the jump's target). */
  landing: number;
}

/** The skip-through fields the gate reads. */
export type SkipView = Pick<SkipThrough, 'token' | 'active' | 'approaching' | 'from' | 'to' | 'end'>;

export interface SkipGateInput {
  skip: SkipView;
  /** The window would latch now without the gate (entry or lead). */
  want: boolean;
  /** Already latched: nothing left to gate. */
  done: boolean;
  /** The visitor's nearest station. */
  station: number;
  /** The station this window's population belongs to. */
  windowStation: number;
}

/** Initial gate for a window mounting now (an active skip is classified on the first step). */
export function initSkipGate(skip: SkipView): SkipGateState {
  return { mode: 'free', token: skip.active ? -1 : skip.token, landing: skip.to };
}

/**
 * One pure step of the gate. Idempotent — stepping its own output again
 * returns that same object — and it returns `state` itself when nothing
 * changes, so a hook can derive it during render and commit it in an effect.
 */
export function stepSkipGate(state: SkipGateState, input: SkipGateInput): SkipGateState {
  const { skip } = input;
  if (input.done) {
    return state.mode === 'free' && state.token === skip.token ? state : { mode: 'free', token: skip.token, landing: state.landing };
  }
  let s = state;
  if (skip.token !== s.token) {
    if (skip.active) {
      const role = skipWindowRole(skip.from, skip.to, input.windowStation);
      s = { mode: role === 'other' ? 'held' : role, token: skip.token, landing: skip.to };
    } else {
      // A jump that began and ended between two reads: adopt it; any gate
      // still closed for an older jump resolves below as ended.
      s = { ...s, token: skip.token };
    }
  }
  const ended = !skip.active;
  switch (s.mode) {
    case 'target':
      if (!ended && !skip.approaching) return s;
      return { ...s, mode: input.want ? 'queued' : 'free' };
    case 'held':
      if (!ended) return s;
      return { ...s, mode: input.want ? 'queued' : 'free' };
    case 'passed':
      if (!ended) return s;
      // Released mid-flight: the camera flies the real path through this
      // station after all — resume normally (queued, no burst).
      if (skip.end !== 'landed') return { ...s, mode: input.want ? 'queued' : 'free' };
      // Landed: stay closed until the visitor moves on (or the rest latch),
      // then queue — several skipped windows resuming on one station change
      // must not commit together.
      if (input.station !== s.landing) return { ...s, mode: input.want ? 'queued' : 'free' };
      return s;
    default:
      return s;
  }
}

/** Whether the gate lets the window latch now. */
export function skipGateOpen(state: SkipGateState): boolean {
  return state.mode === 'free';
}

// The shared latch queue: one granted window per idle slice, and at least a
// frame between two grants, so the commits (and first draws) of windows that
// resume together never share a frame.
const latchQueue: Array<() => void> = [];
let latchPump: IdleHandle | null = null;
let latchFrameWait = false;

function nextFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => callback());
  else window.setTimeout(callback, 16);
}

function pumpLatchQueue(): void {
  if (latchPump || latchFrameWait || latchQueue.length === 0) return;
  latchPump = onIdleSlice(
    () => {
      latchPump = null;
      const job = latchQueue.shift();
      job?.();
      latchFrameWait = true;
      nextFrame(() => {
        latchFrameWait = false;
        pumpLatchQueue();
      });
    },
    MOUNT_SLICE_BUDGET_MS,
    MOUNT_SLICE_TIMEOUT_MS,
  );
}

/** Queue one window latch; returns a cancel (a no-op once granted). */
export function enqueueWindowLatch(grant: () => void): () => void {
  const job = () => grant();
  latchQueue.push(job);
  pumpLatchQueue();
  return () => {
    const index = latchQueue.indexOf(job);
    if (index >= 0) latchQueue.splice(index, 1);
  };
}

/** Queued (not yet granted) window latches — a debug readout and a test hook. */
export function queuedWindowLatches(): number {
  return latchQueue.length;
}

export function resetWindowLatchQueueForTests(): void {
  latchQueue.length = 0;
  latchPump?.cancel();
  latchPump = null;
  latchFrameWait = false;
}

/**
 * The skip-through gate of one residency window (see the section note).
 * `want` is the window's own latch condition (entry or lead), `done` whether
 * it has latched. Returns whether it may latch now plus the gate mode for
 * the windows' diagnosis readouts.
 */
export function useSkipGate(
  windowStation: number,
  want: boolean,
  done: boolean,
  station: number,
): { open: boolean; mode: SkipGateMode } {
  const { conductor } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const [skip, setSkip] = useState<SkipView>(() => skipThroughOf(conductor.progress.current));
  // Same change channel as the station index: the jump sample marks the skip
  // before notifying, so the skip and the jumped station arrive in ONE commit.
  useEffect(() => {
    const read = () => {
      const next = skipThroughOf(conductor.progress.current);
      setSkip((current) => (current === next ? current : next));
    };
    read();
    return conductor.subscribe(read);
  }, [conductor]);

  const [gate, setGate] = useState<SkipGateState>(() => initSkipGate(skip));
  const next = stepSkipGate(gate, { skip, want, done, station, windowStation });
  // Derived during render (React's "adjust state while rendering" pattern):
  // the step is idempotent, so this settles in one extra render pass and the
  // caller's latch effect never sees a stale open gate.
  if (next !== gate) setGate(next);

  // Queued: wait for a grant from the shared latch queue.
  const queued = next.mode === 'queued';
  useEffect(() => {
    if (!queued) return;
    return enqueueWindowLatch(() => setGate((g) => (g.mode === 'queued' ? { ...g, mode: 'free' } : g)));
  }, [queued]);

  // Rest latch for a window the jump skipped: after STATION_LEAD_IDLE_MS at
  // rest on the landing station (route live), queue it like any other.
  const restArmed = next.mode === 'passed' && !skip.active && routeSceneLive;
  const restToken = next.token;
  const restStation = next.landing;
  useEffect(() => {
    if (!restArmed) return;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        const progress = conductor.progress.current;
        if (progress.direction !== 0 || progress.nearest !== restStation || skipThroughOf(progress).active) {
          arm();
          return;
        }
        setGate((g) => (g.mode === 'passed' && g.token === restToken ? { ...g, mode: 'queued' } : g));
      }, STATION_LEAD_IDLE_MS);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [restArmed, restToken, restStation, conductor]);

  return { open: skipGateOpen(next), mode: next.mode };
}
