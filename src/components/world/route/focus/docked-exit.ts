import type { FocusPhase } from './focus-store';

/**
 * Docked panel exit (W6 round 3) — the parts of ContextOverlay's close that
 * can be tested without a DOM.
 *
 * Two defects the round-2 panel sweeps measured:
 *
 * 1. The panel left LATE. The camera starts home the frame the focus store
 *    enters `releasing`, but the panel only learned about the close when the
 *    search param cleared — a `router.replace` round trip that measured
 *    0.75–1.9 s under `next dev`. For that whole time the panel sat fully
 *    open over a camera that had already left.
 * 2. The exit was not seen. The param change lands as a heavy React commit;
 *    the exit started inside it, so the main thread was blocked for the
 *    animation's whole 240 ms: rAF samplers saw one frame at the settled rect
 *    and the next with the panel gone, and the fallback timer (not
 *    `animationend`) finished it.
 *
 * The fix starts the exit on the store's `releasing` edge (the release
 * latch below), before the param work, so the panel and camera leave
 * together on an idle main thread. The param clearing later finds the exit
 * already running (or done) and changes nothing on screen.
 */

/**
 * Release latch: true from the frame the focus store enters `releasing` while
 * a docked panel is open, until the panel's param clears (the close caught
 * up) or a subject is focused again (re-opened mid-exit). The camera reaching
 * home (`idle`) before the param clears must NOT re-open the panel, so the
 * latch holds through `idle`.
 */
export function nextReleaseLatch(
  latched: boolean,
  input: { docked: boolean; isOpen: boolean; phase: FocusPhase },
): boolean {
  const { docked, isOpen, phase } = input;
  if (!docked || !isOpen) return false;
  if (phase === 'focusing' || phase === 'focused') return false;
  if (phase === 'releasing') return true;
  return latched;
}

/** The minimal dialog surface the exit drives (an HTMLDialogElement). */
export interface ExitDialog {
  readonly open: boolean;
  readonly offsetWidth: number;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: 'animationend', listener: (event: { target: unknown; animationName: string }) => void): void;
  removeEventListener(type: 'animationend', listener: (event: { target: unknown; animationName: string }) => void): void;
  close(): void;
}

export type ExitFinish = 'animationend' | 'fallback';

/** The exit keyframes the panel runs while `data-closing` is set (globals.css W6 block). */
export const EXIT_ANIMATION = /^world-focus-panel-(out|fade-out)/;

export interface ExitTimers {
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

/**
 * Play the exit to the dock edge, then close. Returns a cancel (re-opened
 * mid-exit, or unmounted) that drops `data-closing` so the entry replays.
 * `done` runs exactly once, with how the exit finished.
 */
export function startDockedExit(
  dialog: ExitDialog,
  fallbackMs: number,
  done: (via: ExitFinish) => void,
  timers: ExitTimers = window,
): () => void {
  let active = true;
  const cleanup = () => {
    active = false;
    timers.clearTimeout(timer);
    dialog.removeEventListener('animationend', handleEnd);
  };
  const finish = (via: ExitFinish) => {
    if (!active) return;
    cleanup();
    dialog.removeAttribute('data-closing');
    if (dialog.open) dialog.close();
    done(via);
  };
  const handleEnd = (event: { target: unknown; animationName: string }) => {
    if (event.target === dialog && EXIT_ANIMATION.test(event.animationName)) finish('animationend');
  };
  const timer = timers.setTimeout(() => finish('fallback'), fallbackMs);
  dialog.addEventListener('animationend', handleEnd);
  // Flush style before the attribute flips, so the running entry animation
  // (a tap-and-release inside 280 ms) is resolved and the exit keyframes
  // start from the panel's current computed state rather than being
  // coalesced into the same style pass.
  void dialog.offsetWidth;
  dialog.setAttribute('data-closing', '');
  return () => {
    if (!active) return;
    cleanup();
    dialog.removeAttribute('data-closing');
  };
}
