/**
 * Broadcast overlay CSS animations.
 *
 * All animations use `transform` and `opacity` only — these are composited
 * on the GPU without triggering layout recalculation, keeping OBS browser
 * sources performant alongside game capture.
 *
 * Duration is multiplied by `var(--anim-speed)` (set by OverlayShell).
 * When --anim-speed is 0 (intensity: 'none'), animations complete instantly.
 */

// ─── Keyframe Definitions ───────────────────────────────────────────

export const BROADCAST_KEYFRAMES = `
@keyframes broadcast-slideInLeft {
  from { opacity: 0; transform: translateX(-60px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes broadcast-slideInRight {
  from { opacity: 0; transform: translateX(60px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes broadcast-slideInUp {
  from { opacity: 0; transform: translateY(40px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes broadcast-slideInDown {
  from { opacity: 0; transform: translateY(-40px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes broadcast-scaleReveal {
  0%   { opacity: 0; transform: scale(0.3); }
  70%  { opacity: 1; transform: scale(1.08); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes broadcast-fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes broadcast-fadeOut {
  from { opacity: 1; }
  to   { opacity: 0; }
}

@keyframes broadcast-pulseGlow {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.85; transform: scale(1.03); }
}

@keyframes broadcast-tickUp {
  0%   { opacity: 0; transform: translateY(8px) scale(1.2); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes broadcast-shakeSlam {
  0%   { transform: scale(0.5) rotate(-2deg); opacity: 0; }
  50%  { transform: scale(1.15) rotate(1deg); opacity: 1; }
  70%  { transform: scale(0.95) rotate(-0.5deg); }
  100% { transform: scale(1) rotate(0deg); }
}

@keyframes broadcast-silhouetteFill {
  0%   { opacity: 0.6; filter: brightness(0); transform: scale(0.8); }
  40%  { opacity: 0.8; filter: brightness(0); transform: scale(1.05); }
  60%  { opacity: 1;   filter: brightness(0.5); transform: scale(1); }
  100% { opacity: 1;   filter: brightness(1); transform: scale(1); }
}

@keyframes broadcast-scrollLeft {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

@keyframes broadcast-typeFlash {
  0%   { opacity: 0.7; transform: scale(1); }
  50%  { opacity: 1;   transform: scale(1.05); }
  100% { opacity: 1;   transform: scale(1); }
}

@keyframes broadcast-barGrow {
  from { opacity: 0; transform: scaleX(0); }
  to   { opacity: 1; transform: scaleX(1); }
}

@keyframes broadcast-actTransition {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
` as const;

// ─── Animation Class Helpers ────────────────────────────────────────

export type BroadcastAnimation =
  | 'slideInLeft'
  | 'slideInRight'
  | 'slideInUp'
  | 'slideInDown'
  | 'scaleReveal'
  | 'fadeIn'
  | 'fadeOut'
  | 'pulseGlow'
  | 'tickUp'
  | 'shakeSlam'
  | 'silhouetteFill'
  | 'scrollLeft'
  | 'typeFlash'
  | 'barGrow'
  | 'actTransition';

/** Base durations in ms (at speed 1×). */
const BASE_DURATIONS: Record<BroadcastAnimation, number> = {
  slideInLeft: 500,
  slideInRight: 500,
  slideInUp: 400,
  slideInDown: 400,
  scaleReveal: 400,
  fadeIn: 300,
  fadeOut: 300,
  pulseGlow: 1500,
  tickUp: 200,
  shakeSlam: 300,
  silhouetteFill: 800,
  scrollLeft: 20000,
  typeFlash: 300,
  barGrow: 600,
  actTransition: 500,
};

const ANIMATION_FILL: Record<BroadcastAnimation, string> = {
  slideInLeft: 'forwards',
  slideInRight: 'forwards',
  slideInUp: 'forwards',
  slideInDown: 'forwards',
  scaleReveal: 'forwards',
  fadeIn: 'forwards',
  fadeOut: 'forwards',
  pulseGlow: 'infinite',
  tickUp: 'forwards',
  shakeSlam: 'forwards',
  silhouetteFill: 'forwards',
  scrollLeft: 'infinite',
  typeFlash: 'forwards',
  barGrow: 'forwards',
  actTransition: 'forwards',
};

/**
 * Build an inline animation CSS value.
 *
 * Uses `calc()` with `var(--anim-speed)` so the OverlayShell's speed
 * setting applies automatically without JS recalculation.
 */
export function getAnimationStyle(
  animation: BroadcastAnimation,
  delayMs: number = 0,
  options?: { iterationCount?: string; direction?: string }
): React.CSSProperties {
  const baseDuration = BASE_DURATIONS[animation];
  const fill = ANIMATION_FILL[animation];
  const isLooping = fill === 'infinite';

  return {
    opacity: isLooping ? undefined : 0,
    animation: [
      `broadcast-${animation}`,
      `calc(${baseDuration}ms * var(--anim-speed, 1))`,
      'ease-out',
      `calc(${delayMs}ms * var(--anim-speed, 1))`,
      options?.iterationCount ?? (isLooping ? 'infinite' : '1'),
      options?.direction ?? 'normal',
      isLooping ? 'normal' : 'forwards',
    ].join(' '),
  };
}

/**
 * Build a staggered animation for a list of items.
 * Returns an array of style objects, one per item.
 */
export function getStaggeredStyles(
  animation: BroadcastAnimation,
  count: number,
  baseDelayMs: number = 0,
  staggerMs: number = 100
): React.CSSProperties[] {
  return Array.from({ length: count }, (_, i) =>
    getAnimationStyle(animation, baseDelayMs + i * staggerMs)
  );
}
