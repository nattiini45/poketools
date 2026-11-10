/**
 * Motion tokens — the single numeric source for every animation in the app.
 *
 * Pure data with no client-only imports, so server components, the `motion`
 * presets in `src/components/shared/motion.tsx`, and the Three.js route world
 * all read the same constants. Documented in `docs/design.md` § Motion Tokens.
 *
 * Durations are seconds (the unit the `motion` library takes). Easing curves
 * are cubic-bezier control points in the array form `motion` accepts, which is
 * also directly usable as a CSS `cubic-bezier()` argument list.
 */

/** Duration scale, in seconds, by the job the motion is doing. */
export const DURATION = {
  /** No tween: the end state at once. For reduced motion on properties `MotionConfig` leaves alone (height). */
  instant: 0,
  /** Hover, press, and any feedback that must feel instantaneous. */
  micro: 0.14,
  /** Toggle, select, and other discrete state changes. */
  state: 0.22,
  /** Popovers, toasts, dialogs. */
  overlay: 0.28,
  /** A page section arriving on scroll. */
  section: 0.56,
  /** Multi-beat hero sequences. */
  hero: 1.1,
} as const;

/**
 * Easing curves. Entering motion decelerates, exiting motion accelerates and
 * is faster — the pair is mirrored so a reversible transition retraces its
 * own path.
 */
export const EASE = {
  /** Entrances. Soft deceleration with a long settle. */
  out: [0.22, 1, 0.36, 1],
  /** Exits. Quicker, accelerating away. */
  in: [0.64, 0, 0.78, 0],
  /** Symmetric moves that both start and end on screen. */
  standard: [0.4, 0, 0.2, 1],
} as const;

/** Translation offsets in pixels. Entrances rise; nothing travels further. */
export const OFFSET = {
  sm: 8,
  md: 16,
  lg: 24,
} as const;

/** Stagger between siblings, in seconds. Mobile is tighter so lists settle. */
export const STAGGER = {
  desktop: 0.06,
  mobile: 0.04,
} as const;

/**
 * Spring presets in the `bounce` + `duration` form the `motion` library takes, on Fluid Functionalism's three
 * speeds (redesign F3): the bigger the thing that moves, the slower the spring. Exits are tweens one tier quicker
 * (SPRING_EXIT), so a dismissal reads crisp instead of replaying the entrance. CSS reads the same speeds as
 * --motion-fast, --motion-moderate and --motion-slow (globals.css).
 *
 * bounce 0 is critically damped. Reserve overshoot for large surfaces and for motion the user physically
 * initiated with a flick or drag: bounce on a menu that merely faded in reads as wrong.
 */
export const SPRING = {
  /** Hover, focus rings, fades, tooltips, selection indicators. */
  fast: { type: 'spring', bounce: 0, duration: 0.08 },
  /** Short travel and small expansion: indicators, switch thumbs, popovers, drawers that must land exactly. */
  moderate: { type: 'spring', bounce: 0, duration: 0.16 },
  /** Large surfaces: dialogs, side panels, stepped flows. */
  slow: { type: 'spring', bounce: 0.12, duration: 0.24 },
  /** Momentum handoff after a gesture carried velocity. */
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 },
  /** The pre-F3 default, kept for the frozen world HUD (WorldNav) only. */
  default: { type: 'spring', bounce: 0, duration: 0.35 },
} as const;

/** The exit tween paired with each spring speed. */
export const SPRING_EXIT = {
  fast: { duration: 0.06 },
  moderate: { duration: 0.12 },
  slow: { duration: 0.16 },
} as const;

/**
 * Route-world motion constants. Shared by the scroll conductor, the camera
 * rig, and the station actors so the 3D layer obeys the same grammar as the
 * DOM. See the route-world design spec §4.4 (maintainer-only).
 */
export const WORLD_MOTION = {
  /** Exponential damping constant for camera and world-state interpolation. */
  cameraDamping: 5.2,
  /** Damping for the pointer-parallax rig — faster than the camera path. */
  pointerDamping: 7.0,
  /** Maximum pointer parallax, in radians (~3°). */
  pointerMaxAngle: 0.052,
  /** Idle bob amplitude in world units and its frequency in Hz. */
  bobAmplitude: 0.06,
  bobFrequency: 0.3,
  /** Grass sway peak angle in radians (~4°) and frequency in Hz. */
  swayAngle: 0.07,
  swayFrequency: 0.18,
  /** Bottom-up power-on reveal duration, in seconds. */
  revealDuration: 0.7,
  /** How far a focused roster line rises out of the grass, in world units. */
  focusRise: 0.9,
  /** Frame delta clamp after a stall, in seconds. */
  maxDelta: 1 / 30,
} as const;

/** CSS `cubic-bezier()` argument string for an easing token. */
export function cssEase(curve: readonly [number, number, number, number]): string {
  return `cubic-bezier(${curve.join(', ')})`;
}
