'use client';

/**
 * Station-window warm-up (W6 round 2: mid-crossing render stalls).
 *
 * The judge's sweeps showed 1–3 s frame gaps at the SAME progress on every
 * run (plaza pulse → roster 0.52–0.82; clouds 0.74; sakura 3.75): the
 * residency windows latch when the hysteretic nearest station flips, i.e.
 * mid-crossing, and the freshly mounted population then pays React commit,
 * GLB parse, texture upload and shader-program compile inside the crossing.
 * Two levers live here, shared by the plaza and the theme window hooks:
 *
 * 1. `useStationLead` — an IDLE lead: when the visitor has rested for
 *    STATION_LEAD_IDLE_MS one station before a window (`from − 1`, or
 *    `to + 1` when approaching from below), the window may latch early, in a
 *    browser idle callback, so the mount cost lands while nothing moves.
 *    Gated on the route being live (never competes with the 10 s readiness
 *    deadline or the reveal) and on the quality ladder (`stationLeadAllowed`).
 *    Round 4 adds a TRAVEL lead under the same gates: moving toward a window
 *    and within STATION_TRAVEL_LEAD of its near edge latches it at once,
 *    measured the same way in both directions (`travelLeadWanted`).
 * 2. `useWarmCompile` — once a window is mounted, compile the scene's new
 *    materials with `renderer.compileAsync` (KHR_parallel_shader_compile when
 *    available) and upload their textures with `renderer.initTexture`, for a
 *    short window while the Suspense content streams in. `compile()` walks
 *    the whole scene (`traverse`, not `traverseVisible`), so hidden or
 *    frustum-culled content is warmed before it first reaches the camera.
 *
 * Honest limits: shadow-pass depth materials are compiled by the shadow map
 * on first use, not by `compile()` — review r5 prepares them without a
 * draw (`compileShadowVariants`: the first-frame warm, the warm-pass scan and
 * the compile guard), so only a shadow-casting line / point, or a renderer
 * without parallel compile, still pays a first-use depth compile; without the parallel-compile extension the compile
 * is synchronous (it still moves the cost to mount time, off the camera's
 * arrival); GLB parse and React commit are unchanged — only the idle lead
 * moves those, and only where a consumer opts in (see the window hooks).
 */

// The warm's modules live in ./warm/ (one per concern, see docs/modules-index.md);
// this file keeps the import path every consumer and test uses.
export {
  isLeadStation,
  STATION_LEAD_IDLE_MS,
  STATION_TRAVEL_LEAD,
  stationLeadAllowed,
  travelLeadWanted,
  useStationLead,
} from './warm/station-lead';
export type { TravelLeadProgress } from './warm/station-lead';
export {
  armStationWarmup,
  COMPILE_HOLD_MAX_MS,
  compileHeldCount,
  GUARD_TEXTURE_BUDGET_MS,
  guardCompileFrame,
  isCompileHeld,
  releaseHeldMask,
  useWarmCompile,
} from './warm/compile-guard';
export { MOUNT_SLICE_BUDGET_MS, MOUNT_SLICE_TIMEOUT_MS, onIdleSlice, useStaggeredMount } from './warm/staggered-mount';
export {
  enqueueWindowLatch,
  initSkipGate,
  queuedWindowLatches,
  resetWindowLatchQueueForTests,
  skipGateOpen,
  skipWindowRole,
  stepSkipGate,
  useSkipGate,
} from './warm/skip-gate';
export type { SkipGateInput, SkipGateMode, SkipGateState, SkipView, SkipWindowRole } from './warm/skip-gate';
export { compileShadowVariants, warmShadowVariants } from './warm/shadow-variants';
export type { ShadowWarmRenderer, WarmRenderReport } from './warm/shadow-variants';
export {
  createProgramsWarmTrack,
  getProgramsWarm,
  markLoadWarmComplete,
  noteProgramsFrame,
  PROGRAMS_WARM_STABLE_FRAMES,
  resetProgramsWarmForTests,
  stepProgramsWarm,
  subscribeProgramsWarm,
} from './warm/programs-warm';
export type { ProgramsWarmTrack } from './warm/programs-warm';
export {
  createLinkCap,
  createLoadWarm,
  LOAD_WARM_STAGES,
  loadWarmAllowsDraw,
  nextFreshBudget,
  postPassesToWarm,
  registeredWarmPostPasses,
  registerWarmPostPass,
  registerWarmPrepare,
  resetLoadWarmRegistriesForTests,
  runWarmPrepare,
  stepLinkCap,
  stepLoadWarm,
  textureUploadBytes,
  VEILED_WARM,
  veiledLinkBudget,
  WARM_BUFFER_BYTES_PER_FRAME,
  WARM_BUFFER_DRAW_NEW_MATERIALS,
  WARM_BUFFER_DRAWS_PER_STEP,
  WARM_BUFFER_LAYER,
  WARM_BUFFER_NEW_MATERIALS,
  WARM_BUFFER_NEW_MATERIALS_MAX,
  WARM_COMPILE_BUDGET_MS,
  WARM_FENCE_MAX_MS,
  WARM_FRAME_SLOW_MS,
  WARM_FRAME_SMOOTH_MS,
  WARM_FRAME_STALLED_MS,
  WARM_GPU_HEAVY_MS,
  WARM_GPU_REST_FACTOR,
  WARM_LINK_CAP_RAMP_FRAMES,
  WARM_LINK_CAP_START,
  WARM_LINK_MAX_MS,
  WARM_MAX_LINKS_IN_FLIGHT,
  WARM_NEW_PROGRAMS_PER_FRAME,
  WARM_POSE_SCALE,
  WARM_PRIME_BUDGET_MS,
  WARM_SHADOW_CASTERS_PER_FRAME,
  WARM_SIGNATURE_STABLE_FRAMES,
  WARM_TEXTURE_BYTES_PER_STEP,
  WARM_TEXTURE_BYTES_WHILE_LINKING,
  WARM_VERIFY_MAX_PASSES,
  warmLinkBudget,
} from './warm/load-warm';
export type {
  LinkCapState,
  LoadWarmIO,
  LoadWarmStage,
  LoadWarmState,
  WarmPostPass,
  WarmPostPassKey,
  WarmPrepareHook,
} from './warm/load-warm';
export { compileVariantKey, compileWeight, passMaterials } from './warm/compile-variants';
export type { WarmPose } from './warm/compile-variants';
export { deferExternalUploads } from './warm/upload-deferral';
export {
  describeDataFace,
  envProgramState,
  pointCountRose,
  renderTargetsOf,
  warmOutputsFor,
} from './warm/load-warm-io-helpers';
export type { LoadWarmDeps, LoadWarmIOHandle, WarmDataFace, WarmOutput } from './warm/load-warm-io-helpers';
export { createLoadWarmIO } from './warm/load-warm-io';
export {
  captureThemeSwap,
  releaseThemeSwapRetention,
  settleThemeSwap,
  themeSwapCaptured,
  themeSwapRetention,
} from './warm/theme-swap-retention';
