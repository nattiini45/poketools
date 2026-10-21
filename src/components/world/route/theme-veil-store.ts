/**
 * D32 — the theme veil's host (module scope, like the readiness stores): it
 * owns the one `ThemeVeilState`, steps the pure sequencer
 * (`@/lib/route-world/theme-veil`) once per animation frame while the veil is
 * not idle, and mirrors the phase onto `<html data-route-veil>` — the CSS
 * (globals.css, D32 block) fades the veil layer on the compositor from that
 * attribute alone, so a busy main thread can never stall the fade itself.
 *
 * The provider's palette observer asks for the veil (`requestThemeVeil`) with
 * the commit it defers; this store calls that commit on the first frame after
 * the veil turned fully opaque. `HideHtmlOnRoute` keeps the page handoff
 * while the veil is up, and aborts it on any flip to Lite.
 */
import {
  THEME_VEIL_IDLE,
  stepThemeVeil,
  veilActive,
  veilBallSettled,
  veilCommitDue,
  veilHoldsWorldDraws,
  type ThemeVeilEvent,
  type ThemeVeilPhase,
  type ThemeVeilState,
} from '@/lib/route-world/theme-veil';
import {
  getBallPhase,
  getBallPhaseSince,
  getRenderedFrames,
  getRevealArmedAt,
  hasBallLoader,
  markVeiledGeneration,
} from './scene-progress';
import { currentSceneGeneration } from './world-readiness';

/** `<html data-route-veil="in|opaque|out">` while the veil is up. */
export const ROUTE_VEIL_ATTR = 'data-route-veil';

export interface ThemeVeilTraceEntry {
  phase: ThemeVeilPhase | 'commit' | 'cancel' | 'abort';
  t: number;
  generation: number | null;
  committed: boolean;
}

const TRACE_MAX = 64;

let state: ThemeVeilState = THEME_VEIL_IDLE;
let target: 'day' | 'night' | null = null;
let pendingCommit: (() => void) | null = null;
let frame = 0;
let trace: ThemeVeilTraceEntry[] = [];
const listeners = new Set<() => void>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function note(phase: ThemeVeilTraceEntry['phase']): void {
  trace.push({ phase, t: now(), generation: state.generation, committed: state.committed });
  if (trace.length > TRACE_MAX) trace = trace.slice(-TRACE_MAX);
}

function writeAttr(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (state.phase === 'idle') root.removeAttribute(ROUTE_VEIL_ATTR);
  else root.setAttribute(ROUTE_VEIL_ATTR, state.phase);
}

function apply(event: ThemeVeilEvent): void {
  const prev = state;
  const next = stepThemeVeil(prev, event);
  if (next === prev) return;
  state = next;
  if (next.phase !== prev.phase) {
    note(next.phase);
    writeAttr();
  } else if (next.committed !== prev.committed) {
    note('commit');
  }
  if (next.phase === 'idle') {
    pendingCommit = null;
    target = null;
  }
  for (const listener of listeners) listener();
  schedule();
}

function tick(): void {
  frame = 0;
  const at = now();
  if (veilCommitDue(state, at) && pendingCommit !== null) {
    const commit = pendingCommit;
    pendingCommit = null;
    // The commit calls back into `noteThemeVeilCommitted` or `cancelThemeVeil`.
    commit();
  }
  apply({
    type: 'tick',
    now: at,
    generation: currentSceneGeneration(),
    armedAt: getRevealArmedAt(),
    ballSettled: veilBallSettled({ hasBall: hasBallLoader(), phase: getBallPhase(), since: getBallPhaseSince(), now: at, dprClamp: dprClampPossible() }),
    ballRevealing:
      hasBallLoader() &&
      (getBallPhase() === 'opening' || getBallPhase() === 'releasing' || (getBallPhase() === 'loading' && getRevealArmedAt() !== null)),
    frames: getRenderedFrames(),
  });
  schedule();
}

function schedule(): void {
  if (typeof window === 'undefined') return;
  if (!veilActive(state)) {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
    return;
  }
  if (frame === 0) frame = window.requestAnimationFrame(tick);
}

/**
 * ENGINE-FIX (D32): the ceremony DPR clamp (QualityGovernor) caps the buffer
 * at the ladder floor's DPR (1) while the ball is up — a no-op unless the
 * device-pixel ratio is above 1.
 */
function dprClampPossible(): boolean {
  return typeof window !== 'undefined' && window.devicePixelRatio > 1;
}

function reducedMotionNow(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Fade the veil in and run `commit` on the first frame after it is fully
 * opaque. A later request while the veil fades in keeps the FIRST commit
 * (it re-reads the DOM when it runs, so it swaps to whatever is current then).
 */
export function requestThemeVeil(input: { target: 'day' | 'night'; commit: () => void }): void {
  target = input.target;
  pendingCommit = input.commit;
  apply({ type: 'request', now: now(), reducedMotion: reducedMotionNow() });
}

/** The deferred (or immediate) swap began `generation` behind the opaque veil. */
export function noteThemeVeilCommitted(generation: number, nextTarget?: 'day' | 'night'): void {
  if (nextTarget) target = nextTarget;
  // ENGINE-FIX (D32): no visible ceremony to stand aside for under the veil.
  markVeiledGeneration(generation);
  apply({ type: 'commit', now: now(), generation });
}

/** The theme flipped back before the swap was committed: fade back out. */
export function cancelThemeVeil(): void {
  pendingCommit = null;
  const before = state;
  apply({ type: 'cancel', now: now() });
  if (state !== before) note('cancel');
}

/** Lite / unmount: the veil goes at once (the page is the fallback). */
export function abortThemeVeil(): void {
  if (state.phase === 'idle') return;
  note('abort');
  apply({ type: 'abort' });
}

export function getThemeVeilState(): ThemeVeilState {
  return state;
}

export function getThemeVeilPhase(): ThemeVeilPhase {
  return state.phase;
}

/** ENGINE-FIX (D32): the world's draws are held (see `veilHoldsWorldDraws`). */
export function themeVeilHoldsWorldDraws(): boolean {
  return veilHoldsWorldDraws(state);
}

export function getThemeVeilTarget(): 'day' | 'night' | null {
  return target;
}

export function getThemeVeilTrace(): ThemeVeilTraceEntry[] {
  return trace.map((entry) => ({ ...entry }));
}

export function subscribeThemeVeil(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * ENGINE-FIX (D32): hooks run behind the opaque veil just BEFORE a swap
 * commits (the palette state and the new generation). The canvas registers
 * one to keep the leaving palette's programs alive through the swap's commit
 * (`captureThemeSwap`), so its successors compile from three's program cache
 * instead of re-linking.
 */
export type ThemeSwapHook = (swap: { fromKey: string | null; toKey: string }) => void;

const swapHooks = new Set<ThemeSwapHook>();

export function registerThemeSwapHook(hook: ThemeSwapHook): () => void {
  swapHooks.add(hook);
  return () => {
    swapHooks.delete(hook);
  };
}

/** The provider, behind the opaque veil, right before it begins the swap's generation. */
export function runThemeSwapHooks(swap: { fromKey: string | null; toKey: string }): void {
  // The swap's generation is the next one (`beginSceneGeneration` follows).
  markVeiledGeneration(currentSceneGeneration() + 1);
  for (const hook of [...swapHooks]) {
    try {
      hook(swap);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('[theme-veil] swap hook failed', error);
    }
  }
}

/** Tests only. */
export function resetThemeVeilForTests(): void {
  if (frame !== 0 && typeof window !== 'undefined') window.cancelAnimationFrame(frame);
  frame = 0;
  state = THEME_VEIL_IDLE;
  target = null;
  pendingCommit = null;
  trace = [];
  writeAttr();
}
