/**
 * The recorders of the local-stack eval stages (plan 7.2 "Side effects"): the Discord and social senders and the cache-expiry
 * helpers are replaced by stubs (`scripts/tsconfig.admin-agent-eval.json` maps their module paths to the files next to this one)
 * that write here instead of sending anything. The grader reads what they recorded: which events fired, in which order, and
 * whether any fired before the first approve click.
 *
 * The state lives on `globalThis` under a symbol so the stub modules and the harness see one log however the loader resolved
 * them. Nothing here reaches a network, a database or a webhook.
 */
import type { RecorderEvent } from '../types';

const LOG = Symbol.for('poketools.admin-agent-eval.recorders');

interface RecorderState {
  /** Everything recorded since `startRecording`, in order. */
  events: RecorderEvent[];
  /** How many events were recorded when the first approve click began; `null` until it does. */
  approveAt: number | null;
  /** Whether a run is going on. Calls outside one (module load, a stray script) are dropped, not collected. */
  active: boolean;
}

function state(): RecorderState {
  const holder = globalThis as unknown as Record<symbol, RecorderState | undefined>;
  holder[LOG] ??= { events: [], approveAt: null, active: false };
  return holder[LOG];
}

/** Starts a clean recording for one case. */
export function startRecording(): void {
  const s = state();
  s.events = [];
  s.approveAt = null;
  s.active = true;
}

/** Ends the recording and returns what it held, split at the first approve click. */
export function stopRecording(): { beforeApprove: RecorderEvent[]; afterApprove: RecorderEvent[] } {
  const s = state();
  s.active = false;
  const at = s.approveAt ?? s.events.length;
  return { beforeApprove: s.events.slice(0, at), afterApprove: s.events.slice(at) };
}

/** Marks the start of the first approve click (later calls keep the first mark). */
export function markApproveStarted(): void {
  const s = state();
  s.approveAt ??= s.events.length;
}

/** The number of events recorded so far, for tests. */
export function recordedCount(): number {
  return state().events.length;
}

/** What the stubs call. */
export function record(event: RecorderEvent): void {
  const s = state();
  if (s.active) s.events.push(event);
}
