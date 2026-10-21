/**
 * Experience-tier detection and the render quality step-down ladder.
 *
 * Vocabulary matches the homepage design spec (maintainer-only)
 * §10: **route** is the full R3F world, **lite** is the arena-token DOM with
 * motion choreography and no canvas. Lite is the default payload for every
 * visitor and the permanent fallback — route is a lazy enhancement layered
 * over a page that is already complete.
 */

import type { WorldExperience } from '@/types/player';

export type RouteTier = 'route' | 'lite';

/** Why a visitor resolved to Lite. Surfaced by the debug overlay only. */
export type LiteReason =
  | 'no-webgl'
  | 'save-data'
  | 'reduced-motion'
  | 'low-memory'
  | 'low-cores'
  /**
   * The viewer's preference is 'off' (`players.world_experience`): their own
   * "always off", or DEFAULT_WORLD_EXPERIENCE for signed-out visitors and a
   * failed read (3D is opt-in). Deliberately NOT retryable: the way back to 3D
   * is the settings choice, not a retry.
   */
  | 'viewer-preference'
  | 'context-lost'
  /** The scene chunk/model/environment/render threw; the page recovered to Lite. */
  | 'scene-failed'
  /**
   * The scene was not COMPLETE (presented, assets, residency and warm) within
   * the readiness deadline (D1; 20 s since D23). Never a partial reveal.
   */
  | 'readiness-timeout'
  /**
   * D23: no load signal (bytes, items, programs, uploads, residency, warm
   * stage) advanced for the stall window (`READINESS_STALL_MS`, 6 s) while
   * the world was still loading.
   */
  | 'readiness-stall'
  /**
   * The quality ladder was spent and the frame rate still could not be held.
   * Deliberately NOT retryable: the device just reported it cannot sustain the
   * route tier, so offering a retry would only re-enter the same pressure.
   */
  | 'sustained-pressure';

/**
 * Lite reasons that are a RECOVERABLE failure rather than a device capability
 * verdict — these are the only ones that offer a manual retry, because a
 * retry cannot help a visitor whose hardware or data-saver never supported the
 * route tier in the first place.
 */
export const RETRYABLE_LITE_REASONS: readonly LiteReason[] = [
  'context-lost',
  'scene-failed',
  'readiness-timeout',
  'readiness-stall',
];

export function isRetryableLiteReason(reason: LiteReason | null): boolean {
  return reason !== null && RETRYABLE_LITE_REASONS.includes(reason);
}

export interface TierDecision {
  tier: RouteTier;
  reason: LiteReason | null;
}

/**
 * The motion preference that forces Lite. Exported so the live subscription
 * that re-runs detection observes the SAME query `detectTier` reads — one
 * source of truth for the media feature, not two string literals to keep in
 * step.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Navigator extensions that are widely shipped but absent from the DOM lib
 * types. Declared narrowly rather than casting to `any`.
 */
interface HardwareNavigator extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Does this browser give us a usable WebGL2 (or WebGL) context right now? */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Release the probe context immediately; browsers cap concurrent contexts.
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the tier for the current visitor. Client-only — call from an effect,
 * never during render, so server and first client paint agree on Lite.
 *
 * Backward-compatible facade: no URL override, no persisted preference — just
 * the advisory + hard-floor capability ladder, exactly as before.
 */
export function detectTier(): TierDecision {
  if (typeof window === 'undefined') return { tier: 'lite', reason: null };
  return resolveTierDecision(null, 'auto', readCapabilities());
}

/**
 * The boolean device/connection/motion signals the tier decision consults,
 * read out of the environment so the precedence itself stays a PURE function
 * (`resolveTierDecision`) — unit-testable without a DOM.
 */
export interface ViewerCapabilities {
  /** Navigator data-saver (`Save-Data` / connection.saveData). Advisory. */
  saveData: boolean;
  /** `prefers-reduced-motion: reduce`. HARD floor. */
  reducedMotion: boolean;
  /** `deviceMemory` present and < 4 GB. Advisory. */
  lowMemory: boolean;
  /** `hardwareConcurrency` present and < 4. Advisory. */
  lowCores: boolean;
  /** A usable WebGL context can be created right now. HARD floor. */
  hasWebGL: boolean;
}

/** Read the capability signals from the current environment. Client-only. */
export function readCapabilities(): ViewerCapabilities {
  const nav = window.navigator as HardwareNavigator;
  return {
    saveData: nav.connection?.saveData === true,
    reducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
    lowMemory: typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4,
    lowCores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4,
    hasWebGL: hasWebGL(),
  };
}

/**
 * The explicit `?tier=` / `?routeDebug=1` URL override, or null when the URL
 * says nothing. The URL is a debug/share escape hatch and always wins.
 */
export type UrlTierOverride = 'lite' | 'route' | null;

/**
 * Resolve the final tier decision. PURE — every environment signal arrives
 * through `caps` so the precedence is unit-testable without a DOM.
 *
 * Precedence:
 * 1. URL override (`?tier=lite` / `?tier=route` / `?routeDebug=1`) — an
 *    explicit debug/share link keeps winning over everything, including a
 *    persisted viewer preference.
 * 2. Viewer preference 'off' → Lite ('viewer-preference', not retryable).
 *    Signed-out visitors and a failed preference read arrive here too, via
 *    DEFAULT_WORLD_EXPERIENCE.
 * 3. HARD floors beat a preference of 'on': no WebGL → 'no-webgl',
 *    prefers-reduced-motion → 'reduced-motion'.
 * 4. Viewer preference 'on' → route tier, skipping ONLY the advisory checks
 *    (save-data, low-memory, low-cores).
 * 5. Otherwise ('auto'): today's advisory + floor
 *    ladder, in `detectTier`'s historical order, unchanged.
 *
 * Runtime degradations (context-lost, scene-failed, readiness-timeout,
 * sustained-pressure) are applied ON TOP of this decision by the provider and
 * the governor — they are not inputs here.
 */
export function resolveTierDecision(
  urlOverride: UrlTierOverride,
  preference: WorldExperience,
  caps: ViewerCapabilities,
): TierDecision {
  if (urlOverride === 'lite') return { tier: 'lite', reason: null };
  if (urlOverride === 'route') return { tier: 'route', reason: null };

  if (preference === 'off') return { tier: 'lite', reason: 'viewer-preference' };

  if (preference === 'on') {
    if (!caps.hasWebGL) return { tier: 'lite', reason: 'no-webgl' };
    if (caps.reducedMotion) return { tier: 'lite', reason: 'reduced-motion' };
    return { tier: 'route', reason: null };
  }

  // 'auto' — the historical detectTier order, preserved exactly.
  if (caps.saveData) return { tier: 'lite', reason: 'save-data' };
  if (caps.reducedMotion) return { tier: 'lite', reason: 'reduced-motion' };
  if (caps.lowMemory) return { tier: 'lite', reason: 'low-memory' };
  if (caps.lowCores) return { tier: 'lite', reason: 'low-cores' };
  if (!caps.hasWebGL) return { tier: 'lite', reason: 'no-webgl' };
  return { tier: 'route', reason: null };
}

/**
 * One rung of the quality ladder. Rungs are ordered best to worst and are
 * descended strictly in order (spec §9, amended 2026-09-02): ambient
 * occlusion off → resolution → ambient figure count → post-processing off →
 * shadow fidelity → resolution again → figure LOD. Authored landmarks, camera
 * endpoints, copy and interaction meaning are never cut.
 */
export interface QualityStep {
  /** Device pixel ratio ceiling. */
  dpr: number;
  /**
   * Shadow map edge in texels. D23 (LOOK-PLAN §2 G5): 1024 on EVERY rung, so
   * a governor step never reallocates the shadow render target and never
   * re-keys a program. Shadow cost is shed through `shadowUpdate` and
   * `shadowIntensity` instead (applied by `QualityGovernor`).
   */
  shadowMapSize: number;
  /**
   * How many lights may cast shadows. Consumers only test `> 0` (the key
   * light's `castShadow`), which D23 keeps true on every rung: `castShadow`
   * is part of the shadow program key, so it is constant from load.
   */
  shadowedLights: number;
  /**
   * D23: when the shadow map re-renders. `always` = every frame (three's
   * `shadowMap.autoUpdate`); `on-move` = only on frames where the camera
   * moved (rung 3). No program or render-target change.
   */
  shadowUpdate: 'always' | 'on-move';
  /**
   * D23: the shadow term's strength (`LightShadow.intensity`, a uniform).
   * 0 on the bottom rung, which also stops the map updating: the visual
   * "shadows off" without touching `castShadow` or the map size.
   */
  shadowIntensity: 1 | 0;
  /** Multiplier on instanced vegetation counts. */
  grassDensity: number;
  /** Multiplier on suspended particle counts. */
  particleDensity: number;
  /** How many GLB ace figures may be resident; the rest are billboards. */
  heroFigures: number;
  /**
   * How many ambient roster figures roam the plaza. The rung-0 count rose
   * 8 → 10 (C-048): per-figure cost fell 13.5 → ~5.8 marginal (6.3 at
   * final HEAD per C-056) through the Figure.tsx in-family mesh merge +
   * shadow-caster trim, so ten figures (246 calls) now sit BELOW the
   * eight-figure 310-call class of C-047 r2.
   */
  ambientFigures: number;
  /** Post-processing stack (Bloom, SMAA, vignette, AgX) mounted at all. */
  post: boolean;
  /** Screen-space ambient occlusion (N8AO) — top rung only. */
  ao: boolean;
  /**
   * Ceiling on figures mounted by the shared `ThemeFigures` mounter, or null
   * for "mount the whole authored plan".
   *
   * Null at rung 0 on purpose: the top rung is the composition the capture and
   * review bar grades, and cutting it here would silently change judged visuals.
   * A rung-0 ceiling needs a measured number from the D1 baseline slice, not an
   * invented one. Lower rungs do cap, because those are exactly the devices
   * where an unbounded roster plan is what makes the world unusable.
   */
  themeFigures: number | null;
  /*
   * Living-pass subsystems (spec 2026-09-24 §7, fidelity decision D11). ONE
   * field per subsystem, added once up front; consumers only read them. The
   * spec's degradation order holds across the ladder — shafts and petals go
   * first, then water detail/contacts, then figure life — and the chapters
   * ladder test pins that order. Rung 0 was already ≈ 246 draw calls against
   * the 150 desktop target when these landed (synthesis §0), so no rung-0
   * value below licenses NEW draw calls beyond the effect's own minimum:
   * ripples and water tiers are uniforms/tessellation on the one existing
   * water mesh, shafts are one instanced call, attack VFX is one pooled actor.
   */
  /**
   * Bounded-water surface tier (spec §5.2): 3 = full tessellation plus the
   * capillary normal layer, 2 = full tessellation without capillaries,
   * 1 = reduced tessellation, 0 = the minimum moving surface. Never "off":
   * §7 keeps a moving surface and a shore read on every rung; below the
   * bottom rung the page is Lite.
   */
  waterDetail: 0 | 1 | 2 | 3;
  /**
   * Active slots in the water ripple-event pool (contacts, wakes, splashes).
   * Uniform-array entries on the existing water material, not meshes. 0 keeps
   * the surface moving but drops event coupling.
   */
  waterRipples: number;
  /**
   * Light-shaft instances (spec §5.4), one instanced additive draw call when
   * > 0. The first thing §7 removes: 3 / 2 / 1 / 0 / 0. R6 E9 (R6-BRIEF L4a,
   * AD's request, D11 "once, up front"): rung 1 keeps two beams and rung 2
   * one — the rules hero seat, drawn first — so the contre-jour moment
   * survives the post-off rung; gone from rung 3 (shadow cadence) down. A
   * draw-count change only: the program exists at every rung.
   */
  lightShafts: number;
  /**
   * Signature-attack presentation (W5): `full` = wind-up, projectile/beam and
   * impact; `reduced` = wind-up and a single short burst, no projectile
   * trail; `glow` = the emissive pulse on the figure only (also the variant a
   * reduced-motion visitor gets when route tier is forced, D12); `off` = no
   * attacks scheduled at all. Ordered best → worst in `ATTACK_VFX_LEVELS`.
   */
  attackVfx: AttackVfxLevel;
  /**
   * Figure-behavior tier (W2, spec §5.1): `full` = every authored role moves
   * (patrol, waterline, floating, airborne), seeded fidgets and water play;
   * `reduced` = a capped mover population, fidgets kept, play events off;
   * `minimal` = no path movement (movers hold a loiter), fidgets kept;
   * `static` = authored idle clips only. Population ceilings stay with
   * `ambientFigures` / `themeFigures`; this field only gates how much the
   * mounted figures DO. Ordered best → worst in `FIGURE_LIFE_LEVELS`; the
   * per-level budget lives in `figure-behavior.ts` (`figureLifeBudget`).
   *
   * POKEMON-CORE L8 (no new field: `figureLife`, `waterRipples` and
   * `themeFigures` carry the whole ladder). The shared actors (D35 3D) read
   * this field; a rung change alters only what they DO, never what is
   * resident or mounted (D23):
   *
   *   | figureLife       | floaters, wader, surfacer         | lane flyer         |
   *   |------------------|-----------------------------------|--------------------|
   *   | full             | drift, play, wakes; surfaces      | passes             |
   *   | reduced          | drift (≤ 4 movers), no play;      | perched            |
   *   |                  | surfacer stays submerged          |                    |
   *   | minimal / static | buoy only                         | perched or hidden  |
   *
   * The director (A2) also reads it for the figure beats: quiet-mode and
   * roll-call beats need a rung with fidgets (not `static`), and reduced
   * motion under a forced route tier runs `static` with no hero beats (D12).
   * Wakes and splashes stay bounded by `waterRipples` (the pool's cap); the
   * resident population stays bounded by `themeFigures`.
   */
  figureLife: FigureLifeLevel;
  /**
   * Multiplier on falling-flower (petal/blossom) instance counts (spec §5.3),
   * separate from `particleDensity` so the flower field can drop earlier than
   * the atmospheric motes it shares a frame with.
   */
  flowerFall: number;
  /*
   * Plaza painterly pilot look fields (LOOK-PLAN §2 G5, D11: added once, up
   * front; consumers only read them). Both are uniform-bounded loop counts on
   * programs that exist at every rung, so a step never re-keys a program.
   */
  /** Night puddle emitter reflections evaluated per ground fragment. */
  puddleEmitters: number;
  /** Self-shadow taps of the painted cumulus (`uCloudTaps`). */
  cloudTaps: number;
}

/** Attack presentation levels, best → worst (the ladder never climbs this). */
export const ATTACK_VFX_LEVELS = ['full', 'reduced', 'glow', 'off'] as const;
export type AttackVfxLevel = (typeof ATTACK_VFX_LEVELS)[number];

/** Figure-behavior levels, best → worst (the ladder never climbs this). */
export const FIGURE_LIFE_LEVELS = ['full', 'reduced', 'minimal', 'static'] as const;
export type FigureLifeLevel = (typeof FIGURE_LIFE_LEVELS)[number];

export const QUALITY_LADDER: readonly QualityStep[] = [
  { dpr: 1.75, shadowMapSize: 1024, shadowedLights: 2, shadowUpdate: 'always', shadowIntensity: 1, grassDensity: 1, particleDensity: 1, heroFigures: 8, ambientFigures: 10, post: true, ao: true, themeFigures: null, waterDetail: 3, waterRipples: 16, lightShafts: 3, attackVfx: 'full', figureLife: 'full', flowerFall: 1, puddleEmitters: 8, cloudTaps: 2 },
  { dpr: 1.35, shadowMapSize: 1024, shadowedLights: 2, shadowUpdate: 'always', shadowIntensity: 1, grassDensity: 1, particleDensity: 1, heroFigures: 8, ambientFigures: 3, post: true, ao: false, themeFigures: 24, waterDetail: 2, waterRipples: 12, lightShafts: 2, attackVfx: 'full', figureLife: 'full', flowerFall: 0.6, puddleEmitters: 6, cloudTaps: 2 },
  { dpr: 1.35, shadowMapSize: 1024, shadowedLights: 1, shadowUpdate: 'always', shadowIntensity: 1, grassDensity: 0.6, particleDensity: 0.4, heroFigures: 6, ambientFigures: 2, post: false, ao: false, themeFigures: 16, waterDetail: 1, waterRipples: 8, lightShafts: 1, attackVfx: 'reduced', figureLife: 'reduced', flowerFall: 0.35, puddleEmitters: 4, cloudTaps: 1 },
  { dpr: 1.0, shadowMapSize: 1024, shadowedLights: 1, shadowUpdate: 'on-move', shadowIntensity: 1, grassDensity: 0.4, particleDensity: 0.2, heroFigures: 4, ambientFigures: 0, post: false, ao: false, themeFigures: 10, waterDetail: 1, waterRipples: 4, lightShafts: 0, attackVfx: 'glow', figureLife: 'minimal', flowerFall: 0.15, puddleEmitters: 2, cloudTaps: 1 },
  { dpr: 1.0, shadowMapSize: 1024, shadowedLights: 1, shadowUpdate: 'on-move', shadowIntensity: 0, grassDensity: 0.25, particleDensity: 0, heroFigures: 0, ambientFigures: 0, post: false, ao: false, themeFigures: 6, waterDetail: 0, waterRipples: 0, lightShafts: 0, attackVfx: 'off', figureLife: 'static', flowerFall: 0, puddleEmitters: 0, cloudTaps: 1 },
] as const;

/**
 * Whether a rung's key light casts (the `castShadow` every world's Lighting
 * derives: `shadowedLights > 0 && shadowMapSize > 0`). D23: constant across
 * the ladder, pinned by test, because `castShadow` is a program key.
 */
export function rungCastsShadow(step: QualityStep): boolean {
  return step.shadowedLights > 0 && step.shadowMapSize > 0;
}

/**
 * Which post passes a session starting at `startIndex` can ever draw: the
 * governor only steps DOWN, so every rung from the start to the floor. The
 * load warm renders each of them once (LOOK-PLAN §2 G3.6), so a later step
 * only flips `.enabled` and never links a program.
 */
export function postPassesFrom(startIndex: number): { rich: boolean; lean: boolean; ao: boolean } {
  const out = { rich: false, lean: false, ao: false };
  const from = Math.max(0, Math.min(Math.trunc(startIndex), QUALITY_LADDER.length - 1));
  for (let i = from; i < QUALITY_LADDER.length; i += 1) {
    const step = QUALITY_LADDER[i];
    if (step.post) out.rich = true;
    else out.lean = true;
    if (step.ao) out.ao = true;
  }
  return out;
}

/** Mobile starts one rung down; the top rung is a desktop resolution. */
export function initialQualityIndex(mobile: boolean): number {
  return mobile ? 1 : 0;
}

/**
 * The effective device pixel ratio for a rung (C-032): the rung's `dpr` is a
 * ceiling, so it never exceeds the display's native ratio. This is the ONE
 * authority for the value — both the canvas' `dpr` prop and the governor's
 * settle pin must resolve through here. When they computed it separately the
 * prop applied the raw rung value while the governor clamped to the display,
 * and any canvas re-configure mid-session (a scroll-triggered re-measure) then
 * flipped the buffer size — the DPR "ramp" C-027's visual review caught as stills that
 * changed resolution between sections of a single capture run.
 */
export function resolveDpr(step: QualityStep): number {
  if (typeof window === 'undefined') return step.dpr;
  return Math.min(step.dpr, window.devicePixelRatio);
}

/**
 * Governor thresholds. Downgrade only after a sustained stretch of slow
 * frames so a single hitch never costs resolution, and never climb back —
 * oscillating quality is more distracting than a slightly soft frame.
 */
export const GOVERNOR = {
  /** Frame time above this counts as slow, in milliseconds. */
  slowFrameMs: 22,
  /** Consecutive slow frames required before stepping down. */
  slowFrameRun: 120,
  /**
   * ENGINE r5 (CAR r4: a plain chip jump stepped 0 -> 1 on dev): a frame only
   * counts as slow when the median of the last `slowMedianFrames` frames is
   * slow too, so a spike (a dev compile, a GC, one long task) adds nothing,
   * and the run must also have lasted `slowRunMinMs` of wall clock — a
   * camera flight's dense 1.5-2.5 s of heavier frames alone never costs a
   * rung, sustained pressure still does.
   */
  slowMedianFrames: 15,
  slowRunMinMs: 3500,
  /**
   * Load grace (W7): slow frames do not count while the scene is still
   * loading, nor for this long after it is revealed (D23: the anchor is the
   * reveal's arm — the load warm runs between presented and the arm). Shader compiles, texture
   * uploads, the static batcher's merge and the loader's reveal window all
   * land in that interval; counting them would permanently cost a rung on a
   * healthy device (the ladder never climbs) — or, on a weak one, exhaust it
   * into Lite as `sustained-pressure` while the ball is still up. Covers the
   * reveal gate's wait and the whole ceremony (1.06 s: the hinge lead-in,
   * then the release beat — the canvas iris and the beam's full-screen
   * layers run then), plus the two-phase handoff's composite settle frames.
   * D23 keeps 4 s: the gate no longer arms on a cap after presented (it
   * waits for the complete world), and nothing loads after the reveal.
   */
  loadGraceMs: 4000,
} as const;

/** ENGINE r5: the governor's slow-frame run (see `stepGovernorPressure`). */
export interface GovernorPressure {
  /** Net slow frames (a fast frame takes one back). */
  slow: number;
  /** `performance.now()` when the current run began (null: no run). */
  runStartedAt: number | null;
  /** The last frame times (ms), newest last, at most `slowMedianFrames`. */
  recent: readonly number[];
}

export const INITIAL_GOVERNOR_PRESSURE: GovernorPressure = { slow: 0, runStartedAt: null, recent: [] };

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One frame of the governor's pressure detector (pure). A frame is slow when
 * it AND the rolling median exceed `GOVERNOR.slowFrameMs`; a fast frame takes
 * one slow frame back. `step` is true once the net count reaches
 * `slowFrameRun` AND the run has lasted `slowRunMinMs`; the state then resets.
 */
export function stepGovernorPressure(state: GovernorPressure, frameMs: number, nowMs: number): { state: GovernorPressure; step: boolean } {
  const recent = [...state.recent, frameMs].slice(-GOVERNOR.slowMedianFrames);
  const slowFrame = frameMs > GOVERNOR.slowFrameMs && median(recent) > GOVERNOR.slowFrameMs;
  let slow = state.slow;
  let runStartedAt = state.runStartedAt;
  if (slowFrame) {
    slow += 1;
    runStartedAt ??= nowMs;
  } else if (slow > 0) {
    slow -= 1;
    if (slow === 0) runStartedAt = null;
  }
  if (slow >= GOVERNOR.slowFrameRun && runStartedAt !== null && nowMs - runStartedAt >= GOVERNOR.slowRunMinMs) {
    return { state: { slow: 0, runStartedAt: null, recent }, step: true };
  }
  return { state: { slow, runStartedAt, recent }, step: false };
}

/**
 * Whether the frame governor is inside its load grace window. The argument is
 * the time since the reveal armed (D23; `presented` before), null while the
 * current scene generation has not been revealed yet.
 */
export function governorInLoadGrace(msSincePresented: number | null): boolean {
  return msSincePresented === null || msSincePresented < GOVERNOR.loadGraceMs;
}
