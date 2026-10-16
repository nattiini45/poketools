/**
 * Complete-at-reveal residency (D23, LOOK-PLAN §2 seat R): the pure rules.
 *
 * Before D23 the C-089 station windows DEFERRED off-route content: a group
 * mounted when the visitor first entered its `[from, to]` window and stayed
 * resident afterwards. A product decision reversed that: "I don't want anything to
 * stream in after the world appears". Every window is now resident from the
 * first render, so every GLB, program and upload lands inside the Pokéball
 * ceremony. What the window still decides is DORMANCY: content outside the
 * window (plus a one-station lead on each side) stays mounted and visible to
 * the warm pass, but stops its per-frame work (mixers, breathing).
 *
 * Nothing here imports React or three at runtime; the hooks
 * (`useStationWindow`, `use{Sakura,Mountain,Clouds}StationWindow`) and the
 * store (`residency-store.ts`) wrap these functions.
 */

/**
 * Stations of lead a window keeps awake on each side of `[from, to]`. The
 * C-089 windows were sized one station ahead of each population's first
 * on-camera station, so with this lead a group is always awake one station
 * before the camera can reach it, from either direction of travel.
 */
export const WINDOW_LEAD_STATIONS = 1;

/** True when `station` sits inside `[from, to]` (inclusive). */
export function windowInRange(station: number, from: number, to: number): boolean {
  return station >= from && station <= to;
}

/**
 * Dormant = outside `[from − lead, to + lead]` by the hysteretic nearest
 * station. A dormant group keeps its mount and its visibility; only its
 * per-frame work stops.
 */
export function windowDormant(station: number, from: number, to: number, lead: number = WINDOW_LEAD_STATIONS): boolean {
  return station < from - lead || station > to + lead;
}

/** One window's residency readout. `resident` is true from the first render (D23). */
export interface WindowResidency {
  resident: true;
  /** The visitor's station sits inside `[from, to]` (the old entry test; no longer a mount trigger). */
  inWindow: boolean;
  /** Outside the window plus its lead: mounted and visible, per-frame work stopped. */
  dormant: boolean;
}

export function windowResidency(station: number, from: number, to: number, lead: number = WINDOW_LEAD_STATIONS): WindowResidency {
  return { resident: true, inWindow: windowInRange(station, from, to), dormant: windowDormant(station, from, to, lead) };
}

/*
 * ROLLOUT-PLAN §3.2 E2: the theme worlds' visibility latch (`stepShownLatch`,
 * `themeGroupShown`) is gone. It hid a resident group after the reveal until
 * the visitor first entered its window, then flipped it visible in front of
 * them (D23 pop-in). Every group is shown from the ceremony on, as on the
 * plaza; the window decides dormancy only.
 */

/** The subset of `THREE.AnimationMixer` the frame step needs. */
export interface MixerLike {
  update(deltaSeconds: number): unknown;
}

/**
 * Largest delta one mixer step integrates (POKEMON-CORE C9, D40): equal to
 * `figure-behavior.ts` `MAX_STEP_S`, so a hitch frame never skips a clip
 * ahead and every figure clock in the director advances by the same step.
 */
export const MIXER_MAX_STEP_S = 0.1;

/**
 * One figure frame: a dormant figure's mixer does not advance (no bone
 * writes, no skinning upload churn). The delta is clamped to
 * [0, MIXER_MAX_STEP_S] (a NaN or negative delta advances 0). Returns whether
 * it advanced.
 */
export function advanceFigureMixer(mixer: MixerLike | null, deltaSeconds: number, dormant: boolean): boolean {
  if (!mixer || dormant) return false;
  const dt = Number.isFinite(deltaSeconds) ? Math.min(Math.max(deltaSeconds, 0), MIXER_MAX_STEP_S) : 0;
  mixer.update(dt);
  return true;
}

/**
 * The population ceiling a governor-driven count may reach (plan item 7).
 *
 * - While the scene loads, the ceiling follows the governor's request.
 * - From live it NEVER rises (a new instance would be a post-reveal fetch
 *   or mount), and it falls only when `shrinkAllowed` says every instance the
 *   step removes is outside the camera frustum at that moment. A consumer
 *   whose removal would re-seat the survivors (ambient walker re-allocation)
 *   or swap in a new asset (a hero GLB → sprite billboard) passes `false`:
 *   its population is frozen at reveal.
 *
 * `current` is null until the first step.
 */
export function stepPopulationCeiling(
  current: number | null,
  requested: number,
  live: boolean,
  shrinkAllowed: boolean,
): number {
  if (!live || current === null) return requested;
  if (requested >= current) return current;
  return shrinkAllowed ? requested : current;
}

/** Quiet time after the last population / preload change before residency counts as complete. */
export const RESIDENCY_QUIET_MS = 300;

export interface ResidencyCounts {
  /** Populations registered by the world (resident Suspense boundaries, staggered rows). */
  registered: number;
  /** Registered populations whose content has not committed yet. */
  pending: number;
  /** Figure / prop GLB preloads not yet settled (loaded or failed). */
  preloadsPending: number;
}

/**
 * Residency is complete once the world has registered at least one
 * population, every registered population has committed, every queued
 * preload has settled, and nothing has changed for `quietMs` (nested
 * boundaries register inside their parent's commit, so a short quiet window
 * closes the gap between one boundary resolving and its children
 * registering).
 */
export function residencySettled(counts: ResidencyCounts, lastChangeAt: number, now: number, quietMs: number = RESIDENCY_QUIET_MS): boolean {
  return counts.registered > 0 && counts.pending === 0 && counts.preloadsPending === 0 && now - lastChangeAt >= quietMs;
}
