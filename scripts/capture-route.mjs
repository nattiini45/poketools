#!/usr/bin/env node
/**
 * Batch route-world capture harness for gauntlet evidence (card C-001).
 *
 * Usage:
 *   node scripts/capture-route.mjs --tag <tag> \
 *        [--sections pulse,roster,teams,schedule,rules] \
 *        [--viewports 1440,768,390] [--theme light|dark] \
 *        [--focus <subject id>] [--tier auto|route|lite] [--quality auto|0..4] \
 *        [--phase-pin on|off] [--debug on|off] [--port <n>] [--help]
 *        (the default port is BOARD_DEV_PORT from scripts/board-dev-url.mjs —
 *        the literal lives there and nowhere else, C-081)
 *
 * `--focus board:pulse` (ADR-0003) lands the station, then drives the focus
 * store through `window.__routeWorldFocus` and waits for phase `focused`
 * before presenting; filenames gain `-focus-<id>` and the sidecar records the
 * focus state and the subject's world bounds.
 *
 * Boots (or reuses) a dev server on a PINNED port — never 3000 — navigates
 * /route-preview once per viewport, scrolls each requested section anchor
 * into view, waits >= 1800 ms for camera damping (conductor lambda 5.2), then
 * writes the C-021 GPU FBO present with the live WorldNav HUD stamped on top
 * (never a compositor-only world; never full-page). Files land ONLY under
 * gauntlet/evidence/<tag>-<section>-<viewport>.png plus a pose sidecar
 * `.json` (C-021: conductor + camPos + worldPos + isDefaultPlaza; C-039:
 * phasePin, durationMs, stationMs, invocation; C-045: renderPath).
 *
 * Theme forcing reuses scripts/capture.mjs's mechanism verbatim:
 * next-themes with attribute="data-theme" + defaultTheme="system", so setting
 * localStorage.theme via addInitScript deterministically pins light/dark;
 * data-theme is read back per capture and any mismatch fails the run.
 *
 * C-106 r2 dev-overlay hygiene: `next dev` injects a `nextjs-portal` custom
 * element (shadow DOM) holding the dev-tools button and the red "Issues"
 * count badge — dev chrome, not app UI. Element screenshots CLIP THE PAGE,
 * so a fixed-position portal overlapping the HUD/panel region leaks into the
 * delivered composite (C-106 r1 panel P2: the pill in 4 clouds cells +
 * roster cells). The portal host is hidden after every page load, BEFORE any
 * screenshot (stylesheet rule + inline hide; the sidecar stamps the count
 * additively as devOverlay). Nothing else about the run changes.
 *
 * Offline mode (C-046): `--blob-count <ref.png> <frame.png...>` skips the
 * server/browser entirely and runs the PB-191 blob count-of-record (fold of
 * the private _c047-blobs.mjs scratch detector per the shared-tooling
 * directive) — connected-component scan of the frame-vs-ref diff strictly
 * above the HUD band, figure-shape filtered, 6-px column-gap split. The band
 * ceiling is DERIVED per frame (sidecar hud.top stamped at present time, or
 * an explicit --blob-band-top override) and never silently full-frame
 * (PB-205 yMax=900 bug class).
 *
 * C-046 hydration-flake retry: when `window.__routeWorldPresent` never
 * mounts ('missing-hook' / 'present-hook-timeout' — seen once in 40+
 * captures under 3-seat load) the page is reloaded and the station
 * re-landed, at most 2 times, then the run fails honestly; every sidecar
 * records presentRetries (additive). `--present-flake-inject <0..3>` is a
 * self-test shim that deterministically exercises the retry path.
 *
 * C-057 present-readiness waits (both default ON, `--kit-settle off` /
 * `--residency-wait off` restore the pre-C-057 behavior): after the present
 * hook mounts, the present itself is held until the page's ASSETS have
 * settled. (1) Kit-settle — `__routeWorldRenderPath()` must report the GLB
 * kit facade ('kit', instanced meshes mounted) with the render path held
 * still >= KIT_SETTLE_MIN_MS, so pulse stills never straddle kit freshness
 * (C-045: both A/A loads shot procedural at pulse; kit settles ~10 s).
 * (2) Asset residency — fileMaps must reach RESIDENCY_FILE_MAPS_MIN and hold
 * stable (and, when the debug-gated phase hook is available and walkers were
 * requested, frameSubscribers >= RESIDENCY_FS_MIN), so a present never lands
 * in the walkerless window (C-047 r2: 3 of 4 mover-pin pulse-dark loads
 * presented walkerless at fileMaps 27 / FS 19 while resident loads, 72-74 /
 * 43, painted). Each wait is bounded and fails honestly with a named class;
 * every sidecar stamps kitSettle / assetResidency (additive).
 *
 * C-057 `--blob-report <path>` writes the offline blob-count mode's stdout
 * lines to a disk artifact so juries cite a file instead of teed scratch.
 * C-057 `--patch-material <sig>=<uniform>=<value>[,...]` is the sanctioned
 * delta-isolation arm flag (PB-252): the patch is applied to every material
 * whose name matches <sig> through the debug-gated `__routeWorldScene`
 * handle INSIDE the same page task as the present (patch -> phase pin ->
 * present), so the arm and the frame share one load; --patch-material
 * implies --debug on. C-057 `--led-pin on` freezes `Date.now()` at a
 * canonical epoch (addInitScript) so the boards' once-a-second live ticker
 * strip paints the same countdown in every load — the per-load LED content
 * noise (1-2 % of the schedule-pose kiosk box, C-052) is the last recurring
 * between-load confounder there. `--residency-flake-inject <0..4>` (SELF-TEST
 * ONLY) stalls the first N figure-GLB responses to reproduce the walkerless
 * present window deterministically.
 *
 * S9 evidence arms (fidelity gauntlet, D13; logic in scripts/lib/capture-evidence.mjs,
 * veto analyzers in src/lib/route-world/evidence-probe.ts): `--frames N
 * [--interval ms]` samples N presents + figure/occlusion/camera bridges into
 * a -trace.json and a -strip.png after each station lands; `--occlusion on`
 * stamps a one-shot raycast occlusion + DOM overlap record into the sidecar;
 * `--sweep down|up|jitter` replaces the stills with a scripted wheel gesture
 * and a W6 direction-flip verdict (-sweep.json); `--loader-trace` records the
 * W7 loader from navigation start (-loader.json); `--reduced-motion` emulates
 * prefers-reduced-motion. Every arm is additive: with none of these flags the
 * run, its files and its sidecars are unchanged.
 *
 * Gauntlet round 1: `--loader-trace` now implies --debug on (the readiness
 * bridge is debug-gated); `--loader-film` records the ball ceremony (CDP
 * screencast, screenshot fallback) into a labelled -loader-film.png montage +
 * -loader-film.json; `--param k=v` (repeatable) passes page-URL params through.
 * ALWAYS ON for route-tier pages: a reveal gate (world-route-live + ball
 * done|hidden, bounded, named reveal-gate-* failure) before any seek / still /
 * sweep / trace, and a station-settle assertion after every landing (nearest
 * === index, |smooth - exact| < 0.01, WorldNav chip matches; one re-seek, then
 * station-settle-failed with a failure sidecar and no still). Sidecars gain
 * revealGate + stationSettle; console output gains one line per gate/landing.
 * Exits non-zero on any failure (0 = all captures written and verified).
 *
 * Gauntlet round 2 (harness remediation): station settle also requires
 * |exact - index| < 0.01 (or the conductor's pin on the station) and the
 * seek bisection no longer stalls on plateaus; the reveal gate waits past an
 * aborted ball until the readiness deadline + margin (revealed-after-abort);
 * sweep frames carry camPos / pitch / nearest / skip / chip / key light and
 * the analysis adds crossing heights + lag-attributed reversals; new
 * `--sweep jump|panel|dither`, `--flip-probe <px>`, `--page-path <path>` and
 * `--handoff-composite`; the loader trace fixes ball visibility, records
 * milestones / wobbles, reads pixels only once the canvas shows and refuses a
 * pass on a sparse handoff window; the debug perf readout is hidden.
 *
 * Round 2 lead additions: station settle compares exact to the requested
 * index and every seek/landing logs the conductor's mapVersion /
 * lastSampleKind / sampleScrollY / turnLag (the seek no longer waits 8 s for
 * exact >= 0.5); a dev-compile warm-up (`--warmup`, auto-on for evidence
 * arms) primes the page before the measured navigation; `--relax-deadline`
 * (debug-only readyDeadlineMs, never for W7); `--fail-inject` context-loss /
 * timeout failure paths; a Lite-floor verdict for reduced motion on --tier
 * auto; film / composite frames at a steady periodic cadence, the film
 * stamped against a same-navigation trace; the reveal gate keeps both reads
 * around an abort and fails `reveal-gate-inconsistent` on a Lite verdict over
 * a showing canvas; sweeps fail on rAF gaps > 250 ms and report the peak yaw
 * rate and the walker group; `--chip-jump` / `--panel-edge`; sidecars stamp
 * `__routeWorldWater()` when the page has it.
 *
 * Gauntlet round 3: sweeps add the per-render yaw rate (gl.render wrapper),
 * station-pose / interpolated crossing heights and rAF-gap attribution; every
 * route still checks its station's subject is present and its content count
 * holds against a baseline (subject-missing / station-content-missing);
 * --occlusion judges only the station's own subjects; films and composites
 * carry an in-frame timecode on the trace's rAF clock; a reduced-motion loader
 * trace on --tier auto loads without ?routeDebug=1 (the Lite-floor run);
 * --loader-trace implies --handoff-composite; --strip-crop, --pin-utime,
 * --content-baseline; invocation.sourceStamp records the newest src/ edit.
 *
 * Gauntlet round 4: a rAF gap is recorder-only only with >= 2 page draws
 * inside it (else page-gpu-or-compositor, counted against the product); jump
 * legs carry a frame-gap verdict (250 ms); failing sweep / panel / dither /
 * loader verdicts and particle-corridor-open exit 1; the loader recorder
 * pauses canvas readbacks over the handoff window when the composite is on
 * and asserts the ball's own over-text self-check; the warm-up context
 * carries --reduced-motion; --dpr sets the device pixel ratio; route stills
 * in debug sessions record __routeWorldParticles() (particleCorridor).
 *
 * Wave 2 (seat 2H INF, scripts/lib/w1-evidence.mjs): `--luma on` writes
 * { activeFaceP99, outsideP995, topHotspots[] } per still from the FINAL PNG
 * (sky-body disc, HUD band and DOM chrome excluded) plus a rendered-pixel
 * text-vs-ground contrast estimate on the active face; `--audit on` writes the
 * frame's draw calls and renderer.info.programs per station into the sidecar
 * and appends a row to gauntlet/fidelity/DRAW-LEDGER.md; every route still on
 * an evidence run records the docked panel's computed font-size and
 * in-viewport box, and the pass-through readers for __routeWorldBeats() /
 * __routeWorldAttacks() (absent = unmeasured, never pass); the station-settle
 * assertion adds `activeIndex === target` and, when the page publishes 2A's
 * latched `settled`, requires it (sidecar `settled`: true | false |
 * 'unmeasured'). Residual 4: a W1 occlusion fail and a station caption over
 * the station's own face exit 1; particle corridors with no emitter read
 * `absent`; occluders carry readable mesh names (EvidenceBridges); W7 traces
 * use one deadline anchor, the product's phase / wobble logs, and never count
 * an unconfirmed zero-spread read as blank; films and traces add the
 * ceremony's compositor cadence and a CSS-animation-on-transform/opacity audit.
 *
 * LOOK-PLAN §2 SEAT H (D23 complete at reveal): `--quiet-probe` arms a
 * recorder before navigation and, after world-route-live, counts world-asset
 * fetches, program links, texture uploads and long tasks per leg (idle, a
 * down+up sweep, chip jumps; `--quiet-governor` walks the ladder to rung 4,
 * `--quiet-theme` toggles the palette and restarts the probe) into
 * <tag>-<theme>-<vp>-quiet.json — any non-zero count exits 1. `--quiet-inject
 * fetch|program` is its self-test. `--prod-attach` asserts the server on
 * --port is `next start` and never boots one. The pure helpers live in the
 * `quiet-probe:pure` block (tested by scripts/__tests__/quiet-probe.test.mjs).
 *
 * CHROME seat (D32 / D33; helpers in scripts/lib/chrome-probes.mjs): the
 * `--quiet-theme` leg is JUDGED under D32 — every world fetch, program link,
 * texture upload / allocation and long task after the toggle must fall inside
 * the theme veil's opaque window, none in its fade-in or after its fade-out
 * began, with the veil timings recorded (`--veil-film` adds a screencast of
 * the veil and a contact sheet); `--nav-reveal-probe` is its own run that
 * exercises the D33 NavBar reveal (top-edge dwell, keyboard Tab / Esc, the
 * HUD menu chip with --touch on) with screenshots and a first-reveal hitch
 * measurement, writing <tag>-<theme>-<vp>-navreveal.json.
 *
 * LOOK r6 SEAT H (D28, R6-BRIEF §5; helpers in scripts/lib/look-r6-evidence.mjs,
 * look-probe.mjs, trace-summary.mjs): a prod-capable --fail-inject timeout
 * (the scene chunk found by content), station content keyed by the DOM world
 * + dpr + rung, the D27 canonical diff baseline with the Station Card masked,
 * <tag>-<theme>-<vp>-quiet.json, a saturated-cell fallback, the phase trace
 * from navigation, loader LoAF, and the arms --gpu-trace, --program-keys,
 * --warm-cache, --net-throttle, --dolly-at, --contrast-repeat, --look-probe.
 */
import { chromium } from 'playwright';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { cardVeilJudge, runNavRevealProbe, startCardSampler, veilJudge, veilWindows, writeVeilFilm } from './lib/chrome-probes.mjs';
import { readRevealBridges, revealAnchors, revealLine } from './lib/reveal-anchors.mjs';
// C-081: the pinned dev port has ONE source of record (scripts/board-dev-url.mjs);
// the literal is not duplicated here.
import { BOARD_DEV_PORT } from './board-dev-url.mjs';
// S9 evidence arms (additive; see the header note).
import {
  EVIDENCE_BARE_FLAGS,
  EVIDENCE_VALUE_FLAGS,
  FRAMES_MAX,
  INTERVAL_DEFAULT_MS,
  anyEvidenceFlag,
  compositeHandoffVerdict,
  compositeSpreads,
  crossingHeights,
  evidenceNeedsDebug,
  expectedPanelEdge,
  filmCadence,
  finishLoaderTrace,
  flipVerdict,
  installFailInject,
  liteGateConsistency,
  readWater,
  warmupEnabled,
  panelEdgeVerdict,
  pickPanelSubjects,
  readFlipContext,
  REVEAL_AFTER_ABORT_MARGIN_MS,
  REVEAL_DEADLINE_MS,
  REVEALED_MODES,
  runDither,
  runJump,
  runPanelCycles,
  frameSuffix,
  installFilmRecorder,
  installLoaderRecorder,
  occlusionSnapshot,
  parseEvidenceFlags,
  parseParamFlags,
  parseQuietBusy,
  PARAM_RESERVED_KEYS,
  phaseAt,
  revealGateState,
  runSweep,
  sampleEvidence,
  selectFilmFrames,
  startLoaderFilm,
  stationSettleVerdict,
  STATION_SETTLE_EPS,
  summarizeFilm,
  summarizeFrameTrace,
  summarizeLoader,
  summarizeSweep,
  sweepEndpoints,
  waitForFilmEnd,
  writeStrip,
  // Gauntlet round 3 (harness remediation).
  contentBaselineKey,
  installTimecode,
  isLiteFloorRun,
  stampFrames,
  stationContentVerdict,
  stripLabel,
  TIMECODE,
  waitForStationContent,
  // Gauntlet round 4 (harness remediation).
  particleCorridorVerdict,
  subjectBelongsTo,
  DOM_LAYER_SELECTORS,
  readDomLayers,
  // Gauntlet round 5 (harness remediation).
  motionWindow,
  nearestTelemetry,
  shaderCheckRecord,
  sweepFilmLabel,
  sweepFilmPicks,
  // Wave 2 round 2 (harness remediation).
  cadenceByPhase,
  cardEdgeVerdict,
  stationCardVerdict,
  armArrivalBurst,
  dumpArrivalBurst,
  summarizeArrivalBurst,
  clickNavChip,
  // Wave 2 round 3 (harness remediation).
  ensureCeremonyPicks,
  rollCallVerdict,
} from './lib/capture-evidence.mjs';
import { archivePriorTryPngs, keepPriorTry } from './lib/evidence-tries.mjs';
import {
  assertNoBucketEgress,
  assetOriginSummary,
  captureServerEnv,
  isSpritesBucketUrl,
  diffStillFiles,
  dollyQuarterTimes,
  faceRegionsOf,
  figureMaskOf,
  filmFrameFor,
  isStallKind,
  poseMatch,
  quietUnmeasuredBody,
  readStillSidecar,
  routeTierLiveVerdict,
  stallInjectMs,
} from './lib/look-evidence.mjs';
// LOOK r3 SEAT H: whole-ceremony cadence, generation account, diff candidates.
import {
  baselineSuspicion,
  ceremonyWindowOf,
  compareToFloor,
  generationAccount,
  parseDiffTags,
  pickDiffCandidate,
  sceneLightingMatch,
  wholeCeremonyCadence,
  worldLumaConsistency,
} from './lib/look-r3-evidence.mjs';
// LOOK r4 SEAT H: black-IBL rejection, blank-face presence, recorder drops, program count point.
import { boardFaceSignal, boardPresenceVerdict, iblVerdict, programCountAtReveal, recorderDropAccount } from './lib/look-r4-evidence.mjs';
// LOOK r5 SEAT H: program split (D26), rAF main-thread gaps, face texture read.
import { faceTextureVerdictInput, programSplit, programSplitLine, rafGapWindows, readFaceTextures, readProgramInventory } from './lib/look-r5-evidence.mjs';
// LOOK r6 SEAT H (D28): prod timeout inject, content keying, D27 baseline,
// quiet names, contrast noise band, loader LoAF / GPU trace / program keys,
// --dolly-at, warm cache, throttle and the look probe.
import {
  GPU_TRACE_CATEGORIES,
  R6_BARE_FLAGS,
  R6_VALUE_FLAGS,
  baselineIblFlags,
  canonicalBaselinesFor,
  contentBaselineChain,
  contentFallbackVerdict,
  contrastRepeatBand,
  dollyPointToken,
  dollyTimesAt,
  framePose,
  fulfilHeaders,
  innerFaceRepeat,
  installLoafRecorder,
  installPhaseTrace,
  installShaderSourceLog,
  isNextChunkUrl,
  isWorldManifestUrl,
  loafByPhase,
  manifestFallbackHolds,
  netThrottleConditions,
  parseR6Flags,
  phaseTraceSummary,
  phaseWindowsFromStamps,
  pickContentBaseline,
  programKeyAudit,
  quietFileName,
  r6InvocationArgs,
  resolveCaptureWorld,
  revealFromPhaseRows,
  saturatedCellFallback,
  sceneChunkMatch,
  shaderSourceDiff,
  stationCardMaskOf,
  timeoutRoutePredicate,
} from './lib/look-r6-evidence.mjs';
import { lookProbe, probeLine, rawImage } from './lib/look-probe.mjs';
import { loadTraceFile, summarizeTrace, summaryLines } from './lib/trace-summary.mjs';
// Wave 2 (seat 2H INF): the W1 clarity-layer evidence arms.
import {
  DRAW_LEDGER_HEADER,
  DRAW_LEDGER_ROWS_MARKER,
  SKY_DISC_MASK_DEG,
  activeFaceRects,
  buildLumaMask,
  ceremonyAnimationVerdict,
  ceremonyCadence,
  cadencePerBallPhase,
  RM_PERIODIC_GAP_LIMIT_MS,
  dockedPanelVerdict,
  drawLedgerRow,
  faceContrast,
  installCeremonyAnimationAudit,
  lumaVerdict,
  readDockedPanel,
  readDrawAudit,
  readLumaContext,
  readPassThroughBridges,
  settledOf,
  skyDiscRect,
} from './lib/w1-evidence.mjs';
// R40 (desktop CAPTURE): --no-boot, water-body screen rects, per-frame beats / core actors / draws.
import {
  attachNoBoot,
  compactBeats,
  compactCoreActors,
  forceClockWatchWanted,
  frameDraws,
  installForceClockWatch,
  readBusClockInPage,
  readForceClockInPage,
  readFrameExtrasInPage,
  readRenderCameraInPage,
  waterScreenRects,
} from './lib/gauntlet-evidence.mjs';
// R49 (tools seat): the K8 film crash — a held page present gate read as invalid-payload.
import {
  PRESENT_GATE_POLL_MS,
  PRESENT_GATE_REOPEN_WAIT_MS,
  presentRetryVerdict,
  presentTransition,
  presentWithRetry,
} from './lib/present-retry.mjs';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------
const SECTIONS = ['pulse', 'roster', 'teams', 'schedule', 'rules'];
// viewport key -> [width, height] (canonical order kept separately: JS reorders
// integer-like object keys ascending, which would turn 1440,768,390 into 390,...)
const VIEWPORTS = { 1440: [1440, 900], 768: [768, 1024], 390: [390, 844] };
const VIEWPORT_ORDER = ['1440', '768', '390'];
const DEFAULT_PORT = BOARD_DEV_PORT; // never 3000 — the harness owns its port only (C-081: shared constant of record)
const CAMERA_SETTLE_MS = 1800; // conductor damping lambda 5.2 -> settled
const HOLD_WAIT_MS = 8_000; // C-021 r2: pin from DOM start-align
const HOLD_PINS = { pulse: 0, roster: 1, teams: 2, schedule: 3, rules: 4 };
// The conductor's hold plateaus (scroll-map.ts) cover pulse/schedule only: on a
// plateau exact is exactly the integer and `pin` is a readout while smooth damps
// onto it. Every other station is
// landed by seeking scrollY until exact≈index (C-026 r1: teams settled at
// exact 2.22, camPos 0.85 m off the chapters.ts endpoint).
const SEEK_SECTIONS = new Set(['roster', 'teams', 'rules']);
const POSE_STABLE_EPS = 0.05; // sidecar pose tolerance (C-022 theme-pair)
const POSE_STABLE_HOLD_MS = 250; // camPos must hold still this long
const POSE_STABLE_WAIT_MS = 8_000; // wait for smooth to catch exact
const FOCUS_WAIT_MS = 12_000; // subject registration (GLB load) + blend settle
const INITIAL_SETTLE_MS = 3000; // fonts, entrance animations, sprite loads
const READY_TIMEOUT_MS = 120_000; // dev-server boot incl. cold compile
const WEDGE_TIMEOUT_MS = 10_000; // accepted conn, no HTTP response -> wedged
// Blank-frame floor scales with viewport area (~0.05 bytes/pixel of PNG):
// 1440x900 -> 64,800; 768x1024 -> 39,321; 390x844 -> 16,458. Flat teal
// LED-wall surfaces compress efficiently (~39.7KB fully rendered at 390x844),
// so a flat byte floor false-positived legitimate small-viewport frames;
// genuinely blank/black frames land far below (~2-5KB) and still fail hard.
const MIN_CAPTURE_BYTES_PER_PIXEL = 0.05;
// C-039 capture-mode animation-phase pin. Script-only pins, measured
// 2026-09-04 on this machine (3 parallel agent seats):
//  1. Rung pin — `?routeQuality=<PHASE_PIN_RUNG>` is applied when --quality is
//     auto, so the frame-time governor can never flip ladder knobs (post /
//     AO / ambient / shadow size) mid-run or between runs. Within one
//     appearance mode this closed the rung-straddling variance (rung 0 vs 1
//     same-mode west band differs ~8 gray; governor flips were observed under
//     load). PHASE_PIN_RUNG=1 keeps the full post stack (Bloom/SMAA/vignette/
//     AgX); an explicit --quality still wins.
//  2. Clock pin — a canonical uTime/elapsedTime write needs the r3f store,
//     which R3F v9 keeps in a module-private WeakMap keyed by the canvas
//     (window exposes no handle; canvas.__r3f is gone; __THREE__ is only a
//     revision marker). The harness probes an OPTIONAL debug-gated page hook
//     `window.__routeWorldPinPhase(uTime, elapsedTime)` inside the present
//     task and records whether one answered (clockHook in the sidecar).
//     C-045 r2: the hook additionally parks node-transform movers (statue
//     breathing / holo bob) by stamping the clock family and forcing one
//     synchronous r3f advance; when the page-side extension answers, the
//     sidecar's phasePin gains `moverPin: true` plus the `frameSubscribers`
//     count the advance executed (null when the page pre-dates the r2 hook —
//     additive, existing fields unchanged).
// KNOWN RESIDUAL (C-039 r1 BLOCKER): a page-side west-wing appearance race —
// two discrete looks ~51 gray levels apart at #pulse (light: flat ~102/stdev
// 32 [historical] vs bright ~154/stdev 59; dark: ~74 vs ~87) — lands per page
// load at ANY rung, load-correlated (~half of sessions today). Same-mode
// pinned double-runs measure 0.14-0.43 % (walker phase floor); straddled
// pairs 15.8-17.3 %. Excluded: governor/rung (pinned here), static batcher
// (converges to an identical 85 batches / 317 calls), stone maps (fully
// procedural), HDRI absence (blocking it prevents the canvas from mounting at
// all), sibling tree churn (attributed via file mtimes, PB-178), uTime
// materials (the west wing has none). Needs a page-side hook — see BLOCKER.
// Normal browsing is untouched: every pin lives only in this harness.
const PHASE_PIN_ENABLED = true;
const PHASE_PIN_RUNG = 1; // post stays on (Bloom/SMAA/vignette/AgX); AO is the top rung's bonus
const PHASE_PIN_U_TIME = 0; // canonical uTime for the optional page-side phase hook
const PHASE_PIN_ELAPSED = 0; // canonical clock.elapsedTime for direct readers

// C-046 offline blob-count parameters — the PB-191 count-of-record, folding
// the private _c047-blobs.mjs scratch detector into the shared tool (user
// shared-tooling directive; PB-123 scratch discipline). Values are the r1/r2
// record: diff threshold 30 gray, min blob area 60 px, min height 20 px, max
// width 400 px, 6-px column-gap split. Env knobs keep the scratch's sweep
// interface (TH / MIN_AREA / MIN_H / MAX_W).
const BLOB_TH = Number(process.env.TH ?? 30);
const BLOB_MIN_AREA = Number(process.env.MIN_AREA ?? 60);
const BLOB_MIN_H = Number(process.env.MIN_H ?? 20);
const BLOB_MAX_W = Number(process.env.MAX_W ?? 400);
const BLOB_GAP_RUN = 6; // consecutive empty columns that split one component
// C-046 hydration-flake retry: 'FBO present failed (missing-hook)' was seen
// once in 40+ captures under 3-seat load — the present hook never mounted.
// Bounded reload-retry, then an honest failure; every sidecar records
// presentRetries (additive).
const PRESENT_MAX_RELOADS = 2;
const PRESENT_HOOK_WAIT_MS = 15_000;
const PRESENT_RETRYABLE_REASONS = ['present-hook-timeout', 'missing-hook'];

// C-057 present-readiness waits. Kit-settle: the render path must report the
// kit facade ('kit' = instanced meshes mounted) and have held still
// KIT_SETTLE_MIN_MS — C-045 caught both A/A pulse loads shooting procedural
// (settledMs≈40) with the kit settling ~10 s later. Residency: fileMaps must
// reach the floor AND the render path must then hold still
// RESIDENCY_STABLE_MS — the bridge's settledMs resets on every batch/map
// change, so a long quiet window is the harness-side signature of "no asset
// still landing" (the C-047 r2 class: counts climbing at present time);
// when the debug-gated phase hook is up and walkers were requested,
// frameSubscribers must also reach its floor. Floors are the C-047 r2
// record's separation — walkerless loads presented at fileMaps 27 / FS 19,
// resident loads at 72-74 / 43 — overridable by env for sweeps (the BLOB_*
// knob idiom) as the asset set evolves.
const KIT_SETTLE_MIN_MS = 2_000; // render path must hold still this long post-kit
const KIT_SETTLE_WAIT_MS = 60_000; // bound for the kit facade to settle
// C-090 recalibration (2026-09-17): the post-C-089 ship-budget tree stably
// loads fileMaps=24 (two identical capture runs), so the C-047-era default of
// 40 false-failed every present with asset-residency-timeout. Floor = observed
// (24) − margin (2) = 22: normal ±1-2 load jitter still passes, while a
// material asset drop of >=3 (fileMaps <= 21, the card's boundary case)
// fails `fileMaps >= floor` below. Never set the floor equal to or above the
// observed value — that false-fails on jitter.
const RESIDENCY_FILE_MAPS_MIN = Number(process.env.RESIDENCY_FILE_MAPS_MIN ?? 22);
const RESIDENCY_FS_MIN = Number(process.env.RESIDENCY_FS_MIN ?? 30);
const RESIDENCY_STABLE_MS = 12_000; // quiet window: no map/batch change for this long
const RESIDENCY_POLL_MS = 500;
const RESIDENCY_WAIT_MS = 90_000; // bound for figure residency after the hook mounts
// Wave 2 r3: below the floor, a load this quiet is emitted with a flag (see residencyFlagged).
const RESIDENCY_BELOW_FLOOR_QUIET_MS = 30_000;
// Wave 2 r3: whole-world file-map counts on record (W1 judge: the clouds r5
// run recorded 26); carried into a flagged record for the judge, never a floor.
const RESIDENCY_REFERENCE = { clouds: { fileMaps: 26, from: 'fid-w1-r5 clouds run' } };
/** Wave 2 r3: flagged residency waits of this run (listed at the end, never an abort). */
const residencyFlags = [];
// C-098 --residency-auto: floor = observed − margin at the run's first quiet
// window — the sanctioned manual ancestor's margin law (RUNLOG
// 2026-09-17T14:58Z: RESIDENCY_FILE_MAPS_MIN=14 = observed 16 − 2; C-090's
// recalibration is the same observed−2 shape), automated. The margin is never
// applied to the observing wait itself.
const RESIDENCY_AUTO_MARGIN = 2;
// C-057 kiosk-LED content pin: the boards' live ticker strip repaints once a
// second from Date.now() (Board.tsx's only page-side clock read), so two
// loads capture different countdown strings — the 1-2 %-of-box per-load noise
// at the schedule pose (C-052). Freezing Date.now() at this canonical epoch
// makes every load paint the identical LED content. Canonical constant, the
// PHASE_PIN_U_TIME idiom.
const LED_PIN_NOW_MS = Date.UTC(2026, 0, 2, 12, 0, 0);
// C-057 residency-flake self-test shim: stall the first N figure-GLB
// responses, releasing them in RESIDENCY_FLAKE_STAGGER_MS staggered waves
// starting RESIDENCY_FLAKE_RELEASE_MS after arming, so the render path keeps
// CHANGING through the pose-settled window — the C-047 r2 asset-settle class
// (counts still climbing while the harness presents), reproducible without a
// second browser seat.
const RESIDENCY_FLAKE_RELEASE_MS = 20_000;
const RESIDENCY_FLAKE_STAGGER_MS = 5_000;
// Gauntlet round 1 reveal gate: before any station seek / still / sweep /
// frame trace on a route-tier page, html.world-route-live must be set AND the
// ball loader must be past its ceremony (data-ball-phase done|hidden, or no
// loader mounted). Bound = the 10 s readiness deadline + the ceremony + dev
// compile slack; past it the run fails with a named reason (reveal-gate-*)
// instead of shooting a still under the ball.
const REVEAL_GATE_WAIT_MS = 30_000;
const REVEAL_GATE_POLL_MS = 100;
// Station-settle assertion (always on): after landing, the conductor's
// nearest station must equal the requested index, |smooth − exact| <
// STATION_SETTLE_EPS and the WorldNav active chip must be #<section>. Polled
// for this long per landing; one re-seek, then a loud named failure — a still
// of the wrong station is never written.
const STATION_SETTLE_WAIT_MS = 4_000;
// --loader-film bound: the film stops at ball done/aborted (+ a short tail)
// or this long after navigation start, whichever comes first.
const FILM_MAX_MS = 25_000;
// Round 2: the seek's wait for a first numeric conductor read (was an
// unconditional 8 s wait for exact >= 0.5, which burned 8 s on every seek
// from the top of the page — pulse and any first seek).
const SEEK_PROBE_WAIT_MS = 2_000;
// Round 2 dev-compile warm-up bound (the lead's 45 s).
const WARMUP_MAX_MS = 45_000;
// Round 2 --film / --handoff-composite steady cadence (periodic composited
// screenshots beside the on-change screencast).
const FILM_CADENCE_MS = 100;
const COMPOSITE_CADENCE_MS = 50;
// Round 4: the loader recorder's canvas readback pauses from the ball's
// `opening` until world-route-live + this, so the composite keeps cadence.
// Round 5: the pause (composite runs) / throttle (no-composite runs) covers
// the whole composite window tail (world-route-live + 800 ms), not just 400.
const HANDOFF_PIXEL_PAUSE_AFTER_MS = 800;
/** Round 5: at most one canvas read per this many ms inside the handoff window (no-composite runs). */
const HANDOFF_READ_EVERY_MS = 100;
// Round 2 --fail-inject timeout: the scene chunk (react-three fiber, loaded
// lazily ~1 s after navigation in `next dev`) is held this long past the
// product deadline, then released — so a late presentation is exercised too.
// LOOK r6 SEAT H1: the URL regex is the dev fast path only; a production
// build's hashed chunk is found by content (look-r6-evidence sceneChunkMatch),
// with the world manifest as the fallback hold.
const FAIL_TIMEOUT_CHUNK_RE = /(%40|@)react-three[_/]fiber/;
const FAIL_TIMEOUT_HOLD_PAST_DEADLINE_MS = 8_000;
// Loader traces of runs that are expected to land Lite (fault injection,
// reduced motion) never "settle" live, so they run to this bound.
const LOADER_TRACE_LITE_MS = 28_000;
/** LOOK r2 SEAT H: sweep-film montage cell width (px; the halo check needs >= 480). */
const SWEEP_FILM_CELL_W = 480;
// Round 2 flat-still guard: 32x32 grey luma stddev of the world FBO below
// this refuses the still (calibrated: blank 4.8, real stills 25..53).
const FLAT_STILL_SPREAD_MIN = 10;

/** 32x32 grey downsample luma { mean, spread } of an encoded image buffer. */
async function lumaSpread(buf) {
  const { data } = await sharp(buf).greyscale().resize(32, 32, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  for (const v of data) {
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / data.length;
  return { mean, spread: Math.sqrt(Math.max(0, sumSq / data.length - mean * mean)) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function usage() {
  console.log(`Usage: node scripts/capture-route.mjs --tag <tag> [options]

Required:
  --tag <string>          Evidence tag prefixing every filename.

Options:
  --sections <list>       Comma-separated subset of ${SECTIONS.join(',')} (default: all).
  --viewports <list>      Comma-separated subset of ${VIEWPORT_ORDER.join(',')}
                          mapping to ${VIEWPORT_ORDER.map((k) => `${k}=${VIEWPORTS[k][0]}x${VIEWPORTS[k][1]}`).join(', ')} (default: all).
  --theme light|dark      Pinned via localStorage like capture.mjs (default: light);
                          data-theme is read back per file, mismatch fails the run.
  --locale en|de          i18n D11: the viewer language the world paints in, set as
                          the plc_locale cookie on every browser context (warm-up,
                          primer and measured). Absent = no cookie (the site default,
                          English). Baselines are per locale.
  --focus <subject id>    After the station settles, focus this subject (e.g.
                          board:pulse, ace:<player id>, desk-pc, plaque:left) and
                          capture the focused frame; filenames gain -focus-<id>.
  --tier auto|route|lite  Force the experience tier via ?tier= (default: auto).
  --quality auto|0..4     Pin the quality ladder rung via ?routeQuality= so the
                          governor cannot step headless captures down (default: auto).
  --phase-pin on|off      Capture-mode determinism pin (default: on; C-039). ON
                          forces ?routeQuality=${PHASE_PIN_RUNG} when --quality is
                          auto (the frame-time governor is a measured variance
                          source; rung ${PHASE_PIN_RUNG} keeps the full post stack) and probes
                          the optional page-side phase hook inside the present
                          task; the sidecar records the pin beside
                          camPos/pixelRatio. OFF restores pre-C-039 behavior.
                          LOOK r2: ON also pins the pointer parallax for every
                          still (not with --hover): real pointer events are
                          blocked, the pointer is centred and the harness waits
                          until yaw == the authored pathYaw (sidecar pointerPin),
                          so before/after poses match run to run.
  --board-page <n>        Pin the boards' rotating stadium page via ?boardPage= (default: 0).
  --ambient auto|0..9     Pin the ambient Pokémon head-count via ?ambient= (default: auto).
  --world <id>            Append world=<id> to the page params so the preview
                          dispatches a specific route world (e.g. sakura;
                          the --tier pattern — no other harness change).
  --fixture <variant>     Append fixture=<variant> to the page params so the
                          dispatched world loads that fixture variant (e.g.
                          open with --world sakura — the non-EPB preview;
                          the --world pattern — no other harness change).
  --blob-count <ref.png> <frame.png...>
                          OFFLINE PB-191 blob count-of-record (fold of the
                          private _c047-blobs.mjs detector; no server, no
                          browser, nothing written to disk): connected-component
                          scan of each frame's diff vs <ref.png> STRICTLY above
                          the HUD band, figure-shape filtered (min area
                          ${BLOB_MIN_AREA} px, min height ${BLOB_MIN_H} px, max width
                          ${BLOB_MAX_W} px) with the ${BLOB_GAP_RUN}-px column-gap split;
                          prints per-frame changedPx/blobs and the MIN over
                          frames. Frames are positional args; --tag labels the
                          output lines. Env knobs TH/MIN_AREA/MIN_H/MAX_W keep
                          the scratch detector's sweeps.
  --blob-band-top <px>    Band ceiling override for --blob-count, in frame
                          pixels (the HUD top; 844 at 1440x900). Default: the
                          per-frame sidecar hud.top stamped at present time.
                          The scan NEVER silently falls back to full-frame
                          (PB-205 yMax=900 bug class) — a frame with neither
                          source fails honestly.
  --present-flake-inject <0..3>
                          SELF-TEST ONLY (default 0): make the first N present
                          attempts fail as present-hook-timeout flakes so the
                          bounded hydration-flake reload-retry is exercisable
                          deterministically (1 = one successful retry, 3 = the
                          honest fail at the bound of ${PRESENT_MAX_RELOADS} reloads). The retry
                          itself is always on: when __routeWorldPresent never
                          mounts (missing-hook / present-hook-timeout) the page
                          is reloaded and the station re-landed at most
                          ${PRESENT_MAX_RELOADS} times, then the run fails honestly; every
                          sidecar records presentRetries (additive).
  --kit-settle on|off     Present-readiness wait (default: on; C-057). ON holds
                          the present until __routeWorldRenderPath reports the
                          GLB kit facade ('kit') with the render path held
                          still >= ${KIT_SETTLE_MIN_MS} ms (bounded by
                          ${KIT_SETTLE_WAIT_MS / 1000}s, then an honest kit-settle-timeout
                          failure), so pulse stills never straddle kit
                          freshness (C-045: both A/A pulse loads shot
                          procedural). OFF restores pre-C-057 behavior.
  --residency-wait on|off Asset-residency present-wait (default: on; C-047/C-057).
                          ON holds the present until renderPath.fileMaps >=
                          ${RESIDENCY_FILE_MAPS_MIN} (env RESIDENCY_FILE_MAPS_MIN) and has
                          held stable >= ${RESIDENCY_STABLE_MS} ms — and, when the
                          debug-gated phase hook is up and walkers were
                          requested (--ambient not 0), phasePin
                          frameSubscribers >= ${RESIDENCY_FS_MIN} (env RESIDENCY_FS_MIN).
                          Bounded by ${RESIDENCY_WAIT_MS / 1000}s, then an honest
                          asset-residency-timeout failure: a walkerless frame
                          (C-047 r2: fileMaps 27 / FS 19 painted ZERO walkers
                          while resident 72-74 / 43 painted) is never written
                          as evidence. OFF restores pre-C-057 behavior.
  --residency-auto        Opt-in residency auto-calibration (default: off;
                          C-098). ON makes the run's FIRST residency wait
                          quiet-window-only (no fileMaps/FS floor applied —
                          OBSERVE-BEFORE-GATE), then derives the floors from
                          the settled counts: floor = observed − 2, printed
                          once ("residency floor <observed>-2 = <value>
                          (auto)", jitter disclosed; plus "residency fs
                          floor <observed>-2 = <value> (auto)" only when the
                          frameSubscribers gate is active — debug-gated phase
                          hook + phase pin + walkers requested — else
                          "residency fs=n/a (gate inactive)") and applied
                          run-scoped from that point (the sanctioned manual
                          ancestor's margin law — RESIDENCY_FILE_MAPS_MIN=14 =
                          observed 16 − 2 — automated). OFF keeps the fixed
                          floors.
  --blob-report <path>    With --blob-count: also write the mode's stdout
                          lines to <path> (a disk artifact for jury citation;
                          C-046 SPAWN). stdout shape is unchanged.
  --project-instances <name[,name...]|*>
                          C-109 r1 attribution probe (implies --debug on): after
                          the pose settles, project every instance of the named
                          InstancedMeshes (or all with "*") through the LIVE
                          landed camera into frame pixels; stdout lines + sidecar
                          projectInstances report per mesh count / inFrame /
                          inBand (the frame's bottom third - the judged band) +
                          up to 8 in-band samples; a dead-center self-check
                          validates the projection basis. A name matching
                          nothing fails the run honestly.
  --hide-mesh <name>      C-109 r1 toggle arm (repeatable; implies --debug on):
                          hide every object whose .name matches exactly inside
                          the present task (restored in the same task after the
                          frame is read); sidecar stamps meshHide. A name
                          matching nothing fails the run honestly.
  --patch-material <sig>=<uniform>=<value>[,...]
                          Delta-isolation arm flag (C-052 methodology as
                          tooling, PB-252): before the present, inside the
                          SAME page task, set the named values (numbers) on
                          every material whose NAME or TYPE matches <sig>
                          exactly (e.g. a GLB material name, or the type
                          "ShaderMaterial") via the debug-gated
                          __routeWorldScene handle. A value lands in the
                          material's uniform of that name, else — standard
                          materials have no uniform table — in the same-named
                          numeric material property (e.g. emissiveIntensity).
                          Repeatable; implies --debug on (the scene handle is
                          debug-gated); a spec that matches nothing fails the
                          run honestly. Applied BEFORE the phase pin, so the
                          pin's canonical uTime write stays last.
  --led-pin on|off        Kiosk-LED content pin (default: off; C-057). ON
                          freezes Date.now() at a canonical epoch
                          (${new Date(LED_PIN_NOW_MS).toISOString()}) via addInitScript, so the
                          boards' once-a-second live ticker strip paints the
                          identical countdown in every load — the per-load LED
                          content noise at the schedule pose (C-052: 1-2 % of
                          the kiosk box). Sidecars record ledPin (additive).
  --crest-pin on|off      LOOK r3 crest-LED slide pin (default: on with the phase
                          pin, else off; OFF by default with --quiet-probe /
                          --loader-trace / --loader-film, whose counters must
                          see the slide cut's texture upload). The plaza crest LED rotates slides on a
                          setInterval of CREST_HOLD_S (read from LedScreen.tsx)
                          from mount, so the slide a still shows depended on load
                          time (teams LED "Platz 8" before vs "Platz 4" after).
                          ON blocks interval registrations of exactly that delay,
                          so every load holds the first slide; sidecar
                          ledPin.crest {delayMs, blocked, sites}.
  --residency-flake-inject <0..4>
                          SELF-TEST ONLY (default 0): stall the first N
                          figure-GLB responses, releasing them in
                          ${RESIDENCY_FLAKE_STAGGER_MS / 1000}s staggered waves from
                          ${RESIDENCY_FLAKE_RELEASE_MS / 1000}s after arming, so the C-047 r2
                          asset-settle class (figure fetches still landing
                          after the pose settle, render-path counts climbing)
                          is reproducible deterministically — with
                          --residency-wait off the frame is written walkerless,
                          with it on (default) the present is held until the
                          figures land (the flip).
  --frames <n>            S9 motion trace (1..${FRAMES_MAX}; implies --debug on): after each
                          station's still, present n more frames through the
                          same FBO+HUD path (no phase pin, no readiness waits —
                          the world keeps moving) and sample
                          __routeWorldFigures / __routeWorldOcclusion /
                          __routeWorldCamera per frame. Writes
                          <tag>-<section>[-focus-<id>]-<vp>-fNN.png, a montage
                          -strip.png and -trace.json with the W2 phase-collision,
                          W4 occluded-share and W1 subject-occlusion verdicts.
                          Frames are SAMPLED presents, not video.
  --interval <ms>         With --frames: target spacing between frame starts
                          (default ${INTERVAL_DEFAULT_MS}; 100..10000). 30 x 1000 = the W2/W4 30 s window.
                          Wave 2 r3: below 1000 ms the trace runs the in-page
                          fixed-cadence sampler (canvas thumbnails + bridge
                          reads, no present / occlusion per frame), so the
                          interval is actually honoured; at #teams it is armed
                          on the arrival (lands roster, clicks the teams chip)
                          and judges the roll call (rollCall).
  --burst-interval <ms>   With --burst: the in-page sampler interval (50..1000;
                          default 200, 100 for a teams arrival so >= 8 samples
                          fall inside the 1580 ms roll call).
  --occlusion on|off      S9 one-shot W1 record (default: off; implies --debug on):
                          after the present, raycast every focus subject and
                          figure through the live camera and intersect the
                          visible DOM layers (HUD, docked panel, caption,
                          loader) with the projected subject rects; the
                          sidecar gains an additive "occlusion" field.
  --sweep down|up|jitter|jump|panel|dither
                          S9 W6 gesture (implies --debug on; replaces the
                          stills): land the first (up: last) requested
                          section, script wheel steps toward the other end
                          (jitter: 3 forward, 1 back), record progress /
                          nearest / direction / yaw / pitch / camPos / skip /
                          chip / key light / docked-panel box per rAF, and write
                          <tag>-<mode>-<vp>-sweep.json with the direction-flip
                          + crossing-height verdict. Round 2: jump = nav-chip
                          jumps pulse->schedule and rules->roster (skip-through
                          verdict); panel = 3 open/close cycles of a team panel
                          + a B-tap cross-blend (teams) and a board panel
                          (schedule), panel-edge verdict; dither = park at
                          k+0.5+-0.08 (k = roster->teams) and wheel +-40 px 20x,
                          consumer-hysteresis verdict. Not combinable with
                          --frames or --focus.
  --flip-probe <px>       Round 2 W6 flip probe (implies --debug on): load the
                          page, scroll to the first requested section's top +
                          <px> while it is still Lite, wait for the Lite->route
                          flip and assert the section at the activation line
                          and the active chip are unchanged; writes
                          <tag>-<section>-<vp>-flip.json (no stills).
  --page-path <path>      Navigate this app path instead of /route-preview (e.g.
                          /leagues/<id> — the real evoliga league plaza). The
                          sidecars' invocation.url records it.
  --handoff-composite     With --loader-trace: also record the COMPOSITED page
                          (CDP screencast) and flag blank frames in
                          [routeLive-200, routeLive+600] ms; a window sampled
                          sparser than 100 ms is insufficient-sampling, never
                          a pass. Round 2: screencast plus periodic composited
                          screenshots every ${COMPOSITE_CADENCE_MS} ms.
  --relax-deadline <ms>   Round 2, NON-W7 visual evidence only (implies --debug
                          on): append readyDeadlineMs=<ms> (10000..45000) so a
                          slow \`next dev\` compile does not push the world to
                          Lite. The product honours it only with routeDebug=1
                          and never in a production build. Refused together
                          with --loader-trace / --loader-film /
                          --handoff-composite / --fail-inject.
  --fail-inject context-loss:loading|context-loss:opening|timeout|stall:<ms>|stall-hold
                          Round 2 W7 failure path (needs --loader-trace and
                          --tier auto or route; LOOK r2: stall:<ms> = the product's
                          debug stall hook ?stallInjectMs=<ms> (0..13000), judged
                          as analysis.stallPath: Lite by stall + 6 s, reason
                          readiness-stall, no partial reveal): lose the scene's WebGL context while the
                          ball is loading / opening, or hold the lazily loaded
                          scene chunk (react-three fiber) until deadline + ${FAIL_TIMEOUT_HOLD_PAST_DEADLINE_MS / 1000}s.
                          LOOK r6: prod-capable — every /_next/static/chunks/*.js
                          is fetched and only the chunk whose body carries the
                          R3F hook error string is held (the dev URL regex is
                          the fast path; the world manifest.json is the
                          fallback hold); failInject.held[].by says which.
                          LOOK r6: stall-hold = a harness-side stall for PROD
                          builds (stall:<ms> is dev-only): every world-asset
                          request is held from navigation, judged as
                          analysis.stallPath from the attempt's begin.
                          The trace records when and in which phase it fired
                          and judges the fall to Lite; no stills.
  --chip-jump <from>,<to> Round 2: a --sweep jump over this leg (repeatable),
                          e.g. --chip-jump pulse,schedule.
  --panel-edge            Round 2: alias for --sweep panel.
  --sweep-film            Round 5, with --sweep / --chip-jump / --panel-edge:
                          film the gesture (CDP screencast) and write
                          <tag>-<mode>-<vp>-sweep-film.png (a labelled ~12-frame
                          montage: window, ms, smooth progress, nearest station)
                          plus -sweep-film.json. Adds capture load: shoot it
                          under its own --tag, never as the timing run.
                          LOOK r2: montage cells are 480 px wide (3 per row).
  --dolly-stills           LOOK r2, with --sweep-film: also write the film frame
                          at each quarter point (k + 0.25 / 0.5 / 0.75 of smooth
                          progress) of every crossing as a full-resolution PNG,
                          <tag>-<mode>-<vp>-dolly-NN-s<k>p<q>.png (screencast q92;
                          listed in -sweep-film.json film.dolly).
  --diff-against <tag>    LOOK r2 (blast radius): per still, diff the PNG against
                          <tag>-<same section/focus/viewport>.png (per-pixel max
                          |dRGB|: changed %, share > 8 levels, mean, max; HUD band
                          excluded; each data face separately) and record it with
                          the pose match as sidecar diffAgainst. Offline twin:
                          node scripts/lib/still-diff.mjs <a.png> <b.png>.
                          LOOK r3: <tag> may be a comma list of candidates
                          (e.g. <before>-retry,<before>): the first whose still
                          exists AND whose pose matches is diffed; with no
                          pose-matched candidate the verdict is pose-mismatch
                          (never a render claim). diffAgainst.candidates lists
                          each one's pose match and pointer pin.
                          LOOK r4: candidates are RANKED, not taken in list
                          order: pose match first, then world-luma agreement
                          with this still (within 20 %; a black-IBL baseline
                          is passed over when a lit one exists), then the
                          closer luma. diffAgainst.chosenBecause / .candidate-
                          Ranking say which and why. Every diffed still also
                          records diffRects (data-face + figure rects, --luma
                          or not), so faces[] is reported in every world,
                          faces[].inner is the face inset 25 % per side (copy
                          without bezel) with both stills' mean luma, and
                          frameMasked is the frame with the figure rects of
                          both stills also left out. Offline: node
                          scripts/lib/still-diff.mjs --against <after> <c1,c2>.
  --diff-floor <tag>[,..] LOOK r3, with --diff-against: a second BEFORE set shot
                          at the same poses. The picked baseline is diffed
                          against it (before vs before = the noise floor), and
                          diffAgainst.floor.vsFloor says per frame and per data
                          face whether the after diff is within-floor or
                          above-floor (share > 8 levels +0.5 pt, mean +0.5).
                          The floor pair is checked first (floor.baseline): a
                          pose, lighting-state or world-luma (> 20 %) mismatch
                          marks it suspect — not a noise floor. Every diff also
                          records lighting (sceneLighting of both stills, read
                          with --debug on: theme, IBL, lights, fog) and worldLuma.
                          LOOK r4 canonical BEFORE pairs: shoot a set twice
                          (<tag> and <tag>-b, --debug on) and gate it with
                          node scripts/lib/still-diff.mjs --tags <tag> <tag>-b
                          --gate (exit 1 unless every pair is pose-matched,
                          lighting-consistent, within 3 % world luma and free
                          of black-IBL stills).
                          Audit a whole before set offline: node
                          scripts/lib/still-diff.mjs --tags <tagA> <tagB>.
  --warmup on|off|auto   Round 2 dev-compile warm-up (default auto = on with any
                          evidence arm): load the page once in a throwaway
                          context and wait for it to present (bound ${WARMUP_MAX_MS / 1000}s)
                          before the first measured navigation; every output
                          records it as "warmup" (warmupMs, outcome).
  --cold-shaders          LOOK r3: a cold-profile run — no warm-up navigation in
                          this browser (warmup.ran false) and Chromium launched
                          with --disable-gpu-shader-disk-cache and
                          --disable-gpu-program-cache, so reveal times are cold
                          shader times (invocation.args.coldShaders). The dev
                          server's own compile is NOT primed: shoot one warm run
                          first if next dev is cold. Refused with --warmup on.
  --no-handoff-composite  Round 3: --loader-trace implies --handoff-composite
                          (composited handoff, routeLive +-800 ms) on live-bound
                          runs; this opts out (the handoff is then usually
                          unmeasured: insufficient-sampling).
  --content-baseline check|record|off
                          Round 3 station content (default check): every route
                          still checks its station's subject is present
                          (subject-missing) and compares the frustum content
                          count with gauntlet/evidence/station-content-
                          baseline.json (station-content-missing below 80 %).
                          record = adopt this run's counts (accepted runs
                          only). A failed still is written and the run exits 1.
  --strip-crop x,y,w,h    Round 3, with --frames: also write <base>-strip-crop.png
                          of that region (image px) of every frame.
  --pin-utime <s>         Round 3: the phase pin's canonical clock (default 0).
  --dpr <n>               Round 4: the browser context's deviceScaleFactor
                          (1..3; default 1, unchanged). Real-phone 390 recipe:
                          --viewports 390 --dpr 2. The warm-up uses it too.
  --loader-trace          S9 W7 recorder armed before navigation (implies --debug on:
                          the readiness bridge is debug-gated): per-rAF ball
                          phase + visibility, world-route-live, canvas opacity,
                          __routeWorldReadiness(), and a canvas
                          pixel read per rendered frame; writes
                          <tag>-<vp>-loader.json with the blank-frame /
                          deadline-overrun / Lite-block verdict. Run it on its
                          own: the pixel readback costs GPU time.
  --loader-film           W7 film (implies --debug on): from navigation start until
                          the ball reaches done/aborted (bounded ${FILM_MAX_MS / 1000}s),
                          record frames via CDP Page.startScreencast (fallback:
                          periodic page.screenshot at 15 fps), stamp each with
                          t(ms) + ball phase + scene phase, and write
                          <tag>-<vp>-loader-film.png (a labelled montage of ~20
                          frames, 60 % inside the reveal window presented->done)
                          plus <tag>-<vp>-loader-film.json (every frame's stamp,
                          the achieved fps, the reveal window).
  --param <key>=<value>   Repeatable page-URL passthrough, e.g. --param
                          waterDebug=ripples. Keys the harness sets itself
                          (${PARAM_RESERVED_KEYS.join(', ')})
                          are refused — use their flags. Round 5: with
                          --loader-trace, --param routeShaderCheck=0 is
                          recorded in -loader.json shaderCheck (the renderer's
                          checkShaderErrors at the trace's end, honoured
                          true/false).
  --luma on|off           Wave 2 W1 arm (default off; implies --debug on): per
                          still, luma (Rec.709, 0..255) of the FINAL PNG split
                          into the active data face (the station's board /
                          roster / ledger / rules subject rect) and everything
                          else, with the sky-body disc (${SKY_DISC_MASK_DEG} deg cone), the HUD
                          band and the DOM chrome excluded. Sidecar "luma":
                          { verdict: outsideP995 <= activeFaceP99, activeFaceP99,
                          outsideP995, outsideP995ExFigures, topHotspots[] }
                          plus "contrast" (text vs ground sampled on the PNG,
                          WCAG ratio per text tile: < 3 fail, < 4.5 marginal).
                          A luma fail with the figure rects left out
                          (exFigures) exits 1; a fail carried only by figure
                          rects is logged (the wave-2 exemption until wave 3).
                          LOOK r2: when face P99 and outside P995 are both clipped
                          (>= 254.5) the verdict is "saturated" (luma.saturation:
                          clip shares + unclipped percentiles) and the contrast
                          verdict decides (a contrast fail exits 1).
                          Every evidence still also records the docked panel
                          (computed font-size >= 14 px, box in the viewport;
                          a failing open panel exits 1) and the pass-through
                          bridges __routeWorldBeats / __routeWorldAttacks.
  --audit on|off          Wave 2 draw-budget arm (default off; implies --debug on):
                          per landed station, 5 whole-frame renderer.info
                          draw-call reads (median/min/max, the TelemetrySampler
                          keeps autoReset off so shadow + post passes count)
                          and renderer.info.programs into sidecar "drawAudit",
                          and one row appended to gauntlet/fidelity/DRAW-LEDGER.md.
                          Measure at --quality 0 (the budget law is rung 0).
  --reduced-motion       Emulate prefers-reduced-motion: reduce in the browser
                          context. Reduced motion is a hard Lite floor (D12);
                          add --tier route to judge the route-tier variant.
  --quiet-probe           LOOK-PLAN SEAT H, D23 "complete at reveal" (implies
                          --debug on; its own run, no stills; LOOK r2: allowed
                          with --relax-deadline on dev, marked deadlineRelaxed and
                          indicative only; the -quiet.json is ALWAYS written — a
                          reveal that never lands is verdict unmeasured with the
                          four counts null, the stage, the reason and the
                          recorder's since-navigation counters): a recorder armed before navigation
                          (PerformanceObserver resource + longtask, WebGL link /
                          texture counters, the renderer via three's devtools
                          hook) counts, per leg after world-route-live,
                          world-asset fetches (/models/world, the world-assets
                          bucket, /textures/world), program links, texture
                          uploads and long tasks >= 50 ms. Legs: idle (live ->
                          probe start), (a) sweep (full down + up), (b) jump
                          (--chip-jump legs, default pulse->schedule and
                          rules->roster). Writes <tag>-<theme>-<vp>-quiet.json; every
                          count must be 0, else exit 1 (unmeasured never passes).
  --quiet-governor        With --quiet-probe, leg (c): walk the ladder down to
                          rung 4 after reveal with routeQuality unpinned
                          (window.__routeWorldQualityForce when the page
                          publishes it, else the real governor fed slow frames);
                          programs, fetches and long tasks 0 and the texture
                          change equal to the reported RT reallocations.
  --quiet-theme           With --quiet-probe, leg (d): toggle light<->dark and
                          expect exactly one new generation with a complete
                          ball ceremony; the probe then restarts (idle / sweep /
                          jump @theme) in the new palette. CHROME (D32): the
                          leg is JUDGED — the toggle must raise the theme veil,
                          and every world fetch, program link, texture upload /
                          allocation and long task after it must fall inside
                          the veil-opaque window (none during the fade-in, none
                          once the fade-out began, through the 2 s hold); the
                          veil timings are recorded in the leg (veil). The
                          Station Card (DOM chrome above the veil) is sampled
                          every frame and judged (veil.card): no pop, hidden
                          while the veil is opaque, at most one hide + one show.
  --quiet-start-theme <light|dark>
                          With --quiet-probe: the palette the quiet legs start
                          in (pins the run's --theme; an explicit --theme must
                          agree). With --quiet-theme the toggle then goes the
                          other way (dark-start: dark -> light), and the file is
                          <tag>-<start theme>-<vp>-quiet.json.
  --rung-step <s>:<rung>  POKEMON-CORE A1, with --frames (presented trace): step the
                          quality ladder live to <rung> (descend-only force hook)
                          <s> seconds into each station's trace; recorded as
                          -trace.json rungStep, with the ledger's actor
                          appearance log over the trace in warmStats.
  --quiet-busy <ms>       POKEMON-CORE A1, with --quiet-probe: a judged busy leg
                          after idle — wait for the latched station settle, then
                          hold still <ms> (1000..300000; R41: up to 5 min for the
                          K6-natural real-time leg); its warmStats window
                          starts at the settle (busyP50 / busyP95 after settle).
  --dom-backdrop fbo|live POKEMON-CORE A1.6 (default fbo): the DOM layers a still
                          composites (HUD band, Station Card, 2C overlays, focus
                          panel) are element screenshots of the LIVE page, so a
                          translucent layer carried whatever the canvas painted
                          seconds after the pinned present (walkers under the HUD
                          band). fbo: the presented frame is laid over the canvas
                          as an <img> while those layers are shot, so their
                          backdrop is the pinned frame; live: the pre-A1 path.
                          Trace frames always shoot live. Recorded as
                          devOverlay.domBackdrop.
  --veil-film             With --quiet-theme: a CDP screencast of the theme
                          veil (toggle -> clear + 0.5 s) written as
                          <tag>-<theme>-<vp>-veilfilm/ frames + index.json and
                          a -veilfilm-sheet.jpg contact sheet.
  --nav-reveal-probe      CHROME (D33), its own run (implies --debug on; no
                          stills): after the reveal, the site NavBar must be
                          hidden above the viewport, reveal after a ~120 ms
                          dwell at the top edge (screenshot), close ~0.4 s after
                          the pointer leaves, ignore a fly-through, reveal on
                          Tab from the page start and close on Esc (focus
                          leaves the bar) — all without moving the conductor
                          (scrollY, active station); the first reveal's rAF
                          gaps and long tasks are measured. With --touch on:
                          the HUD menu chip reveals it, the hamburger drawer
                          opens from it, a tap outside / Esc / a station chip
                          close it. Writes <tag>-<theme>-<vp>-navreveal.json
                          and -navreveal-*.png; any failing check exits 1.
  --quiet-inject fetch|program
                          SELF-TEST ONLY, with --quiet-probe: fire one fake
                          world-asset fetch or one fresh program compile in the
                          sweep leg; the verdict must fail on it (exit 0 when
                          the injection is detected, 1 when it is missed).
  --prod-attach           Attach to a production server on --port (never boots
                          one): the listener's process chain must be next start
                          (next dev is refused; an unresolved chain needs every
                          page load free of the dev overlay), and
                          --relax-deadline is refused. Recorded as
                          invocation.prodAttach (pids, chain, BUILD_ID mtime).
  --no-boot               R40: attach to the dev server already on --port and
                          NEVER kill or boot one (scripts/gauntlet/run-queue.sh
                          passes it by default). Probes it up to 3 x 30 s; an
                          unresponsive or absent server fails the run with a
                          clear message. Recorded as invocation.noBoot.
  --debug on|off          Append ?routeDebug=1 to the captured URL (default: off).
                          LOOK r2: with it on, stills, loader traces and quiet
                          records carry paintAudit (window.__paintAudit); every
                          record carries assetOrigin (world-asset hosts, sources,
                          bytes of this load).
                          LOOK r4: every still with it on also carries iblState
                          (environmentIntensity, and the prefiltered PMREM IBL
                          read back from its render target: pmremReady, mean /
                          max radiance); a BLACK prefiltered IBL rejects the
                          still (sidecar kept, run exits 1). Every landed still
                          judges its data faces (stationContent.faces): a board
                          below its registered renderable count, or a face with
                          < 1 % edge pixels in the PNG (blank / unpainted), fails
                          as data-face-blank. Quiet records carry
                          programsAtReveal (the one judged program count:
                          renderer.info.programs at world-route-live, start
                          rung) and recorder.drops (a recorder that lost judged
                          entries makes the run unmeasured, never a pass).
                          LOOK r5: every still, loader trace and quiet record
                          with it on carries programSplit: renderer programs
                          split by output colour space + tone mapping, ACTIVE
                          (drawn over 3 sampled frames + raw + the most-drawn
                          output colour space) vs PRE-WARMED other-rung
                          variants, with d26 judged on the active count (cap
                          87 light / 109 dark, judged at rung 0 only: shoot
                          --quality 0; other rungs read informational). Face
                          presence adds the harness's own texture read
                          (map / emissiveMap / texture uniforms: renderables.
                          texturedHarness), and the ledger:teams face rect is
                          its textured face mesh (rectSource), not the slab +
                          plinth bounds. Loader traces add analysis.
                          mainThreadGaps (rAF samples: preBall / ceremony /
                          after, source named); the film's analysis.maxGapMs is
                          a capture gap (maxGapSource), never a main-thread gap.
                          Quiet records add stationsCovered. V3 (prod reveal,
                          median of 3): node scripts/lib/reveal-median.mjs
                          --tags <t1,t2,t3> [--viewport 1440].
  LOOK r6 SEAT H (D28; helpers in scripts/lib/look-r6-evidence.mjs, look-probe.mjs,
  trace-summary.mjs). Always on: station content is keyed by the DOM world
  ([data-world], evoliga -> plaza), the dpr and the rung
  (<world>|<theme>|<station>|<vp>|d<dpr>|q<rung>, falling back to the r4 rung
  key and the rung-less key; a fail against another rung / dpr is "suspect",
  never an exit; --content-baseline record writes the exact key); the reveal
  gate records the phase trace from navigation (revealGate.phaseTraceFromNav);
  --diff-against ranks a world's canonical baseline first (D27 sakura:
  fid-w2c-r2-sakura-light), flags BASELINE-IBL-UNKNOWN and masks the Station
  Card; a saturated --luma cell falls back to the inner-face diff; quiet
  records are <tag>-<theme>-<vp>-quiet.json; loader traces carry loaf (long
  animation frames with script attribution, per ball phase).
  --gpu-trace             With --loader-trace: a Chromium trace of the load
                          (${GPU_TRACE_CATEGORIES.join(', ')}) to
                          <tag>-<vp>-gpu-trace.json plus the top GPU / main-thread
                          tasks per ball phase in -gpu-trace-summary.json
                          (offline: node scripts/lib/trace-summary.mjs <trace>).
                          Adds capture load: never a timing reference.
  --program-keys          After the reveal: every renderer program's cacheKey,
                          name and drawn flag plus the near-duplicate key audit
                          (ENGINE E7) -> <tag>-<vp>-program-keys.json. Implies --debug on.
  --warm-cache            With --loader-trace: after the run, a second browser
                          without the cold-shader flags loads each viewport twice
                          (primer, warm) and <tag>-warm-cache.json reports the
                          reveal cold / primer / warm and the shader-source
                          stability (primer vs warm, viewport vs viewport).
  --net-throttle <mbps>,<rttMs>
                          Shape the measured page's network (CDP) before the
                          navigation, e.g. 50,20 (the r6 brief's broadband check).
  --dolly-at <s,...>      With --sweep-film: the film frame at each conductor
                          progress point (e.g. 3.55,3.60,3.64,3.70) of every
                          crossing -> <tag>-<mode>-<vp>-dollyat-NN-s<k>p<q>.png
                          plus a .json with the camera pose.
  --contrast-repeat       With --luma on: present each still's pose a second time
                          (<still>-repeat.png) and record the per-face contrast
                          noise band (sidecar contrastNoise).
  --look-probe            Per still (and per --dolly-at still): the R6-BRIEF §6
                          metrics (façade ΔE / value per block, near / far chroma,
                          cast vs lit hue, canopy rim hue, night streaks, board vs
                          world luma, sky-gap flat area) into sidecar lookProbe;
                          reported, never judged. Implies --debug on. Offline:
                          node scripts/lib/look-probe.mjs <still.png> [--overlay <dir>].
  --port <n>            Dev-server port (default: ${DEFAULT_PORT}; 3000 refused).
  --allow-bucket          Let world assets and sprites come from the Supabase
                          world-assets and sprites buckets. Without it the run
                          FAILS (exit 1) at the first record whose load made
                          any bucket request (assetOrigin.sources.bucket > 0 or
                          assetOrigin.spritesBucket.requests > 0; sidecars carry
                          assetOrigin.bucketGuard). A self-booted dev server
                          always gets NEXT_PUBLIC_WORLD_ASSETS_URL=/models/world
                          and NEXT_PUBLIC_SPRITES_URL=/sprites.
                          Use it only for a deliberate production check.
  --help                  Show this help.

Output: gauntlet/evidence/<tag>-<section>[-focus-<id>]-<viewport>.png
        and the matching .json (pose probe sidecar: conductor, camPos, focus, bounds;
        C-039: phasePin, durationMs, stationMs, invocation; C-045: renderPath;
        C-046: hud, presentRetries (reload count); R49: presentGateRetry +
        presentGateRetryVerdict (also on contrastNoise; trace: presentGateRetries,
        presentGateRetryVerdict, samples[].presentRetry); C-057: kitSettle, assetResidency, materialPatch,
        ledPin; S9: occlusion only with --occlusion on; round 1: revealGate,
        stationSettle; wave 2 on evidence runs: settled, dockedPanel,
        bridges {beats, attacks, coreActors, water}; with --luma on: luma +
        contrast; with --audit on: drawAudit; R40, debug stills: waterRects =
        each water body's surface rect on screen, for stills.mjs --mask-water).
        --frames samples (R40) also carry beats / coreActors / draws per frame,
        and quiet records carry jsChunks per leg plus the end-of-run bridges.
        S9 arms add -fNN.png, -strip.png, -trace.json,
        -sweep.json, -loader.json, -loader-film.png and -loader-film.json.
        --blob-count mode prints to stdout only (plus --blob-report).

Always on (route tier): the reveal gate (world-route-live + ball done/hidden,
bounded ${REVEAL_GATE_WAIT_MS / 1000}s; an aborted ball is only Lite after the ${REVEAL_DEADLINE_MS / 1000}s readiness
deadline + ${REVEAL_AFTER_ABORT_MARGIN_MS} ms — a route that goes live after an abort is
"revealed-after-abort" and asserted) runs before any seek/still/sweep/trace,
and every landed station is asserted (nearest === index, |exact-index| <
${STATION_SETTLE_EPS} unless the conductor holds the station, |smooth-exact| < ${STATION_SETTLE_EPS}, WorldNav
chip matches, activeIndex === index, and the latched settled flag true when
the page publishes it; one re-seek) — a mismatch fails the run with a named
sidecar reason and no still. With --debug on (or any arm implying it) the debug perf
readout is hidden from navigation on (sidecar devOverlay.debugHudsHidden).`);
}

// ---------------------------------------------------------------------------
// CLI parsing + validation (usage errors exit 2)
// ---------------------------------------------------------------------------
if (process.argv.includes('--help')) {
  usage();
  process.exit(0);
}

const tag = arg('tag');
if (!tag || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) {
  console.error(
    'capture-route: --tag <string> is required and may contain only [A-Za-z0-9._-] (it prefixes filenames)',
  );
  process.exit(2);
}

function parseList(raw, allowed, label) {
  if (!raw) return allowed.filter(() => true); // default: all, canonical order
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = parts.filter((p) => !allowed.includes(p));
  if (invalid.length > 0) {
    console.error(`capture-route: invalid ${label}: ${invalid.join(', ')} (allowed: ${allowed.join(', ')})`);
    process.exit(2);
  }
  // dedupe, keep canonical order
  return allowed.filter((a) => parts.includes(a));
}

const sections = parseList(arg('sections'), SECTIONS, '--sections value');
const viewportKeys = parseList(arg('viewports'), VIEWPORT_ORDER, '--viewports value');
if (sections.length === 0) {
  console.error('capture-route: --sections resolved to an empty set');
  process.exit(2);
}
if (viewportKeys.length === 0) {
  console.error('capture-route: --viewports resolved to an empty set');
  process.exit(2);
}

// Rollout harness (CAR r11: "all records are light-start only"):
// --quiet-start-theme <light|dark> pins the palette the quiet legs start in
// (the run's --theme; with --quiet-theme the toggle then goes the other way).
// It needs --quiet-probe (checked below) and must agree with an explicit --theme.
const quietStartTheme = arg('quiet-start-theme', null);
if (quietStartTheme !== null && !['light', 'dark'].includes(quietStartTheme)) {
  console.error('capture-route: --quiet-start-theme must be light|dark');
  process.exit(2);
}
if (quietStartTheme !== null && process.argv.includes('--theme') && arg('theme', null) !== quietStartTheme) {
  console.error(`capture-route: --quiet-start-theme ${quietStartTheme} contradicts --theme ${arg('theme', null)}; pass one of them`);
  process.exit(2);
}
const theme = quietStartTheme ?? arg('theme', 'light');
if (!['light', 'dark'].includes(theme)) {
  console.error('capture-route: --theme must be light|dark');
  process.exit(2);
}
// LOOK r3 (CAR judge): the theme every data-theme read-back is checked
// against. It starts as the pinned --theme, is reset per viewport context, and
// follows the harness's OWN toggle (--quiet-theme), so the @theme legs no
// longer abort on the harness's pin ("pinned light but document dark").
let expectedTheme = theme;

const debug = arg('debug', 'off');
if (!['on', 'off'].includes(debug)) {
  console.error('capture-route: --debug must be on|off');
  process.exit(2);
}

// C-039: default ON so the bare evidence invocation is deterministic; the
// opt-out keeps the pre-C-039 shape for round-trip comparisons.
const phasePinRaw = arg('phase-pin', PHASE_PIN_ENABLED ? 'on' : 'off');
if (!['on', 'off'].includes(phasePinRaw)) {
  console.error('capture-route: --phase-pin must be on|off');
  process.exit(2);
}
const phasePinOn = phasePinRaw === 'on';

const focusId = arg('focus', null);
if (focusId !== null && !/^[a-z][a-z0-9-]*(:[A-Za-z0-9._-]+)?$/.test(focusId)) {
  console.error(
    'capture-route: --focus must be a subject id like board:pulse, ace:<player id>, desk-pc or plaque:left',
  );
  process.exit(2);
}
/** Filename-safe focus suffix: `board:pulse` -> `-focus-board-pulse`. */
const hoverSubject = arg('hover', null);
if (hoverSubject !== null && !/^[a-z][a-z0-9-]*(:[A-Za-z0-9._-]+)?$/.test(hoverSubject)) {
  console.error('capture-route: --hover must be a subject id like board:pulse, team:<player id> or ledger:teams');
  process.exit(2);
}
// Wave 2 round 2: --touch on emulates a touch phone (hasTouch + isMobile), so
// `(hover: none) and (pointer: coarse)` matches and the 2C first-settle
// breathe can run. --burst <station> records the arrival at that station at
// a real fixed cadence (see runArrivalBurst).
const touchRaw = arg('touch', 'off');
if (!['on', 'off'].includes(touchRaw)) {
  console.error('capture-route: --touch must be on|off');
  process.exit(2);
}
const touchOn = touchRaw === 'on';
if (hoverSubject && touchOn) {
  console.error('capture-route: --hover needs a mouse pointer; drop --touch on');
  process.exit(2);
}
if (hoverSubject && focusId) {
  console.error('capture-route: --hover and --focus are separate arms (a focused subject shows no hover brackets)');
  process.exit(2);
}
const burstTarget = arg('burst', null);
if (burstTarget !== null && !SECTIONS.includes(burstTarget)) {
  console.error(`capture-route: --burst must be one of ${SECTIONS.join(', ')}`);
  process.exit(2);
}
const burstMsRaw = arg('burst-ms', '4000');
if (!/^\d+$/.test(burstMsRaw) || Number(burstMsRaw) < 1000 || Number(burstMsRaw) > 15000) {
  console.error('capture-route: --burst-ms must be an integer 1000..15000');
  process.exit(2);
}
const burstMs = Number(burstMsRaw);
// Wave 2 r3 (TEAMS judge: >= 8 samples inside the 1580 ms roll call): the
// in-page sampler's interval; default 200 ms, 100 ms for a teams arrival.
const burstIntervalRaw = arg('burst-interval', null);
if (burstIntervalRaw !== null && (!/^\d+$/.test(burstIntervalRaw) || Number(burstIntervalRaw) < 50 || Number(burstIntervalRaw) > 1000)) {
  console.error('capture-route: --burst-interval must be an integer 50..1000 (ms)');
  process.exit(2);
}
const burstIntervalFor = (target) => (burstIntervalRaw !== null ? Number(burstIntervalRaw) : target === 'teams' ? 100 : 200);
/** Wave 2 r3: the teams micro-scroll (px) and how long each leg is held / the tail after it. */
const MICRO_SCROLL_PX = 40;
const MICRO_SCROLL_HOLD_MS = 700;
const MICRO_SCROLL_TAIL_MS = 800;
const focusSuffix = focusId
  ? `-focus-${focusId.replace(/[^A-Za-z0-9._-]/g, '-')}`
  : hoverSubject
    ? `-hover-${hoverSubject.replace(/[^A-Za-z0-9._-]/g, '-')}`
    : '';

const tier = arg('tier', 'auto');
if (!['auto', 'route', 'lite'].includes(tier)) {
  console.error('capture-route: --tier must be auto|route|lite');
  process.exit(2);
}
if (focusId && tier === 'lite') {
  console.error('capture-route: --focus needs the Route tier; --tier lite has no canvas to focus in');
  process.exit(2);
}

const qualityRaw = arg('quality', 'auto');
if (qualityRaw !== 'auto' && !/^[0-4]$/.test(qualityRaw)) {
  console.error('capture-route: --quality must be auto or a ladder rung 0..4');
  process.exit(2);
}

// LOOK-PLAN §2 SEAT H: the post-reveal quiet probe and the prod-server
// assertion. Value-less flags use the --residency-auto idiom (skipped by the
// positional collector, never VALUE_FLAGS); --quiet-inject takes a value.
const quietProbeOn = process.argv.includes('--quiet-probe');
const quietGovernorOn = process.argv.includes('--quiet-governor');
const quietThemeOn = process.argv.includes('--quiet-theme');
const prodAttachOn = process.argv.includes('--prod-attach');
// R40: value-less, the same idiom: never kill or boot a server; fail when :port is unresponsive.
const noBootOn = process.argv.includes('--no-boot');
// DATA-PLAN fix 1: value-less, the same idiom. Without it a load that fetched
// world assets from the Supabase bucket fails the run (bucket guard).
const allowBucketOn = process.argv.includes('--allow-bucket');
// CHROME (D32 / D33): value-less, the same idiom.
const veilFilmOn = process.argv.includes('--veil-film');
const navRevealProbeOn = process.argv.includes('--nav-reveal-probe');
const quietInjectRaw = arg('quiet-inject', null);
if (quietInjectRaw !== null && !['fetch', 'program'].includes(quietInjectRaw)) {
  console.error('capture-route: --quiet-inject must be fetch|program (self-test shim)');
  process.exit(2);
}
const quietInject = quietInjectRaw;
// POKEMON-CORE (D35) A1 / R2-R3: --quiet-busy <ms> adds a judged `busy` leg
// after the idle leg: wait for the conductor's latched settle
// (__routeWorldCamera().settled), then hold still <ms> at the landed station;
// the leg's warmStats window starts AT the settle, so busyP50 / busyP95 are the
// post-settle main-thread cost (the idle leg itself closes ~0.3 s after live).
const quietBusyRaw = arg('quiet-busy', null);
if (quietBusyRaw !== null && parseQuietBusy(quietBusyRaw).error) {
  console.error(`capture-route: ${parseQuietBusy(quietBusyRaw).error}`);
  process.exit(2);
}
const quietBusyMs = quietBusyRaw === null ? 0 : Number(quietBusyRaw);
// POKEMON-CORE A1 / R5 (ii): --rung-step <s>:<rung> steps the quality ladder
// live (window.__routeWorldQualityForce, descend-only) <s> seconds into each
// station's --frames trace, which starts once the station has settled (its
// still is taken first). Composes with --occlusion on --frames (the K8 film).
const rungStepRaw = arg('rung-step', null);
let rungStep = null;
if (rungStepRaw !== null) {
  const m = /^(\d+(?:\.\d+)?):([0-4])$/.exec(rungStepRaw);
  if (!m) {
    console.error('capture-route: --rung-step must be <seconds>:<rung 0..4> (e.g. 12:3)');
    process.exit(2);
  }
  rungStep = { atS: Number(m[1]), rung: Number(m[2]) };
}
if (quietBusyMs > 0 && !quietProbeOn) {
  console.error('capture-route: --quiet-busy is a leg of --quiet-probe; add --quiet-probe');
  process.exit(2);
}
if (!quietProbeOn && (quietGovernorOn || quietThemeOn || quietInject !== null || quietStartTheme !== null)) {
  console.error('capture-route: --quiet-governor / --quiet-theme / --quiet-inject / --quiet-start-theme are legs of --quiet-probe; add --quiet-probe');
  process.exit(2);
}
if (veilFilmOn && !quietThemeOn) {
  console.error('capture-route: --veil-film films the --quiet-theme leg; add --quiet-probe --quiet-theme');
  process.exit(2);
}
if (navRevealProbeOn && quietProbeOn) {
  console.error('capture-route: --nav-reveal-probe is its own run; drop --quiet-probe');
  process.exit(2);
}
// LOOK r2 SEAT H: --diff-against <tag> (per-still pixel diff against the
// same pose of another tag, recorded in the sidecar) and --dolly-stills (the
// sweep film's full-resolution frames at the quarter points of every crossing).
const diffAgainstTag = arg('diff-against', null);
// LOOK r3: a comma list of candidate baselines (the first pose-matched one
// wins, e.g. <before>-retry,<before>), and --diff-floor <tag>[,...]: a
// second BEFORE set at the same poses (before vs before = the noise floor).
const diffAgainstTags = parseDiffTags(diffAgainstTag);
const diffFloorRaw = arg('diff-floor', null);
const diffFloorTags = parseDiffTags(diffFloorRaw);
const DIFF_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
if (diffFloorRaw !== null && (diffAgainstTag === null || diffFloorTags.length === 0 || diffFloorTags.some((t) => !DIFF_TAG_RE.test(t) || t === tag))) {
  console.error('capture-route: --diff-floor <tag>[,<tag>...] needs --diff-against and names other evidence tags ([A-Za-z0-9._-], not this run --tag)');
  process.exit(2);
}
if (diffAgainstTag !== null && (diffAgainstTags.length === 0 || diffAgainstTags.some((t) => !DIFF_TAG_RE.test(t) || t === tag))) {
  console.error('capture-route: --diff-against <tag> must be another evidence tag ([A-Za-z0-9._-], not this run --tag)');
  process.exit(2);
}
const dollyStillsOn = process.argv.includes('--dolly-stills');
// LOOK r3 (CAR judge: "every trace is preceded by a warm-up in the same
// browser"): --cold-shaders = no warm-up navigation in this browser and the
// GPU shader / program caches disabled at launch, so reveal times are cold.
const coldShadersOn = process.argv.includes('--cold-shaders');
const COLD_SHADER_ARGS = ['--disable-gpu-shader-disk-cache', '--disable-gpu-program-cache'];
if (coldShadersOn && arg('warmup', null) === 'on') {
  console.error('capture-route: --cold-shaders measures a cold GPU program cache; it cannot run with --warmup on');
  process.exit(2);
}
// LOOK r2 SEAT H: the pointer pin rides with the phase pin (never with --hover,
// which moves the pointer on purpose).
const pointerPinOn = phasePinOn && !hoverSubject;
if (quietGovernorOn && qualityRaw !== 'auto') {
  console.error('capture-route: --quiet-governor walks the live ladder; it needs routeQuality unpinned (drop --quality)');
  process.exit(2);
}

// C-039 rung pin: with --quality auto the frame-time governor can flip ladder
// knobs mid-run and between runs under load. The pin holds PHASE_PIN_RUNG so
// every capture of a run renders the same rung; an explicit --quality still
// wins (it disables the governor on its own). SEAT H: --quiet-governor leaves
// the ladder unpinned (the governor leg walks it live).
const phasePinRung = phasePinOn && qualityRaw === 'auto' && !quietGovernorOn ? String(PHASE_PIN_RUNG) : null;

// Boards rotate stadium pages every few seconds; evidence pins one page so a
// still never depends on when the frame was taken (default: the identity page).
const boardPage = arg('board-page', '0');
if (!/^\d$/.test(boardPage)) {
  console.error('capture-route: --board-page must be a single digit page index');
  process.exit(2);
}

// Ambient figures walk, so two stills never match pixel-for-pixel; pin the
// head-count (0 empties the plaza) when a comparison needs a quiet frame.
const ambient = arg('ambient', 'auto');
if (ambient !== 'auto' && !/^\d$/.test(ambient)) {
  console.error('capture-route: --ambient must be auto or a single digit head-count');
  process.exit(2);
}

// C-093: additive --world — appends world=<id> to the page params so the
// route-preview dispatches the named route world (plaza default unchanged).
const worldId = arg('world', null);
if (worldId !== null && !/^[a-z][a-z0-9-]*$/.test(worldId)) {
  console.error('capture-route: --world must be a route-world id like sakura');
  process.exit(2);
}

// C-098: additive --fixture — appends fixture=<variant> to the page params so
// the dispatched world loads that fixture variant (the --world pattern; e.g.
// ?world=sakura&fixture=open renders the non-EPB sakura preview roster).
const fixtureVariant = arg('fixture', null);
if (fixtureVariant !== null && !/^[a-z][a-z0-9-]*$/.test(fixtureVariant)) {
  console.error('capture-route: --fixture must be a fixture variant id like open');
  process.exit(2);
}

const portRaw = arg('port', String(DEFAULT_PORT));
const port = Number(portRaw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`capture-route: --port must be an integer 1..65535 (got "${portRaw}")`);
  process.exit(2);
}
if (port === 3000) {
  console.error(`capture-route: --port 3000 is refused — the harness never touches port 3000 (use e.g. ${DEFAULT_PORT})`);
  process.exit(2);
}

// C-046 --blob-count offline mode: frame files are POSITIONAL args. Every
// known value-taking flag (and its value) is skipped so paths can sit
// anywhere after their flag; unknown --flags would be misread as paths and
// fail the existence check below with the offending token named.
const VALUE_FLAGS = new Set([
  '--tag',
  '--sections',
  '--viewports',
  '--theme',
  // i18n D11 (T20): the viewer language cookie.
  '--locale',
  '--focus',
  '--tier',
  '--quality',
  '--phase-pin',
  '--board-page',
  '--ambient',
  '--world',
  '--fixture',
  '--blob-count',
  '--blob-band-top',
  '--blob-report',
  '--patch-material',
  '--project-instances',
  '--hide-mesh',
  '--present-flake-inject',
  '--kit-settle',
  '--residency-wait',
  '--led-pin',
  '--crest-pin',
  '--residency-flake-inject',
  '--debug',
  '--port',
  // Gauntlet round 1: repeatable page-URL passthrough.
  '--param',
  // Wave 2 round 2: discoverability + arrival arms.
  '--hover',
  '--touch',
  '--burst',
  '--burst-ms',
  '--burst-interval',
  // LOOK-PLAN SEAT H: the quiet probe's self-test shim.
  '--quiet-inject',
  // Rollout harness: the quiet legs' start palette.
  '--quiet-start-theme',
  // POKEMON-CORE A1: the post-settle busy leg's hold and the trace's live rung step.
  '--quiet-busy',
  '--rung-step',
  '--dom-backdrop',
  // LOOK r2 SEAT H: the blast-radius pixel diff.
  '--diff-against',
  '--diff-floor',
  // S9 evidence arms (value-taking only; the bare ones are skipped below).
  ...EVIDENCE_VALUE_FLAGS,
  // LOOK r6 SEAT H: --dolly-at <s,...>, --net-throttle <mbps>,<rttMs>.
  ...R6_VALUE_FLAGS,
]);
const positionalArgs = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token === '--help') continue;
  // C-098: the value-less --residency-auto must ALSO be skipped here (the
  // --help pattern's other half) — the positional collector below treats any
  // non-VALUE_FLAGS token as a frame path, so without this continue every
  // plain run with the flag exits 2 ("positional frame paths are only valid
  // together with --blob-count"). NOT a VALUE_FLAGS entry: that would make
  // the skipper swallow the flag's following token instead.
  if (token === '--residency-auto') continue;
  // S9: value-less --loader-trace / --reduced-motion, the same idiom.
  if (EVIDENCE_BARE_FLAGS.includes(token)) continue;
  // LOOK-PLAN SEAT H: value-less quiet-probe / prod-attach flags, the same idiom.
  if (['--quiet-probe', '--quiet-governor', '--quiet-theme', '--prod-attach', '--no-boot', '--dolly-stills', '--cold-shaders', '--veil-film', '--nav-reveal-probe', '--allow-bucket'].includes(token)) continue;
  // LOOK r6 SEAT H: value-less round-6 arms, the same idiom.
  if (R6_BARE_FLAGS.includes(token)) continue;
  if (VALUE_FLAGS.has(token)) {
    i += 1; // skip the flag's value
    continue;
  }
  positionalArgs.push(token);
}

const blobCountRef = arg('blob-count', null);
const blobBandTopRaw = arg('blob-band-top', null);
if (blobBandTopRaw !== null && (!/^\d+$/.test(blobBandTopRaw) || Number(blobBandTopRaw) < 1)) {
  console.error('capture-route: --blob-band-top must be a positive integer pixel row (the HUD top, e.g. 844)');
  process.exit(2);
}
const blobBandTop = blobBandTopRaw !== null ? Number(blobBandTopRaw) : null;
if (blobCountRef === null && positionalArgs.length > 0) {
  console.error('capture-route: positional frame paths are only valid together with --blob-count <ref.png>');
  process.exit(2);
}
if (blobCountRef !== null && positionalArgs.length === 0) {
  console.error('capture-route: --blob-count needs at least one positional frame path to count');
  process.exit(2);
}
if (blobCountRef !== null) {
  for (const framePath of [blobCountRef, ...positionalArgs]) {
    try {
      await stat(resolve(framePath));
    } catch {
      console.error(`capture-route: --blob-count input not found: ${framePath}`);
      process.exit(2);
    }
  }
}

const presentFlakeInjectRaw = arg('present-flake-inject', '0');
if (!/^[0-3]$/.test(presentFlakeInjectRaw)) {
  console.error('capture-route: --present-flake-inject must be 0..3 (self-test shim; 0 = off)');
  process.exit(2);
}
const presentFlakeInject = Number(presentFlakeInjectRaw);

// C-057 present-readiness waits: kit-settle (facade freshness) and asset
// residency (walker GLBs landed before the present) default ON — a still that
// straddles kit load or presents walkerless is not evidence. The off switches
// restore the pre-C-057 behavior for round-trip comparisons.
function parseOnOff(name, fallback) {
  const raw = arg(name, fallback);
  if (!['on', 'off'].includes(raw)) {
    console.error(`capture-route: --${name} must be on|off`);
    process.exit(2);
  }
  return raw;
}
const kitSettleRaw = parseOnOff('kit-settle', 'on');
const residencyWaitRaw = parseOnOff('residency-wait', 'on');
const ledPinRaw = parseOnOff('led-pin', 'off');
const kitSettleOn = kitSettleRaw === 'on';
const residencyWaitOn = residencyWaitRaw === 'on';
const ledPinOn = ledPinRaw === 'on';
// POKEMON-CORE A1.6: see --dom-backdrop in the usage text.
const domBackdropMode = arg('dom-backdrop', 'fbo');
if (!['fbo', 'live'].includes(domBackdropMode)) {
  console.error('capture-route: --dom-backdrop must be fbo|live');
  process.exit(2);
}
// LOOK r3 (LOOK judge: "the teams LED shows Platz 8 before and Platz 4
// after"): the plaza crest LED rotates its slides on a setInterval of
// CREST_HOLD_S seconds from mount, so which slide a still shows depends on
// load time. --crest-pin (default: on with the phase pin) blocks interval
// registrations of exactly that delay, so the LED holds its first slide in
// every load. The delay is read from the source (LedScreen.tsx) at start-up;
// when it cannot be read the pin is inert and says so.
// The default is OFF for the D23 measurement arms (--quiet-probe,
// --loader-trace, --loader-film): a slide cut repaints the LED canvas, i.e.
// a real post-reveal texture upload, which the pin would hide from the
// quiet counters. An explicit --crest-pin on still applies (and is recorded).
const crestPinMeasuresD23 = ['--quiet-probe', '--loader-trace', '--loader-film'].some((f) => process.argv.includes(f));
const crestPinRaw = parseOnOff('crest-pin', phasePinOn && !crestPinMeasuresD23 ? 'on' : 'off');
const CREST_HOLD_MS = (() => {
  try {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'world', 'evoliga', 'route', 'plaza', 'LedScreen.tsx'), 'utf8');
    const m = /export const CREST_HOLD_S\s*=\s*([0-9.]+)/.exec(src);
    return m ? Math.round(Number(m[1]) * 1000) : null;
  } catch {
    return null;
  }
})();
const crestPinOn = crestPinRaw === 'on' && CREST_HOLD_MS !== null && CREST_HOLD_MS > 0;

// C-098: value-less --residency-auto — the --help idiom
// (process.argv.includes) and deliberately NOT a VALUE_FLAGS entry: a
// value-less flag listed there makes the blob-count positional skipper
// swallow the flag's following token. Semantics (OBSERVE-BEFORE-GATE): the
// run's FIRST residency wait is quiet-window-only (no floor), then
// floor = observed − 2 is derived once, printed, and applied run-scoped from
// that point; default OFF keeps the fixed-floor semantics unchanged.
const residencyAutoOn = process.argv.includes('--residency-auto');
if (residencyAutoOn && !residencyWaitOn) {
  console.log(
    'capture-route: --residency-auto has no residency wait to observe (--residency-wait off) — no derivation will run',
  );
}

const residencyFlakeInjectRaw = arg('residency-flake-inject', '0');
if (!/^[0-4]$/.test(residencyFlakeInjectRaw)) {
  console.error('capture-route: --residency-flake-inject must be 0..4 (self-test shim; 0 = off)');
  process.exit(2);
}
const residencyFlakeInject = Number(residencyFlakeInjectRaw);

const blobReportPath = arg('blob-report', null);
if (blobReportPath !== null && blobCountRef === null) {
  console.error('capture-route: --blob-report is only valid together with --blob-count <ref.png>');
  process.exit(2);
}

// C-057 --patch-material <sig>=<uniform>=<value>[,...] — the sanctioned
// delta-isolation arm (PB-252). Repeatable; every occurrence is applied in
// the present task, in argv order, BEFORE the phase pin so the pin's
// canonical uTime write stays last.
const materialPatchSpecs = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] !== '--patch-material') continue;
  const spec = process.argv[i + 1];
  const eq = typeof spec === 'string' ? spec.indexOf('=') : -1;
  const sig = eq > 0 ? spec.slice(0, eq).trim() : '';
  const pairs =
    eq > 0
      ? spec
          .slice(eq + 1)
          .split(',')
          .map((pair) => {
            const m = /^([A-Za-z_][A-Za-z0-9_]*)=(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)$/.exec(pair.trim());
            return m ? { uniform: m[1], value: Number(m[2]) } : null;
          })
      : [];
  if (!sig || pairs.length === 0 || pairs.some((p) => p === null)) {
    console.error(
      `capture-route: --patch-material must be <sig>=<uniform>=<number>[,<uniform>=<number>...] (got "${spec ?? ''}")`,
    );
    process.exit(2);
  }
  materialPatchSpecs.push({ sig, pairs });
}

// C-109 r1 attribution probes (the card's root-cause deliverable), the
// --patch-material pattern: debug-gated scene handle, same-load arms, honest
// failure when a name matches nothing.
//  - --project-instances <name[,name...]|*> — after the pose settles (and
//    before the present), read-only scan of the NAMED InstancedMeshes (or
//    every InstancedMesh with *): each instance's world transform is
//    projected through the LIVE landed camera into frame pixels; per mesh it
//    reports instance count, in-frame count, and foreground-band count (the
//    frame's bottom third — the judged band) plus up to 8 in-band sample
//    rows. A self-check projects a point 10 m down the camera's forward
//    axis, which must land at the frame center (dead-center = the basis is
//    the live camera's, not a reconstruction).
//  - --hide-mesh <name> (repeatable) — toggle arm: every object whose
//    .name matches exactly is hidden (visible=false) inside the present
//    task, BEFORE the phase pin, and restored in the same task after the
//    frame is read (the scene-handle contract: arms restore every write).
//    A name matching nothing fails the run honestly.
const projectInstancesRaw = arg('project-instances', null);
const projectAll = projectInstancesRaw === '*';
const projectMeshNames =
  projectInstancesRaw !== null && !projectAll
    ? projectInstancesRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
if (projectInstancesRaw !== null && !projectAll && projectMeshNames.length === 0) {
  console.error('capture-route: --project-instances must be a comma-separated mesh-name list or "*" (got empty)');
  process.exit(2);
}
const hideMeshNames = [];
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] !== '--hide-mesh') continue;
  const name = process.argv[i + 1];
  if (!name) {
    console.error('capture-route: --hide-mesh requires an object .name value');
    process.exit(2);
  }
  hideMeshNames.push(name);
}
// S9 evidence arms: parsed by the extracted helper, usage errors exit 2 like
// every other flag. The occlusion / figures / camera bridges are debug-gated
// (EvidenceBridges.tsx), so --frames / --occlusion / --sweep imply --debug on.
const { flags: evidenceArms, errors: evidenceErrors } = parseEvidenceFlags(process.argv.slice(2));
for (const message of evidenceErrors) console.error(`capture-route: ${message}`);
// R43(j): Windows display scaling (150 % on the desktop) leaks into a pinned
// deviceScaleFactor as float32 noise (--dpr 1 gave devicePixelRatio
// 1.0000000298), and src branches on devicePixelRatio > 1 (theme-veil-store).
// With --dpr pinned, the browser's own scale is pinned to 1 so the context's
// deviceScaleFactor is exact; runs without --dpr keep the OS scale.
const PINNED_SCALE_ARGS = evidenceArms.dpr !== undefined ? ['--force-device-scale-factor=1'] : [];
// R48: pin the page's UTC calendar day. The plaza ambient cast is seeded by dailySeed(league.id) =
// hash(seasonId | new Date() UTC day) (src/lib/route-world/ambient.ts), so stills shot on different UTC
// days show different walkers. --utc-day YYYY-MM-DD (or env CAPTURE_UTC_DAY) shifts the page's Date by
// whole days at load (time of day, Date progression, performance.now and rAF untouched).
const UTC_DAY = (() => {
  const v = arg('utc-day', null) ?? process.env.CAPTURE_UTC_DAY ?? null;
  if (v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    console.error(`capture-route: --utc-day / CAPTURE_UTC_DAY must be YYYY-MM-DD, got "${v}"`);
    process.exit(2);
  }
  return v;
})();
// i18n D11 (T20): --locale en|de pins the viewer language through the same
// `plc_locale` cookie the language picker writes (src/i18n/config.ts), so the
// painted boards, plaques and loader lines are captured in that language.
// Absent: no cookie, the site default (English). Installed on every context
// right beside the UTC-day pin.
const CAPTURE_LOCALE = (() => {
  const v = arg('locale', null);
  if (v === null) return null;
  if (v !== 'en' && v !== 'de') {
    console.error(`capture-route: --locale must be en|de, got "${v}"`);
    process.exit(2);
  }
  return v;
})();
async function installCaptureLocale(ctx) {
  if (!CAPTURE_LOCALE) return;
  await ctx.addCookies([{ name: 'plc_locale', value: CAPTURE_LOCALE, url: new URL(pageUrl).origin, sameSite: 'Lax' }]);
}
async function installUtcDay(ctx) {
  await installCaptureLocale(ctx);
  if (!UTC_DAY) return;
  await ctx.addInitScript((day) => {
    const RealDate = Date;
    const today = new RealDate(RealDate.now()).toISOString().slice(0, 10);
    const offset = RealDate.parse(`${day}T00:00:00Z`) - RealDate.parse(`${today}T00:00:00Z`);
    if (!offset) return;
    function ShiftedDate(...args) {
      if (!new.target) return new RealDate(RealDate.now() + offset).toString();
      return args.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...args);
    }
    ShiftedDate.prototype = RealDate.prototype;
    ShiftedDate.now = () => RealDate.now() + offset;
    ShiftedDate.parse = RealDate.parse;
    ShiftedDate.UTC = RealDate.UTC;
    globalThis.Date = ShiftedDate;
  }, UTC_DAY);
}
if (evidenceErrors.length > 0) process.exit(2);
// LOOK r6 SEAT H (D28): --gpu-trace, --program-keys, --warm-cache,
// --contrast-repeat, --look-probe, --dolly-at, --net-throttle.
const { flags: r6Flags, errors: r6Errors } = parseR6Flags(process.argv.slice(2), {
  loaderTrace: evidenceArms.loaderTrace,
  sweepFilm: evidenceArms.sweepFilm === true,
  luma: evidenceArms.luma === true,
});
for (const message of r6Errors) console.error(`capture-route: ${message}`);
if (r6Errors.length > 0) process.exit(2);
// Round 3 --pin-utime <s>: the phase pin's canonical clock (W3: the default 0
// always catches the same ambient ripple at the same age).
const PIN_U_TIME = evidenceArms.pinUTime ?? PHASE_PIN_U_TIME;
const PIN_ELAPSED = evidenceArms.pinUTime ?? PHASE_PIN_ELAPSED;
if (evidenceArms.pinUTime !== undefined && !phasePinOn) {
  console.error('capture-route: --pin-utime moves the phase pin; it needs --phase-pin on');
  process.exit(2);
}
if ((evidenceArms.frames > 0 || evidenceArms.occlusion || evidenceArms.sweep) && tier === 'lite') {
  console.error('capture-route: --frames / --occlusion / --sweep need the Route tier; --tier lite has no canvas');
  process.exit(2);
}
if ((evidenceArms.luma || evidenceArms.audit) && tier === 'lite') {
  console.error('capture-route: --luma / --audit judge the route world; --tier lite has no canvas');
  process.exit(2);
}
if ((evidenceArms.luma || evidenceArms.audit) && evidenceArms.flipProbe !== null) {
  console.error('capture-route: --luma / --audit judge station stills; --flip-probe writes none');
  process.exit(2);
}
if (evidenceArms.flipProbe !== null && tier !== 'auto') {
  console.error('capture-route: --flip-probe needs --tier auto (it observes the natural Lite -> route flip)');
  process.exit(2);
}
if (evidenceArms.sweep && focusId) {
  console.error('capture-route: --sweep records the station-to-station gesture; it cannot be combined with --focus');
  process.exit(2);
}
// LOOK r2 (CAR judge): --tier route is allowed too — a forced route load
// must fall to Lite on a fault exactly like an auto one.
if (evidenceArms.failInject !== undefined && tier === 'lite') {
  console.error('capture-route: --fail-inject needs --tier auto or route (it judges the fall to Lite)');
  process.exit(2);
}
if (evidenceArms.relaxDeadlineMs !== undefined && debug !== 'on') {
  console.log('capture-route: --relax-deadline implies --debug on (readyDeadlineMs is honoured only with routeDebug=1)');
}
// LOOK-PLAN SEAT H: --quiet-probe (implies --debug on) is its own run; its
// sweep / jump legs reuse the --sweep machinery, so only --chip-jump (the
// jump legs) combines with it. --prod-attach never pairs with a relaxed deadline.
if (quietProbeOn) {
  // LOOK r2 (CAR judge): --relax-deadline is ALLOWED with the quiet probe so
  // the post-reveal counters can be read on dev while the deadline is missed;
  // such a run is marked deadlineRelaxed (indicative, never the D23 verdict),
  // and --prod-attach still refuses it.
  const conflicts = [
    tier === 'lite' ? '--tier lite' : null,
    focusId ? '--focus' : null,
    hoverSubject ? '--hover' : null,
    burstTarget ? '--burst' : null,
    evidenceArms.frames > 0 ? '--frames' : null,
    evidenceArms.occlusion ? '--occlusion' : null,
    evidenceArms.luma || evidenceArms.audit ? '--luma / --audit' : null,
    evidenceArms.sweep !== null && evidenceArms.sweep !== 'jump' ? `--sweep ${evidenceArms.sweep}` : null,
    evidenceArms.sweepFilm ? '--sweep-film' : null,
    evidenceArms.loaderTrace || evidenceArms.loaderFilm ? '--loader-trace / --loader-film' : null,
    evidenceArms.flipProbe !== null ? '--flip-probe' : null,
    evidenceArms.failInject !== undefined ? '--fail-inject' : null,
    materialPatchSpecs.length > 0 || projectInstancesRaw !== null || hideMeshNames.length > 0 ? '--patch-material / --project-instances / --hide-mesh' : null,
  ].filter(Boolean);
  if (conflicts.length > 0) {
    console.error(`capture-route: --quiet-probe is its own run (post-reveal quiet legs); drop ${conflicts.join(', ')}`);
    process.exit(2);
  }
  if (debug !== 'on') console.log('capture-route: --quiet-probe implies --debug on (the scene handle, GL debug and readiness bridges are debug-gated)');
}
if (dollyStillsOn && !evidenceArms.sweepFilm) {
  console.error('capture-route: --dolly-stills takes its frames from the sweep film; add --sweep-film (with --sweep <mode> or --chip-jump)');
  process.exit(2);
}
if (prodAttachOn && evidenceArms.relaxDeadlineMs !== undefined) {
  console.error('capture-route: --prod-attach refuses --relax-deadline (production builds ignore it, and deadline evidence is never relaxed)');
  process.exit(2);
}
// The pre-round-1 still arms keep their exact notice; the loader arms get
// their own (round 1: --loader-trace / --loader-film imply --debug on, since
// __routeWorldReadiness is debug-gated).
const stillArmsNeedDebug =
  evidenceArms.frames > 0 || evidenceArms.occlusion || evidenceArms.sweep !== null || evidenceArms.luma === true || evidenceArms.audit === true;
if (stillArmsNeedDebug && debug !== 'on') {
  console.log(
    evidenceArms.luma || evidenceArms.audit
      ? 'capture-route: --frames / --occlusion / --sweep / --luma / --audit imply --debug on (the evidence bridges, scene audit and TelemetrySampler are debug-gated)'
      : 'capture-route: --frames / --occlusion / --sweep imply --debug on (the evidence bridges are debug-gated)',
  );
}
// Round 3 (W7 judge): a reduced-motion loader trace on --tier auto is the
// Lite-floor run, and ?routeDebug=1 would force the route tier
// (WorldStateProvider readUrlTierOverride) — so it loads WITHOUT the debug
// param, and anything that needs the debug bridges is refused.
const liteFloorRun = isLiteFloorRun(evidenceArms, tier);
if (liteFloorRun) {
  const conflicts = [
    debug === 'on' ? '--debug on' : null,
    stillArmsNeedDebug ? '--frames / --occlusion / --sweep / --luma / --audit' : null,
    materialPatchSpecs.length > 0 ? '--patch-material' : null,
    projectInstancesRaw !== null ? '--project-instances' : null,
    hideMeshNames.length > 0 ? '--hide-mesh' : null,
  ].filter(Boolean);
  if (conflicts.length > 0) {
    console.error(
      `capture-route: a reduced-motion --loader-trace on --tier auto is the Lite-floor run and must load without ?routeDebug=1 (it forces the route tier); drop ${conflicts.join(', ')}`,
    );
    process.exit(2);
  }
  console.log(
    'capture-route: Lite-floor run — no ?routeDebug=1 (it would force the route tier); the verdict reads DOM only (world-route-live, canvas opacity, ball visibility); scenePhase is unavailable by design',
  );
} else if ((evidenceArms.loaderTrace || evidenceArms.loaderFilm) && debug !== 'on') {
  console.log(
    'capture-route: --loader-trace / --loader-film imply --debug on (__routeWorldReadiness — scene phase, deadline anchor, Lite-block check — is debug-gated)',
  );
}
if (evidenceArms.handoffCompositeImplied) {
  console.log('capture-route: --loader-trace records the composited handoff by default (--handoff-composite implied; --no-handoff-composite opts out)');
}
// Gauntlet round 1: repeatable --param k=v page-URL passthrough.
const { params: extraPageParams, errors: paramErrors } = parseParamFlags(process.argv.slice(2));
for (const message of paramErrors) console.error(`capture-route: ${message}`);
if (paramErrors.length > 0) process.exit(2);
if (evidenceArms.reducedMotion && tier !== 'route' && !stillArmsNeedDebug && debug !== 'on') {
  console.log(
    'capture-route: --reduced-motion without --tier route lands on Lite by design (D12 reduced-motion floor)',
  );
}

// The __routeWorldScene handle is debug-gated (C-052), so the arm flags turn
// the debug param on themselves.
const debugOn =
  debug === 'on' ||
  quietProbeOn ||
  // CHROME (D33): the reveal gate reads the debug-gated readiness bridge.
  navRevealProbeOn ||
  materialPatchSpecs.length > 0 ||
  projectInstancesRaw !== null ||
  hideMeshNames.length > 0 ||
  // LOOK r6 SEAT H: the look probe needs the live camera pose, the program
  // dump the scene handle (both debug-gated).
  r6Flags.lookProbe ||
  r6Flags.programKeys ||
  evidenceNeedsDebug(evidenceArms, { tier });
if (materialPatchSpecs.length > 0 && debug !== 'on') {
  console.log('capture-route: --patch-material implies --debug on (the __routeWorldScene handle is debug-gated)');
}
if (projectInstancesRaw !== null && debug !== 'on') {
  console.log('capture-route: --project-instances implies --debug on (the __routeWorldScene handle is debug-gated)');
}
if (hideMeshNames.length > 0 && debug !== 'on') {
  console.log('capture-route: --hide-mesh implies --debug on (the __routeWorldScene handle is debug-gated)');
}
// The residency frameSubscribers gate needs the debug-gated phase hook AND a
// requested walker population (--ambient 0 legitimately paints none).
const residencyFsGate = residencyWaitOn && ambient !== '0' && debugOn && phasePinOn;
// R41: beat-observation runs (--frames or --quiet-probe with the probe actors or a beatForce)
// record the force clock's zero; timing-only runs never arm the watch.
const forceClockWatchOn = forceClockWatchWanted({
  debugOn,
  tierLite: tier === 'lite',
  frames: evidenceArms.frames,
  quietProbe: quietProbeOn,
  paramKeys: extraPageParams.map((p) => p.key),
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'gauntlet', 'evidence');

// NOTE: localhost, not 127.0.0.1 — Next 16 dev blocks _next/* resources for
// hosts outside allowedDevOrigins (default: localhost only), which would 403
// every client chunk and leave the world unhydrated.
// Round 2 --page-path: the real evoliga league plaza (/leagues/<id>) instead
// of the /route-preview fixture page (round 1 judged "plaza" from the preview).
const previewUrl = `http://localhost:${port}${evidenceArms.pagePath ?? '/route-preview'}`;
const pageParams = new URLSearchParams();
if (debugOn) pageParams.set('routeDebug', '1');
if (tier !== 'auto') pageParams.set('tier', tier);
// Headless GPUs trip the frame-time governor; a pinned rung keeps stills
// comparable across runs (evidence is judged at rung 0 unless a card says
// otherwise). C-039: the phase pin forces that rung even at --quality auto.
if (qualityRaw !== 'auto') pageParams.set('routeQuality', qualityRaw);
else if (phasePinRung !== null) pageParams.set('routeQuality', phasePinRung);
pageParams.set('boardPage', boardPage);
if (ambient !== 'auto') pageParams.set('ambient', ambient);
// C-093: additive world dispatch param (the --tier pattern).
if (worldId !== null) pageParams.set('world', worldId);
// C-098: additive fixture variant param (the --world pattern).
if (fixtureVariant !== null) pageParams.set('fixture', fixtureVariant);
// Round 2 --relax-deadline: the DEBUG-ONLY readiness-deadline relaxation
// (world-readiness.ts; honoured only with routeDebug=1, which the flag
// implies, and never in a production build). Refused for W7 runs at parse.
if (evidenceArms.relaxDeadlineMs !== undefined) pageParams.set('readyDeadlineMs', String(evidenceArms.relaxDeadlineMs));
// LOOK r2: --fail-inject stall:<ms> = the product's debug-only stall hook.
if (isStallKind(evidenceArms.failInject)) pageParams.set('stallInjectMs', String(stallInjectMs(evidenceArms.failInject)));
// Gauntlet round 1: --param passthrough, appended after every harness-owned
// key (reserved keys are refused at parse time), in argv order.
for (const { key, value } of extraPageParams) pageParams.set(key, value);
const pageQuery = pageParams.toString();
const pageUrl = pageQuery ? `${previewUrl}?${pageQuery}` : previewUrl;

// C-039 r2: invocation record stamped into every sidecar — the argv as typed,
// the resolved CLI args (post-parse effective values), and the page URL the
// harness actually navigated. Makes the effective invocation provable from the
// sidecar alone (e.g. whether the phase pin injected routeQuality, or that
// --phase-pin off left the URL in its pre-C-039 shape) without diffing source.
const invocation = {
  argv: process.argv.slice(2),
  args: {
    tag,
    sections,
    viewports: viewportKeys,
    theme,
    focus: focusId,
    tier,
    quality: qualityRaw,
    phasePin: phasePinRaw,
    boardPage,
    ambient,
    // C-093 (additive): the route world the preview dispatched to.
    world: worldId,
    // C-098 (additive): the fixture variant the dispatched world loads.
    fixture: fixtureVariant,
    // C-057: records the EFFECTIVE debug state — --patch-material implies on.
    debug: debugOn ? 'on' : 'off',
    port,
    // C-046 (additive): offline blob-count + retry-shim resolved args.
    blobCount: blobCountRef,
    blobBandTop,
    presentFlakeInject,
    // C-057 (additive): present-readiness waits, LED pin, arms, report path.
    kitSettle: kitSettleRaw,
    residencyWait: residencyWaitRaw,
    // C-098 (additive): opt-in residency auto-calibration.
    residencyAuto: residencyAutoOn,
    residencyFlakeInject,
    ledPin: ledPinRaw,
    // LOOK r3 (additive): the crest LED slide pin and the delay it froze.
    crestPin: crestPinOn ? { mode: 'on', delayMs: CREST_HOLD_MS } : { mode: crestPinRaw === 'on' ? 'inert' : 'off' },
    blobReport: blobReportPath,
    materialPatch: materialPatchSpecs.map(
      ({ sig, pairs }) => `${sig}=${pairs.map((p) => `${p.uniform}=${p.value}`).join(',')}`,
    ),
    // C-109 r1 (additive): the attribution probes' effective args.
    projectInstances: projectInstancesRaw,
    hideMesh: hideMeshNames,
    // S9 (additive, present ONLY when an evidence arm is on so runs without
    // them keep byte-identical sidecars).
    ...(anyEvidenceFlag(evidenceArms) ? { evidence: evidenceArms } : {}),
    // R43(j) (additive, present ONLY when --dpr pins the scale).
    ...(PINNED_SCALE_ARGS.length > 0 ? { browserScale: 'forced-1' } : {}),
    // R48 (additive, present ONLY when the UTC day is pinned).
    ...(UTC_DAY ? { utcDay: UTC_DAY } : {}),
    // Round 1 (additive, present ONLY with --param).
    ...(extraPageParams.length > 0 ? { params: extraPageParams.map(({ key, value }) => `${key}=${value}`) } : {}),
    // LOOK-PLAN SEAT H (additive, present ONLY when on).
    ...(quietProbeOn ? { quietProbe: { governor: quietGovernorOn, theme: quietThemeOn, startTheme: theme, inject: quietInject, ...(veilFilmOn ? { veilFilm: true } : {}), ...(quietBusyMs > 0 ? { busyMs: quietBusyMs } : {}) } } : {}),
    // CHROME (additive, present ONLY when on).
    ...(navRevealProbeOn ? { navRevealProbe: true } : {}),
    ...(prodAttachOn ? { prodAttach: true } : {}),
    // LOOK r2 SEAT H (additive, present ONLY when on).
    ...(diffAgainstTag !== null ? { diffAgainst: diffAgainstTag } : {}),
    ...(dollyStillsOn ? { dollyStills: true } : {}),
    // LOOK r3 SEAT H (additive, present ONLY when on).
    ...(coldShadersOn ? { coldShaders: { warmup: 'off', launchArgs: COLD_SHADER_ARGS } } : {}),
    // LOOK r6 SEAT H (additive, present ONLY when on).
    ...r6InvocationArgs(r6Flags),
  },
  url: pageUrl,
};

// ---------------------------------------------------------------------------
// C-046 offline blob-count mode (--blob-count) — PB-191 count-of-record
// ---------------------------------------------------------------------------
/**
 * Load a frame as raw RGB rows — the scratch detector's loader, generalized
 * to any frame size (callers enforce ref/frame dimension agreement, so one
 * viewport's never accidentally diffed against another's).
 */
async function loadFrameRaw(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Frame-vs-ref diff mask: 1 where the summed per-channel delta exceeds TH. */
function buildDiffMask(frame, ref) {
  const pixels = frame.width * frame.height;
  const channels = Math.min(frame.channels, ref.channels);
  const mask = new Uint8Array(pixels);
  let total = 0;
  for (let i = 0; i < pixels; i += 1) {
    let delta = 0;
    for (let c = 0; c < channels; c += 1) {
      delta += Math.abs(frame.data[i * frame.channels + c] - ref.data[i * ref.channels + c]);
    }
    if (delta > BLOB_TH) {
      mask[i] = 1;
      total += 1;
    }
  }
  return { mask, total };
}

/**
 * Connected components strictly above the HUD band (y < yCeiling) with the
 * PB-191 figure-shape filters and the column-gap split. Verbatim port of the
 * _c047-blobs.mjs countFigures (the r1/r2 count of record), generalized to
 * per-frame width/height and a DERIVED band ceiling — PB-205: the ceiling is
 * always an explicit argument, never a silent full-frame default.
 */
function countFigureRegions(mask, width, height, yCeiling) {
  const seen = new Uint8Array(width * height);
  const regions = [];
  for (let i = 0; i < width * height; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const seedY = (i / width) | 0;
    if (seedY >= yCeiling) {
      seen[i] = 1;
      continue;
    }
    const stack = [i];
    seen[i] = 1;
    const pixels = [];
    while (stack.length) {
      const j = stack.pop();
      pixels.push(j);
      const x = j % width;
      const y = (j / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= yCeiling) continue;
        const k = ny * width + nx;
        if (mask[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (pixels.length < BLOB_MIN_AREA) continue;
    let x0 = width;
    let x1 = 0;
    let yTop = height;
    let yBot = 0;
    const columns = new Set();
    for (const j of pixels) {
      const x = j % width;
      const y = (j / width) | 0;
      columns.add(x);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < yTop) yTop = y;
      if (y > yBot) yBot = y;
    }
    if (yBot - yTop + 1 < BLOB_MIN_H) continue;
    if (x1 - x0 + 1 > BLOB_MAX_W) continue;
    let gaps = 0;
    let run = 0;
    for (let x = x0; x <= x1; x += 1) {
      if (!columns.has(x)) {
        run += 1;
        if (run === BLOB_GAP_RUN) gaps += 1;
      } else {
        run = 0;
      }
    }
    regions.push({ area: pixels.length, split: 1 + gaps, x0, x1, yTop, yBot });
  }
  return regions;
}

const formatRegions = (regions) =>
  regions.map((r) => `${r.area}px[x${r.x0}-${r.x1},y${r.yTop}-${r.yBot}]x${r.split}`).join(' ');

/**
 * Resolve the band ceiling (the HUD top) for one frame, and read the
 * PB-232/PB-239 class tag opportunistically from the same sidecar:
 * an explicit --blob-band-top override wins, else the present-time hud.top
 * the harness stamps into every C-046 sidecar. There is deliberately NO
 * full-frame fallback — a frame with neither source fails honestly instead
 * of silently counting the HUD band (the PB-205 yMax=900 bug class).
 */
async function resolveBandCeiling(framePath, overrideTop, frameHeight) {
  const name = framePath.split(/[\\/]/).pop();
  const sidecarPath = framePath.replace(/\.png$/i, '.json');
  let sidecar = null;
  try {
    sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  } catch {
    /* handled below — an override does not need a sidecar */
  }
  const facade = sidecar?.renderPath?.facade ?? null;
  if (overrideTop !== null) {
    if (overrideTop >= frameHeight) {
      throw new Error(
        `${name}: --blob-band-top ${overrideTop} >= frame height ${frameHeight} — refusing a full-frame count (PB-205)`,
      );
    }
    return { top: overrideTop, source: 'override', hud: null, facade };
  }
  if (sidecar === null) {
    throw new Error(
      `${name}: no --blob-band-top override and no readable sidecar (${sidecarPath}) — refusing to guess the band ceiling (PB-205 yMax=900 bug class); pass --blob-band-top or re-capture so the sidecar carries the hud stamp`,
    );
  }
  const hud = sidecar.hud;
  if (!hud || !Number.isInteger(hud.top) || hud.top < 1) {
    throw new Error(
      `${name}: sidecar ${sidecarPath} has no present-time hud stamp (pre-C-046 sidecar) — pass --blob-band-top (the HUD top in frame px; 844 at 1440x900) or re-capture`,
    );
  }
  if (hud.top >= frameHeight) {
    throw new Error(`${name}: sidecar hud.top ${hud.top} >= frame height ${frameHeight} — refusing a full-frame count (PB-205)`);
  }
  return {
    top: hud.top,
    source: 'sidecar',
    hud: { left: hud.left ?? null, top: hud.top, width: hud.width ?? null, height: hud.height ?? null },
    facade,
  };
}

/**
 * Run the offline count and return the process exit code. Prints the same
 * per-frame shape as the folded scratch detector (changedPx / blobs /
 * detail / MIN) plus a per-frame band-derivation line so the y-ceiling is
 * always quotable (PB-205: derive, never assume). C-057: with --blob-report
 * the exact stdout lines are also written to the given path — a disk
 * artifact juries can cite instead of teed scratch (stdout shape unchanged).
 */
async function runBlobCountMode() {
  const reportLines = [];
  const emit = (line) => {
    console.log(line);
    reportLines.push(line);
  };
  const refName = blobCountRef.split(/[\\/]/).pop();
  emit(
    `[blob-count:${tag}] ref=${refName} TH=${BLOB_TH} MIN_AREA=${BLOB_MIN_AREA} MIN_H=${BLOB_MIN_H} MAX_W=${BLOB_MAX_W} gapRun=${BLOB_GAP_RUN} frames=${positionalArgs.length}`,
  );
  emit(
    '[blob-count] offline analysis mode — capture-only flags are ignored (--sections/--viewports/--theme/--focus/--tier/--quality/--phase-pin/--board-page/--ambient/--world/--fixture/--debug/--port/--present-flake-inject)',
  );
  const ref = await loadFrameRaw(blobCountRef);
  const refBand = await resolveBandCeiling(blobCountRef, blobBandTop, ref.height);
  emit(
    `[blob-count:${tag}] band ${refName}: yCeiling=${refBand.top} (source=${refBand.source}${refBand.hud ? ` hud=${refBand.hud.width}x${refBand.hud.height}@(${refBand.hud.left},${refBand.hud.top})` : ''}${refBand.facade ? ` facade=${refBand.facade}` : ''})`,
  );
  const counts = [];
  for (const framePath of positionalArgs) {
    const name = framePath.split(/[\\/]/).pop();
    const frame = await loadFrameRaw(framePath);
    if (frame.width !== ref.width || frame.height !== ref.height) {
      throw new Error(`${name}: ${frame.width}x${frame.height} does not match the ref ${refName} ${ref.width}x${ref.height}`);
    }
    const band = await resolveBandCeiling(framePath, blobBandTop, frame.height);
    const { mask, total } = buildDiffMask(frame, ref);
    const regions = countFigureRegions(mask, ref.width, ref.height, band.top);
    const blobs = regions.reduce((acc, r) => acc + r.split, 0);
    emit(
      `[blob-count:${tag}] band ${name}: yCeiling=${band.top} (source=${band.source}${band.hud ? ` hud=${band.hud.width}x${band.hud.height}@(${band.hud.left},${band.hud.top})` : ''}${band.facade ? ` facade=${band.facade}` : ''})`,
    );
    emit(
      `[blob-count:${tag}] ${name} changedPx=${total} (${((100 * total) / (ref.width * ref.height)).toFixed(2)}%) blobs=${blobs} :: ${formatRegions(regions)}`,
    );
    counts.push(blobs);
  }
  if (counts.length > 1) {
    emit(`[blob-count:${tag}] MIN over frames = ${Math.min(...counts)} (frames: ${counts.join('/')})`);
  }
  if (blobReportPath !== null) {
    const reportPath = resolve(blobReportPath);
    await writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');
    console.log(`[blob-count:${tag}] report -> ${reportPath} (${reportLines.length} lines)`);
  }
  return 0;
}

if (blobCountRef !== null) {
  try {
    process.exit(await runBlobCountMode());
  } catch (err) {
    console.error(`capture-route: FAIL blob-count ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Server probe / lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Probe GET url. Returns:
 *   { kind: 'ok' }                      HTTP response received (any status)
 *   { kind: 'refused' }                 nothing listening (ECONNREFUSED)
 *   { kind: 'wedged' }                  connection accepted, no response <= timeoutMs
 *   { kind: 'status', status }          non-2xx response from some other holder
 */
async function probe(url, timeoutMs) {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { kind: 'ok' };
  } catch (err) {
    const cause = err && typeof err === 'object' ? err : {};
    const code = cause.cause?.code ?? cause.code;
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return { kind: 'wedged' };
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPROTO') return { kind: 'refused' };
    throw new Error(`probe ${url} failed (${cause.name ?? 'unknown'}${code ? `:${code}` : ''}): ${cause.message ?? String(err)}`);
  }
}

/** Find PIDs bound to port via netstat -ano (Windows), or null.
 * Locale-agnostic: the state column is localized (LISTENING / ABHÖREN / ...),
 * so any TCP row whose local address ends in :<port> with a positive PID
 * counts as a holder candidate. */
async function findListenerPid(portNum) {
  const { stdout } = await execFileAsync('netstat', ['-ano']);
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('TCP'));
  const pids = new Set();
  for (const line of lines) {
    const cols = line.trim().split(/\s+/); // Proto Local Foreign State PID
    const local = cols[1] ?? '';
    if (!local.endsWith(`:${portNum}`)) continue;
    const pid = Number(cols[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  if (pids.size === 0) return null;
  if (pids.size > 1) {
    console.error(`capture-route: multiple PIDs listening on port ${portNum}: ${[...pids].join(', ')} — killing all of them`);
  }
  return [...pids];
}

/** Kill a process tree (Windows): taskkill /PID <pid> /T /F. */
async function killTree(pid) {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
    console.log(`capture-route: killed process tree ${pid}`);
  } catch (err) {
    // Distinct cause surfaced; a holder that already exited is not fatal here.
    console.error(`capture-route: taskkill /PID ${pid} failed: ${err.message?.split('\n')[0] ?? err}`);
  }
}

/**
 * Ensure a healthy dev server serves previewUrl:
 * - healthy response within WEDGE_TIMEOUT_MS  -> reuse, no child spawned
 * - connection refused                        -> boot our own child
 * - accepted but silent ~10 s (wedged orphan) -> kill holder, boot our own
 * Readiness poll after boot: up to READY_TIMEOUT_MS (cold compile included).
 * Returns the spawned child (or null when reusing an existing server).
 */
async function ensureServer() {
  let state = await probe(previewUrl, WEDGE_TIMEOUT_MS);

  if (state.kind === 'wedged') {
    console.error(`capture-route: port ${port} accepted a connection but sent no HTTP response within ${WEDGE_TIMEOUT_MS / 1000}s — treating holder as a wedged orphan`);
    const pids = await findListenerPid(port);
    if (!pids) {
      throw new Error(`port ${port} looks wedged but netstat found no LISTENING PID — refusing to proceed blindly`);
    }
    for (const pid of pids) await killTree(pid);
    state = await probe(previewUrl, 2000);
    if (state.kind !== 'refused') {
      throw new Error(`port ${port} still answering after killing the wedged holder (probe=${state.kind})`);
    }
  }

  if (state.kind === 'ok') {
    console.log(`capture-route: server already serving on port ${port} — reusing it (will NOT be torn down)`);
    return null;
  }

  // state.kind === 'refused' -> we own the boot
  console.log(`capture-route: booting dev server on port ${port} ...`);
  // Spawn the local Next binary with node instead of `npm run dev` through a
  // shell: there is no command string to interpolate, and it avoids Node's
  // refusal to spawn Windows .cmd shims without `shell: true`. Teardown is
  // also more reliable — the pid is the dev server itself, not an npm wrapper.
  const child = spawn(
    process.execPath,
    [resolve(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--port', String(port)],
    // DATA-PLAN fix 1: world assets and sprites from the local mirrors, never the buckets.
    { stdio: ['ignore', 'ignore', 'pipe'], env: captureServerEnv(process.env) },
  );
  // Drain stderr so the pipe never backpressures the child.
  let lastStderr = '';
  child.stderr.on('data', (chunk) => {
    lastStderr = (lastStderr + chunk.toString()).slice(-2000);
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      child.kill();
      throw new Error(`dev server exited early with code ${child.exitCode} on port ${port}; last stderr:\n${lastStderr.trim() || '(none)'}`);
    }
    try {
      const check = await probe(previewUrl, 5000);
      if (check.kind === 'ok') break;
    } catch {
      /* transient probe errors during boot are expected — keep polling */
    }
    if (Date.now() > deadline) {
      throw new Error(`dev server on port ${port} not ready after ${READY_TIMEOUT_MS / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`capture-route: dev server ready on port ${port} (pid ${child.pid})`);
  return child;
}

async function teardownServer(child) {
  if (!child || child.pid == null) return;
  console.log('capture-route: tearing down spawned dev server');
  await killTree(child.pid);
}

/**
 * Wait until the damped pose has caught the scroll target and camPos is still.
 * Distinct --theme loads do not share settle (PB-040); a blind sleep can sample
 * mid-damp at 768. Does not pin or retarget — CameraRig still follows smooth.
 * Pumps rAF from the page so a parked demand loop can still advance smooth.
 */
async function waitForSettledPose(page) {
  const result = await page.evaluate(
    async ({ eps, holdMs, waitMs }) => {
      const kickRouteFrames = () => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return 'no-canvas';
        const r3f = canvas.__r3f;
        if (r3f && typeof r3f.invalidate === 'function') {
          r3f.invalidate(30);
          return 'invalidate';
        }
        if (r3f && r3f.store && typeof r3f.store.getState === 'function') {
          const state = r3f.store.getState();
          if (typeof state.invalidate === 'function') {
            state.invalidate(30);
            return 'store-invalidate';
          }
        }
        try {
          document.dispatchEvent(new Event('visibilitychange'));
        } catch {
          /* ignore */
        }
        return r3f ? `r3f-keys:${Object.keys(r3f).join(',')}` : 'no-r3f';
      };
      const started = performance.now();
      let prev = null;
      let stableAt = 0;
      let kick = 'pending';
      const tick = () =>
        new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          requestAnimationFrame(finish);
          setTimeout(finish, 32);
        });
      while (performance.now() - started < waitMs) {
        kick = kickRouteFrames();
        await tick();
        const read = window.__routeWorldProbe;
        if (typeof read !== 'function') continue;
        const body = read();
        if (
          body == null ||
          typeof body.smooth !== 'number' ||
          typeof body.exact !== 'number' ||
          !Array.isArray(body.camPos) ||
          body.camPos.length !== 3
        ) {
          continue;
        }
        if (Math.abs(body.smooth - body.exact) >= eps) {
          prev = null;
          stableAt = 0;
          continue;
        }
        const moved =
          !prev ||
          Math.abs(prev[0] - body.camPos[0]) >= eps ||
          Math.abs(prev[1] - body.camPos[1]) >= eps ||
          Math.abs(prev[2] - body.camPos[2]) >= eps;
        if (moved) {
          prev = [body.camPos[0], body.camPos[1], body.camPos[2]];
          stableAt = performance.now();
          continue;
        }
        if (performance.now() - stableAt >= holdMs) {
          return {
            ok: true,
            kick,
            smooth: body.smooth,
            exact: body.exact,
            camPos: body.camPos,
          };
        }
      }
      const read = window.__routeWorldProbe;
      const body = typeof read === 'function' ? read() : null;
      return {
        ok: false,
        kick,
        hidden: document.hidden,
        visibilityState: document.visibilityState,
        smooth: body?.smooth ?? null,
        exact: body?.exact ?? null,
        camPos: body?.camPos ?? null,
      };
    },
    { eps: POSE_STABLE_EPS, holdMs: POSE_STABLE_HOLD_MS, waitMs: POSE_STABLE_WAIT_MS },
  );
  if (!result.ok) {
    console.error(
      `capture-route: pose did not settle within ${POSE_STABLE_WAIT_MS / 1000}s (kick=${result.kick} hidden=${result.hidden} vis=${result.visibilityState} smooth=${result.smooth} exact=${result.exact} camPos=${JSON.stringify(result.camPos)}) — capturing anyway`,
    );
  } else {
    console.log(
      `capture-route: pose settled kick=${result.kick} smooth=${result.smooth} exact=${result.exact} camPos=${JSON.stringify(result.camPos)}`,
    );
  }
}

/**
 * Land `exact` on a station integer. Conductor HOLD_IDS is pulse/schedule
 * only — `#roster` start-align sits at localT≈0.22 (PB-013 / PB-050). Seeking
 * scrollY until exact≈index is the harness-side equivalent of a hold plateau and
 * does not retarget pulse/schedule.
 */
/** Round 2: the latest seek's record (with the conductor debug fields) for the settle sidecar. */
let lastSeekRecord = null;
async function seekStationExact(page, stationIndex) {
  const result = await page.evaluate(async ({ index, acceptEps, probeWaitMs }) => {
    const ids = ['pulse', 'roster', 'teams', 'schedule', 'rules'];
    const ACTIVATION = 0.35;
    const read = () => {
      const fn = window.__routeWorldProbe;
      return typeof fn === 'function' ? fn() : null;
    };
    const kick = () => {
      const canvas = document.querySelector('canvas');
      const r3f = canvas && canvas.__r3f;
      if (r3f && typeof r3f.invalidate === 'function') r3f.invalidate(8);
    };
    const tick = () =>
      new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        requestAnimationFrame(finish);
        setTimeout(finish, 32);
      });

    // Round 2: wait only for the probe to answer (bounded), never for
    // exact >= 0.5 — that unconditional 8 s wait burned 8 s on every seek
    // from the top of the page (W6 r2: part of the 57.7 s #schedule time).
    const started = performance.now();
    let body = read();
    let probeWaitedMs = 0;
    while (performance.now() - started < probeWaitMs) {
      if (body != null && typeof body.exact === 'number') break;
      kick();
      await tick();
      body = read();
    }
    probeWaitedMs = Math.round(performance.now() - started);
    const debugFields = (b) => ({
      mapVersion: b?.mapVersion ?? null,
      lastSampleKind: b?.lastSampleKind ?? null,
      sampleScrollY: b?.sampleScrollY ?? null,
      turnLag: b?.turnLag ?? null,
      settleToken: b?.settleToken ?? null,
    });

    const el = document.getElementById(ids[index] ?? '');
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const target = Math.min(Math.max(top - window.innerHeight * ACTIVATION, 0), maxScroll);
      window.scrollTo(0, target);
      kick();
      await tick();
      await tick();
      body = read();
      // Round 2: accept the anchor landing only inside the station-settle
      // eps (0.01) — the old 0.05 let an off-station anchor stand, and the
      // settle assertion now rejects anything outside 0.01 anyway.
      if (body != null && typeof body.exact === 'number' && Math.abs(body.exact - index) < acceptEps) {
        return {
          exact: body.exact,
          pin: body.pin ?? null,
          scrollY: window.scrollY,
          err: Math.abs(body.exact - index),
          via: 'anchor',
          probeWaitedMs,
          ...debugFields(body),
        };
      }
    }

    let lo = 0;
    let hi = maxScroll;
    let bestY = window.scrollY;
    let bestErr =
      body != null && typeof body.exact === 'number' ? Math.abs(body.exact - index) : Infinity;
    // Round 2: the old loop `continue`d when exact repeated the previous
    // read, which left lo/hi unchanged — on a hold plateau it re-probed the
    // same midpoint for every remaining step and returned an off-station
    // best (clouds teams 390 landed at exact 2.323). Every read now narrows
    // the interval; two frame ticks per probe give the conductor time to
    // re-read the scroll position.
    for (let step = 0; step < 28; step += 1) {
      const mid = (lo + hi) / 2;
      window.scrollTo(0, mid);
      kick();
      await tick();
      await tick();
      body = read();
      if (body == null || typeof body.exact !== 'number') continue;
      const err = Math.abs(body.exact - index);
      if (err < bestErr) {
        bestErr = err;
        bestY = mid;
      }
      if (err < acceptEps / 4) break;
      if (body.exact < index) lo = mid;
      else hi = mid;
    }
    window.scrollTo(0, bestY);
    kick();
    await tick();
    body = read();
    return {
      exact: body?.exact ?? null,
      pin: body?.pin ?? null,
      scrollY: window.scrollY,
      err: bestErr,
      via: 'bisection',
      probeWaitedMs,
      ...debugFields(body),
    };
  }, { index: stationIndex, acceptEps: STATION_SETTLE_EPS, probeWaitMs: SEEK_PROBE_WAIT_MS });
  lastSeekRecord = result;
  console.log(
    `capture-route: seek station ${stationIndex} via=${result.via} exact=${result.exact} pin=${result.pin} scrollY=${result.scrollY} err=${result.err} probeWaitedMs=${result.probeWaitedMs} mapVersion=${result.mapVersion} lastSampleKind=${result.lastSampleKind} sampleScrollY=${result.sampleScrollY} turnLag=${result.turnLag}`,
  );
  return result;
}

/** Wait until the conductor reports the start-align hold (C-021 r2 / PB-013). */
async function waitForEndpointHold(page, section) {
  const expectedPin = HOLD_PINS[section];
  if (expectedPin === undefined) return;
  // Roster / teams / rules: the conductor never reports these pins. Seek exact
  // onto the station first.
  if (SEEK_SECTIONS.has(section)) {
    await seekStationExact(page, expectedPin);
  }
  try {
    await page.waitForFunction(
      ({ pin, allowExact }) => {
        const read = window.__routeWorldProbe;
        if (typeof read !== 'function') return false;
        const body = read();
        if (body == null || typeof body.smooth !== 'number') return false;
        if (body.pin === pin && Math.abs(body.smooth - pin) < 0.05) return true;
        return (
          allowExact &&
          typeof body.exact === 'number' &&
          Math.abs(body.exact - pin) < 0.05 &&
          Math.abs(body.smooth - pin) < 0.05
        );
      },
      { pin: expectedPin, allowExact: SEEK_SECTIONS.has(section) },
      { timeout: HOLD_WAIT_MS },
    );
  } catch {
    console.error(
      `capture-route: #${section} hold did not report pin=${expectedPin} within ${HOLD_WAIT_MS / 1000}s — capturing anyway`,
    );
  }
}

/**
 * ADR-0003: focus one subject through the window bridge and wait until the
 * rig reports the blend settled (`phase === 'focused'`). Subjects register as
 * their meshes mount — an ace waits for its GLB — so the id is polled first.
 * Any failure is hard: a "focused" still that is really the station view
 * would be evidence for the wrong thing.
 */
async function focusSubject(page, id) {
  const result = await page.evaluate(
    async ({ subjectId, waitMs }) => {
      const started = performance.now();
      const tick = () =>
        new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          requestAnimationFrame(finish);
          setTimeout(finish, 32);
        });
      let bridge = window.__routeWorldFocus;
      while (performance.now() - started < waitMs) {
        bridge = window.__routeWorldFocus;
        if (bridge && bridge.subjects().includes(subjectId)) break;
        await tick();
      }
      if (!bridge) return { ok: false, reason: 'no-bridge', subjects: [] };
      const subjects = bridge.subjects();
      if (!subjects.includes(subjectId)) return { ok: false, reason: 'unknown-subject', subjects };
      if (!bridge.focus(subjectId)) return { ok: false, reason: 'focus-refused', subjects };
      while (performance.now() - started < waitMs) {
        await tick();
        const state = bridge.state();
        if (state.id === subjectId && state.phase === 'focused') {
          return { ok: true, subjects, state };
        }
      }
      return { ok: false, reason: 'blend-timeout', subjects, state: bridge.state() };
    },
    { subjectId: id, waitMs: FOCUS_WAIT_MS },
  );
  if (!result.ok) {
    throw new Error(
      `focus "${id}" failed (${result.reason}); registered subjects: ${result.subjects.join(', ') || '(none)'}${result.state ? `; state=${JSON.stringify(result.state)}` : ''}`,
    );
  }
  console.log(`capture-route: focused ${id} (${result.subjects.length} subjects registered)`);

  // A Subject with a panel writes `?team=` / `?mon=` / `?board=` through the
  // App Router, which round-trips the RSC payload before the docked panel
  // opens; the still must carry the panel, so wait for the dialog.
  if (result.state?.panel) {
    try {
      await page.locator('.world-focus-panel[open]').first().waitFor({ state: 'visible', timeout: FOCUS_WAIT_MS });
    } catch {
      throw new Error(`focus "${id}" panel (?${result.state.panel.param}=${result.state.panel.value}) did not open`);
    }
    // Let the panel's own scrollIntoView / focus() settle before the pose probe.
    await page.waitForTimeout(250);
  }
}

/**
 * C-057: read the page's render-path stamp from the harness side (the same
 * passive C-045 bridge the sidecar quotes). Returns null when the bridge has
 * not mounted yet.
 */
async function readRenderPath(page) {
  return page.evaluate(() => {
    const read = window.__routeWorldRenderPath;
    return typeof read === 'function' ? read() : null;
  });
}

/**
 * C-057 kit-settle wait: hold the present until the GLB kit facade is up and
 * the render path has held still for KIT_SETTLE_MIN_MS (settledMs resets on
 * every batch/map change, so >= the floor means "stable"). Bounded by
 * KIT_SETTLE_WAIT_MS, then an honest named failure — a still shot procedural
 * (C-045: both A/A pulse loads, settledMs≈40, inst=0) is not evidence.
 */
async function waitForKitSettle(page) {
  const started = Date.now();
  let last = null;
  for (;;) {
    last = await readRenderPath(page);
    if (last && last.facade === 'kit' && last.settledMs >= KIT_SETTLE_MIN_MS) break;
    if (Date.now() - started > KIT_SETTLE_WAIT_MS) {
      throw new Error(
        `FBO present failed (kit-settle-timeout) — facade=${last?.facade ?? 'no-bridge'} settledMs=${last?.settledMs ?? null} after ${KIT_SETTLE_WAIT_MS / 1000}s (floor ${KIT_SETTLE_MIN_MS} ms)`,
      );
    }
    await page.waitForTimeout(RESIDENCY_POLL_MS);
  }
  const waitedMs = Date.now() - started;
  console.log(
    `capture-route: kit settled facade=${last.facade} instancedMeshes=${last.instancedMeshes} staticBatches=${last.staticBatches} settledMs=${last.settledMs} waitedMs=${waitedMs}`,
  );
  return { mode: 'waited', facade: last.facade, settledMs: last.settledMs, waitedMs };
}

/**
 * Wave 2 r3: the flagged residency record (the still is emitted; the flag
 * rides in the sidecar's assetResidency and the run's closing lines).
 * `reference` carries the world's last recorded whole-world count when one
 * is known (RESIDENCY_REFERENCE), so a judge can read how many maps were
 * not resident at the present.
 */
function residencyFlagged(kind, { last, firstFileMaps, samples, frameSubscribers, mapsFloor, fsFloor, started }) {
  const reference = RESIDENCY_REFERENCE[worldId ?? 'plaza'] ?? null;
  const record = {
    mode: 'flagged',
    flag: kind === 'timeout' ? 'asset-residency-timeout' : 'asset-residency-below-floor',
    fileMaps: last?.fileMaps ?? null,
    firstFileMaps,
    samples,
    settledMs: last?.settledMs ?? null,
    frameSubscribers,
    floors: { fileMaps: mapsFloor, frameSubscribers: fsFloor },
    reference,
    waitedMs: Date.now() - started,
    note: kind === 'timeout'
      ? `fileMaps never went quiet at or above the floor within ${RESIDENCY_WAIT_MS / 1000}s — the still is emitted and flagged, judge figures / maps on it with care`
      : `fileMaps quiet for ${RESIDENCY_BELOW_FLOOR_QUIET_MS / 1000}s below the floor — a station-windowed world can keep fewer maps resident at one station; the still is emitted and flagged`,
  };
  residencyFlags.push(`${record.flag} fileMaps=${record.fileMaps} floor=${mapsFloor ?? 'auto'}${reference ? ` (${worldId ?? 'plaza'} reference ${reference.fileMaps} from ${reference.from})` : ''}`);
  console.log(`capture-route: RESIDENCY FLAGGED (${record.flag}) fileMaps=${record.fileMaps} (first ${firstFileMaps}, floor ${mapsFloor ?? 'auto-observe'}) frameSubscribers=${frameSubscribers ?? 'n/a'} (floor ${fsFloor ?? 'auto-observe'}) after ${Math.round(record.waitedMs / 1000)}s — emitting the still with the flag`);
  return record;
}

/**
 * C-057 asset-residency present-wait (the C-047 r2 SPAWN): hold the present
 * until the page's file textures have landed — fileMaps >= its floor AND the
 * render path quiet (settledMs >= RESIDENCY_STABLE_MS; the bridge resets it
 * on every map/batch change, so a long quiet window means nothing is still
 * landing, the exact class that presented walkerless at C-047) — and, when
 * the debug-gated phase hook is up and walkers were requested,
 * frameSubscribers >= the FS floor (the hook is the only path to the r3f
 * subscriber count). Walkerless loads presented at fileMaps 27 / FS 19 while
 * resident loads (72-74 / 43) painted; a present in that window would write
 * a walkerless frame as evidence. Bounded by RESIDENCY_WAIT_MS, then an
 * honest named failure.
 */
// C-098 --residency-auto run-scoped state: null until the run's first
// (observing) wait derives the floors; from then on they hold for every later
// wait in the process. Unused when --residency-auto is off (the fixed
// RESIDENCY_FILE_MAPS_MIN / RESIDENCY_FS_MIN floors apply, unchanged).
let autoFileMapsFloor = null;
let autoFsFloor = null;
let residencyAutoDerived = false;

async function waitForAssetResidency(page, { withFrameSubscribers }) {
  // C-098 --residency-auto (OBSERVE-BEFORE-GATE): the run's FIRST wait is
  // quiet-window-only (null floor = nothing gated yet), so a world that
  // settles BELOW the fixed floor is observed instead of timing out; at its
  // settle the counts ARE the derivation — floor = observed −
  // RESIDENCY_AUTO_MARGIN, printed once and applied run-scoped from that
  // point (the sanctioned manual ancestor's margin law, automated). Default
  // OFF: the fixed floors, byte-for-byte the pre-C-098 semantics.
  const observeFirst = residencyAutoOn && !residencyAutoDerived;
  const mapsFloor = !residencyAutoOn ? RESIDENCY_FILE_MAPS_MIN : observeFirst ? null : autoFileMapsFloor;
  const fsFloor = !residencyAutoOn ? RESIDENCY_FS_MIN : observeFirst ? null : autoFsFloor;
  const started = Date.now();
  let samples = 0;
  let firstFileMaps = null;
  let last = null;
  let frameSubscribers = null;
  for (;;) {
    last = await readRenderPath(page);
    samples += 1;
    if (last) {
      if (firstFileMaps === null) firstFileMaps = last.fileMaps;
      if (frameSubscribers === null && withFrameSubscribers) {
        frameSubscribers = await page.evaluate(
          ({ uTime, elapsed }) => {
            const hook = window.__routeWorldPinPhase;
            if (typeof hook !== 'function') return null;
            try {
              const report = hook(uTime, elapsed);
              return report && typeof report.frameSubscribers === 'number' ? report.frameSubscribers : null;
            } catch {
              return null;
            }
          },
          { uTime: PIN_U_TIME, elapsed: PIN_ELAPSED },
        );
      }
      const mapsReady =
        (mapsFloor === null || last.fileMaps >= mapsFloor) && (last.settledMs ?? 0) >= RESIDENCY_STABLE_MS;
      const fsReady =
        !withFrameSubscribers ||
        (frameSubscribers !== null && (fsFloor === null || frameSubscribers >= fsFloor));
      if (mapsReady && fsReady) break;
      // Wave 2 r3 (W1 judge: clouds pulse failed fileMaps 19 < 22 on 4/4
      // tries — a station-windowed world keeps fewer maps resident at one
      // station than the whole-world floor assumes): a load that has been
      // QUIET for RESIDENCY_BELOW_FLOOR_QUIET_MS below the floor is emitted
      // with a flag instead of aborting the run. The quiet bound outlasts the
      // residency-flake shim's first release (20 s), so a stalled GLB still waits.
      if ((last.settledMs ?? 0) >= RESIDENCY_BELOW_FLOOR_QUIET_MS) {
        return residencyFlagged('below-floor-quiet', { last, firstFileMaps, samples, frameSubscribers, mapsFloor, fsFloor, started });
      }
    }
    if (Date.now() - started > RESIDENCY_WAIT_MS) {
      return residencyFlagged('timeout', { last, firstFileMaps, samples, frameSubscribers, mapsFloor, fsFloor, started });
    }
    await page.waitForTimeout(RESIDENCY_POLL_MS);
  }
  const waitedMs = Date.now() - started;
  if (observeFirst) {
    // C-098: derive ONCE from the settled counts (jitter disclosed); the
    // floors are run-scoped from here on — never set a floor >= observed,
    // that false-fails on jitter (the C-090 margin law).
    autoFileMapsFloor = Math.max(last.fileMaps - RESIDENCY_AUTO_MARGIN, 0);
    console.log(
      `capture-route: residency floor ${last.fileMaps}-${RESIDENCY_AUTO_MARGIN} = ${autoFileMapsFloor} (auto) — first-load quiet-window observation; ±1-2 map jitter stays green, a drop of >=${RESIDENCY_AUTO_MARGIN + 1} fileMaps fails (the manual RESIDENCY_FILE_MAPS_MIN=observed−2 margin law, RUNLOG 2026-09-17T14:58Z: 14 = 16 − 2, automated)`,
    );
    if (withFrameSubscribers && frameSubscribers !== null) {
      autoFsFloor = Math.max(frameSubscribers - RESIDENCY_AUTO_MARGIN, 0);
      console.log(
        `capture-route: residency fs floor ${frameSubscribers}-${RESIDENCY_AUTO_MARGIN} = ${autoFsFloor} (auto) — frameSubscribers observed at the same quiet window; ±1-2 jitter stays green`,
      );
    } else {
      console.log('capture-route: residency fs=n/a (gate inactive)');
    }
    residencyAutoDerived = true;
  }
  console.log(
    `capture-route: assets resident fileMaps=${last.fileMaps} (first ${firstFileMaps}, ${samples} samples, quiet ${last.settledMs} ms) frameSubscribers=${withFrameSubscribers ? frameSubscribers : 'skipped'} waitedMs=${waitedMs}`,
  );
  return {
    mode: 'waited',
    fileMaps: last.fileMaps,
    firstFileMaps,
    samples,
    settledMs: last.settledMs,
    frameSubscribers,
    waitedMs,
    // C-098 (additive): the --residency-auto derivation, stamped on the
    // station whose observation produced it (absent from fixed-floor runs).
    ...(observeFirst
      ? {
          autoDerivation: {
            observedFileMaps: last.fileMaps,
            fileMapsFloor: autoFileMapsFloor,
            observedFs: withFrameSubscribers ? frameSubscribers : null,
            fsFloor: withFrameSubscribers ? autoFsFloor : null,
          },
        }
      : {}),
  };
}

/**
 * C-057 residency-flake self-test shim: stall the first `count` figure-GLB
 * responses, releasing them in staggered waves (release k at armed +
 * RESIDENCY_FLAKE_RELEASE_MS + k * RESIDENCY_FLAKE_STAGGER_MS), reproducing
 * the C-047 r2 asset-settle class — figure fetches still landing AFTER the
 * pose settle, so the render-path counts are still climbing when the harness
 * would present — without a second browser seat. Installed AFTER the initial
 * page load, so the stall cannot delay the navigation's own networkidle
 * window.
 */
async function armResidencyFlakeInject(context, count) {
  let stalled = 0;
  const armedAtMs = Date.now();
  await context.route('**/models/world/models/**', async (route) => {
    const index = stalled;
    const releaseAtMs = armedAtMs + RESIDENCY_FLAKE_RELEASE_MS + index * RESIDENCY_FLAKE_STAGGER_MS;
    if (index >= count || Date.now() >= releaseAtMs) return route.continue();
    stalled += 1;
    await new Promise((r) => setTimeout(r, Math.max(releaseAtMs - Date.now(), 0)));
    return route.continue();
  });
  console.log(
    `capture-route: residency-flake-inject armed — stalling the first ${count} figure GLB responses, staggered releases from ${RESIDENCY_FLAKE_RELEASE_MS / 1000}s every ${RESIDENCY_FLAKE_STAGGER_MS / 1000}s (self-test shim)`,
  );
}

/**
 * C-106 r2: hide the Next.js dev-tools overlay (`nextjs-portal` host — the
 * dev-tools button + red "Issues" badge injected by `next dev`). Dev chrome,
 * not app UI: element screenshots clip the page, so a fixed-position portal
 * overlapping the HUD/panel boxes leaks into delivered captures (C-106 r1
 * panel P2). A stylesheet rule on the HOST element covers late mounts
 * (shadow-DOM internals render through the host); the explicit per-portal
 * inline hide is the belt to the rule's braces. Idempotent; returns how many
 * portal hosts were present (stamped additively in the sidecar).
 */
// Round 2: the ?routeDebug=1 perf readout (RouteDebugOverlay,
// [data-route-debug-overlay], fixed bottom-left) is debug chrome too — round 1
// burned it into every --occlusion still over the 390 WorldNav HUD and over
// the docked ball in every loader film. It is hidden with the dev portal; its
// telemetry bridges stay mounted (only the DOM readout is hidden).
const DEBUG_HUD_SELECTOR = '[data-route-debug-overlay]';
const DEV_OVERLAY_HIDE_CSS = `nextjs-portal, ${DEBUG_HUD_SELECTOR} { display: none !important; }`;
async function hideNextDevOverlay(page) {
  return page.evaluate(({ css, hudSelector }) => {
    let style = document.querySelector('style[data-capture-hide-dev-overlay]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-capture-hide-dev-overlay', '');
      style.textContent = css;
      document.head.appendChild(style);
    }
    let hidden = 0;
    for (const portal of document.querySelectorAll('nextjs-portal')) {
      portal.style.display = 'none';
      hidden += 1;
    }
    for (const hud of document.querySelectorAll(hudSelector)) {
      hud.style.display = 'none';
    }
    return hidden;
  }, { css: DEV_OVERLAY_HIDE_CSS, hudSelector: DEBUG_HUD_SELECTOR });
}

/** Round 2: how many debug perf readouts the page carries (all hidden by the CSS above). */
async function countDebugHuds(page) {
  return page.evaluate((sel) => document.querySelectorAll(sel).length, DEBUG_HUD_SELECTOR);
}

/**
 * Round 2: the same hide, installed before navigation (addInitScript) so the
 * loader trace / film never records the debug readout over the docked ball.
 * Injected at DOMContentLoaded into <head> (nothing is appended to <html>
 * before hydration).
 */
function installDebugHudHide(css) {
  const add = () => {
    if (document.querySelector('style[data-capture-hide-dev-overlay]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-capture-hide-dev-overlay', '');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true });
  else add();
}

/**
 * C-109 r1: read-only instance screen-projection scan (attribution probe).
 * Runs against the debug-gated live scene AFTER the pose settles: the landed
 * camera is read from the scene graph (the cam-probe-c107 idiom), each named
 * InstancedMesh's instance transforms are decomposed from the raw
 * instanceMatrix array, and every instance's base + crown point is projected
 * into frame pixels through the LIVE projection matrix. Reports per mesh:
 * instance count, in-frame count, and foreground-band count (the frame's
 * bottom third — the judged band), plus up to 8 in-band sample rows.
 * Frame W/H come from the canvas device size (the present's pixel size).
 */
const PROJECT_BAND_FRACTION = 2 / 3; // judged foreground band = bottom third (y 562-844 at 390x844)

async function runProjectInstancesScan(page) {
  return page.evaluate(({ names, all, bandFraction }) => {
    const sceneRead = window.__routeWorldScene;
    if (typeof sceneRead !== 'function') return { ok: false, reason: 'missing-scene-handle' };
    const scene = sceneRead();
    const camera = scene.getObjectByProperty('type', 'PerspectiveCamera');
    if (!camera) return { ok: false, reason: 'no-camera-in-scene' };
    camera.updateMatrixWorld(true);
    const canvas = document.querySelector('canvas');
    const W = canvas?.width ?? 0;
    const H = canvas?.height ?? 0;
    if (!W || !H) return { ok: false, reason: 'no-canvas-size' };
    const e = camera.matrixWorld.elements; // column-major; columns = right/up/back axes + position
    const camPos = [e[12], e[13], e[14]];
    const right = [e[0], e[1], e[2]];
    const up = [e[4], e[5], e[6]];
    const back = [e[8], e[9], e[10]];
    const p = camera.projectionMatrix.elements;
    const project = (wx, wy, wz) => {
      const dx = wx - camPos[0];
      const dy = wy - camPos[1];
      const dz = wz - camPos[2];
      const vx = dx * right[0] + dy * right[1] + dz * right[2];
      const vy = dx * up[0] + dy * up[1] + dz * up[2];
      const vz = dx * back[0] + dy * back[1] + dz * back[2];
      const cw = p[3] * vx + p[7] * vy + p[11] * vz;
      if (cw <= 0) return null; // behind/at the eye plane
      const nx = (p[0] * vx + p[4] * vy + p[8] * vz) / cw;
      const ny = (p[1] * vx + p[5] * vy + p[9] * vz) / cw;
      return { x: (nx + 1) * 0.5 * W, y: (1 - (ny + 1) * 0.5) * H, z: vz };
    };
    // Self-check: a point 10 m down the forward axis must project dead center.
    const fLen = Math.hypot(back[0], back[1], back[2]);
    const center = project(
      camPos[0] - (back[0] / fLen) * 10,
      camPos[1] - (back[1] / fLen) * 10,
      camPos[2] - (back[2] / fLen) * 10,
    );
    const bandTop = Math.floor(H * bandFraction);
    const wanted = all ? null : new Set(names);
    const meshes = [];
    scene.traverse((object) => {
      if (!object.isInstancedMesh) return;
      if (wanted && !wanted.has(object.name)) return;
      const geometry = object.geometry;
      geometry.computeBoundingBox();
      const topY = geometry.boundingBox ? geometry.boundingBox.max.y : 0;
      const arr = object.instanceMatrix.array;
      let inFrame = 0;
      let inBand = 0;
      const samples = [];
      for (let i = 0; i < object.count; i += 1) {
        const o = i * 16;
        const wx = arr[o + 12];
        const wy = arr[o + 13];
        const wz = arr[o + 14];
        // Instance y-scale from the transformed up column (crown = base + topY * scaleY).
        const sy = Math.hypot(arr[o + 4], arr[o + 5], arr[o + 6]);
        const base = project(wx, wy, wz);
        const crown = project(wx, wy + topY * sy, wz);
        const inX = (pt) => pt !== null && pt.x >= 0 && pt.x < W;
        const baseVisible = base !== null && inX(base) && base.z < 0;
        const crownVisible = crown !== null && inX(crown) && crown.z < 0;
        if (baseVisible || crownVisible) inFrame += 1;
        const inBandHit =
          (base !== null && inX(base) && base.z < 0 && base.y >= bandTop && base.y < H) ||
          (crown !== null && inX(crown) && crown.z < 0 && crown.y >= bandTop && crown.y < H);
        if (inBandHit) {
          inBand += 1;
          if (samples.length < 8) {
            const pt = crown ?? base;
            samples.push({
              i,
              x: Math.round(pt.x),
              y: Math.round(pt.y),
              w: [+wx.toFixed(2), +wy.toFixed(2), +wz.toFixed(2)],
            });
          }
        }
      }
      meshes.push({ name: object.name || '(unnamed)', count: object.count, inFrame, inBand, samples });
    });
    if (!all) {
      for (const name of names) {
        if (!meshes.some((m) => m.name === name)) {
          return { ok: false, reason: 'project-instances-matched-nothing', missing: name };
        }
      }
    }
    return {
      ok: true,
      camPos,
      viewport: { W, H },
      centerCheck: center ? { x: +center.x.toFixed(1), y: +center.y.toFixed(1) } : null,
      bandTop,
      meshes,
    };
  }, { names: projectMeshNames, all: projectAll, bandFraction: PROJECT_BAND_FRACTION });
}

const DOM_BACKDROP_ID = '__capture-dom-backdrop';

/**
 * POKEMON-CORE A1.6: lay the presented frame over the world canvas as an
 * <img> (same box, directly above the canvas, below every DOM layer), so the
 * element screenshots of translucent layers (the HUD band, the Station Card,
 * the 2C overlays, the focus panel) see the PINNED frame behind them instead
 * of whatever the live canvas painted since. Returns the record the sidecar
 * stamps (devOverlay.domBackdrop).
 */
async function installDomBackdrop(page, dataUrl) {
  return page.evaluate(
    async ({ id, url }) => {
      document.getElementById(id)?.remove();
      const canvas = document.querySelector('[data-route-canvas] canvas') || document.querySelector('canvas');
      if (!canvas) return { mode: 'live', reason: 'no-canvas' };
      const r = canvas.getBoundingClientRect();
      const img = new Image();
      img.id = id;
      img.alt = '';
      img.src = url;
      try {
        await img.decode();
      } catch {
        return { mode: 'live', reason: 'decode-failed' };
      }
      Object.assign(img.style, {
        position: 'fixed',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        margin: '0',
        padding: '0',
        border: '0',
        pointerEvents: 'none',
        imageRendering: 'pixelated',
      });
      canvas.insertAdjacentElement('afterend', img);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const q = img.getBoundingClientRect();
      const rectMatch = Math.abs(q.left - r.left) < 0.5 && Math.abs(q.top - r.top) < 0.5 && Math.abs(q.width - r.width) < 0.5 && Math.abs(q.height - r.height) < 0.5;
      return { mode: 'fbo', rectMatch, css: { w: Math.round(r.width), h: Math.round(r.height) }, px: { w: img.naturalWidth, h: img.naturalHeight } };
    },
    { id: DOM_BACKDROP_ID, url: dataUrl },
  );
}

async function removeDomBackdrop(page) {
  await page.evaluate((id) => document.getElementById(id)?.remove(), DOM_BACKDROP_ID);
}

/**
 * C-021 GPU FBO world pixels, then stamp the live WorldNav DOM (C-010 / PB-082).
 * Refuses compositor-only world present and refuses FBO-only when HUD is missing.
 *
 * C-039: when the phase pin is on, the present task probes for an OPTIONAL
 * page-side phase hook (`window.__routeWorldPinPhase(uTime, elapsedTime)`,
 * debug-gated — see the C-039 BLOCKER note) and records whether one answered.
 * R3F v9 keeps its store in a module-private WeakMap keyed by the canvas, so a
 * script-only canonical write of uTime-family uniforms / clock.elapsedTime is
 * NOT reachable from the harness; what the URL CAN pin (the quality rung /
 * governor) is closed by the phase pin's routeQuality param instead.
 */
async function writePresentedPng(page, outPath, phasePin, patchSpecs, hideSpecs, presentOptions) {
  // S9 --frames: the trace frames reuse this exact present path but skip the
  // C-057 readiness waits (the station's own still already passed them, and a
  // 12 s residency quiet window per frame would make a 30 s trace impossible).
  const traceFrame = presentOptions?.traceFrame === true;
  try {
    await page.waitForFunction(() => typeof window.__routeWorldPresent === 'function', null, {
      timeout: PRESENT_HOOK_WAIT_MS,
    });
  } catch {
    // C-046: the hydration-flake class — the present hook never mounted.
    // Named (not a bare Playwright timeout) so the bounded reload-retry can
    // classify it, and the honest failure names the real cause.
    throw new Error(
      `FBO present failed (present-hook-timeout) — __routeWorldPresent never mounted within ${PRESENT_HOOK_WAIT_MS / 1000}s`,
    );
  }
  // C-057 present-readiness waits (default on): the frame is held until the
  // GLB kit facade is settled and the figure assets have landed — a
  // procedural-facade or walkerless present is not evidence (C-045 / C-047).
  const kitSettle = traceFrame
    ? { mode: 'trace-frame' }
    : kitSettleOn
      ? await waitForKitSettle(page)
      : { mode: 'off' };
  const assetResidency = traceFrame
    ? { mode: 'trace-frame' }
    : residencyWaitOn
      ? await waitForAssetResidency(page, { withFrameSubscribers: residencyFsGate })
      : { mode: 'off' };
  // R49: one in-page present attempt (patch / hide / pin / present / restore
  // in one task); a retry re-runs the whole task, so every arm stays atomic.
  const presentOnce = () => page.evaluate(({ pin, patches, hides }) => {
    const present = window.__routeWorldPresent;
    if (typeof present !== 'function') {
      return { ok: false, reason: 'missing-hook', phasePin: null, renderPath: null, materialPatch: null, meshHide: null };
    }
    let clockHook = false;
    // C-045 r2 (additive): a page hook that also parks node-transform movers
    // reports what it did; null = the page's hook pre-dates the extension.
    let moverPin = null;
    let frameSubscribers = null;
    // C-057 (additive): the delta-isolation arm — patch materials through the
    // debug-gated scene handle INSIDE the present task (PB-252 same-load arm:
    // patch and present share one page load), BEFORE the phase pin so the
    // pin's canonical uTime write stays last. A spec that matches nothing (or
    // matches materials without the named uniforms) fails the run honestly —
    // a silently unpatched arm would capture the wrong delta.
    let materialPatch = null;
    if (patches && patches.length > 0) {
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') {
        return { ok: false, reason: 'missing-scene-handle', phasePin: null, renderPath: null, materialPatch: null };
      }
      const scene = sceneRead();
      materialPatch = [];
      for (const spec of patches) {
        const seen = new Set();
        let materials = 0;
        let applied = 0;
        scene.traverse((object) => {
          const material = object.material;
          const list = Array.isArray(material) ? material : material ? [material] : [];
          for (const candidate of list) {
            if (!candidate || seen.has(candidate.uuid)) continue;
            // <sig> matches the material's name OR its type (GLB assets ship
            // unnamed materials, so type sigs like ShaderMaterial are the
            // reachable arm across the graph).
            if (candidate.name !== spec.sig && candidate.type !== spec.sig) continue;
            seen.add(candidate.uuid);
            materials += 1;
            const uniforms = candidate.uniforms;
            for (const { uniform, value } of spec.pairs) {
              if (uniforms && uniforms[uniform]) {
                uniforms[uniform].value = value;
                applied += 1;
              } else if (typeof candidate[uniform] === 'number') {
                candidate[uniform] = value;
                applied += 1;
              }
            }
          }
        });
        materialPatch.push({ sig: spec.sig, materials, applied });
      }
      if (materialPatch.some((r) => r.applied === 0)) {
        return { ok: false, reason: 'patch-material-matched-nothing', phasePin: null, renderPath: null, materialPatch, meshHide: null };
      }
    }
    // C-109 r1 toggle arm: hide the named objects for this present only. The
    // write is restored in this same task after the frame is read (the
    // scene-handle contract: arms restore every write).
    let meshHide = null;
    let hiddenObjects = [];
    if (hides && hides.length > 0) {
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') {
        return { ok: false, reason: 'missing-scene-handle', phasePin: null, renderPath: null, materialPatch: null, meshHide: null };
      }
      const scene = sceneRead();
      meshHide = [];
      for (const name of hides) {
        let hits = 0;
        scene.traverse((object) => {
          if (object.name === name && object.visible !== false) {
            object.visible = false;
            hiddenObjects.push(object);
            hits += 1;
          }
        });
        meshHide.push({ name, hidden: hits });
      }
      if (meshHide.some((r) => r.hidden === 0)) {
        // Restore whatever the loop already hid before failing honestly.
        for (const object of hiddenObjects) object.visible = true;
        return { ok: false, reason: 'hide-mesh-matched-nothing', phasePin: null, renderPath: null, materialPatch: null, meshHide };
      }
    }
    if (pin && pin.mode === 'pinned') {
      const hook = window.__routeWorldPinPhase;
      if (typeof hook === 'function') {
        try {
          const report = hook(pin.uTime, pin.elapsedTime);
          clockHook = true;
          if (report && typeof report === 'object') {
            moverPin = report.advanced === true;
            frameSubscribers = typeof report.frameSubscribers === 'number' ? report.frameSubscribers : null;
          }
        } catch {
          clockHook = false;
        }
      }
    }
    const phasePin =
      pin && pin.mode === 'pinned'
        ? { mode: 'pinned', uTime: pin.uTime, elapsedTime: pin.elapsedTime, clockHook, moverPin, frameSubscribers }
        : { mode: 'off' };
    // C-045: read the page's passive render-path stamp in the SAME task as the
    // present, so the sidecar records the build state that produced this frame.
    let renderPath = null;
    const renderPathRead = window.__routeWorldRenderPath;
    if (typeof renderPathRead === 'function') {
      try {
        renderPath = renderPathRead();
      } catch {
        renderPath = { error: 'threw' };
      }
    }
    let frameResult;
    try {
      const frame = present();
      if (!frame || typeof frame.dataUrl !== 'string' || !frame.dataUrl.startsWith('data:image/png')) {
        // R49: say WHAT came back and the page's present gate right after
        // (null + held gate = the typed not-ready answer, classified
        // present-gate-held harness-side; see scripts/lib/present-retry.mjs).
        const payloadKind =
          frame === null
            ? 'null'
            : frame === undefined
              ? 'undefined'
              : typeof frame !== 'object'
                ? typeof frame
                : typeof frame.dataUrl !== 'string'
                  ? 'no-dataUrl'
                  : `non-png:${frame.dataUrl.slice(0, 16)}`;
        let gate = null;
        try {
          const read = window.__routeWorldRenderPath;
          gate = typeof read === 'function' ? (read().presentGate ?? null) : null;
        } catch {
          gate = null;
        }
        frameResult = { ok: false, reason: 'invalid-payload', payloadKind, gate };
      } else {
        frameResult = { ok: true, dataUrl: frame.dataUrl, width: frame.width, height: frame.height };
      }
    } catch (err) {
      frameResult = { ok: false, reason: err instanceof Error ? err.message : 'present-threw' };
    }
    // The toggle arm's restore: every hidden object comes back in the same
    // task, win or lose (the scene-handle contract).
    for (const object of hiddenObjects) object.visible = true;
    return { ...frameResult, phasePin, renderPath, materialPatch, meshHide };
  }, { pin: phasePin, patches: patchSpecs ?? [], hides: hideSpecs ?? [] });
  // R49 (the K8 film crash): a held page gate (null present right after a
  // rung step, a focus transition or a figure visibility flip) is waited
  // out against the page's OWN gate, then the present is retried ONCE; a
  // malformed payload is retried once only right after a rung step. Fix
  // round TOOLS-3: the orchestration is presentWithRetry (present-retry.mjs,
  // unit-tested); the retry is returned as presentRetry and every caller
  // records it; a second failure throws the classified reason.
  const transition = presentOptions?.transition ?? null;
  const { presented, presentRetry } = await presentWithRetry(presentOnce, {
    transition,
    readGate: () =>
      page.evaluate(() => {
        const read = window.__routeWorldRenderPath;
        return typeof read === 'function' ? (read().presentGate ?? null) : null;
      }),
    gateWait: { boundMs: PRESENT_GATE_REOPEN_WAIT_MS, pollMs: PRESENT_GATE_POLL_MS },
    waitFrames: () =>
      page.evaluate(() => {
        const t0 = performance.now();
        return new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done({ frames: 2, waitedMs: Math.round(performance.now() - t0) }))),
        );
      }),
    onRetry: (record, second) =>
      console.log(
        `capture-route: [present-retry] ${record.reason}${transition ? ` after ${transition}` : ''} wait=${JSON.stringify(record.wait)} -> ${second.ok ? 'ok' : `failed again (${record.secondReason})`} (${outPath})`,
      ),
  });

  // C-106 r2: dev chrome must be down BEFORE any element screenshot — the
  // HUD/panel clips below would otherwise carry the portal's badge.
  const devOverlaysHidden = await hideNextDevOverlay(page);
  await page.evaluate(() => {
    for (const nav of document.querySelectorAll('body > nav')) {
      if (nav.classList.contains('world-nav-hud')) continue;
      nav.setAttribute('data-capture-hud-hide', '');
      nav.style.visibility = 'hidden';
    }
  });

  const hud = page.locator('.world-nav-hud');
  await hud.waitFor({ state: 'visible', timeout: 15_000 });
  const bar = page.locator('.world-nav-hud-bar');
  await bar.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await hud.boundingBox();
  if (!box || box.width < 8 || box.height < 8) {
    throw new Error('WorldNav HUD missing or empty — refusing FBO-only present');
  }

  // POKEMON-CORE A1.6: the DOM layers' backdrop is the presented frame, not
  // the live canvas (removed again below, before compositing).
  const domBackdrop = domBackdropMode === 'fbo' && !traceFrame ? await installDomBackdrop(page, presented.dataUrl) : { mode: traceFrame ? 'trace-live' : 'live' };
  const hudPng = await hud.screenshot({
    omitBackground: true,
    animations: 'disabled',
  });

  const comma = presented.dataUrl.indexOf(',');
  const fboBuf = Buffer.from(presented.dataUrl.slice(comma + 1), 'base64');
  // Round 2: a flat world frame is never evidence. The byte floor below let
  // a uniform grey 390 present through (42 KB, luma spread 4.8, kit
  // mid-build); every real still of the four worlds measured >= 25
  // (foggiest: clouds light roster 1440). Checked on the world FBO alone,
  // before the HUD is composited.
  const worldLuma = await lumaSpread(fboBuf);
  if (worldLuma.spread < FLAT_STILL_SPREAD_MIN) {
    throw new Error(
      `flat-still — the presented world frame has luma spread ${worldLuma.spread.toFixed(2)} (< ${FLAT_STILL_SPREAD_MIN}, mean ${worldLuma.mean.toFixed(1)}); refusing to write ${outPath}`,
    );
  }
  // The FBO is presented at the canvas' device-pixel size; DOM boxes are CSS px.
  const cssWidth = page.viewportSize()?.width ?? presented.width;
  const scale = presented.width / cssWidth;
  const fit = async (png, domBox) => {
    const left = Math.max(0, Math.round(domBox.x * scale));
    const top = Math.max(0, Math.round(domBox.y * scale));
    const w = Math.max(1, Math.min(presented.width - left, Math.round(domBox.width * scale)));
    const h = Math.max(1, Math.min(presented.height - top, Math.round(domBox.height * scale)));
    return { input: await sharp(png).resize(w, h, { fit: 'fill' }).png().toBuffer(), left, top, w, h };
  };
  const hud0 = await fit(hudPng, box);
  // Wave 2 round 2 (W1 judge: "the Station Card is never composited"): the
  // DOM layers a visitor sees over the world are pasted in their own
  // z-order: Station Card (z 24) and the 2C hover brackets / label pill /
  // HoloBeam (z 24), then the docked panel (25), then the HUD (30). Each
  // uses the HUD's element-screenshot path; the card is clipped to its
  // content box (see readDomLayers: a stretched card box is a reported
  // defect, not pasted over the whole frame).
  // Trace frames do not wait for the card (a 3 s wait per frame would break
  // the cadence); a still waits for the settled enter state.
  const stationCard = presentOptions?.skipDomOverlays ? null : await captureStationCardLayer(page, fit, { waitMs: traceFrame ? 0 : STATION_CARD_WAIT_MS });
  const overlays = presentOptions?.skipDomOverlays ? null : await captureFocusOverlayLayers(page, fit);
  const layers = [];
  if (stationCard?.layer) layers.push(stationCard.layer);
  if (overlays) layers.push(...overlays.layers);

  // Focus panel (ADR-0003): when a Subject's panel is open it is part of the
  // station view, so the still carries it too.
  const panel = page.locator('.world-focus-panel[open]');
  let panelNote = '';
  if ((await panel.count()) > 0) {
    const panelBox = await panel.first().boundingBox();
    if (panelBox && panelBox.width >= 8 && panelBox.height >= 8) {
      const panelPng = await panel.first().screenshot({ omitBackground: true, animations: 'disabled' });
      const fitted = await fit(panelPng, panelBox);
      layers.push(fitted);
      panelNote = ` panel=${fitted.w}x${fitted.h}@(${fitted.left},${fitted.top})`;
    }
  }
  layers.push(hud0);
  if (domBackdrop.mode === 'fbo') await removeDomBackdrop(page);

  const composited = await sharp(fboBuf)
    .composite(layers.map(({ input, left, top }) => ({ input, left, top })))
    .png()
    .toBuffer();

  await writeFile(outPath, composited);
  const cardNote = stationCard
    ? stationCard.record.present
      ? ` card=${stationCard.layer ? `${stationCard.layer.w}x${stationCard.layer.h}@(${stationCard.layer.left},${stationCard.layer.top})` : 'not-pasted'} opacity=${stationCard.record.opacity}`
      : ' card=absent'
    : '';
  const overlayNote = overlays && overlays.layers.length > 0 ? ` overlays=${overlays.record.pasted.join('+')}` : '';
  console.log(
    `capture: FBO+HUD present ${presented.width}x${presented.height} hud=${hud0.w}x${hud0.h}@(${hud0.left},${hud0.top})${cardNote}${overlayNote}${panelNote} -> ${outPath}`,
  );
  // C-046 (additive): the fitted HUD band in presented-frame px — the blob
  // count-of-record derives its per-frame band ceiling from this stamp, so
  // the y-ceiling is measured, never hardcoded per viewport (PB-205).
  // C-057 (additive): the present-readiness wait records and the material
  // patch report ride along for the sidecar stamp.
  return {
    ...presented,
    hud: { left: hud0.left, top: hud0.top, width: hud0.w, height: hud0.h },
    kitSettle,
    assetResidency,
    // R49 (additive): the one present re-acquire this frame needed (null = clean first attempt).
    presentRetry,
    // C-106 r2 (additive): the dev-overlay hygiene record for the sidecar.
    // Round 2: plus the debug perf readout (hidden by the same rule).
    devOverlay: { cssInjected: true, portalsHidden: devOverlaysHidden, debugHudsHidden: await countDebugHuds(page), domBackdrop },
    // Round 2: the flat-still guard's reading (stamped on evidence runs).
    worldLuma: { mean: +worldLuma.mean.toFixed(2), spread: +worldLuma.spread.toFixed(2), min: FLAT_STILL_SPREAD_MIN },
    // Wave 2 round 2 (additive): the composited Station Card and 2C overlays.
    stationCard: stationCard ? { ...stationCard.record, framePx: stationCard.layer ? { left: stationCard.layer.left, top: stationCard.layer.top, width: stationCard.layer.w, height: stationCard.layer.h } : null } : null,
    focusOverlays: overlays ? overlays.record : null,
  };
}

/**
 * Wave 2 round 2 (W1 judge: hover brackets unevidenced): --hover <subject>.
 * Moves the real pointer over the subject's projected rect (centre first,
 * then a 3 x 3 grid inside it, because the centre can land on a nearer mesh)
 * until the 2C overlay names the subject in hover mode, then waits for the
 * brackets to be drawn. The still that follows composites the brackets and
 * the label pill; the record says which point hit and what the overlay did.
 */
async function runHoverArm(page, subjectId, { settleMs = 400, perPointMs = 450 } = {}) {
  const started = Date.now();
  const rect = await page.evaluate((id) => {
    const fn = window.__routeWorldSubjects;
    if (typeof fn !== 'function') return { error: 'missing __routeWorldSubjects bridge' };
    try {
      const row = fn().rows.find((r) => r.id === id);
      if (!row) return { error: `subject "${id}" not registered` };
      if (!row.rect) return { error: `subject "${id}" has no on-screen rect` };
      return { rect: row.rect };
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  }, subjectId);
  if (rect.error) return { subject: subjectId, verdict: 'fail', reason: rect.error, waitedMs: Date.now() - started };
  // Live probe (plaza teams 1440): ledger:teams projects to y 660..900, so the
  // old 3 x 3 grid put a third of its points under the HUD band (y >= 844)
  // and the rest on the statues standing in front of it. The probe rect is
  // clipped to the viewport above the HUD, and a 5 x 5 grid (centre first)
  // gives a large, partly covered subject more chances to be hit directly.
  const hudTop = await page.evaluate(() => {
    const hud = document.querySelector('.world-nav-hud');
    const r = hud ? hud.getBoundingClientRect() : null;
    return r && r.height > 0 ? r.top : window.innerHeight;
  });
  const vp = page.viewportSize();
  const x0 = Math.max(0, rect.rect.x);
  const y0 = Math.max(0, rect.rect.y);
  const x1 = Math.min(vp?.width ?? rect.rect.x + rect.rect.w, rect.rect.x + rect.rect.w);
  const y1 = Math.min(hudTop - 2, rect.rect.y + rect.rect.h);
  if (x1 - x0 < 4 || y1 - y0 < 4) {
    return { subject: subjectId, verdict: 'fail', reason: 'subject has no hoverable area above the HUD band', subjectRect: rect.rect, hudTop, waitedMs: Date.now() - started };
  }
  const x = x0;
  const y = y0;
  const w = x1 - x0;
  const h = y1 - y0;
  const points = [[0.5, 0.5]];
  for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) if (!(fx === 0.5 && fy === 0.5)) points.push([fx, fy]);
  const readOverlay = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-focus-hover]');
      const focus = window.__routeWorldFocus;
      let hoveredId = null;
      try {
        const s = focus && typeof focus.state === 'function' ? focus.state() : null;
        hoveredId = s && typeof s.hoveredId === 'string' ? s.hoveredId : null;
      } catch {
        hoveredId = null;
      }
      return {
        mounted: Boolean(el),
        mode: el ? el.getAttribute('data-mode') : null,
        target: el ? el.getAttribute('data-target') || null : null,
        visible: el ? el.getAttribute('data-visible') === 'true' : false,
        hoveredId,
        cursor: getComputedStyle(document.body).cursor,
      };
    });
  const tried = [];
  for (const [fx, fy] of points) {
    const px = Math.round(x + w * fx);
    const py = Math.round(y + h * fy);
    await page.mouse.move(px, py, { steps: 4 });
    const until = Date.now() + perPointMs;
    let o = await readOverlay();
    while (Date.now() < until && !(o.target === subjectId && o.mode === 'hover' && o.visible)) {
      await page.waitForTimeout(80);
      o = await readOverlay();
    }
    tried.push({ x: px, y: py, hoveredId: o.hoveredId, target: o.target });
    if (o.target === subjectId && o.mode === 'hover' && o.visible) {
      await page.waitForTimeout(settleMs);
      const final = await readOverlay();
      return { subject: subjectId, verdict: final.visible && final.target === subjectId ? 'pass' : 'fail', point: { x: px, y: py }, subjectRect: rect.rect, probeRect: { x, y, w, h }, hudTop, overlay: final, tried, waitedMs: Date.now() - started };
    }
  }
  const final = await readOverlay();
  return {
    subject: subjectId,
    verdict: 'fail',
    reason: final.mounted ? 'no-hover-overlay-for-subject' : 'hover overlay not mounted ([data-focus-hover]; touch or reduced motion?)',
    subjectRect: rect.rect,
    probeRect: { x, y, w, h },
    hudTop,
    // Which subjects the grid did hit instead (a nearer subject covering it).
    hitInstead: [...new Set(tried.map((p) => p.hoveredId).filter((id) => id && id !== subjectId))],
    overlay: final,
    tried,
    waitedMs: Date.now() - started,
  };
}

/**
 * Wave 2 round 2 (W1 / TEAMS judges: the roll-call traces sampled every
 * ~4.7 s, the breathe was never captured): --burst <target>. From the landed
 * station, arm the fixed-cadence in-page sampler (armArrivalBurst: a
 * rAF-clocked canvas thumbnail + DOM/bridge read, no present pipeline per
 * sample), wait 400 ms of pre-click frames, click the target's HUD chip
 * (element.click, no pointer move), and record for `durationMs`. Writes
 * <base>-burst.json (samples + summary) and <base>-burst-strip.png. The
 * strip's thumbnails are the canvas only; the card / bracket boxes are drawn
 * by the harness as outlines from the recorded DOM rects (labelled so).
 */
async function runArrivalBurst(page, basePath, { from, target, viewport, durationMs, intervalMs = 200 }) {
  // Wave 2 r3 (TEAMS judge): an arrival at teams also records a ±40 px
  // micro-scroll window after the call, so once-per-arrival is measured.
  const microScrollOn = target === 'teams';
  const microMs = microScrollOn ? MICRO_SCROLL_HOLD_MS * 2 + MICRO_SCROLL_TAIL_MS : 0;
  await armArrivalBurst(page, { intervalMs, thumbW: 320, maxSamples: Math.ceil((durationMs + microMs + 800) / intervalMs) + 4 });
  await page.waitForTimeout(400);
  const click = await clickNavChip(page, target);
  await page.waitForTimeout(durationMs);
  let microScroll = null;
  if (microScrollOn) {
    const scrollBy = (dy) => page.evaluate((d) => { window.scrollBy(0, d); return performance.now(); }, dy);
    const fromT = await scrollBy(MICRO_SCROLL_PX);
    await page.waitForTimeout(MICRO_SCROLL_HOLD_MS);
    const backT = await scrollBy(-MICRO_SCROLL_PX);
    await page.waitForTimeout(MICRO_SCROLL_HOLD_MS + MICRO_SCROLL_TAIL_MS);
    const toT = await page.evaluate(() => performance.now());
    microScroll = { px: MICRO_SCROLL_PX, fromT: +fromT.toFixed(1), backT: +backT.toFixed(1), toT: +toT.toFixed(1) };
  }
  const dump = await dumpArrivalBurst(page);
  const summary = summarizeArrivalBurst(dump.samples, { clickT: click.ok ? click.t : null, intervalMs, target });
  const rollCall = target === 'teams' ? rollCallVerdict(dump.samples, { clickT: click.ok ? click.t : null, microScroll }) : null;
  if (rollCall && rollCall.verdict === 'fail') verdictFailures.push(`${viewport} ${from}->teams: rollCall ${rollCall.reasons.join('; ')}`);
  const thumbs = [];
  const labels = [];
  for (const s of dump.samples) {
    if (typeof s.thumbIndex !== 'number' || !dump.thumbs[s.thumbIndex]) continue;
    const jpg = Buffer.from(dump.thumbs[s.thumbIndex].slice(dump.thumbs[s.thumbIndex].indexOf(',') + 1), 'base64');
    const meta = await sharp(jpg).metadata();
    const vp = page.viewportSize();
    const k = (meta.width ?? 320) / Math.max(1, vp?.width ?? 1);
    const rects = [];
    if (s.card?.rect && s.card.opacity > 0.01) rects.push({ r: s.card.rect, color: '#4fd1c5' });
    if (s.hover?.visible && s.hover.brackets) rects.push({ r: s.hover.brackets, color: s.hover.mode === 'breathe' ? '#ffd166' : '#ffffff' });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${rects
      .map(({ r, color }) => `<rect x="${(r.x * k).toFixed(1)}" y="${(r.y * k).toFixed(1)}" width="${(r.w * k).toFixed(1)}" height="${(r.h * k).toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 2"/>`)
      .join('')}</svg>`;
    thumbs.push(await sharp(jpg).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer());
    const rel = click.ok ? Math.round(s.t - click.t) : Math.round(s.t);
    const flags = [s.settled ? 'S' : '', s.card && s.card.state === 'enter' && s.card.opacity >= 0.99 ? 'C' : '', s.hover?.mode === 'breathe' && s.hover.visible ? 'B' : '', s.canvasBlank ? 'blank' : ''].filter(Boolean).join(' ');
    labels.push(`${rel >= 0 ? '+' : ''}${rel}ms ${flags}`);
  }
  const stripPath = `${basePath}-burst-strip.png`;
  if (thumbs.length > 0) await writeStrip(thumbs, stripPath, labels);
  const jsonPath = `${basePath}-burst.json`;
  await writeJson(jsonPath, {
    from,
    target,
    viewport,
    touch: touchOn,
    click,
    summary,
    // Wave 2 r3 (TEAMS judge): the roll-call verdict (teams arrivals only) and the micro-scroll window.
    rollCall,
    microScroll,
    strip: thumbs.length > 0 ? stripPath.slice(outDir.length + 1) : null,
    rollCallFull: dump.rollCallFull ?? null,
    samples: dump.samples,
    notes: [
      'fixed-cadence rAF sampler in the page: one drawImage of the world canvas into a 320 px thumbnail plus DOM / bridge reads per tick; no FBO present, PNG encode, occlusion or luma work per sample',
      'strip labels: time relative to the chip click; S = conductor settled, C = card enter at >= 0.99 opacity, B = hover overlay in breathe mode and visible; dashed outlines are the recorded DOM rects drawn by the harness (teal = Station Card, yellow = breathe brackets, white = hover brackets), not composited DOM pixels',
      'canvasBlank = the thumbnail read found no lit pixel (the drawing buffer was cleared before the read); such a sample is not a frame of the world',
      'wave 2 r3: every sample carries window.__routeWorldRollCall() (startedAt, arrivals, columns, lights); a teams arrival is sampled every 100 ms by default (--burst-interval) so >= 8 samples fall in the 1580 ms call, then the page scrolls +40 px and back (microScroll) and rollCall asserts no re-arm and arrivals +1 once',
    ],
    invocation,
  });
  console.log(
    `capture-route: [burst] ${from}->${target} ${viewport} samples=${summary.samples} cadence median=${summary.cadence.medianMs}ms p95=${summary.cadence.p95Ms}ms pose=${summary.poseReachedAt} landed(skip-gate-clear)=${summary.landedAt} settled=${summary.settledAt} card=${summary.cardEnterAt} breathe=${summary.breathe.verdict}${summary.rollCall.stagger ? ` stagger=${summary.rollCall.stagger.firstLitAt.join('/')}ms perColumn=${summary.rollCall.stagger.perColumnMs}ms` : ''}${summary.breathe.verdict === 'seen' ? `(${summary.breathe.target} ${summary.breathe.firstAt}..${summary.breathe.lastAt})` : ''} rollCall=${summary.rollCall.source ?? 'no bridge'}${rollCall ? ` rollCallVerdict=${rollCall.verdict}${rollCall.samplesInWindow !== undefined ? `(${rollCall.samplesInWindow} samples in window, arrivals ${rollCall.arrivalsBefore}->${rollCall.arrivalsAtCall}${rollCall.microScroll ? `, micro-scroll held=${rollCall.microScroll.arrivalsHeld}` : ''})` : ''}` : ''} -> ${jsonPath}`,
  );
  return { file: jsonPath, summary, rollCall };
}

/** How long a still waits for the Station Card to reach `enter` at full opacity. */
const STATION_CARD_WAIT_MS = 3000;

/**
 * Wave 2 round 2 (W1 judge): read the Station Card and, when it is visible,
 * screenshot it for the composite. Waits up to `waitMs` for
 * `data-card-state="enter"` with an effective (ancestor-multiplied) opacity
 * >= 0.99. The record carries the element box, the content box actually
 * pasted, the kicker text, the CTA label + href, the "Read as text" href and
 * the card's data-* state (edge / direction / variant / collapsed / station).
 * The screenshot uses the HUD's path (omitBackground, animations disabled),
 * clipped to the content box, so a stretched element box (a reported defect,
 * `oversized`) is never pasted over the whole frame.
 */
async function captureStationCardLayer(page, fit, { waitMs = STATION_CARD_WAIT_MS } = {}) {
  const started = Date.now();
  const read = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-station-caption]');
      if (!el) return { present: false };
      let opacity = 1;
      let hidden = false;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden') hidden = true;
        opacity *= Number.parseFloat(s.opacity || '1');
      }
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const px = (v) => Number.parseFloat(v || '0') || 0;
      let y0 = null;
      let y1 = null;
      for (const child of el.children) {
        const c = child.getBoundingClientRect();
        if (c.width < 1 || c.height < 1) continue;
        y0 = y0 === null ? c.top : Math.min(y0, c.top);
        y1 = y1 === null ? c.bottom : Math.max(y1, c.bottom);
      }
      const top = y0 === null ? r.top : Math.max(r.top, y0 - px(style.paddingTop) - px(style.borderTopWidth));
      const bottom = y1 === null ? r.bottom : Math.min(r.bottom, y1 + px(style.paddingBottom) + px(style.borderBottomWidth));
      const cta = el.querySelector('.world-station-card-cta, [data-station-cta]');
      const lite = el.querySelector('[data-station-lite]');
      const kicker = el.querySelector('.world-station-card-kicker');
      const digest = el.querySelector('[data-station-digest]');
      const text = (node) => (node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : null);
      return {
        present: true,
        hidden,
        opacity: +opacity.toFixed(3),
        state: el.getAttribute('data-card-state'),
        station: el.getAttribute('data-station'),
        edge: el.getAttribute('data-edge'),
        direction: el.getAttribute('data-direction'),
        variant: el.getAttribute('data-variant'),
        collapsed: el.getAttribute('data-collapsed') === 'true',
        yielded: el.hasAttribute('data-yield'),
        cardRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        contentRect: { x: r.x, y: top, w: r.width, h: Math.max(0, bottom - top) },
        oversized: r.height - Math.max(0, bottom - top) > 48,
        kicker: text(kicker),
        digest: text(digest),
        digestKind: digest ? digest.getAttribute('data-station-digest') : null,
        cta: cta ? { label: text(cta), href: cta.getAttribute('href'), param: cta.getAttribute('data-station-cta') } : null,
        liteHref: lite ? lite.getAttribute('href') : null,
        railChips: el.querySelectorAll('a[href*="team="]').length,
      };
    });
  let rec = await read();
  while (Date.now() - started < waitMs && !(rec.present && rec.state === 'enter' && !rec.hidden && rec.opacity >= 0.99)) {
    await page.waitForTimeout(100);
    rec = await read();
  }
  const record = { ...rec, waitedMs: Date.now() - started };
  if (!rec.present || rec.hidden || rec.opacity <= 0.01 || rec.contentRect.w < 8 || rec.contentRect.h < 8) {
    return { record, layer: null };
  }
  const clip = { x: rec.contentRect.x, y: rec.contentRect.y, width: rec.contentRect.w, height: rec.contentRect.h };
  const png = await page.screenshot({ clip, omitBackground: true, animations: 'disabled' });
  return { record: { ...record, composite: 'content-box' }, layer: await fit(png, clip) };
}

/**
 * Wave 2 round 2 (W1 judge: discoverability unevidenced): the 2C focus
 * overlays at present time. `[data-focus-hover]` (hover brackets + label
 * pill, or the touch first-settle breathe) when `data-visible="true"`, and
 * `[data-holo-beam]` (the panel beam) when its stage is not `off`. Each
 * visible piece is pasted at its own box; the record says what was on screen.
 */
async function captureFocusOverlayLayers(page, fit) {
  const read = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    const hover = document.querySelector('[data-focus-hover]');
    const pill = hover ? hover.children[1] ?? null : null;
    const beam = document.querySelector('[data-holo-beam]');
    let beamBox = null;
    if (beam && beam.getAttribute('data-stage') !== 'off') {
      const parts = [beam.querySelector('path'), beam.querySelector('circle')].map(box).filter(Boolean);
      if (parts.length > 0) {
        const x0 = Math.min(...parts.map((p) => p.x)) - 6;
        const y0 = Math.min(...parts.map((p) => p.y)) - 6;
        const x1 = Math.max(...parts.map((p) => p.x + p.width)) + 6;
        const y1 = Math.max(...parts.map((p) => p.y + p.height)) + 6;
        beamBox = { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.min(window.innerWidth, x1) - Math.max(0, x0), height: Math.min(window.innerHeight, y1) - Math.max(0, y0) };
      }
    }
    return {
      hover: hover
        ? {
            mounted: true,
            mode: hover.getAttribute('data-mode'),
            target: hover.getAttribute('data-target') || null,
            visible: hover.getAttribute('data-visible') === 'true',
            brackets: box(hover.children[0] ?? null),
            pill: pill ? { box: box(pill), side: pill.getAttribute('data-side'), overlap: pill.getAttribute('data-overlap'), label: (pill.textContent || '').replace(/\s+/g, ' ').trim() } : null,
          }
        : { mounted: false },
      beam: beam ? { mounted: true, stage: beam.getAttribute('data-stage'), box: beamBox, d: beam.querySelector('path')?.getAttribute('d') ?? null } : { mounted: false },
    };
  });
  const layers = [];
  const pasted = [];
  const paste = async (name, clip) => {
    if (!clip || clip.width < 2 || clip.height < 2) return;
    const vp = page.viewportSize();
    const x = Math.max(0, clip.x);
    const y = Math.max(0, clip.y);
    const width = Math.min((vp?.width ?? x + clip.width) - x, clip.width - (x - clip.x));
    const height = Math.min((vp?.height ?? y + clip.height) - y, clip.height - (y - clip.y));
    if (width < 2 || height < 2) return;
    const c = { x, y, width, height };
    const png = await page.screenshot({ clip: c, omitBackground: true, animations: 'disabled' });
    layers.push(await fit(png, c));
    pasted.push(name);
  };
  if (read.hover.mounted && read.hover.visible) {
    await paste('brackets', read.hover.brackets);
    if (read.hover.pill?.box) await paste('pill', read.hover.pill.box);
  }
  if (read.beam.mounted && read.beam.box) await paste('holo-beam', read.beam.box);
  return { layers, record: { ...read, pasted } };
}

/**
 * C-021 r1: read-only pose probe. Does not stamp or hide the WebGL canvas.
 * ADR-0003 adds `focus` (id, phase, blend, orbit) and `bounds` (the focused
 * subject's world AABB) plus the requested / effective tier. C-039 adds
 * `phasePin` (additive): what the capture-mode animation-phase pin recorded at
 * present time — mode, canonical uTime/elapsedTime, whether the optional
 * page-side clock hook answered, and which rung the URL pins. C-045 r2 adds
 * `moverPin` / `frameSubscribers` inside `phasePin` (additive): whether the
 * page hook also parked node-transform movers via its synchronous advance, and
 * how many frame subscribers that advance executed (null = page pre-dates it).
 * C-039 r2 adds
 * `durationMs` / `stationMs` / `invocation` (additive): the wall-clock run
 * elapsed at sidecar write, this station's capture split, and the effective
 * invocation (resolved CLI args + navigated URL). C-045 adds `renderPath`
 * (additive): the page's render-path stamp read in the same task as the
 * present — kit vs procedural façade, batcher counts, and how long they had
 * been settled — so a still's build state is provable from the sidecar alone
 * (null when the page pre-dates the bridge). C-046 adds `hud` and
 * `presentRetries` (additive): the fitted HUD band in presented-frame px —
 * the offline --blob-count mode derives its per-frame band ceiling from this
 * stamp (PB-205: measured, never hardcoded) — and how many hydration-flake
 * reload-retries this station's present needed (0 = clean first attempt).
 * C-057 adds `kitSettle` / `assetResidency` / `materialPatch` / `ledPin`
 * (additive): the present-readiness records (kit facade + settledMs, and
 * fileMaps / frameSubscribers at present time, each with the wait duration;
 * `mode:"off"` when that wait is switched off), the --patch-material arm
 * report (per-spec matched materials / applied uniforms; null = no arm), and
 * the kiosk-LED content pin state (canonical Date.now epoch, or off).
 * C-109 r1 adds `projectInstances` / `meshHide` (additive): the attribution
 * probe records — the per-mesh instance projection scan at the landed pose
 * and the toggle arm's hide report (null when the flag is off).
 */
async function writePoseProbe(
  page,
  jsonPath,
  section,
  requestedTier,
  phasePin,
  evidence,
  renderPath,
  hud,
  presentRetries,
  captureExtras,
) {
  const probe = await page.evaluate(
    ({ sectionId, tierArg }) => {
      const read = window.__routeWorldProbe;
      const body = typeof read === 'function' ? read() : null;
      const { focus = null, ...pose } = body ?? {};
      return {
        section: sectionId,
        hook: typeof read === 'function',
        tier: {
          requested: tierArg,
          effective: document.documentElement.classList.contains('world-route-live') ? 'route' : 'lite',
        },
        ...(body
          ? pose
          : {
              smooth: null,
              exact: null,
              index: null,
              activeIndex: null,
              pin: null,
              camPos: null,
              worldPos: null,
              isDefaultPlaza: true,
            }),
        focus: focus
          ? { id: focus.id, phase: focus.phase, blend: focus.blend, orbit: focus.orbit }
          : null,
        bounds: focus ? focus.bounds : null,
      };
    },
    { sectionId: section, tierArg: requestedTier },
  );
  probe.phasePin = phasePin ?? { mode: 'off' };
  // Wave 2 r3 (TEAMS judge: "camPos [5.2, 2.55, 0.2] in every 1440 sidecar
  // looks like a placeholder"): that IS the teams endpoint — all four
  // themes author the same teams camera (themes/*/theme.ts camera.position
  // [5.2, 2.55, 0.2] -> target [13.5, 1.7, 0], fov 42). The full rendered
  // pose (live camera: position, yaw, pitch, fov, aspect) is recorded
  // beside it so a settled pose is provable, and frame differences between
  // themes are attributable to the frame, not the camera.
  probe.cameraPose = await page
    .evaluate(() => {
      const fn = window.__routeWorldCamera;
      if (typeof fn !== 'function') return null;
      try {
        const c = fn();
        const r = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(5) : null);
        return {
          source: '__routeWorldCamera (the live render camera)',
          camPos: Array.isArray(c.camPos) ? c.camPos.map(r) : null,
          yawRad: r(c.yaw),
          pitchRad: r(c.pitch),
          fov: r(c.fov),
          aspect: r(window.innerWidth / Math.max(1, window.innerHeight)),
          smooth: r(c.smooth),
          exact: r(c.exact),
          settled: typeof c.settled === 'boolean' ? c.settled : null,
          focusPhase: c.focusPhase ?? null,
        };
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    })
    .catch(() => null);
  if (probe.cameraPose && section === 'teams') {
    probe.cameraPose.note = 'teams endpoint [5.2, 2.55, 0.2] is authored identically in every theme (themes/<id>/theme.ts); an identical camPos across worlds is expected, not a stale field';
  }
  // C-045 render-path stamp (additive — see the JSDoc above).
  probe.renderPath = renderPath ?? null;
  // C-039 r2 evidence record (additive — see the JSDoc above).
  probe.durationMs = evidence.durationMs;
  probe.stationMs = evidence.stationMs;
  probe.invocation = evidence.invocation;
  // C-046 (additive — see the JSDoc above).
  probe.hud = hud ?? null;
  probe.presentRetries = presentRetries ?? 0;
  // R49 (additive): the in-page present re-acquire (held gate / post-transition payload), null when clean.
  probe.presentGateRetry = captureExtras?.presentGateRetry ?? null;
  // Fix round TOOLS-2 (additive): clean | recorded (the diagnosed held-gate
  // case) | inconclusive (any other re-acquire) — a bar must not pass on it.
  probe.presentGateRetryVerdict = presentRetryVerdict(probe.presentGateRetry);
  // C-057 (additive — see the JSDoc above).
  probe.kitSettle = captureExtras?.kitSettle ?? null;
  probe.assetResidency = captureExtras?.assetResidency ?? null;
  probe.materialPatch = captureExtras?.materialPatch ?? null;
  // C-109 r1 (additive — see the JSDoc above): the attribution probe records.
  probe.projectInstances = captureExtras?.projectInstances ?? null;
  probe.meshHide = captureExtras?.meshHide ?? null;
  probe.ledPin = captureExtras?.ledPin ?? { mode: 'off' };
  // C-106 r2 (additive): the dev-overlay hygiene record — the `nextjs-portal`
  // dev chrome was hidden via the stylesheet rule + inline hide before the
  // HUD/panel element screenshots; portalsHidden is the host count present at
  // present time (0 = none injected by that load).
  probe.devOverlay = captureExtras?.devOverlay ?? null;
  // Wave 2 round 2 (additive): the composited Station Card (rect, kicker, CTA
  // label + href, state, verdict) and the 2C focus overlays (hover brackets /
  // label pill / breathe / HoloBeam) as they were at present time, plus the
  // --hover arm's record when it ran.
  if (captureExtras?.stationCard) probe.stationCard = captureExtras.stationCard;
  if (captureExtras?.focusOverlays) probe.focusOverlays = captureExtras.focusOverlays;
  if (captureExtras?.hoverArm) probe.hoverArm = captureExtras.hoverArm;
  if (captureExtras?.paramPanel) probe.paramPanel = captureExtras.paramPanel;
  // S9 (additive, key present only with --occlusion on): the one-shot W1
  // occlusion record — raycast rows per subject/figure, the visible DOM
  // layers, their overlap with the projected subjects, and the verdict.
  if (captureExtras?.occlusion) probe.occlusion = captureExtras.occlusion;
  // Gauntlet round 1 (additive): the reveal-gate record of the load this still
  // was shot in, and the station-settle assertion that landed it.
  if (captureExtras?.revealGate) probe.revealGate = captureExtras.revealGate;
  // LOOK r3 (CLARITY judge): was this still's load a clean cold first
  // navigation, or a post-recovery page (a present reload, a reveal after an
  // abort)? Reported, never judged.
  {
    const retries = probe.presentRetries ?? 0;
    const mode = probe.revealGate?.mode ?? null;
    const reasons = [];
    if (retries > 0) reasons.push(`${retries} present reload(s): ${(captureExtras?.presentRetryReasons ?? []).join(' | ') || 'reason not recorded'}`);
    if (mode && mode !== 'revealed') reasons.push(`reveal gate mode ${mode}`);
    if (warmupRecord?.ran) reasons.push(`warm-up navigation ran first in this browser (${warmupRecord.outcome})`);
    probe.loadProvenance = {
      cleanFirstNavigation: retries === 0 && (mode === null || mode === 'revealed'),
      warmBrowser: Boolean(warmupRecord?.ran),
      presentRetries: retries,
      revealMode: mode,
      reasons,
    };
  }
  if (captureExtras?.stationSettle) probe.stationSettle = captureExtras.stationSettle;
  // Round 3 (additive): subject presence, frustum content count vs baseline,
  // the plaza station-window map and the compile guard's hold count.
  if (captureExtras?.stationContent) probe.stationContent = captureExtras.stationContent;
  // Round 4 (additive, debug sessions on the route tier): the particle
  // corridor readout at the still and its verdict.
  if (captureExtras?.particleCorridor) probe.particleCorridor = captureExtras.particleCorridor;
  // Round 2 (additive, keys present only when they apply): the W3 water
  // bridge snapshot (ripple events as numbers, not a still) and the run's
  // dev-compile warm-up record.
  const water = await readWater(page);
  if (water !== null) probe.water = water;
  // R40 (K5 / R8): every water body's surface rect on screen at this pose, for
  // scripts/gauntlet/analysis/stills.mjs --mask-water.
  if (water !== null && Array.isArray(water.bodies)) {
    const cam = await page.evaluate(readRenderCameraInPage).catch(() => null);
    probe.waterRects = waterScreenRects(water.bodies, cam);
  }
  if (warmupRecord) probe.warmup = warmupRecord;
  if (captureExtras?.worldLuma && anyEvidenceFlag(evidenceArms)) probe.worldLuma = captureExtras.worldLuma;
  // Wave 2 (2H, additive, evidence runs only): the latched settle signal (a
  // boolean the probe body already carries wins; else the landing read; else
  // 'unmeasured' — never assumed), the docked panel, the pass-through bridges,
  // and with --luma / --audit their records.
  // LOOK r2 SEAT H (additive, keys present only when they apply): the
  // pointer pin, the paint audit (--debug), the world-asset origin of this
  // load, and the --diff-against record.
  if (captureExtras?.pointerPin) probe.pointerPin = captureExtras.pointerPin;
  if (debugOn) probe.paintAudit = await readPaintAudit(page);
  // LOOK r3 SEAT H (additive, --debug): the lighting state at the still.
  if (debugOn) probe.sceneLighting = await readSceneLighting(page);
  // LOOK r4 SEAT H (additive, --debug): the IBL state at the still — the
  // environment intensity and whether three's prefiltered (PMREM) IBL holds
  // light. A black-IBL still is rejected at capture time (the run fails).
  if (debugOn) probe.iblState = iblVerdict(await readIblState(page));
  // LOOK r5 (additive, --debug): programs split active rung vs pre-warmed
  // (output colour space + tone mapping), D26 judged on the active split.
  if (debugOn) {
    probe.programSplit = await readProgramSplit(page, 'still (after the PNG was read)');
    console.log(`capture-route: [programs] ${section} ${programSplitLine(probe.programSplit)}`);
  }
  const assetOrigin = currentAssetOrigin();
  if (assetOrigin) probe.assetOrigin = assetOrigin;
  // LOOK r4 (additive, --diff-against): the data-face and figure rects at
  // this still, so every diffed still (blast worlds included, --luma or not)
  // reports a face-only and a figure-masked diff.
  if (diffAgainstTag !== null && captureExtras?.pngPath) probe.diffRects = await readDiffRects(page, section, captureExtras.pngPath);
  if (diffAgainstTag !== null && captureExtras?.pngPath) {
    try {
      probe.diffAgainst = await diffAgainstRecord(captureExtras.pngPath, jsonPath, probe);
    } catch (err) {
      probe.diffAgainst = { verdict: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    const d = probe.diffAgainst;
    console.log(
      `capture-route: [diff] ${section} vs ${d.against ?? diffAgainstTag} ${d.verdict}${d.frame ? ` changed=${d.frame.changedPct}% >8=${d.frame.overThresholdPct}% mean=${d.frame.mean} max=${d.frame.max}${d.frameMasked ? ` exFigures>8=${d.frameMasked.overThresholdPct}%/mean${d.frameMasked.mean}` : ''}` : d.reason ? ` (${d.reason})` : ''}${d.faces?.length ? ` faces=${d.faces.map((f) => `${f.id}:max${f.max}${f.inner ? `/inner>8=${f.inner.overThresholdPct}%,L${f.inner.lumaB}->${f.inner.lumaA}` : ''}`).join(',')}` : ''}${d.pose ? ` pose=${d.pose.match}${d.pose.reasons?.length ? `(${d.pose.reasons.join('; ')})` : ''}` : ''}${d.floor?.vsFloor ? ` floor=${d.floor.against} frame:${d.floor.vsFloor.frame.verdict}${d.floor.vsFloor.faces.length ? ` faces=${d.floor.vsFloor.faces.map((f) => `${f.id}:${f.verdict}`).join(',')}` : ''}` : d.floor ? ` floor=${d.floor.verdict}` : ''}${d.lighting?.match === false ? ` LIGHTING-MISMATCH(${d.lighting.differences.slice(0, 2).join('; ')})` : ''}${d.worldLuma?.verdict === 'divergent' ? ` LUMA-DIVERGENT(${d.worldLuma.a} vs ${d.worldLuma.b})` : ''}${d.floor?.baseline?.suspect ? ` FLOOR-SUSPECT(${d.floor.baseline.reasons.join('; ')})` : ''}${d.baselineFlags?.length ? ` ${d.baselineFlags.join(' ')}` : ''}${d.poseParallaxOnly ? ' POSE-PARALLAX-ONLY' : ''}${d.canonicalBaseline ? ' CANONICAL(D27)' : ''}${d.cardExcluded?.length ? ` card-masked` : ''}`,
    );
    if (Array.isArray(d.candidateRanking) && d.candidateRanking.length > 1) console.log(`capture-route: [diff] ${section} chose ${d.chosenBecause}`);
  }
  if (captureExtras?.w1) {
    const w1 = captureExtras.w1;
    const bodySettled = settledOf(probe);
    probe.settled = bodySettled ?? w1.settled;
    probe.dockedPanel = w1.dockedPanel ?? null;
    probe.bridges = w1.bridges ?? { beats: { status: 'unmeasured', reason: 'debug bridges off' }, attacks: { status: 'unmeasured', reason: 'debug bridges off' } };
    if (w1.luma) {
      probe.luma = w1.luma;
      probe.contrast = w1.contrast;
      probe.lumaInputs = w1.lumaInputs;
    }
    if (w1.drawAudit) probe.drawAudit = w1.drawAudit;
  }
  // LOOK r6 SEAT H5 (CLARITY r5: rung-2 light cells saturated at 254.88 with
  // no contrast tiles): a saturated luma cell falls back to the contrast
  // tiles, else to the inner-face diff against the --diff-against baseline.
  if (probe.luma) {
    const fallback = saturatedCellFallback({ luma: probe.luma, contrast: probe.contrast ?? null, diffAgainst: probe.diffAgainst ?? null });
    if (fallback.applies) probe.saturatedFallback = fallback;
  }
  // LOOK r6 SEAT H5: the repeat-pose contrast noise band (--contrast-repeat).
  if (captureExtras?.contrastNoise) probe.contrastNoise = captureExtras.contrastNoise;
  // LOOK r6 SEAT H8: the look probe on this still (--look-probe).
  if (r6Flags.lookProbe && captureExtras?.pngPath) {
    probe.lookProbe = await runLookProbe(page, section, captureExtras.pngPath, probe);
    console.log(`capture-route: [look-probe] ${probeLine(section, probe.lookProbe)}`);
  }
  // Round 5: keep a non-passing earlier sidecar of this name as .try<N>.json.
  const priorTry = await keepPriorTry(jsonPath);
  if (priorTry.kept) {
    probe.priorTry = { kept: priorTry.kept, n: priorTry.n };
    console.log(`capture-route: kept the earlier non-passing sidecar as ${priorTry.kept}`);
  }
  await writeFile(jsonPath, `${JSON.stringify(probe, null, 2)}\n`, 'utf8');
  console.log(
    `capture: probe ${jsonPath} hook=${probe.hook} tier=${probe.tier.effective} isDefaultPlaza=${probe.isDefaultPlaza} camPos=${JSON.stringify(probe.camPos)} focus=${probe.focus ? `${probe.focus.id}/${probe.focus.phase}` : 'none'}`,
  );
  return probe;
}

// ---------------------------------------------------------------------------
// LOOK r2 SEAT H: pointer pin, paint audit, asset origin, --diff-against
// ---------------------------------------------------------------------------

/**
 * Pointer pin (armed before navigation with the phase pin): CameraRig's
 * pointer parallax (WORLD_MOTION.pointerMaxAngle 0.052 rad) follows the REAL
 * cursor of the headed browser window, so a landed still's yaw / pitch moved
 * with wherever the OS cursor sat (round 1: +-0.05 rad on the same tree).
 * While pinned, window-level pointer / mouse events are stopped in the
 * capture phase (only the pin's own marked event passes), and one synthetic
 * pointermove at the exact viewport centre drives the parallax target to 0.
 * Released right after the present; normal browsing is untouched.
 */
function installPointerPin() {
  const w = window;
  if (w.__capturePointerPin) return;
  const MARK = '__capturePointerPinned';
  const state = { on: false, blocked: 0, pins: 0 };
  const block = (event) => {
    if (!state.on || event[MARK] === true) return;
    event.stopImmediatePropagation();
    state.blocked += 1;
  };
  for (const type of ['pointermove', 'pointerleave', 'pointerenter', 'pointerover', 'pointerout', 'mousemove']) {
    w.addEventListener(type, block, true);
  }
  w.__capturePointerPin = {
    pin: () => {
      state.on = true;
      state.pins += 1;
      const x = w.innerWidth / 2;
      const y = w.innerHeight / 2;
      const event = new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
      event[MARK] = true;
      w.dispatchEvent(event);
      return { x, y, innerWidth: w.innerWidth, innerHeight: w.innerHeight };
    },
    release: () => {
      state.on = false;
      return { blocked: state.blocked };
    },
    status: () => ({ ...state }),
  };
}

/** Pointer pin bound and the parallax residual it waits for (rad). */
const POINTER_PIN_MIN_MS = 1_200;
const POINTER_PIN_MAX_MS = 4_000;
const POINTER_PIN_RESIDUAL_RAD = 5e-5;

/**
 * Centre the (blocked) pointer and wait until the parallax has decayed: the
 * rendered yaw equals the rig's authored pathYaw within
 * POINTER_PIN_RESIDUAL_RAD, and at least POINTER_PIN_MIN_MS has passed (the
 * pitch channel decays at the same rate, 7/s). Kicks the demand loop while
 * waiting. Returns the sidecar record (converged false is recorded, never
 * silent).
 */
async function pinPointerForStill(page) {
  const started = Date.now();
  const pinned = await page.evaluate(() => (window.__capturePointerPin ? window.__capturePointerPin.pin() : null));
  if (!pinned) return { mode: 'unavailable', reason: 'pointer pin not installed' };
  let read = null;
  for (;;) {
    read = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const r3f = canvas && canvas.__r3f;
      if (r3f && typeof r3f.invalidate === 'function') r3f.invalidate(2);
      const fn = window.__routeWorldProbe;
      const p = typeof fn === 'function' ? fn() : null;
      return p ? { yaw: p.yaw, pathYaw: p.pathYaw, turnLag: p.turnLag ?? null } : null;
    });
    const residual = read && typeof read.yaw === 'number' && typeof read.pathYaw === 'number' ? Math.abs(Math.atan2(Math.sin(read.yaw - read.pathYaw), Math.cos(read.yaw - read.pathYaw))) : null;
    const waited = Date.now() - started;
    if (waited >= POINTER_PIN_MIN_MS && residual !== null && residual <= POINTER_PIN_RESIDUAL_RAD) {
      return { mode: 'centered', converged: true, waitedMs: waited, residualRad: +residual.toExponential(2), at: { x: pinned.x, y: pinned.y } };
    }
    if (waited >= POINTER_PIN_MAX_MS) {
      return { mode: 'centered', converged: false, waitedMs: waited, residualRad: residual === null ? null : +residual.toExponential(2), turnLag: read?.turnLag ?? null, at: { x: pinned.x, y: pinned.y } };
    }
    await page.waitForTimeout(100);
  }
}

async function releasePointerPin(page) {
  return page.evaluate(() => (window.__capturePointerPin ? window.__capturePointerPin.release() : null)).catch(() => null);
}

/**
 * --debug: window.__paintAudit (SEAT L's PaintAudit getter: unpatched /
 * exempt / patched / programs / scopeLeaks) at this moment. 'absent' = no
 * painted world mounted it (sakura / mountain / clouds, or debug off).
 */
async function readPaintAudit(page) {
  return page
    .evaluate(() => {
      try {
        if (!('__paintAudit' in window)) return { status: 'absent', note: 'window.__paintAudit not installed (no PaintAudit in this world, or debug off)' };
        const a = window.__paintAudit;
        return a && typeof a === 'object' ? { status: 'read', ...a } : { status: 'unreadable' };
      } catch (err) {
        return { status: 'error', error: String((err && err.message) || err) };
      }
    })
    .catch((err) => ({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
}

/**
 * LOOK r3 SEAT H: the scene's lighting state at the still (read-only, via the
 * debug-gated __routeWorldScene handle): document theme, IBL presence / size /
 * intensity / yaw, the visible lights (type, colour, intensity), fog and
 * background. --diff-against compares it between the two stills
 * (sceneLightingMatch), so a black-IBL or wrong-theme baseline is named
 * instead of read as a render change or as noise.
 */
async function readSceneLighting(page) {
  return page
    .evaluate(() => {
      const theme = document.documentElement.dataset.theme ?? null;
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') return { available: false, theme, reason: 'missing-scene-handle' };
      const scene = sceneRead();
      if (!scene) return { available: false, theme, reason: 'no-scene' };
      const r4 = (n) => (typeof n === 'number' && Number.isFinite(n) ? +n.toFixed(4) : null);
      const env = scene.environment ?? null;
      const lights = [];
      scene.traverseVisible((o) => {
        // ENGINE-FIX A2: the route canvas's dark point-light pads (intensity 0,
        // skipped by the lit shaders) keep the program keys stable across a
        // palette swap — they are not lighting.
        if (o && o.isLight && o.name === 'route-point-light-pad') return;
        if (o && o.isLight) lights.push({ type: o.type, color: o.color && typeof o.color.getHexString === 'function' ? `#${o.color.getHexString()}` : null, intensity: r4(o.intensity) });
      });
      const fog = scene.fog ? { color: scene.fog.color ? `#${scene.fog.color.getHexString()}` : null, density: r4(scene.fog.density), near: r4(scene.fog.near), far: r4(scene.fog.far) } : null;
      const bg = scene.background;
      return {
        available: true,
        theme,
        environment: {
          present: env !== null,
          cubeUv: env ? env.isRenderTargetTexture === true : null,
          imageHeight: env && env.image && typeof env.image.height === 'number' ? env.image.height : null,
          intensity: r4(scene.environmentIntensity),
          rotationY: r4(scene.environmentRotation ? scene.environmentRotation.y : null),
        },
        lights,
        fog,
        background: bg == null ? 'none' : bg.isColor ? `#${bg.getHexString()}` : bg.isTexture ? 'texture' : String(bg),
      };
    })
    .catch((err) => ({ available: false, reason: err instanceof Error ? err.message : String(err) }));
}

/**
 * LOOK r4 SEAT H: the IBL state at the still, read-only. The black-IBL race
 * (a PMREM prefilter drawn while the canvas's draw hold skipped every render)
 * leaves scene.environment present and cube-UV, so sceneLighting cannot see
 * it; this reads the PREFILTERED texture itself: the renderer (via the
 * scene's R3F root), the PMREM texture three bound for a lit material
 * (properties.get(material).envMap), and a 16x16 block at the centre of each
 * of the six LOD-0 faces of its render target, with raw readPixels on the
 * existing framebuffer (no program link, no upload; the prior READ binding
 * is restored). Samples are linear HDR radiance.
 */
/**
 * LOOK r5 (CAR r4: program counts disagree by measurement point; the
 * active-rung split was AD self-report): renderer programs split by output
 * colour space and tone mapping at `where`, active rung vs pre-warmed
 * other-rung variants, with the D26 verdict on the active split (judged at
 * rung 0). Needs the debug scene handle. Never throws.
 */
async function readProgramSplit(page, where) {
  try {
    const inv = await readProgramInventory(page);
    if (!inv.ok) return { at: where, verdict: 'unmeasured', reason: inv.reason };
    const rung = await readQuietRung(page);
    return { at: where, ...programSplit(inv.programs, { theme: expectedTheme, rung: rung.rung }), rungSource: rung.source, rungPinned: rung.pinned ?? null, sampledFrames: inv.frames };
  } catch (err) {
    return { at: where, verdict: 'unmeasured', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function readIblState(page) {
  return page
    .evaluate(() => {
      const sceneRead = window.__routeWorldScene;
      if (typeof sceneRead !== 'function') return { available: false, reason: 'missing-scene-handle' };
      const scene = sceneRead();
      if (!scene) return { available: false, reason: 'no-scene' };
      const envIntensity = typeof scene.environmentIntensity === 'number' ? +scene.environmentIntensity.toFixed(4) : null;
      const environment = scene.environment ?? null;
      let gl = null;
      const rootOf = (o) => (o && o.__r3f && o.__r3f.root && typeof o.__r3f.root.getState === 'function' ? o.__r3f.root.getState().gl : null);
      gl = rootOf(scene);
      if (!gl) {
        scene.traverse((o) => {
          if (!gl) gl = rootOf(o);
        });
      }
      const base = { available: true, envIntensity, environmentPresent: environment !== null, environmentType: environment ? (environment.isRenderTargetTexture ? 'render-target' : 'texture') : null };
      if (!environment) return { ...base, pmrem: { status: 'no-environment' } };
      if (!gl || !gl.properties || typeof gl.getContext !== 'function') return { ...base, pmrem: { status: 'no-renderer', reason: 'no R3F root on the scene or its children' } };
      let pmrem = null;
      let boundBy = null;
      scene.traverse((o) => {
        if (pmrem) return;
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) || m.envMap) continue;
          const props = gl.properties.get(m);
          const t = props && props.envMap;
          if (t && t.renderTarget && t.mapping === 306) {
            pmrem = t;
            boundBy = `${m.type}${m.name ? `:${m.name}` : ''}`;
            return;
          }
        }
      });
      if (!pmrem) return { ...base, pmrem: { status: 'unbound', reason: 'no lit material has a cube-UV (PMREM) envMap bound yet' } };
      const rt = pmrem.renderTarget;
      const fb = gl.properties.get(rt).__webglFramebuffer;
      if (!fb || Array.isArray(fb)) return { ...base, pmrem: { status: 'unreadable', reason: 'no single framebuffer on the PMREM target' } };
      const ctx = gl.getContext();
      const cube = Math.floor(rt.height / 4);
      const n = Math.min(16, cube);
      const prev = ctx.getParameter(ctx.READ_FRAMEBUFFER_BINDING);
      const faces = [];
      let readType = null;
      let error = null;
      try {
        ctx.bindFramebuffer(ctx.READ_FRAMEBUFFER, fb);
        readType = ctx.getParameter(ctx.IMPLEMENTATION_COLOR_READ_TYPE);
        const useFloat = readType !== ctx.HALF_FLOAT && readType !== ctx.UNSIGNED_BYTE;
        const half = (h) => {
          const e = (h >> 10) & 0x1f;
          const f = h & 0x3ff;
          const v = e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15);
          return h & 0x8000 ? -v : v;
        };
        for (let i = 0; i < 6; i += 1) {
          const x = (i % 3) * cube + Math.floor((cube - n) / 2);
          const y = (i > 2 ? cube : 0) + Math.floor((cube - n) / 2);
          let vals;
          if (useFloat) {
            const buf = new Float32Array(n * n * 4);
            ctx.readPixels(x, y, n, n, ctx.RGBA, ctx.FLOAT, buf);
            vals = buf;
          } else if (readType === ctx.HALF_FLOAT) {
            const buf = new Uint16Array(n * n * 4);
            ctx.readPixels(x, y, n, n, ctx.RGBA, ctx.HALF_FLOAT, buf);
            vals = Array.from(buf, half);
          } else {
            const buf = new Uint8Array(n * n * 4);
            ctx.readPixels(x, y, n, n, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
            vals = Array.from(buf, (b) => b / 255);
          }
          let sum = 0;
          let max = 0;
          for (let k = 0; k < n * n; k += 1) {
            const lum = 0.2126 * vals[k * 4] + 0.7152 * vals[k * 4 + 1] + 0.0722 * vals[k * 4 + 2];
            if (Number.isFinite(lum)) {
              sum += lum;
              if (lum > max) max = lum;
            }
          }
          faces.push({ face: i, mean: +(sum / (n * n)).toPrecision(4), max: +max.toPrecision(4) });
        }
        const e = ctx.getError();
        if (e !== ctx.NO_ERROR) error = `gl error 0x${e.toString(16)}`;
      } catch (err) {
        error = String((err && err.message) || err);
      } finally {
        ctx.bindFramebuffer(ctx.READ_FRAMEBUFFER, prev);
      }
      return {
        ...base,
        pmrem: {
          status: error ? 'unreadable' : 'read',
          ...(error ? { reason: error } : {}),
          boundBy,
          cubeSize: cube,
          target: { width: rt.width, height: rt.height },
          sample: `${n}x${n} at each LOD-0 face centre`,
          readType: readType === null ? null : `0x${readType.toString(16)}`,
          faces,
          meanRadiance: faces.length ? +(faces.reduce((a, f) => a + f.mean, 0) / faces.length).toPrecision(4) : null,
          maxRadiance: faces.length ? +Math.max(...faces.map((f) => f.max)).toPrecision(4) : null,
        },
      };
    })
    .catch((err) => ({ available: false, reason: err instanceof Error ? err.message : String(err) }));
}

/** The captured page's world-asset request log (set per page in the main loop). */
let activeAssetLog = null;
/** DATA-PLAN fix 1: the first bucket-guard failure; sticky, so a caught throw still fails the run. */
let bucketGuardFailure = null;
function currentAssetOrigin() {
  if (!activeAssetLog) return null;
  const summary = { ...assetOriginSummary(activeAssetLog.requests, activeAssetLog.origin), scope: 'this page load (navigation -> sidecar write)' };
  // A load that reached the bucket throws (the run fails, exit 1) unless --allow-bucket.
  try {
    return { ...summary, bucketGuard: assertNoBucketEgress(summary, { allowBucket: allowBucketOn }) };
  } catch (err) {
    bucketGuardFailure ??= err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/**
 * LOOK r4: the rects --diff-against judges by, read at the still's pose even
 * without --luma: the station's data faces (the same activeFaceRects the luma
 * arm uses) and the visible figure rects (__routeWorldFigures, debug). CSS
 * px; frame.scale maps them onto the PNG. Never throws.
 */
async function readDiffRects(page, section, pngPath) {
  try {
    const ctx = await readLumaContext(page);
    const meta = await sharp(pngPath).metadata();
    const scale = (meta.width ?? ctx.viewport.width) / Math.max(1, ctx.viewport.width);
    const r1 = (n) => +Number(n).toFixed(1);
    return {
      frame: { width: meta.width ?? null, height: meta.height ?? null, scale: +scale.toFixed(4) },
      faces: activeFaceRects(ctx.subjects, section).map((f) => ({ id: f.id, x: r1(f.x), y: r1(f.y), w: r1(f.w), h: r1(f.h), onScreenFraction: f.onScreenFraction })),
      figures: ctx.figureRows.filter((f) => f.w > 0 && f.h > 0).map((f) => ({ id: f.id ?? null, x: r1(f.x), y: r1(f.y), w: r1(f.w), h: r1(f.h) })),
      subjectsRead: ctx.subjects !== null,
      notes: ['faces = the station data faces on screen (CSS px); figures = visible figure rects (debug __routeWorldFigures), masked (padded) out of diffAgainst.frameMasked'],
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), faces: [], figures: [] };
  }
}

/**
 * --diff-against <tag>: the per-pixel diff of this still against the same
 * pose (<tag>-<same suffix>.png): whole frame with the HUD band left out,
 * plus each data face (--luma rects of either sidecar). A pose mismatch
 * (camPos / yaw / pitch beyond POSE_TOLERANCE) is recorded beside it: the
 * diff is then framing noise, not a render change.
 */
async function diffAgainstRecord(pngPath, jsonPath, probe) {
  const base = jsonPath.slice(outDir.length + 1).replace(/\\/g, '/');
  if (!base.startsWith(`${tag}-`)) return { verdict: 'unmeasured', reason: `sidecar name ${base} does not start with the run tag` };
  const suffix = base.slice(tag.length + 1).replace(/\.json$/, '');
  // LOOK r3: every candidate baseline (the --diff-against comma list) is
  // looked up; the first that exists with a matching pose is diffed.
  const lookup = async (candidateTag, reference) => {
    const png = resolve(outDir, `${candidateTag}-${suffix}.png`);
    let exists = true;
    try {
      await stat(png);
    } catch {
      exists = false;
    }
    const sidecar = exists ? await readStillSidecar(resolve(outDir, `${candidateTag}-${suffix}.json`)) : null;
    const pose = !exists ? null : sidecar ? poseMatch(reference, sidecar) : { match: null, reason: 'no sidecar beside the other still' };
    return { tag: candidateTag, png, file: png.slice(outDir.length + 1), exists, sidecar, pose, pointerPinned: sidecar?.pointerPin ? sidecar.pointerPin.converged === true : null };
  };
  const candidates = [];
  for (const t of diffAgainstTags) candidates.push(await lookup(t, probe));
  const listed = candidates.map((c) => ({ file: c.file, exists: c.exists, poseMatch: c.pose ? c.pose.match : null, pointerPinned: c.pointerPinned }));
  // LOOK r4: ranked by pose, then world-luma agreement with this still (a
  // black-IBL -retry baseline is passed over when a lit one exists).
  // LOOK r6 SEAT H3 (D27): the world's canonical baseline (sakura:
  // fid-w2c-r2-sakura-light) ranks first inside its pose tier.
  const world = probe.stationContent?.world ?? worldId ?? 'plaza';
  const choice = pickDiffCandidate(candidates, { referenceLuma: probe.worldLuma ?? null, prefer: canonicalBaselinesFor(world) });
  const { pick, poseValid } = choice;
  if (!pick) return { against: candidates[0]?.file ?? null, verdict: 'unmeasured', reason: 'no still of that name', candidates: listed };
  const other = pick.sidecar;
  const pose = pick.pose;
  const otherPng = pick.png;
  // LOOK r6 SEAT H3 (CLARITY r5: the sakura residual was "the DOM card copy"):
  // the Station Card of either still is DOM chrome, left out like the HUD band.
  const cardRects = [...stationCardMaskOf(probe), ...stationCardMaskOf(other)];
  const hud = [...(probe.hud && typeof probe.hud.top === 'number' ? [{ x: 0, y: probe.hud.top, w: 1e6, h: 1e6 }] : []), ...cardRects];
  const regions = faceRegionsOf(probe).length ? faceRegionsOf(probe) : faceRegionsOf(other);
  // LOOK r4: figure rects of BOTH stills are masked for frameMasked.
  const maskRects = [...figureMaskOf(probe), ...figureMaskOf(other)];
  const diff = await diffStillFiles(pngPath, otherPng, { exclude: hud, regions, maskRects });
  // LOOK r3 --diff-floor: before vs before (a second baseline at the pose of
  // the picked one) — the noise floor a "pixel-identical" face claim is
  // judged against ("at or below the floor").
  let floor = null;
  if (diffFloorTags.length && other) {
    const floorCandidates = [];
    for (const t of diffFloorTags) if (t !== pick.tag) floorCandidates.push(await lookup(t, other));
    const f = pickDiffCandidate(floorCandidates, { referenceLuma: other.worldLuma ?? null });
    if (!f.pick) floor = { verdict: 'unmeasured', reason: 'no floor still of that name', candidates: floorCandidates.map((c) => c.file) };
    else {
      const fd = await diffStillFiles(otherPng, f.pick.png, { exclude: hud, regions, maskRects: [...maskRects, ...figureMaskOf(f.pick.sidecar)] });
      // LOOK r3: a floor pair whose pose, lighting state or world luma differs
      // is not a noise floor (r2: a black-IBL -retry baseline read as "noise").
      const floorBaseline = baselineSuspicion({
        pose: f.pick.pose,
        lighting: sceneLightingMatch(other.sceneLighting, f.pick.sidecar?.sceneLighting),
        luma: worldLumaConsistency(other.worldLuma, f.pick.sidecar?.worldLuma),
      });
      floor = {
        against: f.pick.file,
        poseValid: f.poseValid,
        chosenBecause: f.why,
        pose: f.pick.pose,
        baseline: floorBaseline,
        frame: fd.frame,
        ...(fd.frameMasked ? { frameMasked: fd.frameMasked } : {}),
        faces: fd.regions,
        vsFloor: {
          frame: compareToFloor(diff.frame, fd.frame),
          ...(diff.frameMasked && fd.frameMasked ? { frameMasked: compareToFloor(diff.frameMasked, fd.frameMasked) } : {}),
          faces: diff.regions.map((r) => ({ id: r.id, ...compareToFloor(r, fd.regions.find((x) => x.id === r.id) ?? null) })),
        },
      };
    }
  }
  return {
    against: otherPng.slice(outDir.length + 1),
    // LOOK r3: a pose mismatch is its own verdict — the diff is framing
    // noise and never a render claim.
    verdict: diff.frame.comparable === false ? 'incomparable' : poseValid === false ? 'pose-mismatch' : 'measured',
    poseValid,
    candidates: listed,
    // LOOK r4: which candidate was diffed and why (pose first, then world luma).
    chosenBecause: choice.why,
    candidateRanking: choice.ranking,
    lumaDivergentBaseline: choice.lumaDivergent === true,
    // LOOK r6 SEAT H3: the D27 canonical pick, the IBL flags of the picked
    // before (BASELINE-IBL-UNKNOWN = it predates the iblState read) and the
    // Station Card rects left out of the whole-frame figures.
    world,
    canonicalBaseline: choice.canonical,
    ...(poseValid === 'parallax' ? { poseParallaxOnly: true } : {}),
    baselineFlags: baselineIblFlags(other),
    cardExcluded: cardRects,
    pose,
    // LOOK r3 (additive): the lighting state and world luma of the two
    // stills. In a blast-radius world (engine changes must be visually
    // neutral) a lighting mismatch explains the diff before any render claim.
    lighting: sceneLightingMatch(probe.sceneLighting, other?.sceneLighting),
    worldLuma: worldLumaConsistency(probe.worldLuma, other?.worldLuma),
    frame: diff.frame,
    ...(diff.frameMasked ? { frameMasked: diff.frameMasked } : {}),
    faces: diff.regions,
    identical: diff.frame.comparable !== false && diff.frame.max === 0,
    ...(floor ? { floor } : {}),
    notes: [
      'per-pixel delta = max |R|,|G|,|B| difference on the final PNGs; changedPct = share of pixels with any change; overThresholdPct = share above threshold (8 levels); mean / max over the judged pixels; the HUD band (sidecar hud.top and below) is left out of the whole-frame figure',
      'faces = the same diff inside each data-face rect (--luma inputs of this still, else of the other); a data face must be pixel-identical to its before still',
      'pose: a mismatch beyond the tolerance makes the diff framing noise, not a render change',
      'LOOK r4: faces[].inner = the same diff on the face rect inset 25% per side (copy without bezel / frame) with the mean luma of both stills; frameMasked = the whole frame with the figure rects of both stills (padded) also left out, so figure-animation pixels are a measured exclusion; candidates are ranked by pose, then world-luma agreement (chosenBecause)',
      'LOOK r6: a world canonical baseline (D27: sakura fid-w2c-r2-sakura-light) ranks first in its pose tier, and one at the same camera position whose angles differ only by the pre-pin pointer parallax (poseParallaxOnly) ranks above a pose-matched luma-divergent / black-IBL before; the Station Card rects (cardExcluded) are left out of frame / frameMasked like the HUD band; baselineFlags BASELINE-IBL-UNKNOWN marks a before without iblState',
    ],
  };
}

// ---------------------------------------------------------------------------
// Wave 2 (seat 2H INF): --luma / --audit
// ---------------------------------------------------------------------------
const DRAW_LEDGER_PATH = resolve(repoRoot, 'gauntlet', 'fidelity', 'DRAW-LEDGER.md');

/**
 * --luma on: analyse the FINAL PNG just written for this still (world FBO +
 * HUD + docked panel) against the page's own rects at the same pose. The
 * HUD band is the fitted frame-px box the present stamped; the other DOM
 * chrome, the active face and the figure rects are viewport CSS px, scaled
 * by the frame / viewport width ratio.
 */
/** LOOK r3: the outer tile ring of each face AABB is reported, never judged (faceContrast insetTiles). */
const CONTRAST_INSET_TILES = 1;

async function runLumaArm(page, pngPath, section, presented) {
  const ctx = await readLumaContext(page);
  // DOM chrome: the visible layers above the world (HUD, docked panel,
  // Station Card, a painting ball), the same read as --occlusion's.
  ctx.chrome = (await readDomLayers(page, DOM_LAYER_SELECTORS)).map((l) => ({ layer: l.layer, ...l.rect }));
  const { data, info } = await sharp(pngPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { data, width: info.width, height: info.height, channels: info.channels };
  const scale = info.width / Math.max(1, ctx.viewport.width);
  const faces = activeFaceRects(ctx.subjects, section);
  const disc =
    ctx.sunPos && ctx.camera && typeof ctx.camera.fov === 'number'
      ? skyDiscRect({ sunPos: ctx.sunPos, camPos: ctx.camera.camPos, yaw: ctx.camera.yaw, pitch: ctx.camera.pitch, fovDeg: ctx.camera.fov, width: ctx.viewport.width, height: ctx.viewport.height })
      : null;
  const hud = presented?.hud ?? null;
  const frameRects = hud && typeof hud.top === 'number' ? [{ x: hud.left ?? 0, y: hud.top, w: hud.width ?? info.width, h: hud.height ?? info.height - hud.top }] : [];
  const mask = buildLumaMask({
    width: info.width,
    height: info.height,
    scale,
    faceRects: faces,
    excludeRects: ctx.chrome,
    frameRects,
    excludeDiscs: disc ? [disc] : [],
    figureRects: ctx.figureRows,
  });
  const luma = lumaVerdict(raw, mask, { scale, figureRects: ctx.figureRows });
  // LOOK r3 (CLARITY judge): judge the interior tiles only (the outer ring of
  // the face AABB is bezel / frame / cobble); the whole-AABB numbers ride
  // along as `aabb` so r2 contrast records stay comparable.
  const perFace = faces.map((face) => {
    const whole = faceContrast(raw, face, { scale, mask });
    return {
      id: face.id,
      ...faceContrast(raw, face, { scale, mask, insetTiles: CONTRAST_INSET_TILES }),
      aabb: { verdict: whole.verdict, minContrast: whole.minContrast ?? null, medianContrast: whole.medianContrast ?? null, textTiles: whole.textTiles, worstTileCss: whole.worstTile?.css ?? null },
    };
  });
  const judged = perFace.filter((f) => f.verdict !== 'unmeasured');
  const worst = judged.reduce((a, b) => (a === null || b.minContrast < a.minContrast ? b : a), null);
  const contrast = worst
    ? { verdict: worst.verdict, minContrast: worst.minContrast, face: worst.id, faces: perFace, notes: ['glyph-classified tiles on the final PNG (wave 2 r3): only tiles whose ink is thin, compact glyph strokes are judged — seams / scanlines, crossing spans (diagonals, bezel corners) and thick blobs are excluded and counted per face in excludedTiles; ground = the non-ink median, ink = the glyph stroke core; WCAG ratio', `LOOK r3: the outer ${CONTRAST_INSET_TILES} tile ring of each face AABB is never judged (faces[].edge reports it; faces[].aabb = the pre-r3 whole-AABB numbers for comparison with r2 records)`] }
    : { verdict: 'unmeasured', reason: faces.length === 0 ? 'no active data face on screen' : 'no text-bearing tile on any active face', faces: perFace };
  return {
    luma,
    contrast,
    inputs: {
      png: pngPath.slice(outDir.length + 1),
      frame: { width: info.width, height: info.height, scale: +scale.toFixed(4) },
      faces: faces.map((f) => ({ id: f.id, x: +f.x.toFixed(1), y: +f.y.toFixed(1), w: +f.w.toFixed(1), h: +f.h.toFixed(1), onScreenFraction: f.onScreenFraction })),
      excluded: {
        hudFramePx: frameRects[0] ?? null,
        chrome: ctx.chrome.map((c) => ({ layer: c.layer, x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +c.w.toFixed(1), h: +c.h.toFixed(1) })),
        skyDisc: disc ? { x: +disc.x.toFixed(1), y: +disc.y.toFixed(1), r: +disc.r.toFixed(1), maskDeg: SKY_DISC_MASK_DEG, source: ctx.sunSource } : { none: ctx.sunPos ? 'behind the camera' : 'no uSunPos uniform in the scene' },
      },
      figures: ctx.figureRows.length,
      notes: [
        'luma = Rec.709 weights on the gamma-encoded PNG (0..255); the face is the station subject rect (a projected AABB: corners may include background, so activeFaceP99 is slightly generous)',
        'hotspots = connected grid cells whose outside/figure pixels exceed activeFaceP99; `figures` names overlapping figure rects (wave-2 exemption until the wave-3 metal clamp)',
      ],
    },
  };
}

/**
 * LOOK r6 SEAT H5 --contrast-repeat: present the same pose a second time in
 * the same load (<still>-repeat.png, same pins), re-read the contrast, and
 * report per face the |delta| of the minimum / median contrast (the noise
 * band a later before -> after dip is judged against) plus the inner-face
 * (25 % inset) luma of both presents. Never throws.
 */
async function runContrastRepeat(page, pngPath, section, phasePinArg, first) {
  const repeatPath = pngPath.replace(/\.png$/i, '-repeat.png');
  try {
    let pin = null;
    let second;
    try {
      pin = pointerPinOn ? await pinPointerForStill(page) : null;
      second = await writePresentedPng(page, repeatPath, phasePinArg, materialPatchSpecs, hideMeshNames);
    } finally {
      if (pin) await releasePointerPin(page);
    }
    // Fix round TOOLS-1: the repeat present's re-acquire (if any) rides on
    // the contrastNoise record — the noise band is never a silent retry.
    const presentGateRetry = second?.presentRetry ?? null;
    const again = await runLumaArm(page, repeatPath, section, second);
    const band = contrastRepeatBand(first.contrast, again.contrast);
    const scale = first.inputs?.frame?.scale ?? 1;
    const faces = (first.inputs?.faces ?? []).map((f) => ({ id: f.id, x: f.x * scale, y: f.y * scale, w: f.w * scale, h: f.h * scale }));
    const [imgA, imgB] = await Promise.all([rawImage(pngPath), rawImage(repeatPath)]);
    const inner = imgA.width === imgB.width && imgA.height === imgB.height ? innerFaceRepeat(imgA, imgB, faces) : [{ id: 'all', verdict: 'unmeasured', reason: 'the repeat present has another size' }];
    return {
      verdict: band.verdict,
      repeatPng: repeatPath.slice(outDir.length + 1),
      band,
      inner,
      lumaRepeat: { activeFaceP99: again.luma?.activeFaceP99 ?? null, outsideP995ExFigures: again.luma?.outsideP995ExFigures ?? null, verdict: again.luma?.verdict ?? null },
      presentGateRetry,
      presentGateRetryVerdict: presentRetryVerdict(presentGateRetry),
      notes: [
        ...(presentGateRetry
          ? [`fix round TOOLS-1: the repeat present was re-acquired once (${presentGateRetry.reason}, waited ${presentGateRetry.wait?.waitedMs ?? 'n/a'} ms) — presentGateRetry; the band compares A with a later B`]
          : []),
        'the same pose presented twice in one load (same phase / pointer pins); band = max(|minContrast A - B|, floor) per face: a before -> after contrast dip within the band is noise (look-r6-evidence labelContrastDelta)',
        'inner = Rec.709 luma mean / std of the face rect inset 25 % per side on both presents (face-internal pixels only)',
      ],
    };
  } catch (err) {
    // Fix round TOOLS-1: a failed repeat present that had re-acquired keeps its record (same schema as success).
    const presentGateRetry = err?.presentRetry ?? null;
    return {
      verdict: 'unmeasured',
      reason: err instanceof Error ? err.message : String(err),
      presentGateRetry,
      presentGateRetryVerdict: presentRetryVerdict(presentGateRetry),
    };
  }
}

/**
 * LOOK r6 SEAT H8 --look-probe: the R6-BRIEF §6 target-frame metrics on the
 * final PNG (scripts/lib/look-probe.mjs), with the station's data faces,
 * the figure rects, the DOM chrome, the HUD band and the Station Card
 * masked. Reported, never judged. Never throws.
 */
async function runLookProbe(page, section, pngPath, probe) {
  try {
    const img = await rawImage(pngPath);
    const rects = probe.diffRects ?? (await readDiffRects(page, section, pngPath));
    const lumaFaces = Array.isArray(probe.lumaInputs?.faces) && probe.lumaInputs.faces.length ? probe.lumaInputs.faces : null;
    const scale = probe.lumaInputs?.frame?.scale ?? rects.frame?.scale ?? 1;
    const chrome = (await readDomLayers(page, DOM_LAYER_SELECTORS)).map((l) => ({ layer: l.layer, ...l.rect }));
    const frameRects = [...(probe.hud && typeof probe.hud.top === 'number' ? [{ x: 0, y: probe.hud.top, w: 1e6, h: 1e6 }] : []), ...stationCardMaskOf(probe)];
    return lookProbe(img, {
      pose: probe.cameraPose,
      viewport: { width: img.width / scale, height: img.height / scale },
      scale,
      faceRects: lumaFaces ?? rects.faces ?? [],
      figureRects: rects.figures ?? [],
      excludeRects: chrome,
      frameRects,
      station: section,
      theme: expectedTheme,
    });
  } catch (err) {
    return { verdict: 'unmeasured', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** --audit on: one DRAW-LEDGER.md row per landed station (file created with its header if missing). */
async function appendDrawLedger({ section, viewport, audit }) {
  let exists = true;
  try {
    await stat(DRAW_LEDGER_PATH);
  } catch {
    exists = false;
  }
  if (!exists) {
    await mkdir(dirname(DRAW_LEDGER_PATH), { recursive: true });
    await writeFile(DRAW_LEDGER_PATH, `# Draw ledger\n\n${DRAW_LEDGER_ROWS_MARKER}\n\n${DRAW_LEDGER_HEADER.join('\n')}\n`, 'utf8');
  }
  const row = drawLedgerRow({
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tag,
    world: worldId ?? 'plaza',
    theme,
    station: section,
    viewport,
    rung: qualityRaw === 'auto' ? `auto${phasePinRung !== null ? `→${phasePinRung}` : ''}` : qualityRaw,
    audit,
    sourceStamp: invocation.sourceStamp?.newestSrcMtime ?? null,
  });
  await appendFile(DRAW_LEDGER_PATH, `${row}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Capture pass
// ---------------------------------------------------------------------------
/**
 * Land one station exactly as the pre-present sequence requires: anchor
 * scroll, endpoint hold (seek for non-pins), camera settle, pose stability,
 * focus (ADR-0003), theme read-back. Extracted (C-046) unchanged from the
 * inline sequence so the bounded hydration-flake retry can re-land a station
 * after a reload with the identical landing path. Returns the applied
 * data-theme (already checked against the pinned theme).
 */
async function prepareStation(page, section) {
  // Scroll the section anchor into view; missing anchor is a hard failure.
  await page.evaluate(
    (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`section element #${id} not found on ${location.pathname}${location.search}`);
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
    },
    section,
  );
  await waitForEndpointHold(page, section);
  await page.waitForTimeout(CAMERA_SETTLE_MS); // camera damping settle
  await waitForSettledPose(page);

  if (focusId) {
    await focusSubject(page, focusId);
    await waitForSettledPose(page);
  }

  // data-theme read back per file; a mismatch fails the run.
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (applied !== expectedTheme) {
    throw new Error(`theme mismatch: pinned localStorage theme="${expectedTheme}"${expectedTheme !== theme ? ` (harness toggle from ${theme})` : ''} but document data-theme="${applied}"`);
  }
  return applied;
}

/**
 * Gauntlet round 1 reveal gate. Runs after every page load (first load and
 * each hydration-flake reload) and BEFORE any station seek, still, sweep or
 * frame trace. With --tier lite it is skipped (no route, no ceremony).
 * Otherwise it polls html.world-route-live and the [data-ball-loader]
 * data-ball-phase until the route is live AND the ball is done / hidden (or no
 * loader is mounted — the route-preview probe world has none), bounded by
 * REVEAL_GATE_WAIT_MS:
 *  - revealed                        -> { mode: 'revealed', ... }
 *  - ball aborted, route never live  -> forced --tier route: FAIL
 *    (reveal-gate-aborted); --tier auto: { mode: 'lite' } and the run proceeds
 *    exactly as before (a Lite landing has no present hook — the existing
 *    present path fails it honestly)
 *  - bound reached, route live       -> FAIL (reveal-gate-timeout: the ball
 *    never finished — a still would be shot under the ceremony)
 *  - bound reached, route never live -> --tier route: FAIL
 *    (reveal-gate-timeout); --tier auto: { mode: 'lite' }
 */
async function waitForRevealGate(page) {
  if (tier === 'lite') return { mode: 'skipped-lite-tier' };
  const started = Date.now();
  let read = null;
  let state = 'waiting';
  // Round 2: every ball phase the gate saw (a gate that only ever saw
  // `hidden` never observed a ceremony — W3 round 1 accepted that silently),
  // and when an abort was first seen.
  const phasesSeen = [];
  let abortSeenAtPage = null;
  // Round 2 (lead): the read that first showed the abort, kept beside the
  // final read so the gate record carries BOTH.
  let abortRead = null;
  // The gate bound grows with a relaxed debug deadline (--relax-deadline).
  const gateWaitMs = Math.max(REVEAL_GATE_WAIT_MS, (evidenceArms.relaxDeadlineMs ?? 0) + 20_000);
  for (;;) {
    read = await page.evaluate(() => {
      const ball = document.querySelector('[data-ball-loader]');
      let generationBegunAt = null;
      let scenePhase = null;
      let deadlineMs = null;
      let deadlineRelaxed = null;
      try {
        const readiness = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
        if (readiness && typeof readiness.generationBegunAt === 'number') generationBegunAt = readiness.generationBegunAt;
        if (readiness && typeof readiness.phase === 'string') scenePhase = readiness.phase;
        if (readiness && typeof readiness.deadlineMs === 'number') deadlineMs = readiness.deadlineMs;
        if (readiness && typeof readiness.deadlineRelaxed === 'boolean') deadlineRelaxed = readiness.deadlineRelaxed;
      } catch {
        /* bridge threw — navigation-start anchor */
      }
      const canvas = document.querySelector('[data-route-canvas] canvas') || document.querySelector('[data-route-canvas]');
      let canvasOpacity = null;
      if (canvas) {
        canvasOpacity = 1;
        for (let node = canvas; node && node.nodeType === 1; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') {
            canvasOpacity = 0;
            break;
          }
          canvasOpacity *= Number.parseFloat(style.opacity || '1');
        }
      }
      return {
        live: document.documentElement.classList.contains('world-route-live'),
        ballPhase: ball ? ball.getAttribute('data-ball-phase') : 'absent',
        pageNow: performance.now(),
        generationBegunAt,
        scenePhase,
        deadlineMs,
        deadlineRelaxed,
        canvasOpacity,
      };
    });
    if (phasesSeen[phasesSeen.length - 1] !== read.ballPhase) phasesSeen.push(read.ballPhase);
    state = revealGateState(read);
    if (state === 'lite' || state === 'revealed-after-abort') {
      // Round 2: an aborted ball is not yet a verdict — a recovered scene can
      // still take the page (round 1 shot 20+ stills of a live world after a
      // premature "lite"), and an abort on a live route may still resolve.
      // Keep polling until the readiness deadline IN FORCE (the page's own,
      // from the generation's begin when the bridge reports it, else 10 s
      // from navigation start) plus a margin; only then decide.
      abortSeenAtPage ??= read.pageNow;
      abortRead ??= { ...read };
      const anchor = Math.max(0, read.generationBegunAt ?? 0);
      const liteAfter = anchor + (read.deadlineMs ?? REVEAL_DEADLINE_MS) + REVEAL_AFTER_ABORT_MARGIN_MS;
      if (read.pageNow < liteAfter && Date.now() - started <= gateWaitMs) {
        await page.waitForTimeout(REVEAL_GATE_POLL_MS);
        continue;
      }
    }
    if (state !== 'waiting') break;
    if (Date.now() - started > gateWaitMs) break;
    await page.waitForTimeout(REVEAL_GATE_POLL_MS);
  }
  const waitedMs = Date.now() - started;
  if (state === 'revealed' && (abortSeenAtPage !== null || phasesSeen.includes('aborted'))) state = 'revealed-after-abort';
  // LOOK r6 SEAT H5: the phase trace from navigation (the harness's DOM trace
  // plus the product's bounded ballTrace / phaseTrace logs), so an early
  // `loading` the gate's own poll never saw is on record.
  const phaseTraceFromNav = await page
    .evaluate(() => {
      let product = null;
      try {
        const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
        if (r) product = { ballTrace: Array.isArray(r.ballTrace) ? r.ballTrace : null, phaseTrace: Array.isArray(r.phaseTrace) ? r.phaseTrace : null };
      } catch {
        product = null;
      }
      const dom = window.__capturePhaseTrace ? { rows: window.__capturePhaseTrace.rows.slice(0, 400), stoppedAt: window.__capturePhaseTrace.stoppedAt } : null;
      return { dom, product };
    })
    .then((read) => phaseTraceSummary(read.dom, read.product))
    .catch((err) => ({ source: 'none', error: err instanceof Error ? err.message : String(err) }));
  const record = {
    mode: state,
    routeLive: read.live,
    ballPhase: read.ballPhase,
    waitedMs,
    // Round 2 (additive): page-clock time of the verdict (ms since
    // navigation start), the phases observed, whether a ceremony (any phase
    // other than hidden/absent) was seen, and the abort-then-live flag for W7.
    pageMs: Math.round(read.pageNow),
    phasesSeen,
    ceremonyObserved: phasesSeen.some((p) => p !== 'hidden' && p !== 'absent'),
    // LOOK r6 SEAT H5 (additive): phases from navigation start.
    phaseTraceFromNav,
    ...(abortSeenAtPage !== null ? { abortSeenAtPageMs: Math.round(abortSeenAtPage) } : {}),
    // Round 2 (lead): both reads around an abort, and the deadline in force.
    finalRead: read,
    ...(abortRead ? { abortRead } : {}),
    deadlineMs: read.deadlineMs,
    deadlineRelaxed: read.deadlineRelaxed,
  };
  if (state === 'revealed' || state === 'revealed-after-abort') {
    console.log(
      `capture-route: reveal gate passed${state === 'revealed-after-abort' ? ' AFTER A BALL ABORT (flag to W7: abort-then-live)' : ''} (world-route-live, ball=${read.ballPhase}, seen=${phasesSeen.join('>')}${phaseTraceFromNav?.ballSequence?.length ? `, fromNav=${phaseTraceFromNav.ballSequence.join('>')}` : ''}) waitedMs=${waitedMs}`,
    );
    return record;
  }
  if (state === 'lite' || !read.live) {
    // Round 2 (lead): Lite may only resolve on a page that IS Lite. A canvas
    // that shows (or a scene that reports presented) while the route is not
    // live is inconsistent — fail loudly instead of shooting "Lite" stills of
    // a live world (round 1: mountain 390 gate-lite sidecars showed 3D).
    const consistency = liteGateConsistency(read);
    if (!consistency.ok) {
      const err = new Error(
        `reveal gate failed (reveal-gate-inconsistent) — resolving Lite but ${consistency.reasons.join(', ')} (ball=${read.ballPhase}, seen=${phasesSeen.join('>')})`,
      );
      err.revealGate = { ...record, mode: 'inconsistent', inconsistency: consistency.reasons };
      throw err;
    }
    const why = state === 'lite' ? 'ball aborted and world-route-live never set' : `world-route-live never set within ${gateWaitMs / 1000}s (ball=${read.ballPhase})`;
    if (tier === 'route') {
      const err = new Error(
        `reveal gate failed (${state === 'lite' ? 'reveal-gate-aborted' : 'reveal-gate-timeout'}) — ${why} on a forced --tier route page`,
      );
      // LOOK r2: the gate record rides on the error (the quiet probe's
      // unmeasured sidecar carries it).
      err.revealGate = { ...record, mode: state === 'lite' ? 'aborted' : 'timeout' };
      throw err;
    }
    console.log(`capture-route: reveal gate: effective tier is Lite (${why}) — proceeding as before`);
    return { ...record, mode: 'lite' };
  }
  throw new Error(
    `reveal gate failed (reveal-gate-timeout) — world-route-live is set but the ball is still "${read.ballPhase}" after ${REVEAL_GATE_WAIT_MS / 1000}s; refusing to shoot under the loader`,
  );
}

/**
 * One station-settle read: the pose probe's nearest / smooth / exact (after a
 * frame kick) and the WorldNav HUD's active chip href.
 */
async function readStationSettle(page) {
  const read = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const r3f = canvas && canvas.__r3f;
    if (r3f && typeof r3f.invalidate === 'function') r3f.invalidate(4);
    await new Promise((resolveTick) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolveTick();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 32);
    });
    const fn = window.__routeWorldProbe;
    const body = typeof fn === 'function' ? fn() : null;
    const chip = document.querySelector('.world-nav-hud-track a[aria-current="true"]');
    return {
      nearest: body && typeof body.nearest === 'number' ? body.nearest : null,
      smooth: body && typeof body.smooth === 'number' ? body.smooth : null,
      exact: body && typeof body.exact === 'number' ? body.exact : null,
      pin: body?.pin ?? null,
      chipHref: chip ? chip.getAttribute('href') : null,
      // Round 2 (W6 r2 conductor debug fields; null on pages that predate them).
      mapVersion: body?.mapVersion ?? null,
      lastSampleKind: body?.lastSampleKind ?? null,
      sampleScrollY: body?.sampleScrollY ?? null,
      scrollY: Math.round(window.scrollY),
      turnLag: body?.turnLag ?? null,
      // Round 3: the settled camera (station-pose heights for the sweep
      // analysis) and the compile guard's hold count.
      camPos: Array.isArray(body?.camPos) ? body.camPos.slice(0, 3) : null,
      compileHeld: typeof body?.compileHeld === 'number' ? body.compileHeld : null,
      // Wave 2 (2H): the conductor's activeIndex and the raw probe body's
      // settle fields (settledOf picks the latch out harness-side).
      activeIndex: typeof body?.activeIndex === 'number' ? body.activeIndex : null,
      settleFields: body
        ? {
            settled: typeof body.settled === 'boolean' ? body.settled : null,
            stationSettle: body.stationSettle && typeof body.stationSettle === 'object' ? { settled: body.stationSettle.settled ?? null } : null,
            settle: body.settle && typeof body.settle === 'object' ? { settled: body.settle.settled ?? null } : null,
          }
        : null,
    };
  });
  // Wave 2 (2H): the latched `settled` (2A useStationSettle) — null when the
  // page does not publish it yet.
  read.settled = settledOf(read.settleFields);
  delete read.settleFields;
  return read;
}

/** One-line rendering of the conductor debug fields for the console. */
function conductorDebugLine(read) {
  if (!read) return '';
  return ` mapVersion=${read.mapVersion} lastSampleKind=${read.lastSampleKind} sampleScrollY=${read.sampleScrollY} scrollY=${read.scrollY} turnLag=${read.turnLag}`;
}

/** Poll the station-settle assertion for up to STATION_SETTLE_WAIT_MS. */
async function pollStationSettle(page, index, section) {
  const started = Date.now();
  let read = null;
  let verdict = { ok: false, reasons: ['probe-missing'] };
  for (;;) {
    read = await readStationSettle(page);
    verdict = stationSettleVerdict(read, { index, section });
    if (verdict.ok || Date.now() - started > STATION_SETTLE_WAIT_MS) break;
    await page.waitForTimeout(50);
  }
  return { ok: verdict.ok, reasons: verdict.reasons, read, waitedMs: Date.now() - started, settledSignal: verdict.settledSignal ?? 'unmeasured' };
}

/**
 * Land one station and ASSERT it (gauntlet round 1): prepareStation, then the
 * station-settle assertion; on a miss, release any focus, re-seek once
 * (prepareStation again) and re-assert; a second miss throws a named
 * `station-settle-failed` error carrying the record (`err.stationSettle`) so
 * the caller writes it into the sidecar and exits non-zero — the still of the
 * wrong station is never written.
 */
async function landStation(page, section) {
  const index = SECTIONS.indexOf(section);
  const attempts = [];
  lastSeekRecord = null;
  let applied = await prepareStation(page, section);
  const seeks = [lastSeekRecord];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) {
      console.error(
        `capture-route: #${section} station-settle miss (${attempts[0].reasons.join(', ')}; read=${JSON.stringify(attempts[0].read)}) — re-seeking once (index ${index}: |exact-index| < ${STATION_SETTLE_EPS} unless held, nearest === index, |smooth-exact| < ${STATION_SETTLE_EPS}, chip #${section})`,
      );
      if (focusId) {
        await page.evaluate(() => window.__routeWorldFocus?.release());
        await page.waitForTimeout(CAMERA_SETTLE_MS);
      }
      lastSeekRecord = null;
      applied = await prepareStation(page, section);
      seeks.push(lastSeekRecord);
    }
    const result = await pollStationSettle(page, index, section);
    attempts.push(result);
    if (result.ok) {
      console.log(
        `capture-route: #${section} station settled nearest=${result.read.nearest} activeIndex=${result.read.activeIndex ?? 'n/a'} settled=${result.read.settled ?? 'unmeasured'} exact=${result.read.exact} |exact-index|=${Math.abs(result.read.exact - index).toExponential(2)} |smooth-exact|=${Math.abs(result.read.smooth - result.read.exact).toExponential(2)} chip=${result.read.chipHref}${conductorDebugLine(result.read)}${attempt === 1 ? ' (after one re-seek)' : ''}`,
      );
      return {
        applied,
        settle: {
          ok: true,
          index,
          eps: STATION_SETTLE_EPS,
          reseeked: attempt === 1,
          read: result.read,
          waitedMs: result.waitedMs,
          seeks,
          // Wave 2 (2H): activeIndex === target (asserted when published) and
          // the latched settle signal ('settled' | 'unmeasured' when absent).
          activeIndex: result.read.activeIndex ?? null,
          settledSignal: result.settledSignal ?? 'unmeasured',
        },
      };
    }
  }
  const last = attempts[attempts.length - 1];
  const err = new Error(
    `station-settle-failed (${last.reasons.join(', ')}) — #${section} (index ${index}) after one re-seek: nearest=${last.read.nearest} activeIndex=${last.read.activeIndex ?? 'n/a'} settled=${last.read.settled ?? 'unmeasured'} smooth=${last.read.smooth} exact=${last.read.exact} chip=${last.read.chipHref}${conductorDebugLine(last.read)}; no still written`,
  );
  err.stationSettle = {
    ok: false,
    reason: 'station-settle-failed',
    reasons: last.reasons,
    index,
    eps: STATION_SETTLE_EPS,
    attempts: attempts.map(({ reasons, read, waitedMs }) => ({ reasons, read, waitedMs })),
    seeks,
  };
  throw err;
}

// ---------------------------------------------------------------------------
// Round 3: station content (subject presence + content count vs baseline)
// ---------------------------------------------------------------------------
/** Per world/theme/station/viewport content counts adopted from an accepted run. */
const CONTENT_BASELINE_PATH = resolve(outDir, 'station-content-baseline.json');
const STATION_CONTENT_WAIT_MS = 4_000;
let contentBaselineCache = null;

async function loadContentBaseline() {
  if (contentBaselineCache) return contentBaselineCache;
  try {
    const parsed = JSON.parse(await readFile(CONTENT_BASELINE_PATH, 'utf8'));
    contentBaselineCache = parsed && typeof parsed === 'object' && parsed.entries ? parsed : { version: 1, entries: {} };
  } catch {
    contentBaselineCache = { version: 1, entries: {} };
  }
  return contentBaselineCache;
}

/**
 * LOOK r4 (CAR r3: presence passed a blank LED board): judge every present
 * data face of the station on the still itself. Rects come from the --luma
 * inputs when the arm ran, else from a fresh activeFaceRects read; the pixel
 * signal is boardFaceSignal on the final PNG; the renderable minimum is the
 * content baseline's per-face count (boardPresenceVerdict). Never throws.
 */
async function faceBlankCheck(page, section, pngPath, stationContent, lumaRecord) {
  try {
    const present = Array.isArray(stationContent?.presence?.present) ? stationContent.presence.present : [];
    let faces = [];
    let scale = 1;
    if (lumaRecord?.inputs?.faces?.length) {
      faces = lumaRecord.inputs.faces;
      scale = lumaRecord.inputs.frame?.scale ?? 1;
    } else {
      const ctx = await readLumaContext(page);
      const meta = await sharp(pngPath).metadata();
      scale = (meta.width ?? ctx.viewport.width) / Math.max(1, ctx.viewport.width);
      faces = activeFaceRects(ctx.subjects, section);
    }
    const { data, info } = await sharp(pngPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const img = { data, width: info.width, height: info.height, channels: info.channels };
    const minimums = stationContent?.faceMinimums ?? null;
    const ids = new Set([...faces.map((f) => f.id), ...present.map((r) => r.id).filter((id) => /^(board|ledger|plaque|desk)/.test(id))]);
    // LOOK r5 (CAR r4: presence reads 'textured 0' for the plaza boards, so it
    // cannot tell a painted board from a blank one): the harness's own read of
    // every texture slot the face content binds (map, emissiveMap, uniforms).
    const texRead = debugOn ? await readFaceTextures(page, [...ids]) : { ok: false, reason: 'debug off' };
    const out = [];
    for (const id of ids) {
      const face = faces.find((f) => f.id === id) ?? null;
      const row = present.find((r) => r.id === id) ?? null;
      const signal = face ? boardFaceSignal(img, { x: face.x * scale, y: face.y * scale, w: face.w * scale, h: face.h * scale }) : null;
      const kind = id.startsWith('board:') ? 'board' : id.split(':')[0].split('-')[0];
      const harnessTex = texRead.ok ? texRead.faces[id] ?? null : null;
      const verdict = boardPresenceVerdict({ id, kind, renderables: faceTextureVerdictInput(row, harnessTex), signal, minRenderables: minimums && typeof minimums[id] === 'number' ? minimums[id] : null });
      out.push({ ...verdict, textures: harnessTex ?? (texRead.ok ? null : { unmeasured: texRead.reason }), ...(face?.rectSource ? { rectSource: face.rectSource } : {}) });
    }
    return out;
  } catch (err) {
    return [{ id: 'all', verdict: 'unmeasured', reasons: [], error: err instanceof Error ? err.message : String(err) }];
  }
}

/**
 * Land-time content check for one still (route tier, debug bridges on):
 * waits (bounded) for the station's subject to be present and the compile
 * guard to hold nothing, then judges subject presence and the frustum
 * content count against the baseline. `--content-baseline record` adopts
 * this still's counts when its subject is present. Returns the sidecar
 * record; `ok === false` fails the still (`subject-missing` /
 * `station-content-missing`) while the still itself is still written.
 */
async function checkStationContent(page, section, viewportKey) {
  const mode = evidenceArms.contentBaseline ?? 'check';
  if (!debugOn) {
    return { ok: null, verdict: 'unmeasured', reason: 'debug bridges off (any evidence arm or --debug on enables them)' };
  }
  const { read, presence, waitedMs } = await waitForStationContent(page, section, { waitMs: STATION_CONTENT_WAIT_MS });
  // LOOK r6 SEAT H2 (CAR prod: --page-path runs were keyed as plaza, and 390
  // dpr-2 / rung-1 stills were judged against a rung-0 count): the world is
  // the DOM's [data-world] (evoliga -> plaza), and the key carries the device
  // pixel ratio and the quality rung the still rendered, with a fallback
  // chain to the r4 rung key and the rung-less key. A fail against a
  // baseline of another rung or dpr is `suspect` (logged, never an exit).
  const pageRead = await page
    .evaluate(() => {
      const el = document.querySelector('[data-world]');
      let quality = null;
      try {
        const fn = window.__routeWorldQuality;
        const b = typeof fn === 'function' ? fn() : null;
        if (b) quality = { rung: typeof b.rung === 'number' ? b.rung : null, pinned: b.pinned ?? null, deviceDpr: b.deviceDpr ?? null, rungDpr: b.rungDpr ?? null, bufferDpr: b.bufferDpr ?? null, buffer: b.buffer ?? null };
      } catch {
        quality = null;
      }
      return { dataWorld: el ? el.getAttribute('data-world') : null, devicePixelRatio: window.devicePixelRatio, quality };
    })
    .catch(() => ({ dataWorld: null, devicePixelRatio: null, quality: null }));
  const worldInfo = resolveCaptureWorld({ flagWorld: worldId, domNamespace: pageRead.dataWorld });
  const dpr = evidenceArms.dpr ?? (typeof pageRead.devicePixelRatio === 'number' && pageRead.devicePixelRatio > 0 ? pageRead.devicePixelRatio : 1);
  const rung = /^\d$/.test(String(qualityRaw))
    ? Number(qualityRaw)
    : Number.isInteger(pageRead.quality?.rung)
      ? pageRead.quality.rung
      : phasePinRung !== null
        ? Number(phasePinRung)
        : null;
  const chain = contentBaselineChain({ world: worldInfo.world, theme, station: section, viewport: viewportKey, dpr, rung });
  const key = contentBaselineKey({ world: worldInfo.world, theme, station: section, viewport: viewportKey });
  const exactKey = chain[0].key;
  const baselineFile = await loadContentBaseline();
  const pick = mode === 'off' ? null : pickContentBaseline(baselineFile.entries, chain, { dpr, rung });
  const baselineKeyUsed = pick?.key ?? exactKey;
  const baseline = pick?.entry ?? null;
  const content =
    mode === 'off'
      ? { verdict: 'not-judged', reason: '--content-baseline off', renderables: read.content?.renderables ?? null }
      : contentFallbackVerdict(stationContentVerdict(read.content, baseline), pick, exactKey);
  let recorded = false;
  if (mode === 'record' && presence.verdict === 'pass' && read.content && typeof read.content.renderables === 'number') {
    baselineFile.entries[exactKey] = {
      renderables: read.content.renderables,
      instances: read.content.instances ?? null,
      // LOOK r4: each present subject's visible-renderable count — the
      // registered minimum a data face must keep (a blank board drops it).
      faces: Object.fromEntries((presence.present ?? []).filter((row) => typeof row.visibleRenderables === 'number').map((row) => [row.id, row.visibleRenderables])),
      from: tag,
      // LOOK r6: what the entry was shot at (a legacy link compares these).
      dpr,
      rung,
      at: new Date().toISOString(),
    };
    await writeFile(CONTENT_BASELINE_PATH, `${JSON.stringify(baselineFile, null, 2)}\n`, 'utf8');
    recorded = true;
  }
  const reasons = [];
  if (presence.verdict === 'fail') reasons.push('subject-missing');
  if (content.verdict === 'fail') reasons.push('station-content-missing');
  const ok = reasons.length > 0 ? false : presence.verdict === 'pass' ? true : null;
  console.log(
    `capture-route: #${section} station content presence=${presence.verdict}${presence.reasons?.length ? ` (${presence.reasons.join('; ')})` : ''} content=${content.verdict} renderables=${read.content?.renderables ?? 'n/a'}${content.baseline ? `/${content.baseline.renderables} (share ${content.share})` : ''} key=${baselineKeyUsed}${pick && pick.kind !== 'exact' ? ` (fallback ${pick.kind}; exact ${exactKey} not recorded)` : ''}${worldInfo.mismatch ? ` WORLD-MISMATCH(dom ${worldInfo.domNamespace} vs --world ${worldInfo.flagWorld})` : ''} compileHeld=${read.compileHeld ?? 'n/a'} waitedMs=${waitedMs}${recorded ? ' [baseline recorded]' : ''}${content.verdict === 'suspect' ? ` SUSPECT (${content.suspectBecause})` : ''}`,
  );
  return {
    ok,
    reasons,
    presence,
    content,
    // LOOK r6: the DOM world, the dpr / rung the key carries and the chain tried.
    world: worldInfo.world,
    worldSource: worldInfo.source,
    ...(worldInfo.mismatch ? { worldMismatch: { dom: worldInfo.domNamespace, flag: worldInfo.flagWorld } } : {}),
    dpr: { context: dpr, window: pageRead.devicePixelRatio ?? null, rungDpr: pageRead.quality?.rungDpr ?? null, bufferDpr: pageRead.quality?.bufferDpr ?? null, buffer: pageRead.quality?.buffer ?? null },
    rung,
    baselineChain: chain.map((l) => l.key),
    baselineMatch: pick ? { kind: pick.kind, dprMatched: pick.dprMatched, rungMatched: pick.rungMatched } : null,
    baselineKey: key,
    baselineKeyUsed,
    baselineMode: mode,
    faceMinimums: baseline && baseline.faces && typeof baseline.faces === 'object' ? baseline.faces : null,
    ...(recorded ? { baselineRecorded: true } : {}),
    compileHeld: read.compileHeld,
    waitedMs,
    // The plaza station-window map at the still (null in the other worlds).
    windows: read.windows,
    subjects: read.subjects,
    frustum: read.content,
  };
}

/**
 * Round 3 (judge: stale files shared a round's tag prefix): the newest
 * modification time under src/ at run start, stamped into every invocation
 * record — evidence older than a later src edit is visibly stale.
 */
async function newestSourceMtime() {
  const { readdir } = await import('node:fs/promises');
  const root = resolve(repoRoot, 'src');
  let newest = { ms: 0, file: null };
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = resolve(entry.parentPath ?? entry.path ?? root, entry.name);
      try {
        const { mtimeMs } = await stat(full);
        if (mtimeMs > newest.ms) newest = { ms: mtimeMs, file: full.slice(repoRoot.length + 1).replace(/\\/g, '/') };
      } catch {
        /* vanished mid-scan */
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return { newestSrcMtime: newest.ms ? new Date(newest.ms).toISOString() : null, newestSrcFile: newest.file };
}

/**
 * --loader-film, part 1: wait for the ceremony to end (bounded) and stop the
 * capture. Split from the write (round 2) so a film recorded in the SAME
 * navigation as a --loader-trace is stamped against that trace.
 */
async function collectLoaderFilm(page, film, { stop = true } = {}) {
  const ended = await waitForFilmEnd(page, { maxMs: FILM_MAX_MS });
  // Round 3: a capture SHARED with --handoff-composite keeps running until
  // the trace ends (round 3 live: the film's 25 s bound stopped the shared
  // capture before a late world-route-live, leaving the handoff unsampled);
  // the caller stops it after the trace.
  const captured = stop ? await film.stop() : null;
  if (!ended.ok) throw new Error(`loader film failed (${ended.reason})`);
  // Wave 2 (2H): the ceremony animation audit rows of this navigation.
  const ceremonyRows = await page
    .evaluate(() => (window.__captureCeremonyAnimations ? window.__captureCeremonyAnimations.dump() : null))
    .catch(() => null);
  // Rollout harness (CAR r11): the generation log and the warm audit, for the reveal anchors.
  const revealBridges = await page.evaluate(readRevealBridges).catch((err) => ({ errors: [err instanceof Error ? err.message : String(err)] }));
  return { ended, captured, ceremonyRows, revealBridges };
}

/**
 * Wave 2 r3 (W7 montage): share of beam-red pixels in one film frame (a
 * 64 px-wide thumbnail; red = R > 150 and R exceeds G and B by 60+). The
 * capture/release beam is the ball's red/white burst, so its peak is the
 * frame with the largest share. Null when the frame does not decode.
 */
async function beamRedShare(data) {
  try {
    const { data: px, info } = await sharp(data).resize(64, null, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    const n = info.width * info.height;
    for (let i = 0; i < n; i += 1) {
      const r = px[i * info.channels];
      const g = px[i * info.channels + 1];
      const b = px[i * info.channels + 2];
      if (r > 150 && r - g > 60 && r - b > 60) red += 1;
    }
    return n > 0 ? red / n : null;
  } catch {
    return null;
  }
}

/**
 * --loader-film, part 2: stamp every frame with t / ball phase / scene phase
 * (and, with a same-navigation trace, the trace's own sample at that time),
 * and write the labelled montage (-loader-film.png) plus the raw frame list
 * (-loader-film.json). `trace` = the writeLoaderTrace result or null.
 */
async function writeLoaderFilm(key, collected, trace = null) {
  const { ended, captured } = collected;
  // Screencast stamps are epoch seconds; the phase samples are rAF ms since
  // navigation start — timeOrigin maps one onto the other. Frames from before
  // navigation (about:blank) fall below 0 and are dropped.
  // Round 3: the in-frame timecode (the rAF clock itself) wins wherever it
  // decodes; the epoch mapping is the fallback, and clock.medianEpochMinus-
  // TimecodeMs says how far that mapping was off in this run.
  const stamped = await stampFrames(captured.frames, { timeOrigin: ended.timeOrigin, cssWidth: VIEWPORTS[key][0] });
  const frames = stamped.frames
    .filter((f) => f.t !== null && f.t >= 0)
    .sort((a, b) => a.t - b.t);
  if (frames.length === 0) {
    throw new Error(
      `loader film failed (no-frames) — source=${captured.source}${captured.error ? ` (${captured.error})` : ''}`,
    );
  }
  const analysis = summarizeFilm(frames, ended.samples, { reducedMotion: evidenceArms.reducedMotion === true });
  // Rollout harness (CAR r11 / ROLLOUT-PLAN §4.3): reveal since generationBegunAt AND since navigation.
  const reveal =
    trace?.analysis?.reveal ??
    revealAnchors({
      routeLiveAt: analysis.routeLiveAt ?? null,
      generationBegunAt: collected.revealBridges?.generationBegunAt ?? null,
      anchorSource: 'readiness-at-film-end',
      bridges: collected.revealBridges ?? null,
    });
  const traceSamples = trace?.merged ?? null;
  const rows = frames.map((f, i) => {
    const phase = phaseAt(ended.samples, f.t);
    const traced = traceSamples ? phaseAt(traceSamples, f.t) : null;
    return {
      i,
      t: f.t,
      // Round 3: which clock stamped t, and both raw stamps.
      clock: f.clock,
      tEpoch: f.tEpoch,
      tTimecode: f.tTimecode,
      tCapture: f.tCapture,
      // Round 2: periodic (steady-cadence composited screenshot) or screencast (on change).
      kind: f.kind,
      ballPhase: phase?.ballPresent ? phase.ballPhase : null,
      routeLive: phase?.routeLive ?? false,
      scenePhase: phase?.scenePhase ?? null,
      // Round 2: the same-navigation loader-trace sample in force at t.
      ...(traced
        ? { trace: { t: traced.t, ballPhase: traced.ballPhase, ballVisible: traced.ballVisible, routeLive: traced.routeLive, canvasOpacity: traced.canvasOpacity, milestones: traced.milestones, wobbles: traced.wobbles } }
        : {}),
      selected: false,
    };
  });
  // Wave 2 (2H, residual 4): compositor-smoothness evidence for the
  // ceremony — the screencast's compositor cadence inside the reveal window
  // and the CSS-animation-on-transform/opacity audit.
  // Wave 2 r3 (W7 judge): gaps per ball phase (loading-after-presented /
  // opening / releasing) in compositor.cadence.byPhase; a reduced-motion
  // film (a change-only crossfade: a screencast gap there may be idle) is
  // judged on the periodic screenshots only, failing above 150 ms.
  const reducedMotionFilm = evidenceArms.reducedMotion === true;
  const compositor = {
    cadence: reducedMotionFilm
      ? { ...ceremonyCadence(rows, analysis.revealWindow, { source: 'periodic', limitMs: RM_PERIODIC_GAP_LIMIT_MS }), screencastByPhase: cadencePerBallPhase(rows, { source: 'screencast' }), rule: 'reduced motion: periodic screenshots only (a change-only screencast gap may be idle), fail above 150 ms' }
      : { ...ceremonyCadence(rows, analysis.revealWindow), periodicByPhase: cadencePerBallPhase(rows, { source: 'periodic' }) },
    animations: ceremonyAnimationVerdict(collected.ceremonyRows ? collected.ceremonyRows.rows : null),
  };
  // LOOK r3 (CAR judge): the WHOLE ceremony — first ball-visible frame to
  // done / aborted, loading included — judged at warn > 100 / fail > 250 ms
  // per phase (loading-before-presented / loading-after-presented / opening /
  // releasing). The r2 window above (presented -> done) stays as it was.
  if (!reducedMotionFilm) {
    const ceremonyWindow = ceremonyWindowOf({ samples: ended.samples, traceSamples: trace?.merged ?? null });
    compositor.ceremony = wholeCeremonyCadence(rows, ceremonyWindow);
  }
  const baseSelected = selectFilmFrames(
    frames.map((f) => f.t),
    { start: frames[0].t, end: frames[frames.length - 1].t, revealStart: analysis.revealWindow?.start ?? null },
  );
  // Wave 2 r3 (W7 judge): >= 3 montage frames between opening and done,
  // one at peak beam (max red-pixel share of the frame).
  const openingAt = analysis.openingAt ?? null;
  const endedAt = analysis.endedAt ?? null;
  const redShares = await Promise.all(
    frames.map((f) => (typeof openingAt === 'number' && f.t >= openingAt && (typeof endedAt !== 'number' || f.t <= endedAt) ? beamRedShare(f.data) : null)),
  );
  const ceremonyPicks = ensureCeremonyPicks(baseSelected, frames.map((f) => f.t), redShares, { openingAt, endedAt, min: 3 });
  const selected = ceremonyPicks.selected;
  for (const i of selected) rows[i].selected = true;
  redShares.forEach((r, i) => {
    if (typeof r === 'number') rows[i].redShare = +r.toFixed(4);
  });
  const labels = selected.map((i) => `+${rows[i].t}ms ball=${rows[i].ballPhase ?? 'none'} scene=${rows[i].scenePhase ?? '-'}${i === ceremonyPicks.ceremony.peakIndex ? ' PEAK-BEAM' : ''}`);
  const pngPath = resolve(outDir, `${tag}-${key}-loader-film.png`);
  await writeStrip(
    selected.map((i) => frames[i].data),
    pngPath,
    labels,
  );
  const jsonPath = resolve(outDir, `${tag}-${key}-loader-film.json`);
  await writeJson(jsonPath, {
    kind: 'loader-film',
    viewport: key,
    reducedMotion: evidenceArms.reducedMotion,
    source: captured.source,
    sourceError: captured.error,
    dropped: captured.dropped,
    ended: ended.reason,
    montage: pngPath.slice(outDir.length + 1),
    selected,
    ceremonyFrames: ceremonyPicks.ceremony,
    analysis,
    compositor,
    ceremonyAnimationRows: collected.ceremonyRows ?? null,
    // Round 2: the achieved steady cadence (periodic composited screenshots)
    // beside the on-change screencast, and the same-navigation trace link.
    cadence: { targetMs: captured.cadenceMs ?? null, ...filmCadence(frames), byPhase: cadenceByPhase(rows) },
    // Round 3: the shared clock record.
    clock: stamped.clock,
    sameNavigationAsTrace: trace !== null,
    reveal,
    ...(trace
      ? { trace: { file: trace.file, routeLiveAt: trace.analysis.routeLiveAt ?? null, stamps: trace.analysis.stamps ?? null } }
      : {}),
    notes: [
      'round 3: t = the rAF time decoded from the harness timecode painted into the frame (bottom-left 96 x 8 px strip; clock "timecode") — the same clock as the loader trace and the phase samples, so film rows and trace samples cross-reference directly; frames where it does not decode fall back to the epoch mapping below (clock "epoch"). The strip is visible in the montage',
      't (epoch fallback) = screencast frame stamps (compositor swap time, epoch) and periodic screenshots (request/response midpoint, epoch) mapped through performance.timeOrigin',
      'the screencast emits a frame only when the screen changes; the periodic frames (kind "periodic") are composited-page screenshots at a steady target cadence — cadence.periodic reports what was achieved, and a gap there means the page produced no frame',
      trace
        ? "recorded in the SAME navigation as the -loader.json trace: each frame row carries the trace sample in force at its t, and trace.routeLiveAt is that trace's world-route-live"
        : "no --loader-trace in this run: align beam timing to analysis.routeLiveAt (this film's own), never to another run's trace",
      'ballPhase null = no [data-ball-loader] mounted; scenePhase null = __routeWorldReadiness absent',
      `montage: ${selected.length} frames, ~60 % of them inside the reveal window when one was observed; wave 2 r3: at least 3 between the first opening and done (ceremonyFrames), one the peak-beam frame (max share of beam-red pixels, rows[].redShare; label PEAK-BEAM)`,
      'wave 2 (2H): compositor.cadence = intervals of the screencast frames\' compositor timestamps (tEpoch) inside the reveal window (a compositor-driven CSS ceremony keeps emitting frames through a main-thread stall; mainThread = gaps of the JS-painted timecode, which a stall freezes); fail above 100 ms. The CDP screencast is acked per frame, so a loaded harness can thin it: re-shoot a fail before believing it. compositor.animations = the ceremony animation audit (CSS animations / transitions on transform / opacity only)',
    ],
    invocation,
    phaseSamples: ended.samples,
    frames: rows,
  });
  console.log(
    `capture-route: [loader-film] ${frames.length} frames (${captured.source}${captured.dropped ? `, ${captured.dropped} dropped` : ''}) ended=${ended.reason} fps=${analysis.fps} revealFps=${analysis.revealFps} floorMet=${analysis.fpsFloorMet} compositorCadence=${compositor.cadence.verdict}${compositor.cadence.compositor ? ` maxGap=${compositor.cadence.compositor.maxGapMs}ms` : ''} ceremonyAnimations=${compositor.animations.verdict} ${revealLine(reveal)} -> ${pngPath}`,
  );
  if (compositor.ceremony) {
    const c = compositor.ceremony;
    const bp = c.screencast?.byPhase ?? {};
    console.log(
      `capture-route: [loader-film] whole-ceremony cadence ${c.verdict}${c.window ? ` window=${Math.round(c.window.start)}..${Math.round(c.window.end)} (${c.window.startSource})` : ''}${c.screencast ? ` maxGap=${c.screencast.maxGapMs}ms` : ''} byPhase ${Object.entries(bp).filter(([, v]) => v.intervals).map(([k, v]) => `${k}:${v.maxGapMs}`).join(' ')}${c.periodic ? ` periodicMax=${c.periodic.maxGapMs}ms` : ''}${c.corroborated !== null && c.corroborated !== undefined ? ` corroborated=${c.corroborated}` : ''}`,
    );
  }
  return compositor;
}

/**
 * C-046: does this present-path failure belong to the hydration-flake class
 * (the present hook never mounted)? Only these are reload-retried; every
 * other present failure (invalid payload, HUD missing, theme mismatch, ...)
 * is deterministic and fails immediately.
 */
function isHydrationFlakePresentFailure(err) {
  const message = err instanceof Error ? err.message : String(err);
  return PRESENT_RETRYABLE_REASONS.some((reason) => message.includes(`(${reason})`));
}

// ---------------------------------------------------------------------------
// S9 evidence arms (runners live in scripts/lib/capture-evidence.mjs)
// ---------------------------------------------------------------------------
/** Occlusion grid for the evidence arms (the bridge default). */
const EVIDENCE_GRID = { nx: 6, ny: 4 };

/**
 * Round 2 dev-compile warm-up record of this run (null when no warm-up ran):
 * stamped into every evidence JSON and pose sidecar so a judge can see the
 * measured navigation was not the one paying for `next dev` compilation.
 */
let warmupRecord = null;

async function writeJson(path, body) {
  let stamped = warmupRecord && body && typeof body === 'object' && !('warmup' in body) ? { ...body, warmup: warmupRecord } : body;
  // LOOK r2 SEAT H: every evidence record carries the load's world-asset origin.
  if (stamped && typeof stamped === 'object' && 'invocation' in stamped && !('assetOrigin' in stamped)) {
    const assetOrigin = currentAssetOrigin();
    if (assetOrigin) stamped = { ...stamped, assetOrigin };
  }
  // Round 5: a prior record of this name that did not pass is kept as
  // <stem>.try<N>.json (never only the passing retry in gauntlet/evidence).
  const prior = await keepPriorTry(path);
  if (prior.kept) {
    console.log(`capture-route: kept the earlier non-passing record as ${prior.kept}`);
    if (stamped && typeof stamped === 'object') stamped = { ...stamped, priorTry: { kept: prior.kept, n: prior.n } };
  }
  await writeFile(path, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');
}

/**
 * Round 2 warm-up: load the page once in a throwaway context (same viewport,
 * theme and visibility pin, none of the recorders / injections) and wait for
 * it to present — world-route-live, a presented / failed scene or an aborted
 * ball — bounded by WARMUP_MAX_MS; then close it. The measured run navigates
 * fresh. Returns the record stamped into every output.
 */
async function runWarmup(browserHandle, width, height) {
  const started = Date.now();
  // Round 4 (W7 judge: the Lite warm-up went route-live): the warm-up
  // context carries the measured run's reduced-motion emulation and DPR.
  const context = await browserHandle.newContext({
    viewport: { width, height },
    colorScheme: theme,
    ...(evidenceArms.reducedMotion ? { reducedMotion: 'reduce' } : {}),
    ...(evidenceArms.dpr !== undefined ? { deviceScaleFactor: evidenceArms.dpr } : {}),
    // Wave 2 round 2 --touch on (additive).
    ...(touchOn ? { hasTouch: true, isMobile: true } : {}),
  });
  await installUtcDay(context); // R48
  await context.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
  await context.addInitScript(() => {
    try {
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'visible' });
    } catch {
      /* launch args still unthrottle rAF */
    }
  });
  let outcome = 'bounded';
  let final = null;
  const liteWarmup = tier === 'lite' || liteFloorRun;
  try {
    const page = await context.newPage();
    if (evidenceArms.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: WARMUP_MAX_MS });
    for (;;) {
      // Wave 2 round 2: a page whose main thread is wedged (a dev-server
      // reload storm) must not hold the warm-up past its bound — each read
      // races the remaining budget (the r2 run hung 584 s in one evaluate).
      const remaining = Math.max(1000, WARMUP_MAX_MS - (Date.now() - started));
      let raceTimer = null;
      const read = await Promise.race([
        page.evaluate(() => {
        const ball = document.querySelector('[data-ball-loader]');
        let scenePhase = null;
        try {
          const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
          if (r && typeof r.phase === 'string') scenePhase = r.phase;
        } catch {
          /* bridge threw */
        }
        return {
          live: document.documentElement.classList.contains('world-route-live'),
          ballPhase: ball ? ball.getAttribute('data-ball-phase') : 'absent',
          scenePhase,
          loaded: document.readyState === 'complete',
          canvas: Boolean(document.querySelector('[data-route-canvas]')),
        };
        }),
        new Promise((resolveRace) => {
          raceTimer = setTimeout(() => resolveRace(null), remaining);
        }),
      ]);
      clearTimeout(raceTimer);
      if (read === null) {
        outcome = 'bounded (page unresponsive)';
        break;
      }
      final = read;
      // Wave 2 round 2 (W7 judge: "the Lite warm-up wastes 45 s"): a run whose
      // tier resolves to Lite (--tier lite, or the reduced-motion Lite floor)
      // never presents a scene, so the warm-up ends once the page has loaded
      // (the dev compile is primed by then) instead of waiting for the bound.
      if (final.live) outcome = 'route-live';
      else if (liteWarmup && final.loaded) outcome = 'lite-resolved';
      else if (final.scenePhase === 'presented') outcome = 'scene-presented';
      else if (final.scenePhase === 'failed') outcome = 'scene-failed';
      else if (final.ballPhase === 'aborted') outcome = 'ball-aborted';
      if (outcome !== 'bounded' || Date.now() - started > WARMUP_MAX_MS) break;
      await page.waitForTimeout(250);
    }
  } catch (err) {
    outcome = `error: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`;
  } finally {
    await context.close().catch(() => {});
  }
  const record = {
    ran: true,
    url: pageUrl,
    viewport: `${width}x${height}`,
    reducedMotion: evidenceArms.reducedMotion === true,
    ...(evidenceArms.dpr !== undefined ? { dpr: evidenceArms.dpr } : {}),
    warmupMs: Date.now() - started, outcome, final, boundMs: WARMUP_MAX_MS };
  console.log(`capture-route: [warmup] ${record.viewport} ${outcome} after ${record.warmupMs} ms (dev compile primed; the measured run navigates fresh)`);
  return record;
}

/** Wave 2 r3: a --frames interval below this uses the in-page sampler (runFastFramesTrace). */
const FAST_FRAMES_BELOW_MS = 1000;
/** Fast-frames thumbnail width cap (CSS px of the canvas draw; memory bound for 120 frames). */
const FAST_FRAMES_THUMB_W = 960;

/**
 * Wave 2 r3 --frames with --interval < 1000 ms: the in-page fixed-cadence
 * sampler (armArrivalBurst) at the requested interval — one drawImage of
 * the world canvas per tick plus the probe, card, hover, beam and
 * roll-call reads. The frames are CANVAS thumbnails (no HUD / card /
 * panel composite, no occlusion raycast); the W2/W4/W1 verdicts of the
 * slow path are therefore `unmeasured` here, by design. At teams the trace
 * is armed on the ARRIVAL edge: the harness lands on roster, arms, and
 * clicks the teams chip, so the settle latch and the roll call fall inside
 * the frames (t is relative to the click; `settleAt` marks the latch).
 */
async function runFastFramesTrace(page, base, meta) {
  const intervalMs = evidenceArms.intervalMs;
  const durationMs = evidenceArms.frames * intervalMs;
  const vp = page.viewportSize();
  const thumbW = Math.min(FAST_FRAMES_THUMB_W, vp?.width ?? FAST_FRAMES_THUMB_W);
  const arrival = meta.section === 'teams' && !meta.focus;
  let click = null;
  if (arrival) {
    await landStation(page, 'roster');
  }
  await armArrivalBurst(page, { intervalMs, thumbW, maxSamples: evidenceArms.frames + (arrival ? Math.ceil(400 / intervalMs) + 2 : 0) });
  if (arrival) {
    await page.waitForTimeout(400);
    click = await clickNavChip(page, 'teams');
  }
  await page.waitForTimeout(durationMs + intervalMs);
  const dump = await dumpArrivalBurst(page);
  const t0 = click?.ok ? click.t : dump.samples[0]?.t ?? 0;
  const framePaths = [];
  const labels = [];
  const samples = [];
  let n = 0;
  for (const s of dump.samples) {
    if (typeof s.thumbIndex !== 'number' || !dump.thumbs[s.thumbIndex]) continue;
    const url = dump.thumbs[s.thumbIndex];
    const png = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).png().toBuffer();
    const framePath = `${base}${frameSuffix(n, dump.samples.length)}.png`;
    await writeFile(framePath, png);
    framePaths.push(framePath);
    const t = +(s.t - t0).toFixed(1);
    const lights = Array.isArray(s.rollCall?.lights) ? s.rollCall.lights.map((l) => (l === 'rest' ? '.' : l === 'calling' ? '*' : '#')).join('') : null;
    labels.push(`f${String(n).padStart(2, '0')} ${t >= 0 ? '+' : ''}${Math.round(t)}ms${s.settled ? ' S' : ''}${lights ? ` ${lights}` : ''}`);
    samples.push({ i: n, t, pageT: s.t, file: framePath.slice(outDir.length + 1), camera: { smooth: s.smooth, exact: s.exact, settled: s.settled, chip: s.chip, skip: s.skip }, rollCall: s.rollCall ?? null, card: s.card ?? null, hover: s.hover ?? null, canvasBlank: s.canvasBlank });
    n += 1;
  }
  const gaps = [];
  for (let i = 1; i < dump.samples.length; i += 1) gaps.push(dump.samples[i].t - dump.samples[i - 1].t);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const q = (p) => (sortedGaps.length ? +sortedGaps[Math.min(sortedGaps.length - 1, Math.floor(p * sortedGaps.length))].toFixed(1) : null);
  const settleSample = dump.samples.find((s) => (!click?.ok || s.t >= click.t) && s.settled === true && (!arrival || s.chip === '#teams'));
  const rollCall = meta.section === 'teams' ? rollCallVerdict(dump.samples, { clickT: click?.ok ? click.t : null }) : null;
  if (rollCall && rollCall.verdict === 'fail') verdictFailures.push(`${meta.viewport} #teams frames: rollCall ${rollCall.reasons.join('; ')}`);
  const stripPath = `${base}-strip.png`;
  if (framePaths.length) await writeStrip(framePaths, stripPath, labels);
  let cropStripPath = null;
  if (evidenceArms.stripCrop && framePaths.length) {
    const k = thumbW / Math.max(1, vp?.width ?? thumbW);
    const c = evidenceArms.stripCrop;
    cropStripPath = `${base}-strip-crop.png`;
    await writeStrip(framePaths, cropStripPath, labels, { crop: { x: Math.round(c.x * k), y: Math.round(c.y * k), w: Math.max(1, Math.round(c.w * k)), h: Math.max(1, Math.round(c.h * k)) } });
  }
  const tracePath = `${base}-trace.json`;
  await writeJson(tracePath, {
    kind: 'frames-trace',
    mode: 'fast-in-page-sampler',
    ...meta,
    frames: evidenceArms.frames,
    intervalMs,
    armedOn: arrival ? { kind: 'teams-arrival', from: 'roster', click, settleAt: settleSample ? +(settleSample.t - t0).toFixed(1) : null } : { kind: 'landed-station' },
    cadence: { samples: dump.samples.length, medianMs: q(0.5), p95Ms: q(0.95), maxMs: sortedGaps.length ? +sortedGaps[sortedGaps.length - 1].toFixed(1) : null, honoured: q(0.95) !== null && q(0.95) <= intervalMs * 1.6 },
    thumbW,
    strip: framePaths.length ? stripPath.slice(outDir.length + 1) : null,
    ...(cropStripPath ? { stripCrop: { file: cropStripPath.slice(outDir.length + 1), region: evidenceArms.stripCrop, scaledTo: thumbW } } : {}),
    rollCall,
    analysis: { w2: { verdict: 'unmeasured', reason: 'fast frames carry no figure rows' }, w4: { verdict: 'unmeasured', reason: 'fast frames carry no occlusion rows' }, w1: { verdict: 'unmeasured', reason: 'fast frames carry no occlusion rows' } },
    notes: [
      `wave 2 r3: --interval < ${FAST_FRAMES_BELOW_MS} ms runs the in-page fixed-cadence rAF sampler (armArrivalBurst): frames are ${thumbW} px CANVAS thumbnails (no HUD, card or panel composite) plus probe / card / hover / beam / roll-call reads per tick; cadence reports what was achieved`,
      't = ms since the teams chip click on an arrival-armed trace (armedOn.kind teams-arrival), else since the first sample; strip labels: S = settle latch held, roll-call lights . rest * calling # called (left to right)',
      'W2 / W4 / W1 are unmeasured here: use --interval >= 1000 for the present+occlusion path',
    ],
    invocation,
    samples,
  });
  console.log(
    `capture-route: [frames:fast] ${samples.length} frames @${intervalMs}ms (median ${q(0.5)} p95 ${q(0.95)}) armed=${arrival ? `teams-arrival settle=${settleSample ? Math.round(settleSample.t - t0) : 'never'}ms` : 'landed'}${rollCall ? ` rollCall=${rollCall.verdict}` : ''} -> ${tracePath}`,
  );
}

/**
 * S9 --frames: after the station's still, present N more frames through the
 * same FBO+HUD path (phase pin off so the world keeps moving; readiness waits
 * skipped — the still already passed them) and sample the evidence bridges
 * beside each. Writes -fNN.png, -strip.png and -trace.json.
 */
async function runFramesTrace(page, base, meta) {
  // Wave 2 r3 (W1 / TEAMS judges: --interval 200 produced frames ~4.1 s
  // apart — one FBO present + occlusion raycast per frame costs seconds):
  // an interval below FAST_FRAMES_BELOW_MS runs the in-page fixed-cadence
  // sampler instead (canvas thumbnails + bridge reads, no present pipeline).
  if (evidenceArms.intervalMs < FAST_FRAMES_BELOW_MS) {
    if (rungStep) throw new Error('--rung-step needs the presented trace (--interval >= FAST_FRAMES_BELOW_MS)');
    return runFastFramesTrace(page, base, meta);
  }
  const framePaths = [];
  const labels = [];
  const samples = [];
  const startedAt = Date.now();
  const tracePerfStart = await page.evaluate(() => performance.now()).catch(() => null);
  let rungStepRecord = rungStep ? { ...rungStep, fired: false } : null;
  // R49: every present re-acquire of this trace (frame index + record).
  // Fix round TOOLS-4: named presentGateRetries (the sidecar's presentRetries
  // stays the C-046 reload COUNT).
  const presentGateRetries = [];
  // R40: per-frame beats / core actors / warm-stats draws since the previous sample.
  let extrasFrom = tracePerfStart;
  for (let i = 0; i < evidenceArms.frames; i += 1) {
    const frameStartedAt = Date.now();
    if (rungStepRecord && !rungStepRecord.fired && (frameStartedAt - startedAt) / 1000 >= rungStepRecord.atS) {
      // POKEMON-CORE A1 / R5 (ii): the live ladder step, between two sampled frames.
      const result = await page
        .evaluate((rung) => {
          const force = window.__routeWorldQualityForce;
          const read = window.__routeWorldQuality;
          const before = typeof read === 'function' ? read().rung : null;
          const r = typeof force === 'function' ? force(rung) : { ok: false, reason: 'no __routeWorldQualityForce (needs routeDebug)' };
          return { ...r, before, perfT: performance.now() };
        }, rungStepRecord.rung)
        .catch((err) => ({ ok: false, reason: err instanceof Error ? err.message : String(err) }));
      rungStepRecord = { ...rungStepRecord, fired: true, frameIndex: i, firedAtMs: frameStartedAt - startedAt, result };
      console.log(`capture-route: [rung-step] ${meta.section ?? ''} frame ${i} t=${frameStartedAt - startedAt}ms -> rung ${rungStepRecord.rung} ${JSON.stringify(result)}`);
    }
    const framePath = `${base}${frameSuffix(i, evidenceArms.frames)}.png`;
    // R49: tell the present which transition this frame follows (a rung step
    // within RUNG_STEP_TRANSITION_FRAMES, else a focused trace) and keep its
    // retry record on the sample.
    const framePresented = await writePresentedPng(page, framePath, { mode: 'off' }, [], hideMeshNames, {
      traceFrame: true,
      transition: presentTransition({ frameIndex: i, rungStep: rungStepRecord, focus: focusId }),
    });
    if (framePresented?.presentRetry) presentGateRetries.push({ i, ...framePresented.presentRetry });
    const sample = await sampleEvidence(page, { occlusion: true, ...EVIDENCE_GRID });
    const t = frameStartedAt - startedAt;
    const extras = await page.evaluate(readFrameExtrasInPage, extrasFrom).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    if (typeof extras?.perfT === 'number') extrasFrom = extras.perfT;
    const beatsRow = compactBeats(extras?.beats ?? null);
    const actorsRow = compactCoreActors(extras?.coreActors ?? null);
    const draws = frameDraws(extras?.windows ?? null);
    samples.push({
      i,
      t,
      file: framePath.slice(outDir.length + 1),
      ...sample,
      ...(typeof extras?.perfT === 'number' ? { extrasPerfT: +extras.perfT.toFixed(1) } : {}),
      ...(beatsRow ? { beats: beatsRow } : {}),
      ...(actorsRow ? { coreActors: actorsRow } : {}),
      ...(draws ? { draws } : {}),
      ...(extras?.error ? { extrasError: extras.error } : {}),
      ...(framePresented?.presentRetry ? { presentRetry: framePresented.presentRetry } : {}),
    });
    framePaths.push(framePath);
    // Round 3: + the water clock (uTime) when the page has the water bridge.
    labels.push(stripLabel(i, t, sample.water ?? null));
    const remaining = evidenceArms.intervalMs - (Date.now() - frameStartedAt);
    if (i < evidenceArms.frames - 1 && remaining > 0) await page.waitForTimeout(remaining);
  }
  const analysis = await summarizeFrameTrace(samples, { station: meta.section ?? null });
  // Wave 2 (2H): the future beat bus / attack log, read once at the trace's
  // end (both bridges keep their own history) — recorded, never judged here.
  const bridges = await readPassThroughBridges(page);
  // R41: the force clock's zero (bus seconds) and the bus clock now, for the awake coverage.
  const forceClock = forceClockWatchOn ? await page.evaluate(readForceClockInPage).catch(() => null) : null;
  // POKEMON-CORE A1 (R4, R5, R12): the ledger over the trace window — actor
  // appearance flips (with the frustum test), waterline crossings, late
  // registrations, latch warm errors and the director's per-frame time.
  const traceWarmStats =
    tracePerfStart === null
      ? null
      : await page
          .evaluate((from) => (window.__routeWarmStats ? window.__routeWarmStats.window(from, performance.now(), 50) : null), tracePerfStart)
          .catch(() => null);
  const stripPath = `${base}-strip.png`;
  await writeStrip(framePaths, stripPath, labels);
  // Round 3 --strip-crop: the same frames cropped to one region (e.g. the
  // water ring, a few dozen px inside a full-frame thumbnail).
  let cropStripPath = null;
  if (evidenceArms.stripCrop) {
    cropStripPath = `${base}-strip-crop.png`;
    await writeStrip(framePaths, cropStripPath, labels, { crop: evidenceArms.stripCrop });
  }
  const tracePath = `${base}-trace.json`;
  await writeJson(tracePath, {
    kind: 'frames-trace',
    ...meta,
    frames: evidenceArms.frames,
    intervalMs: evidenceArms.intervalMs,
    grid: EVIDENCE_GRID,
    strip: stripPath.slice(outDir.length + 1),
    ...(cropStripPath ? { stripCrop: { file: cropStripPath.slice(outDir.length + 1), region: evidenceArms.stripCrop } } : {}),
    analysis,
    bridges,
    ...(forceClock ? { forceClock } : {}),
    ...(rungStepRecord ? { rungStep: rungStepRecord } : {}),
    // R49 (always stamped on presented traces): the frames whose present was re-acquired once,
    // and (fix round TOOLS-2) their verdict: inconclusive = any re-acquire other than the
    // diagnosed held gate that reopened — a bar judged on this trace must not pass on it.
    presentGateRetries,
    presentGateRetryVerdict: presentRetryVerdict(presentGateRetries),
    ...(traceWarmStats
      ? {
          warmStats: {
            frames: traceWarmStats.frames,
            busyP50: traceWarmStats.busyP50,
            busyP95: traceWarmStats.busyP95,
            directorP50: traceWarmStats.directorP50 ?? null,
            directorP95: traceWarmStats.directorP95 ?? null,
            lateRegistrations: traceWarmStats.lateRegistrations ?? null,
            latchWarmErrors: traceWarmStats.latchWarmErrors ?? null,
            appearances: traceWarmStats.appearances ?? null,
            waterline: traceWarmStats.waterline ?? null,
          },
        }
      : {}),
    notes: [
      'frames are SAMPLED FBO presents at the requested interval (t = harness wall clock since the first frame), not video',
      'R49: presentGateRetries / samples[].presentRetry = a present the page refused (present-gate-held: its C-083 gate re-armed by a rung step, focus transition or visibility flip) or that returned a bad payload within 2 frames of a rung step, re-acquired ONCE after the gate reopened (wait = the bounded poll); that frame was presented later than t by wait.waitedMs. presentGateRetryVerdict: clean | recorded (every re-acquire is present-gate-held with the gate seen reopened) | inconclusive (any other re-acquire: do not pass a bar on this trace)',
      'POKEMON-CORE A1 (R7): analysis.w2SameClipKey is the de-sync verdict input (same file + clip pairs only); analysis.w2 / perSample count cross-model pairs too and are a drift check only',
      'wave 2: bridges = __routeWorldBeats() / __routeWorldAttacks() read once after the last frame (pass-through: "unmeasured" when the bridge is absent, "recorded" when present — never a pass); R40 adds __routeWorldCoreActors() (bridges.coreActors) and __routeWorldWater() (bridges.water)',
      'R40 per frame (presented path): samples[].beats = the bus compacted (t, quiet, rollCall running, granted / pending tickets with denial reasons, reading window, sinceSettleS); samples[].coreActors = every probe actor (mode, wants, pos, counters; flip logs only in the end-of-run bridge); samples[].draws = the warm-stats per-frame draw calls since the previous sample (~1 s windows of <= 40 frames each; truncated = some frames not listed)',
      'round 3: strip labels carry "uT <s>" = the first water body\'s uTime at that frame when the page has the water bridge; W1 here judges only the station\'s own subjects',
      'occlusion is a raycast verdict: blind to particles, shader displacement and post effects',
      'W2 unmeasured = no figure exposed a clip/phase (scene-scan fallback until Figure.tsx registers)',
    ],
    invocation,
    samples,
  });
  console.log(
    `capture-route: [frames] ${evidenceArms.frames} frames -> ${tracePath} W2=${analysis.w2.verdict} W4=${analysis.w4.verdict} W1=${analysis.w1.verdict} figures=${analysis.figureSource} beats=${bridges.beats.status} attacks=${bridges.attacks.status} coreActors=${bridges.coreActors?.status ?? 'n/a'} water=${bridges.water?.status ?? 'n/a'}`,
  );
}

/**
 * S9 --loader-trace: stop the navigation-start recorder, analyse, write
 * -loader.json. Round 2 options: `compositeFilm` (the --handoff-composite
 * capture, possibly shared with the film), `fault` (the --fail-inject record),
 * `liteFloor` ({ reducedMotionMatched } on a reduced-motion auto-tier run) and
 * `traceMaxMs` (Lite-bound runs never settle live). Returns { file, merged,
 * analysis } for a same-navigation film.
 */
async function writeLoaderTrace(page, key, { compositeFilm = null, fault = null, liteFloor = null, traceMaxMs = undefined } = {}) {
  const trace = await finishLoaderTrace(page, traceMaxMs ? { timeoutMs: traceMaxMs } : {});
  // The fault record is read AFTER the trace ends (the injection fires mid-load).
  if (typeof fault === 'function') fault = await fault();
  const loaderPath = resolve(outDir, `${tag}-${key}-loader.json`);
  if (!trace.ok) {
    if (compositeFilm) await compositeFilm.stop();
    throw new Error(`loader trace failed (${trace.reason})`);
  }
  // Round 2 --handoff-composite: the COMPOSITED page around world-route-live
  // (CDP screencast frames), not the canvas buffer.
  let composite = null;
  let compositeSource = null;
  if (compositeFilm) {
    const captured = await compositeFilm.stop();
    compositeSource = {
      source: captured.source,
      error: captured.error,
      dropped: captured.dropped,
      frames: captured.frames.length,
      periodicFrames: captured.frames.filter((f) => f.kind === 'periodic').length,
      cadenceMs: captured.cadenceMs ?? null,
    };
    const routeLiveAt = trace.merged.find((s) => s.routeLive)?.t ?? null;
    const origin = typeof trace.timeOrigin === 'number' ? trace.timeOrigin : null;
    if (routeLiveAt !== null && origin !== null) {
      // Round 3: frames stamped by the in-frame timecode (the trace's own rAF
      // clock) where it decodes; the strip itself is cut away before the
      // blank check.
      const stamped = await stampFrames(captured.frames, { timeOrigin: origin, cssWidth: VIEWPORTS[key][0] });
      compositeSource.clock = stamped.clock;
      const spreads = await compositeSpreads(stamped.frames, {
        from: routeLiveAt - 800,
        to: routeLiveAt + 800,
        excludeBottomPx: 2 * TIMECODE.block + 2,
      });
      composite = compositeHandoffVerdict(spreads, routeLiveAt, {
        before: 800,
        after: 800,
        // Every page frame the trace saw (rAF times = the timecode clock).
        pageFrames: trace.merged.map((s) => s.t),
      });
    } else {
      // Wave 2 round 2: reduced-motion traces arm the composite by default; on
      // the Lite floor there is no handoff at all, which is not "unmeasured".
      composite =
        routeLiveAt === null && liteFloor
          ? { verdict: 'not-applicable', reasons: ['Lite floor: the world never goes live, so there is no handoff to composite'] }
          : { verdict: 'unmeasured', reasons: [routeLiveAt === null ? 'route never went live' : 'no page timeOrigin to align the screencast'] };
    }
  }
  // Round 2: an injected fault that never fired is no evidence of the path.
  const faultMissed = fault && fault.missed ? fault.missed : null;
  const analysis = await summarizeLoader(trace.merged, {
    composite,
    // Wave 2 (2H): the product's own phase / wobble / milestone logs.
    readiness: trace.readiness,
    // LOOK r2: the recorder's last readiness read per scene generation.
    attempts: trace.attempts ?? null,
    // Round 4: the ball-over-text self-check (null = not armed -> unmeasured).
    ballTextHits: trace.ballTextIntersections,
    ...(fault ? { failInject: fault.kind } : {}),
    // The page-visible failure moment of an injected context loss.
    ...(fault && typeof fault.lostEventAt === 'number' ? { faultFailedAt: fault.lostEventAt } : {}),
    ...(liteFloor ? { liteFloor } : {}),
  });
  if (faultMissed) {
    analysis.verdict = 'unmeasured';
    analysis.reasons = [...analysis.reasons, `fault injection missed: ${faultMissed}`];
  }
  // LOOK r2 (CAR judge: a forced --tier route trace that fell to Lite read
  // verdict=pass and exited 0): without a fault or the Lite floor, a route
  // trace must go live with the ball inside the deadline.
  const routeLive = routeTierLiveVerdict({ tier, faultInjected: Boolean(fault), liteFloor: Boolean(liteFloor), timeline: analysis.timeline });
  analysis.routeLive = routeLive;
  // LOOK r3 (CAR judge: "g4 on 3 of 12 runs, no sidecar explains why"): the
  // scene-generation account — informational, never judged.
  try {
    analysis.generations = generationAccount(trace.merged, trace.readiness, trace.attempts ?? null);
  } catch (err) {
    analysis.generations = { verdict: 'unmeasured', reason: err instanceof Error ? err.message : String(err) };
  }
  if (routeLive.verdict === 'fail') {
    analysis.verdict = 'fail';
    analysis.reasons = [...analysis.reasons, ...routeLive.reasons];
  }
  // Wave 2 (2H, residual 4): compositor-smoothness evidence — every
  // ceremony animation must be a CSS animation on transform / opacity. A
  // failing audit fails the trace (a live run only: Lite-bound runs never
  // play the reveal).
  const ceremonyAnimations = ceremonyAnimationVerdict(trace.ceremonyAnimations ? trace.ceremonyAnimations.rows : null);
  analysis.ceremonyAnimations = ceremonyAnimations;
  if (ceremonyAnimations.verdict === 'fail' && analysis.verdict !== 'unmeasured') {
    analysis.verdict = 'fail';
    analysis.reasons = [...analysis.reasons, ...ceremonyAnimations.reasons.map((r) => `ceremony animation: ${r}`)];
  }
  // Round 5: whether the shader check ran (and whether --param
  // routeShaderCheck=<v> was honoured by the page).
  const shaderCheck = shaderCheckRecord(extraPageParams, trace.glDebug);
  // LOOK r5 (CAR r4: "472-530 ms main-thread gaps" was the film's whole-
  // recording screencast gap): main-thread gaps from this trace's own rAF
  // samples, split before the ball / ceremony / after, source named.
  try {
    analysis.mainThreadGaps = rafGapWindows(trace.merged, {
      ballShownAt: typeof analysis.ballShownAt === 'number' ? analysis.ballShownAt : null,
      ballEndAt: typeof analysis.timeline?.ballEndAt === 'number' ? analysis.timeline.ballEndAt : typeof analysis.ballDismissedAt === 'number' ? analysis.ballDismissedAt : null,
    });
    const mg = analysis.mainThreadGaps;
    console.log(`capture-route: [loader-trace] main-thread (rAF samples) maxGap preBall=${mg.preBall.maxGapMs ?? 'n/a'}ms@${mg.preBall.maxGapAt ?? '-'} ceremony=${mg.ceremony.maxGapMs ?? 'n/a'}ms@${mg.ceremony.maxGapAt ?? '-'} after=${mg.after.maxGapMs ?? 'n/a'}ms`);
  } catch (err) {
    analysis.mainThreadGaps = { verdict: 'unmeasured', reason: err instanceof Error ? err.message : String(err) };
  }
  // LOOK r6 SEAT H6 (ENGINE E3: "attribute, then slice, the post-ball
  // stall"): every long animation frame >= 50 ms from navigation with its
  // script attribution, booked to the ball-phase windows of this trace.
  let loaf = null;
  try {
    const rec = await page.evaluate(() => (window.__captureLoaf ? { supported: window.__captureLoaf.supported, rows: window.__captureLoaf.rows.slice(0, 400), dropped: window.__captureLoaf.dropped } : null));
    if (rec) {
      const pw = phaseWindowsFromStamps(analysis.stamps);
      const byPhase = loafByPhase(rec.rows, pw.windows);
      loaf = {
        supported: rec.supported,
        entries: rec.rows.length,
        dropped: rec.dropped,
        windows: (pw.windows ?? []).map((w) => ({ phase: w.phase, from: w.from, to: Number.isFinite(w.to) ? w.to : null })),
        windowSource: pw.source ?? pw.reason ?? null,
        byPhase,
        rows: rec.rows,
        notes: ['long animation frames >= 50 ms from navigation (PerformanceObserver long-animation-frame, buffered); scripts = the frame\'s script attribution (invoker, invokerType, sourceURL, sourceFunctionName, sourceCharPosition), top 8 by duration; byPhase books each frame to the ball-phase window of its start (analysis.stamps, product logs first)'],
      };
      const lb = byPhase['loading-before-presented'];
      console.log(`capture-route: [loader-trace] LoAF ${rec.supported ? `${rec.rows.length} frame(s) >= 50 ms` : 'unsupported'}${Object.keys(byPhase).length ? ` byPhase ${Object.entries(byPhase).map(([p, b]) => `${p}=${b.count}x max${b.maxMs}ms`).join(' ')}` : ''}${lb?.topSources?.[0] ? ` top(loading-before-presented)=${lb.topSources[0].source} ${lb.topSources[0].ms}ms` : ''}`);
    }
  } catch (err) {
    loaf = { supported: null, error: err instanceof Error ? err.message : String(err) };
  }
  // Rollout harness (CAR r11 / ROLLOUT-PLAN §4.3): the reveal since the
  // revealed generation's generationBegunAt (the judged anchor) AND since
  // navigation, the product's generation log and __warmAudit.lateLinks.
  {
    const bridges = await page.evaluate(readRevealBridges).catch((err) => ({ errors: [err instanceof Error ? err.message : String(err)] }));
    const tl = analysis.timeline ?? null;
    const fromTimeline = tl && tl.anchorSource === 'generationBegunAt' && typeof tl.anchor === 'number';
    analysis.reveal = revealAnchors({
      routeLiveAt: tl?.routeLiveAt ?? analysis.routeLiveAt ?? null,
      generationBegunAt: fromTimeline ? tl.anchor : bridges.generationBegunAt ?? null,
      anchorSource: fromTimeline ? 'generationBegunAt (analysis.timeline.anchor)' : 'readiness-at-trace-end',
      bridges,
    });
  }
  // LOOK r5: the program split at the trace's end (the world is live).
  const loaderProgramSplit = debugOn ? await readProgramSplit(page, 'loader-trace end (after world-route-live)') : null;
  if (loaderProgramSplit) console.log(`capture-route: [loader-trace] ${programSplitLine(loaderProgramSplit)}`);
  if (shaderCheck.honoured === false) {
    console.warn(
      `capture-route: [loader-trace] --param routeShaderCheck=${shaderCheck.requested} was passed to the page but the renderer reports checkShaderErrors=${shaderCheck.checkShaderErrors} — the page does not honour it; hitch magnitudes include the shader check`,
    );
  }
  await writeJson(loaderPath, {
    kind: 'loader-trace',
    viewport: key,
    reducedMotion: evidenceArms.reducedMotion,
    readinessBridge: trace.readinessBridge,
    // Round 5: three's per-program shader check state at the trace's end.
    shaderCheck,
    // LOOK r5: programs split active rung vs pre-warmed, D26 on the active split.
    ...(loaderProgramSplit ? { programSplit: loaderProgramSplit } : {}),
    pixelReads: trace.pixelReads,
    pixelErrors: trace.pixelErrors,
    // Round 4: the canvas-readback pause over the handoff window.
    pixelPause: trace.pixelPause,
    ballTextIntersections: trace.ballTextIntersections,
    // Wave 2 (2H): the product's logs as read at the trace's end.
    readiness: trace.readiness,
    // LOOK r2: the last readiness read of EVERY generation (a failed
    // attempt's milestones / load signals / stall target survive the idle
    // generation that replaces it; analysis.attempt is the judged one).
    attempts: trace.attempts ?? null,
    ceremonyAnimationRows: trace.ceremonyAnimations,
    ...(compositeSource ? { compositeSource } : {}),
    ...(fault ? { failInject: fault } : {}),
    ...(liteFloor ? { liteFloorInput: liteFloor } : {}),
    // LOOK r2 SEAT H: the paint audit at the trace's end (--debug).
    ...(debugOn ? { paintAudit: await readPaintAudit(page) } : {}),
    // LOOK r6 SEAT H6: loader-phase long animation frames (script attribution).
    ...(loaf ? { loaf } : {}),
    // Rollout harness (CAR r11): the reveal anchors (also analysis.reveal).
    reveal: analysis.reveal,
    analysis,
    notes: [
      't = ms since navigation start (rAF frame time)',
      'canvasSpread = luma stddev of a 16x16 downsample read right after each rendered frame, ONLY once the route is live or the canvas shows (round 2: pre-live reads were pure GPU cost); null = unreadable or not read, never counted blank',
      'round 2: ballVisible = data-ball-visible on the root or a painted child (non-empty rect, effective opacity > 0.01) — the always-mounted empty root no longer counts',
      'round 2: milestones / assetRatio from __routeWorldReadiness().milestones; wobbles = wobble animationstart events inside [data-ball-loader]; analysis.wobble checks each wobble against a milestone rise (round 3: within 100 ms of page time, sample-interval aware; lagMs per wobble)',
      'round 2: analysis.handoffDensity refuses a pass (insufficient-sampling) when the DOM trace samples [routeLive-200, routeLive+600] ms sparser than 100 ms',
      `round 5: the reveal hitch window is [first ball \`opening\` (else ball dismiss, else route-live), world-route-live + 600 ms], cut at a failure inside it (analysis.revealWindow); stalls from a failure anchor on are analysis.failurePath.stallMs / stalls (informational, never reveal hitches), stalls in neither window are analysis.otherStalls; a composite with < 5 page frames in its window reads unmeasured (too-few-page-frames), never pass; ${evidenceArms.handoffComposite ? `canvas reads pause through the handoff window (world-route-live + ${HANDOFF_PIXEL_PAUSE_AFTER_MS} ms)` : `without the composite, canvas reads inside the handoff window are throttled to one per ${HANDOFF_READ_EVERY_MS} ms (pixelPause.throttledReads; a throttled frame carries the previous read)`}; shaderCheck = three's debug.checkShaderErrors at the trace's end (--param routeShaderCheck=<v> is recorded with honoured true/false)`,
      'round 4: canvas readbacks pause from the first ball `opening` until world-route-live + 400 ms (round 5: + 800 ms) (pixelPause; paused samples carry pixelPaused and canvasSpread null) so the composite screencast keeps its cadence; analysis.ballText fails the trace when __ballTextIntersections (BallLoader self-check, trace/debug sessions) has any hit before the first data-revealing sample; a fail verdict exits 1, insufficient-sampling is listed for a re-shoot',
      'round 2: analysis.failurePath (when the scene failed): ball gone/aborted within 1 frame, Lite shown by deadline + 150 ms; faults are injected harness-side with --fail-inject context-loss:loading|context-loss:opening|timeout (failInject records when and in which ball phase it fired)',
      'round 2: ballVisible also requires a ceremony phase (loading / opening / releasing); analysis.stamps lists every ball / scene phase transition, world-route-live, milestone rise and wobble start, plus the deadline in force',
      'round 2: the ?routeDebug=1 perf readout is hidden (CSS) from navigation on, so it never sits over the docked ball',
      'wave 2 (2H): ONE deadline anchor — analysis.deadlineAnchor = the product generationBegunAt carried by the first loading sample (deadlineAnchorSource), used by overrun, timeline, timeoutPath and failurePath; firstLoadingSampleOffsetMs is information only; probeDeadlineAnchor / probeOverrun keep the evidence-probe reading when it differed',
      'wave 2 (2H): a canvas read with spread exactly 0 at opacity >= 0.98 is unread (canvasSpread null, zeroReadUnconfirmed) unless the previous distinct read is also 0 AND a composited frame within 60 ms shows a blank (analysis.zeroReads); the reduced-motion path (no `opening` phase) now pauses / throttles reads from the handoff start (pixelPause.handoffAt)',
      'wave 2 (2H): analysis.wobble judges rock starts from __routeWorldReadiness().wobbleTrace rockStart (Animation.startTime — the real start; animationstart events are dispatched late under stalls) against milestones.at stamps; the rAF-sample check is analysis.wobble.sampled; analysis.stamps.product lists every ball / scene phase from the product logs (ballTrace / phaseTrace), so a single-commit phase is never missed; stamps.programsWarmAt',
      'wave 2 (2H): analysis.ceremonyAnimations = every animation seen in the ceremony scope ([data-ball-loader], [data-route-canvas], the site NavBar; not the WorldNav HUD) from the first ceremony frame to world-route-live + 1.5 s must be CSS (CSSAnimation, or CSSTransition — counted) on transform / opacity only; a script Animation or another property fails the trace',
      trace.readinessBridge
        ? 'scenePhase from window.__routeWorldReadiness()'
        : 'window.__routeWorldReadiness() absent: scenePhase null, deadline anchored at the first ball frame, Lite-block check inactive',
      ...(compositeFilm
        ? [
            'composite = the COMPOSITED page: CDP screencast frames (on change) plus periodic Page.captureScreenshot frames at a steady target cadence, 32x32 grey luma stddev per frame; the capture adds encode load, so this run is not a timing reference',
            'round 3: composite window = world-route-live +-800 ms; frames are stamped by the in-frame timecode (compositeSource.clock) — the trace\'s own rAF clock — with the bottom timecode rows cut away before the blank check; an under-sampled window makes the run unmeasured (unmeasuredReason insufficient-sampling), never a pass or a fail',
          ]
        : []),
    ],
    invocation,
    samples: trace.merged,
  });
  console.log(
    `capture-route: [loader-trace] ${trace.merged.length} samples -> ${loaderPath} verdict=${analysis.verdict} ${revealLine(analysis.reveal)}${routeLive.verdict !== 'not-applicable' ? ` routeLive=${routeLive.verdict}` : ''}${analysis.stallPath ? ` stallPath=${analysis.stallPath.verdict}` : ''}${analysis.attempt ? ` attempt=g${analysis.attempt.generation}:${analysis.attempt.phase ?? '?'} risen=[${analysis.attempt.risen.map((r) => r.milestone).join(',')}] pending=[${analysis.attempt.pending.join(',')}]${analysis.attempt.lastWarmStage ? ` warm=${analysis.attempt.lastWarmStage.stage}` : ''}` : ''}${analysis.reasons.length ? ` (${analysis.reasons.join('; ')})` : ''} handoffMaxInterval=${analysis.handoffDensity.maxIntervalMs} wobble=${analysis.wobble.verdict} ballText=${analysis.ballText?.verdict ?? 'n/a'}${trace.pixelPause?.pausedReads ? ` pixelPause=${trace.pixelPause.pausedReads}` : ''} failurePath=${analysis.failurePath.verdict}${typeof analysis.failurePath.stallMs === 'number' ? ` failureStall=${analysis.failurePath.stallMs.toFixed(0)}ms` : ''}${shaderCheck.checkShaderErrors !== null ? ` shaderCheck=${shaderCheck.checkShaderErrors ? 'on' : 'off'}` : ''}${composite ?` composite=${composite.verdict}` : ''}${analysis.timeoutPath ? ` timeoutPath=${analysis.timeoutPath.verdict}` : ''}${analysis.liteFloor ? ` liteFloor=${analysis.liteFloor.verdict}` : ''}${fault ? ` fault=${fault.kind}@${fault.firedAt ?? 'never'}` : ''}${typeof analysis.failedAt === 'number' ? ` failedAt=${analysis.failedAt.toFixed(1)}(${analysis.failedAtSource})` : ''}`,
  );
  for (const notice of analysis.notices ?? []) console.log(`capture-route: [loader-trace] NOTICE ${notice.kind}: ${notice.message}`);
  return { file: loaderPath.slice(outDir.length + 1), merged: trace.merged, analysis, readiness: trace.readiness ?? null };
}

/**
 * LOOK r6 SEAT H6 --gpu-trace: stop the Chromium trace started before the
 * navigation (<tag>-<vp>-gpu-trace.json) and write its per-ball-phase
 * summary (<tag>-<vp>-gpu-trace-summary.json; scripts/lib/trace-summary.mjs).
 * Never throws: a failed stop or summary is recorded in the summary file.
 */
async function finishGpuTrace(key, tracePath, traceResult) {
  const summaryPath = resolve(outDir, `${tag}-${key}-gpu-trace-summary.json`);
  let summary;
  try {
    await browser.stopTracing();
    // ENGINE-A5 fix: stream-parsed above 256 MB (a 737 MB trace overflowed V8's string limit).
    const events = await loadTraceFile(tracePath);
    // ENGINE-A5: phase windows from the product's ballTrace (trace-summary productWindows).
    summary = summarizeTrace(events, { top: 10, longTaskMs: 50, readiness: traceResult?.readiness ?? null });
  } catch (err) {
    summary = { verdict: 'unmeasured', reason: err instanceof Error ? err.message : String(err) };
  }
  await writeJson(summaryPath, {
    kind: 'gpu-trace-summary',
    viewport: key,
    trace: tracePath.slice(outDir.length + 1),
    categories: GPU_TRACE_CATEGORIES,
    loaderTrace: traceResult?.file ?? null,
    loaderPhases: traceResult?.analysis?.stamps ? phaseWindowsFromStamps(traceResult.analysis.stamps) : null,
    ...summary,
    invocation,
  });
  for (const line of summaryLines(summary)) console.log(`capture-route: [gpu-trace] ${key} ${line.replace(/^trace-summary: /, '')}`);
  console.log(`capture-route: [gpu-trace] ${key} -> ${tracePath} (+ ${summaryPath.slice(outDir.length + 1)})`);
}

/**
 * LOOK r6 SEAT H6 --program-keys (ENGINE E7): every renderer program with
 * its full cacheKey, name, type and whether the sampled frames drew it, plus
 * the key audit (decoded parameter block, near pairs split by one or two
 * fields) -> <tag>-<vp>-program-keys.json. Links, fetches and uploads nothing.
 */
async function writeProgramKeys(page, key) {
  const path = resolve(outDir, `${tag}-${key}-program-keys.json`);
  const inv = await readProgramInventory(page);
  if (!inv.ok) {
    await writeJson(path, { kind: 'program-keys', viewport: key, verdict: 'unmeasured', reason: inv.reason, invocation });
    console.log(`capture-route: [program-keys] ${key} unmeasured (${inv.reason}) -> ${path}`);
    return;
  }
  const rung = await readQuietRung(page);
  const audit = programKeyAudit(inv.programs);
  const split = programSplit(inv.programs, { theme: expectedTheme, rung: rung.rung });
  await writeJson(path, {
    kind: 'program-keys',
    viewport: key,
    theme: expectedTheme,
    rung,
    total: inv.programs.length,
    split: split.verdict === 'measured' ? { active: split.active, prewarmed: split.prewarmed, activeOutput: split.activeOutput, d26: split.d26 } : split,
    audit,
    programs: inv.programs.map((p, i) => ({ i, name: p.name ?? null, type: p.type ?? null, drawn: p.drawn, usedTimes: p.usedTimes ?? null, cacheKey: p.cacheKey })),
    notes: [
      'programs = renderer.info.programs after the reveal (index i is referenced by audit.nearPairs a / b); drawn = bound by gl.useProgram over 3 sampled frames',
      'audit.nearPairs = programs of one shader that differ in at most 2 key fields: merge candidates for ENGINE E7 when the split field is not a data-face need (scripts/audit-program-keys.mjs can consume this file)',
    ],
    invocation,
  });
  console.log(`capture-route: [program-keys] ${key} ${inv.programs.length} programs, ${audit.nearPairCount} near pair(s), top split fields ${Object.entries(audit.splitFields).slice(0, 4).map(([f, n]) => `${f}x${n}`).join(' ') || 'none'} -> ${path}`);
}

/** LOOK r6 SEAT H7: the warm-cache leg's reveal bound per load. */
const WARM_CACHE_REVEAL_WAIT_MS = 45_000;

/**
 * LOOK r6 SEAT H7 --warm-cache (r6 brief: "a second load without the cold
 * flags, with a shader-source stability diff between 1440 and 390, reporting
 * reveal as cold / warm"). A separate browser without the cold-shader launch
 * flags loads each viewport twice in fresh contexts: the PRIMER fills the GPU
 * program cache, the WARM load measures the reveal with it filled. Both loads
 * log every shader source (hash + type); the record diffs primer vs warm
 * (a cache hit needs byte-identical sources across loads) and viewport vs
 * viewport (the primers), next to this run's cold reveal from its loader
 * trace. Writes <tag>-warm-cache.json. Never throws.
 */
async function runWarmCacheLeg() {
  const path = resolve(outDir, `${tag}-warm-cache.json`);
  const record = {
    kind: 'warm-cache',
    theme,
    coldLaunch: coldShadersOn ? { launchArgs: COLD_SHADER_ARGS } : { launchArgs: [], note: 'the measured (cold) leg ran without --cold-shaders: its GPU program cache was not disabled' },
    viewports: {},
    shaderStability: {},
    notes: [
      'cold = this run\'s loader trace (world-route-live and ball end, page clock ms from navigation); primer / warm = a second browser without the cold-shader flags, two fresh contexts per viewport, the reveal read by the harness phase trace (installPhaseTrace)',
      'shaderStability.loads = primer vs warm sources of one viewport (must be stable for a warm hit); shaderStability.crossViewport = the first two viewports\' primers (a program whose source differs by viewport is compiled again at the other width)',
      'the warm leg is a separate browser process: its reveal is a best-case (GPU program cache filled, HTTP cache per context empty)',
    ],
    invocation,
  };
  let warm = null;
  const logs = {};
  try {
    warm = await chromium.launch({
      headless: false,
      args: ['--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--hide-scrollbars', ...PINNED_SCALE_ARGS],
    });
    for (const key of viewportKeys) {
      const [width, height] = VIEWPORTS[key];
      const loads = [];
      for (const label of ['primer', 'warm']) {
        const ctx = await warm.newContext({
          viewport: { width, height },
          colorScheme: theme,
          ...(evidenceArms.reducedMotion ? { reducedMotion: 'reduce' } : {}),
          ...(evidenceArms.dpr !== undefined ? { deviceScaleFactor: evidenceArms.dpr } : {}),
          ...(touchOn ? { hasTouch: true, isMobile: true } : {}),
        });
        await installUtcDay(ctx); // R48
        try {
          await ctx.addInitScript((t) => window.localStorage.setItem('theme', t), theme);
          await ctx.addInitScript(() => {
            try {
              Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => false });
              Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'visible' });
            } catch {
              /* launch args still unthrottle rAF */
            }
          });
          if (debugOn) await ctx.addInitScript(installDebugHudHide, DEV_OVERLAY_HIDE_CSS);
          await ctx.addInitScript(installPhaseTrace, { maxMs: 60_000, pollMs: 100, marks: false });
          await ctx.addInitScript(installShaderSourceLog);
          const pg = await ctx.newPage();
          await pg.bringToFront();
          const started = Date.now();
          await pg.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          const settled = await pg
            .waitForFunction(
              () => {
                const live = document.documentElement.classList.contains('world-route-live');
                const ball = document.querySelector('[data-ball-loader]');
                const ph = ball ? ball.getAttribute('data-ball-phase') : 'absent';
                return (live && (ph === 'done' || ph === 'hidden' || ph === 'absent')) || ph === 'aborted';
              },
              null,
              { timeout: WARM_CACHE_REVEAL_WAIT_MS, polling: 100 },
            )
            .then(() => true)
            .catch(() => false);
          const read = await pg.evaluate(() => ({
            trace: window.__capturePhaseTrace ? { rows: window.__capturePhaseTrace.rows.slice(0, 400), stoppedAt: window.__capturePhaseTrace.stoppedAt } : null,
            shaders: window.__captureShaderLog ? { entries: window.__captureShaderLog.entries, sources: window.__captureShaderLog.sources, calls: window.__captureShaderLog.calls } : null,
          }));
          logs[`${key}:${label}`] = read.shaders;
          loads.push({ label, settled, wallMs: Date.now() - started, ...revealFromPhaseRows(read.trace), shaders: read.shaders ? { unique: read.shaders.entries.length, calls: read.shaders.calls } : null });
        } finally {
          await ctx.close().catch(() => {});
        }
      }
      const cold = coldReveals[key] ?? null;
      const [primer, warmLoad] = loads;
      const delta = (a, b) => (typeof a === 'number' && typeof b === 'number' ? +(a - b).toFixed(1) : null);
      record.viewports[key] = {
        cold,
        primer,
        warm: warmLoad,
        revealMs: { cold: cold?.routeLiveAt ?? null, primer: primer?.routeLiveAt ?? null, warm: warmLoad?.routeLiveAt ?? null, coldMinusWarm: delta(cold?.routeLiveAt, warmLoad?.routeLiveAt) },
      };
      record.shaderStability[`loads:${key}`] = shaderSourceDiff(logs[`${key}:primer`], logs[`${key}:warm`], { labelA: 'primer', labelB: 'warm' });
      console.log(
        `capture-route: [warm-cache] ${key} reveal cold=${cold?.routeLiveAt ?? 'n/a'} primer=${primer?.routeLiveAt ?? 'n/a'} warm=${warmLoad?.routeLiveAt ?? 'n/a'} ms (world-route-live from navigation); shader sources primer->warm ${record.shaderStability[`loads:${key}`].verdict}`,
      );
    }
    if (viewportKeys.length >= 2) {
      const [a, b] = viewportKeys;
      record.shaderStability.crossViewport = { viewports: [a, b], ...shaderSourceDiff(logs[`${a}:primer`], logs[`${b}:primer`], { labelA: `vp${a}`, labelB: `vp${b}` }) };
      const x = record.shaderStability.crossViewport;
      console.log(`capture-route: [warm-cache] shader sources ${a} vs ${b}: ${x.verdict}${x.counts ? ` (${JSON.stringify(x.counts)})` : ''}${x.pairs?.[0]?.firstDifference ? ` first difference line ${x.pairs[0].firstDifference.line}: "${x.pairs[0].firstDifference.a}" vs "${x.pairs[0].firstDifference.b}"` : ''}`);
    } else {
      record.shaderStability.crossViewport = { verdict: 'unmeasured', reason: 'needs two --viewports (e.g. 1440,390)' };
    }
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    console.log(`capture-route: [warm-cache] leg failed: ${record.error}`);
  } finally {
    if (warm) await warm.close().catch(() => {});
  }
  await writeJson(path, record);
  console.log(`capture-route: [warm-cache] -> ${path}`);
}

/** S9 --sweep: land the start station, script the gesture, write -sweep.json. */
/** Land + assert a station and return only its settle record (sweep arms). */
async function landSettle(page, section) {
  return (await landStation(page, section)).settle;
}

/**
 * Round 2 --sweep jump: nav-chip jumps across 2+ stations (pulse -> schedule,
 * rules -> roster). Each leg lands + asserts its start, clicks the target chip
 * (no pointer move), records skip / pathYaw / camPos per rAF, and asserts the
 * landing through the station-settle poll.
 */
async function runJumpArm(page, key, revealGate, sweepPath) {
  // Round 2: --chip-jump <from>,<to> (repeatable) picks the legs; the
  // default pair covers a forward and a backward 2+-station jump.
  const legs = evidenceArms.chipJump ?? [
    { from: 'pulse', to: 'schedule' },
    { from: 'rules', to: 'roster' },
  ];
  const results = await runJump(page, {
    legs,
    land: (section) => landSettle(page, section),
    assertLanding: (index, section) => pollStationSettle(page, index, section),
    stationIds: SECTIONS,
  });
  // Round 3: a leg also fails on a rendered turn rate above the limiter or a
  // whole-leg height excursion.
  // Round 4: + the leg's frame-gap verdict (max rAF gap <= 250 ms).
  const pass = results.every(
    (leg) =>
      leg.analysis.verdict === 'pass' &&
      leg.analysis.frameGapVerdict !== 'fail' &&
      leg.yawRate?.rendered?.verdict !== 'fail' &&
      leg.legHeight?.verdict !== 'fail' &&
      // Wave 2 round 2 (W6 judge): measured, not inferred.
      leg.windowMounts?.verdict !== 'fail' &&
      leg.cardEdges?.verdict !== 'fail',
  );
  await writeJson(sweepPath, {
    kind: 'sweep',
    mode: 'jump',
    viewport: key,
    revealGate,
    pass,
    legs: results.map(({ frames, ...leg }) => ({ ...leg, heights: crossingHeights(frames) })),
    notes: [
      'jump legs click the .world-nav-hud-track chip with element.click() (no pointer move, so pointer parallax cannot enter the heading)',
      'heading verdict reads the rig pathYaw (authored path, parallax excluded) when the probe publishes it, else the measured yaw',
      'pass = skip.active seen, heading monotone along one arc <= pi inside [start, end], and the landing passed the station-settle assertion',
      'round 3: + yawRate.rendered (per-draw turn rate, R3F clock) <= 200 deg/s + 5 % and legHeight (max camera y over the leg minus the higher of its first/last frame) <= 0.35 m; heights (per crossing) now skip skip-through frames, so a pure pose-space jump reports its crossings unmeasured by design — legHeight is the jump\'s height check',
      'wave 2 round 2: + windowMounts (every window.__c089Windows entry that turns entered / resident false -> true between the click and the landing; any window other than the target fails the leg; unmeasured outside plaza) and cardEdges (Station Card data-edge per episode: a forward step enters from bottom, backward from top; exits leave the way the world moves; no flip). Frames now carry windows + caption.{station,state,edge,direction,travel}, and a leg records until the settled latch holds (settledLatch) plus the tail, so films reach the settled face',
      "round 4: + analysis.frameGapVerdict — the leg's max rAF gap (from the click on) <= 250 ms, whatever its attribution; frameGaps.gaps[].attribution is recorder-only only with >= 2 page draws inside the gap, else page-gpu-or-compositor (the page did not present — the freeze is visible) and countsAgainstProduct; the run exits 1 when pass is false",
    ],
    invocation,
    frames: Object.fromEntries(results.map((leg) => [`${leg.from}->${leg.to}`, leg.frames])),
  });
  for (const leg of results) {
    console.log(
      `capture-route: [sweep jump] ${key} ${leg.from}->${leg.to} verdict=${leg.analysis.verdict} skipSeen=${leg.analysis.skipSeen} arc=${leg.analysis.arcRad} reversals=${leg.analysis.reversals} settle=${leg.settle?.ok ?? 'n/a'} frameGap=${leg.analysis.maxFrameGapMs ?? 'n/a'}ms (${leg.analysis.frameGapVerdict ?? 'n/a'}) peakYawRate=${leg.yawRate?.measured.peakDegS ?? 'n/a'}deg/s renderedYawRate=${leg.yawRate?.rendered?.peakDegS ?? 'n/a'}deg/s (${leg.yawRate?.rendered?.verdict ?? 'n/a'}) legHeight=${leg.legHeight?.excursionM ?? 'n/a'}m maxFrameGap=${leg.frameGaps?.maxGapMs ?? 'n/a'}ms windowMounts=${leg.windowMounts?.verdict ?? 'n/a'}${leg.windowMounts?.violations?.length ? `(${leg.windowMounts.reasons.join('; ')})` : ''} cardEdges=${leg.cardEdges?.verdict ?? 'n/a'} settledLatch=${leg.settledLatch?.ok ?? 'n/a'}${leg.analysis.reasons.length ? ` (${leg.analysis.reasons.join('; ')})` : ''}`,
    );
  }
  console.log(`capture-route: [sweep jump] -> ${sweepPath} pass=${pass}`);
  return { pass, file: sweepPath.slice(outDir.length + 1), filmWindows: results.map((leg) => ({ label: `${leg.from}->${leg.to}`, frames: leg.frames ?? [] })) };
}

/**
 * Round 2 --sweep panel: team panels at #teams (3 open/close cycles of team
 * A, then B tapped while A is open) and one board panel at #schedule. The
 * panel box, data-closing, camPos and yaw are recorded per rAF; the verdict
 * is panelEdgeVerdict against the D6 edge for this viewport.
 */
async function runPanelArm(page, key, revealGate, sweepPath) {
  const width = page.viewportSize()?.width ?? 1440;
  const expectedEdge = expectedPanelEdge(width);
  const runs = [];
  const teamSettle = await landSettle(page, 'teams');
  const pick = await pickPanelSubjects(page, { param: 'team', hint: /team/i, want: 2 });
  if (pick.picked.length === 0) {
    runs.push({ station: 'teams', settle: teamSettle, pick, analysis: { verdict: 'unmeasured', reasons: ['no focus subject opened a ?team= panel'] } });
  } else {
    const result = await runPanelCycles(page, { subjects: [pick.picked[0], pick.picked[1] ?? null], cycles: 3 });
    runs.push({ station: 'teams', settle: teamSettle, pick, ...result, analysis: panelEdgeVerdict(result.frames, { expectedEdge }) });
  }
  const boardSettle = await landSettle(page, 'schedule');
  const board = await runPanelCycles(page, { subjects: ['board:schedule', null], cycles: 1 });
  runs.push({ station: 'schedule', settle: boardSettle, subjects: ['board:schedule'], ...board, analysis: panelEdgeVerdict(board.frames, { expectedEdge }) });
  const pass = runs.every((run) => run.analysis.verdict === 'pass');
  await writeJson(sweepPath, {
    kind: 'sweep',
    mode: 'panel',
    viewport: key,
    expectedEdge,
    revealGate,
    pass,
    runs: runs.map(({ frames: _frames, ...run }) => run),
    notes: [
      'panels are opened through the focus bridge (__routeWorldFocus.focus), which writes the same ?team= / ?board= param a tap does',
      'entry = first observed rect minus the settled rect; exit = last rect (data-closing) minus the settled rect; edge = the dominant axis sign (below 2 px = none, e.g. an opacity-only reduced-motion fade)',
      'camera step limits are per frame normalised to 16.7 ms; a hard cut through a cross-blend shows as a single-frame jump',
    ],
    invocation,
    frames: Object.fromEntries(runs.map((run) => [run.station, run.frames ?? []])),
  });
  for (const run of runs) {
    console.log(
      `capture-route: [sweep panel] ${key} ${run.station} verdict=${run.analysis.verdict}${run.analysis.reasons?.length ? ` (${run.analysis.reasons.join('; ')})` : ''}`,
    );
  }
  console.log(`capture-route: [sweep panel] -> ${sweepPath} pass=${pass}`);
  return { pass, file: sweepPath.slice(outDir.length + 1), filmWindows: runs.map((run) => ({ label: run.station, frames: run.frames ?? [] })) };
}

/**
 * Round 2 --sweep dither: park at k + 0.5 ± 0.08 (inside the 0.15 latch band)
 * and wheel ±40 px 20×; zero nearest / chip / key-light changes expected.
 * k = roster -> teams (1) by default, or the first requested section when
 * --sections names a subset.
 */
async function runDitherArm(page, key, revealGate, sweepPath) {
  const k = sections.length === SECTIONS.length ? 1 : Math.min(SECTIONS.indexOf(sections[0]), SECTIONS.length - 2);
  const startSettle = await landSettle(page, SECTIONS[k]);
  const parks = await runDither(page, { k });
  const pass = parks.every((park) => park.analysis.verdict === 'pass');
  await writeJson(sweepPath, {
    kind: 'sweep',
    mode: 'dither',
    viewport: key,
    crossing: `${SECTIONS[k]}->${SECTIONS[k + 1]}`,
    revealGate,
    startSettle,
    pass,
    parks: parks.map(({ frames: _frames, ...park }) => park),
    notes: [
      'park = scroll bisection until exact is within 0.005 of k+0.5+-0.08, then wait for smooth to catch it; the recorder arms after the park',
      'dither = alternating wheel +-40 px, 20 cycles, 90 ms apart, pointer at the viewport centre',
      'unmeasured = the gesture left the 0.15 band or a consumer channel was unreadable — never a pass',
    ],
    invocation,
    frames: parks.map((park) => park.frames),
  });
  for (const park of parks) {
    console.log(
      `capture-route: [sweep dither] ${key} target=${park.target.toFixed(3)} parked=${park.parked.exact?.toFixed?.(4)} verdict=${park.analysis.verdict}${park.analysis.reasons.length ? ` (${park.analysis.reasons.join('; ')})` : ''}`,
    );
  }
  console.log(`capture-route: [sweep dither] -> ${sweepPath} pass=${pass}`);
  return { pass, file: sweepPath.slice(outDir.length + 1), filmWindows: parks.map((park, i) => ({ label: `park${i}`, frames: park.frames ?? [] })) };
}

/**
 * Wave-2 r2 (W6 stale-latch gap): judge the conductor's `direction` field
 * itself against the follower's motion. progressFlips / againstInput only
 * read `smooth`, so a latch stuck on -1 while the input and `smooth` both go
 * forward (the scroll-end clamp, the first forward steps after a jitter
 * back-step) passed unseen.
 *
 * A frame pair is "against" when the latch is non-zero, |Δsmooth / Δt| is
 * above `epsPerS` (station units / s — frame-rate independent; 0.3 /s is
 * 0.005 per 60 Hz frame), direction = −sign(Δsmooth), AND the latch also
 * disagrees with the held input (inputSign). A latch that agrees with the
 * visitor's own input while the first-order follower still coasts toward a
 * target behind it (a back-step that lands ahead of `smooth`) is not stale.
 * A contiguous run longer than `limitMs` fails. direction 0 while moving is
 * rest decay's business and is only reported (zeroWhileMoving).
 */
export function latchAgainstMotion(frames, { epsPerS = 0.3, limitMs = 150 } = {}) {
  const runs = [];
  let open = null;
  let zeroMs = 0;
  let pairs = 0;
  const close = () => {
    if (open) runs.push({ ...open, durationMs: Math.round(open.to - open.from) });
    open = null;
  };
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (typeof a.smooth !== 'number' || typeof b.smooth !== 'number' || typeof b.t !== 'number' || typeof a.t !== 'number') {
      close();
      continue;
    }
    const dt = b.t - a.t;
    if (!(dt > 0)) continue;
    pairs += 1;
    const rate = ((b.smooth - a.smooth) / dt) * 1000;
    const moving = Math.abs(rate) > epsPerS;
    const dir = b.direction === 1 || b.direction === -1 ? b.direction : 0;
    const input = b.inputSign === 1 || b.inputSign === -1 ? b.inputSign : 0;
    if (moving && dir === 0) zeroMs += dt;
    const against = moving && dir !== 0 && dir === -Math.sign(rate) && (input === 0 || dir !== input);
    if (against) {
      if (open) {
        open.to = b.t;
        open.smoothTo = b.smooth;
      } else {
        open = { from: a.t, to: b.t, direction: dir, inputSign: input, smoothFrom: a.smooth, smoothTo: b.smooth, exact: b.exact ?? null };
      }
    } else {
      close();
    }
  }
  close();
  const worst = runs.reduce((w, r) => (w === null || r.durationMs > w.durationMs ? r : w), null);
  const failing = runs.filter((r) => r.durationMs > limitMs);
  return {
    verdict: pairs === 0 ? 'unmeasured' : failing.length > 0 ? 'fail' : 'pass',
    limitMs,
    epsPerS,
    maxMs: worst ? worst.durationMs : 0,
    worst,
    failing,
    runs: runs.length,
    zeroWhileMovingMs: Math.round(zeroMs),
  };
}

async function runSweepArmCore(page, key, revealGate) {
  const sweepPath = resolve(outDir, `${tag}-${evidenceArms.sweep}-${key}-sweep.json`);
  if (!REVEALED_MODES.includes(revealGate.mode)) {
    throw new Error(
      `--sweep needs the route tier, but the reveal gate resolved "${revealGate.mode}" (world-route-live=${revealGate.routeLive ?? 'n/a'}, ball=${revealGate.ballPhase ?? 'n/a'})`,
    );
  }
  if (evidenceArms.sweep === 'jump') return runJumpArm(page, key, revealGate, sweepPath);
  if (evidenceArms.sweep === 'panel') return runPanelArm(page, key, revealGate, sweepPath);
  if (evidenceArms.sweep === 'dither') return runDitherArm(page, key, revealGate, sweepPath);
  const ends = sweepEndpoints(evidenceArms.sweep, sections, SECTIONS);
  if (ends.fromIndex === ends.toIndex) {
    throw new Error(`--sweep needs at least two stations in --sections (got ${sections.join(',')})`);
  }
  // Round 1: the start station is asserted like any still's (one re-seek,
  // then a loud named failure recorded in the -sweep.json).
  let startSettle;
  try {
    ({ settle: startSettle } = await landStation(page, ends.from));
  } catch (err) {
    if (err && typeof err === 'object' && 'stationSettle' in err) {
      await writeJson(sweepPath, {
        kind: 'sweep',
        failed: true,
        reason: 'station-settle-failed',
        mode: evidenceArms.sweep,
        viewport: key,
        from: ends.from,
        to: ends.to,
        revealGate,
        startSettle: err.stationSettle,
        invocation,
      });
    }
    throw err;
  }
  const result = await runSweep(page, { mode: evidenceArms.sweep, toIndex: ends.toIndex });
  // Round 3: station-pose endpoint heights — the start station's settled
  // camera, and the end station's when the gesture came to rest on it.
  const endRead = await readStationSettle(page);
  const stationY = {};
  if (Array.isArray(startSettle?.read?.camPos)) stationY[ends.fromIndex] = startSettle.read.camPos[1];
  if (
    Array.isArray(endRead.camPos) &&
    typeof endRead.exact === 'number' &&
    typeof endRead.smooth === 'number' &&
    Math.abs(endRead.exact - ends.toIndex) < STATION_SETTLE_EPS &&
    Math.abs(endRead.smooth - endRead.exact) < STATION_SETTLE_EPS
  ) {
    stationY[ends.toIndex] = endRead.camPos[1];
  }
  const analysis = await summarizeSweep(result.frames, { render: result.render, longTasks: result.longTasks, stationY });
  // Wave-2 r2: the latch field itself, against the follower's motion.
  analysis.latchAgainstMotion = latchAgainstMotion(result.frames);
  // Wave 2 round 2 (W6 judge): the Station Card's explicit enter / exit edges.
  analysis.cardEdges = cardEdgeVerdict(result.frames, { stationIds: SECTIONS });
  if (analysis.cardEdges.verdict === 'fail') {
    analysis.reasons.push(...analysis.cardEdges.reasons.map((r) => `card edge: ${r}`));
    analysis.verdict = 'fail';
  }
  if (analysis.latchAgainstMotion.verdict === 'fail') {
    const w = analysis.latchAgainstMotion.worst;
    analysis.reasons.push(
      `direction latch against motion ${w.durationMs} ms > ${analysis.latchAgainstMotion.limitMs} ms (direction ${w.direction}, input ${w.inputSign}, smooth ${w.smoothFrom.toFixed(3)}->${w.smoothTo.toFixed(3)} at t=${Math.round(w.from)})`,
    );
    analysis.verdict = 'fail';
  }
  await writeJson(sweepPath, {
    kind: 'sweep',
    mode: evidenceArms.sweep,
    viewport: key,
    from: ends.from,
    to: ends.to,
    // Round 1 (additive): the reveal gate and the start-station assertion.
    revealGate,
    startSettle,
    steps: result.steps,
    reachedTarget: result.reached,
    analysis,
    pass: analysis.verdict === 'pass' && result.reached,
    notes: [
      'inputSign = sign of the latest wheel deltaY (+1 = scroll down / forward); sticky between events',
      'progress = conductor smooth; yaw measured from the live camera (EvidenceBridges); progress reversals count only AGAINST the held input',
      'yaw reversals are listed for review; only a back-and-forth inside the oscillation window fails',
      'round 2: a progress reversal is attributed to the input held when its retreat began (lagAttributed, 150 ms window), not the frame the 0.02 deadband trips',
      `round 2: heights = per-crossing camera-y excursion above the higher endpoint (fail > ${analysis.heights.limitM} m); rosterTeams is the roster->teams crossing`,
      'round 2: consumers = nearest / aria-current chip / key-light / walker-group (visible figure ids, ~5 Hz) changes along the sweep (informational here; the dither mode judges them); frameGaps lists rAF gaps > 100 ms with the progress they hit',
      `round 2: maxFrameGapMs above ${analysis.frameGapLimitMs} ms fails the sweep (route tier); peakYawRateDegS = max |d yaw / dt| of the measured camera (the rig limiter caps the rendered rate at 200 deg/s)`,
      'round 3: yawRate.rendered = the per-DRAW turn rate from the gl.render wrapper (__routeWorldRenderLog): orientation change between consecutive R3F frames / that frame\'s own R3F delta (the limiter\'s clock); it fails the sweep above 200 deg/s + 5 %. yawRate.measured stays the rAF-sampled read for comparison; yawRate.rig is lastTurnDeltaRad / lastDt when CameraRig publishes them',
      'round 3: heights endpoints come from at-station frames, else the settled station pose (stationY), else interpolation across the station (<= 0.2 progress apart); a crossing with either endpoint unknown is unmeasured, never judged against one side; skip-through frames are excluded',
      'round 3: frameGaps.gaps[].attribution = page-long-task | recorder-only | no-page-long-task (PerformanceObserver longtask + render-log draws inside the gap) — a hint, not proof',
      'round 4: recorder-only needs >= 2 page draws inside the gap (the page kept presenting); <= 1 draw with no long task is page-gpu-or-compositor and countsAgainstProduct (frameGaps.productMaxGapMs); the run exits 1 when pass is false',
      `wave-2 r2: latchAgainstMotion = runs where the conductor direction is non-zero, opposite sign(d smooth / dt) with |rate| > ${analysis.latchAgainstMotion.epsPerS}/s, and not the held inputSign; a run > ${analysis.latchAgainstMotion.limitMs} ms fails the sweep (zeroWhileMovingMs is informational: rest decay)`,
    ],
    invocation,
    stationY,
    render: result.render,
    longTasks: result.longTasks,
    frames: result.frames,
  });
  console.log(
    `capture-route: [sweep] ${evidenceArms.sweep} ${ends.from}->${ends.to} steps=${result.steps} reached=${result.reached} frames=${result.frames.length} -> ${sweepPath} verdict=${analysis.verdict}${analysis.reasons.length ? ` (${analysis.reasons.join('; ')})` : ''}`,
  );
  const pass = analysis.verdict === 'pass' && result.reached;
  const filmWindows = [{ label: `${ends.from}->${ends.to}`, frames: result.frames }];
  const rt = analysis.heights.rosterTeams;
  console.log(
    `capture-route: [sweep] heights=${analysis.heights.verdict} roster->teams excursion=${rt ? `${rt.excursionM} m (endpoints ${rt.endpointY.map((y) => (y === null ? 'n/a' : y.toFixed(3))).join('/')}, max ${rt.maxY.toFixed(3)})` : 'not crossed'} lagAttributed=${analysis.lagAttributed.length} frameGaps=${analysis.frameGaps.count} maxFrameGapMs=${analysis.maxFrameGapMs} (limit ${analysis.frameGapLimitMs}: ${analysis.frameGapVerdict}) peakYawRate=${analysis.peakYawRateDegS}deg/s renderedYawRate=${analysis.renderedYawRateDegS ?? 'n/a'}deg/s (${analysis.yawRate.rendered.verdict}) gapAttribution=${analysis.frameGaps.gaps.map((g) => `${g.gapMs}:${g.attribution}`).join(',') || 'none'} latchAgainstMotion=${analysis.latchAgainstMotion.verdict} max=${analysis.latchAgainstMotion.maxMs}ms`,
  );
  return { pass, file: sweepPath.slice(outDir.length + 1), filmWindows };
}

/**
 * Round 5 --sweep-film: the sweep / --chip-jump / --panel-edge arm under a
 * CDP screencast, then a labelled ~12-frame montage of the gesture
 * (<tag>-<mode>-<vp>-sweep-film.png) and its frame index
 * (-sweep-film.json). The -sweep.json gains a `film` block and the note that
 * the run carried capture load. Film frames map onto the recorder's rAF clock
 * through performance.timeOrigin (good to about one frame).
 */
async function runSweepArm(page, key, revealGate) {
  if (!evidenceArms.sweepFilm) return runSweepArmCore(page, key, revealGate);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  // LOOK r2 SEAT H: --dolly-stills needs frames good enough to judge a halo.
  const film = await startLoaderFilm(page, { quality: dollyStillsOn || r6Flags.dollyAt ? 92 : 70 });
  let out;
  let captured;
  try {
    out = await runSweepArmCore(page, key, revealGate);
  } finally {
    captured = await film.stop();
  }
  const sweepPath = resolve(outDir, `${tag}-${evidenceArms.sweep}-${key}-sweep.json`);
  const stripPath = resolve(outDir, `${tag}-${evidenceArms.sweep}-${key}-sweep-film.png`);
  const indexPath = resolve(outDir, `${tag}-${evidenceArms.sweep}-${key}-sweep-film.json`);
  const frames = captured.frames.map((f) => ({ ...f, t: f.epochMs - timeOrigin }));
  const windows = (out.filmWindows ?? [])
    .map((w) => {
      // The moving part of the window (the settle tail's rest pose is trimmed).
      const span = motionWindow(w.frames);
      return span ? { label: w.label, from: span.from, to: span.to, frames: w.frames } : null;
    })
    .filter(Boolean);
  const picks = sweepFilmPicks(
    frames.map((f) => f.t),
    windows,
  );
  const rows = picks.map((pick) => {
    const w = windows.find((x) => x.label === pick.window);
    const telemetry = w ? nearestTelemetry(w.frames, pick.t) : null;
    return {
      ...pick,
      label: sweepFilmLabel(pick, w ? w.from : pick.t, telemetry, SECTIONS),
      telemetryT: telemetry ? telemetry.t : null,
    };
  });
  // LOOK r2 SEAT H (CLARITY judge: 326 px cells cannot rule a halo in or
  // out): montage cells are SWEEP_FILM_CELL_W (480) px wide, 3 per row.
  const layout = rows.length
    ? await writeStrip(
        rows.map((r) => frames[r.index].data),
        stripPath,
        rows.map((r) => r.label),
        { thumbW: SWEEP_FILM_CELL_W, maxCols: 3 },
      )
    : null;
  // LOOK r2 SEAT H --dolly-stills: the film frame at each quarter point
  // (k + 0.25 / 0.5 / 0.75 of smooth progress) of every crossing, written at
  // the screencast's full resolution (the viewport's CSS size), one PNG each.
  let dolly = null;
  if (dollyStillsOn) {
    const times = frames.map((f) => f.t);
    const stills = [];
    for (const w of windows) {
      for (const point of dollyQuarterTimes(w.frames)) {
        const index = filmFrameFor(times, point.t);
        if (index === -1) {
          stills.push({ window: w.label, ...point, file: null, reason: 'no film frame' });
          continue;
        }
        const name = `${tag}-${evidenceArms.sweep}-${key}-dolly-${String(stills.length + 1).padStart(2, '0')}-s${point.at.toFixed(2).replace('.', 'p')}.png`;
        const outFile = resolve(outDir, name);
        const info = await sharp(frames[index].data).png().toFile(outFile);
        stills.push({ window: w.label, ...point, frameT: +frames[index].t.toFixed(1), lagMs: +(frames[index].t - point.t).toFixed(1), file: name, width: info.width, height: info.height });
      }
    }
    dolly = {
      stills,
      notes: [
        'dolly stills = the screencast frame showing each quarter point (k + 0.25 / 0.5 / 0.75 of conductor smooth progress, linearly interpolated between recorder frames) of every station crossing in the gesture; the first frame at or after the point within 120 ms, else the last before (lagMs = frame time - point time)',
        'frames are JPEG q92 screencast frames re-encoded as PNG at the viewport size (full resolution at DPR 1); the screencast adds capture load, so the run is not a timing reference',
      ],
    };
    console.log(`capture-route: [dolly-stills] ${stills.filter((s) => s.file).length}/${stills.length} quarter-point stills -> ${outDir}`);
  }
  // LOOK r6 SEAT H7 --dolly-at <s,...> (CLARITY r5: "r4 showed a lamp over
  // the aces at s=3.64 and the r5 film has no frame there"): the film frame
  // at each chosen conductor progress point of every crossing, with the
  // recorder's camera pose beside it (a -dollyat-NN-s<k>p<q>.json sidecar,
  // so the look probe can project it); with --look-probe each is probed.
  let dollyAt = null;
  if (r6Flags.dollyAt) {
    const times = frames.map((f) => f.t);
    const stills = [];
    for (const w of windows) {
      for (const point of dollyTimesAt(w.frames, r6Flags.dollyAt)) {
        const index = filmFrameFor(times, point.t);
        if (index === -1) {
          stills.push({ window: w.label, ...point, file: null, reason: 'no film frame' });
          continue;
        }
        const telemetry = nearestTelemetry(w.frames, point.t);
        const pose = framePose(telemetry);
        const name = `${tag}-${evidenceArms.sweep}-${key}-dollyat-${String(stills.length + 1).padStart(2, '0')}-${dollyPointToken(point.at)}.png`;
        const outFile = resolve(outDir, name);
        const info = await sharp(frames[index].data).png().toFile(outFile);
        const [vw, vh] = VIEWPORTS[key];
        let probe = null;
        if (r6Flags.lookProbe && pose) {
          const img = await rawImage(outFile);
          probe = lookProbe(img, { pose, viewport: { width: vw, height: vh }, scale: img.width / vw, station: `dolly s=${point.at}`, theme: expectedTheme });
          console.log(`capture-route: [look-probe] ${probeLine(name, probe)}`);
        }
        await writeJson(outFile.replace(/\.png$/, '.json'), {
          kind: 'dolly-still',
          pass: true,
          at: point.at,
          direction: point.direction,
          window: w.label,
          frameT: +frames[index].t.toFixed(1),
          lagMs: +(frames[index].t - point.t).toFixed(1),
          viewportCss: { width: vw, height: vh },
          cameraPose: pose,
          ...(probe ? { lookProbe: probe } : {}),
          notes: ['cameraPose = the sweep recorder frame nearest the film frame (camPos / yaw / pitch / fov of __routeWorldCamera); the PNG is a screencast frame (DOM chrome included, no face masks)'],
          invocation,
        });
        stills.push({ window: w.label, ...point, frameT: +frames[index].t.toFixed(1), lagMs: +(frames[index].t - point.t).toFixed(1), file: name, width: info.width, height: info.height, pose });
      }
    }
    dollyAt = {
      points: r6Flags.dollyAt,
      stills,
      notes: ['the film frame at each --dolly-at conductor progress point of every crossing (linearly interpolated between recorder frames; the first frame at or after the point within 120 ms, else the last before); each PNG has a -dollyat-*.json sidecar with the camera pose'],
    };
    console.log(`capture-route: [dolly-at] ${stills.filter((s) => s.file).length}/${stills.length} stills at s=${r6Flags.dollyAt.join(',')} -> ${outDir}`);
  }
  const filmRecord = {
    source: captured.source,
    error: captured.error,
    dropped: captured.dropped,
    frames: frames.length,
    montage: layout ? stripPath.slice(outDir.length + 1) : null,
    montageFrames: rows.length,
    montageCellWidth: layout ? layout.thumbW : null,
    ...(dolly ? { dolly } : {}),
    ...(dollyAt ? { dollyAt } : {}),
    index: indexPath.slice(outDir.length + 1),
    cadence: filmCadence(frames.map((f) => ({ t: f.t, kind: f.kind }))),
  };
  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        kind: 'sweep-film',
        mode: evidenceArms.sweep,
        viewport: key,
        ...filmRecord,
        windows: windows.map(({ frames: _f, ...w }) => w),
        picks: rows,
        notes: [
          'frames = CDP Page.startScreencast (on change); t = epochMs - performance.timeOrigin on the recorder rAF clock (about one frame of error)',
          'windows = the moving part of each gesture window: first recorder frame to the last frame whose smooth progress, camera position or panel state changed, + 250 ms (the settle tail is trimmed)',
          'label = window (sweep / jump leg / panel station / dither park), ms since the window start, conductor smooth progress and nearest station at the closest recorder frame, plus skip / panel state',
          'the screencast adds capture load: a film run is NOT a timing reference; judge frame gaps and yaw rates from a run without --sweep-film',
        ],
        invocation,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  // Stamp the film into the sweep record (the arm already wrote it).
  try {
    const body = JSON.parse(await readFile(sweepPath, 'utf8'));
    body.film = filmRecord;
    body.notes = [...(Array.isArray(body.notes) ? body.notes : []), 'round 5: --sweep-film was on — this run carried screencast load; it is not a timing reference'];
    await writeFile(sweepPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } catch {
    /* the arm threw before writing; the film index still stands */
  }
  console.log(`capture-route: [sweep-film] ${frames.length} frames -> ${layout ? stripPath : '(no montage: no frames inside the gesture windows)'} (${rows.length} labelled)`);
  return out;
}

// >>> quiet-probe:pure
// ---------------------------------------------------------------------------
// LOOK-PLAN §2 SEAT H — the post-reveal quiet probe (D23 "complete at
// reveal"): pure counting / verdict helpers plus the in-page recorder. This
// block is SELF-CONTAINED (no reference to anything outside it) so the script
// test (scripts/__tests__/quiet-probe.test.mjs) can lift it out of this file
// and import it without running the harness.
// ---------------------------------------------------------------------------

/**
 * World-asset URLs (LOOK-PLAN §2 H.4): the asset base's local mirror
 * (/models/world, D22), the Supabase world-assets bucket and the app-static
 * world textures (/textures/world). Everything else a page fetches after
 * reveal is reported (otherFetches) but not judged.
 */
export const QUIET_WORLD_ASSET_RE = /\/models\/world\/|\/textures\/world\/|\/storage\/v1\/object\/public\/world-assets\//;
/** A long task is a main-thread task of at least this many ms (the Long Tasks API floor). */
export const QUIET_LONG_TASK_MS = 50;
/** The four judged counts, in report order. */
export const QUIET_COUNT_KEYS = ['worldFetches', 'programs', 'textures', 'longTasks'];

/** Whether a fetched URL is a world asset (pathname match; query strings ignored). */
export function isWorldAssetUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let path = url;
  try {
    path = new URL(url, 'http://quiet.invalid').pathname;
  } catch {
    /* keep the raw string */
  }
  return QUIET_WORLD_ASSET_RE.test(path);
}

/**
 * R40 / R38 (D23): an app JS chunk or any script resource fetched after the
 * reveal (a late dynamic import()). Next serves chunks under
 * /_next/static/chunks/; any other script-typed entry (the PerformanceObserver
 * initiatorType or the browser request's resourceType 'script') or a .js /
 * .mjs path counts too. HMR updates (.hot-update.js) count: they mean the tree
 * changed under the capture.
 */
export const QUIET_JS_CHUNK_RE = /\/_next\/static\/chunks\//;
export function isScriptChunk(url, kind = null) {
  if (typeof url !== 'string' || url.length === 0) return false;
  let path = url;
  try {
    path = new URL(url, 'http://quiet.invalid').pathname;
  } catch {
    /* keep the raw string */
  }
  if (QUIET_JS_CHUNK_RE.test(path)) return true;
  if (kind === 'script') return true;
  return /\.m?js$/i.test(path);
}

/** Same-origin script / chunk / document fetches are not "other" evidence worth listing. */
function isAppChunk(url) {
  return /\/_next\/|\/__nextjs|webpack-hmr|\.hot-update\./.test(url);
}

function inWindow(t, t0, t1) {
  return typeof t === 'number' && t >= t0 && t <= t1;
}

function numberOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The per-leg counts from the page recorder's raw records (every stamp on the
 * page clock, performance.now()).
 *
 * @param {object} args
 * @param {{ t: number, links?: number, info?: { programs: number|null, textures: number|null } | null, glDebugPrograms?: number|null }} args.start
 * @param {{ t: number, links?: number, info?: { programs: number|null, textures: number|null } | null, glDebugPrograms?: number|null }} args.end
 * @param {object} args.raw  { resources[{name,t}], requests[{url,t}]|null, longTasks[{t,d}], links[t],
 *                             textures[{createdAt, firstDataAt, deletedAt}], reuploads[t], rbAllocs[t], induced[[a,b]] }
 * @param {{ resource: boolean, longtask: boolean, gl: boolean }} args.observers
 * @param {'strict'|'governor'} [args.mode]
 *
 * strict   — worldFetches / programs / textures / longTasks, each must be 0.
 * governor — textures counts only what the render-target reallocations do
 *            NOT explain: asset (pixel-data) uploads plus |memory Δ − RT net|.
 */
export function quietLegCounts({ start, end, raw, observers, mode = 'strict' }) {
  const t0 = start.t;
  const t1 = end.t;
  const induced = Array.isArray(raw.induced) ? raw.induced : [];
  const isInduced = (t) => induced.some(([a, b]) => t >= a && t <= b);

  // Fetches: the PerformanceObserver 'resource' channel and the browser's own
  // request events (Playwright); the larger of the two is judged.
  const perfUrls = (raw.resources ?? []).filter((r) => inWindow(r.t, t0, t1)).map((r) => r.name);
  const reqUrls = Array.isArray(raw.requests) ? raw.requests.filter((r) => inWindow(r.t, t0, t1)).map((r) => r.url) : [];
  const perfWorld = perfUrls.filter(isWorldAssetUrl);
  const reqWorld = reqUrls.filter(isWorldAssetUrl);
  const fetchMeasured = observers.resource === true || Array.isArray(raw.requests);
  const worldFetchUrls = [...new Set([...perfWorld, ...reqWorld])];
  const worldFetches = fetchMeasured ? Math.max(perfWorld.length, reqWorld.length) : null;
  const otherFetchUrls = [...new Set([...perfUrls, ...reqUrls].filter((u) => !isWorldAssetUrl(u) && !isAppChunk(u)))];
  // R40 / R38: post-reveal JS chunk fetches, the same two channels, judged like world fetches.
  const perfChunks = (raw.resources ?? []).filter((r) => inWindow(r.t, t0, t1) && isScriptChunk(r.name, r.initiator === 'script' ? 'script' : null)).map((r) => r.name);
  const reqChunks = Array.isArray(raw.requests) ? raw.requests.filter((r) => inWindow(r.t, t0, t1) && isScriptChunk(r.url, r.type ?? null)).map((r) => r.url) : [];
  const jsChunkUrls = [...new Set([...perfChunks, ...reqChunks])];
  const jsChunks = fetchMeasured ? Math.max(perfChunks.length, reqChunks.length) : null;

  // Programs: GL linkProgram calls (every link, even one whose program is
  // later released) and the renderer.info.programs delta (the debug handle
  // __routeWorldGlDebug, else the renderer seen through three's devtools hook).
  const links = observers.gl === true ? (raw.links ?? []).filter((t) => inWindow(t, t0, t1)).length : null;
  const progStart = numberOrNull(start.glDebugPrograms) ?? numberOrNull(start.info?.programs);
  const progEnd = numberOrNull(end.glDebugPrograms) ?? numberOrNull(end.info?.programs);
  const programsDelta = progStart !== null && progEnd !== null ? progEnd - progStart : null;
  const programs = links === null && programsDelta === null ? null : Math.max(links ?? 0, Math.max(0, programsDelta ?? 0));

  // Textures: renderer.info.memory.textures delta plus the GL ledger —
  // assetUploads = textures whose FIRST pixel-data upload falls in the leg;
  // RT (storage-only) textures created / deleted in the leg; reuploads =
  // pixel data into textures that already had data (live canvases, e.g. the
  // boards' ticker — reported, never judged).
  const memStart = numberOrNull(start.info?.textures);
  const memEnd = numberOrNull(end.info?.textures);
  const memTexturesDelta = memStart !== null && memEnd !== null ? memEnd - memStart : null;
  let assetUploads = null;
  let rtCreated = null;
  let rtDeleted = null;
  let dataDeleted = null;
  if (observers.gl === true) {
    assetUploads = 0;
    rtCreated = 0;
    rtDeleted = 0;
    dataDeleted = 0;
    for (const rec of raw.textures ?? []) {
      const hasDataByEnd = typeof rec.firstDataAt === 'number' && rec.firstDataAt <= t1;
      if (inWindow(rec.firstDataAt, t0, t1)) assetUploads += 1;
      if (inWindow(rec.createdAt, t0, t1) && !hasDataByEnd) rtCreated += 1;
      if (inWindow(rec.deletedAt, t0, t1)) {
        if (typeof rec.firstDataAt === 'number') dataDeleted += 1;
        else rtDeleted += 1;
      }
    }
  }
  const rtNet = rtCreated !== null && rtDeleted !== null ? rtCreated - rtDeleted : null;
  let textures;
  if (memTexturesDelta === null && assetUploads === null) textures = null;
  else if (mode === 'governor') {
    const unexplained = memTexturesDelta !== null && rtNet !== null ? Math.abs(memTexturesDelta - rtNet) : 0;
    textures = Math.max(assetUploads ?? 0, unexplained);
  } else {
    textures = Math.max(Math.max(0, memTexturesDelta ?? 0), assetUploads ?? 0);
  }
  const reuploads = observers.gl === true ? (raw.reuploads ?? []).filter((t) => inWindow(t, t0, t1)).length : null;
  const rbAllocs = observers.gl === true ? (raw.rbAllocs ?? []).filter((t) => inWindow(t, t0, t1)).length : null;

  // Long tasks (>= 50 ms) that start in the leg; tasks inside a harness-induced
  // stress window (the governor drive's frame load) are listed apart.
  let longTasks = null;
  let inducedLongTasks = null;
  let longTaskList = [];
  if (observers.longtask === true) {
    const all = (raw.longTasks ?? []).filter((e) => inWindow(e.t, t0, t1) && e.d >= QUIET_LONG_TASK_MS);
    longTaskList = all.filter((e) => !isInduced(e.t));
    longTasks = longTaskList.length;
    inducedLongTasks = all.length - longTasks;
  }

  return {
    worldFetches,
    programs,
    textures,
    longTasks,
    jsChunks,
    detail: {
      worldFetchUrls,
      jsChunkUrls,
      perfWorldFetches: perfWorld.length,
      requestWorldFetches: Array.isArray(raw.requests) ? reqWorld.length : null,
      otherFetchUrls,
      links,
      programsStart: progStart,
      programsEnd: progEnd,
      programsDelta,
      memTexturesStart: memStart,
      memTexturesEnd: memEnd,
      memTexturesDelta,
      assetUploads,
      rtCreated,
      rtDeleted,
      rtNet,
      dataDeleted,
      reuploads,
      rbAllocs,
      longTaskList: longTaskList.map((e) => ({ t: Math.round(e.t), d: Math.round(e.d) })),
      inducedLongTasks,
    },
  };
}

/**
 * One leg's verdict. strict: all four counts 0. governor (leg c): programs,
 * fetches and long tasks 0, and the texture change fully explained by the
 * reported render-target reallocations. An unreadable count is `unmeasured`,
 * which is never a pass.
 */
export function quietLegVerdict(counts, { mode = 'strict' } = {}) {
  const reasons = [];
  const unmeasured = QUIET_COUNT_KEYS.filter((k) => counts[k] === null || counts[k] === undefined);
  const d = counts.detail ?? {};
  if (counts.worldFetches > 0) {
    reasons.push(`${counts.worldFetches} world-asset fetch(es) after reveal (${(d.worldFetchUrls ?? []).slice(0, 3).map((u) => u.replace(/^https?:\/\/[^/]+/, '')).join(', ')}${(d.worldFetchUrls ?? []).length > 3 ? ', ...' : ''})`);
  }
  if (counts.jsChunks > 0) {
    reasons.push(`${counts.jsChunks} JS chunk / script fetch(es) after reveal (D23, R38: ${(d.jsChunkUrls ?? []).slice(0, 3).map((u) => u.replace(/^https?:\/\/[^/]+/, '')).join(', ')}${(d.jsChunkUrls ?? []).length > 3 ? ', ...' : ''})`);
  }
  if (counts.programs > 0) reasons.push(`${counts.programs} program link(s) after reveal (gl links ${d.links ?? 'n/a'}, renderer.info.programs ${d.programsStart ?? '?'} -> ${d.programsEnd ?? '?'})`);
  if (counts.textures > 0) {
    reasons.push(
      mode === 'governor'
        ? `texture change not explained by RT reallocations (asset uploads ${d.assetUploads ?? 'n/a'}, memory.textures delta ${d.memTexturesDelta ?? 'n/a'} vs RT net ${d.rtNet ?? 'n/a'})`
        : `${counts.textures} texture upload(s) after reveal (asset uploads ${d.assetUploads ?? 'n/a'}, memory.textures delta ${d.memTexturesDelta ?? 'n/a'})`,
    );
  }
  if (counts.longTasks > 0) reasons.push(`${counts.longTasks} long task(s) >= 50 ms (${(d.longTaskList ?? []).slice(0, 4).map((e) => `${e.d}ms@${e.t}`).join(', ')})`);
  const verdict = reasons.length > 0 ? 'fail' : unmeasured.length > 0 ? 'unmeasured' : 'pass';
  if (verdict === 'unmeasured') reasons.push(`unmeasured: ${unmeasured.join(', ')}`);
  return { verdict, mode, reasons, unmeasured };
}

/** The run verdict over the judged legs: every one passes (unmeasured is never a pass). */
export function quietProbeVerdict(legs) {
  const judged = legs.filter((leg) => leg.judged !== false);
  const failing = judged.filter((leg) => leg.verdict?.verdict !== 'pass').map((leg) => `${leg.name}: ${leg.verdict?.verdict ?? 'missing'}${leg.verdict?.reasons?.length ? ` (${leg.verdict.reasons.join('; ')})` : ''}`);
  return { pass: judged.length > 0 && failing.length === 0, judged: judged.length, failing };
}

/**
 * --quiet-inject self-test: the injected fetch / program must be what failed
 * the leg (so a tree that is already dirty cannot fake a detection).
 */
export function quietInjectDetected(kind, leg, inject) {
  if (!inject || inject.fired !== true) return { detected: false, reason: `inject did not fire (${inject?.reason ?? 'no record'})` };
  if (!leg || leg.verdict?.verdict !== 'fail') return { detected: false, reason: `the injected leg did not fail (verdict ${leg?.verdict?.verdict ?? 'missing'})` };
  if (kind === 'fetch') {
    const hit = (leg.counts?.detail?.worldFetchUrls ?? []).some((u) => typeof u === 'string' && u.includes(inject.marker));
    return hit ? { detected: true } : { detected: false, reason: `the injected URL (${inject.marker}) is not among the leg's world-asset fetches` };
  }
  if (kind === 'program') {
    const linked = typeof inject.linksAfter === 'number' && typeof inject.linksBefore === 'number' && inject.linksAfter > inject.linksBefore;
    if (!linked) return { detected: false, reason: 'no GL link was observed while the injected material rendered' };
    return (leg.counts?.programs ?? 0) >= 1 ? { detected: true } : { detected: false, reason: 'the leg counted 0 programs' };
  }
  return { detected: false, reason: `unknown inject kind ${kind}` };
}

/**
 * --quiet-theme: exactly one new scene generation with its own complete
 * ceremony (the ball went through loading and ended done; the generation
 * presented), and no further generation after it.
 */
export function quietThemeVerdict({ themeBefore, themeAfter, generationBefore, generationAfter, generationHeld, ballPhasesAfter, presented }) {
  const reasons = [];
  if (!themeAfter || themeAfter === themeBefore) reasons.push(`data-theme did not flip (${themeBefore ?? 'n/a'} -> ${themeAfter ?? 'n/a'})`);
  const gensReadable = [generationBefore, generationAfter, generationHeld].every((g) => typeof g === 'number');
  if (gensReadable) {
    if (generationAfter !== generationBefore + 1) reasons.push(`expected exactly one new generation (before ${generationBefore}, after ${generationAfter})`);
    if (generationHeld !== generationAfter) reasons.push(`the generation moved again after the ceremony (${generationAfter} -> ${generationHeld})`);
  }
  const phases = Array.isArray(ballPhasesAfter) ? ballPhasesAfter : [];
  if (!phases.includes('loading')) reasons.push('no ball ceremony after the toggle (the ball never entered loading)');
  else if (phases[phases.length - 1] !== 'done') reasons.push(`the ceremony did not complete (last ball phase ${phases[phases.length - 1]})`);
  if (presented !== true) reasons.push('the new generation never presented');
  const verdict = reasons.length > 0 ? 'fail' : gensReadable ? 'pass' : 'unmeasured';
  if (verdict === 'unmeasured') reasons.push('unmeasured: scene generation unreadable (__routeWorldReadiness absent)');
  return { verdict, reasons };
}

/**
 * --prod-attach: classify the server from the listener's process chain
 * (listener, parent, grandparent ... command lines). `dev` wins over `start`
 * (a dev launcher above a worker is still dev); no match is `unknown`.
 */
export function prodServerKind(commandLines) {
  const lines = (Array.isArray(commandLines) ? commandLines : []).filter((s) => typeof s === 'string' && s.length > 0);
  const nextCmd = (verb) => new RegExp(`(?:^|[\\s"'\\\\/])next(?:\\.js|\\.cmd|\\.ps1)?["']?\\s+${verb}(?:\\s|$|")`, 'i');
  const npmCmd = (verb) => new RegExp(`(?:^|[\\s"'\\\\/])(?:npm|pnpm|yarn)(?:\\.cmd)?["']?\\s+(?:run\\s+)?${verb}(?:\\s|$|")`, 'i');
  if (lines.some((s) => nextCmd('dev').test(s) || npmCmd('dev').test(s))) return 'dev';
  if (lines.some((s) => nextCmd('start').test(s) || npmCmd('start').test(s))) return 'start';
  return 'unknown';
}

/** The ladder rung from the debug readout's `rung  N · fps ...` line, or null. */
export function parseDebugRung(text) {
  if (typeof text !== 'string') return null;
  const m = /^rung\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * The in-page recorder (addInitScript, before navigation). Serialized by
 * Playwright, so it references nothing outside itself. Installs:
 *  - PerformanceObserver 'resource' + 'longtask' (buffered; the resource
 *    timing buffer is raised so a heavy load cannot drop post-reveal entries);
 *  - three's devtools hook (__THREE_DEVTOOLS__ 'observe') to hold the
 *    WebGLRenderer, for renderer.info.programs / memory.textures;
 *  - WebGL(2) prototype counters: linkProgram, per-texture create / first
 *    pixel-data upload / delete, re-uploads, renderbuffer allocations;
 *  - a world-route-live watcher that snapshots the moment the class lands.
 * Read through window.__quietProbe.{snapshot,status,window}.
 */
export function installQuietProbe(opts) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  if (w.__quietProbe) return;
  const maxLog = (opts && opts.maxLog) || 50000;
  const now = () => performance.now();
  const state = {
    links: [],
    resources: [],
    longTasks: [],
    reuploads: [],
    rbAllocs: [],
    textures: [],
    renderers: [],
    liveAt: null,
    liveSnapshot: null,
    liveTransitions: [],
    observers: { resource: false, longtask: false, gl: false },
    dropped: 0,
    // LOOK r4 (CAR r3: "dropped 34230"): drops are accounted per kind. The
    // log kinds the D23 counters judge by time window keep their NEWEST
    // entries (the post-reveal legs): when full, the oldest half is evicted
    // and `evicted[kind].before` says up to when a window is incomplete.
    // Texture records are never evicted (an old texture's first upload after
    // the reveal is exactly what the counter must see); they, and links, fall
    // back to dropping the newest only at the hard cap, counted in droppedByKind.
    droppedByKind: {},
    evicted: {},
    errors: [],
  };
  const hardCap = Math.max(maxLog, (opts && opts.hardCap) || maxLog * 20);
  const kindOf = (list) =>
    list === state.links ? 'links' : list === state.textures ? 'textures' : list === state.resources ? 'resources' : list === state.longTasks ? 'longTasks' : list === state.reuploads ? 'reuploads' : list === state.rbAllocs ? 'rbAllocs' : 'other';
  const timeOf = (v) => (typeof v === 'number' ? v : v && typeof v.t === 'number' ? v.t : null);
  const push = (list, value) => {
    if (list.length < maxLog) {
      list.push(value);
      return;
    }
    const kind = kindOf(list);
    if (kind === 'textures' || kind === 'links') {
      if (list.length < hardCap) list.push(value);
      else {
        state.dropped += 1;
        state.droppedByKind[kind] = (state.droppedByKind[kind] || 0) + 1;
      }
      return;
    }
    const cut = list.splice(0, list.length >> 1);
    const ev = state.evicted[kind] || { count: 0, before: null };
    ev.count += cut.length;
    const last = timeOf(cut[cut.length - 1]);
    if (last !== null) ev.before = last;
    state.evicted[kind] = ev;
    list.push(value);
  };
  const note = (where, err) => {
    if (state.errors.length < 20) state.errors.push(`${where}: ${String((err && err.message) || err)}`);
  };

  // three's devtools hook: the renderer announces itself on construction.
  try {
    const onObserve = (event) => {
      const d = event && event.detail;
      if (d && d.isWebGLRenderer) {
        state.renderers.push(d);
        if (state.renderers.length > 4) state.renderers.shift();
      }
    };
    const existing = w.__THREE_DEVTOOLS__;
    if (existing && typeof existing.addEventListener === 'function') existing.addEventListener('observe', onObserve);
    else if (typeof existing === 'undefined' && typeof EventTarget === 'function') {
      const target = new EventTarget();
      target.addEventListener('observe', onObserve);
      w.__THREE_DEVTOOLS__ = target;
    }
  } catch (err) {
    note('devtools', err);
  }

  try {
    if (typeof performance.setResourceTimingBufferSize === 'function') performance.setResourceTimingBufferSize(100000);
  } catch (err) {
    note('resource-buffer', err);
  }
  const observe = (type, onEntry) => {
    try {
      if (typeof PerformanceObserver !== 'function') return;
      const supported = PerformanceObserver.supportedEntryTypes;
      if (Array.isArray(supported) && !supported.includes(type)) return;
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      });
      po.observe({ type, buffered: true });
      state.observers[type] = true;
    } catch (err) {
      note(`observer:${type}`, err);
    }
  };
  observe('resource', (e) => push(state.resources, { name: e.name, t: e.startTime, initiator: e.initiatorType || null }));
  observe('longtask', (e) => push(state.longTasks, { t: e.startTime, d: e.duration }));

  // WebGL counters.
  const records = new WeakMap();
  const ctxState = new WeakMap();
  const CUBE = 0x8513;
  const bindTarget = (target) => (target >= 0x8515 && target <= 0x851a ? CUBE : target);
  const stateOf = (gl) => {
    let s = ctxState.get(gl);
    if (!s) {
      s = { unit: 0, bound: new Map() };
      ctxState.set(gl, s);
    }
    return s;
  };
  const recordFor = (tex) => {
    if (!tex) return null;
    let rec = records.get(tex);
    if (!rec) {
      rec = { createdAt: null, firstDataAt: null, deletedAt: null };
      records.set(tex, rec);
      push(state.textures, rec);
    }
    return rec;
  };
  const onData = (gl, target) => {
    const tex = stateOf(gl).bound.get(`${stateOf(gl).unit}|${bindTarget(target)}`);
    const rec = recordFor(tex);
    if (!rec) return;
    if (rec.firstDataAt === null) rec.firstDataAt = now();
    else push(state.reuploads, now());
  };
  const wrap = (proto, name, after) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function' || orig.__quietWrapped) return;
    const wrapped = function quietWrapped() {
      const result = orig.apply(this, arguments);
      try {
        after(this, arguments, result);
      } catch {
        /* never break the page's GL call */
      }
      return result;
    };
    wrapped.__quietWrapped = true;
    proto[name] = wrapped;
  };
  const protos = [w.WebGLRenderingContext, w.WebGL2RenderingContext].filter((c) => typeof c === 'function').map((c) => c.prototype);
  for (const proto of protos) {
    try {
      wrap(proto, 'linkProgram', () => push(state.links, now()));
      wrap(proto, 'createTexture', (gl, args, tex) => {
        const rec = recordFor(tex);
        if (rec) rec.createdAt = now();
      });
      wrap(proto, 'deleteTexture', (gl, args) => {
        const rec = args[0] ? records.get(args[0]) : null;
        if (rec) rec.deletedAt = now();
      });
      wrap(proto, 'activeTexture', (gl, args) => {
        stateOf(gl).unit = args[0];
      });
      wrap(proto, 'bindTexture', (gl, args) => {
        const s = stateOf(gl);
        s.bound.set(`${s.unit}|${bindTarget(args[0])}`, args[1] || null);
      });
      // texImage2D(target, level, ifmt, w, h, border, fmt, type, pixels|offset) or (target, level, ifmt, fmt, type, source).
      wrap(proto, 'texImage2D', (gl, args) => {
        if (args.length >= 9 && (args[8] === null || args[8] === undefined)) return; // storage-only allocation
        onData(gl, args[0]);
      });
      wrap(proto, 'texImage3D', (gl, args) => {
        if (args.length >= 10 && (args[9] === null || args[9] === undefined)) return;
        onData(gl, args[0]);
      });
      for (const name of ['texSubImage2D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexImage3D', 'compressedTexSubImage2D', 'compressedTexSubImage3D']) {
        wrap(proto, name, (gl, args) => onData(gl, args[0]));
      }
      for (const name of ['renderbufferStorage', 'renderbufferStorageMultisample']) {
        wrap(proto, name, () => push(state.rbAllocs, now()));
      }
      state.observers.gl = true;
    } catch (err) {
      note('gl-wrap', err);
    }
  }

  const renderer = () => (state.renderers.length > 0 ? state.renderers[state.renderers.length - 1] : null);
  const snapshot = () => {
    const r = renderer();
    let info = null;
    try {
      if (r && r.info) {
        info = {
          programs: Array.isArray(r.info.programs) ? r.info.programs.length : null,
          textures: r.info.memory && typeof r.info.memory.textures === 'number' ? r.info.memory.textures : null,
          geometries: r.info.memory && typeof r.info.memory.geometries === 'number' ? r.info.memory.geometries : null,
        };
      }
    } catch (err) {
      note('snapshot:info', err);
    }
    let glDebugPrograms = null;
    try {
      if (typeof w.__routeWorldGlDebug === 'function') {
        const g = w.__routeWorldGlDebug();
        glDebugPrograms = g && typeof g.programs === 'number' ? g.programs : null;
      }
    } catch (err) {
      note('snapshot:glDebug', err);
    }
    let windows = null;
    try {
      const map = w.__c089Windows;
      if (map && typeof map === 'object') {
        windows = {};
        for (const key of Object.keys(map)) windows[key] = { resident: map[key].resident === true, entered: map[key].entered === true };
      }
    } catch (err) {
      note('snapshot:windows', err);
    }
    const t = now();
    return { t, epoch: performance.timeOrigin + t, links: state.links.length, info, glDebugPrograms, windows, rendererSeen: r !== null };
  };

  const watchLive = () => {
    const root = document.documentElement;
    if (!root) return false;
    const check = () => {
      const live = root.classList.contains('world-route-live');
      const last = state.liveTransitions[state.liveTransitions.length - 1];
      if (last && last.live === live) return;
      state.liveTransitions.push({ live, t: now() });
      if (live && state.liveAt === null) {
        state.liveAt = now();
        state.liveSnapshot = snapshot();
      }
    };
    check();
    new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ['class'] });
    return true;
  };
  try {
    if (typeof document !== 'undefined' && !watchLive()) {
      const mo = new MutationObserver(() => {
        if (watchLive()) mo.disconnect();
      });
      mo.observe(document, { childList: true });
    }
  } catch (err) {
    note('live-watch', err);
  }

  w.__quietProbe = {
    version: 1,
    snapshot,
    renderer,
    status: () => ({
      liveAt: state.liveAt,
      liveSnapshot: state.liveSnapshot,
      liveTransitions: state.liveTransitions.slice(),
      observers: { ...state.observers },
      rendererSeen: renderer() !== null,
      dropped: state.dropped,
      droppedByKind: { ...state.droppedByKind },
      evicted: JSON.parse(JSON.stringify(state.evicted)),
      errors: state.errors.slice(),
      timeOrigin: performance.timeOrigin,
    }),
    window: (t0, t1) => {
      const inside = (t) => typeof t === 'number' && t >= t0 && t <= t1;
      return {
        resources: state.resources.filter((e) => inside(e.t)),
        longTasks: state.longTasks.filter((e) => inside(e.t)),
        links: state.links.filter(inside),
        reuploads: state.reuploads.filter(inside),
        rbAllocs: state.rbAllocs.filter(inside),
        textures: state.textures
          .filter((rec) => inside(rec.createdAt) || inside(rec.firstDataAt) || inside(rec.deletedAt))
          .map((rec) => ({ createdAt: rec.createdAt, firstDataAt: rec.firstDataAt, deletedAt: rec.deletedAt })),
      };
    },
  };
}
// <<< quiet-probe:pure

// ---------------------------------------------------------------------------
// LOOK-PLAN §2 SEAT H: the post-reveal quiet probe (--quiet-probe) and the
// production-server assertion (--prod-attach). The pure helpers and the
// in-page recorder live in the quiet-probe:pure block above.
// ---------------------------------------------------------------------------
/** Every leg ends with this still tail, so late work from the gesture lands inside it. */
const QUIET_TAIL_MS = 1_500;
/** The governor leg: settle after each rung step, and the per-step bound. */
const QUIET_GOVERNOR_SETTLE_MS = 2_000;
const QUIET_GOVERNOR_STEP_WAIT_MS = 20_000;
/** Stress drive (no force hook): per-rAF busy wait, above GOVERNOR.slowFrameMs (22) and far below a 50 ms long task. */
const QUIET_STRESS_BUSY_MS = 26;
/** The theme leg: data-theme flip bound, the new ceremony bound, and the hold that proves "exactly one" generation. */
const QUIET_THEME_FLIP_MS = 5_000;
const QUIET_THEME_CEREMONY_MS = 40_000;
const QUIET_THEME_HOLD_MS = 2_000;
/** The post-theme idle leg (the probe restarts in the new palette). */
const QUIET_RESTART_IDLE_MS = 2_000;
/** POKEMON-CORE A1: the busy leg's settle wait bound (the conductor's latched settle). */
const QUIET_BUSY_SETTLE_WAIT_MS = 15_000;
/** The injected program's render window (frames until the link shows). */
const QUIET_INJECT_FRAME_WAIT_MS = 3_000;

async function quietSnapshot(page) {
  return page.evaluate(() => (window.__quietProbe ? window.__quietProbe.snapshot() : null));
}

/** Rung + source: the force hook's read (G contract) when published, else the debug readout's `rung N` line. */
async function readQuietRung(page) {
  const read = await page.evaluate(() => {
    let hook = null;
    try {
      const fn = window.__routeWorldQuality;
      const body = typeof fn === 'function' ? fn() : null;
      if (body && typeof body.rung === 'number') hook = { rung: body.rung, pinned: body.pinned ?? null };
    } catch {
      hook = null;
    }
    const pre = document.querySelector('[data-route-debug-overlay] pre');
    return { hook, text: pre ? pre.textContent : null, pinnedParam: new URLSearchParams(location.search).get('routeQuality') };
  });
  if (read.hook) return { rung: read.hook.rung, source: '__routeWorldQuality', pinned: read.hook.pinned ?? read.pinnedParam !== null };
  const rung = parseDebugRung(read.text);
  return { rung, source: rung === null ? 'none' : 'debug-readout', pinned: read.pinnedParam !== null };
}

function quietWindowLatches(start, end) {
  if (!start?.windows || !end?.windows) return null;
  return Object.keys(end.windows).filter((key) => end.windows[key].resident === true && start.windows[key]?.resident !== true);
}

/**
 * Rollout A3 fix: the long animation frames (>= 50 ms, installLoafRecorder)
 * that overlap a leg window, with their script attribution and the scripts
 * summed by source, so a post-reveal long task names its code. null when the
 * recorder is absent; { supported: false } where the entry type is missing.
 */
async function quietLoafWindow(page, t0, t1) {
  try {
    const rec = await page.evaluate(
      ([a, b]) => {
        const r = window.__captureLoaf;
        if (!r) return null;
        return { supported: r.supported, dropped: r.dropped, rows: r.rows.filter((x) => x.start < b && x.start + x.duration > a) };
      },
      [t0, t1],
    );
    if (!rec) return null;
    if (!rec.supported) return { supported: false, rows: [] };
    const bySource = new Map();
    for (const row of rec.rows) {
      for (const s of row.scripts) {
        const source = `${s.sourceFunctionName || s.invoker || '?'} @ ${s.sourceURL || '?'}${s.sourceCharPosition !== null ? `:${s.sourceCharPosition}` : ''}`;
        const acc = bySource.get(source) ?? { source, ms: 0, frames: 0, invokerType: s.invokerType };
        acc.ms += s.ms;
        acc.frames += 1;
        bySource.set(source, acc);
      }
    }
    const topScripts = [...bySource.values()].map((x) => ({ ...x, ms: Math.round(x.ms) })).sort((a, b) => b.ms - a.ms).slice(0, 8);
    return {
      supported: true,
      dropped: rec.dropped,
      maxMs: rec.rows.reduce((m, r) => Math.max(m, r.duration), 0),
      rows: rec.rows,
      topScripts,
      notes: ['long animation frames >= 50 ms whose span overlaps the leg window (PerformanceObserver long-animation-frame); scripts top 8 per frame; topScripts sums script time by function @ source'],
    };
  } catch (err) {
    return { supported: null, error: err instanceof Error ? err.message : String(err), rows: [] };
  }
}

async function quietOpenLeg(page, name, start = null) {
  const snap = start ?? (await quietSnapshot(page));
  // R41: the bus clock at the leg's open (beat-observation runs only; null for the idle leg,
  // which opens at the recorder's live snapshot: its start is the record's forceClock.revealT).
  const busT0 = forceClockWatchOn && start === null ? await page.evaluate(readBusClockInPage).catch(() => null) : null;
  return { name, start: snap, rung0: await readQuietRung(page), busT0 };
}

/**
 * Close one leg: optional still tail, the end snapshot, the page records of
 * the window, the Playwright request channel (epoch -> page clock), then the
 * counts and the verdict. A strict leg whose rung moved underneath it (an
 * unpinned governor stepped on its own) is judged like the governor leg for
 * textures (RT reallocations explain the change) and says so.
 */
async function quietCloseLeg(page, ctx, leg, { mode = 'strict', tailMs = QUIET_TAIL_MS, induced = [], judged = true, judgedBy = null, extra = {} } = {}) {
  if (tailMs > 0) await page.waitForTimeout(tailMs);
  const end = await quietSnapshot(page);
  const rung1 = await readQuietRung(page);
  const raw = await page.evaluate(([a, b]) => window.__quietProbe.window(a, b), [leg.start.t, end.t]);
  raw.requests = ctx.requests.map((r) => ({ url: r.url, t: r.epoch - ctx.timeOrigin, type: r.type ?? null }));
  raw.induced = induced;
  let effectiveMode = mode;
  const notices = [];
  if (mode === 'strict' && typeof leg.rung0?.rung === 'number' && typeof rung1.rung === 'number' && rung1.rung !== leg.rung0.rung) {
    effectiveMode = 'governor';
    notices.push(`the ladder stepped ${leg.rung0.rung} -> ${rung1.rung} during this leg (unpinned governor); textures judged against the RT reallocations`);
  }
  const counts = quietLegCounts({ start: leg.start, end, raw, observers: ctx.observers, mode: effectiveMode });
  const verdict = quietLegVerdict(counts, { mode: effectiveMode });
  const loaf = await quietLoafWindow(page, leg.start.t, end.t);
  // ENGINE-A4R: the route canvas's per-frame work ledger for the leg (warm-stats.ts; routeDebug sessions
  // only) — renders / draw calls per frame and the station warm's scans, compiles and shadow-variant work,
  // so a long frame can be named. Diagnostic only: no verdict reads it.
  const warmStats = await page
    .evaluate(([a, b]) => (window.__routeWarmStats ? window.__routeWarmStats.window(a, b, 50) : null), [leg.start.t, end.t])
    .catch(() => null);
  // R41: the bus clock at the leg's close (after the judged window's end snapshot).
  const busT1 = forceClockWatchOn ? await page.evaluate(readBusClockInPage).catch(() => null) : null;
  const record = {
    name: leg.name,
    judged,
    mode: effectiveMode,
    t0: Math.round(leg.start.t),
    t1: Math.round(end.t),
    durationMs: Math.round(end.t - leg.start.t),
    ...(forceClockWatchOn ? { busT: { t0: leg.busT0 ?? null, t1: busT1 } } : {}),
    rung: { start: leg.rung0?.rung ?? null, end: rung1.rung, source: rung1.source },
    counts,
    verdict,
    windowLatches: quietWindowLatches(leg.start, end),
    ...(notices.length ? { notices } : {}),
    ...(loaf ? { loaf } : {}),
    ...(warmStats ? { warmStats } : {}),
    ...extra,
  };
  if (warmStats?.slow?.length) {
    // ENGINE-A5 (verify-a4r): slow frames are picked by INTERVAL, so the slowest is too. A veil-held frame
    // (no render) is named as such instead of printing "busy 0 ms, 0 renders" as if it were the culprit.
    const top = [...warmStats.slow].sort((x, y) => y.interval - x.interval || y.busyMs - x.busyMs)[0];
    const rendered = warmStats.slow.filter((f) => f.renders > 0).sort((x, y) => y.interval - x.interval || y.busyMs - x.busyMs)[0] ?? null;
    const describe = (f) => `interval ${Math.round(f.interval)} ms, busy ${f.busyMs} ms, ${f.renders} renders / ${f.calls} calls / ${f.renderMs} ms, work ${JSON.stringify(f.counts)} ${JSON.stringify(f.ms)}`;
    console.log(
      `capture-route: [quiet] ${ctx.key} ${leg.name} warm-stats ${warmStats.slow.length} frame(s) >= 50 ms of ${warmStats.frames}; busy p95 ${warmStats.busyP95} max ${warmStats.busyMax} ms; slowest: ${describe(top)}${top.renders === 0 ? ' (held: no render)' : ''}${rendered && rendered !== top ? `; slowest rendered: ${describe(rendered)}` : rendered ? '' : '; no slow frame rendered'}`,
    );
  }
  if (loaf?.rows?.length) {
    const top = loaf.topScripts[0];
    console.log(`capture-route: [quiet] ${ctx.key} ${leg.name} LoAF ${loaf.rows.length} frame(s) >= 50 ms, max ${loaf.maxMs} ms${top ? `, top script ${top.source} ${top.ms} ms over ${top.frames} frame(s)` : ''}`);
  }
  const c = counts;
  console.log(
    `capture-route: [quiet] ${ctx.key} ${leg.name}${judged ? ` ${verdict.verdict}` : judgedBy ? ` raw counts (judged by ${judgedBy}, not by these counts)` : ` (not judged) ${verdict.verdict}`} fetches=${c.worldFetches ?? 'n/a'} jsChunks=${c.jsChunks ?? 'n/a'} programs=${c.programs ?? 'n/a'} textures=${c.textures ?? 'n/a'} longTasks=${c.longTasks ?? 'n/a'} (links ${c.detail.links ?? 'n/a'}, info.programs ${c.detail.programsStart ?? '?'}->${c.detail.programsEnd ?? '?'}, memory.textures ${c.detail.memTexturesStart ?? '?'}->${c.detail.memTexturesEnd ?? '?'}, RT +${c.detail.rtCreated ?? '?'}/-${c.detail.rtDeleted ?? '?'}, reuploads ${c.detail.reuploads ?? 'n/a'}${record.windowLatches?.length ? `, window latches ${record.windowLatches.join(',')}` : ''})${verdict.reasons.length ? ` — ${verdict.reasons.join('; ')}` : ''}`,
  );
  for (const n of notices) console.log(`capture-route: [quiet] ${ctx.key} ${leg.name} NOTICE ${n}`);
  return record;
}

/** --quiet-inject fetch: one real world-asset URL re-fetched with a marker query (cache bypassed). */
async function quietInjectFetch(page, ctx) {
  const marker = `quietInject=${Date.now()}`;
  const seen = ctx.requests.find((r) => isWorldAssetUrl(r.url));
  const base = seen ? seen.url.split('#')[0] : `${new URL(previewUrl).origin}/models/world/manifest.json`;
  const url = `${base}${base.includes('?') ? '&' : '?'}${marker}`;
  const result = await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { cache: 'no-store' });
      await res.arrayBuffer();
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }, url);
  return { kind: 'fetch', fired: true, url, marker, ...result };
}

/**
 * --quiet-inject program: a clone of one plain scene mesh with a clone of
 * its material under a unique define (a new program key), added to the live
 * scene (frustumCulled off) until the render loop links it, then removed and
 * its material disposed — a post-reveal compile, exactly the pop D23 forbids.
 * Through the debug-gated __routeWorldScene handle; restores every write.
 */
async function quietInjectProgram(page) {
  return page.evaluate(async (waitMs) => {
    const sceneFn = window.__routeWorldScene;
    if (typeof sceneFn !== 'function') return { kind: 'program', fired: false, reason: '__routeWorldScene absent (debug off)' };
    const scene = sceneFn();
    let source = null;
    scene.traverse((o) => {
      if (source || !o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return;
      if (!o.geometry || !o.material || Array.isArray(o.material) || typeof o.material.clone !== 'function') return;
      source = o;
    });
    if (!source) return { kind: 'program', fired: false, reason: 'no plain mesh with a single material in the scene' };
    const nonce = `${Date.now()}`;
    const material = source.material.clone();
    material.defines = { ...(material.defines || {}), QUIET_PROBE_INJECT: nonce };
    material.needsUpdate = true;
    const mesh = source.clone(false);
    mesh.material = material;
    mesh.frustumCulled = false;
    mesh.visible = true;
    const linksBefore = window.__quietProbe.snapshot().links;
    scene.add(mesh);
    const started = performance.now();
    let linksAfter = linksBefore;
    while (performance.now() - started < waitMs) {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      linksAfter = window.__quietProbe.snapshot().links;
      if (linksAfter > linksBefore) break;
    }
    scene.remove(mesh);
    material.dispose();
    return { kind: 'program', fired: true, marker: `QUIET_PROBE_INJECT=${nonce}`, source: source.name || source.type, material: material.type, linksBefore, linksAfter, waitedMs: Math.round(performance.now() - started) };
  }, QUIET_INJECT_FRAME_WAIT_MS);
}

/**
 * LOOK r5: the stations the judged quiet legs covered — a sweep whose
 * gesture reached both ends crossed every station; a jump covers its two
 * ends. `missing` lists stations no judged leg touched.
 */
function quietStationsCovered(legs) {
  const byLeg = [];
  const covered = new Set();
  for (const leg of Array.isArray(legs) ? legs : []) {
    let stations = [];
    if (leg?.gesture && leg.gesture.down?.reached === true && leg.gesture.up?.reached === true) stations = [...SECTIONS];
    else if (Array.isArray(leg?.jumps)) stations = [...new Set(leg.jumps.flatMap((j) => [j.from, j.to]).filter(Boolean))];
    if (!stations.length) continue;
    byLeg.push({ leg: leg.name, stations });
    if (leg.judged !== false) for (const s of stations) covered.add(s);
  }
  return { all: SECTIONS.every((s) => covered.has(s)), covered: SECTIONS.filter((s) => covered.has(s)), missing: SECTIONS.filter((s) => !covered.has(s)), byLeg };
}

/** Leg (a): land the first station, wheel down to the last, then back up. */
async function quietSweepLeg(page, ctx, { name = 'sweep', inject = null } = {}) {
  const leg = await quietOpenLeg(page, name);
  let injectRecord = null;
  if (inject === 'fetch') injectRecord = await quietInjectFetch(page, ctx);
  else if (inject === 'program') injectRecord = await quietInjectProgram(page);
  const extra = { injected: injectRecord };
  try {
    const startSettle = await landSettle(page, SECTIONS[0]);
    const down = await runSweep(page, { mode: 'down', toIndex: SECTIONS.length - 1 });
    const up = await runSweep(page, { mode: 'up', toIndex: 0 });
    extra.gesture = {
      startSettle: startSettle?.ok ?? null,
      down: { steps: down.steps, reached: down.reached, frames: down.frames.length },
      up: { steps: up.steps, reached: up.reached, frames: up.frames.length },
    };
  } catch (err) {
    extra.gestureError = err instanceof Error ? err.message : String(err);
  }
  const record = await quietCloseLeg(page, ctx, leg, { extra });
  if (extra.gestureError || extra.gesture?.down.reached === false || extra.gesture?.up.reached === false) {
    // A sweep that never covered the stations did not probe them: not a pass.
    record.verdict = { ...record.verdict, verdict: 'fail', reasons: [...record.verdict.reasons, `gesture incomplete (${extra.gestureError ?? `down reached ${extra.gesture?.down.reached}, up reached ${extra.gesture?.up.reached}`})`] };
  }
  return record;
}

/** Leg (b): the chip jumps (--chip-jump legs, else pulse->schedule and rules->roster). */
async function quietJumpLeg(page, ctx, { name = 'jump' } = {}) {
  const legs = evidenceArms.chipJump ?? [
    { from: 'pulse', to: 'schedule' },
    { from: 'rules', to: 'roster' },
  ];
  const leg = await quietOpenLeg(page, name);
  const extra = {};
  try {
    const results = await runJump(page, {
      legs,
      land: (section) => landSettle(page, section),
      assertLanding: (index, section) => pollStationSettle(page, index, section),
      stationIds: SECTIONS,
    });
    extra.jumps = results.map((r) => ({
      from: r.from,
      to: r.to,
      clicked: r.click ? r.click.ok : r.clickAt !== undefined,
      landed: r.landed?.ok ?? null,
      settle: r.settle?.ok ?? null,
      jumpVerdict: r.analysis?.verdict ?? null,
      windowMounts: r.windowMounts?.verdict ?? null,
      windowMountViolations: r.windowMounts?.violations?.length ?? 0,
    }));
  } catch (err) {
    extra.gestureError = err instanceof Error ? err.message : String(err);
  }
  const record = await quietCloseLeg(page, ctx, leg, { extra });
  const missed = (extra.jumps ?? []).filter((j) => j.landed !== true);
  if (extra.gestureError || missed.length > 0) {
    record.verdict = { ...record.verdict, verdict: 'fail', reasons: [...record.verdict.reasons, `jump incomplete (${extra.gestureError ?? missed.map((j) => `${j.from}->${j.to} landed=${j.landed}`).join(', ')})`] };
  }
  return record;
}

/**
 * Leg (c) --quiet-governor: walk the ladder down to the floor after reveal,
 * one rung at a time. Driver `hook` = the debug force hook
 * window.__routeWorldQualityForce(rung) (ENGINE-GATE contract); driver
 * `stress` (no hook published) = the real governor, fed slow frames by a
 * harness rAF busy wait (QUIET_STRESS_BUSY_MS) until the rung steps
 * (long tasks inside those stress windows are harness-induced and listed
 * apart). Needs routeQuality unpinned.
 */
async function quietGovernorLeg(page, ctx) {
  const first = await readQuietRung(page);
  const leg = await quietOpenLeg(page, 'governor');
  const hasHook = await page.evaluate(() => typeof window.__routeWorldQualityForce === 'function');
  const driver = hasHook ? 'hook' : 'stress';
  const steps = [];
  const induced = [];
  let failure = null;
  if (first.pinned) failure = 'routeQuality is pinned — the governor leg needs the ladder unpinned';
  else if (first.rung === null) failure = 'the ladder rung is unreadable (no __routeWorldQuality and no debug readout)';
  const floor = 4;
  let rung = first.rung ?? floor;
  while (!failure && rung < floor) {
    const target = rung + 1;
    const stepStart = await quietSnapshot(page);
    let stressWindow = null;
    if (driver === 'hook') {
      const forced = await page.evaluate((r) => {
        try {
          return window.__routeWorldQualityForce(r) ?? { ok: true };
        } catch (err) {
          return { ok: false, reason: String((err && err.message) || err) };
        }
      }, target);
      if (forced && forced.ok === false) {
        failure = `force hook refused rung ${target} (${forced.reason ?? 'no reason'})`;
        break;
      }
    } else {
      const s0 = await page.evaluate((busyMs) => {
        const stress = { on: true };
        window.__quietStress = stress;
        const tick = () => {
          if (!stress.on) return;
          const until = performance.now() + busyMs;
          while (performance.now() < until) {
            /* harness-induced slow frame */
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return performance.now();
      }, QUIET_STRESS_BUSY_MS);
      stressWindow = [s0, null];
    }
    const waited = Date.now();
    let now = await readQuietRung(page);
    while ((now.rung ?? -1) < target && Date.now() - waited < QUIET_GOVERNOR_STEP_WAIT_MS) {
      await page.waitForTimeout(100);
      now = await readQuietRung(page);
    }
    if (stressWindow) {
      // A frame of margin past the stop: the last busy frame may straddle it.
      stressWindow[1] = await page.evaluate(() => {
        if (window.__quietStress) window.__quietStress.on = false;
        return performance.now() + 50;
      });
      induced.push(stressWindow);
    }
    if ((now.rung ?? -1) < target) {
      failure = `the ladder did not reach rung ${target} within ${QUIET_GOVERNOR_STEP_WAIT_MS / 1000}s (driver ${driver}, rung ${now.rung ?? 'n/a'})`;
      break;
    }
    await page.waitForTimeout(QUIET_GOVERNOR_SETTLE_MS);
    const stepEnd = await quietSnapshot(page);
    steps.push({ from: rung, to: now.rung, t0: Math.round(stepStart.t), t1: Math.round(stepEnd.t), stressWindow: stressWindow ? stressWindow.map(Math.round) : null, bufferDpr: await page.evaluate(() => {
      const canvas = document.querySelector('[data-route-canvas] canvas') || document.querySelector('canvas');
      return canvas && canvas.clientWidth > 0 ? +(canvas.width / canvas.clientWidth).toFixed(3) : null;
    }) });
    rung = now.rung;
  }
  const record = await quietCloseLeg(page, ctx, leg, { mode: 'governor', tailMs: 0, induced, extra: { driver, startRung: first.rung, steps } });
  if (failure) record.verdict = { ...record.verdict, verdict: 'fail', reasons: [...record.verdict.reasons, `governor walk incomplete: ${failure}`] };
  if (driver === 'stress') {
    record.notes = [
      'driver stress: no __routeWorldQualityForce hook was published, so the real governor was walked down by harness-induced slow frames; long tasks inside the stress windows are listed as inducedLongTasks and not judged',
    ];
  }
  return record;
}

/**
 * Leg (d) --quiet-theme: toggle the palette (the header theme button, else a
 * next-themes storage event), then expect exactly one new generation with a
 * complete ceremony. The toggle's own ceremony is recorded, not judged
 * against the quiet counts.
 */
async function quietThemeLeg(page, ctx) {
  const readReadiness = () =>
    page.evaluate(() => {
      let r = null;
      try {
        r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
      } catch {
        r = null;
      }
      const ball = document.querySelector('[data-ball-loader]');
      return {
        t: performance.now(),
        theme: document.documentElement.getAttribute('data-theme'),
        generation: r && typeof r.generation === 'number' ? r.generation : null,
        phase: r ? r.phase : null,
        ballTrace: r && Array.isArray(r.ballTrace) ? r.ballTrace : null,
        ball: ball ? ball.getAttribute('data-ball-phase') : 'absent',
        live: document.documentElement.classList.contains('world-route-live'),
        // CHROME (D32): the theme veil's phase (null = no veil bridge).
        veil: r && typeof r.themeVeil === 'string' ? r.themeVeil : null,
      };
    });
  const before = await readReadiness();
  const leg = await quietOpenLeg(page, 'theme');
  // CHROME (D32): the veil's film starts before the toggle.
  const film = veilFilmOn ? await startLoaderFilm(page, { quality: 70 }) : null;
  // CHROME (D32 fix): the Station Card (DOM chrome above the veil), per frame.
  const cardSampler = await startCardSampler(page).catch(() => null);
  const toggledAt = before.t;
  const how = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label^="Switch to"]');
    if (button) {
      button.click();
      return 'theme-button';
    }
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    window.localStorage.setItem('theme', next);
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: next }));
    return 'storage-event';
  });
  const started = Date.now();
  let read = before;
  while (read.theme === before.theme && Date.now() - started < QUIET_THEME_FLIP_MS) {
    await page.waitForTimeout(100);
    read = await readReadiness();
  }
  const ceremonyStarted = Date.now();
  const done = (r) =>
    r.theme !== before.theme &&
    (before.generation === null || (r.generation ?? -1) > before.generation) &&
    r.phase === 'presented' &&
    r.live &&
    (r.ball === 'done' || r.ball === 'hidden' || r.ball === 'absent') &&
    // CHROME (D32): and the veil has cleared.
    (r.veil === null || r.veil === 'idle');
  while (!done(read) && Date.now() - ceremonyStarted < QUIET_THEME_CEREMONY_MS) {
    await page.waitForTimeout(100);
    read = await readReadiness();
  }
  // The film and the card sampler run 0.5 s past the clear (the card's settle).
  await page.waitForTimeout(500);
  const filmResult = film ? await film.stop() : null;
  const cardSamples = cardSampler ? await cardSampler.stop() : null;
  await page.waitForTimeout(Math.max(0, QUIET_THEME_HOLD_MS - 500));
  const held = await readReadiness();
  // LOOK r3: the harness toggled the palette itself — move the theme pin
  // (the read-back expectation and localStorage) to the new palette so the
  // @theme restart legs are not aborted by the harness's own pin.
  let themePin = null;
  if ((held.theme === 'light' || held.theme === 'dark') && held.theme !== before.theme) {
    themePin = { from: expectedTheme, to: held.theme };
    expectedTheme = held.theme;
    await page.evaluate((t) => {
      try {
        window.localStorage.setItem('theme', t);
      } catch {
        /* storage blocked: the read-back pin still moved */
      }
    }, held.theme);
  }
  const ballPhasesAfter = (held.ballTrace ?? []).filter((e) => typeof e.t === 'number' && e.t > toggledAt).map((e) => e.phase);
  const theme = quietThemeVerdict({
    themeBefore: before.theme,
    themeAfter: held.theme,
    generationBefore: before.generation,
    generationAfter: read.generation,
    generationHeld: held.generation,
    ballPhasesAfter,
    presented: done(read),
  });
  // The swap itself loads, links and uploads: the leg's own counts are recorded only.
  const record = await quietCloseLeg(page, ctx, leg, { tailMs: 0, judged: false, judgedBy: 'the veil verdict below', extra: { toggle: how, before: { theme: before.theme, generation: before.generation }, after: { theme: held.theme, generation: held.generation, phase: held.phase, ball: held.ball }, ballPhasesAfter, ceremonyMs: Date.now() - ceremonyStarted, theme, themePin } });
  // CHROME (D32): judged against the theme veil — every fetch / link /
  // upload / allocation / long task after the toggle inside the veil-opaque
  // window, none in the fade-in, none after the fade-out began (hold included).
  const veilTrace = await page.evaluate(() => {
    try {
      const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
      if (r && Array.isArray(r.themeVeilTrace)) return r.themeVeilTrace;
      const v = typeof window.__routeThemeVeil === 'function' ? window.__routeThemeVeil() : null;
      return v && Array.isArray(v.trace) ? v.trace : null;
    } catch {
      return null;
    }
  });
  const windowsOfVeil = veilTrace === null ? null : veilWindows(veilTrace, toggledAt);
  const raw = await page.evaluate(([a, b]) => window.__quietProbe.window(a, b), [toggledAt, record.t1]);
  const veil =
    windowsOfVeil === null
      ? { verdict: 'unmeasured', reasons: ['unmeasured: the theme veil trace is unreadable (__routeWorldReadiness().themeVeilTrace absent)'] }
      : veilJudge({
          raw,
          requests: ctx.requests.map((r) => ({ url: r.url, t: r.epoch - ctx.timeOrigin, type: r.type ?? null })),
          toggleAt: toggledAt,
          endT: record.t1,
          veil: windowsOfVeil,
          isWorldAssetUrl,
        });
  // CHROME (D32 fix): the Station Card never pops, is hidden while the veil
  // is opaque, and changes state at most twice (one hide, one show).
  const card =
    windowsOfVeil === null || cardSamples === null
      ? { verdict: 'unmeasured', reasons: ['unmeasured: no veil trace or no card sampler'] }
      : cardVeilJudge(cardSamples, windowsOfVeil, { reducedMotion: evidenceArms.reducedMotion === true });
  console.log(
    `capture-route: [quiet] ${ctx.key} theme veil station card ${card.verdict}${card.samples ? ` (${card.samples} frames, state changes ${card.stateChanges ?? '-'}, mounts ${card.mounts ?? '-'}, opaque max alpha ${card.opaqueMaxAlpha ?? '-'}, pops ${card.pops?.length ?? 0}${card.instants?.length ? `, instant swaps ${card.instants.map((i) => `${i.as}@${i.t}`).join(' ')}` : ''}, end alpha ${card.alphaAtEnd ?? '-'})` : ''}${card.reasons.length ? ` — ${card.reasons.join('; ')}` : ''}`,
  );
  let veilFilm = null;
  if (filmResult) {
    try {
      veilFilm = await writeVeilFilm(filmResult, { outDir, base: `${tag}-${before.theme ?? 'theme'}-${ctx.key}`, timeOrigin: ctx.timeOrigin, windows: windowsOfVeil });
      console.log(`capture-route: [quiet] ${ctx.key} theme veil film -> ${veilFilm.dir} (${veilFilm.frames} frames, max frame gap ${veilFilm.maxFrameGapMs} ms)${veilFilm.sheet ? `, sheet ${veilFilm.sheet.file}` : ''}`);
    } catch (err) {
      veilFilm = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const v = windowsOfVeil?.timings;
  console.log(
    `capture-route: [quiet] ${ctx.key} theme veil ${veil.verdict}${v ? ` (toggle->in ${v.toggleToIn} ms, fade-in ${v.fadeInMs} ms, opaque ${v.opaqueMs} ms, fade-out ${v.fadeOutMs} ms)` : ''}${veil.windows ? ` opaque window: fetches ${veil.windows.opaque.worldFetches}, links ${veil.windows.opaque.links}, uploads ${veil.windows.opaque.uploads}, allocs ${veil.windows.opaque.textureAllocs}, long tasks ${veil.windows.opaque.longTasks}` : ''}${veil.reasons.length ? ` — ${veil.reasons.join('; ')}` : ''}`,
  );
  // A leg with no card in view ('absent') is judged on the veil alone.
  const cardOk = card.verdict === 'pass' || card.verdict === 'absent';
  const reasons = [...theme.reasons, ...veil.reasons, ...card.reasons.map((r) => `station card: ${r}`)];
  const verdict =
    theme.verdict === 'pass' && veil.verdict === 'pass' && cardOk
      ? 'pass'
      : theme.verdict === 'fail' || veil.verdict === 'fail' || card.verdict === 'fail'
        ? 'fail'
        : 'unmeasured';
  // Judged on the generation / ceremony contract AND the D32 veil windows.
  return {
    ...record,
    judged: true,
    veil: { windows: windowsOfVeil, judge: veil, trace: veilTrace, card, ...(veilFilm ? { film: veilFilm } : {}) },
    verdict: { verdict, mode: 'theme', reasons, unmeasured: [] },
  };
}

/**
 * --quiet-probe for one viewport: legs idle (world-route-live -> probe start),
 * (a) sweep, (b) jump, optional (c) governor and (d) theme (+ the probe's
 * restart in the new palette). Writes <tag>-<theme>-<vp>-quiet.json.
 */
/**
 * LOOK r2: the recorder's counters over the whole load (navigation -> now)
 * and since world-route-live when it landed — the diagnostic an unmeasured
 * -quiet.json carries (never judged). Null-safe: a dead page reads an error.
 */
async function quietDiagnostic(page, requests) {
  try {
    const status = await page.evaluate(() => (window.__quietProbe ? window.__quietProbe.status() : null));
    if (!status) return { recorder: 'absent' };
    const end = await quietSnapshot(page);
    const trim = (c) => ({
      ...c,
      detail: { ...c.detail, worldFetchUrls: c.detail.worldFetchUrls.slice(0, 12), worldFetchUrlCount: c.detail.worldFetchUrls.length, otherFetchUrls: c.detail.otherFetchUrls.slice(0, 12), longTaskList: c.detail.longTaskList.slice(0, 20) },
    });
    const countsFrom = async (start) => {
      const raw = await page.evaluate(([a, b]) => window.__quietProbe.window(a, b), [start.t, end.t]);
      raw.requests = requests.map((r) => ({ url: r.url, t: r.epoch - status.timeOrigin, type: r.type ?? null }));
      return trim(quietLegCounts({ start, end, raw, observers: status.observers }));
    };
    return {
      readAt: Math.round(end.t),
      liveAt: status.liveAt,
      rendererSeen: status.rendererSeen,
      observers: status.observers,
      sinceNavigation: await countsFrom({ t: 0 }),
      sinceLive: status.liveSnapshot ? await countsFrom(status.liveSnapshot) : null,
      errors: status.errors,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** LOOK r2: write the always-present unmeasured -quiet.json and log it. */
async function writeQuietUnmeasured(page, key, { reason, stage, revealGate = null, requests = [] }) {
  // LOOK r6 SEAT H4: <tag>-<theme>-<vp>-quiet.json (a dark run never overwrites the light record).
  const quietPath = resolve(outDir, quietFileName(tag, theme, key));
  const diagnostic = page ? await quietDiagnostic(page, requests) : null;
  const relaxed = evidenceArms.relaxDeadlineMs !== undefined ? { readyDeadlineMs: evidenceArms.relaxDeadlineMs } : null;
  await writeJson(quietPath, { kind: 'quiet', viewport: key, world: worldId ?? 'plaza', theme: expectedTheme, ...quietUnmeasuredBody({ reason, stage, revealGate, diagnostic, relaxed }), invocation });
  const d = diagnostic?.sinceNavigation;
  console.log(
    `capture-route: [quiet] ${key} -> ${quietPath} verdict=unmeasured stage=${stage} (${reason})${d ? ` sinceNavigation fetches=${d.worldFetches ?? 'n/a'} programs=${d.programs ?? 'n/a'} textures=${d.textures ?? 'n/a'} longTasks=${d.longTasks ?? 'n/a'}` : ''}`,
  );
  return { pass: false, unmeasured: true, file: quietPath.slice(outDir.length + 1), reasons: [`unmeasured: ${reason}`] };
}

/**
 * POKEMON-CORE (D35) A1: the post-settle busy leg. Waits (bounded) for the
 * conductor's latched settle, opens the leg there and holds still `holdMs`;
 * judged strict like idle (0 fetches / links / uploads / long tasks). The
 * leg's warmStats window therefore starts at the settle. `settle` records the
 * wait (a timed-out wait opens the leg anyway and says so).
 */
async function quietBusyLeg(page, ctx, holdMs) {
  const t0 = Date.now();
  let settled = null;
  while (Date.now() - t0 < QUIET_BUSY_SETTLE_WAIT_MS) {
    settled = await page
      .evaluate(() => {
        try {
          const cam = typeof window.__routeWorldCamera === 'function' ? window.__routeWorldCamera() : null;
          return cam && typeof cam.settled === 'boolean' ? cam.settled : null;
        } catch {
          return null;
        }
      })
      .catch(() => null);
    if (settled === true) break;
    await page.waitForTimeout(100);
  }
  const leg = await quietOpenLeg(page, 'busy');
  const settle = { settled, waitedMs: Date.now() - t0, timedOut: settled !== true };
  if (settle.timedOut) console.log(`capture-route: [quiet] ${ctx.key} busy leg: no latched settle within ${QUIET_BUSY_SETTLE_WAIT_MS} ms (settled=${settled}); leg opened anyway`);
  const record = await quietCloseLeg(page, ctx, leg, { tailMs: holdMs, extra: { settle, holdMs } });
  const w = record.warmStats;
  if (w) console.log(`capture-route: [quiet] ${ctx.key} busy leg ${w.frames} frames busy p50 ${w.busyP50} p95 ${w.busyP95} ms${w.settled ? ` (app settled window: ${w.settled.frames} frames p50 ${w.settled.busyP50} p95 ${w.settled.busyP95}, director p95 ${w.settled.directorP95})` : ''}`);
  return record;
}

async function runQuietProbe(page, key, revealGate, requests) {
  // LOOK r6 SEAT H4: <tag>-<theme>-<vp>-quiet.json (a dark run never overwrites the light record).
  const quietPath = resolve(outDir, quietFileName(tag, theme, key));
  const status = await page.evaluate(() => (window.__quietProbe ? window.__quietProbe.status() : null));
  const base = { kind: 'quiet', viewport: key, world: worldId ?? 'plaza', theme, revealGate, invocation };
  if (!status) return writeQuietUnmeasured(page, key, { reason: 'quiet recorder not installed', stage: 'recorder', revealGate, requests });
  if (!REVEALED_MODES.includes(revealGate.mode)) {
    return writeQuietUnmeasured(page, key, { reason: `the route never revealed (gate ${revealGate.mode})`, stage: 'reveal-gate', revealGate, requests });
  }
  try {
    return await runQuietLegs(page, key, revealGate, requests, { quietPath, status, base });
  } catch (err) {
    return writeQuietUnmeasured(page, key, { reason: `a leg threw: ${err instanceof Error ? err.message : String(err)}`, stage: 'legs', revealGate, requests });
  }
}

async function runQuietLegs(page, key, revealGate, requests, { quietPath, status, base }) {
  const ctx = { key, requests, timeOrigin: status.timeOrigin, observers: status.observers };
  const legs = [];
  // LOOK r5: the program split in the start palette, read INSIDE the idle
  // window (live -> idle close), so no frame of the read escapes a judged
  // leg; the read links and uploads nothing.
  const quietProgramSplit = await readProgramSplit(page, 'quiet: inside the idle leg (start palette)');
  console.log(`capture-route: [quiet] ${key} ${programSplitLine(quietProgramSplit)}`);
  // idle: from the moment world-route-live landed (the recorder's own snapshot) to now.
  if (status.liveSnapshot) {
    const idle = { name: 'idle', start: status.liveSnapshot, rung0: await readQuietRung(page) };
    legs.push(await quietCloseLeg(page, ctx, idle, { tailMs: 0 }));
  } else {
    console.log(`capture-route: [quiet] ${key} idle leg skipped — the recorder never saw world-route-live land`);
  }
  if (quietBusyMs > 0) legs.push(await quietBusyLeg(page, ctx, quietBusyMs));
  let inject = null;
  const sweep = await quietSweepLeg(page, ctx, { inject: quietInject });
  legs.push(sweep);
  if (quietInject) inject = { kind: quietInject, record: sweep.injected, ...quietInjectDetected(quietInject, sweep, sweep.injected) };
  legs.push(await quietJumpLeg(page, ctx));
  if (quietGovernorOn) legs.push(await quietGovernorLeg(page, ctx));
  if (quietThemeOn) {
    const themeLeg = await quietThemeLeg(page, ctx);
    legs.push(themeLeg);
    // The probe restarts in the new palette (after its own ceremony).
    const idle2 = await quietOpenLeg(page, 'idle@theme');
    legs.push(await quietCloseLeg(page, ctx, idle2, { tailMs: QUIET_RESTART_IDLE_MS }));
    legs.push(await quietSweepLeg(page, ctx, { name: 'sweep@theme' }));
    legs.push(await quietJumpLeg(page, ctx, { name: 'jump@theme' }));
  }
  const final = await page.evaluate(() => window.__quietProbe.status());
  const verdict = quietProbeVerdict(legs);
  // LOOK r4: a recorder that lost judged entries (links / texture records /
  // fetches / long tasks inside a leg) cannot vouch for a 0 count: the run
  // is then unmeasured, never a pass.
  const drops = recorderDropAccount(final, { windowStart: legs.length ? Math.min(...legs.map((l) => l.t0)) : null });
  const dropsBlock = drops.verdict === 'counters-incomplete' || drops.verdict === 'unknown';
  if (dropsBlock) console.log(`capture-route: [quiet] ${key} recorder ${drops.verdict}: ${drops.reason} — the verdict is unmeasured`);
  await writeJson(quietPath, {
    ...base,
    pass: verdict.pass && !dropsBlock,
    verdict: dropsBlock ? (verdict.pass ? 'unmeasured' : 'fail') : verdict.pass ? 'pass' : 'fail',
    failing: dropsBlock ? [...verdict.failing, `recorder: ${drops.reason}`] : verdict.failing,
    // LOOK r2: a relaxed (debug) deadline makes this run indicative only.
    ...(evidenceArms.relaxDeadlineMs !== undefined ? { deadlineRelaxed: { readyDeadlineMs: evidenceArms.relaxDeadlineMs, note: 'dev evidence with a relaxed readiness deadline: indicative, never the D23 verdict (judge on --prod-attach)' } } : {}),
    ...(inject ? { selfTest: inject } : {}),
    recorder: {
      observers: final.observers,
      rendererSeen: final.rendererSeen,
      liveAt: final.liveAt,
      liveTransitions: final.liveTransitions,
      dropped: final.dropped,
      droppedByKind: final.droppedByKind ?? null,
      evicted: final.evicted ?? null,
      // LOOK r4: can the recorder still vouch for the link / upload / fetch
      // counters of the judged legs (the earliest leg start)?
      drops,
      errors: final.errors,
    },
    // LOOK r4 (CAR r3: 115 / 119 / 136-138 across reports): the ONE judged
    // program count — renderer.info.programs at world-route-live (the reveal),
    // on the start rung; per-leg end counts ride along as `later`.
    programsAtReveal: programCountAtReveal({
      atReveal: numberOrNull(final.liveSnapshot?.glDebugPrograms) ?? numberOrNull(final.liveSnapshot?.info?.programs),
      startRung: legs[0]?.rung?.start ?? null,
      later: legs.map((l) => ({ leg: l.name, programs: l.counts?.detail?.programsEnd ?? null })),
    }),
    // LOOK r5: programs split active rung vs pre-warmed (D26 on the active split).
    programSplit: quietProgramSplit,
    // LOOK r5 (LOOK r4: "run the quiet-probe legs for all five stations"):
    // which stations the judged legs actually landed or crossed.
    stationsCovered: quietStationsCovered(legs),
    // LOOK r2 SEAT H: the paint audit after the legs (the probe implies --debug).
    paintAudit: await readPaintAudit(page),
    // R40: the pass-through bridges at the end of the run (beats, attacks,
    // coreActors, water): K6 / K7 / K8 companions, never judged here.
    bridges: await readPassThroughBridges(page).catch(() => null),
    // R41: the force clock's zero (bus seconds); with the end bridges' beats.t it gives the
    // real-time leg's awake coverage (K2 / K6 natural / K7).
    ...(forceClockWatchOn ? { forceClock: await page.evaluate(readForceClockInPage).catch(() => null) } : {}),
    legs,
    notes: [
      'counts per leg, all after world-route-live (D23): worldFetches = world-asset resource entries (/models/world, the world-assets bucket, /textures/world; the larger of the PerformanceObserver and the browser request channels); jsChunks (R40 / R38) = JS chunk or script fetches (/_next/static/chunks/, script-typed entries, .js paths; the same two channels), judged like worldFetches; programs = max(GL linkProgram calls, renderer.info.programs delta); textures = max(renderer.info.memory.textures delta, textures whose FIRST pixel-data upload falls in the leg); longTasks = Long Tasks API entries >= 50 ms',
      'verdict: every count 0 in idle / sweep / jump (and their @theme restart); governor: programs, fetches and long tasks 0 and the texture change explained by the RT reallocations (rtCreated - rtDeleted); theme: exactly one new generation with a complete (invisible) ball ceremony AND, under D32, the theme veil raised by the toggle with every world fetch / program link / texture upload / texture allocation / long task after the toggle inside the veil-opaque window (legs[theme].veil: fadeIn and after windows all 0, after = fade-out start -> leg end incl. the 2 s hold) AND the Station Card judged per frame (legs[theme].veil.card: no |delta alpha| > 0.4 between frames, alpha <= 0.02 while the veil is opaque, at most 2 state changes; absent = no card in view, not judged). unmeasured is never a pass',
      'reported, never judged: reuploads (pixel data into textures that already had data, e.g. the boards\' live canvas), rbAllocs, otherFetchUrls, windowLatches (window.__c089Windows entries that turned resident in the leg)',
      'renderer handle: three\'s __THREE_DEVTOOLS__ observe event (WebGLRenderer); programs prefer the debug handle __routeWorldGlDebug().programs when published',
    ],
  });
  {
    const liveProg = numberOrNull(final.liveSnapshot?.glDebugPrograms) ?? numberOrNull(final.liveSnapshot?.info?.programs);
    console.log(`capture-route: [quiet] ${key} programsAtReveal=${liveProg ?? 'n/a'} (renderer.info.programs at world-route-live, start rung ${legs[0]?.rung?.start ?? '?'}) recorder=${drops.verdict}`);
  }
  const themeLegOf = legs.find((l) => l.name === 'theme');
  const vt = themeLegOf?.veil?.windows?.timings ?? null;
  const veilPart = themeLegOf ? ` theme veil=${themeLegOf.veil?.judge?.verdict ?? 'n/a'}${vt ? ` (fade-in ${vt.fadeInMs ?? 'n/a'} ms, opaque hold ${vt.opaqueMs ?? 'n/a'} ms, fade-out ${vt.fadeOutMs ?? 'n/a'} ms)` : ''} card=${themeLegOf.veil?.card?.verdict ?? 'n/a'}` : '';
  console.log(`capture-route: [quiet] ${key} -> ${quietPath} pass=${verdict.pass && !dropsBlock}${veilPart}${verdict.failing.length ? ` (failing: ${verdict.failing.map((f) => f.split(':')[0]).join(', ')})` : ''}`);
  return { pass: verdict.pass && !dropsBlock, file: quietPath.slice(outDir.length + 1), reasons: dropsBlock ? [...verdict.failing, `recorder: ${drops.reason}`] : verdict.failing, inject };
}

/** Listening PIDs on a port (no kill side effects — the --prod-attach read). */
async function listenerPids(portNum) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('netstat', ['-ano']);
      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        if (cols[0] !== 'TCP' || !(cols[1] ?? '').endsWith(`:${portNum}`)) continue;
        const pid = Number(cols[4]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
      return [...pids];
    }
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${portNum}`, '-sTCP:LISTEN']);
    return stdout.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** The process chain (pid, parent, command line) up from `pid`, bounded. */
async function processChain(pid, depth = 5) {
  const chain = [];
  let current = pid;
  for (let i = 0; i < depth && Number.isInteger(current) && current > 0; i += 1) {
    try {
      let row;
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId=${current}" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`],
          { timeout: 20_000 },
        );
        if (!stdout.trim()) break;
        const parsed = JSON.parse(stdout);
        row = { pid: parsed.ProcessId, parent: parsed.ParentProcessId, commandLine: parsed.CommandLine ?? null };
      } else {
        const { stdout } = await execFileAsync('ps', ['-o', 'ppid=,args=', '-p', String(current)]);
        const m = /^\s*(\d+)\s+(.*)$/.exec(stdout.trim());
        if (!m) break;
        row = { pid: current, parent: Number(m[1]), commandLine: m[2] };
      }
      chain.push(row);
      if (row.parent === current) break;
      current = row.parent;
    } catch {
      break;
    }
  }
  return chain;
}

/**
 * --prod-attach: the server on --port must be `next start` (a production
 * build). Never boots one. `dev` is refused; an unresolvable chain proceeds
 * only if every page load also shows no dev overlay (checked per viewport).
 */
async function checkProdAttach() {
  const state = await probe(previewUrl, WEDGE_TIMEOUT_MS);
  if (state.kind !== 'ok') {
    throw new Error(`--prod-attach: nothing healthy serves ${previewUrl} (probe=${state.kind}) — start the production build first (npm run build, then next start -p ${port}); the harness never boots one`);
  }
  const pids = await listenerPids(port);
  const chains = [];
  for (const pid of pids) chains.push(await processChain(pid));
  const commandLines = chains.flat().map((row) => row.commandLine);
  const kind = prodServerKind(commandLines);
  let buildIdMtime = null;
  try {
    buildIdMtime = new Date((await stat(resolve(repoRoot, '.next', 'BUILD_ID'))).mtimeMs).toISOString();
  } catch {
    buildIdMtime = null;
  }
  const record = { port, pids, kind, chains, buildIdMtime, newestSrcMtime: invocation.sourceStamp?.newestSrcMtime ?? null, devOverlayByViewport: {} };
  if (kind === 'dev') {
    throw new Error(`--prod-attach refused: the server on port ${port} is next dev (${commandLines.filter(Boolean)[0] ?? 'n/a'}) — deadline evidence never comes from dev`);
  }
  if (kind === 'unknown') {
    console.log(`capture-route: [prod-attach] NOTICE the listener's process chain did not resolve to next start/dev (pids ${pids.join(',') || 'none'}) — every page load must show no dev overlay instead`);
  } else {
    console.log(`capture-route: [prod-attach] port ${port} is next start (pids ${pids.join(',')})`);
  }
  if (buildIdMtime && record.newestSrcMtime && buildIdMtime < record.newestSrcMtime) {
    console.log(`capture-route: [prod-attach] NOTICE .next/BUILD_ID (${buildIdMtime}) is older than the newest src/ edit (${record.newestSrcMtime}) — the served build may be stale`);
  }
  return record;
}

/**
 * Round 2 --flip-probe: navigate (domcontentloaded), scroll to the first
 * requested section's top + offset while the page is still Lite, wait for
 * the natural Lite -> route flip, and assert the section at the activation
 * line and the active chip survived it. Writes <tag>-<section>-<vp>-flip.json.
 */
async function runFlipProbe(page, key) {
  const section = sections[0];
  const offset = evidenceArms.flipProbe;
  const flipPath = resolve(outDir, `${tag}-${section}-${key}-flip.json`);
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(`#${section}`, { timeout: 60_000 });
  const scrolled = await page.evaluate(
    ({ id, off }) => {
      const el = document.getElementById(id);
      const margin = Number.parseFloat(getComputedStyle(el).scrollMarginTop || '0') || 0;
      const top = el.getBoundingClientRect().top + window.scrollY - margin + off;
      window.scrollTo({ top, behavior: 'instant' });
      return { top: Math.round(top), live: document.documentElement.classList.contains('world-route-live') };
    },
    { id: section, off: offset },
  );
  await page.waitForTimeout(300);
  const before = await readFlipContext(page);
  let flipped = true;
  try {
    await page.waitForFunction(() => document.documentElement.classList.contains('world-route-live'), null, {
      timeout: REVEAL_GATE_WAIT_MS,
    });
  } catch {
    flipped = false;
  }
  await page.waitForTimeout(800);
  const after = await readFlipContext(page);
  const verdict = flipVerdict(before, after);
  await writeJson(flipPath, {
    kind: 'flip-probe',
    viewport: key,
    section,
    offsetPx: offset,
    scrolled,
    flipped,
    before,
    after,
    ...verdict,
    notes: [
      'before is read ~300 ms after the scroll, while the page is still Lite (before.live must be false for the probe to count)',
      'at = the section whose top is above the 0.35 x innerHeight activation line; chips = the WorldNav aria-current chip, else any aria-current anchor',
      'the flip is the natural one (no class forcing); a load that went live before the scroll is unmeasured, never a pass',
    ],
    invocation,
  });
  console.log(
    `capture-route: [flip-probe] ${key} #${section}+${offset}px before=${before.at}/${before.hudChip ?? before.currentLinks.join(',')} live=${before.live} after=${after.at}/${after.hudChip ?? after.currentLinks.join(',')} verdict=${verdict.verdict}${verdict.reasons.length ? ` (${verdict.reasons.join('; ')})` : ''} -> ${flipPath}`,
  );
}

// C-039 r2: run wall-clock start. Every sidecar carries durationMs (ms from
// this start until that sidecar was written — the last sidecar of a complete
// run is the run total, modulo teardown) plus stationMs (that station's own
// capture split), so baseline-vs-after timing is checkable from the cited
// files alone (PB-144: numbers checkable rather than quoted).
const runStartedAtMs = Date.now();
let exitCode = 0;
/** Round 3: stills whose station content check failed (the run exits 1). */
const stationContentFailures = [];
/** LOOK r4: stills rejected at capture time for a black prefiltered IBL. */
const iblFailures = [];
/**
 * Round 4 (W6 judge: capture-route exited 0 on failing sweep and panel
 * verdicts): every written verdict that failed — sweeps (pass false), loader
 * traces (verdict fail) and particle-corridor checks. The run exits 1 when
 * any is listed; the JSON stays the authoritative record.
 */
const verdictFailures = [];
/** Round 4: loader traces left unmeasured for insufficient sampling (re-shoot list). */
const insufficientSampling = [];
/** @type {import('playwright').Browser | null} */
let browser = null;
// LOOK r2: the quiet viewport whose -quiet.json is not written yet (a throw
// anywhere in its load still leaves an unmeasured sidecar behind).
let quietPending = null;
let serverChild = null;
/** LOOK r6 SEAT H6: a --gpu-trace session is recording (stopped after the loader trace). */
let gpuTraceActive = false;
/** LOOK r6 SEAT H7: per viewport, the cold reveal of this run's loader trace (--warm-cache). */
const coldReveals = {};

try {
  await mkdir(outDir, { recursive: true });
  // Wave 2 round 3 (W7 judge): a non-passing earlier record's PNGs are kept as
  // .try<N>.png beside the .try<N>.json this run will archive.
  const pngTries = await archivePriorTryPngs(outDir, tag);
  if (pngTries.length) console.log(`capture-route: kept earlier-try PNGs for ${pngTries.length} record(s): ${pngTries.map((k) => `${k.json} -> .try${k.n}.png x${k.pngs.length}`).join('; ')}`);
  // Round 3: source freshness stamp (stale-evidence guard) in every record.
  invocation.sourceStamp = await newestSourceMtime();
  // LOOK-PLAN SEAT H --prod-attach: assert the server is next start and
  // never boot one (a dev boot would make the deadline evidence dev evidence).
  const prodAttachRecord = prodAttachOn ? await checkProdAttach() : null;
  if (prodAttachRecord) invocation.prodAttach = prodAttachRecord;
  if (noBootOn && !prodAttachOn) {
    // R40: the runner's default. Never kill a listener, never boot a server.
    const attached = await attachNoBoot(probe, previewUrl, { port });
    invocation.noBoot = { attached: true, attempts: attached.attempts, probes: attached.kinds };
    console.log(`capture-route: --no-boot: server on port ${port} answered (attempt ${attached.attempts}); never killed, never booted`);
  }
  serverChild = prodAttachOn || noBootOn ? null : await ensureServer();

  // Headless Chromium parks the canvas (demand loop) and throttles rAF, so
  // smooth never catches exact and light/dark 768 sample different mid-damps.
  browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--hide-scrollbars',
      // LOOK r3 --cold-shaders: no GPU shader disk / program cache.
      ...(coldShadersOn ? COLD_SHADER_ARGS : []),
      // R43(j): an exact pinned --dpr on a scaled Windows display.
      ...PINNED_SCALE_ARGS,
    ],
  });
  // Round 2: prime `next dev` compilation once per run before the first
  // measured navigation (auto = on for evidence arms / --relax-deadline).
  // LOOK r3: never with --cold-shaders (the warm-up would link the programs).
  if (coldShadersOn) {
    warmupRecord = { ran: false, reason: 'cold-shaders: no warm-up navigation in this browser; GPU shader/program caches disabled', launchArgs: COLD_SHADER_ARGS };
    console.log('capture-route: [warmup] skipped (--cold-shaders: cold GPU program cache, no warm-up navigation)');
  } else if (warmupEnabled(evidenceArms) || (quietProbeOn && evidenceArms.warmup !== 'off')) {
    const [warmW, warmH] = VIEWPORTS[viewportKeys[0]];
    warmupRecord = await runWarmup(browser, warmW, warmH);
  }
  for (const key of viewportKeys) {
    const [width, height] = VIEWPORTS[key];
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: theme, // belt-and-braces with the localStorage pin below
      // S9 --reduced-motion (additive; absent keeps the context options unchanged).
      ...(evidenceArms.reducedMotion ? { reducedMotion: 'reduce' } : {}),
      // Round 4 --dpr (additive; absent keeps the default DPR 1).
      ...(evidenceArms.dpr !== undefined ? { deviceScaleFactor: evidenceArms.dpr } : {}),
      // Wave 2 round 2 --touch on (additive): pointer coarse, hover none.
      ...(touchOn ? { hasTouch: true, isMobile: true } : {}),
    });
    await installUtcDay(context); // R48
    if (evidenceArms.loaderTrace) {
      // S9 --loader-trace: armed before the first navigation so the recorder
      // sees the loader from navigation start (re-arms on every reload).
      // Round 4: with the composite on, the canvas readback pauses over the
      // handoff window so the screencast keeps its cadence.
      await context.addInitScript(installLoaderRecorder, {
        maxSamples: 6000,
        patch: 16,
        handoffPauseAfterMs: evidenceArms.handoffComposite ? HANDOFF_PIXEL_PAUSE_AFTER_MS : 0,
        // Round 5: without the composite the reads stay (the window's only
        // blank-frame evidence) but are throttled so they do not thin the trace.
        handoffThrottleAfterMs: evidenceArms.handoffComposite ? 0 : HANDOFF_PIXEL_PAUSE_AFTER_MS,
        handoffReadEveryMs: HANDOFF_READ_EVERY_MS,
      });
    }
    if (evidenceArms.loaderFilm) {
      // Round 1 --loader-film: the phase-change recorder is armed before the
      // first navigation, like the loader trace's.
      await context.addInitScript(installFilmRecorder, { maxSamples: 5000 });
    }
    if (evidenceArms.loaderTrace || evidenceArms.loaderFilm) {
      // Wave 2 (2H): the ceremony animation audit (CSS animation on
      // transform / opacity), armed before the first navigation.
      await context.addInitScript(installCeremonyAnimationAudit, { tailMs: 1500 });
    }
    if (tier !== 'lite') {
      // LOOK r6 SEAT H5 (CLARITY r5: "the r2-light-1440 phases were only
      // opening>releasing>done"): ball / route-live / scene phases recorded
      // from navigation (two MutationObservers + a 100 ms readiness poll that
      // stops with the ceremony) for the reveal-gate record; with --gpu-trace
      // every change also drops a performance mark (the trace's phase clock).
      await context.addInitScript(installPhaseTrace, { maxMs: 45_000, pollMs: 100, marks: r6Flags.gpuTrace });
    }
    if (evidenceArms.loaderTrace || quietProbeOn) {
      // LOOK r6 SEAT H6: loader-phase long animation frames with their script
      // attribution (sourceURL / sourceFunctionName / sourceCharPosition).
      // Rollout A3 fix: the quiet probe arms it too, so every post-reveal leg
      // (sweep, jump, theme veil) keeps the LoAF rows of its own window and a
      // long task names the script that held it.
      await context.addInitScript(installLoafRecorder, { minMs: 50, maxEntries: quietProbeOn ? 3000 : 400 });
    }
    if (evidenceArms.loaderFilm || evidenceArms.handoffComposite) {
      // Round 3: the shared-clock timecode (bottom-left, 96 x 8 px), so every
      // composited frame carries the rAF time the loader trace uses.
      await context.addInitScript(installTimecode, TIMECODE);
    }
    if (evidenceArms.failInject?.startsWith('context-loss')) {
      // Round 2 --fail-inject context-loss:<phase>: armed before navigation
      // (it must see the page's own getContext call).
      await context.addInitScript(installFailInject, { kind: evidenceArms.failInject });
    }
    if (forceClockWatchOn) {
      // R41: the beatForce clock zero (the first settled live frame, in bus seconds), read
      // once per animation frame until it arms, then stopped. Beat-observation runs only.
      await context.addInitScript(installForceClockWatch, { maxMs: 180_000 });
    }
    if (debugOn) {
      // Round 2: the debug perf readout is hidden from navigation on, so the
      // loader trace / film never records it over the docked ball (the
      // readiness bridge it rides with stays on).
      await context.addInitScript(installDebugHudHide, DEV_OVERLAY_HIDE_CSS);
    }
    // LOOK r3: a fresh context pins the --theme again (the quiet-theme leg
    // moves the expectation only inside its own context).
    expectedTheme = theme;
    await context.addInitScript(
      (t) => window.localStorage.setItem('theme', t),
      theme,
    );
    await context.addInitScript(() => {
      try {
        Object.defineProperty(Document.prototype, 'hidden', {
          configurable: true,
          get: () => false,
        });
        Object.defineProperty(Document.prototype, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.addEventListener(
          'visibilitychange',
          (event) => event.stopImmediatePropagation(),
          true,
        );
      } catch {
        /* launch args still unthrottle rAF if the prototype is locked */
      }
    });
    if (ledPinOn) {
      // C-057 kiosk-LED content pin: the boards' once-a-second live ticker
      // strip is route-preview's only page-side Date.now() read (Board.tsx),
      // so freezing it at the canonical epoch paints the identical countdown
      // in every load — the per-load LED content noise is gone.
      await context.addInitScript((nowMs) => {
        Date.now = () => nowMs;
      }, LED_PIN_NOW_MS);
    }
    if (crestPinOn) {
      // LOOK r3 crest LED pin: interval registrations of exactly the crest
      // hold delay return a dead id (the LED keeps its first slide); every
      // blocked registration is counted with its call site for the sidecar.
      await context.addInitScript((delayMs) => {
        const real = window.setInterval.bind(window);
        const record = { delayMs, blocked: 0, sites: [] };
        Object.defineProperty(window, '__crestPin', { value: record, configurable: true });
        let fakeId = -1;
        window.setInterval = function pinnedSetInterval(handler, timeout, ...rest) {
          if (Number(timeout) === delayMs) {
            record.blocked += 1;
            if (record.sites.length < 4) {
              const stack = String(new Error().stack || '').split('\n').slice(2, 4).map((l) => l.trim());
              record.sites.push(stack.join(' | '));
            }
            fakeId -= 1;
            return fakeId;
          }
          return real(handler, timeout, ...rest);
        };
      }, CREST_HOLD_MS);
    }
    if (quietProbeOn) {
      // LOOK-PLAN SEAT H: the quiet recorder is armed before the first
      // navigation (resource / longtask observers, GL counters, renderer).
      await context.addInitScript(installQuietProbe, { maxLog: 50000 });
    }
    if (pointerPinOn) {
      // LOOK r2 SEAT H: the pointer pin (parallax parked at the centre for
      // every still; see installPointerPin).
      await context.addInitScript(installPointerPin);
    }
    const page = await context.newPage();
    await page.bringToFront();
    // LOOK r2 SEAT H: this load's world-asset requests (host, source, bytes)
    // for every sidecar's assetOrigin (the local-mirror check, D22).
    {
      const assetRequests = [];
      activeAssetLog = { requests: assetRequests, origin: new URL(previewUrl).origin };
      const byRequest = new WeakMap();
      page.on('request', (req) => {
        const url = req.url();
        // Sprites-bucket requests too: assetOriginSummary counts them apart for the bucket guard.
        if (!isWorldAssetUrl(url) && !isSpritesBucketUrl(url)) return;
        // LOOK r3: the epoch of the request, so the full list carries timing.
        const rec = { url, epoch: Date.now() };
        byRequest.set(req, rec);
        assetRequests.push(rec);
      });
      page.on('requestfinished', (req) => {
        const rec = byRequest.get(req);
        if (!rec) return;
        req
          .sizes()
          .then((s) => {
            rec.bytes = s.responseBodySize;
          })
          .catch(() => {});
      });
    }
    // SEAT H: the browser's own request channel (epoch-stamped), beside the
    // in-page PerformanceObserver.
    const quietRequests = [];
    if (quietProbeOn) page.on('request', (req) => quietRequests.push({ url: req.url(), epoch: Date.now(), type: req.resourceType() }));
    if (quietProbeOn) quietPending = { key, page, requests: quietRequests };
    if (evidenceArms.flipProbe !== null) {
      // Round 2 --flip-probe replaces this viewport's stills.
      await runFlipProbe(page, key);
      await context.close();
      continue;
    }
    // Round 1 --loader-film: the screencast starts before navigation so the
    // film covers the ceremony from its first frame. Round 2: plus periodic
    // composited screenshots at a steady cadence; the handoff composite
    // shares the film's capture when both are on (one screencast per page).
    const loaderFilm = evidenceArms.loaderFilm
      ? await startLoaderFilm(page, { cadenceMs: evidenceArms.handoffComposite ? COMPOSITE_CADENCE_MS : FILM_CADENCE_MS })
      : null;
    // Round 2 --handoff-composite: the composited page for the handoff
    // window, started before navigation like the film's.
    const compositeFilm = evidenceArms.handoffComposite
      ? loaderFilm ?? (await startLoaderFilm(page, { quality: 60, cadenceMs: COMPOSITE_CADENCE_MS }))
      : null;
    // Round 2 --fail-inject timeout: hold the lazily loaded scene chunk past
    // the readiness deadline (then release it, so a late presentation is
    // exercised as well). Every held URL is recorded.
    let timeoutInject = null;
    if (evidenceArms.failInject === 'timeout') {
      // LOOK r6 SEAT H1 (CAR prod: "fault=timeout@never" — hashed production
      // chunk URLs never match the dev regex): every Next chunk is fetched by
      // the harness and only the one whose BODY carries the R3F hook error
      // string is held (sceneChunkMatch); the dev URL regex stays the fast
      // path. Fallback: the world manifest is held while no scene chunk has
      // been. Every other chunk is fulfilled at once with its own response.
      timeoutInject = {
        kind: 'timeout',
        pattern: String(FAIL_TIMEOUT_CHUNK_RE),
        matchers: ['url: dev scene chunk regex', 'content: a /_next/static/chunks/*.js body carrying the R3F hook error string', 'fallback: the world manifest.json while no scene chunk is held'],
        held: [],
        sniffed: 0,
        holdUntilEpochMs: null,
        missed: null,
        firedAt: null,
      };
      const navAt = Date.now();
      timeoutInject.holdUntilEpochMs = navAt + REVEAL_DEADLINE_MS + FAIL_TIMEOUT_HOLD_PAST_DEADLINE_MS;
      const holdFor = async () => new Promise((r) => setTimeout(r, Math.max(0, timeoutInject.holdUntilEpochMs - Date.now())));
      await page.route(
        (url) => timeoutRoutePredicate(url.href),
        async (route) => {
          const href = route.request().url();
          const record = (by, bytes = null) => timeoutInject.held.push({ url: new URL(href).pathname, by, heldAtMs: Date.now() - navAt, ...(bytes !== null ? { bytes } : {}) });
          try {
            if (sceneChunkMatch(href) === 'url') {
              record('url');
              await holdFor();
              await route.continue().catch(() => {});
              return;
            }
            if (isWorldManifestUrl(href)) {
              if (manifestFallbackHolds(timeoutInject.held)) {
                record('manifest');
                await holdFor();
              }
              await route.continue().catch(() => {});
              return;
            }
            if (!isNextChunkUrl(href)) {
              await route.continue().catch(() => {});
              return;
            }
            const response = await route.fetch();
            const body = await response.body();
            timeoutInject.sniffed += 1;
            if (sceneChunkMatch(href, body) === 'content') {
              record('content', body.length);
              await holdFor();
            }
            await route.fulfill({ status: response.status(), headers: fulfilHeaders(response.headers()), body }).catch(() => {});
          } catch {
            // A navigation abort or a closed page: let the request go.
            await route.continue().catch(() => {});
          }
        },
      );
    }
    if (evidenceArms.failInject === 'stall-hold') {
      // LOOK r6 SEAT H1 (the product's ?stallInjectMs hook is dev-only): a
      // harness-side stall for production builds — every world-asset request
      // (manifest, GLBs, textures) is held from navigation until deadline +
      // 8 s, so the load cannot progress; analysis.stallPath judges Lite by
      // the attempt's begin (or the renderer rise) + 6 s.
      timeoutInject = { kind: 'stall-hold', pattern: 'world assets (isWorldAssetUrl: /models/world, /textures/world, the world-assets bucket)', held: [], sniffed: 0, holdUntilEpochMs: null, missed: null, firedAt: null };
      const navAt = Date.now();
      timeoutInject.holdUntilEpochMs = navAt + REVEAL_DEADLINE_MS + FAIL_TIMEOUT_HOLD_PAST_DEADLINE_MS;
      await page.route(
        (url) => isWorldAssetUrl(url.href),
        async (route) => {
          if (timeoutInject.held.length < 200) timeoutInject.held.push({ url: new URL(route.request().url()).pathname, by: 'world-asset', heldAtMs: Date.now() - navAt });
          await new Promise((r) => setTimeout(r, Math.max(0, timeoutInject.holdUntilEpochMs - Date.now())));
          await route.continue().catch(() => {});
        },
      );
    }
    if (evidenceArms.reducedMotion) {
      // Round 2 (lead): emulate reduced motion on the page too, BEFORE the
      // navigation (belt and braces with the context option).
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    // LOOK r6 SEAT H7 --net-throttle <mbps>,<rttMs> (CAR prod: "desktop
    // broadband was measured on localhost with no throttling"): the measured
    // page's network is shaped through CDP before the navigation.
    if (r6Flags.netThrottle) {
      const conditions = netThrottleConditions(r6Flags.netThrottle);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', conditions);
      console.log(`capture-route: [net-throttle] ${key} ${r6Flags.netThrottle.mbps} Mbps / ${r6Flags.netThrottle.rttMs} ms RTT (CDP Network.emulateNetworkConditions ${JSON.stringify(conditions)})`);
    }
    // LOOK r6 SEAT H6 --gpu-trace: a Chromium trace of the load (gpu,
    // gpu.angle, viz, devtools.timeline, v8.execute, user timing for the
    // phase marks), started before the navigation, stopped after the loader trace.
    const gpuTracePath = resolve(outDir, `${tag}-${key}-gpu-trace.json`);
    if (r6Flags.gpuTrace) {
      if (gpuTraceActive) await browser.stopTracing().catch(() => {});
      await browser.startTracing(page, { path: gpuTracePath, screenshots: false, categories: GPU_TRACE_CATEGORIES });
      gpuTraceActive = true;
      console.log(`capture-route: [gpu-trace] ${key} tracing ${GPU_TRACE_CATEGORIES.join(',')} -> ${gpuTracePath} (adds capture load: never a timing reference)`);
    }
    // Lite-bound runs (a fault, the reduced-motion floor) never settle live,
    // so their traces run to a fixed bound past the deadline.
    const liteBound = evidenceArms.failInject !== undefined || (evidenceArms.reducedMotion && tier === 'auto');
    await page.goto(pageUrl, { waitUntil: liteBound ? 'domcontentloaded' : 'networkidle', timeout: 60_000 });
    const shareCapture = loaderFilm !== null && compositeFilm === loaderFilm && evidenceArms.loaderTrace;
    const filmCollected = loaderFilm ? await collectLoaderFilm(page, loaderFilm, { stop: !shareCapture }) : null;
    await page.waitForTimeout(INITIAL_SETTLE_MS);
    const devPortals = await hideNextDevOverlay(page); // C-106 r2: dev chrome down after load, before any capture
    if (prodAttachOn) {
      // SEAT H: a production build injects no dev overlay (nextjs-portal).
      invocation.prodAttach.devOverlayByViewport[key] = devPortals;
      if (devPortals > 0) verdictFailures.push(`${key} prod-attach: the page carries the next dev overlay (${devPortals} nextjs-portal) — not a production build`);
    }
    // S9 --loader-trace: the recorder ran from navigation start; close it out
    // on the first load (before any station scroll changes the picture).
    let traceResult = null;
    if (evidenceArms.loaderTrace) {
      const reducedMotionMatched =
        evidenceArms.reducedMotion && tier === 'auto'
          ? await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          : null;
      traceResult = await writeLoaderTrace(page, key, {
        compositeFilm,
        fault: evidenceArms.failInject
          ? async () => {
              if (timeoutInject) {
                if (timeoutInject.held.length === 0) {
                  timeoutInject.missed =
                    timeoutInject.kind === 'stall-hold'
                      ? `no world-asset request was made (${timeoutInject.pattern})`
                      : `no request matched ${timeoutInject.pattern}, no sniffed chunk carried the R3F marker (${timeoutInject.sniffed} chunk(s) sniffed) and no world manifest was requested`;
                }
                else timeoutInject.firedAt = timeoutInject.held[0].heldAtMs;
                return { ...timeoutInject };
              }
              if (isStallKind(evidenceArms.failInject)) {
                // Product-side (scene-progress.ts reads ?stallInjectMs): the
                // page must have the param; analysis.stallPath judges it.
                const search = await page.evaluate(() => location.search);
                const onPage = new URLSearchParams(search).get('stallInjectMs');
                const ms = stallInjectMs(evidenceArms.failInject);
                return onPage === String(ms)
                  ? { kind: evidenceArms.failInject, stallInjectMs: ms, productSide: true }
                  : { kind: evidenceArms.failInject, missed: `stallInjectMs not on the page URL (${search})` };
              }
              const status = await page.evaluate(() => window.__captureFailInject?.status() ?? null);
              if (!status) return { kind: evidenceArms.failInject, missed: 'injector did not install' };
              // How long the page took to learn of the loss (event-loop
              // latency: the dispatch queues behind a busy main thread).
              return typeof status.lostEventAt === 'number' && typeof status.firedAt === 'number'
                ? { ...status, lossToEventMs: +(status.lostEventAt - status.firedAt).toFixed(1) }
                : status;
            }
          : null,
        liteFloor: reducedMotionMatched === null ? null : { reducedMotionMatched },
        // LOOK r2: every trace may run to the Lite bound — a load that
        // settles live still ends early (quiet window), and a slow one is
        // followed past the 20 s deadline instead of cut at 18 s.
        traceMaxMs: LOADER_TRACE_LITE_MS,
      });
      // Round 4: a failed loader verdict fails the run; an under-sampled one
      // is listed for a re-shoot (never a pass, never a fail).
      if (traceResult.analysis.verdict === 'fail') {
        verdictFailures.push(`${key} loader-trace: ${traceResult.analysis.reasons.join('; ')} (${traceResult.file})`);
      } else if (traceResult.analysis.unmeasuredReason === 'insufficient-sampling') {
        insufficientSampling.push(`${key} (${traceResult.file})`);
      }
    }
    // Round 2: the film is written after the trace so a same-navigation film
    // is stamped against it.
    if (filmCollected) {
      // Round 3: a shared capture is stopped here, after the trace (stop() is
      // idempotent — the trace's composite already received the same frames).
      if (!filmCollected.captured) filmCollected.captured = await loaderFilm.stop();
      const compositor = await writeLoaderFilm(key, filmCollected, traceResult);
      // Wave 2 (2H): a ceremony animation off the compositor fails the run;
      // the cadence verdict is evidence only (the screencast can be thinned
      // by the harness itself — logged, re-shot before it is believed).
      if (compositor.animations.verdict === 'fail') verdictFailures.push(`${key} loader-film: ceremony animation ${compositor.animations.reasons.join('; ')}`);
      if (compositor.cadence.verdict === 'fail') console.log(`capture-route: [loader-film] ${key} compositor cadence FAIL (${compositor.cadence.reasons.join('; ')}) — evidence only; re-shoot before believing it`);
      // LOOK r3: the whole-ceremony bar (> 250 ms) fails the run when the
      // periodic screenshots corroborate the gap (or cannot: no periodic
      // source); an uncorroborated fail is logged for a re-shoot.
      if (compositor.ceremony?.failsRun) verdictFailures.push(`${key} loader-film: whole-ceremony ${compositor.ceremony.reasons.join('; ')}`);
      else if (compositor.ceremony?.verdict === 'fail') console.log(`capture-route: [loader-film] ${key} whole-ceremony FAIL not corroborated by the periodic screenshots — re-shoot before believing it`);
    }
    // LOOK r6 SEAT H6: the GPU trace covers navigation -> the loader trace's end.
    if (gpuTraceActive) {
      gpuTraceActive = false;
      await finishGpuTrace(key, gpuTracePath, traceResult);
    }
    // LOOK r6 SEAT H7 --warm-cache: this viewport's cold reveal (the leg runs after the loop).
    if (r6Flags.warmCache && traceResult) coldReveals[key] = { routeLiveAt: traceResult.analysis?.routeLiveAt ?? traceResult.analysis?.timeline?.routeLiveAt ?? null, ballEndAt: traceResult.analysis?.timeline?.ballEndAt ?? null, file: traceResult.file, coldShaders: coldShadersOn };
    if (evidenceArms.failInject !== undefined) {
      // A sabotaged load is its own evidence; no stills.
      console.log(`capture-route: [fail-inject] ${key} ${evidenceArms.failInject} — trace written, stills skipped for this viewport`);
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await context.close();
      continue;
    }
    if (evidenceArms.loaderTrace || evidenceArms.loaderFilm) {
      // A Lite landing (reduced motion without --tier route, a failed scene)
      // has no present hook, so its stills would fail by design; the trace /
      // film is the evidence for that run.
      const effectiveTier = await page.evaluate(() =>
        document.documentElement.classList.contains('world-route-live') ? 'route' : 'lite',
      );
      if (effectiveTier === 'lite') {
        const arm = evidenceArms.loaderTrace ? 'loader-trace' : 'loader-film';
        const what = evidenceArms.loaderTrace ? 'trace' : 'film';
        console.log(`capture-route: [${arm}] ${key} landed on Lite — ${what} written, stills skipped for this viewport`);
        await context.close();
        continue;
      }
    }
    // Round 1 reveal gate: no seek / still / sweep / trace until the route is
    // live and the ball ceremony is over (bounded, named failure).
    let revealGate;
    try {
      revealGate = await waitForRevealGate(page);
    } catch (err) {
      if (!quietProbeOn) throw err;
      // LOOK r2 (CAR judge): a quiet run whose reveal gate aborts still
      // writes its -quiet.json (unmeasured, with the reason and the
      // recorder's since-navigation counters), then fails the run.
      const msg = err instanceof Error ? err.message : String(err);
      const quiet = await writeQuietUnmeasured(page, key, { reason: msg, stage: 'reveal-gate', revealGate: err?.revealGate ?? null, requests: quietRequests });
      quietPending = null;
      verdictFailures.push(`${key} quiet-probe: unmeasured (${msg.split(' — ')[0]}) (${quiet.file})`);
      await context.close();
      continue;
    }
    // LOOK r6 SEAT H6 --program-keys (ENGINE E7): the program-key dump after the reveal.
    if (r6Flags.programKeys && !quietProbeOn && REVEALED_MODES.includes(revealGate.mode)) await writeProgramKeys(page, key);
    if (quietProbeOn) {
      // LOOK-PLAN SEAT H: the post-reveal quiet probe replaces this viewport's stills.
      const quiet = await runQuietProbe(page, key, revealGate, quietRequests);
      quietPending = null;
      if (quietInject) {
        // Self-test: the injected fetch / program must be what failed the verdict.
        if (quiet.inject?.detected) {
          console.log(`capture-route: [quiet-inject] ${key} ${quietInject} detected — the verdict failed on the injection (self-test PASS; quiet pass=${quiet.pass})`);
        } else {
          verdictFailures.push(`${key} quiet-inject ${quietInject}: NOT detected — the probe has no teeth (${quiet.inject?.reason ?? 'no inject record'}; ${quiet.file})`);
        }
      } else if (!quiet.pass) {
        verdictFailures.push(`${key} quiet-probe: ${quiet.reasons.map((r) => r.split(' (')[0]).join('; ')} (${quiet.file})`);
      }
      await context.close();
      continue;
    }
    if (navRevealProbeOn) {
      // CHROME (D33): the NavBar reveal probe replaces this viewport's stills.
      const nav = await runNavRevealProbe(page, { key, touch: touchOn, outDir, tag, theme, writeJson });
      if (!nav.pass) verdictFailures.push(`${key} nav-reveal-probe: ${nav.failing.map((f) => f.split(' (')[0]).join('; ')} (${nav.file})`);
      await context.close();
      continue;
    }
    if (evidenceArms.sweep) {
      // S9 --sweep replaces this viewport's stills with the W6 gesture.
      const sweepResult = await runSweepArm(page, key, revealGate);
      if (sweepResult && sweepResult.pass !== true) verdictFailures.push(`${key} sweep ${evidenceArms.sweep}: pass=false (${sweepResult.file})`);
      await context.close();
      continue;
    }
    if (residencyFlakeInject > 0) {
      // Armed AFTER the initial load so the stalled GLB responses cannot
      // delay the navigation's own networkidle window.
      await armResidencyFlakeInject(context, residencyFlakeInject);
    }

    for (const section of sections) {
      const stationStartedAtMs = Date.now();
      const outPath = resolve(outDir, `${tag}-${section}${focusSuffix}-${key}.png`);
      const probePath = resolve(outDir, `${tag}-${section}${focusSuffix}-${key}.json`);
      const phasePinArg = phasePinOn
        ? { mode: 'pinned', uTime: PIN_U_TIME, elapsedTime: PIN_ELAPSED }
        : { mode: 'off' };

      // C-046 bounded hydration-flake retry: when __routeWorldPresent never
      // mounts (missing-hook / present-hook-timeout — seen once in 40+
      // captures under 3-seat load), reload the page and re-land the station,
      // at most PRESENT_MAX_RELOADS times, then fail honestly with the
      // attempt count and the effective tier. Every successful capture
      // records presentRetries in its sidecar (0 = clean first attempt).
      // --present-flake-inject (self-test shim) deterministically exercises
      // the path: it fails the first N attempts as present-hook-timeout.
      let applied;
      let presented;
      let presentRetries = 0;
      // LOOK r3 (CLARITY judge: "the rung-2 after set is post-recovery"):
      // why each reload happened, for the sidecar's loadProvenance.
      const presentRetryReasons = [];
      let injectRemaining = presentFlakeInject;
      // C-109 r1: the attribution scan record for this station's sidecar
      // (re-filled by every landing attempt; stamped after the present).
      let projectScan = null;
      // Round 1: the station-settle record for this still's sidecar.
      let stationSettle = null;
      // Round 3: the station content record (subject presence + count).
      let stationContent = null;
      // Wave 2 round 2: the --hover arm's record (null without --hover).
      let hoverArm = null;
      // LOOK r2 SEAT H: the pointer pin record of this still (null when off).
      let pointerPin = null;
      for (let attempt = 0; ; attempt += 1) {
        if (attempt > 0) {
          console.log(
            `capture-route: hydration-flake retry ${presentRetries}/${PRESENT_MAX_RELOADS} — reloading #${section} and re-landing before re-presenting`,
          );
          await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60_000 });
          await page.waitForTimeout(INITIAL_SETTLE_MS);
          await hideNextDevOverlay(page); // C-106 r2: the reload is a fresh page load
          // Round 1: a reload replays the ceremony — gate it again.
          revealGate = await waitForRevealGate(page);
        }
        if (revealGate.mode === 'lite') {
          // Round 2: a load gated "lite" can still have gone live by the
          // time the station is landed (round 1: mountain 390 stills were
          // gate-lite yet tier.effective=route with a live world on screen).
          // Re-gate so a live world is always station-asserted.
          const liveNow = await page.evaluate(() => document.documentElement.classList.contains('world-route-live'));
          if (liveNow) {
            console.log('capture-route: reveal gate said Lite but the route is live now — re-gating before the landing');
            revealGate = { ...(await waitForRevealGate(page)), regatedFrom: 'lite' };
          }
        }
        if (REVEALED_MODES.includes(revealGate.mode)) {
          // Round 1: land AND assert (one re-seek, then a loud named failure
          // with a failure sidecar and no still).
          try {
            ({ applied, settle: stationSettle } = await landStation(page, section));
          } catch (err) {
            if (err && typeof err === 'object' && 'stationSettle' in err) {
              await writeJson(probePath, {
                section,
                failed: true,
                reason: 'station-settle-failed',
                stationSettle: err.stationSettle,
                revealGate,
                durationMs: Date.now() - runStartedAtMs,
                stationMs: Date.now() - stationStartedAtMs,
                notes: [
                  `no still was written by this run for #${section}; a ${outPath.slice(outDir.length + 1)} on disk is from an earlier run`,
                ],
                invocation,
              });
              console.error(`capture-route: station-settle failure sidecar -> ${probePath}`);
            }
            throw err;
          }
          // Round 3: the camera landed — now check the station SHOWS its
          // content (subject presence + content count vs baseline).
          stationContent = await checkStationContent(page, section, key);
        } else {
          // Effective Lite (or --tier lite): no conductor to assert against;
          // the landing and the present path behave exactly as before.
          applied = await prepareStation(page, section);
          stationSettle = { ok: null, skipped: `reveal-gate-${revealGate.mode}` };
          stationContent = null;
        }
        // C-109 r1: the attribution projection scan runs in the same settled
        // load as the present (read-only; the camera and instance matrices
        // are the frame's own).
        projectScan = null;
        if (projectInstancesRaw !== null) {
          projectScan = await runProjectInstancesScan(page);
          if (!projectScan.ok) {
            throw new Error(
              `project-instances failed (${projectScan.reason}${projectScan.missing ? `: ${projectScan.missing}` : ''})`,
            );
          }
          console.log(
            `capture-route: [project-instances] ${section} camPos=[${projectScan.camPos.map((v) => +v.toFixed(4)).join(', ')}] viewport=${projectScan.viewport.W}x${projectScan.viewport.H} bandTop=${projectScan.bandTop} centerCheck=${JSON.stringify(projectScan.centerCheck)}`,
          );
          for (const meshRow of projectScan.meshes) {
            console.log(
              `capture-route: [project-instances] ${section} ${meshRow.name} count=${meshRow.count} inFrame=${meshRow.inFrame} inBand=${meshRow.inBand} samples=${JSON.stringify(meshRow.samples)}`,
            );
          }
        }
        try {
          if (injectRemaining > 0) {
            injectRemaining -= 1;
            throw new Error(
              'FBO present failed (present-hook-timeout) — injected by --present-flake-inject (self-test shim)',
            );
          }
          // Wave 2 round 2: --hover moves the real pointer onto the subject
          // right before the present, so the still carries the brackets + pill.
          hoverArm = null;
          if (hoverSubject && REVEALED_MODES.includes(revealGate.mode)) {
            hoverArm = await runHoverArm(page, hoverSubject);
            console.log(
              `capture-route: [hover] ${section} ${key} ${hoverSubject} verdict=${hoverArm.verdict}${hoverArm.reason ? ` (${hoverArm.reason})` : ''}${hoverArm.overlay ? ` mode=${hoverArm.overlay.mode} target=${hoverArm.overlay.target}` : ''}`,
            );
          }
          // LOOK r2 SEAT H: park the pointer parallax at the centre (the real
          // cursor is blocked while pinned) so the landed yaw / pitch is the
          // authored pose, identical run to run; released after the present.
          pointerPin = pointerPinOn && !hoverArm && REVEALED_MODES.includes(revealGate.mode) ? await pinPointerForStill(page) : null;
          try {
            presented = await writePresentedPng(page, outPath, phasePinArg, materialPatchSpecs, hideMeshNames, {
              transition: presentTransition({ focus: focusId }),
            });
          } finally {
            if (pointerPin) {
              const released = await releasePointerPin(page);
              pointerPin = { ...pointerPin, blockedEvents: released?.blocked ?? null };
            }
          }
          if (pointerPin) {
            console.log(
              `capture-route: [pointer-pin] ${section} ${key} converged=${pointerPin.converged ?? 'n/a'} residual=${pointerPin.residualRad ?? 'n/a'}rad waited=${pointerPin.waitedMs ?? 'n/a'}ms blocked=${pointerPin.blockedEvents ?? 'n/a'}`,
            );
          }
          break;
        } catch (err) {
          if (!isHydrationFlakePresentFailure(err)) throw err;
          if (presentRetries >= PRESENT_MAX_RELOADS) {
            let effectiveTier = 'unknown';
            try {
              effectiveTier = await page.evaluate(() =>
                document.documentElement.classList.contains('world-route-live') ? 'route' : 'lite',
              );
            } catch {
              /* page gone — report unknown */
            }
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(
              `${detail} — still failing after ${presentRetries} reload-retries (bound ${PRESENT_MAX_RELOADS}); effectiveTier=${effectiveTier}` +
                (effectiveTier === 'lite'
                  ? ' (the lite tier mounts no present hook by design — check --tier)'
                  : ''),
            );
          }
          presentRetries += 1;
          presentRetryReasons.push(String(err instanceof Error ? err.message : err).split('\n')[0].slice(0, 300));
          console.error(
            `capture-route: ${err instanceof Error ? err.message : String(err)} — classifying as hydration flake, reloading to retry (${presentRetries}/${PRESENT_MAX_RELOADS})`,
          );
        }
      }
      const phasePinRecord = { ...(presented.phasePin ?? { mode: phasePinArg.mode }), rung: phasePinRung };
      // Round 4 (W1 judge: __routeWorldParticles() was never called): the
      // live particle corridors must contain every rendered face corner at
      // the presented pose (debug sessions, route tier). A corridor that
      // does not fails the run as particle-corridor-open (still + sidecar kept).
      let particleCorridor = null;
      if (debugOn && REVEALED_MODES.includes(revealGate.mode)) {
        const read = await page.evaluate(() => {
          // Wave 2 (2H): the other debug bridges being up on a live route is
          // the proof that an absent particle readout means "no emitter".
          const bridgesUp =
            document.documentElement.classList.contains('world-route-live') &&
            typeof window.__routeWorldCamera === 'function' &&
            typeof window.__routeWorldAudit === 'function';
          const fn = window.__routeWorldParticles;
          if (typeof fn !== 'function') return { rows: null, bridgesUp };
          try {
            return { rows: fn(), bridgesUp };
          } catch (err) {
            return { rows: null, bridgesUp: false, error: String((err && err.message) || err) };
          }
        });
        particleCorridor = particleCorridorVerdict(read.rows, { bridgesUp: read.bridgesUp === true });
        if (read.error) particleCorridor = { ...particleCorridor, error: read.error };
        console.log(
          `capture-route: [particles] ${section} ${key} corridor=${particleCorridor.verdict}${particleCorridor.liveCorridors !== undefined ? ` live=${particleCorridor.liveCorridors}` : ''}${particleCorridor.open.length ? ` open=${particleCorridor.open.map((o) => o.station).join(',')}` : ''}`,
        );
        if (particleCorridor.verdict === 'fail') {
          verdictFailures.push(`${key} #${section}: particle-corridor-open (${particleCorridor.open.map((o) => o.station).join(',')})`);
        }
      }
      // S9 --occlusion on: one-shot W1 record at the still's own pose (same
      // load, right after the present; the camera has not moved).
      let occlusionRecord = null;
      if (evidenceArms.occlusion) {
        // Round 3: judged on this station's own subjects, and FAILED when the
        // subject is missing (never a vacuous pass).
        occlusionRecord = await occlusionSnapshot(page, { ...EVIDENCE_GRID, station: section, presence: stationContent?.presence ?? null });
        if (!occlusionRecord.ok) throw new Error(`occlusion probe failed (${occlusionRecord.reason})`);
        // Wave 2 (2H, residual 4): the Station Card ([data-station-caption])
        // over one of THIS station's faces is a W1 fail (plan §3: domOverlaps
        // = [] for the card); overlaps with other subjects stay informational.
        const captionOverlaps = occlusionRecord.domOverlaps.filter(
          (o) => o.layer === '[data-station-caption]' && subjectBelongsTo(o.id, section),
        );
        occlusionRecord = { ...occlusionRecord, captionOverlaps };
        console.log(
          `capture-route: [occlusion] ${section} rows=${occlusionRecord.report.rows.length} W1=${occlusionRecord.w1.verdict} domOverlaps=${occlusionRecord.domOverlaps.length}${captionOverlaps.length ? ` captionOverFace=${captionOverlaps.map((o) => `${o.id}:${o.share.toFixed(2)}`).join(',')}` : ''}${occlusionRecord.w1.failing.length ? ` failing=${occlusionRecord.w1.failing.map((f) => `${f.id}:${f.occludedFraction?.toFixed(2)}${f.topOccluders?.length ? `<${f.topOccluders.slice(0, 2).map((o) => o.name).join('|')}` : ''}`).join(',')}` : ''}`,
        );
        // Wave 2 (2H, residual 4): a failing W1 occlusion verdict exits 1
        // (the still and its sidecar stay on disk as the evidence).
        if (occlusionRecord.w1.verdict === 'fail') {
          verdictFailures.push(
            `${key} #${section}: W1 occlusion ${occlusionRecord.w1.reason ?? 'fail'} (${occlusionRecord.w1.failing.map((f) => `${f.id}:${f.occludedFraction?.toFixed(2)}`).join(',') || 'subject missing'})`,
          );
        }
        if (captionOverlaps.length > 0) {
          verdictFailures.push(`${key} #${section}: caption-over-face (${captionOverlaps.map((o) => `${o.id}:${o.share.toFixed(2)}`).join(',')})`);
        }
      }
      // Wave 2 (2H): per-still W1 records on evidence runs over a live route —
      // the docked panel (font-size >= 14 px, in the viewport), the
      // pass-through bridges (never judged), --luma and --audit.
      const liveStill = REVEALED_MODES.includes(revealGate.mode);
      // Wave 2 round 2 (W1 judge, D15): the Station Card at a settled
      // station pose — absent, below 0.99 opacity or a stretched box fails.
      let stationCardRecord = presented.stationCard ?? null;
      if (stationCardRecord && liveStill) {
        const cardJudge = stationCardVerdict(stationCardRecord, {
          settled: stationSettle?.ok === true,
          focus: Boolean(focusId) || (await page.locator('.world-focus-panel[open]').count()) > 0,
        });
        stationCardRecord = { ...stationCardRecord, verdict: cardJudge.verdict, reasons: cardJudge.reasons };
        console.log(
          `capture-route: [card] ${section} ${key} verdict=${cardJudge.verdict}${cardJudge.reasons.length ? ` (${cardJudge.reasons.join('; ')})` : ''} kicker=${JSON.stringify(stationCardRecord.kicker ?? null)} cta=${stationCardRecord.cta ? `${JSON.stringify(stationCardRecord.cta.label)}->${stationCardRecord.cta.href}` : 'none'}`,
        );
        if (cardJudge.verdict === 'fail' && anyEvidenceFlag(evidenceArms)) verdictFailures.push(`${key} #${section}: station-card ${cardJudge.reasons.join('; ')}`);
      }
      // Wave 2 round 2 (W1 judge: "--param board=roster did not open the
      // panel"): a panel-opening page param must show an open docked panel at
      // present time, or the still is not evidence of that panel.
      let paramPanel = null;
      const panelParams = extraPageParams.filter(({ key }) => ['board', 'team', 'mon'].includes(key));
      if (panelParams.length > 0 && liveStill) {
        const read = await page.evaluate(() => {
          const panel = document.querySelector('.world-focus-panel[open]');
          let focus = null;
          try {
            focus = window.__routeWorldFocus?.state?.() ?? null;
          } catch {
            focus = null;
          }
          return { open: Boolean(panel), search: location.search, focus: focus ? { id: focus.id ?? null, phase: focus.phase ?? null, panel: focus.panel ?? null } : null };
        });
        paramPanel = { requested: panelParams.map(({ key, value }) => `${key}=${value}`), ...read, verdict: read.open ? 'pass' : 'fail' };
        console.log(`capture-route: [param-panel] ${section} ${key} ${paramPanel.requested.join('&')} open=${read.open} focus=${read.focus ? `${read.focus.id}/${read.focus.phase}` : 'none'}`);
        if (!read.open) verdictFailures.push(`${key} #${section}: param-panel-not-open (${paramPanel.requested.join('&')}; focus ${read.focus ? `${read.focus.id}/${read.focus.phase}` : 'none'}; url ${read.search})`);
      }
      if (hoverArm && hoverArm.verdict === 'fail') verdictFailures.push(`${key} #${section}: hover ${hoverSubject} ${hoverArm.reason ?? 'fail'}`);
      let dockedPanel = null;
      let bridges = null;
      let lumaRecord = null;
      let drawAudit = null;
      if (anyEvidenceFlag(evidenceArms) && liveStill) {
        dockedPanel = dockedPanelVerdict(await readDockedPanel(page));
        if (dockedPanel.verdict === 'fail') verdictFailures.push(`${key} #${section}: docked-panel ${dockedPanel.reasons.join('; ')}`);
        if (debugOn) bridges = await readPassThroughBridges(page);
        console.log(
          `capture-route: [w1] ${section} ${key} dockedPanel=${dockedPanel.verdict}${dockedPanel.minTextFontPx !== undefined && dockedPanel.minTextFontPx !== null ? ` minFont=${dockedPanel.minTextFontPx}px inViewport=${dockedPanel.inViewport}` : ''}${typeof dockedPanel.bodyTextNodes === 'number' ? ` bodyText=${dockedPanel.bodyTextNodes}` : ''}${bridges ? ` beats=${bridges.beats.status} attacks=${bridges.attacks.status}` : ''}`,
        );
      }
      if (evidenceArms.luma && liveStill) {
        lumaRecord = await runLumaArm(page, outPath, section, presented);
        const l = lumaRecord.luma;
        console.log(
          `capture-route: [luma] ${section} ${key} verdict=${l.verdict} exFigures=${l.exFigures ?? 'n/a'} activeFaceP99=${l.activeFaceP99} outsideP995=${l.outsideP995} hotspots=${l.hotspotsTotal ?? 0} contrast=${lumaRecord.contrast.verdict}${typeof lumaRecord.contrast.minContrast === 'number' ? ` min=${lumaRecord.contrast.minContrast}` : ''}`,
        );
        // The wave-2 bar: outsideP995 <= activeFaceP99 with figure rects
        // exempt (wave 3's metal clamp); figure-only hotspots are logged.
        // LOOK r2: a saturated luma read (face P99 and outside P995 both
        // clipped) carries no information; the contrast verdict decides.
        if (l.exFigures === 'saturated' || l.verdict === 'saturated') {
          const c = lumaRecord.contrast;
          l.fallback = { source: 'contrast', verdict: c.verdict, minContrast: c.minContrast ?? null, face: c.face ?? null };
          console.log(
            `capture-route: [luma] ${section} ${key} SATURATED (face clip ${l.saturation?.faceClipShare ?? 'n/a'}, outside clip ${l.saturation?.outsideClipShare ?? 'n/a'}; unclipped face P99 ${l.saturation?.faceUnclippedP99 ?? 'n/a'} vs outside P995 ${l.saturation?.outsideUnclippedP995 ?? 'n/a'} -> ${l.saturation?.unclippedVerdict ?? 'n/a'}) — falling back to contrast=${c.verdict}`,
          );
          if (c.verdict === 'fail') verdictFailures.push(`${key} #${section}: luma saturated, contrast fallback fail (min ${c.minContrast} on ${c.face})`);
        }
        if (l.exFigures === 'fail') verdictFailures.push(`${key} #${section}: luma outsideP995ExFigures ${l.outsideP995ExFigures} > activeFaceP99 ${l.activeFaceP99}`);
        else if (l.verdict === 'fail') console.log(`capture-route: [luma] ${section} ${key} fails only on figure rects (wave-2 exemption, logged): ${l.topHotspots.filter((h) => h.figures.length).map((h) => h.figures.join('+')).join(', ')}`);
      }
      // LOOK r6 SEAT H5 --contrast-repeat: the same pose presented again, the
      // contrast noise band per face (never judged; the sidecar's contrastNoise).
      let contrastNoise = null;
      if (r6Flags.contrastRepeat && lumaRecord && liveStill) {
        contrastNoise = await runContrastRepeat(page, outPath, section, phasePinArg, lumaRecord);
        console.log(
          `capture-route: [contrast-repeat] ${section} ${key} ${contrastNoise.verdict}${contrastNoise.band ? ` bandMax=${contrastNoise.band.bandMax ?? 'n/a'} faces=${contrastNoise.band.faces.map((f) => `${f.id}:${f.minA ?? '-'}/${f.minB ?? '-'}(band ${f.band ?? '-'})`).join(',')}` : ` (${contrastNoise.reason})`}`,
        );
      }
      if (evidenceArms.audit && liveStill) {
        drawAudit = await readDrawAudit(page);
        await appendDrawLedger({ section: focusId ? `${section} (focus ${focusId})` : section, viewport: key, audit: drawAudit });
        console.log(
          `capture-route: [audit] ${section} ${key} ${drawAudit.verdict === 'measured' ? `calls=${drawAudit.calls} (${drawAudit.callsMin}-${drawAudit.callsMax}) tris=${drawAudit.triangles} programs=${drawAudit.programs}` : `unmeasured (${drawAudit.reason})`} -> DRAW-LEDGER.md`,
        );
      }
      // LOOK r4: a present-but-blank data face fails the still (and so the
      // run, loader-trace runs included) instead of passing presence.
      if (stationContent && liveStill && stationContent.presence && Array.isArray(stationContent.presence.present)) {
        stationContent.faces = await faceBlankCheck(page, section, outPath, stationContent, lumaRecord);
        const blank = stationContent.faces.filter((f) => f.verdict === 'fail');
        console.log(`capture-route: [faces] ${section} ${key} ${stationContent.faces.map((f) => `${f.id}=${f.verdict}${f.signal ? `(edges ${f.signal.edgeSharePct}%)` : ''}${f.renderables ? `[vr ${f.renderables.visibleRenderables ?? '?'} tex ${f.renderables.textured ?? '?'}${f.renderables.texturedHarness !== null && f.renderables.texturedHarness !== undefined ? `/h${f.renderables.texturedHarness}` : ''}]` : ''}`).join(' ') || 'none'}`);
        if (blank.length) {
          stationContent.ok = false;
          stationContent.reasons = [...(stationContent.reasons ?? []), 'data-face-blank'];
          stationContent.faceBlankReasons = blank.flatMap((f) => f.reasons);
          console.error(`capture-route: #${section} ${key} DATA FACE BLANK: ${stationContent.faceBlankReasons.join('; ')}`);
        }
      }
      const evidence = {
        durationMs: Date.now() - runStartedAtMs,
        stationMs: Date.now() - stationStartedAtMs,
        invocation,
      };
      // LOOK r3: the crest LED pin's own record (blocked rotation timers).
      const crestPinRecord = crestPinOn
        ? { mode: 'pinned', delayMs: CREST_HOLD_MS, ...((await page.evaluate(() => (window.__crestPin ? { blocked: window.__crestPin.blocked, sites: window.__crestPin.sites } : { blocked: null, note: '__crestPin missing' })).catch(() => ({ blocked: null, note: 'read failed' })))) }
        : { mode: crestPinRaw === 'on' ? 'inert (CREST_HOLD_S unreadable in LedScreen.tsx)' : 'off' };
      const probe = await writePoseProbe(
        page,
        probePath,
        section,
        tier,
        phasePinRecord,
        evidence,
        presented.renderPath ?? null,
        presented.hud ?? null,
        presentRetries,
        {
          presentRetryReasons,
          // R49 (additive): the one in-page present re-acquire (null = clean first attempt).
          presentGateRetry: presented.presentRetry ?? null,
          kitSettle: presented.kitSettle ?? null,
          assetResidency: presented.assetResidency ?? null,
          materialPatch: presented.materialPatch ?? null,
          // C-109 r1 (additive): the attribution probe records.
          projectInstances: projectScan,
          meshHide: presented.meshHide ?? null,
          ledPin: { ...(ledPinOn ? { mode: 'pinned', nowMs: LED_PIN_NOW_MS } : { mode: 'off' }), crest: crestPinRecord },
          // LOOK r2 SEAT H: the pointer pin record and the still for --diff-against.
          pointerPin,
          pngPath: outPath,
          devOverlay: presented.devOverlay ?? null,
          worldLuma: presented.worldLuma ?? null,
          // Wave 2 round 2 (additive).
          stationCard: stationCardRecord,
          focusOverlays: presented.focusOverlays ?? null,
          hoverArm,
          paramPanel,
          // S9 (additive; stamped only when --occlusion on).
          occlusion: occlusionRecord,
          // Round 1 (additive): reveal gate + station-settle assertion.
          revealGate,
          // Round 3: the settle verdict includes the content check — ok is
          // the camera landing AND the station showing its content;
          // cameraOk keeps the camera-only result.
          stationSettle:
            stationSettle && stationContent
              ? {
                  ...stationSettle,
                  cameraOk: stationSettle.ok,
                  ok: stationSettle.ok === true && stationContent.ok !== false,
                  ...(stationContent.ok === false ? { reason: stationContent.reasons.join('+'), reasons: stationContent.reasons } : {}),
                }
              : stationSettle,
          stationContent,
          particleCorridor,
          // LOOK r6 SEAT H5 (additive, --contrast-repeat only).
          contrastNoise,
          // Wave 2 (2H, additive; evidence runs only).
          w1: anyEvidenceFlag(evidenceArms)
            ? {
                settled: stationSettle?.read ? stationSettle.read.settled ?? 'unmeasured' : 'unmeasured',
                dockedPanel,
                bridges,
                ...(lumaRecord ? { luma: lumaRecord.luma, contrast: lumaRecord.contrast, lumaInputs: lumaRecord.inputs } : {}),
                ...(drawAudit ? { drawAudit } : {}),
              }
            : null,
        },
      );
      // LOOK r4: a still whose prefiltered IBL is black (the load race) is
      // rejected at capture time; its sidecar stays on disk, the run fails.
      if (probe.iblState && probe.iblState.verdict === 'black') {
        iblFailures.push(`${key} #${section}: ${probe.iblState.reason}`);
        console.error(`capture-route: #${section} ${key} STILL REJECTED black IBL (${probe.iblState.reason}) — sidecar ${probePath}`);
      }
      // LOOK r6 SEAT H5: a saturated luma cell judged on the inner-face diff
      // (no contrast tiles) fails the run when a face's copy changed.
      if (probe.saturatedFallback) {
        const fb = probe.saturatedFallback;
        console.log(`capture-route: [luma] ${section} ${key} saturated-cell fallback source=${fb.source} verdict=${fb.verdict}${fb.faces ? ` faces=${fb.faces.map((f) => `${f.id}:inner>8=${f.innerOverPct}%`).join(',')}` : ''}${fb.reason ? ` (${fb.reason})` : ''}`);
        if (fb.source === 'inner-face-diff' && fb.verdict === 'fail') verdictFailures.push(`${key} #${section}: luma saturated, inner-face diff fallback fail (${fb.reasons.join('; ')})`);
      }
      if (stationContent && stationContent.ok === false) {
        // Round 3: the still and its sidecar stay on disk as evidence of the
        // failure; the run exits non-zero.
        stationContentFailures.push(`${key} #${section}: ${stationContent.reasons.join('+')}`);
        console.error(`capture-route: #${section} ${key} STILL FAILED (${stationContent.reasons.join('+')}) — sidecar ${probePath}`);
      }
      if (phasePinOn && (!probe.phasePin || probe.phasePin.mode !== 'pinned')) {
        throw new Error(`phase pin did not record at present time (probe.phasePin=${JSON.stringify(probe.phasePin)})`);
      }
      if (focusId && (!probe.focus || probe.focus.id !== focusId || probe.focus.phase !== 'focused')) {
        throw new Error(`focus "${focusId}" was not held at present time (probe.focus=${JSON.stringify(probe.focus)})`);
      }
      // S9 --frames: the motion trace runs at the landed (and, with --focus,
      // still focused) pose, before the focus release below.
      if (evidenceArms.frames > 0) {
        await runFramesTrace(page, resolve(outDir, `${tag}-${section}${focusSuffix}-${key}`), {
          section,
          viewport: key,
          focus: focusId,
          still: outPath.slice(outDir.length + 1),
        });
      }
      if (hoverArm) {
        // Park the pointer in the top-left gutter so the next station starts unhovered.
        await page.mouse.move(2, 2);
      }
      // Wave 2 round 2 --burst: the arrival at the target, recorded at a real
      // fixed cadence from before the click (last in the station's work).
      if (burstTarget && burstTarget !== section && liveStill && !focusId) {
        await runArrivalBurst(page, resolve(outDir, `${tag}-${section}-to-${burstTarget}-${key}`), {
          from: section,
          target: burstTarget,
          viewport: key,
          durationMs: burstMs,
          intervalMs: burstIntervalFor(burstTarget),
        });
      }
      if (focusId) {
        // Release before the next section so its station hold starts clean.
        await page.evaluate(() => window.__routeWorldFocus?.release());
        await page.waitForTimeout(CAMERA_SETTLE_MS);
      }
      const { size } = await stat(outPath);
      const minBytes = Math.floor(width * height * MIN_CAPTURE_BYTES_PER_PIXEL);
      if (size <= minBytes) {
        throw new Error(`capture ${outPath} is ${size} bytes (<= viewport floor ${minBytes} for ${width}x${height}) — likely a blank/black frame`);
      }
      console.log(
        `capture: OK theme=${theme} data-theme=${applied} ${width}x${height} -> ${outPath} (${size} bytes)`,
      );
    }
    await context.close();
  }
  // LOOK r6 SEAT H7 --warm-cache: a second browser WITHOUT the cold flags,
  // two loads per viewport (primer, then warm), the reveal of each and the
  // shader-source stability between loads and between viewports.
  if (r6Flags.warmCache) await runWarmCacheLeg();
  if (iblFailures.length > 0) {
    console.error(`capture-route: FAIL black-IBL still(s) rejected (${iblFailures.length}): ${iblFailures.join('; ')}`);
    exitCode = 1;
  }
  if (stationContentFailures.length > 0) {
    console.error(`capture-route: FAIL station content check (${stationContentFailures.length}): ${stationContentFailures.join('; ')}`);
    exitCode = 1;
  }
  if (residencyFlags.length > 0) {
    console.log(`capture-route: FLAGGED asset residency (${residencyFlags.length}) — stills emitted with assetResidency.mode "flagged": ${residencyFlags.join('; ')}`);
  }
  if (insufficientSampling.length > 0) {
    console.log(`capture-route: UNMEASURED insufficient-sampling (${insufficientSampling.length}) — re-shoot: ${insufficientSampling.join('; ')}`);
  }
  if (verdictFailures.length > 0) {
    console.error(`capture-route: FAIL verdicts (${verdictFailures.length}): ${verdictFailures.join('; ')}`);
    exitCode = 1;
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (quietPending) {
    try {
      await writeQuietUnmeasured(quietPending.page, quietPending.key, { reason: message, stage: 'harness', requests: quietPending.requests });
    } catch (writeErr) {
      console.error(`capture-route: [quiet] could not write the unmeasured sidecar: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
    }
    quietPending = null;
  }
  console.error(`capture-route: FAIL ${message}`);
  exitCode = 1;
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch (err) {
      console.error(`capture-route: browser.close() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await teardownServer(serverChild);
}

if (bucketGuardFailure !== null && exitCode === 0) {
  console.error(`capture-route: FAIL ${bucketGuardFailure}`);
  exitCode = 1;
}
process.exit(exitCode);
