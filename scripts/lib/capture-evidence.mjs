/**
 * Evidence arms for scripts/capture-route.mjs (fidelity gauntlet, proposal S9
 * / D13): the additive --frames / --occlusion / --sweep / --loader-trace /
 * --reduced-motion flags, plus (gauntlet round 1) --loader-film and the
 * --param k=v page-URL passthrough. Extracted here so capture-route stays a thin
 * orchestrator and the pure parts (flag parsing, sweep plans, strip layout,
 * trace summaries) are unit-tested (scripts/__tests__/capture-evidence.test.mjs).
 *
 * Three kinds of export live here:
 *  - PURE helpers (no browser, no disk): parseEvidenceFlags, sweepPlan,
 *    stripLayout, frameSuffix, mergeLoaderTrace, summarizeFrameTrace,
 *    summarizeSweep, summarizeLoader. Tested.
 *  - IN-PAGE functions (installLoaderRecorder) — serialized by Playwright into
 *    the page, so they must stay self-contained (no closure over module scope).
 *  - RUNNERS that drive a Playwright page (sampleEvidence, readDomLayers,
 *    runSweep, finishLoaderTrace, writeStrip). Exercised only by real captures,
 *    which the lead serializes (one capture at a time on the pinned port).
 *
 * The veto analyzers themselves are the engine's pure evidence-probe.ts,
 * imported lazily (Node's native TypeScript type stripping — the
 * legibility-check.mjs NODE REQUIREMENT applies: Node >= 22.18 / 23.6).
 *
 * Honesty notes carried into every artifact's `notes`:
 *  - frame strips are SAMPLED presents at the requested interval, not video;
 *  - occlusion is a raycast verdict (blind to particles, shader displacement
 *    and post effects);
 *  - the loader recorder reads canvas pixels once per RENDERED frame, right
 *    after the draw (pre-composite); the readback itself costs GPU time, so a
 *    loader trace is its own run, never a timing reference for stills.
 */
import sharp from 'sharp';
import {
  W1_VALUE_FLAGS,
  deadlineAnchorOf,
  overrunFromAnchor,
  productPhaseStamps,
  productWobbleVerdict,
  sanitizeZeroReads,
  settledOf,
} from './w1-evidence.mjs';
import { attemptRecord, isStallKind, productFailure, stallInjectMs, stallPathVerdict, STALL_INJECT_RANGE } from './look-evidence.mjs';

/**
 * The analyzers load lazily: importing a .ts file makes Node print a
 * MODULE_TYPELESS_PACKAGE_JSON warning, and a capture run without evidence
 * flags must stay byte-identical to the pre-S9 harness — stderr included.
 */
let probeModule = null;
function loadProbe() {
  probeModule ??= import('../../src/lib/route-world/evidence-probe.ts');
  return probeModule;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** Value-taking evidence flags (capture-route merges these into VALUE_FLAGS). */
export const EVIDENCE_VALUE_FLAGS = [
  '--frames',
  '--interval',
  '--occlusion',
  '--sweep',
  '--flip-probe',
  '--page-path',
  // Gauntlet round 2 (harness remediation).
  '--relax-deadline',
  '--fail-inject',
  '--chip-jump',
  '--warmup',
  // Gauntlet round 3 (harness remediation).
  '--content-baseline',
  '--strip-crop',
  '--pin-utime',
  // Gauntlet round 4 (harness remediation).
  '--dpr',
  // Wave 2 (seat 2H INF): the W1 luma and draw-audit arms.
  ...W1_VALUE_FLAGS,
];
/** Value-less evidence flags (the --residency-auto idiom: skipped, never VALUE_FLAGS). */
export const EVIDENCE_BARE_FLAGS = ['--loader-trace', '--reduced-motion', '--loader-film', '--handoff-composite', '--panel-edge', '--no-handoff-composite', '--sweep-film'];

/**
 * --relax-deadline <ms>: the DEBUG-ONLY readiness-deadline relaxation
 * (world-readiness.ts `readyDeadlineMs`, honoured only with routeDebug=1 and
 * never in a production build). Same clamp range as the product resolver.
 */
export const RELAX_DEADLINE_RANGE = { minMs: 10_000, maxMs: 45_000 };
/**
 * --fail-inject kinds (W7 failure paths, harness-side — no product switch):
 *  - context-loss:loading  WEBGL_lose_context on the scene's GL context while
 *                          the ball is in `loading`;
 *  - context-loss:opening  the same once the ball reaches `opening`;
 *  - timeout               hold the lazily loaded scene chunk (react-three
 *                          fiber) past the readiness deadline, so the scene
 *                          cannot present in time.
 */
export const FAIL_INJECT_KINDS = ['context-loss:loading', 'context-loss:opening', 'timeout', 'stall-hold'];
/**
 * LOOK r6 SEAT H1: `stall-hold` — a HARNESS-side stall that works on a
 * production build (the product's ?stallInjectMs hook is dev-only): every
 * world-asset request (the manifest, GLBs, textures) is held from navigation
 * until deadline + 8 s, so the load stops progressing from the start. Judged
 * as analysis.stallPath with the injection at the attempt's begin (Lite by
 * max(begin, renderer rise) + 6 s, reason readiness-stall).
 */
export const STALL_HOLD_KIND = 'stall-hold';
/**
 * LOOK r2: `stall:<ms>` — the product's DEBUG-ONLY stall injection
 * (?routeDebug=1&stallInjectMs=<ms>, scene-progress.ts): from <ms> after the
 * attempt began every load signal is ignored, so the stall detector must send
 * the load to Lite at <ms> + 6 s (analysis.stallPath).
 */
export const FAIL_INJECT_STALL = `stall:<${STALL_INJECT_RANGE.minMs}..${STALL_INJECT_RANGE.maxMs}>`;
export const WARMUP_MODES = ['on', 'off', 'auto'];
/**
 * Round 3 --content-baseline: `check` (default) compares each still's station
 * content count with the recorded baseline; `record` also adopts this run's
 * counts as the baseline for every still whose station subject is present
 * (use only on a run a judge accepted); `off` skips the comparison.
 */
export const CONTENT_BASELINE_MODES = ['check', 'record', 'off'];
/** Round 3 --pin-utime <s>: the canonical phase-pin clock (default 0), 0..600 s. */
export const PIN_UTIME_MAX_S = 600;

function valuesOf(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === name && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  return out;
}

export const FRAMES_MAX = 120;
export const INTERVAL_DEFAULT_MS = 1000;
export const INTERVAL_MIN_MS = 100;
export const INTERVAL_MAX_MS = 10_000;
/**
 * Wheel gestures (down / up / jitter / dither) plus the round-2 scripted arms:
 * `jump` (multi-station nav-chip jumps: pulse→schedule, rules→roster) and
 * `panel` (docked-panel edge + cross-blend cycles).
 */
export const SWEEP_MODES = ['down', 'up', 'jitter', 'jump', 'panel', 'dither'];
/** Wheel-gesture sweeps (the ones sweepPlan scripts). */
export const WHEEL_SWEEP_MODES = ['down', 'up', 'jitter'];
/** --page-path: an app path the harness navigates instead of /route-preview (e.g. /leagues/<id>). */
const PAGE_PATH_RE = /^\/[A-Za-z0-9/_-]{0,200}$/;
export const FLIP_OFFSET_MAX_PX = 50_000;
/** W1 still verdict: a focus subject with at least this ray share blocked fails. */
export const W1_OCCLUSION_FAIL = 0.05;
/**
 * Wave 2 round 2 (TEAMS judge): a teams ace statue (`team:<id>`) is a figure,
 * not a data face. Its bar is the formation's 70 % visibility, so it fails at
 * 30 % of its rays blocked. The ledger rail (`ledger:teams`) is data and keeps
 * the W1 face bar.
 */
export const TEAMS_ACE_OCCLUSION_FAIL = 0.3;

/** The occlusion fail line for one subject id (ace statues: the 70 % visibility bar). */
export function occlusionFailFor(id) {
  return typeof id === 'string' && /^team:/.test(id) ? TEAMS_ACE_OCCLUSION_FAIL : W1_OCCLUSION_FAIL;
}
/** W2 trace verdict: a pair colliding in at least this share of samples fails. */
export const W2_PERSIST_FAIL = 0.5;

function valueOf(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : null;
}

/**
 * Parse and validate the evidence flags from argv (process.argv.slice(2)).
 * Returns { flags, errors } — capture-route prints the errors and exits 2
 * (its usage-error convention); nothing here touches process state.
 */
export function parseEvidenceFlags(argv) {
  const errors = [];
  const framesRaw = valueOf(argv, '--frames');
  let frames = 0;
  if (framesRaw !== null) {
    if (!/^\d+$/.test(framesRaw) || Number(framesRaw) < 1 || Number(framesRaw) > FRAMES_MAX) {
      errors.push(`--frames must be an integer 1..${FRAMES_MAX} (got "${framesRaw}")`);
    } else frames = Number(framesRaw);
  }
  const intervalRaw = valueOf(argv, '--interval');
  let intervalMs = INTERVAL_DEFAULT_MS;
  if (intervalRaw !== null) {
    const n = Number(intervalRaw);
    if (!/^\d+$/.test(intervalRaw) || n < INTERVAL_MIN_MS || n > INTERVAL_MAX_MS) {
      errors.push(`--interval must be an integer ${INTERVAL_MIN_MS}..${INTERVAL_MAX_MS} ms (got "${intervalRaw}")`);
    } else intervalMs = n;
    if (framesRaw === null) errors.push('--interval is only valid together with --frames <n>');
  }
  const occlusionRaw = valueOf(argv, '--occlusion');
  if (occlusionRaw !== null && !['on', 'off'].includes(occlusionRaw)) {
    errors.push('--occlusion must be on|off');
  }
  // Wave 2 (2H): --luma on|off, --audit on|off (per-still W1 arms).
  const lumaRaw = valueOf(argv, '--luma');
  if (lumaRaw !== null && !['on', 'off'].includes(lumaRaw)) errors.push('--luma must be on|off');
  const auditRaw = valueOf(argv, '--audit');
  if (auditRaw !== null && !['on', 'off'].includes(auditRaw)) errors.push('--audit must be on|off');
  const sweepRaw = valueOf(argv, '--sweep');
  if (sweepRaw !== null && !SWEEP_MODES.includes(sweepRaw)) {
    errors.push(`--sweep must be ${SWEEP_MODES.join('|')}`);
  }
  let sweep = sweepRaw !== null && SWEEP_MODES.includes(sweepRaw) ? sweepRaw : null;
  // Round 2: --chip-jump <from>,<to> (repeatable) = a jump sweep over those
  // legs; --panel-edge = the panel sweep. Both are spelled-out aliases.
  const chipJumpRaw = valuesOf(argv, '--chip-jump');
  const chipJump = [];
  for (const raw of chipJumpRaw) {
    const [from, to, extra] = raw.split(',');
    if (extra !== undefined || !STATION_IDS.includes(from) || !STATION_IDS.includes(to) || from === to) {
      errors.push(`--chip-jump must be <from>,<to> with two different stations of ${STATION_IDS.join('|')} (got "${raw}")`);
    } else chipJump.push({ from, to });
  }
  const panelEdge = argv.includes('--panel-edge');
  if (chipJumpRaw.length > 0) {
    if (sweep !== null && sweep !== 'jump') errors.push('--chip-jump is a jump sweep; it cannot be combined with another --sweep mode');
    if (panelEdge) errors.push('--chip-jump and --panel-edge are separate runs');
    sweep = 'jump';
  }
  if (panelEdge && chipJumpRaw.length === 0) {
    if (sweep !== null && sweep !== 'panel') errors.push('--panel-edge is the panel sweep; it cannot be combined with another --sweep mode');
    sweep = 'panel';
  }
  if (sweep && frames > 0) errors.push('--sweep replaces the station stills; it cannot be combined with --frames');
  if (sweep && (lumaRaw === 'on' || auditRaw === 'on')) errors.push('--luma / --audit judge station stills; --sweep replaces the stills');
  // Round 5: --sweep-film = a labelled ~12-frame montage of the sweep /
  // --chip-jump / --panel-edge gesture (CDP screencast; adds capture load, so
  // a film run is not a timing reference — shoot it under its own --tag).
  const sweepFilm = argv.includes('--sweep-film');
  if (sweepFilm && sweep === null) errors.push('--sweep-film films a sweep; add --sweep <mode>, --chip-jump or --panel-edge');
  const flipRaw = valueOf(argv, '--flip-probe');
  let flipProbe = null;
  if (flipRaw !== null) {
    if (!/^\d+$/.test(flipRaw) || Number(flipRaw) > FLIP_OFFSET_MAX_PX) {
      errors.push(`--flip-probe must be a scroll offset 0..${FLIP_OFFSET_MAX_PX} px below the first section's top (got "${flipRaw}")`);
    } else flipProbe = Number(flipRaw);
    if (sweep || frames > 0) errors.push('--flip-probe is its own run; it cannot be combined with --sweep or --frames');
  }
  const pagePathRaw = valueOf(argv, '--page-path');
  let pagePath = null;
  if (pagePathRaw !== null) {
    if (!PAGE_PATH_RE.test(pagePathRaw) || pagePathRaw.includes('//') || pagePathRaw.includes('..')) {
      errors.push(`--page-path must be an app path like /leagues/<id> ([A-Za-z0-9/_-], got "${pagePathRaw}")`);
    } else pagePath = pagePathRaw;
  }
  const loaderTrace = argv.includes('--loader-trace');
  const loaderFilm = argv.includes('--loader-film');
  const handoffComposite = argv.includes('--handoff-composite');
  if (handoffComposite && !loaderTrace) errors.push('--handoff-composite is only valid together with --loader-trace');
  // Round 2: debug-only deadline relaxation for NON-W7 visual evidence.
  const relaxRaw = valueOf(argv, '--relax-deadline');
  let relaxDeadlineMs = null;
  if (relaxRaw !== null) {
    const n = Number(relaxRaw);
    if (!/^\d+$/.test(relaxRaw) || n < RELAX_DEADLINE_RANGE.minMs || n > RELAX_DEADLINE_RANGE.maxMs) {
      errors.push(`--relax-deadline must be an integer ${RELAX_DEADLINE_RANGE.minMs}..${RELAX_DEADLINE_RANGE.maxMs} ms (got "${relaxRaw}")`);
    } else relaxDeadlineMs = n;
  }
  const failRaw = valueOf(argv, '--fail-inject');
  let failInject = null;
  if (failRaw !== null) {
    if (isStallKind(failRaw)) {
      if (Number.isNaN(stallInjectMs(failRaw))) errors.push(`--fail-inject ${FAIL_INJECT_STALL}: the stall must start ${STALL_INJECT_RANGE.minMs}..${STALL_INJECT_RANGE.maxMs} ms after the attempt begins (so it fires before the 20 s deadline; got "${failRaw}")`);
      else failInject = failRaw;
    } else if (!FAIL_INJECT_KINDS.includes(failRaw)) errors.push(`--fail-inject must be ${FAIL_INJECT_KINDS.join('|')}|${FAIL_INJECT_STALL} (got "${failRaw}")`);
    else failInject = failRaw;
    if (!loaderTrace) errors.push('--fail-inject is judged by the loader trace; add --loader-trace');
  }
  if (relaxRaw !== null && (loaderTrace || loaderFilm || handoffComposite || failRaw !== null)) {
    // The W7 ceremony is judged against the PRODUCT deadline only.
    errors.push('--relax-deadline is never used for W7 runs (--loader-trace / --loader-film / --handoff-composite / --fail-inject)');
  }
  const warmupRaw = valueOf(argv, '--warmup');
  let warmup = 'auto';
  if (warmupRaw !== null) {
    if (!WARMUP_MODES.includes(warmupRaw)) errors.push(`--warmup must be ${WARMUP_MODES.join('|')} (got "${warmupRaw}")`);
    else warmup = warmupRaw;
  }
  // Round 3: station content baseline mode.
  const baselineRaw = valueOf(argv, '--content-baseline');
  let contentBaseline = 'check';
  if (baselineRaw !== null) {
    if (!CONTENT_BASELINE_MODES.includes(baselineRaw)) errors.push(`--content-baseline must be ${CONTENT_BASELINE_MODES.join('|')} (got "${baselineRaw}")`);
    else contentBaseline = baselineRaw;
  }
  // Round 3: --strip-crop x,y,w,h (CSS px of the frame) adds a cropped strip.
  const cropRaw = valueOf(argv, '--strip-crop');
  let stripCrop = null;
  if (cropRaw !== null) {
    const parts = cropRaw.split(',');
    const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
    if (parts.length !== 4 || nums.some((n) => !Number.isFinite(n)) || nums[2] < 8 || nums[3] < 8) {
      errors.push(`--strip-crop must be x,y,w,h in whole px with w,h >= 8 (got "${cropRaw}")`);
    } else stripCrop = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
    if (framesRaw === null) errors.push('--strip-crop is only valid together with --frames <n>');
  }
  // Round 3: --pin-utime <s> moves the phase pin's canonical clock.
  const pinRaw = valueOf(argv, '--pin-utime');
  let pinUTime = null;
  if (pinRaw !== null) {
    const n = Number(pinRaw);
    if (!/^\d+(\.\d+)?$/.test(pinRaw) || n > PIN_UTIME_MAX_S) errors.push(`--pin-utime must be seconds 0..${PIN_UTIME_MAX_S} (got "${pinRaw}")`);
    else pinUTime = n;
  }
  // Round 4: --dpr <n> = the browser context's deviceScaleFactor (1..3;
  // default unchanged = 1). The 390 real-phone recipe is --dpr 2.
  const dprRaw = valueOf(argv, '--dpr');
  let dpr = null;
  if (dprRaw !== null) {
    const n = Number(dprRaw);
    if (!/^\d(\.\d{1,3})?$/.test(dprRaw) || n < DPR_RANGE.min || n > DPR_RANGE.max) {
      errors.push(`--dpr must be a device pixel ratio ${DPR_RANGE.min}..${DPR_RANGE.max} (got "${dprRaw}")`);
    } else dpr = n;
  }
  // Round 3 (W7 judge: every r2 trace had handoffDensitySource 'none'): a
  // live-bound loader trace records the composited handoff by default;
  // --no-handoff-composite opts out. Fault runs never go live, so they keep
  // it off unless asked. Wave 2 round 2 (W7 judge: the plaza-rm trace read
  // 'unmeasured'): reduced-motion traces arm it too — the reduced-motion
  // ceremony is a static fade whose smoothness only the composite can show.
  const handoffImplied = loaderTrace && !handoffComposite && !argv.includes('--no-handoff-composite') && failRaw === null;
  return {
    flags: {
      frames,
      intervalMs,
      occlusion: occlusionRaw === 'on',
      sweep,
      loaderTrace,
      reducedMotion: argv.includes('--reduced-motion'),
      loaderFilm,
      // Round 2 (additive): real-page path, the Lite→route flip probe and the
      // composited handoff check.
      flipProbe,
      pagePath,
      handoffComposite: handoffComposite || handoffImplied,
      // Round 2 harness remediation (keys present only when given, so older
      // evidence invocations keep their recorded shape).
      ...(relaxDeadlineMs !== null ? { relaxDeadlineMs } : {}),
      ...(failInject !== null ? { failInject } : {}),
      ...(chipJump.length > 0 ? { chipJump } : {}),
      ...(panelEdge ? { panelEdge: true } : {}),
      ...(warmupRaw !== null ? { warmup } : {}),
      // Round 3 (keys present only when they differ from the default).
      ...(handoffImplied ? { handoffCompositeImplied: true } : {}),
      ...(baselineRaw !== null ? { contentBaseline } : {}),
      ...(stripCrop ? { stripCrop } : {}),
      ...(pinUTime !== null ? { pinUTime } : {}),
      // Round 4 (present only when given).
      ...(dpr !== null ? { dpr } : {}),
      // Round 5 (present only when given).
      ...(sweepFilm ? { sweepFilm: true } : {}),
      // Wave 2 / 2H (present only when on).
      ...(lumaRaw === 'on' ? { luma: true } : {}),
      ...(auditRaw === 'on' ? { audit: true } : {}),
    },
    errors,
  };
}

/**
 * POKEMON-CORE A1 --quiet-busy <ms>: the busy leg's hold. R41 widened the top from 60 s to
 * 5 min so one real-time leg covers K6 natural (>= 120 director awake seconds).
 */
export const QUIET_BUSY_RANGE = { minMs: 1000, maxMs: 300_000 };
/** Validate a --quiet-busy value: { ms, error } (error null when valid). */
export function parseQuietBusy(raw) {
  const n = Number(raw);
  if (!/^\d+$/.test(String(raw)) || n < QUIET_BUSY_RANGE.minMs || n > QUIET_BUSY_RANGE.maxMs) {
    return { ms: null, error: `--quiet-busy must be a hold in ms (${QUIET_BUSY_RANGE.minMs}..${QUIET_BUSY_RANGE.maxMs})` };
  }
  return { ms: n, error: null };
}

/** Round 4 --dpr bounds (deviceScaleFactor). */
export const DPR_RANGE = { min: 1, max: 3 };

/**
 * Round 4 (W1 judge: the particle corridor was judged from pixels only):
 * the verdict over `window.__routeWorldParticles()` rows at a presented
 * still. Fails `particle-corridor-open` when any JUDGED corridor does not
 * contain every rendered face corner (`contains: false`); `unmeasured` when
 * the readout is absent (debug off, or a world without the particle
 * discipline); `pass` with zero live corridors is reported as such.
 *
 * Round 5 (W1/W6 judges: clouds roster-390 failed 3/3 on a teams corridor of
 * weight 4.7e-4 — scroll quantization, exact = 1.00047, inside the station
 * settle eps — whose rect was mostly off-screen):
 *  - a corridor is LIVE only at weight >= CORRIDOR_LIVE_MIN (0.01, the station
 *    settle eps); anything above 0 but below it is a `residual`, reported with
 *    its weight and never judged;
 *  - `contains` is JUDGED only at weight >= CORRIDOR_JUDGE_MIN (0.5 — the
 *    corridor owns the frame); live corridors below that are reported as
 *    `unjudged` (partial blends mid-crossing are the sweep's job, not a still's).
 */
export const CORRIDOR_LIVE_MIN = 0.01;
export const CORRIDOR_JUDGE_MIN = 0.5;
export function particleCorridorVerdict(rows, { liveMin = CORRIDOR_LIVE_MIN, judgeMin = CORRIDOR_JUDGE_MIN, bridgesUp = null } = {}) {
  if (!Array.isArray(rows)) {
    // Wave 2 (2H, residual 4): the readout is installed by every particle
    // emitter's useParticleDiscipline. When the other debug bridges ARE up
    // (`bridgesUp` — the page runs ?routeDebug=1 with the route live) and it
    // is still absent, no emitter is mounted in this world at this still
    // (plaza has none): that is `absent`, a fact about the world, not a gap
    // in the evidence. Without that proof it stays `unmeasured`.
    if (bridgesUp === true) {
      return { verdict: 'absent', reason: 'no particle emitter mounted (debug bridges up, window.__routeWorldParticles not installed)', rows: null, open: [] };
    }
    return { verdict: 'unmeasured', reason: 'window.__routeWorldParticles absent (debug off or no particle discipline in this world)', rows: null, open: [] };
  }
  const weighted = rows.filter((r) => r && typeof r.weight === 'number' && r.weight > 0);
  const live = weighted.filter((r) => r.weight >= liveMin);
  const residual = weighted.filter((r) => r.weight < liveMin).map((r) => ({ station: r.station, weight: r.weight }));
  const judged = live.filter((r) => r.weight >= judgeMin);
  const unjudged = live.filter((r) => r.weight < judgeMin).map((r) => ({ station: r.station, weight: r.weight, contains: r.contains ?? null }));
  const open = judged.filter((r) => r.contains === false).map((r) => ({ station: r.station, weight: r.weight, corridorRect: r.corridorRect ?? null, faceRects: r.faceRects ?? null }));
  return {
    verdict: open.length > 0 ? 'fail' : 'pass',
    ...(open.length > 0 ? { reason: 'particle-corridor-open' } : {}),
    thresholds: { liveMin, judgeMin },
    liveCorridors: live.length,
    judgedCorridors: judged.length,
    open,
    residual,
    unjudged,
    rows,
  };
}

/**
 * Round 3 (W7 judge: the reduced-motion Lite floor was unmeasurable because
 * --loader-trace forced ?routeDebug=1, which WorldStateProvider reads as a
 * forced route tier): a reduced-motion loader trace on --tier auto is a
 * Lite-floor run, and it must load WITHOUT the debug param. Its verdict
 * needs only DOM reads (world-route-live, canvas opacity, ball visibility).
 */
export function isLiteFloorRun(flags, tier) {
  return Boolean(flags.reducedMotion && flags.loaderTrace && tier === 'auto');
}

/**
 * Round 2 dev-compile warm-up: before the first measured capture of the run,
 * load the page once in a throwaway context and wait for it to present (or
 * the bound), so the measured navigation is not the one paying for `next dev`
 * compilation. `auto` (the default) = on whenever an evidence arm or the
 * relaxation is on, off for plain stills (their runs stay byte-identical).
 */
export function warmupEnabled(flags) {
  const mode = flags.warmup ?? 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return anyEvidenceFlag(flags);
}

/** True when any evidence arm is on (drives the additive invocation record). */
export function anyEvidenceFlag(flags) {
  return (
    flags.frames > 0 ||
    flags.occlusion ||
    flags.sweep !== null ||
    flags.loaderTrace ||
    flags.reducedMotion ||
    flags.loaderFilm === true ||
    (flags.flipProbe ?? null) !== null ||
    (flags.pagePath ?? null) !== null ||
    (flags.relaxDeadlineMs ?? null) !== null ||
    (flags.failInject ?? null) !== null ||
    // Round 3.
    (flags.pinUTime ?? null) !== null ||
    (flags.contentBaseline ?? null) !== null ||
    // Round 4.
    (flags.dpr ?? null) !== null ||
    // Wave 2 (2H).
    flags.luma === true ||
    flags.audit === true
  );
}

/**
 * The debug-gated bridges need ?routeDebug=1: occlusion / figures / camera for
 * --frames / --occlusion / --sweep, and `__routeWorldReadiness` (the scene
 * phase, the deadline anchor and the Lite-block check) for --loader-trace and
 * --loader-film — without it the loader trace's Lite-block check is inactive
 * and the film cannot stamp a scene phase (gauntlet round 1: implied, not
 * opt-in).
 */
export function evidenceNeedsDebug(flags, { tier = null } = {}) {
  // Round 3: a Lite-floor run (reduced motion + loader trace on --tier auto)
  // must load without ?routeDebug=1 — the param forces the route tier.
  const liteFloor = tier !== null && isLiteFloorRun(flags, tier);
  return (
    flags.frames > 0 ||
    flags.occlusion ||
    flags.sweep !== null ||
    (flags.loaderTrace && !liteFloor) ||
    (flags.loaderFilm === true && !liteFloor) ||
    (flags.flipProbe ?? null) !== null ||
    // Round 2: the product honours readyDeadlineMs only with routeDebug=1.
    (flags.relaxDeadlineMs ?? null) !== null ||
    // Wave 2 (2H): the subject rects / scene handle (luma) and the scene
    // audit + TelemetrySampler (audit) are debug-gated.
    flags.luma === true ||
    flags.audit === true
  );
}

// ---------------------------------------------------------------------------
// --param k=v page-URL passthrough
// ---------------------------------------------------------------------------

/**
 * Page params the harness sets itself from dedicated flags. A --param naming
 * one of them is a usage error, so the effective URL is never ambiguous about
 * which flag won.
 */
export const PARAM_RESERVED_KEYS = [
  'routeDebug',
  'tier',
  'routeQuality',
  'boardPage',
  'ambient',
  'world',
  'fixture',
  // Round 2: set only by --relax-deadline (which also refuses W7 runs).
  'readyDeadlineMs',
  // LOOK r2: set only by --fail-inject stall:<ms>.
  'stallInjectMs',
];
const PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// R40: `@` (beatForce=surfacing@10) and `/` (coreCastFile=surfacer:models/regular/730.glb) are
// allowed: URLSearchParams percent-encodes them and the page's own parser decodes them.
const PARAM_VALUE_RE = /^[A-Za-z0-9._:,+@/-]{1,200}$/;

/**
 * Parse every repeatable `--param k=v` from argv into ordered { key, value }
 * pairs (e.g. `--param waterDebug=ripples`). Returns { params, errors };
 * capture-route prints the errors and exits 2. Values are restricted to a
 * URL-safe token alphabet — the passthrough is for debug switches, not
 * free-form text.
 */
export function parseParamFlags(argv) {
  const params = [];
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--param') continue;
    const raw = argv[i + 1];
    i += 1;
    const eq = typeof raw === 'string' ? raw.indexOf('=') : -1;
    const key = eq > 0 ? raw.slice(0, eq) : '';
    const value = eq > 0 ? raw.slice(eq + 1) : '';
    if (!PARAM_KEY_RE.test(key) || !PARAM_VALUE_RE.test(value)) {
      errors.push(
        `--param must be <key>=<value> (key [A-Za-z][A-Za-z0-9_.-]*, value [A-Za-z0-9._:,+@/-]+; got "${raw ?? ''}")`,
      );
      continue;
    }
    if (PARAM_RESERVED_KEYS.includes(key)) {
      errors.push(`--param ${key} is set by the harness from its own flag; use that flag instead`);
      continue;
    }
    if (params.some((p) => p.key === key)) {
      errors.push(`--param ${key} was given more than once`);
      continue;
    }
    params.push({ key, value });
  }
  return { params, errors };
}

/**
 * Round 5 (W7 judge: loader traces run with ?routeDebug=1, which keeps
 * three's checkShaderErrors on, so hitch magnitudes may overstate
 * production): what a trace says about the shader check. `params` = the
 * parsed --param pairs; `glDebug` = the page's `__routeWorldGlDebug()` read at
 * the trace's end (null when the bridge is absent). `honoured` is null when
 * no `routeShaderCheck` was requested or the state is unreadable, and false
 * when it was requested off but the renderer still checks — the trace then
 * says so instead of passing as a production-like timing.
 */
export function shaderCheckRecord(params, glDebug) {
  const requested = (Array.isArray(params) ? params : []).find((p) => p.key === 'routeShaderCheck')?.value ?? null;
  const checkShaderErrors = glDebug && typeof glDebug.checkShaderErrors === 'boolean' ? glDebug.checkShaderErrors : null;
  let honoured = null;
  if (requested !== null && checkShaderErrors !== null) honoured = requested === '0' ? checkShaderErrors === false : checkShaderErrors === true;
  return {
    requested,
    checkShaderErrors,
    programs: glDebug && typeof glDebug.programs === 'number' ? glDebug.programs : null,
    honoured,
  };
}

// ---------------------------------------------------------------------------
// Reveal gate + station-settle assertion (always on; gauntlet round 1)
// ---------------------------------------------------------------------------

/** Ball phases the reveal gate accepts once the route is live. */
export const REVEAL_BALL_PHASES = ['done', 'hidden'];

/**
 * One reveal-gate read -> verdict. `read` = { live, ballPhase } where
 * ballPhase is the [data-ball-loader] data-ball-phase, or 'absent' when the
 * page mounts no loader (the route-preview probe world). Returns
 *  - 'revealed' — html.world-route-live is set AND the ball is done / hidden /
 *    absent (the ceremony is over; stills may be taken);
 *  - 'lite'     — the ball aborted and the route never went live (the Lite
 *    fallback resolved);
 *  - 'waiting'  — anything else (keep polling until the bound).
 */
export function revealGateState(read) {
  if (!read) return 'waiting';
  const phase = read.ballPhase;
  if (read.live && (phase === 'absent' || REVEAL_BALL_PHASES.includes(phase))) return 'revealed';
  // Round 2: the ball aborted but the route went live anyway (a recovered
  // scene after the ceremony gave up). The world IS on screen, so stills are
  // valid and must be station-asserted — this is not Lite. Flagged to W7 as a
  // product path (abort-then-live) in the gate record.
  if (read.live && phase === 'aborted') return 'revealed-after-abort';
  if (!read.live && phase === 'aborted') return 'lite';
  return 'waiting';
}

/** Gate modes under which the route world is on screen (stills are asserted). */
export const REVEALED_MODES = ['revealed', 'revealed-after-abort'];

/**
 * After the ball aborts, the gate keeps polling until the 10 s readiness
 * deadline (measured from the scene generation's begin when the readiness
 * bridge reports it, else navigation start) plus this margin before it
 * declares Lite — round 1 misread 20+ recovered loads as Lite.
 */
export const REVEAL_AFTER_ABORT_MARGIN_MS = 1500;
export const REVEAL_DEADLINE_MS = 10_000;

/** |smooth - exact| must be below this for a landed station (conductor units). */
export const STATION_SETTLE_EPS = 0.01;

/**
 * Station-settle assertion for one read. `read` = { nearest, smooth, exact,
 * pin?, chipHref } (chipHref = the WorldNav active chip's href, null when none).
 * Returns { ok, reasons[] } with named reasons:
 *  - probe-missing          no pose probe / non-numeric fields
 *  - nearest-mismatch       conductor nearest station !== the requested index
 *  - exact-off-station      |exact - index| >= eps and the conductor is not
 *                           holding the station (pin !== index) — round 2:
 *                           nearest is hysteretic, so nearest===index held at
 *                           exact 2.323 (clouds teams 390, cropped island)
 *  - smooth-exact-gap       |smooth - exact| >= STATION_SETTLE_EPS (still damping)
 *  - nav-chip-mismatch      the active WorldNav chip is not #<section>
 *
 * Wave 2 (2H, plan §2: "fail loudly unless activeIndex === target and the
 * station is settled"), additive — both reads are optional so pages that
 * predate them keep the round-5 contract:
 *  - active-index-mismatch  the conductor's `activeIndex` (probe) is a number
 *                           and is not the requested index
 *  - station-unsettled      the latched `settled` signal (2A useStationSettle,
 *                           read-only here) is published and still false
 * `settledSignal` ('settled' | 'unsettled') is present only when the latch
 * was published; the harness records its absence as 'unmeasured' (never
 * assumed true).
 */
export function stationSettleVerdict(read, { index, section, eps = STATION_SETTLE_EPS }) {
  const reasons = [];
  if (!read || typeof read.nearest !== 'number' || typeof read.smooth !== 'number' || typeof read.exact !== 'number') {
    reasons.push('probe-missing');
  } else {
    if (read.nearest !== index) reasons.push('nearest-mismatch');
    const held = typeof read.pin === 'number' && read.pin === index;
    if (!held && !(Math.abs(read.exact - index) < eps)) reasons.push('exact-off-station');
    if (!(Math.abs(read.smooth - read.exact) < eps)) reasons.push('smooth-exact-gap');
    if (typeof read.activeIndex === 'number' && read.activeIndex !== index) reasons.push('active-index-mismatch');
  }
  if (read?.chipHref !== `#${section}`) reasons.push('nav-chip-mismatch');
  const settled = typeof read?.settled === 'boolean' ? read.settled : null;
  if (settled === false) reasons.push('station-unsettled');
  // Key present only when the page publishes the latch (older records keep their shape).
  return { ok: reasons.length === 0, reasons, ...(settled === null ? {} : { settledSignal: settled ? 'settled' : 'unsettled' }) };
}

/** Re-export for the harness's probe reads (2A's latched flag; null = not published). */
export { settledOf };

// ---------------------------------------------------------------------------
// Loader film (--loader-film): pure helpers
// ---------------------------------------------------------------------------

/** Frames in the -loader-film.png montage (inside the 16..24 contract). */
export const FILM_MONTAGE_FRAMES = 20;
/** Share of the montage spent inside the reveal window (presented -> done). */
export const FILM_REVEAL_SHARE = 0.6;
/** The capture-rate floor the film reports against. */
export const FILM_FPS_FLOOR = 15;
/** Ball phases that end the ceremony (the film stops a short tail later). */
export const FILM_END_PHASES = ['done', 'aborted'];

/**
 * The phase record in force at time `t`: the latest sample at or before it
 * (samples are recorded on change, in time order). Null before the first.
 */
export function phaseAt(samples, t) {
  let found = null;
  for (const sample of samples) {
    if (sample.t > t) break;
    found = sample;
  }
  return found;
}

/**
 * Pick montage frames: `total` target times, `revealShare` of them evenly
 * across the reveal window [revealStart, end] and the rest evenly across
 * [start, revealStart); without a usable reveal window, evenly across the
 * whole film. Each target takes the latest frame at or before it (the frame
 * on screen at that moment). Returns ascending, de-duplicated frame indices.
 */
export function selectFilmFrames(times, { start, end, revealStart = null, total = FILM_MONTAGE_FRAMES, revealShare = FILM_REVEAL_SHARE }) {
  if (times.length === 0) return [];
  const targets = [];
  const spread = (from, to, n, inclusiveEnd) => {
    if (n <= 0) return;
    if (n === 1) {
      targets.push(from);
      return;
    }
    const div = inclusiveEnd ? n - 1 : n;
    for (let k = 0; k < n; k += 1) targets.push(from + ((to - from) * k) / div);
  };
  const reveal =
    typeof revealStart === 'number' && revealStart > start && revealStart < end ? revealStart : null;
  if (reveal !== null) {
    const nReveal = Math.max(2, Math.round(total * revealShare));
    spread(start, reveal, total - nReveal, false);
    spread(reveal, end, nReveal, true);
  } else {
    spread(start, end, total, true);
  }
  const picked = new Set();
  for (const target of targets) {
    let index = 0;
    for (let i = 0; i < times.length; i += 1) {
      if (times[i] <= target) index = i;
      else break;
    }
    picked.add(index);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * Wave 2 round 3 (W7 judge: the mountain 1440 montage jumped from +8787
 * loading to +9804 releasing with no beam frame): make the montage carry at
 * least `min` frames inside the ceremony [openingAt, endedAt], one of them
 * the peak-beam frame (max red-pixel share). Pure: `times` = frame times,
 * `redShares` = per-frame red share (null = not measured). Returns
 * { selected, ceremony: { window, available, picked, peakIndex, peakRedShare, reason } }.
 */
export function ensureCeremonyPicks(selected, times, redShares, { openingAt = null, endedAt = null, min = 3 } = {}) {
  const picked = new Set(selected);
  if (typeof openingAt !== 'number') {
    return { selected: [...picked].sort((a, b) => a - b), ceremony: { window: null, available: 0, picked: 0, peakIndex: null, peakRedShare: null, reason: 'no opening phase sampled' } };
  }
  const end = typeof endedAt === 'number' && endedAt > openingAt ? endedAt : Infinity;
  const inside = [];
  for (let i = 0; i < times.length; i += 1) if (times[i] >= openingAt && times[i] <= end) inside.push(i);
  let peak = null;
  for (const i of inside) {
    const r = redShares?.[i];
    if (typeof r === 'number' && (peak === null || r > redShares[peak])) peak = i;
  }
  if (peak !== null) picked.add(peak);
  const need = () => inside.filter((i) => picked.has(i)).length < Math.min(min, inside.length);
  // Spread the rest evenly across the ceremony frames.
  for (let k = 0; need() && k < min; k += 1) {
    const target = inside[Math.min(inside.length - 1, Math.round(((inside.length - 1) * k) / Math.max(1, min - 1)))];
    picked.add(target);
  }
  for (const i of inside) {
    if (!need()) break;
    picked.add(i);
  }
  const count = inside.filter((i) => picked.has(i)).length;
  return {
    selected: [...picked].sort((a, b) => a - b),
    ceremony: {
      window: { start: openingAt, end: Number.isFinite(end) ? end : null },
      available: inside.length,
      picked: count,
      peakIndex: peak,
      peakRedShare: peak === null ? null : +redShares[peak].toFixed(4),
      reason: inside.length < min ? `only ${inside.length} captured frame(s) between opening and done (< ${min})` : null,
    },
  };
}

/** Round 5 --sweep-film: montage size (a ~12-frame labelled strip). */
export const SWEEP_FILM_FRAMES = 12;

/**
 * Round 5 --sweep-film (W6 judge: crossing smoothness was judged from
 * telemetry only): pick ~`total` film frames across the gesture windows
 * (pure). `times` = film frame times on the page clock, ascending;
 * `windows` = [{ label, from, to }] (a wheel sweep has one; a jump has one per
 * leg; a panel run one per station). Frames are shared out by window
 * duration (at least 2 per window while the budget allows), evenly spaced
 * inside each window, each target taking the last frame at or before it
 * (what was on screen then — a screencast emits only on change, so that
 * frame may predate the window; its label then reads a negative offset).
 * Returns [{ index, window, t }] in time order, de-duplicated.
 */
export function sweepFilmPicks(times, windows, { total = SWEEP_FILM_FRAMES } = {}) {
  const valid = windows.filter((w) => typeof w.from === 'number' && typeof w.to === 'number' && w.to > w.from);
  if (times.length === 0 || valid.length === 0) return [];
  const span = valid.reduce((sum, w) => sum + (w.to - w.from), 0);
  const perWindow = valid.map((w) => Math.max(Math.min(2, Math.floor(total / valid.length)), Math.round((total * (w.to - w.from)) / span)));
  const picks = new Map();
  valid.forEach((w, wi) => {
    const n = Math.max(1, perWindow[wi]);
    for (let k = 0; k < n; k += 1) {
      const target = n === 1 ? w.from : w.from + ((w.to - w.from) * k) / (n - 1);
      let index = -1;
      for (let i = 0; i < times.length; i += 1) {
        if (times[i] <= target) index = i;
        else break;
      }
      // No frame yet at the target (film started late): the first one inside the window.
      if (index === -1) index = times.findIndex((t) => t >= w.from && t <= w.to);
      if (index === -1 || picks.has(index)) continue;
      picks.set(index, { index, window: w.label, t: times[index] });
    }
  });
  return [...picks.values()].sort((a, b) => a.index - b.index);
}

/**
 * The moving part of a gesture window (pure): from its first recorder frame
 * to the last frame whose conductor `smooth` or camera position still
 * changed (above `eps`), plus `tailMs` — so the montage is not spent on the
 * settle tail's rest pose. Null when the frames carry no time.
 */
export function motionWindow(frames, { eps = 1e-3, tailMs = 250 } = {}) {
  const timed = (frames ?? []).filter((f) => f && typeof f.t === 'number');
  if (timed.length === 0) return null;
  const from = timed[0].t;
  const last = timed[timed.length - 1].t;
  let movedAt = from;
  for (let i = 1; i < timed.length; i += 1) {
    const a = timed[i - 1];
    const b = timed[i];
    const ds = typeof a.smooth === 'number' && typeof b.smooth === 'number' ? Math.abs(b.smooth - a.smooth) : 0;
    const dp = Array.isArray(a.camPos) && Array.isArray(b.camPos) ? Math.hypot(b.camPos[0] - a.camPos[0], b.camPos[1] - a.camPos[1], b.camPos[2] - a.camPos[2]) : 0;
    const panelChanged = Boolean(a.panel) !== Boolean(b.panel) || Boolean(a.panel?.closing) !== Boolean(b.panel?.closing);
    if (ds > eps || dp > eps || panelChanged) movedAt = b.t;
  }
  return { from, to: Math.min(last, Math.max(movedAt + tailMs, from + 1)) };
}

/** The telemetry frame closest in time to `t` (pure; frames carry `t`). */
export function nearestTelemetry(frames, t) {
  let best = null;
  for (const f of frames) {
    if (typeof f?.t !== 'number') continue;
    if (best === null || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  }
  return best;
}

/**
 * One montage label (pure): window, ms since the window start, conductor
 * smooth progress and nearest station, plus the panel / skip state when set.
 */
export function sweepFilmLabel(pick, windowFrom, telemetry, stationIds = STATION_IDS) {
  const offset = Math.round(pick.t - windowFrom);
  const parts = [`${pick.window} ${offset < 0 ? '-' : '+'}${Math.abs(offset)}ms`];
  if (telemetry) {
    if (typeof telemetry.smooth === 'number') parts.push(`s=${telemetry.smooth.toFixed(2)}`);
    if (typeof telemetry.nearest === 'number') parts.push(stationIds[telemetry.nearest] ?? `n${telemetry.nearest}`);
    if (telemetry.skip && telemetry.skip.active) parts.push('skip');
    if (telemetry.panel) parts.push(telemetry.panel.closing ? 'panel-closing' : 'panel');
  }
  return parts.join(' ');
}

/**
 * Timing summary for a recorded film: the reveal window (first scene
 * `presented` -> first ball `done`/`aborted`), the achieved capture rate over
 * the whole film and over the reveal window, and the longest gap between
 * captured frames. `frames` are { t } in time order; `samples` the phase
 * records. A screencast only emits a frame when the screen changes, so a
 * static stretch lowers the whole-film rate without any frame being missed —
 * the reveal-window rate (motion throughout) is the one judged against the
 * floor.
 */
export function summarizeFilm(frames, samples, { fpsFloor = FILM_FPS_FLOOR, reducedMotion = false } = {}) {
  const firstWhere = (pred) => samples.find(pred)?.t ?? null;
  const presentedAt = firstWhere((s) => s.scenePhase === 'presented');
  const openingAt = firstWhere((s) => s.ballPhase === 'opening');
  const endedAt = firstWhere((s) => FILM_END_PHASES.includes(s.ballPhase));
  const endPhase = endedAt === null ? null : samples.find((s) => s.t === endedAt)?.ballPhase ?? null;
  const times = frames.map((f) => f.t);
  const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
  let maxGapMs = 0;
  let maxGapAt = null;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] > maxGapMs) {
      maxGapMs = times[i] - times[i - 1];
      maxGapAt = times[i - 1];
    }
  }
  const revealStart = presentedAt ?? openingAt;
  const revealEnd = endedAt;
  // Round 2: a ball that aborted BEFORE the scene presented has no reveal
  // window (round 1 wrote an inverted {start 16088, end 15154} for sakura
  // 1440). It is reported as abortedBeforePresent, never as a window.
  const windowValid = revealStart !== null && revealEnd !== null && revealEnd > revealStart;
  const abortedBeforePresent = endPhase === 'aborted' && endedAt !== null && (revealStart === null || endedAt <= revealStart);
  let revealFps = null;
  let revealFrames = 0;
  if (windowValid) {
    revealFrames = times.filter((t) => t >= revealStart && t <= revealEnd).length;
    revealFps = +((revealFrames * 1000) / (revealEnd - revealStart)).toFixed(1);
  }
  const fps = span > 0 ? +(((times.length - 1) * 1000) / span).toFixed(1) : null;
  return {
    frames: frames.length,
    spanMs: span,
    fps,
    maxGapMs,
    // LOOK r5 (CAR r4: this number was quoted as a main-thread gap): what it is.
    maxGapAt,
    maxGapSource:
      'film capture gap: the longest interval between captured film frames over the WHOLE recording (navigation on). A screencast emits a frame only when the screen changes, so a static screen alone opens it. NOT a main-thread metric (that is -loader.json analysis.mainThreadGaps, from rAF samples) and NOT the compositor cadence (compositor.cadence, reveal window)',
    presentedAt,
    openingAt,
    // Round 2: this film's OWN world-route-live time (a film is a separate
    // navigation from any loader trace — align beam timing to this, never to
    // a trace's routeLiveAt).
    routeLiveAt: firstWhere((s) => s.routeLive === true),
    endedAt,
    endPhase,
    abortedBeforePresent,
    revealWindow: windowValid ? { start: revealStart, end: revealEnd } : null,
    revealFrames,
    revealFps,
    fpsFloor,
    // Wave 2 round 2 (W7 judge): the reduced-motion ceremony is a static
    // opacity crossfade, and the on-change screencast emits few frames for it
    // by design, so the 15 fps floor does not apply there (null + the
    // exemption); its smoothness is judged by the handoff composite, which
    // --loader-trace arms automatically under --reduced-motion.
    fpsFloorMet: reducedMotion ? null : revealFps !== null ? revealFps >= fpsFloor : fps !== null ? fps >= fpsFloor : false,
    ...(reducedMotion ? { fpsFloorExempt: 'reduced-motion: a static opacity fade; judged by the handoff composite, not the film fps' } : {}),
  };
}

/**
 * Wave 2 round 2 (W7 judge: "a screencast gap is ambiguous"): the periodic
 * composited-screenshot cadence per ball phase, the disambiguator for a
 * screencast gap. `rows` = film rows { t, kind, ballPhase }. For each phase:
 * periodic frames, median / max interval between consecutive periodic frames
 * that are both in that phase, and the longest screencast gap in it.
 */
export function cadenceByPhase(rows) {
  const out = {};
  const list = Array.isArray(rows) ? [...rows].sort((a, b) => a.t - b.t) : [];
  const push = (phase, key, value) => {
    const bucket = (out[phase] ??= { periodic: [], screencast: [] });
    bucket[key].push(value);
  };
  let lastPeriodic = null;
  let lastCast = null;
  for (const row of list) {
    const phase = row.ballPhase ?? 'none';
    out[phase] ??= { periodic: [], screencast: [] };
    if (row.kind === 'periodic') {
      if (lastPeriodic && (lastPeriodic.ballPhase ?? 'none') === phase) push(phase, 'periodic', row.t - lastPeriodic.t);
      lastPeriodic = row;
    } else {
      if (lastCast && (lastCast.ballPhase ?? 'none') === phase) push(phase, 'screencast', row.t - lastCast.t);
      lastCast = row;
    }
  }
  const stat = (values) => {
    if (values.length === 0) return { intervals: 0, medianMs: null, maxMs: null };
    const sorted = [...values].sort((a, b) => a - b);
    return { intervals: values.length, medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(1) };
  };
  return Object.fromEntries(
    Object.entries(out).map(([phase, b]) => [phase, { periodic: stat(b.periodic), screencastMaxGapMs: stat(b.screencast).maxMs }]),
  );
}

// ---------------------------------------------------------------------------
// Pure planning helpers
// ---------------------------------------------------------------------------

/** `-f07` style suffix, zero-padded to the frame count's width (min 2). */
/**
 * Round 3 strip label: frame index, harness wall clock since the first frame,
 * and — on a page with the water bridge — the first body's water clock
 * (uTime, seconds), so a strip shows how much water time each frame covers.
 */
export function stripLabel(i, tMs, water = null) {
  const body = Array.isArray(water?.bodies) ? water.bodies[0] : null;
  const uTime = body && typeof body.uTime === 'number' ? ` uT ${body.uTime.toFixed(2)}` : '';
  return `f${String(i).padStart(2, '0')} +${(tMs / 1000).toFixed(1)}s${uTime}`;
}

export function frameSuffix(index, count) {
  const width = Math.max(2, String(Math.max(count - 1, 0)).length);
  return `-f${String(index).padStart(width, '0')}`;
}

/**
 * Scripted wheel gesture for --sweep. `down` / `up` are constant-sign
 * streams; `jitter` is three steps forward, one back (net forward) so the
 * direction latch sees real input reversals. The runner stops early once the
 * target station is reached; `maxSteps` bounds a page that never gets there.
 */
export function sweepPlan(mode, { stepPx = 100, waitMs = 60, maxSteps = 400 } = {}) {
  if (!WHEEL_SWEEP_MODES.includes(mode)) throw new Error(`unknown sweep mode "${mode}"`);
  const steps = [];
  for (let i = 0; i < maxSteps; i += 1) {
    let sign = 1;
    if (mode === 'up') sign = -1;
    else if (mode === 'jitter') sign = i % 4 === 3 ? -1 : 1;
    steps.push({ dy: sign * stepPx, waitMs });
  }
  return steps;
}

/** Start/end station for a sweep over the requested section list (canonical order). */
export function sweepEndpoints(mode, sections, stationIds) {
  const ordered = stationIds.filter((id) => sections.includes(id));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const from = mode === 'up' ? last : first;
  const to = mode === 'up' ? first : last;
  return { from, to, fromIndex: stationIds.indexOf(from), toIndex: stationIds.indexOf(to) };
}

/** Grid layout for the -strip.png montage (all integers, px). */
export function stripLayout({ count, frameW, frameH, thumbW = 320, maxCols = 6, gap = 4, labelH = 18 }) {
  const cols = Math.max(1, Math.min(count, maxCols));
  const rows = Math.max(1, Math.ceil(count / cols));
  const tw = Math.max(1, Math.min(thumbW, frameW));
  const th = Math.max(1, Math.round((frameH * tw) / frameW));
  const cellH = th + labelH;
  const cells = [];
  for (let i = 0; i < count; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const left = gap + c * (tw + gap);
    const top = gap + r * (cellH + gap);
    cells.push({ left, top, labelTop: top + th });
  }
  return {
    cols,
    rows,
    thumbW: tw,
    thumbH: th,
    labelH,
    width: gap + cols * (tw + gap),
    height: gap + rows * (cellH + gap),
    cells,
  };
}

// ---------------------------------------------------------------------------
// Pure trace summaries (the veto numbers written into each artifact)
// ---------------------------------------------------------------------------

function figureRowsOf(sample) {
  const rows = sample?.figures?.rows;
  return Array.isArray(rows) ? rows : [];
}

function occlusionRowsOf(sample) {
  const rows = sample?.occlusion?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * W1 numbers for one occlusion report: every focus subject at/over the fail line.
 *
 * Round 3 (judge: plaza roster/rules "PASS" on subjects that were never
 * drawn): with `station`, only that station's own subjects
 * (STATION_SUBJECT_PATTERNS) are judged, and a subject only counts as
 * measured when rays actually landed on it (`considered` > 0). With
 * `presence` (subjectPresenceVerdict), a station whose subject is missing
 * FAILS with `subject-missing`. Zero measured subjects is `unmeasured` —
 * never a pass.
 */
export function summarizeSubjectOcclusion(report, { station = null, presence = null } = {}) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const focusRows = rows.filter((row) => row.source === 'focus');
  const subjects = station ? focusRows.filter((row) => subjectBelongsTo(row.id, station)) : focusRows;
  const measured = subjects.filter((row) => row.onScreen && (typeof row.considered !== 'number' || row.considered > 0));
  const failing = measured.filter((row) => (row.occludedFraction ?? 0) >= occlusionFailFor(row.id));
  const missing = presence && presence.verdict === 'fail';
  let verdict = measured.length === 0 ? 'unmeasured' : failing.length === 0 ? 'pass' : 'fail';
  if (missing) verdict = 'fail';
  // Teams: every ace's own numbers against the 70 % visibility bar, so a
  // judge reads per-ace visibility without the raw occlusion rows.
  const aces =
    station === 'teams'
      ? subjects
          .filter((row) => /^team:/.test(row.id))
          .map((row) => {
            const occ = typeof row.occludedFraction === 'number' ? row.occludedFraction : null;
            const judged = row.onScreen === true && (typeof row.considered !== 'number' || row.considered > 0) && occ !== null;
            return {
              id: row.id,
              onScreen: row.onScreen === true,
              occludedFraction: occ,
              visibleFraction: occ === null ? null : +(1 - occ).toFixed(3),
              verdict: !judged ? 'unmeasured' : occ >= TEAMS_ACE_OCCLUSION_FAIL ? 'fail' : 'pass',
            };
          })
      : null;
  return {
    ...(station ? { station } : {}),
    subjects: subjects.length,
    onScreen: subjects.filter((row) => row.onScreen).length,
    measured: measured.length,
    failing: failing.map((row) => ({ id: row.id, occludedFraction: row.occludedFraction, threshold: occlusionFailFor(row.id), topOccluders: row.topOccluders })),
    ...(aces ? { aces, aceThreshold: TEAMS_ACE_OCCLUSION_FAIL } : {}),
    verdict,
    ...(missing ? { reason: 'subject-missing', missing: presence.missing } : {}),
    ...(verdict === 'unmeasured' ? { reason: subjects.length === 0 ? 'no subject of this station registered' : 'no ray landed on a subject of this station' } : {}),
    threshold: W1_OCCLUSION_FAIL,
  };
}

// ---------------------------------------------------------------------------
// Round 3: subject presence + station content (W1 / W6 judges)
// ---------------------------------------------------------------------------

/**
 * The focus subjects each station exists to show, by id (all four worlds):
 * pulse = the pulse board; roster = the roster surface (plaza desk-pc,
 * sakura/mountain/clouds roster:*); teams = the ace statues (team:<id>, kind
 * ace; wave 2 renamed them from ace:*) plus the Roll-Call Ledger rail
 * (ledger:teams, kind ledger); schedule = the schedule board; rules = the
 * rules surface (plaza plaque:*, the other worlds' rules:*).
 */
export const STATION_SUBJECT_PATTERNS = {
  pulse: [/^board:pulse$/],
  roster: [/^roster:/, /^desk-pc$/],
  teams: [/^team:/, /^ledger:teams$/],
  schedule: [/^board:schedule$/],
  rules: [/^rules:/, /^plaque:/],
};

export function subjectBelongsTo(id, station) {
  const patterns = STATION_SUBJECT_PATTERNS[station];
  return Boolean(patterns && typeof id === 'string' && patterns.some((re) => re.test(id)));
}

/**
 * Subject presence at a landed station. `report` = __routeWorldSubjects()
 * ({ rows: [{ id, present, reasons, visibleRenderables, onScreenFraction,
 * ancestorsVisible, ... }] }). Passes when at least one of the station's
 * subjects is present (registered, proxy ancestors visible, visible content,
 * on screen with a non-zero projected area). Fails `subject-missing` when the
 * station has no registered subject or none is present; `unmeasured` when the
 * bridge is absent. `missing` lists every station subject that is not present
 * (with its reasons) — at teams some aces may be legitimately off-frame, so
 * `presentShare` is reported, not judged.
 */
export function subjectPresenceVerdict(report, station) {
  if (!STATION_SUBJECT_PATTERNS[station]) return { station, verdict: 'unmeasured', reason: `no subject patterns for station "${station}"` };
  if (!report || report.error || !Array.isArray(report.rows)) {
    return { station, verdict: 'unmeasured', reason: report?.error ? `subjects-bridge-threw: ${report.error}` : 'missing __routeWorldSubjects bridge (needs ?routeDebug=1 and EvidenceBridges)' };
  }
  const own = report.rows.filter((row) => subjectBelongsTo(row.id, station));
  const present = own.filter((row) => row.present === true);
  const missing = own
    .filter((row) => row.present !== true)
    .map((row) => ({ id: row.id, reasons: Array.isArray(row.reasons) ? row.reasons : [], visibleRenderables: row.visibleRenderables ?? null, onScreenFraction: row.onScreenFraction ?? null }));
  const reasons = [];
  if (own.length === 0) reasons.push(`no ${station} subject registered (${STATION_SUBJECT_PATTERNS[station].map(String).join(' | ')})`);
  else if (present.length === 0) reasons.push(`none of ${own.length} ${station} subject(s) present: ${missing.map((m) => `${m.id}[${m.reasons.join('+')}]`).join(', ')}`);
  return {
    station,
    verdict: reasons.length > 0 ? 'fail' : 'pass',
    ...(reasons.length > 0 ? { reason: 'subject-missing' } : {}),
    reasons,
    registered: own.length,
    present: present.map((row) => ({ id: row.id, visibleRenderables: row.visibleRenderables, textured: row.textured ?? null, onScreenFraction: row.onScreenFraction, rectArea: row.rectArea ?? null, contentSource: row.contentSource ?? null })),
    presentShare: own.length > 0 ? +(present.length / own.length).toFixed(3) : null,
    missing,
  };
}

/** Station content below this share of its baseline fails (`station-content-missing`). */
export const STATION_CONTENT_MIN_SHARE = 0.8;

/**
 * Baseline key: one entry per world / theme / station / viewport. LOOK r6
 * (H2): with `dpr` and / or `rung`, the key gains `|d<dpr>` / `|q<rung>`
 * (content counts differ per rung, and the 390 real-phone recipe runs at
 * dpr 2); look-r6-evidence.mjs contentBaselineChain lists the fallbacks.
 */
export function contentBaselineKey({ world, theme, station, viewport, dpr = null, rung = null }) {
  const n = Number(dpr);
  const d = dpr !== null && dpr !== undefined && Number.isFinite(n) && n > 0 ? `|d${+n.toFixed(3)}` : '';
  const q = Number.isInteger(rung) ? `|q${rung}` : '';
  return `${world ?? 'plaza'}|${theme ?? 'light'}|${station}|${viewport}${d}${q}`;
}

/**
 * Station content count against its baseline. `content` =
 * __routeWorldContent() ({ renderables, instances }); `baseline` = the
 * recorded entry ({ renderables, instances, ... }) or null. Fails
 * `station-content-missing` when either count falls below `minShare` of the
 * baseline; `unmeasured` without a bridge read or without a baseline (the
 * count is still recorded so a baseline can be adopted from an accepted run).
 */
export function stationContentVerdict(content, baseline, { minShare = STATION_CONTENT_MIN_SHARE } = {}) {
  if (!content || content.error || typeof content.renderables !== 'number') {
    return { verdict: 'unmeasured', reason: content?.error ? `content-bridge-threw: ${content.error}` : 'missing __routeWorldContent bridge' };
  }
  const counts = { renderables: content.renderables, instances: content.instances ?? null };
  if (!baseline || typeof baseline.renderables !== 'number') {
    return { verdict: 'unmeasured', reason: 'no baseline for this world/theme/station/viewport', ...counts, minShare };
  }
  const share = baseline.renderables > 0 ? content.renderables / baseline.renderables : 1;
  const instanceShare =
    typeof baseline.instances === 'number' && baseline.instances > 0 && typeof content.instances === 'number'
      ? content.instances / baseline.instances
      : null;
  const low = share < minShare || (instanceShare !== null && instanceShare < minShare);
  return {
    verdict: low ? 'fail' : 'pass',
    ...(low ? { reason: 'station-content-missing' } : {}),
    ...counts,
    baseline: { renderables: baseline.renderables, instances: baseline.instances ?? null, from: baseline.from ?? null },
    share: +share.toFixed(3),
    instanceShare: instanceShare === null ? null : +instanceShare.toFixed(3),
    minShare,
  };
}

/**
 * The --frames trace analysis: W2 phase-collision persistence, W4 occluded
 * share over the window, W1 subject occlusion over time. Rows from the
 * scene-scan fallback carry no clip/phase, so W2 is `unmeasured` there — never
 * a silent pass.
 */
export async function summarizeFrameTrace(samples, { windowMs = 30_000, station = null } = {}) {
  const { occludedShare, phaseCollisionShare, phaseCollisions } = await loadProbe();
  const figureSource = samples.map((s) => s?.figures?.source ?? 'none').find((s) => s !== 'none') ?? 'none';
  const snapshots = samples.map((sample) =>
    figureRowsOf(sample).map((row) => ({
      id: row.id,
      clip: row.clip ?? null,
      phase01: row.phase01 ?? null,
      visible: Boolean(row.visible),
      timeScale: row.timeScale ?? null,
      model: row.model ?? null,
      // POKEMON-CORE A1: the registry row's clipKey (file|clip) when published.
      clipKey: row.clipKey ?? null,
    })),
  );
  const pairs = phaseCollisionShare(snapshots);
  const perSample = snapshots.map((rows) => phaseCollisions(rows).length);
  // POKEMON-CORE A1 (R7): the de-sync bar reads ONLY same-clipKey pairs; the
  // unfiltered perSample / w2Fail above count cross-model pairs (a drift check).
  const perSampleSameClipKey = snapshots.map((rows) => phaseCollisions(rows, { sameClipKeyOnly: true }).length);
  const pairsSameClipKey = pairs.filter((pair) => pair.sameClipKey === true || pair.sameModel === true);
  const phased = snapshots.some((rows) => rows.some((row) => row.clip !== null && row.phase01 !== null));
  const w2Fail = pairs.filter((pair) => pair.share >= W2_PERSIST_FAIL);

  const figureTimeline = samples.map((sample) => ({
    t: sample.t,
    rows: occlusionRowsOf(sample)
      .filter((row) => row.source === 'figure')
      .map((row) => ({ id: row.id, occludedFraction: row.occludedFraction, onScreen: Boolean(row.onScreen) })),
  }));
  const w4 = occludedShare(figureTimeline, { windowMs });
  const w4Measured = figureTimeline.some((sample) => sample.rows.length > 0);

  const subjectMax = new Map();
  for (const sample of samples) {
    for (const row of occlusionRowsOf(sample)) {
      if (row.source !== 'focus' || row.occludedFraction === null || row.occludedFraction === undefined) continue;
      // Round 3: with a station, only its own subjects are judged.
      if (station && !subjectBelongsTo(row.id, station)) continue;
      subjectMax.set(row.id, Math.max(subjectMax.get(row.id) ?? 0, row.occludedFraction));
    }
  }
  const w1Failing = [...subjectMax.entries()]
    .filter(([, max]) => max >= W1_OCCLUSION_FAIL)
    .map(([id, maxOccludedFraction]) => ({ id, maxOccludedFraction }));

  return {
    // POKEMON-CORE A1 (R7): same-clipKey phase collisions — the A1.1 verdict input.
    w2SameClipKey: {
      perSample: perSampleSameClipKey,
      maxPerSample: perSampleSameClipKey.length ? Math.max(...perSampleSameClipKey) : 0,
      pairs: pairsSameClipKey,
    },
    samples: samples.length,
    figureSource,
    w2: {
      verdict: !phased ? 'unmeasured' : w2Fail.length > 0 ? 'fail' : 'pass',
      threshold: W2_PERSIST_FAIL,
      pairs,
      collisionsPerSample: perSample,
    },
    w4: { verdict: !w4Measured ? 'unmeasured' : w4.vetoes.length > 0 ? 'fail' : 'pass', ...w4 },
    w1: {
      verdict: subjectMax.size === 0 ? 'unmeasured' : w1Failing.length > 0 ? 'fail' : 'pass',
      threshold: W1_OCCLUSION_FAIL,
      failing: w1Failing,
    },
  };
}

/** Map one recorded sweep frame onto the W6 analyzer's sample shape. */
export function toDirectionSample(frame) {
  const progress = typeof frame.smooth === 'number' ? frame.smooth : null;
  const yaw = typeof frame.yaw === 'number' ? frame.yaw : null;
  const sign = frame.inputSign === 1 || frame.inputSign === -1 ? frame.inputSign : 0;
  return { t: frame.t, inputSign: sign, progress, yaw };
}

export async function summarizeSweep(frames, options = {}) {
  const { directionFlips } = await loadProbe();
  const { routeTier = true, frameGapLimitMs = FRAME_GAP_LIMIT_MS, render = null, longTasks = null, stationY = null, ...flipOptions } = options;
  const report = directionFlips(frames.map(toDirectionSample), flipOptions);
  const yawReadable = frames.some((frame) => typeof frame.yaw === 'number');
  // Round 2 (additive): crossing height + consumer hysteresis + frame gaps.
  // Round 3: station-pose / interpolated endpoints, gap attribution, and the
  // per-render yaw rate.
  const heights = crossingHeights(frames, { ...flipOptions, stationY });
  const consumers = consumerChanges(frames);
  const gaps = attributeFrameGaps(frameGaps(frames), { longTasks, render });
  const yawRate = peakYawRate(frames, { render });
  const reasons = [...report.reasons];
  if (heights.verdict === 'fail') reasons.push(...heights.reasons);
  if (yawRate.rendered.verdict === 'fail') {
    reasons.push(`rendered turn rate ${yawRate.rendered.peakDegS} deg/s > ${yawRate.rendered.ceilingDegS} deg/s (limiter ${yawRate.rendered.limitDegS})`);
  }
  // Round 2 (lead): a rAF gap above the limit on the route tier is a visible
  // hitch mid-gesture — it fails the sweep, whatever its cause (a recurring
  // gap at the same progress points at the page, not capture load).
  const gapVerdict = !routeTier ? 'not-judged' : gaps.maxGapMs > frameGapLimitMs ? 'fail' : 'pass';
  if (gapVerdict === 'fail') {
    const worst = gaps.gaps.reduce((w, g) => (w === null || g.gapMs > w.gapMs ? g : w), null);
    reasons.push(`max frame gap ${gaps.maxGapMs} ms > ${frameGapLimitMs} ms (at smooth ${worst?.smooth?.toFixed?.(3) ?? 'n/a'})`);
  }
  return {
    ...report,
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    yawReadable,
    heights,
    consumers,
    frameGaps: gaps,
    maxFrameGapMs: gaps.maxGapMs,
    frameGapLimitMs,
    frameGapVerdict: gapVerdict,
    peakYawRateDegS: yawRate.measured.peakDegS,
    // Round 3: the per-render rate beside the rAF-sampled one.
    renderedYawRateDegS: yawRate.rendered.peakDegS ?? null,
    yawRate,
  };
}

/** Round 2 (lead): a rAF gap above this on the route tier fails a sweep (ms). */
export const FRAME_GAP_LIMIT_MS = 250;

/**
 * Peak heading rate over a trace, in °/s: |Δyaw| / Δt between consecutive
 * frames (unwrapped), for the measured camera yaw and the rig's pathYaw.
 * Frames closer than `minDtMs` are merged forward (a duplicate rAF stamp
 * would divide by ~0). Informational — the W6 turn limiter caps the
 * rendered rate at 200 °/s, so a measured peak far above it is a snap.
 */
export function peakYawRate(frames, { minDtMs = 8, render = null } = {}) {
  const series = (key) => {
    const ts = [];
    const ys = [];
    for (const f of frames) {
      if (typeof f[key] === 'number' && Number.isFinite(f[key]) && typeof f.t === 'number') {
        ts.push(f.t);
        ys.push(f[key]);
      }
    }
    const unwrapped = unwrapYaw(ys);
    let peak = 0;
    let at = null;
    let i0 = 0;
    for (let i = 1; i < ts.length; i += 1) {
      const dt = ts[i] - ts[i0];
      if (dt < minDtMs) continue;
      const rate = (Math.abs(unwrapped[i] - unwrapped[i0]) * 180) / Math.PI / (dt / 1000);
      if (rate > peak) {
        peak = rate;
        at = { t: ts[i], dtMs: +dt.toFixed(1) };
      }
      i0 = i;
    }
    return { readable: ts.length >= 2, peakDegS: ts.length >= 2 ? +peak.toFixed(1) : null, at };
  };
  // Round 3: the rig's own per-frame turn (lastTurnDeltaRad / lastDt) when the
  // probe publishes it — read at rAF, so a frame the recorder skipped is lost,
  // but every value it did read is exact.
  let rigPeak = null;
  let rigAt = null;
  for (const f of frames) {
    if (typeof f.lastTurnDeltaRad !== 'number' || typeof f.lastDt !== 'number' || !(f.lastDt > 0)) continue;
    const rate = (f.lastTurnDeltaRad * 180) / Math.PI / f.lastDt;
    if (rigPeak === null || rate > rigPeak) {
      rigPeak = rate;
      rigAt = { t: f.t, dtMs: +(f.lastDt * 1000).toFixed(1) };
    }
  }
  return {
    measured: series('yaw'),
    path: series('pathYaw'),
    rendered: renderedYawRate(render),
    rig: { readable: rigPeak !== null, peakDegS: rigPeak === null ? null : +rigPeak.toFixed(1), at: rigAt, limitDegS: TURN_RATE_LIMIT_DEG_S },
  };
}

/** The CameraRig turn limiter's ceiling (CameraRig.tsx MAX_TURN_RATE), °/s. */
export const TURN_RATE_LIMIT_DEG_S = 200;
/** Slack on the rendered-rate verdict: float noise + the ≤ 1 frame the limiter snaps on a settle token. */
export const TURN_RATE_TOLERANCE = 0.05;

/**
 * Round 3 (W6 yaw proof): the turn rate of what was DRAWN. `render` = the
 * `__routeWorldRenderLog` dump ({ samples: [{ t, frame, clockDtMs, yaw,
 * pitch, angleFromPrevRad }], dropped, installed }) — one sample per R3F
 * frame, stamped inside the gl.render wrapper for the main camera.
 *  - byClock: full orientation change between CONSECUTIVE frames / that
 *    frame's own R3F delta — exactly the quantity the rig's limiter bounds
 *    (rotateTowards(rate × dt)); the verdict reads this.
 *  - headingByClock: the same with the heading alone.
 *  - headingByWall: heading change / wall time between draws (what a
 *    viewer's display sees; includes any skipped frame).
 * Pairs whose frame ids are not consecutive are left out of the by-clock
 * series (the intermediate deltas are unknown) and counted.
 */
export function renderedYawRate(render, { limitDegS = TURN_RATE_LIMIT_DEG_S, tolerance = TURN_RATE_TOLERANCE, minDtMs = 4 } = {}) {
  const samples = Array.isArray(render?.samples) ? render.samples.filter((s) => typeof s.t === 'number' && typeof s.yaw === 'number') : [];
  if (samples.length < 2) {
    return {
      readable: false,
      verdict: 'unmeasured',
      reason: !render ? 'no render log (page predates __routeWorldRenderLog or the debug bridges are off)' : 'fewer than 2 rendered frames',
      samples: samples.length,
      limitDegS,
    };
  }
  const yaws = unwrapYaw(samples.map((s) => s.yaw));
  let byClock = null;
  let byClockAt = null;
  let headingByClock = null;
  let headingByWall = null;
  let headingByWallAt = null;
  let nonConsecutive = 0;
  const wallDts = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const dYawDeg = (Math.abs(yaws[i] - yaws[i - 1]) * 180) / Math.PI;
    const wall = b.t - a.t;
    wallDts.push(wall);
    if (wall >= minDtMs) {
      const rate = dYawDeg / (wall / 1000);
      if (headingByWall === null || rate > headingByWall) {
        headingByWall = rate;
        headingByWallAt = { t: b.t, wallDtMs: +wall.toFixed(1) };
      }
    }
    if (b.frame !== a.frame + 1) {
      nonConsecutive += 1;
      continue;
    }
    if (typeof b.clockDtMs !== 'number' || b.clockDtMs < minDtMs) continue;
    const dtS = b.clockDtMs / 1000;
    if (typeof b.angleFromPrevRad === 'number') {
      const rate = (b.angleFromPrevRad * 180) / Math.PI / dtS;
      if (byClock === null || rate > byClock) {
        byClock = rate;
        byClockAt = { t: b.t, frame: b.frame, clockDtMs: +b.clockDtMs.toFixed(2), wallDtMs: +wall.toFixed(1) };
      }
    }
    const hRate = dYawDeg / dtS;
    if (headingByClock === null || hRate > headingByClock) headingByClock = hRate;
  }
  const sorted = [...wallDts].sort((x, y) => x - y);
  const ceiling = limitDegS * (1 + tolerance);
  const verdict = byClock === null ? 'unmeasured' : byClock > ceiling ? 'fail' : 'pass';
  return {
    readable: true,
    verdict,
    limitDegS,
    ceilingDegS: +ceiling.toFixed(1),
    peakDegS: byClock === null ? null : +byClock.toFixed(1),
    at: byClockAt,
    headingByClockPeakDegS: headingByClock === null ? null : +headingByClock.toFixed(1),
    headingByWallPeakDegS: headingByWall === null ? null : +headingByWall.toFixed(1),
    headingByWallAt,
    samples: samples.length,
    dropped: render?.dropped ?? 0,
    nonConsecutivePairs: nonConsecutive,
    medianDrawIntervalMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    maxDrawIntervalMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
  };
}

// ---------------------------------------------------------------------------
// Round 2 pure W6 analyzers (crossing height, consumers, jump, panel, dither)
// ---------------------------------------------------------------------------

/** Station ids in conductor order (labels for crossing reports). */
export const STATION_IDS = ['pulse', 'roster', 'teams', 'schedule', 'rules'];
/** W6 round 2: a mid-crossing camera rise above both endpoints beyond this fails (m). */
export const HEIGHT_EXCURSION_MAX_M = 0.35;
/** A frame this close to an integer counts as sitting AT that station. */
const AT_STATION_EPS = 0.01;

function camY(frame) {
  const pos = frame?.camPos;
  return Array.isArray(pos) && typeof pos[1] === 'number' && Number.isFinite(pos[1]) ? pos[1] : null;
}

/**
 * Per-crossing camera height excursion over a sweep trace: for every crossing
 * k → k+1 the trace passes through, the maximum camera y over frames with
 * smooth strictly inside (k, k+1), minus the higher of the two endpoint
 * heights. Round 3 (judge: a missing endpoint compared against the other one
 * alone reported false rises): each endpoint height comes from, in order,
 *  1. frames sitting AT the station (|smooth − k| < 0.01) — `sample`;
 *  2. `stationY[k]`, the camera y read from the rig at a station settle —
 *     `station-pose`;
 *  3. linear interpolation between the nearest frames on either side of k,
 *     when they are at most `interpSpan` apart in progress — `interpolated`;
 * and a crossing with EITHER endpoint still unknown is `unmeasured` (never
 * judged against one side). Frames inside a skip-through (`skip.active` with
 * influence > 0.01) are not on the authored path and are left out. Fail when
 * any excursion exceeds `heightMaxM`. The roster → teams crossing (k = 1) is
 * reported on its own as `rosterTeams`.
 */
export const HEIGHT_INTERP_SPAN = 0.2;

function onPath(frame) {
  const skip = frame?.skip;
  return !(skip && skip.active === true && typeof skip.influence === 'number' && skip.influence > 0.01);
}

export function crossingHeights(frames, { heightMaxM = HEIGHT_EXCURSION_MAX_M, stations = STATION_IDS, stationY = null, interpSpan = HEIGHT_INTERP_SPAN } = {}) {
  const usable = frames.filter((f) => typeof f.smooth === 'number' && camY(f) !== null && onPath(f));
  if (usable.length === 0) {
    return { verdict: 'unmeasured', limitM: heightMaxM, crossings: [], rosterTeams: null, reasons: ['no on-path frame carried camPos'] };
  }
  const endpointY = new Map();
  for (const f of usable) {
    const k = Math.round(f.smooth);
    if (Math.abs(f.smooth - k) < AT_STATION_EPS) {
      const y = camY(f);
      endpointY.set(k, endpointY.has(k) ? Math.max(endpointY.get(k), y) : y);
    }
  }
  const endpoint = (k) => {
    if (endpointY.has(k)) return { y: endpointY.get(k), source: 'sample' };
    const pose = stationY && typeof stationY[k] === 'number' && Number.isFinite(stationY[k]) ? stationY[k] : null;
    if (pose !== null) return { y: pose, source: 'station-pose' };
    let below = null;
    let above = null;
    for (const f of usable) {
      if (f.smooth < k && (below === null || f.smooth > below.smooth)) below = f;
      if (f.smooth > k && (above === null || f.smooth < above.smooth)) above = f;
    }
    if (below && above && above.smooth - below.smooth <= interpSpan) {
      const w = (k - below.smooth) / (above.smooth - below.smooth);
      return { y: camY(below) + (camY(above) - camY(below)) * w, source: 'interpolated', span: +(above.smooth - below.smooth).toFixed(4) };
    }
    return { y: null, source: 'missing' };
  };
  const lo = Math.floor(Math.min(...usable.map((f) => f.smooth)));
  const hi = Math.ceil(Math.max(...usable.map((f) => f.smooth)));
  const crossings = [];
  for (let k = lo; k < hi; k += 1) {
    const inside = usable.filter((f) => f.smooth > k + AT_STATION_EPS && f.smooth < k + 1 - AT_STATION_EPS);
    if (inside.length === 0) continue;
    const endA = endpoint(k);
    const endB = endpoint(k + 1);
    const ends = [endA.y, endB.y];
    const known = endA.y !== null && endB.y !== null ? ends : [];
    let maxY = -Infinity;
    let maxAt = null;
    for (const f of inside) {
      const y = camY(f);
      if (y > maxY) {
        maxY = y;
        maxAt = { t: f.t, smooth: f.smooth };
      }
    }
    const excursion = known.length > 0 ? maxY - Math.max(...known) : null;
    crossings.push({
      from: stations[k] ?? String(k),
      to: stations[k + 1] ?? String(k + 1),
      k,
      frames: inside.length,
      endpointY: ends,
      endpointSource: [endA.source, endB.source],
      maxY,
      maxAt,
      excursionM: excursion === null ? null : +excursion.toFixed(4),
      verdict: excursion === null ? 'unmeasured' : excursion > heightMaxM ? 'fail' : 'pass',
      ...(excursion === null ? { unmeasuredReason: `endpoint height unknown at ${[endA.y === null ? stations[k] ?? k : null, endB.y === null ? stations[k + 1] ?? k + 1 : null].filter((v) => v !== null).join(' and ')}` } : {}),
    });
  }
  const failing = crossings.filter((c) => c.verdict === 'fail');
  const measured = crossings.filter((c) => c.verdict !== 'unmeasured');
  const reasons = failing.map((c) => `${c.from}->${c.to} camera rose ${c.excursionM} m above its endpoints (limit ${heightMaxM} m)`);
  return {
    verdict: measured.length === 0 ? 'unmeasured' : failing.length > 0 ? 'fail' : 'pass',
    limitM: heightMaxM,
    crossings,
    rosterTeams: crossings.find((c) => c.k === 1) ?? null,
    reasons,
  };
}

/**
 * Round 3: the height excursion of a whole nav-chip jump leg. A skip-through
 * blends start → target in pose space, so the per-crossing check (which
 * needs the authored path) does not apply; instead the camera may not rise
 * more than `heightMaxM` above the higher of its first and last frame (the
 * settled start and landing).
 */
export function legHeightExcursion(frames, { heightMaxM = HEIGHT_EXCURSION_MAX_M } = {}) {
  const ys = frames.map(camY).filter((y) => y !== null);
  if (ys.length < 2) return { verdict: 'unmeasured', limitM: heightMaxM, reason: 'fewer than 2 frames with camPos' };
  const start = ys[0];
  const end = ys[ys.length - 1];
  const maxY = Math.max(...ys);
  const excursion = maxY - Math.max(start, end);
  return {
    verdict: excursion > heightMaxM ? 'fail' : 'pass',
    limitM: heightMaxM,
    startY: start,
    endY: end,
    maxY,
    excursionM: +excursion.toFixed(4),
  };
}

/**
 * Round 3 (judge: a 650 ms gap from one run on a shared GPU box cannot tell
 * capture load from a product stall): attribute each rAF gap with what the
 * page itself reported inside it —
 *  - `longTaskMs`: main-thread long tasks (PerformanceObserver 'longtask')
 *    overlapping the gap;
 *  - `drawsInGap`: main-camera draws the render log stamped strictly inside
 *    the gap (> 0 means the page kept rendering and only the recorder's rAF
 *    was starved).
 * attribution: `page-long-task` (long tasks cover ≥ 50 % of the gap — script
 * or compile work on the page's own thread), `recorder-only` (the page kept
 * presenting: ≥ RECORDER_ONLY_MIN_DRAWS draws inside the gap), else — with the
 * render log readable — `page-gpu-or-compositor` (≤ 1 draw and no long task:
 * the page itself did not present, so the freeze is visible to the user;
 * round 4 judge: a single draw inside a 333 ms gap is still a 333 ms freeze),
 * else `no-page-long-task` (no render log; nothing on the page's main thread
 * explains it). `countsAgainstProduct` is true for every attribution except
 * `recorder-only`, and `productMaxGapMs` is the largest such gap. A hint for
 * the judge, not proof — one run cannot separate a GPU stall caused by the
 * page from one caused by the capture.
 */
/** Round 4: draws inside a gap needed to call it recorder-only (the page kept presenting). */
export const RECORDER_ONLY_MIN_DRAWS = 2;

export function attributeFrameGaps(report, { longTasks = null, render = null } = {}) {
  const tasks = Array.isArray(longTasks) ? longTasks.filter((l) => typeof l.start === 'number' && typeof l.duration === 'number') : null;
  const draws = Array.isArray(render?.samples) ? render.samples.map((s) => s.t).filter((t) => typeof t === 'number') : null;
  const gaps = report.gaps.map((gap) => {
    const from = gap.t - gap.gapMs;
    const to = gap.t;
    const longTaskMs = tasks
      ? +tasks.reduce((sum, l) => sum + Math.max(0, Math.min(to, l.start + l.duration) - Math.max(from, l.start)), 0).toFixed(1)
      : null;
    const drawsInGap = draws ? draws.filter((t) => t > from + 1 && t < to - 1).length : null;
    // Wave-2 r3: the heaviest LoAF scripts of the long tasks inside the gap
    // (armRecorder attaches them), so the gap names its source.
    const sources = tasks
      ? tasks
          .filter((l) => Array.isArray(l.loaf) && l.start < to && l.start + l.duration > from)
          .flatMap((l) => l.loaf.flatMap((f) => f.scripts ?? []))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 3)
          .map((s) => `${s.ms}ms ${s.type}:${s.fn ?? '?'}@${s.src}:${s.at}`)
      : [];
    let attribution = 'unattributed';
    if (longTaskMs !== null && longTaskMs >= gap.gapMs * 0.5) attribution = 'page-long-task';
    else if (drawsInGap !== null && drawsInGap >= RECORDER_ONLY_MIN_DRAWS) attribution = 'recorder-only';
    else if (drawsInGap !== null) attribution = 'page-gpu-or-compositor';
    else if (longTaskMs !== null) attribution = 'no-page-long-task';
    return {
      ...gap,
      longTaskMs,
      drawsInGap,
      attribution,
      countsAgainstProduct: attribution !== 'recorder-only',
      ...(sources.length > 0 ? { sources } : {}),
    };
  });
  const product = gaps.filter((g) => g.countsAgainstProduct);
  return {
    ...report,
    gaps,
    productGapCount: product.length,
    productMaxGapMs: product.reduce((m, g) => Math.max(m, g.gapMs), 0),
    recorderOnlyMinDraws: RECORDER_ONLY_MIN_DRAWS,
    attributionSources: { longTasks: tasks !== null, renderLog: draws !== null },
  };
}

/**
 * Key-light identity for flip detection: which light is key, and how many
 * lights are visible. Intensities are NOT part of it — they interpolate
 * continuously with progress (the world-state sampler), so any motion would
 * read as a "flip" (round 2 live dither: 84 false changes). Discontinuous
 * intensity steps are caught separately by keyLightJumps.
 */
function keyLightKey(frame) {
  const light = frame?.keyLight;
  if (!light || typeof light !== 'object') return null;
  const count = typeof light.hash === 'string' && light.hash.length > 0 ? light.hash.split('|').length : 0;
  return `${light.id}|${count}`;
}

/** A per-frame relative key-light intensity change above this is a step, not interpolation. */
export const KEY_LIGHT_JUMP_REL = 0.05;

/**
 * Discontinuous key-light steps: consecutive frames whose key intensity
 * differs by more than `rel` (relative). Smooth interpolation moves a few
 * tenths of a percent per frame; a consumer that snaps shows as a step.
 */
export function keyLightJumps(frames, { rel = KEY_LIGHT_JUMP_REL } = {}) {
  const jumps = [];
  let prev = null;
  for (const f of frames) {
    const light = f?.keyLight;
    if (!light || typeof light.intensity !== 'number') continue;
    if (prev && prev.id === light.id) {
      const base = Math.max(Math.abs(prev.intensity), 1e-3);
      const change = Math.abs(light.intensity - prev.intensity) / base;
      if (change > rel) jumps.push({ t: f.t, from: prev.intensity, to: light.intensity, rel: +change.toFixed(4), smooth: f.smooth ?? null });
    }
    prev = { id: light.id, intensity: light.intensity };
  }
  return { rel, count: jumps.length, jumps };
}

/**
 * Consumer hysteresis over a trace: every change of the conductor's
 * `nearest`, the WorldNav `aria-current` chip and the key-light (id + light
 * intensity hash), with the smooth progress at the change. Informational on a
 * sweep (a real crossing changes all three once); the dither verdict judges
 * them.
 */
/**
 * Consumer channels a dither must read (a missing one makes it unmeasured);
 * `walkers` (the figure-set signature, sampled at ~5 Hz) is judged when
 * readable but never required — a world with no registered figures has none.
 */
export const REQUIRED_CONSUMERS = ['nearest', 'chip', 'keyLight'];

/**
 * Walker-group signature for one frame: the sorted ids of figures that are
 * effectively visible (mounted and not hidden), as recorded by the sweep
 * recorder from `__routeWorldFigures` (null on frames between its ~5 Hz
 * samples, so only real samples take part in change detection).
 */
function walkerKey(frame) {
  return typeof frame?.walkers === 'string' ? frame.walkers : null;
}

export function consumerChanges(frames) {
  const channels = {
    nearest: (f) => (typeof f.nearest === 'number' ? f.nearest : null),
    chip: (f) => (typeof f.chipHref === 'string' ? f.chipHref : null),
    keyLight: keyLightKey,
    walkers: walkerKey,
  };
  const out = {};
  for (const [name, read] of Object.entries(channels)) {
    const changes = [];
    let prev;
    let seen = false;
    for (const f of frames) {
      const value = read(f);
      if (value === null) continue;
      if (seen && value !== prev) changes.push({ t: f.t, from: prev, to: value, smooth: f.smooth ?? null });
      prev = value;
      seen = true;
    }
    out[name] = { readable: seen, changes: changes.length, events: changes };
  }
  return out;
}

/**
 * rAF gaps above `gapMs` with the progress they happened at — round 1 saw
 * 1–3 s gaps recurring at identical progress positions across runs, which
 * points at a page-side stall (a shader compile / asset upload at a fixed
 * place on the route) rather than capture load.
 */
export function frameGaps(frames, { gapMs = 100 } = {}) {
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const dt = frames[i].t - frames[i - 1].t;
    if (dt > gapMs) gaps.push({ t: frames[i].t, gapMs: +dt.toFixed(1), smooth: frames[i - 1].smooth ?? null });
  }
  return { thresholdMs: gapMs, count: gaps.length, maxGapMs: gaps.reduce((m, g) => Math.max(m, g.gapMs), 0), gaps };
}

function wrapPi(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Unwrap a yaw series (radians) so ±π crossings stay continuous. Nulls pass through. */
export function unwrapYaw(values) {
  const out = [];
  let prevRaw = null;
  let acc = null;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      out.push(null);
      continue;
    }
    acc = prevRaw === null || acc === null ? v : acc + wrapPi(v - prevRaw);
    prevRaw = v;
    out.push(acc);
  }
  return out;
}

/**
 * W6 skip-through verdict for one nav-chip jump leg. `frames` start at the
 * click; each carries `skip`, `pathYaw` (the authored heading, pointer
 * parallax excluded) or `yaw`, and `camPos`. Passes when:
 *  - `skip.active` became true at least once (the pose-space blend ran);
 *  - the heading moves monotonically (no reversal beyond `yawEps`) along ONE
 *    arc no longer than π + yawEps — the shortest arc between the endpoints;
 *  - the heading stays inside [start, end] ± yawEps, i.e. it never swings
 *    through an intermediate station's extreme (the left-right-left whiplash);
 *  - the landing passed the station-settle assertion (`settle.ok`).
 */
export function summarizeJump(frames, { settle = null, yawEps = 0.035 } = {}) {
  const reasons = [];
  const skipSeen = frames.some((f) => f.skip && f.skip.active === true);
  const maxInfluence = frames.reduce((m, f) => Math.max(m, f.skip && typeof f.skip.influence === 'number' ? f.skip.influence : 0), 0);
  const source = frames.some((f) => typeof f.pathYaw === 'number') ? 'pathYaw' : 'yaw';
  const yaws = unwrapYaw(frames.map((f) => f[source])).filter((y) => y !== null);
  let reversals = 0;
  let bounded = true;
  let arc = null;
  let span = null;
  if (yaws.length >= 2) {
    const start = yaws[0];
    const end = yaws[yaws.length - 1];
    arc = end - start;
    const lo = Math.min(start, end) - yawEps;
    const hi = Math.max(start, end) + yawEps;
    bounded = yaws.every((y) => y >= lo && y <= hi);
    span = { min: Math.min(...yaws), max: Math.max(...yaws), start, end };
    // Hysteresis latch on the heading: a reversal registers only after
    // coming back more than yawEps from the running extreme.
    let dir = 0;
    let extreme = start;
    for (const y of yaws) {
      if (dir === 0) {
        if (Math.abs(y - start) >= yawEps) {
          dir = Math.sign(y - start);
          extreme = y;
        }
      } else if ((y - extreme) * dir > 0) extreme = y;
      else if (Math.abs(extreme - y) >= yawEps) {
        reversals += 1;
        dir = -dir;
        extreme = y;
      }
    }
  }
  const shortest = arc === null ? null : Math.abs(arc) <= Math.PI + yawEps;
  if (!skipSeen) reasons.push('skip.active never became true (no pose-space skip-through)');
  if (yaws.length < 2) reasons.push('heading unreadable');
  if (reversals > 0) reasons.push(`${reversals} heading reversal(s) during the jump`);
  if (!bounded) reasons.push('heading left the start..end arc (swung through an intermediate station)');
  if (shortest === false) reasons.push(`heading turned ${arc.toFixed(3)} rad — longer than the shortest arc`);
  if (!settle || settle.ok !== true) reasons.push('landing failed the station-settle assertion');
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    skipSeen,
    maxInfluence: +maxInfluence.toFixed(4),
    yawSource: source,
    arcRad: arc === null ? null : +arc.toFixed(4),
    shortestArc: shortest,
    bounded,
    reversals,
    span,
    frames: frames.length,
  };
}

/**
 * Round 4 (W6 judge: a jump leg with a 767 ms pulse->schedule gap still
 * passed): the frame-gap verdict of one nav-chip jump leg — its largest rAF
 * gap against the sweep limit (250 ms). Every gap counts, whatever its
 * attribution (the attribution is listed for the judge); `unmeasured` when
 * the leg recorded fewer than two frames.
 */
export function jumpFrameGapVerdict(gaps, { limitMs = FRAME_GAP_LIMIT_MS, frames = null } = {}) {
  if (frames !== null && frames < 2) {
    return { verdict: 'unmeasured', limitMs, maxFrameGapMs: null, productMaxGapMs: null, reasons: ['fewer than two recorded frames'] };
  }
  const maxGap = gaps?.maxGapMs ?? 0;
  const worst = (gaps?.gaps ?? []).reduce((w, g) => (w === null || g.gapMs > w.gapMs ? g : w), null);
  const fail = maxGap > limitMs;
  return {
    verdict: fail ? 'fail' : 'pass',
    limitMs,
    maxFrameGapMs: maxGap,
    productMaxGapMs: gaps?.productMaxGapMs ?? null,
    worst: worst ? { t: worst.t, gapMs: worst.gapMs, attribution: worst.attribution ?? null, longTaskMs: worst.longTaskMs ?? null, drawsInGap: worst.drawsInGap ?? null } : null,
    reasons: fail ? [`max frame gap ${maxGap} ms > ${limitMs} ms (${worst?.attribution ?? 'unattributed'})`] : [],
  };
}

/**
 * Fold a jump leg's frame-gap verdict into its summarizeJump analysis: the
 * leg fails on a frame gap above the limit like on any other reason.
 */
export function withJumpFrameGap(analysis, gapVerdict) {
  const reasons = [...(analysis.reasons ?? []), ...(gapVerdict.verdict === 'fail' ? gapVerdict.reasons : [])];
  return {
    ...analysis,
    verdict: reasons.length === 0 ? analysis.verdict : 'fail',
    reasons,
    frameGapVerdict: gapVerdict.verdict,
    maxFrameGapMs: gapVerdict.maxFrameGapMs,
    frameGapLimitMs: gapVerdict.limitMs,
    frameGap: gapVerdict,
  };
}

/** Which edge a displacement (dx, dy in CSS px) points to; `none` below minPx. */
export function edgeOf(dx, dy, minPx = 2) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minPx) return 'none';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** D6: the docked panel's edge by viewport width (right rail ≥ 768 px, bottom sheet ≤ 767 px). */
export function expectedPanelEdge(viewportWidth) {
  return viewportWidth <= 767 ? 'bottom' : 'right';
}

/**
 * W6 panel-edge verdict over a panel trace. Frames carry `panel` ({ x, y, w,
 * h, closing } or null), `camPos`, `yaw` and `t`. Each contiguous run of
 * frames with a panel is one episode; its settled rect is the last frame
 * before `closing` (else the last frame). Entry = first rect − settled,
 * exit = last rect − settled; each resolves to an edge (edgeOf). Passes when
 * every episode enters AND exits on `expectedEdge` (so no edge alternates
 * across cycles) and the camera never jumps more than `maxStepM` / `maxStepRad`
 * in one frame (per-frame deltas normalised to 16.7 ms) — no hard cut through
 * a cross-blend.
 */
export function panelEdgeVerdict(frames, { expectedEdge, maxStepM = 0.75, maxStepRad = 0.25, minPx = 2 } = {}) {
  const episodes = [];
  let current = null;
  for (const f of frames) {
    if (f.panel) {
      if (!current) current = [];
      current.push(f);
    } else if (current) {
      episodes.push(current);
      current = null;
    }
  }
  if (current) episodes.push(current);
  const rows = episodes.map((run, index) => {
    const lastOpen = [...run].reverse().find((f) => !f.panel.closing) ?? run[run.length - 1];
    const first = run[0].panel;
    const last = run[run.length - 1].panel;
    const settled = lastOpen.panel;
    const entry = { dx: +(first.x - settled.x).toFixed(1), dy: +(first.y - settled.y).toFixed(1) };
    const exit = { dx: +(last.x - settled.x).toFixed(1), dy: +(last.y - settled.y).toFixed(1) };
    const closed = run.some((f) => f.panel.closing);
    return {
      index,
      from: run[0].t,
      to: run[run.length - 1].t,
      frames: run.length,
      closingSeen: closed,
      entry: { ...entry, edge: edgeOf(entry.dx, entry.dy, minPx) },
      exit: { ...exit, edge: closed ? edgeOf(exit.dx, exit.dy, minPx) : 'unobserved' },
    };
  });
  let maxStep = 0;
  let maxTurn = 0;
  // Round 5 (W6 judge: maxStepM 0.8017 while `worst` read 0.1818 m — a later
  // larger TURN overwrote the step's worst frame): the worst STEP frame and
  // the worst TURN frame are tracked separately; `worst` is the step's, so it
  // always matches maxStepM.
  let worst = null;
  let worstTurn = null;
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!Array.isArray(a.camPos) || !Array.isArray(b.camPos)) continue;
    const scale = 16.7 / Math.max(16.7, b.t - a.t);
    const step = Math.hypot(b.camPos[0] - a.camPos[0], b.camPos[1] - a.camPos[1], b.camPos[2] - a.camPos[2]) * scale;
    const turn = typeof a.yaw === 'number' && typeof b.yaw === 'number' ? Math.abs(wrapPi(b.yaw - a.yaw)) * scale : 0;
    const row = { t: b.t, fromT: a.t, dtMs: +(b.t - a.t).toFixed(1), stepM: +step.toFixed(4), turnRad: +turn.toFixed(4) };
    if (step > maxStep) {
      maxStep = step;
      worst = row;
    }
    if (turn > maxTurn) {
      maxTurn = turn;
      worstTurn = row;
    }
  }
  const reasons = [];
  if (rows.length === 0) reasons.push('no panel was ever observed');
  for (const row of rows) {
    if (row.entry.edge !== expectedEdge) reasons.push(`episode ${row.index} entered from "${row.entry.edge}" (expected ${expectedEdge})`);
    if (row.exit.edge !== expectedEdge) reasons.push(`episode ${row.index} exited to "${row.exit.edge}" (expected ${expectedEdge})`);
  }
  const edges = new Set(rows.flatMap((r) => [r.entry.edge, r.exit.edge]));
  if (maxStep > maxStepM) reasons.push(`camera jumped ${maxStep.toFixed(3)} m in one frame (limit ${maxStepM})`);
  if (maxTurn > maxStepRad) reasons.push(`camera turned ${maxTurn.toFixed(3)} rad in one frame (limit ${maxStepRad})`);
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    expectedEdge,
    alternates: edges.size > 1,
    episodes: rows,
    camera: { maxStepM: +maxStep.toFixed(4), maxTurnRad: +maxTurn.toFixed(4), limitM: maxStepM, limitRad: maxStepRad, worst, worstTurn },
  };
}

/**
 * W6 dither verdict: over the oscillation window (frames after the park
 * settled), zero changes of `nearest`, the aria-current chip and the key
 * light. `band` = [lo, hi] smooth range the park had to stay inside (the
 * 0.15 latch band around k + 0.5); leaving it makes the run `unmeasured`
 * (the gesture, not the product, left the band).
 */
export function ditherVerdict(frames, { band }) {
  const consumers = consumerChanges(frames);
  const jumps = keyLightJumps(frames);
  const smooths = frames.map((f) => f.smooth).filter((s) => typeof s === 'number');
  const range = smooths.length ? { min: Math.min(...smooths), max: Math.max(...smooths) } : null;
  const inBand = range !== null && range.min >= band[0] && range.max <= band[1];
  const reasons = [];
  for (const [name, row] of Object.entries(consumers)) {
    if (!row.readable) {
      if (REQUIRED_CONSUMERS.includes(name)) reasons.push(`${name} unreadable`);
    } else if (row.changes > 0) reasons.push(`${name} changed ${row.changes}x while dithering`);
  }
  if (jumps.count > 0) reasons.push(`key light stepped ${jumps.count}x (> ${jumps.rel * 100} % in one frame) while dithering`);
  const unreadable = REQUIRED_CONSUMERS.some((name) => !consumers[name].readable);
  const changed = Object.values(consumers).some((row) => row.changes > 0) || jumps.count > 0;
  let verdict = changed ? 'fail' : 'pass';
  if (!changed && (unreadable || !inBand)) verdict = 'unmeasured';
  if (!inBand) reasons.push(`smooth left the band [${band[0]}, ${band[1]}] (range ${range ? `${range.min.toFixed(3)}..${range.max.toFixed(3)}` : 'n/a'})`);
  return { verdict, reasons, band, range, inBand, consumers, keyLightJumps: jumps };
}

// ---------------------------------------------------------------------------
// Round 2 pure W7 analyzers (ball visibility, wobble truth, handoff sampling,
// failure path)
// ---------------------------------------------------------------------------

/**
 * Is the ball actually on screen? Round 1 measured the always-mounted
 * `[data-ball-phase]` root (fixed, inset 0, opacity 1) — it is "visible" even
 * in done/hidden, where BallLoader renders no children, so every trace failed
 * "loader visible past deadline". Visible now means: the root carries
 * `data-ball-visible` (when W7 adds it), OR at least one painted child
 * (non-empty rect, effective opacity > 0.01). `read` = { attr, paintedOpacity }.
 */
export function ballVisibleFromRead(read) {
  if (!read) return false;
  // Round 2 (lead): the ball can only be on screen in a ceremony phase; a
  // done / hidden / aborted root with a lingering child (a fade tail, a
  // stale node) is not "the loader past the deadline".
  if (typeof read.phase === 'string' && !BALL_VISIBLE_PHASES.includes(read.phase)) return false;
  if (read.attr === true) return true;
  return typeof read.paintedOpacity === 'number' && read.paintedOpacity > 0.01;
}

/** Ball phases in which the ball can count as visible (ball-loader-state.ts). */
export const BALL_VISIBLE_PHASES = ['loading', 'opening', 'releasing'];

/**
 * Stamps for a loader trace (the times a judge reads the film against):
 * every ball-phase and scene-phase transition, world-route-live, each
 * milestone rise and each wobble start, plus the deadline the page had in
 * force. `merged` = mergeLoaderTrace output.
 */
export function loaderStamps(merged) {
  const transitions = (key) => {
    const out = [];
    let prev;
    for (const s of merged) {
      const v = s[key] ?? null;
      if (out.length === 0 || v !== prev) out.push({ t: s.t, [key]: v });
      prev = v;
    }
    return out;
  };
  const rises = [];
  const wobbles = [];
  for (let i = 1; i < merged.length; i += 1) {
    const a = merged[i - 1];
    const b = merged[i];
    if (typeof a.milestones === 'number' && typeof b.milestones === 'number' && b.milestones > a.milestones) rises.push({ t: b.t, count: b.milestones });
    if (typeof a.wobbles === 'number' && typeof b.wobbles === 'number' && b.wobbles > a.wobbles) wobbles.push({ t: b.t, count: b.wobbles });
  }
  const withDeadline = merged.find((s) => typeof s.deadlineMs === 'number') ?? null;
  // The CURRENT generation's begin: the last positive stamp seen (0 = none yet).
  const begun = [...merged].reverse().find((s) => typeof s.begunAt === 'number' && s.begunAt > 0) ?? null;
  return {
    ballPhases: transitions('ballPhase'),
    scenePhases: transitions('scenePhase'),
    routeLiveAt: merged.find((s) => s.routeLive)?.t ?? null,
    firstBallVisibleAt: merged.find((s) => s.ballVisible)?.t ?? null,
    lastBallVisibleAt: [...merged].reverse().find((s) => s.ballVisible)?.t ?? null,
    milestoneRises: rises,
    wobbleStarts: wobbles,
    generationBegunAt: begun ? begun.begunAt : null,
    deadlineMs: withDeadline ? withDeadline.deadlineMs : null,
    deadlineRelaxed: withDeadline ? withDeadline.deadlineRelaxed === true : null,
  };
}

/**
 * Timeout-path verdict (--fail-inject timeout: the scene chunk is held past
 * the deadline, so the scene cannot present in time). Passes when the route
 * never goes live with a presented scene before the deadline is judged, the
 * ball is gone (aborted / not visible) and the Lite page (route not live,
 * ball not visible) shows by begunAt + deadline + `graceMs`; a route that
 * went live anyway (a late presentation that was not refused) fails.
 */
export function timeoutPathVerdict(samples, { deadlineMs = REVEAL_DEADLINE_MS, graceMs = 150, anchor = null } = {}) {
  if (samples.length === 0) return { verdict: 'unmeasured', reasons: ['empty trace'] };
  // generationBegunAt reads 0 before any generation starts, so the anchor is
  // the begin stamp carried by the first `loading` sample (else that
  // sample's own time). Wave 2 (2H): summarizeLoader passes THE anchor
  // (deadlineAnchorOf) so overrun, timeline and this path share one.
  const firstLoading = samples.find((s) => s.scenePhase === 'loading') ?? null;
  const begun =
    typeof anchor === 'number'
      ? anchor
      : firstLoading && typeof firstLoading.begunAt === 'number' && firstLoading.begunAt > 0
        ? firstLoading.begunAt
        : firstLoading?.t ?? null;
  if (begun === null) return { verdict: 'unmeasured', reasons: ['no generation begin / loading phase observed'] };
  const liteBy = begun + deadlineMs + graceMs;
  const wentLive = samples.find((s) => s.routeLive) ?? null;
  const liteShown = samples.find((s) => s.t >= begun + deadlineMs - 50 && !s.routeLive && !s.ballVisible) ?? null;
  const lastVisible = [...samples].reverse().find((s) => s.ballVisible) ?? null;
  const reasons = [];
  if (wentLive) reasons.push(`route went live at ${wentLive.t.toFixed(0)} ms despite the held scene chunk`);
  if (!liteShown) reasons.push('Lite page never shown');
  else if (liteShown.t > liteBy) reasons.push(`Lite shown at ${liteShown.t.toFixed(0)} ms, after deadline + ${graceMs} ms (${liteBy.toFixed(0)})`);
  if (lastVisible && lastVisible.t > liteBy) reasons.push(`ball still visible at ${lastVisible.t.toFixed(0)} ms, past deadline + ${graceMs} ms`);
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    begunAt: begun,
    deadlineMs,
    liteBy,
    liteShownAt: liteShown ? liteShown.t : null,
    lastBallVisibleAt: lastVisible ? lastVisible.t : null,
    routeLiveAt: wentLive ? wentLive.t : null,
    reasons,
  };
}

/**
 * Lite-floor verdict (reduced motion on --tier auto, D12): the page must
 * land Lite — the route never goes live and the canvas never shows. Needs
 * proof the emulation took (`reducedMotionMatched` = the page's own
 * matchMedia read); without it the run is `unmeasured`, never a pass.
 */
export function liteFloorVerdict(samples, { reducedMotionMatched } = {}) {
  if (reducedMotionMatched !== true) return { verdict: 'unmeasured', reasons: ['prefers-reduced-motion did not match in the page'] };
  const live = samples.find((s) => s.routeLive) ?? null;
  const canvasShown = samples.find((s) => typeof s.canvasOpacity === 'number' && s.canvasOpacity > 0.01) ?? null;
  const ballSeen = samples.find((s) => s.ballVisible) ?? null;
  const reasons = [];
  if (live) reasons.push(`route went live at ${live.t.toFixed(0)} ms under reduced motion`);
  if (canvasShown) reasons.push(`canvas shown (opacity ${canvasShown.canvasOpacity.toFixed(2)}) at ${canvasShown.t.toFixed(0)} ms under reduced motion`);
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    samples: samples.length,
    routeLiveAt: live ? live.t : null,
    canvasShownAt: canvasShown ? canvasShown.t : null,
    // Informational: a ball flash on a Lite-floor page is a W7 judgement call.
    ballVisibleAt: ballSeen ? ballSeen.t : null,
  };
}

/**
 * Reveal-gate consistency (lead r2): the gate may only resolve Lite when the
 * page really is Lite. `read` = { live, canvasOpacity, scenePhase }. A page
 * whose route is not live but whose canvas shows, or whose scene reports
 * `presented`, is inconsistent — a loud failure, never a silent "lite".
 */
export function liteGateConsistency(read) {
  const reasons = [];
  if (!read) return { ok: false, reasons: ['no read'] };
  if (read.live) reasons.push('world-route-live is set');
  if (typeof read.canvasOpacity === 'number' && read.canvasOpacity > 0.01) reasons.push(`canvas shows (opacity ${read.canvasOpacity.toFixed(2)})`);
  if (read.scenePhase === 'presented') reasons.push('scene phase is presented');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Wobble truth (W7 "one wobble per real milestone"): every wobble start must
 * coincide with a rise of the readiness milestone count. `samples` carry
 * { t, milestones, wobbles } (wobbles = running count of wobble animation
 * starts). Milestone rises with no wobble are listed (compression and the
 * entry baseline make those legitimate).
 *
 * Round 3 (judge: a tolerance counted in trace samples at a variable cadence
 * made some "unmatched" wobbles an artifact): the tolerance is in MILLISECONDS
 * of page time. A change seen at sample i happened somewhere in
 * (t[i−1], t[i]], so a wobble and a rise match when those two intervals are
 * no more than `toleranceMs` apart. `lagMs` = wobble sample time − rise
 * sample time (positive = the wobble came after the milestone).
 */
export const WOBBLE_TOLERANCE_MS = 100;

export function wobbleVerdict(samples, { toleranceMs = WOBBLE_TOLERANCE_MS } = {}) {
  const rises = [];
  const starts = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (typeof a.milestones === 'number' && typeof b.milestones === 'number' && b.milestones > a.milestones) rises.push(i);
    if (typeof a.wobbles === 'number' && typeof b.wobbles === 'number' && b.wobbles > a.wobbles) starts.push(i);
  }
  const readable = samples.some((s) => typeof s.milestones === 'number') && samples.some((s) => typeof s.wobbles === 'number');
  const span = (i) => ({ from: samples[i - 1].t, to: samples[i].t });
  const distance = (i, j) => {
    const a = span(i);
    const b = span(j);
    return Math.max(0, a.from - b.to, b.from - a.to);
  };
  const unmatched = starts.filter((i) => !rises.some((j) => distance(i, j) <= toleranceMs));
  const rows = starts.map((i) => {
    const nearest = rises.reduce((best, j) => (best === null || distance(i, j) < distance(i, best) ? j : best), null);
    return {
      t: samples[i].t,
      frame: i,
      nearestRiseFrame: nearest,
      nearestRiseT: nearest === null ? null : samples[nearest].t,
      lagMs: nearest === null ? null : +(samples[i].t - samples[nearest].t).toFixed(1),
      gapMs: nearest === null ? null : +distance(i, nearest).toFixed(1),
      sampleIntervalMs: +(samples[i].t - samples[i - 1].t).toFixed(1),
    };
  });
  return {
    verdict: !readable ? 'unmeasured' : unmatched.length > 0 ? 'fail' : 'pass',
    toleranceMs,
    milestoneRises: rises.map((i) => ({ t: samples[i].t, frame: i, to: samples[i].milestones, sampleIntervalMs: +(samples[i].t - samples[i - 1].t).toFixed(1) })),
    wobbles: rows,
    unmatched: unmatched.map((i) => samples[i].t),
    reasons: unmatched.length ? [`${unmatched.length} wobble(s) with no milestone rise within ${toleranceMs} ms (sample-interval aware)`] : [],
  };
}

/**
 * Sample density of a trace around the handoff: every sample time inside
 * [routeLiveAt − before, routeLiveAt + after], with the window edges, and the
 * largest interval. `ok` requires at least one sample and no interval above
 * `maxIntervalMs` — round 1's 1440 traces ran at ~2.6 Hz, far too coarse to
 * see a blank handoff frame, and a pass on such a trace is refused.
 */
export function handoffDensity(times, routeLiveAt, { before = 200, after = 600, maxIntervalMs = 100 } = {}) {
  if (routeLiveAt === null || routeLiveAt === undefined) {
    return { ok: false, reason: 'route never went live', window: null, samples: 0, maxIntervalMs: null, limitMs: maxIntervalMs };
  }
  const from = routeLiveAt - before;
  const to = routeLiveAt + after;
  const inside = times.filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  const points = [from, ...inside, to];
  let maxInterval = 0;
  for (let i = 1; i < points.length; i += 1) maxInterval = Math.max(maxInterval, points[i] - points[i - 1]);
  return {
    ok: inside.length > 0 && maxInterval <= maxIntervalMs,
    reason: inside.length === 0 ? 'no sample inside the handoff window' : maxInterval > maxIntervalMs ? `largest sampling interval ${maxInterval.toFixed(0)} ms > ${maxIntervalMs} ms` : null,
    window: { from, to },
    samples: inside.length,
    maxIntervalMs: +maxInterval.toFixed(1),
    limitMs: maxIntervalMs,
  };
}

/** Wave 2 r3: the handoff sampling target (ms); 100 ms stays the judged ceiling. */
export const HANDOFF_TARGET_INTERVAL_MS = 50;

/**
 * Wave 2 r3: the handoff's own verdict (pure). `source` = the dense source
 * (dom-trace | composite | none). none -> `unmeasured` (insufficient
 * sampling); a composite fail or a blank DOM gap -> `fail`; else `pass`.
 * `metTarget` says whether the judged source reached the 50 ms target.
 */
export function handoffRecord({ routeLiveAt, density, composite, source, blankGaps = [] }) {
  if (routeLiveAt === null || routeLiveAt === undefined) return { verdict: 'not-applicable', reason: 'route never went live', source };
  const compositeMax = composite?.density?.maxIntervalMs ?? null;
  const judgedMax = source === 'dom-trace' ? density?.maxIntervalMs ?? null : source === 'composite' ? compositeMax : null;
  const sampling = { domMaxIntervalMs: density?.maxIntervalMs ?? null, compositeMaxIntervalMs: compositeMax, targetMs: HANDOFF_TARGET_INTERVAL_MS, limitMs: 100, metTarget: judgedMax !== null && judgedMax <= HANDOFF_TARGET_INTERVAL_MS };
  if (source === 'none') return { verdict: 'unmeasured', unmeasuredReason: 'insufficient-sampling', source, sampling, reason: density?.reason ?? 'no dense source' };
  const from = routeLiveAt - 200;
  const to = routeLiveAt + 600;
  const blankInWindow = blankGaps.filter((g) => g && typeof g.from === 'number' && g.from <= to && (typeof g.to !== 'number' || g.to >= from));
  if (composite?.verdict === 'fail' || blankInWindow.length > 0) return { verdict: 'fail', source, sampling, reasons: [...(composite?.verdict === 'fail' ? composite.reasons ?? [] : []), ...(blankInWindow.length ? [`${blankInWindow.length} blank DOM-trace gap(s) in the handoff window`] : [])] };
  return { verdict: 'pass', source, sampling };
}

/** Composited-page luma stddev at or below this, while the route is live, is a blank frame. */
export const COMPOSITE_BLANK_SPREAD_MAX = 3;
/** Round 5: a composite window with fewer page frames than this reads `unmeasured`. */
export const COMPOSITE_MIN_PAGE_FRAMES = 5;

/**
 * Composite handoff verdict: `frames` = [{ t, spread }] from the CDP
 * screencast (the COMPOSITED page, not the canvas buffer). Blank = spread ≤
 * the floor at or after routeLiveAt inside the window. A pass needs the
 * window densely sampled (handoffDensity) — a screencast only emits on
 * change, so a frozen blank page can hide in a sampling hole; that is
 * reported as `insufficient-sampling`, never as pass.
 */
export function compositeHandoffVerdict(frames, routeLiveAt, options = {}) {
  const blankMax = options.blankSpreadMax ?? COMPOSITE_BLANK_SPREAD_MAX;
  // Round 3: `t` = the page time of the frame SHOWN (in-frame timecode) and
  // `tCapture` = when the capture was taken. Sampling density is a property
  // of the captures; a run of captures that all show the same frame is the
  // page not producing frames (a display stall), which is reported, not
  // mistaken for under-sampling.
  const captureTime = (f) => (typeof f.tCapture === 'number' ? f.tCapture : f.t);
  const density = handoffDensity(frames.map(captureTime), routeLiveAt, options);
  if (!density.window) return { verdict: 'unmeasured', density, blank: [], displayStalls: [], reasons: [density.reason] };
  const inWindow = frames
    .filter((f) => captureTime(f) >= density.window.from && captureTime(f) <= density.window.to)
    .sort((a, b) => captureTime(a) - captureTime(b));
  const blank = inWindow.filter((f) => f.t >= routeLiveAt && typeof f.spread === 'number' && f.spread <= blankMax);
  const stallLimit = options.maxIntervalMs ?? 100;
  const displayStalls = [];
  const shownTimes = inWindow.filter((f) => typeof f.tCapture === 'number').map((f) => f.t);
  if (shownTimes.length > 1) {
    const distinct = [...new Set(shownTimes)].sort((a, b) => a - b);
    for (let i = 1; i < distinct.length; i += 1) {
      const gap = distinct[i] - distinct[i - 1];
      if (gap > stallLimit) displayStalls.push({ fromShownT: distinct[i - 1], toShownT: distinct[i], ms: +gap.toFixed(1) });
    }
  }
  // Round 3: frame completeness. With the in-frame timecode every captured
  // frame names the page frame it shows, and the loader trace samples every
  // page frame (`pageFrames` = its rAF times). When every page frame inside
  // the window was captured, nothing the visitor saw was missed — however
  // far apart the captures were (a page that paints no frame for 900 ms
  // leaves nothing to sample; the trace judges that stall as a hitch).
  const pageFrames = Array.isArray(options.pageFrames) ? options.pageFrames : null;
  let coverage = null;
  if (pageFrames) {
    const shown = inWindow.filter((f) => typeof f.tCapture === 'number' && typeof f.t === 'number').map((f) => f.t);
    const inside = pageFrames.filter((t) => t >= density.window.from && t <= density.window.to);
    const missed = inside.filter((t) => !shown.some((s) => Math.abs(s - t) <= 1));
    coverage = { pageFrames: inside.length, captured: inside.length - missed.length, missed: missed.length, firstMissed: missed.slice(0, 10).map((t) => +t.toFixed(1)) };
  }
  const complete = coverage !== null && coverage.pageFrames > 0 && coverage.missed === 0;
  // Round 5 (W7 judge: sakura-1440's composite "pass" rested on 2 page
  // frames): fewer than `minPageFrames` page frames inside the window is not
  // enough to call the handoff clean — `unmeasured`, never pass. Without the
  // trace's page frames, the distinct frames the captures showed count.
  const minPageFrames = options.minPageFrames ?? COMPOSITE_MIN_PAGE_FRAMES;
  const shownDistinct = new Set(inWindow.map((f) => f.t)).size;
  const pageFramesInWindow = coverage ? coverage.pageFrames : shownDistinct;
  const tooFewFrames = pageFramesInWindow < minPageFrames;
  const reasons = [];
  if (blank.length > 0) reasons.push(`${blank.length} composited blank frame(s) after world-route-live`);
  if (!density.ok && !complete) {
    reasons.push(`handoff window under-sampled: ${density.reason}${coverage ? ` and ${coverage.missed} of ${coverage.pageFrames} page frames never captured` : ''}`);
  }
  const sampled = density.ok || complete;
  if (blank.length === 0 && sampled && tooFewFrames) {
    reasons.push(`only ${pageFramesInWindow} page frame(s) inside the handoff window (< ${minPageFrames}): too few to judge the handoff`);
  }
  // fail > insufficient-sampling > unmeasured (too few page frames) > pass.
  let verdict = 'insufficient-sampling';
  if (blank.length > 0) verdict = 'fail';
  else if (sampled && tooFewFrames) verdict = 'unmeasured';
  else if (sampled) verdict = 'pass';
  return {
    verdict,
    ...(verdict === 'unmeasured' ? { unmeasuredReason: 'too-few-page-frames' } : {}),
    pageFramesInWindow,
    minPageFrames,
    density,
    ...(coverage ? { coverage, completeCoverage: complete } : {}),
    blankSpreadMax: blankMax,
    frames: inWindow.map((f) => ({ t: f.t, ...(typeof f.tCapture === 'number' ? { tCapture: f.tCapture } : {}), spread: f.spread })),
    blank: blank.map((f) => ({ t: f.t, spread: f.spread })),
    // Page-time intervals with no new frame on screen while captures kept
    // coming: what the visitor saw frozen (informational; hitches are judged
    // by the trace's own rAF gaps).
    displayStalls,
    reasons,
  };
}

/**
 * Failure-path verdict (D3: the ball aborts instantly on any failure and Lite
 * shows by the deadline). From the first `failed` scene sample: the ball must
 * be gone or `aborted` within `maxAbortFrames` samples, and the Lite page
 * (route not live, ball gone) must show by deadlineAnchor + deadlineMs +
 * `graceMs`. `unmeasured` when the trace saw no failure.
 */
export function failurePathVerdict(samples, { deadlineMs = REVEAL_DEADLINE_MS, graceMs = 150, maxAbortFrames = 1, failedAt: explicitFailedAt = null, explicitKind = 'explicit', anchor: deadlineAnchor = null } = {}) {
  // Round 2: an explicit anchor (the injected fault's webglcontextlost
  // dispatch) wins when the trace never sampled the transient `failed` phase.
  let failedIndex = samples.findIndex((s) => s.scenePhase === 'failed');
  let anchorKind = 'scene-failed';
  if (failedIndex === -1 && typeof explicitFailedAt === 'number') {
    failedIndex = samples.findIndex((s) => s.t >= explicitFailedAt);
    anchorKind = explicitKind;
  }
  if (failedIndex === -1) return { verdict: 'unmeasured', reasons: ['no failed scene phase in the trace'] };
  const failedAt = samples[failedIndex].t;
  // Wave 2 (2H): THE deadline anchor when the caller has it (one anchor per trace).
  const anchor =
    typeof deadlineAnchor === 'number'
      ? deadlineAnchor
      : samples.find((s) => s.scenePhase === 'loading')?.t ?? samples.find((s) => s.ballVisible)?.t ?? 0;
  let abortIndex = -1;
  for (let i = failedIndex; i < samples.length; i += 1) {
    if (samples[i].ballPhase === 'aborted' || !samples[i].ballVisible) {
      abortIndex = i;
      break;
    }
  }
  const liteAt = samples.slice(failedIndex).find((s) => !s.routeLive && !s.ballVisible)?.t ?? null;
  const abortFrames = abortIndex === -1 ? null : abortIndex - failedIndex;
  // A failure after the deadline (e.g. context loss on a live world) is
  // judged from the failure itself.
  const liteBy = Math.max(anchor + deadlineMs, failedAt) + graceMs;
  const reasons = [];
  if (abortFrames === null) reasons.push('ball never aborted after the failure');
  else if (abortFrames > maxAbortFrames) reasons.push(`ball aborted ${abortFrames} frames after the failure (limit ${maxAbortFrames})`);
  if (liteAt === null) reasons.push('Lite page never shown after the failure');
  else if (liteAt > liteBy) reasons.push(`Lite shown at ${liteAt.toFixed(0)} ms, after deadline + ${graceMs} ms (${liteBy.toFixed(0)})`);
  return {
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    failedAt,
    failureAnchor: anchorKind,
    deadlineAnchor: anchor,
    abortAt: abortIndex === -1 ? null : samples[abortIndex].t,
    abortFrames,
    liteShownAt: liteAt,
    liteBy,
    reasons,
  };
}

/**
 * Merge the recorder's DOM samples with its pixel reads: each DOM sample takes
 * the latest pixel read at or before its frame time (the displayed frame is
 * the last one rendered). Both inputs are in recording order.
 */
export function mergeLoaderTrace(samples, pixels) {
  let p = -1;
  return samples.map((sample) => {
    while (p + 1 < pixels.length && pixels[p + 1].t <= sample.t) p += 1;
    const pixel = p >= 0 ? pixels[p] : null;
    // Round 2: visibility from the painted children (ballRead), never the
    // always-mounted root; older recordings without ballRead keep their flag.
    const ballVisible = sample.ballRead
      ? ballVisibleFromRead({ ...sample.ballRead, phase: sample.ballPhase ?? undefined })
      : Boolean(sample.ballVisible);
    return {
      t: sample.t,
      ballPhase: sample.ballPhase ?? null,
      ballVisible,
      routeLive: Boolean(sample.routeLive),
      canvasOpacity: typeof sample.canvasOpacity === 'number' ? sample.canvasOpacity : null,
      // Round 4: a frame inside the paused handoff window has no read of its own.
      canvasSpread: sample.pixelPaused === true ? null : pixel && typeof pixel.spread === 'number' ? pixel.spread : null,
      // Wave 2 (2H): which read this sample carries (sanitizeZeroReads tells
      // two agreeing reads from one read carried over several frames).
      ...(sample.pixelPaused !== true && pixel && typeof pixel.spread === 'number' ? { pixelT: pixel.t } : {}),
      ...(sample.pixelPaused === true ? { pixelPaused: true } : {}),
      ...(typeof sample.textHits === 'number' ? { textHits: sample.textHits } : {}),
      ...(sample.revealing === true ? { revealing: true } : {}),
      scenePhase: sample.scenePhase ?? null,
      generation: sample.generation ?? null,
      // Round 2 (additive): progress truth.
      milestones: typeof sample.milestones === 'number' ? sample.milestones : null,
      assetRatio: typeof sample.assetRatio === 'number' ? sample.assetRatio : null,
      wobbles: typeof sample.wobbles === 'number' ? sample.wobbles : null,
      // Round 2 (additive, present only when the readiness bridge gave them).
      ...(typeof sample.begunAt === 'number' ? { begunAt: sample.begunAt } : {}),
      ...(typeof sample.deadlineMs === 'number' ? { deadlineMs: sample.deadlineMs, deadlineRelaxed: sample.deadlineRelaxed === true } : {}),
      // Wave 2 (2H): the reveal gate's programs-warm input, when published.
      ...(typeof sample.programsWarm === 'boolean' ? { programsWarm: sample.programsWarm } : {}),
    };
  });
}

/**
 * Round 4 (W7 HARNESS request c): the ball must never sit over visible page
 * text before its reveal. `hits` = BallLoader's own `__ballTextIntersections`
 * (recorded only in ?routeTrace=1 / ?routeDebug=1 sessions; null = the
 * self-check was not armed → unmeasured). Fails when any hit, or any merged
 * sample's `textHits` count, is > 0 before the first `data-revealing` sample
 * (the whole trace when the ball never revealed).
 */
export function ballTextVerdict(merged, hits) {
  const revealAt = merged.find((s) => s.revealing === true)?.t ?? null;
  const before = (t) => revealAt === null || t < revealAt;
  const sampleCounted = merged.some((s) => typeof s.textHits === 'number');
  if (!Array.isArray(hits) && !sampleCounted) {
    return { verdict: 'unmeasured', revealAt, hits: 0, reasons: ['__ballTextIntersections absent (trace self-check not armed)'] };
  }
  const early = (Array.isArray(hits) ? hits : []).filter((h) => typeof h.t === 'number' && before(h.t));
  const firstSample = merged.find((s) => typeof s.textHits === 'number' && s.textHits > 0 && before(s.t)) ?? null;
  const fail = early.length > 0 || firstSample !== null;
  const texts = [...new Set(early.map((h) => h.text))].slice(0, 5);
  return {
    verdict: fail ? 'fail' : 'pass',
    revealAt,
    hits: Array.isArray(hits) ? hits.length : null,
    hitsBeforeReveal: early.length,
    firstHitAt: early[0]?.t ?? firstSample?.t ?? null,
    examples: early.slice(0, 5).map((h) => ({ t: h.t, phase: h.phase, text: h.text, ball: h.ball, rect: h.rect })),
    reasons: fail ? [`ball over visible text before data-revealing (${early.length || firstSample?.textHits} hit(s)${texts.length ? `: ${texts.map((t) => `"${t}"`).join(', ')}` : ''})`] : [],
  };
}

/**
 * Round 5: the loader's deadline-relative timeline (pure, informational).
 * The anchor is the readiness bridge's generationBegunAt (the product's own
 * deadline anchor) when the trace carries it, else loaderGaps' anchor. The
 * ball's bound (overrun) and the WORLD's are separate facts: a ball that
 * ended on time with the route going live after the deadline is an honest
 * late reveal of a live world, reported here as routeLiveAfterDeadline.
 */
export function loaderTimeline(merged, base, deadlineMs, anchorInfo = null) {
  // Wave 2 (2H): the single anchor (deadlineAnchorOf) when given. The old
  // read took the FIRST sample carrying begunAt (0 before the generation
  // began), so it could disagree with the overrun anchor (r5: 385 ms).
  const begun = anchorInfo ? (anchorInfo.source === 'generationBegunAt' ? anchorInfo.anchor : null) : merged.find((s) => typeof s.begunAt === 'number')?.begunAt ?? null;
  const anchor = anchorInfo ? anchorInfo.anchor : begun ?? base.deadlineAnchor ?? null;
  const ballEnd = merged.find((s) => s.ballPhase === 'done' || s.ballPhase === 'aborted') ?? null;
  const ballEndAt = ballEnd ? ballEnd.t : base.ballDismissedAt ?? null;
  const since = (t) => (anchor === null || t === null || t === undefined ? null : +(t - anchor).toFixed(1));
  return {
    anchor,
    anchorSource: anchorInfo ? anchorInfo.source : begun !== null ? 'generationBegunAt' : base.deadlineAnchor !== null && base.deadlineAnchor !== undefined ? 'first-loading-or-ball-frame' : null,
    deadlineMs,
    ballEndAt,
    ballEndPhase: ballEnd ? ballEnd.ballPhase : null,
    ballEndSinceAnchorMs: since(ballEndAt),
    ballWithinDeadline: since(ballEndAt) === null ? null : since(ballEndAt) <= deadlineMs,
    routeLiveAt: base.routeLiveAt ?? null,
    routeLiveSinceAnchorMs: since(base.routeLiveAt ?? null),
    routeLiveAfterDeadline: since(base.routeLiveAt ?? null) === null ? null : since(base.routeLiveAt) > deadlineMs,
  };
}

/**
 * The W7 loader verdict: the probe's loaderGaps plus (round 2) the handoff
 * sampling density — a trace too sparse around world-route-live cannot pass
 * (`insufficient-sampling`) — the wobble-truth check, the failure-path check
 * and, with --handoff-composite, the composited-page blank check.
 */
export async function summarizeLoader(mergedIn, options = {}) {
  const { loaderGaps } = await loadProbe();
  const { composite = null, failInject = null, liteFloor = null, faultFailedAt = null, ballTextHits, readiness = null, confirmFrames = null, attempts = null, ...gapOptions } = options;
  // Wave 2 (2H, residual 4): a zero-spread canvas read at full opacity is
  // `unread` unless two reads agree AND a composited frame confirms the
  // blank (r5: 18 false blank frames on plaza-rm-1440).
  const zeroReads = sanitizeZeroReads(mergedIn, { confirmFrames: confirmFrames ?? composite?.frames ?? null });
  const merged = zeroReads.merged;
  const stamps = loaderStamps(merged);
  const deadlineMs = gapOptions.deadlineMs ?? stamps.deadlineMs ?? REVEAL_DEADLINE_MS;
  // Wave 2 (2H): ONE deadline anchor (the product's generationBegunAt) for
  // the overrun, the timeline and the timeout / failure paths.
  const anchorInfo = deadlineAnchorOf(merged);
  // Round 5: the injected fault's dispatch anchors the failure path, so its
  // stalls land in failurePath.stallMs, never in the reveal hitches.
  const gaps = loaderGaps(merged, { ...gapOptions, deadlineMs, ...(typeof faultFailedAt === 'number' ? { failedAt: faultFailedAt } : {}) });
  const overrunReason = `loader visible past the ${deadlineMs} ms readiness deadline`;
  const overrun = anchorInfo.anchor === null ? gaps.overrun : overrunFromAnchor(merged, anchorInfo.anchor, deadlineMs);
  const baseReasons = gaps.reasons.filter((r) => !r.startsWith('loader visible past the'));
  if (overrun) baseReasons.push(`${overrunReason} (anchor ${anchorInfo.source} ${anchorInfo.anchor === null ? 'n/a' : anchorInfo.anchor.toFixed(1)})`);
  const base = {
    ...gaps,
    deadlineAnchor: anchorInfo.anchor ?? gaps.deadlineAnchor,
    deadlineAnchorSource: anchorInfo.anchor === null ? 'probe-first-loading-or-ball-frame' : anchorInfo.source,
    firstLoadingSampleAt: anchorInfo.firstLoadingSampleAt,
    firstLoadingSampleOffsetMs: anchorInfo.firstLoadingSampleOffsetMs,
    ...(anchorInfo.anchor !== null && gaps.deadlineAnchor !== anchorInfo.anchor ? { probeDeadlineAnchor: gaps.deadlineAnchor, probeOverrun: gaps.overrun } : {}),
    overrun,
    reasons: baseReasons,
    verdict: baseReasons.length === 0 ? 'pass' : 'fail',
  };
  const density = handoffDensity(
    merged.map((s) => s.t),
    base.routeLiveAt,
  );
  // Wave 2 (2H): wobble truth on the product clock (rock Animation.startTime
  // vs the milestone stamps) when the readiness logs are there; the rAF-sample
  // check stays beside it as `sampled`.
  const wobbleSampled = wobbleVerdict(merged);
  const wobbleProduct = readiness ? productWobbleVerdict(readiness) : null;
  const wobble =
    wobbleProduct && wobbleProduct.verdict !== 'unmeasured'
      ? { ...wobbleProduct, sampled: { verdict: wobbleSampled.verdict, unmatched: wobbleSampled.unmatched } }
      : { ...wobbleSampled, source: 'rAF-samples', ...(wobbleProduct ? { product: wobbleProduct } : {}) };
  // LOOK r2 (CAR judge: failurePath read "no failed scene phase" while the
  // product's phaseTrace held {phase: 'failed'}): the product's own log
  // anchors the failure when the rAF samples missed the one-commit phase.
  const product = readiness ? productFailure(readiness, attempts) : null;
  const explicitFailedAt = typeof faultFailedAt === 'number' ? faultFailedAt : product ? product.t : null;
  const failurePathBase = failurePathVerdict(merged, {
    deadlineMs,
    failedAt: explicitFailedAt,
    explicitKind: typeof faultFailedAt === 'number' ? 'explicit' : 'product-phaseTrace',
    anchor: anchorInfo.anchor,
  });
  if (product && failurePathBase.verdict !== 'unmeasured') {
    failurePathBase.productFailedAt = product.t;
    failurePathBase.productFailReason = product.reason;
    failurePathBase.productGeneration = product.generation;
  }
  // LOOK r2: the attempt the product failed (or the newest one) — its last
  // milestones, load signals, stall target and warm stages.
  const attempt = readiness || attempts ? attemptRecord({ readiness, attempts }) : null;
  // LOOK r2: --fail-inject stall:<ms> is judged on the stall detector.
  // LOOK r6: the harness-side stall-hold stalls from the attempt's begin (0).
  const stallMs = failInject === STALL_HOLD_KIND ? 0 : stallInjectMs(failInject);
  const stallPath =
    typeof stallMs === 'number' && Number.isFinite(stallMs)
      ? stallPathVerdict(merged, { injectMs: stallMs, anchor: anchorInfo.anchor, deadlineMs, failure: product, attempt })
      : null;
  // Round 5: failure-path stalls are reported here (informational), never as
  // reveal hitches.
  const failurePath = base.failureStalls
    ? { ...failurePathBase, stallMs: base.failureStalls.stallMs, stallTotalMs: base.failureStalls.totalMs, stalls: base.failureStalls.stalls }
    : failurePathBase;
  // Round 2: the injected-fault and Lite-floor verdicts (only on those runs).
  const timeoutPath = failInject === 'timeout' ? timeoutPathVerdict(merged, { deadlineMs, anchor: anchorInfo.anchor }) : null;
  const liteFloorResult = liteFloor ? liteFloorVerdict(merged, liteFloor) : null;
  // Round 4: the ball-over-text self-check (only when the caller passes the
  // page's hits — undefined keeps older callers unchanged).
  const ballText = ballTextHits === undefined ? null : ballTextVerdict(merged, ballTextHits);
  const reasons = [...base.reasons];
  if (ballText && ballText.verdict === 'fail') reasons.push(...ballText.reasons);
  if (wobble.verdict === 'fail') reasons.push(...wobble.reasons);
  if (failurePath.verdict === 'fail') reasons.push(...failurePath.reasons);
  if (composite && composite.verdict === 'fail') reasons.push(...composite.reasons);
  if (timeoutPath && timeoutPath.verdict !== 'pass') reasons.push(...timeoutPath.reasons.map((r) => `timeout path: ${r}`));
  if (liteFloorResult && liteFloorResult.verdict !== 'pass') reasons.push(...liteFloorResult.reasons.map((r) => `lite floor: ${r}`));
  if (stallPath && stallPath.verdict !== 'pass') reasons.push(...stallPath.reasons.map((r) => `stall path: ${r}`));
  // A context-loss injection that the page never registered as a failure is
  // not a pass of the failure path.
  if (typeof failInject === 'string' && failInject.startsWith('context-loss') && failurePath.verdict === 'unmeasured') {
    reasons.push('context-loss injected but the scene never reported failed and no webglcontextlost dispatch was stamped');
  }
  let verdict = reasons.length === 0 ? 'pass' : 'fail';
  // A live route with a sparse handoff window is never a pass. A densely
  // sampled COMPOSITE of the same window (--handoff-composite, periodic
  // screenshots of the composited page) is the stronger handoff evidence and
  // satisfies the requirement when the DOM trace itself is thinned by the
  // capture load; the record says which source carried it.
  // Round 3: a composite that captured EVERY page frame of the window
  // (timecode completeness) is dense evidence too.
  // Round 5: a composite with too few page frames in the window is never
  // dense evidence, whatever its capture cadence.
  const compositeDense = Boolean(
    composite && composite.verdict !== 'unmeasured' && ((composite.density && composite.density.ok) || composite.completeCoverage === true),
  );
  const handoffDensitySource = density.ok ? 'dom-trace' : compositeDense ? 'composite' : 'none';
  // Round 3 (judge): an under-sampled handoff is `unmeasured` (with
  // unmeasuredReason 'insufficient-sampling'), never a pass and never a fail.
  let unmeasuredReason = null;
  if (verdict === 'pass' && base.routeLiveAt !== null && !density.ok && !compositeDense) {
    verdict = 'unmeasured';
    unmeasuredReason = 'insufficient-sampling';
    reasons.push(`DOM trace under-sampled around the handoff: ${density.reason}${composite ? '' : ' (no --handoff-composite capture in this run)'}`);
  }
  // (A composite that is unmeasured because the route never went live is a
  // failure-path run: no handoff to judge, so it does not demote the verdict.)
  if (
    verdict === 'pass' &&
    composite &&
    (composite.verdict === 'insufficient-sampling' || (composite.verdict === 'unmeasured' && composite.unmeasuredReason === 'too-few-page-frames'))
  ) {
    verdict = 'unmeasured';
    unmeasuredReason = 'insufficient-sampling';
    reasons.push(...(composite.reasons ?? []));
  }
  const timeline = loaderTimeline(merged, base, deadlineMs, anchorInfo.anchor === null ? null : anchorInfo);
  // Wave 2 r3 (W7 judge: plaza 1440 handoffDensity maxInterval 282.9 ms was
  // printed next to a pass/fail): the handoff has its OWN verdict. It is
  // judged only from a source that sampled the window at <= 100 ms (target
  // HANDOFF_TARGET_INTERVAL_MS = 50); otherwise it is `unmeasured`, never a
  // pass or a fail, whatever the rest of the trace says.
  const handoff = handoffRecord({ routeLiveAt: base.routeLiveAt, density, composite, source: handoffDensitySource, blankGaps: Array.isArray(base.gaps) ? base.gaps : [] });
  // Wave 2 round 2 (W7 judge: "the sakura late routeLive is only a silent
  // flag"): a world that went live after the deadline is a NOTICE (never a
  // fail on its own: the ball's bound is judged by `overrun`), carrying the
  // times a judge needs to see whether the world was visible before the
  // deadline — scene presented, ball opening (the reveal arm), ball end and
  // world-route-live, each relative to the deadline anchor.
  const notices = [];
  if (timeline.routeLiveAfterDeadline === true) {
    const firstT = (pred) => merged.find(pred)?.t ?? null;
    const rel = (t) => (t === null || timeline.anchor === null ? null : +(t - timeline.anchor).toFixed(1));
    const presentedAt = firstT((s) => s.scenePhase === 'presented');
    const openingAt = firstT((s) => s.ballPhase === 'opening');
    const canvasVisibleAt = firstT((s) => typeof s.canvasOpacity === 'number' && s.canvasOpacity >= 0.99);
    notices.push({
      kind: 'routeLiveAfterDeadline',
      message: `world-route-live ${timeline.routeLiveSinceAnchorMs} ms after the deadline anchor (deadline ${deadlineMs} ms); presented ${rel(presentedAt) ?? 'never'} ms, reveal armed (ball opening) ${rel(openingAt) ?? 'never'} ms, canvas opaque ${rel(canvasVisibleAt) ?? 'never'} ms, ball ended ${timeline.ballEndSinceAnchorMs ?? 'never'} ms`,
      presentedSinceAnchorMs: rel(presentedAt),
      revealArmSinceAnchorMs: rel(openingAt),
      canvasOpaqueSinceAnchorMs: rel(canvasVisibleAt),
      ballEndSinceAnchorMs: timeline.ballEndSinceAnchorMs,
      routeLiveSinceAnchorMs: timeline.routeLiveSinceAnchorMs,
      worldVisibleBeforeDeadline: rel(canvasVisibleAt) !== null && rel(canvasVisibleAt) <= deadlineMs,
    });
  }
  // Wave 2 round 2 (W7 judge: analysis.failedAt null while
  // failurePath.failedAt = 8648.8): ONE failedAt. The failure path's value
  // wins (it falls back to the injected fault's dispatch when the transient
  // `failed` phase was never sampled); the probe's own sampled value is kept
  // as probeFailedAt only when it differs.
  const unifiedFailedAt = typeof failurePath.failedAt === 'number' ? failurePath.failedAt : typeof base.failedAt === 'number' ? base.failedAt : null;
  return {
    ...base,
    failedAt: unifiedFailedAt,
    failedAtSource: typeof failurePath.failedAt === 'number' ? `failurePath:${failurePath.failureAnchor}` : typeof base.failedAt === 'number' ? 'probe-sampled' : null,
    ...(typeof base.failedAt === 'number' && base.failedAt !== unifiedFailedAt ? { probeFailedAt: base.failedAt } : {}),
    baseVerdict: base.verdict,
    verdict,
    ...(unmeasuredReason ? { unmeasuredReason } : {}),
    reasons,
    notices,
    // Round 5 (W7 judge: sakura-1440 went live 11.2 s after generationBegun
    // with overrun null — the ball had ended at 9.86 s — and the trace showed
    // no separate world-live bound): the deadline-relative timeline.
    timeline,
    handoffDensity: density,
    handoffDensitySource,
    handoff,
    wobble,
    failurePath,
    composite,
    // Wave 2 (2H): phases from the product's own logs (a single-commit phase
    // is never missed) and the programs-warm moment.
    stamps: {
      ...stamps,
      programsWarmAt: merged.find((s) => s.programsWarm === true)?.t ?? null,
      product: readiness ? productPhaseStamps(readiness, stamps) : { source: 'rAF-samples', note: 'no end-of-trace readiness read' },
    },
    zeroReads: { demoted: zeroReads.demoted, confirmed: zeroReads.confirmed, rule: zeroReads.rule },
    ...(ballText ? { ballText } : {}),
    ...(timeoutPath ? { timeoutPath } : {}),
    ...(liteFloorResult ? { liteFloor: liteFloorResult } : {}),
    ...(stallPath ? { stallPath } : {}),
    ...(attempt ? { attempt } : {}),
  };
}

// ---------------------------------------------------------------------------
// In-page recorder (serialized into the page by addInitScript)
// ---------------------------------------------------------------------------

/**
 * W7 loader recorder, armed before navigation. Self-contained by contract.
 *
 * - One DOM sample per animation frame from navigation start: the ball root's
 *   `data-ball-phase` and visibility, `html.world-route-live`, the canvas's
 *   effective opacity (product up its ancestor chain), and
 *   `__routeWorldReadiness()` when that bridge exists.
 * - One pixel read per RENDERED frame: WebGL draw calls set a dirty flag, and
 *   every rAF callback is wrapped so that, right after a callback that drew,
 *   the canvas is downsampled to `patch`×`patch` BEFORE the compositor clears
 *   the drawing buffer (no preserveDrawingBuffer needed). Frames without a
 *   draw keep the previous read — that is what the screen shows.
 */
export function installLoaderRecorder(opts) {
  const host = window;
  if (host.__captureLoaderTrace) return;
  const maxSamples = opts.maxSamples;
  const size = opts.patch;
  const samples = [];
  const pixels = [];
  // LOOK r2 (CAR judge): the LAST readiness read of every scene generation
  // (milestones, load signals, stall target), so a failed attempt's final
  // state survives the fresh idle generation that replaces it.
  const attempts = {};
  let active = true;
  let dirty = false;
  let ctx2d = null;
  const patch = document.createElement('canvas');
  patch.width = size;
  patch.height = size;
  const findCanvas = () => document.querySelector('[data-route-canvas] canvas') || document.querySelector('canvas');
  const effectiveOpacity = (el) => {
    let opacity = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return 0;
      opacity *= Number.parseFloat(style.opacity || '1');
    }
    return opacity;
  };
  const markDraws = (proto) => {
    if (!proto) return;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function markedDraw(...args) {
        dirty = true;
        return original.apply(this, args);
      };
    }
  };
  try {
    markDraws(host.WebGL2RenderingContext && host.WebGL2RenderingContext.prototype);
    markDraws(host.WebGLRenderingContext && host.WebGLRenderingContext.prototype);
  } catch {
    /* prototypes locked — pixel reads stay null (unreadable, never "blank") */
  }
  // Round 2: count wobble animation starts (BallLoader re-keys its wobble
  // element per shake, so each shake restarts one CSS animation). Captured at
  // the document so a re-keyed element is always seen.
  let wobbles = 0;
  document.addEventListener(
    'animationstart',
    (event) => {
      const target = event.target;
      if (target && target.nodeType === 1 && target.closest && target.closest('[data-ball-loader]') && /wobble/i.test(String(event.animationName || ''))) {
        wobbles += 1;
      }
    },
    true,
  );
  // Round 2: before world-route-live the canvas is inert by design (D2), so
  // a readback there is pure GPU cost — it halved the 1440 sample rate in
  // round 1. Pixels are read only once the route is live or the canvas shows.
  const canvasShowing = (canvas) =>
    document.documentElement.classList.contains('world-route-live') || effectiveOpacity(canvas) > 0.01;
  // Round 4 (W7 judge: the composite was under-sampled on 3 of 5 runs): the
  // canvas readback is paused through the handoff window — from the first
  // `opening` phase until world-route-live + handoffPauseAfterMs (and while
  // the ceremony is still opening / releasing) — so the composited-page
  // screencast, the handoff's real evidence, gets the GPU. Paused frames
  // record canvasSpread null (unreadable, never blank).
  const pauseAfterMs = typeof opts.handoffPauseAfterMs === 'number' ? opts.handoffPauseAfterMs : 400;
  // Round 5 (W7 judge: keep the handoff window's sampling at <= 100 ms): runs
  // WITHOUT the composite (whose screencast is the handoff evidence) keep
  // their canvas reads through the window — they are its only blank-frame
  // evidence — but throttled to one per `handoffReadEveryMs`, so the
  // readback's GPU sync no longer lands on every frame of the ceremony.
  const throttleAfterMs = typeof opts.handoffThrottleAfterMs === 'number' ? opts.handoffThrottleAfterMs : 0;
  const readEveryMs = typeof opts.handoffReadEveryMs === 'number' ? opts.handoffReadEveryMs : 100;
  let openingAt = null;
  // Wave 2 (2H, residual 4): the reduced-motion ceremony has no `opening`
  // phase (a plain fade), so round 5's pause/throttle never engaged there and
  // the unthrottled reads produced zero-spread artifacts. The handoff start
  // (html[data-route-handoff] or a [data-revealing] loader) opens the same
  // window when no `opening` was seen.
  let handoffAt = null;
  let routeLiveAt = null;
  let pausedReads = 0;
  let throttledReads = 0;
  let lastReadAt = null;
  const pauseWindow = { from: null, to: null };
  const inHandoff = (ts, afterMs) => {
    if ((openingAt === null && handoffAt === null) || afterMs <= 0) return false;
    const ball = document.querySelector('[data-ball-loader]') || document.querySelector('[data-ball-phase]');
    const phase = ball ? ball.getAttribute('data-ball-phase') : null;
    if (phase === 'opening' || phase === 'releasing') return true;
    return routeLiveAt !== null && ts < routeLiveAt + afterMs;
  };
  const handoffPaused = (ts) => inHandoff(ts, pauseAfterMs);
  const readPixels = (ts) => {
    if (!active || !dirty) return;
    if (handoffPaused(ts)) {
      pausedReads += 1;
      if (pauseWindow.from === null) pauseWindow.from = ts;
      pauseWindow.to = ts;
      return;
    }
    if (lastReadAt !== null && ts - lastReadAt < readEveryMs && inHandoff(ts, throttleAfterMs)) {
      throttledReads += 1;
      return;
    }
    lastReadAt = ts;
    dirty = false;
    const canvas = findCanvas();
    if (!canvas || !canvas.width || !canvas.height) return;
    if (!canvasShowing(canvas)) return;
    try {
      ctx2d = ctx2d || patch.getContext('2d', { willReadFrequently: true });
      ctx2d.clearRect(0, 0, size, size);
      ctx2d.drawImage(canvas, 0, 0, size, size);
      const data = ctx2d.getImageData(0, 0, size, size).data;
      let sum = 0;
      let sumSq = 0;
      const n = size * size;
      for (let i = 0; i < n; i += 1) {
        const o = i * 4;
        const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        sum += l;
        sumSq += l * l;
      }
      const mean = sum / n;
      pixels.push({ t: ts, mean, spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) });
    } catch (err) {
      pixels.push({ t: ts, mean: null, spread: null, error: String((err && err.message) || err) });
    }
  };
  const nativeRaf = host.requestAnimationFrame.bind(host);
  host.requestAnimationFrame = (callback) =>
    nativeRaf((ts) => {
      try {
        callback(ts);
      } finally {
        readPixels(ts);
      }
    });
  const tick = (ts) => {
    if (!active) return;
    const ball = document.querySelector('[data-ball-loader]') || document.querySelector('[data-ball-phase]');
    // Round 2: the root is always mounted (fixed, inset 0, opacity 1) and
    // renders NO children in done/hidden, so the root's own box says nothing.
    // Visible = `data-ball-visible` on the root (once W7 adds it) or a painted
    // child: non-empty rect and effective opacity > 0.01 (the max over the
    // root's direct children — flight, beam, scrim).
    let ballRead = null;
    if (ball) {
      let paintedOpacity = 0;
      for (const child of ball.children) {
        const rect = child.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        paintedOpacity = Math.max(paintedOpacity, effectiveOpacity(child));
      }
      ballRead = { attr: ball.hasAttribute('data-ball-visible') ? true : null, paintedOpacity };
    }
    // Same rule as ballVisibleFromRead (self-contained copy): only a ceremony
    // phase (loading / opening / releasing) can show the ball.
    const phaseNow = ball ? ball.getAttribute('data-ball-phase') : null;
    const ceremony = phaseNow === 'loading' || phaseNow === 'opening' || phaseNow === 'releasing';
    const liveNow = document.documentElement.classList.contains('world-route-live');
    if (openingAt === null && phaseNow === 'opening') openingAt = ts;
    if (handoffAt === null && (document.documentElement.hasAttribute('data-route-handoff') || (ball && ball.hasAttribute('data-revealing')))) handoffAt = ts;
    if (routeLiveAt === null && liveNow) routeLiveAt = ts;
    // Round 4: the ball's own over-text self-check (BallLoader, trace/debug
    // sessions) — how many hits it has recorded so far, and whether the
    // ball has started its reveal (data-revealing).
    const textHits = Array.isArray(host.__ballTextIntersections) ? host.__ballTextIntersections.length : null;
    const revealing = ball ? ball.hasAttribute('data-revealing') : false;
    const ballVisible = ballRead !== null && ceremony && (ballRead.attr === true || ballRead.paintedOpacity > 0.01);
    const canvas = findCanvas();
    let scenePhase = null;
    let generation = null;
    let milestones = null;
    let assetRatio = null;
    let begunAt = null;
    let deadlineMs = null;
    let deadlineRelaxed = null;
    let programsWarm = null;
    try {
      const read = host.__routeWorldReadiness;
      const readiness = typeof read === 'function' ? read() : null;
      if (readiness && typeof readiness === 'object') {
        scenePhase = typeof readiness.phase === 'string' ? readiness.phase : null;
        generation = typeof readiness.generation === 'number' ? readiness.generation : null;
        // Round 2: the deadline anchor and the deadline in force (a relaxed
        // debug deadline is visible in the trace, never silent).
        begunAt = typeof readiness.generationBegunAt === 'number' ? readiness.generationBegunAt : null;
        deadlineMs = typeof readiness.deadlineMs === 'number' ? readiness.deadlineMs : null;
        deadlineRelaxed = typeof readiness.deadlineRelaxed === 'boolean' ? readiness.deadlineRelaxed : null;
        programsWarm = typeof readiness.programsWarm === 'boolean' ? readiness.programsWarm : null;
        const progress = readiness.milestones;
        if (progress && typeof progress === 'object') {
          milestones = typeof progress.count === 'number' ? progress.count : null;
          assetRatio = typeof progress.assetRatio === 'number' ? progress.assetRatio : null;
        }
        if (generation !== null) {
          try {
            attempts[generation] = JSON.parse(
              JSON.stringify({
                t: ts,
                phase: scenePhase,
                milestones: progress ?? null,
                loadSignals: readiness.loadSignals ?? null,
                stallAt: typeof readiness.stallAt === 'number' ? readiness.stallAt : null,
                lastFault: readiness.lastFault ?? null,
                generationBegunAt: begunAt,
              }),
            );
          } catch {
            /* unserializable read — keep the previous one */
          }
        }
      }
    } catch {
      /* bridge threw — leave null */
    }
    samples.push({
      t: ts,
      ballPhase: phaseNow,
      ballVisible,
      ballRead,
      routeLive: liveNow,
      canvasOpacity: canvas ? effectiveOpacity(canvas) : null,
      pixelPaused: handoffPaused(ts),
      revealing,
      textHits,
      scenePhase,
      generation,
      milestones,
      assetRatio,
      wobbles,
      begunAt,
      deadlineMs,
      deadlineRelaxed,
      programsWarm,
    });
    if (samples.length >= maxSamples) active = false;
    else nativeRaf(tick);
  };
  nativeRaf(tick);
  host.__captureLoaderTrace = {
    stop: () => {
      active = false;
    },
    status: () => {
      const last = samples[samples.length - 1] || null;
      return { active, count: samples.length, last, now: performance.now() };
    },
    dump: () => ({
      samples: samples.slice(),
      pixels: pixels.slice(),
      pixelPause: {
        afterMs: pauseAfterMs,
        openingAt,
        handoffAt,
        routeLiveAt,
        pausedReads,
        from: pauseWindow.from,
        to: pauseWindow.to,
        // Round 5: the no-composite throttle (0 = off).
        throttleAfterMs,
        readEveryMs,
        throttledReads,
      },
      ballTextIntersections: Array.isArray(host.__ballTextIntersections) ? host.__ballTextIntersections.slice() : null,
      readinessBridge: typeof host.__routeWorldReadiness === 'function',
      timeOrigin: performance.timeOrigin,
      attempts: JSON.parse(JSON.stringify(attempts)),
    }),
  };
}

/**
 * --loader-film phase recorder, armed before navigation. Self-contained by
 * contract. Records ONLY changes of { ballPhase, ballPresent, routeLive,
 * scenePhase } per rAF (t = rAF time, ms since navigation start), plus the
 * page's `performance.timeOrigin` so the harness can map screencast frame
 * timestamps (epoch) onto the same clock. No pixel reads — the film's frames
 * come from the screencast, so this recorder costs almost nothing.
 */
export function installFilmRecorder(opts) {
  const host = window;
  if (host.__captureLoaderFilm) return;
  const maxSamples = opts.maxSamples;
  const samples = [];
  let active = true;
  let lastKey = '';
  const nativeRaf = host.requestAnimationFrame.bind(host);
  const tick = (ts) => {
    if (!active) return;
    const ball = document.querySelector('[data-ball-loader]');
    let scenePhase = null;
    try {
      const read = host.__routeWorldReadiness;
      const readiness = typeof read === 'function' ? read() : null;
      if (readiness && typeof readiness === 'object' && typeof readiness.phase === 'string') scenePhase = readiness.phase;
    } catch {
      /* bridge threw — leave null */
    }
    const sample = {
      t: ts,
      ballPresent: Boolean(ball),
      ballPhase: ball ? ball.getAttribute('data-ball-phase') : null,
      routeLive: document.documentElement.classList.contains('world-route-live'),
      scenePhase,
    };
    const key = `${sample.ballPresent}|${sample.ballPhase}|${sample.routeLive}|${sample.scenePhase}`;
    if (key !== lastKey) {
      lastKey = key;
      samples.push(sample);
    }
    if (samples.length >= maxSamples) active = false;
    else nativeRaf(tick);
  };
  nativeRaf(tick);
  host.__captureLoaderFilm = {
    stop: () => {
      active = false;
    },
    status: () => ({ active, last: samples[samples.length - 1] || null, now: performance.now() }),
    dump: () => ({ timeOrigin: performance.timeOrigin, samples: samples.slice() }),
  };
}

/**
 * Round 3 shared clock (W7 judge: a film tile at +11333 and the trace's blank
 * frames at 12400 could not be cross-referenced): a tiny harness-injected
 * timecode, bottom-left, `bits` blocks wide and two rows high (`block` CSS px
 * each). Every animation frame it paints Math.round(rAF time) — the SAME
 * clock the loader trace stamps its samples with — as binary (row 0) and its
 * complement (row 1, a validity check). Any composited frame (screencast or
 * periodic screenshot) then carries the page time of the frame it shows;
 * decodeTimecode reads it back. Self-contained by contract (addInitScript).
 * It is a visible 96 × 8 px strip in the films — disclosed in their notes.
 */
export const TIMECODE = { bits: 24, block: 4 };

export function installTimecode(opts) {
  const host = window;
  if (host.__captureTimecode) return;
  const bits = opts.bits;
  const block = opts.block;
  const mask = 2 ** bits - 1;
  const nativeRaf = host.requestAnimationFrame.bind(host);
  const state = { attached: false, frames: 0 };
  host.__captureTimecode = { bits, block, status: () => ({ ...state }) };
  let canvas = null;
  let ctx = null;
  const draw = (ts) => {
    if (!canvas) {
      if (!document.body) {
        nativeRaf(draw);
        return;
      }
      canvas = document.createElement('canvas');
      canvas.width = bits * block;
      canvas.height = 2 * block;
      canvas.setAttribute('data-capture-timecode', '');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = `position:fixed;left:0;bottom:0;width:${bits * block}px;height:${2 * block}px;z-index:2147483647;pointer-events:none;image-rendering:pixelated;margin:0;padding:0;border:0;`;
      ctx = canvas.getContext('2d');
      document.body.appendChild(canvas);
      state.attached = true;
    }
    if (!canvas.isConnected && document.body) document.body.appendChild(canvas);
    const value = Math.round(ts) & mask;
    for (let i = 0; i < bits; i += 1) {
      const bit = Math.floor(value / 2 ** (bits - 1 - i)) % 2;
      ctx.fillStyle = bit ? '#ffffff' : '#000000';
      ctx.fillRect(i * block, 0, block, block);
      ctx.fillStyle = bit ? '#000000' : '#ffffff';
      ctx.fillRect(i * block, block, block, block);
    }
    state.frames += 1;
    nativeRaf(draw);
  };
  nativeRaf(draw);
}

/**
 * Decode the timecode from one frame's raw pixels. `raw` = { data, width,
 * height, channels } (sharp .raw() output of the whole frame); `cssWidth` =
 * the viewport width in CSS px (frame scale = width / cssWidth). Returns the
 * page time in ms, or null when the strip is absent or any bit fails its
 * complement check.
 */
export function decodeTimecode(raw, { cssWidth, bits = TIMECODE.bits, block = TIMECODE.block } = {}) {
  if (!raw || !raw.data || !raw.width || !raw.height) return null;
  const scale = cssWidth ? raw.width / cssWidth : 1;
  const channels = raw.channels ?? 3;
  const luma = (x, y) => {
    const px = Math.min(raw.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(raw.height - 1, Math.max(0, Math.floor(y)));
    const o = (py * raw.width + px) * channels;
    const r = raw.data[o];
    const g = channels >= 3 ? raw.data[o + 1] : r;
    const b = channels >= 3 ? raw.data[o + 2] : r;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const top = raw.height - 2 * block * scale;
  let value = 0;
  for (let i = 0; i < bits; i += 1) {
    const x = (i * block + block / 2) * scale;
    const hi = luma(x, top + (block / 2) * scale) > 127;
    const lo = luma(x, top + (block + block / 2) * scale) > 127;
    if (hi === lo) return null;
    value = value * 2 + (hi ? 1 : 0);
  }
  return value;
}

/**
 * Stamp captured frames on the page clock: the timecode when it decodes,
 * else epoch − timeOrigin (the old mapping). Returns { frames: [{ t, tEpoch,
 * tTimecode, clock, data, kind }], clock: { timecode, epochMapped,
 * medianEpochMinusTimecodeMs } } — the median offset quantifies how far the
 * epoch mapping was off in this run.
 */
export async function stampFrames(frames, { timeOrigin, cssWidth }) {
  const out = [];
  const offsets = [];
  for (const f of frames) {
    const tEpoch = typeof timeOrigin === 'number' ? f.epochMs - timeOrigin : null;
    let tTimecode = null;
    try {
      const { data, info } = await sharp(f.data).raw().toBuffer({ resolveWithObject: true });
      tTimecode = decodeTimecode({ data, width: info.width, height: info.height, channels: info.channels }, { cssWidth });
    } catch {
      tTimecode = null;
    }
    // The 24-bit code wraps every ~4.7 h — unwrap onto the epoch estimate.
    if (tTimecode !== null && tEpoch !== null) {
      const period = 2 ** TIMECODE.bits;
      tTimecode += Math.round((tEpoch - tTimecode) / period) * period;
      offsets.push(tEpoch - tTimecode);
    }
    const t = tTimecode ?? tEpoch;
    out.push({ t: t === null ? null : Math.round(t), tEpoch: tEpoch === null ? null : Math.round(tEpoch), tTimecode, clock: tTimecode !== null ? 'timecode' : 'epoch', data: f.data, kind: f.kind ?? 'screencast' });
  }
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  // When the capture was TAKEN, on the page clock: the epoch stamp corrected
  // by the run's median offset. Differs from t (the frame SHOWN) when the page
  // produced no new frame between captures — a stall, not under-sampling.
  for (const f of out) f.tCapture = f.tEpoch === null ? null : Math.round(f.tEpoch - median);
  return {
    frames: out,
    clock: {
      timecode: out.filter((f) => f.clock === 'timecode').length,
      epochMapped: out.filter((f) => f.clock === 'epoch').length,
      medianEpochMinusTimecodeMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    },
  };
}

/**
 * --fail-inject context-loss:<phase> (W7 failure path), armed before
 * navigation. Self-contained by contract. Records every WebGL context the
 * page creates (a getContext wrapper — nothing is created on the page's
 * behalf), then, on the first frame the ball is in the target phase and the
 * scene's context exists, calls WEBGL_lose_context.loseContext() on it.
 * `window.__captureFailInject.status()` reports when it fired (rAF clock,
 * ms since navigation start), in which ball phase, or why it missed.
 */
export function installFailInject(opts) {
  const host = window;
  if (host.__captureFailInject) return;
  const kind = String(opts.kind);
  const target = kind.split(':')[1] || 'loading';
  const order = ['hidden', 'loading', 'opening', 'releasing', 'done', 'aborted'];
  const contexts = [];
  const original = host.HTMLCanvasElement.prototype.getContext;
  host.HTMLCanvasElement.prototype.getContext = function capturedGetContext(type, ...rest) {
    const ctx = original.call(this, type, ...rest);
    if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
      if (!contexts.some((entry) => entry.ctx === ctx)) contexts.push({ ctx, canvas: this, at: performance.now() });
    }
    return ctx;
  };
  const record = { kind, target, firedAt: null, phaseAtFire: null, extension: null, missed: null, contexts: 0, targetSeenAt: null };
  const nativeRaf = host.requestAnimationFrame.bind(host);
  const tick = (ts) => {
    if (record.firedAt !== null || record.missed !== null) return;
    const ball = document.querySelector('[data-ball-loader]');
    const phase = ball ? ball.getAttribute('data-ball-phase') : null;
    record.contexts = contexts.length;
    const scene =
      [...contexts].reverse().find((entry) => entry.canvas.isConnected && entry.canvas.closest && entry.canvas.closest('[data-route-canvas]')) ||
      [...contexts].reverse().find((entry) => entry.canvas.isConnected) ||
      null;
    if (phase === target) {
      record.targetSeenAt ??= ts;
      if (scene) {
        const ext = scene.ctx.getExtension('WEBGL_lose_context');
        record.extension = Boolean(ext);
        record.firedAt = ts;
        record.phaseAtFire = phase;
        record.targetInRouteCanvas = Boolean(scene.canvas.closest && scene.canvas.closest('[data-route-canvas]'));
        // The moment the PAGE learns of the failure: the webglcontextlost
        // dispatch (the product's `failed` scene phase can be set and reset
        // inside one task, invisible to a rAF sampler).
        scene.canvas.addEventListener(
          'webglcontextlost',
          () => {
            record.lostEventAt ??= performance.now();
          },
          { capture: true, once: true },
        );
        if (ext) ext.loseContext();
        else record.missed = 'WEBGL_lose_context unavailable';
        return;
      }
    } else if (phase !== null && order.indexOf(phase) > order.indexOf(target)) {
      record.missed = `ball reached "${phase}" before a scene WebGL context existed in "${target}"`;
      return;
    }
    if (ts > 60_000) {
      record.missed = `ball never reached "${target}" within 60 s`;
      return;
    }
    nativeRaf(tick);
  };
  nativeRaf(tick);
  host.__captureFailInject = { status: () => ({ ...record }) };
}

/**
 * W3 (round 2): the water debug bridge's snapshot when the page has one
 * (`__routeWorldWater`, debug-gated), else null. Stamped into sidecars and
 * --frames samples so ripple events are numeric evidence, not a still.
 */
export async function readWater(page) {
  return page.evaluate(() => {
    const fn = window.__routeWorldWater;
    if (typeof fn !== 'function') return null;
    try {
      return { at: performance.now(), ...fn() };
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  });
}

// ---------------------------------------------------------------------------
// Runners (drive a live Playwright page)
// ---------------------------------------------------------------------------

/**
 * --loader-film capture, started BEFORE navigation. Prefers CDP
 * `Page.startScreencast` (every compositor frame, acked at once; Chromium
 * emits a frame only when the screen changes); falls back to a periodic
 * `page.screenshot` loop at `fps` when a CDP session or the screencast is
 * unavailable. Frames are kept in memory as encoded JPEG buffers, bounded by
 * `maxFrames` (overflow is counted, never silent). `stop()` ends the capture
 * and returns { frames: [{ epochMs, data }], source, dropped, error }.
 */
/** Round 3: bound on one periodic composited screenshot (ms). */
export const PERIODIC_SHOT_TIMEOUT_MS = 2000;

export async function startLoaderFilm(page, { fps = FILM_FPS_FLOOR, maxFrames = 2400, quality = 80, cadenceMs = null } = {}) {
  const frames = [];
  let dropped = 0;
  let stopped = false;
  let source = 'screencast';
  let error = null;
  let cdp = null;
  let loop = null;
  let periodic = null;
  try {
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', (event) => {
      cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (stopped) return;
      if (frames.length >= maxFrames) {
        dropped += 1;
        return;
      }
      const stamp = event.metadata?.timestamp;
      frames.push({
        epochMs: typeof stamp === 'number' ? stamp * 1000 : Date.now(),
        data: Buffer.from(event.data, 'base64'),
        kind: 'screencast',
      });
    });
    const viewport = page.viewportSize();
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality,
      everyNthFrame: 1,
      ...(viewport ? { maxWidth: viewport.width, maxHeight: viewport.height } : {}),
    });
    // Round 2 (lead): the screencast emits only when the screen changes, so
    // its frame stamps are not a cadence. With `cadenceMs`, a periodic CDP
    // Page.captureScreenshot of the COMPOSITED page runs beside it at a
    // steady target cadence (stamped at the request/response midpoint; the
    // achieved intervals are reported, never assumed). A screenshot that
    // cannot be taken because the page produces no frames shows up as a gap.
    if (cadenceMs !== null) {
      source = 'screencast+periodic';
      periodic = (async () => {
        while (!stopped) {
          const at = Date.now();
          try {
            // Round 3: bounded — Page.captureScreenshot waits for a new frame
            // and never resolves while the page produces none (a window pushed
            // behind another capture's), which hung stop() indefinitely.
            let timer = null;
            const shot = await Promise.race([
              cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('captureScreenshot timeout')), PERIODIC_SHOT_TIMEOUT_MS);
              }),
            ]).finally(() => clearTimeout(timer));
            const done = Date.now();
            if (!stopped) {
              if (frames.length < maxFrames) {
                frames.push({ epochMs: (at + done) / 2, data: Buffer.from(shot.data, 'base64'), kind: 'periodic', latencyMs: done - at });
              } else dropped += 1;
            }
          } catch {
            /* navigation in flight / session closing — keep the cadence */
          }
          const wait = cadenceMs - (Date.now() - at);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
      })();
    }
  } catch (err) {
    error = `screencast unavailable: ${err instanceof Error ? err.message : String(err)}`;
    source = 'screenshot';
    if (cdp) await cdp.detach().catch(() => {});
    cdp = null;
    const intervalMs = Math.round(1000 / fps);
    loop = (async () => {
      while (!stopped) {
        const at = Date.now();
        try {
          const data = await page.screenshot({ type: 'jpeg', quality, animations: 'allow', timeout: 2000 });
          if (frames.length < maxFrames) frames.push({ epochMs: at, data });
          else dropped += 1;
        } catch {
          /* mid-navigation screenshot failures are expected — keep sampling */
        }
        const wait = intervalMs - (Date.now() - at);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    })();
  }
  // Idempotent: the film and the handoff composite may share one capture
  // (one screencast per page), and both call stop().
  let stopping = null;
  return {
    source,
    cadenceMs,
    stop: () => {
      stopping ??= (async () => {
        stopped = true;
        if (periodic) await periodic;
        if (cdp) {
          await cdp.send('Page.stopScreencast').catch(() => {});
          await cdp.detach().catch(() => {});
        }
        if (loop) await loop;
        frames.sort((a, b) => a.epochMs - b.epochMs);
        return { frames, source, dropped, error, cadenceMs };
      })();
      return stopping;
    },
  };
}

/**
 * Achieved cadence of the periodic (steady) frames of a film: count, the
 * median and max interval between consecutive periodic shots and the
 * screencast's own emission gaps. `frames` = [{ t, kind }].
 */
export function filmCadence(frames) {
  const intervals = (list) => {
    const out = [];
    for (let i = 1; i < list.length; i += 1) out.push(list[i].t - list[i - 1].t);
    return out;
  };
  const stat = (values) => {
    if (values.length === 0) return { median: null, max: null };
    const sorted = [...values].sort((a, b) => a - b);
    return { median: +sorted[Math.floor(sorted.length / 2)].toFixed(1), max: +sorted[sorted.length - 1].toFixed(1) };
  };
  const periodicFrames = frames.filter((f) => f.kind === 'periodic');
  const castFrames = frames.filter((f) => f.kind !== 'periodic');
  const p = stat(intervals(periodicFrames));
  const c = stat(intervals(castFrames));
  return {
    periodic: { frames: periodicFrames.length, medianIntervalMs: p.median, maxIntervalMs: p.max },
    screencast: { frames: castFrames.length, medianIntervalMs: c.median, maxGapMs: c.max },
  };
}

/**
 * Wait until the film's ceremony has ended — the ball reached `done` /
 * `aborted` (or, on a page without a ball, the route went live) — plus
 * `tailMs`, or until `maxMs` after navigation start. Returns how it ended.
 */
export async function waitForFilmEnd(page, { maxMs = 25_000, tailMs = 600, pollMs = 100 } = {}) {
  let endedAt = null;
  let reason = 'bounded';
  for (;;) {
    const status = await page.evaluate(() => {
      const film = window.__captureLoaderFilm;
      return film ? film.status() : null;
    });
    if (!status) return { ok: false, reason: 'film-recorder-missing (addInitScript did not run)' };
    const last = status.last;
    if (endedAt === null && last) {
      if (last.ballPresent && ['done', 'aborted'].includes(last.ballPhase)) {
        endedAt = status.now;
        reason = `ball-${last.ballPhase}`;
      } else if (!last.ballPresent && last.routeLive) {
        endedAt = status.now;
        reason = 'route-live-no-ball';
      }
    }
    if (endedAt !== null && status.now - endedAt >= tailMs) break;
    if (status.now >= maxMs) {
      if (endedAt === null) reason = 'bounded';
      break;
    }
    await page.waitForTimeout(pollMs);
  }
  const dump = await page.evaluate(() => {
    const film = window.__captureLoaderFilm;
    film.stop();
    return film.dump();
  });
  return { ok: true, reason, timeOrigin: dump.timeOrigin, samples: dump.samples };
}

/** DOM layers a still stamps or a visitor sees over the world, W1's overlap set. */
export const DOM_LAYER_SELECTORS = [
  '.world-nav-hud',
  '.world-focus-panel[open]',
  'dialog[open]',
  '[data-station-caption]',
  '[data-ball-loader]',
];

/** Visible rects (CSS px) of the DOM layers above the world. */
export async function readDomLayers(page, selectors = DOM_LAYER_SELECTORS) {
  return page.evaluate((list) => {
    const effectiveOpacity = (el) => {
      let opacity = 1;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return 0;
        opacity *= Number.parseFloat(style.opacity || '1');
      }
      return opacity;
    };
    const out = [];
    for (const selector of list) {
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width < 1 || rect.height < 1 || style.visibility === 'hidden' || style.display === 'none') continue;
        if (Number.parseFloat(style.opacity || '1') <= 0.01) continue;
        // Round 2: the ball loader root is always mounted full-viewport and is
        // empty in done/hidden — it counts only while a child actually paints
        // (and then with the painted children's union box, not the root's).
        if (el.hasAttribute('data-ball-loader')) {
          let box = null;
          for (const child of el.children) {
            const r = child.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || effectiveOpacity(child) <= 0.01) continue;
            box = box
              ? { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
              : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
          }
          if (!box) continue;
          out.push({ layer: selector, rect: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 } });
          continue;
        }
        // Wave 2 round 2 (W1 judge): the Station Card box can be stretched
        // far past its content (an inherited `section { min-height: 100vh }`
        // gave 374 x 844 at 390), which made every face "under the card".
        // The layer rect is the card's CONTENT box (children union plus the
        // card's own padding and border); the element box rides along as
        // `boxRect` with `oversized` so the stretch stays a visible defect
        // (cardVerdict fails it) instead of contaminating face measures.
        if (el.hasAttribute('data-station-caption')) {
          let box = null;
          for (const child of el.children) {
            const r = child.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            box = box
              ? { x0: Math.min(box.x0, r.left), y0: Math.min(box.y0, r.top), x1: Math.max(box.x1, r.right), y1: Math.max(box.y1, r.bottom) }
              : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
          }
          const px = (v) => Number.parseFloat(v || '0') || 0;
          const content = box
            ? {
                x: rect.x,
                y: Math.max(rect.y, box.y0 - px(style.paddingTop) - px(style.borderTopWidth)),
                w: rect.width,
                h: 0,
              }
            : null;
          if (content && box) content.h = Math.min(rect.bottom, box.y1 + px(style.paddingBottom) + px(style.borderBottomWidth)) - content.y;
          const final = content ?? { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
          out.push({
            layer: selector,
            rect: final,
            boxRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            oversized: rect.height - final.h > 48,
          });
          continue;
        }
        out.push({ layer: selector, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
      }
    }
    return out;
  }, selectors);
}

/**
 * One evidence sample: figure rows, the occlusion grid, the camera/progress
 * read. Every bridge is optional — a missing one records null (and the
 * summary reports `unmeasured`), never a fabricated row.
 */
export async function sampleEvidence(page, { occlusion = true, nx = 6, ny = 4 } = {}) {
  return page.evaluate(
    ({ withOcclusion, gx, gy }) => {
      const call = (name, ...args) => {
        const fn = window[name];
        if (typeof fn !== 'function') return null;
        try {
          return fn(...args);
        } catch (err) {
          return { error: String((err && err.message) || err) };
        }
      };
      const water = call('__routeWorldWater');
      // Wave 2 r3 (TEAMS judge): the roll-call bridge at every sample (its
      // bulky per-column fits dropped; startedAt / arrivals / columns / lights kept).
      const rc = call('__routeWorldRollCall');
      let rollCall = null;
      if (rc && typeof rc === 'object' && !rc.error) {
        rollCall = { startedAt: typeof rc.startedAt === 'number' ? rc.startedAt : null, arrivals: typeof rc.arrivals === 'number' ? rc.arrivals : null, columns: typeof rc.columns === 'number' ? rc.columns : null, lights: Array.isArray(rc.lights) ? [...rc.lights] : null };
      } else if (rc) rollCall = rc;
      return {
        pageT: performance.now(),
        ...(rollCall !== null ? { rollCall } : {}),
        figures: call('__routeWorldFigures'),
        occlusion: withOcclusion ? call('__routeWorldOcclusion', { nx: gx, ny: gy }) : null,
        camera: call('__routeWorldCamera') ?? call('__routeWorldProbe'),
        // Round 2 (W3; key present only on pages with the water bridge).
        ...(water !== null ? { water } : {}),
      };
    },
    { withOcclusion: occlusion, gx: nx, gy: ny },
  );
}

/**
 * Round 3: one read of what the landed station actually shows — subject
 * presence rows, the frustum content count, the plaza station-window map
 * (`__c089Windows`, null in the other worlds) and the compile guard's hold
 * count. Every bridge is optional; a missing one records null.
 */
export async function readStationContent(page) {
  return page.evaluate(() => {
    const call = (name) => {
      const fn = window[name];
      if (typeof fn !== 'function') return null;
      try {
        return fn();
      } catch (err) {
        return { error: String((err && err.message) || err) };
      }
    };
    const canvas = document.querySelector('canvas');
    const r3f = canvas && canvas.__r3f;
    if (r3f && typeof r3f.invalidate === 'function') r3f.invalidate(2);
    let windows = null;
    try {
      windows = window.__c089Windows ? JSON.parse(JSON.stringify(window.__c089Windows)) : null;
    } catch {
      windows = null;
    }
    const probe = call('__routeWorldProbe');
    return {
      at: performance.now(),
      subjects: call('__routeWorldSubjects'),
      content: call('__routeWorldContent'),
      windows,
      compileHeld: probe && typeof probe.compileHeld === 'number' ? probe.compileHeld : null,
    };
  });
}

/**
 * Round 3: poll readStationContent until the station's subject is present
 * and the compile guard holds nothing back (a window can mount a few frames
 * after the camera lands), bounded by `waitMs`. Returns the last read with
 * the presence verdict and how long it waited.
 */
export async function waitForStationContent(page, station, { waitMs = 4000, pollMs = 150 } = {}) {
  const started = Date.now();
  let read = null;
  let presence = null;
  for (;;) {
    read = await readStationContent(page);
    presence = subjectPresenceVerdict(read.subjects, station);
    const held = typeof read.compileHeld === 'number' && read.compileHeld > 0;
    if ((presence.verdict !== 'fail' && !held) || Date.now() - started > waitMs) break;
    await page.waitForTimeout(pollMs);
  }
  return { read, presence, waitedMs: Date.now() - started };
}

/** One-shot W1 record for a still: occlusion rows + DOM overlap + verdict. */
export async function occlusionSnapshot(page, { nx = 6, ny = 4, station = null, presence = null } = {}) {
  const sample = await sampleEvidence(page, { occlusion: true, nx, ny });
  const report = sample.occlusion;
  if (!report || report.error || !Array.isArray(report.rows)) {
    return {
      ok: false,
      reason: report?.error ? `occlusion-bridge-threw: ${report.error}` : 'missing-occlusion-bridge (needs ?routeDebug=1 and EvidenceBridges)',
    };
  }
  const layers = await readDomLayers(page);
  const { domOverlaps } = await loadProbe();
  const overlaps = domOverlaps(
    layers,
    report.rows.map((row) => ({ id: row.id, kind: row.kind, rect: row.rect })),
  );
  const teamsOrder =
    station === 'teams'
      ? teamsOrderRecord(
          report.rows,
          await page.evaluate(() => {
            const rail = [...document.querySelectorAll('[data-station-caption] a[href*="team="]')].map((a) => {
              try {
                return new URL(a.href).searchParams.get('team');
              } catch {
                return null;
              }
            });
            const bridge = window.__routeWorldRollCall;
            let order = null;
            try {
              const snap = typeof bridge === 'function' ? bridge() : bridge;
              // The roll-call bridge lists its columns in standings order
              // (`order`, else `fits[].id`).
              if (snap && Array.isArray(snap.order)) order = snap.order.map(String);
              else if (snap && Array.isArray(snap.fits)) order = snap.fits.map((f) => (f && f.id != null ? String(f.id) : null)).filter((id) => id !== null);
            } catch {
              order = null;
            }
            return { rail: rail.filter((id) => typeof id === 'string'), bridgeOrder: order };
          }),
        )
      : null;
  return {
    ok: true,
    report,
    domLayers: layers,
    domOverlaps: overlaps,
    w1: summarizeSubjectOcclusion(report, { station, presence }),
    ...(teamsOrder ? { teamsOrder } : {}),
  };
}

/** A settled station's card must be at least this opaque (D15 bar). */
export const STATION_CARD_MIN_OPACITY = 0.99;

/**
 * Wave 2 round 2 (W1 judge, D15): the Station Card at a settled station pose.
 * `record` = capture-route's captureStationCardLayer record. Fails when the
 * card is absent, hidden, not in `enter`, below STATION_CARD_MIN_OPACITY, or
 * its element box is stretched past its content (`oversized`); not judged
 * (`not-judged`) off a settled station or with a focus panel open, where the
 * card may legitimately collapse or yield.
 */
export function stationCardVerdict(record, { settled = true, focus = false } = {}) {
  if (!record) return { verdict: 'unmeasured', reasons: ['no card record'] };
  if (!settled) return { verdict: 'not-judged', reasons: ['station not settled'] };
  if (focus) return { verdict: 'not-judged', reasons: ['focus panel open'] };
  const reasons = [];
  if (!record.present) reasons.push('card-absent');
  else {
    if (record.hidden) reasons.push('card-hidden');
    if (record.state !== 'enter') reasons.push(`card-state-${record.state ?? 'none'}`);
    if (typeof record.opacity !== 'number' || record.opacity < STATION_CARD_MIN_OPACITY) reasons.push(`card-opacity-${record.opacity}`);
    if (record.oversized) reasons.push(`card-box-oversized (element ${Math.round(record.cardRect?.h ?? 0)} px tall, content ${Math.round(record.contentRect?.h ?? 0)} px)`);
    if (!record.kicker) reasons.push('card-kicker-empty');
  }
  return { verdict: reasons.length > 0 ? 'fail' : 'pass', reasons, minOpacity: STATION_CARD_MIN_OPACITY };
}

/**
 * Wave 2 round 2 (TEAMS judge): the ledger order next to the standings order.
 * `projectedLeftToRight` = the team:<id> statues by projected rect centre x;
 * `rail` = the 390 roll-call rail chips (standings order by contract);
 * `bridgeOrder` = __routeWorldRollCall().order when the page publishes it.
 * `matches` compares the projected order with the first standings source
 * present (bridge, else rail); null when there is none (reported, not judged).
 */
export function teamsOrderRecord(rows, { rail = [], bridgeOrder = null } = {}) {
  const projected = (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.id === 'string' && /^team:/.test(row.id) && row.rect && row.onScreen !== false)
    .map((row) => ({ id: row.id.slice('team:'.length), cx: row.rect.x + row.rect.w / 2 }))
    .sort((a, b) => a.cx - b.cx)
    .map((row) => row.id);
  const standings = Array.isArray(bridgeOrder) && bridgeOrder.length > 0 ? bridgeOrder : rail.length > 0 ? rail : null;
  const onScreenStandings = standings ? standings.filter((id) => projected.includes(id)) : null;
  return {
    projectedLeftToRight: projected,
    rail,
    bridgeOrder: Array.isArray(bridgeOrder) ? bridgeOrder : null,
    standingsSource: Array.isArray(bridgeOrder) && bridgeOrder.length > 0 ? 'bridge' : rail.length > 0 ? 'rail' : null,
    matches: onScreenStandings && projected.length > 0 ? onScreenStandings.join(',') === projected.join(',') : null,
  };
}

/**
 * W6 sweep: an in-page rAF recorder of progress / direction / yaw / docked
 * panel box plus the input sign of the latest wheel event, while the harness
 * scripts wheel steps from the start station toward the target. Recording
 * continues `settleMs` after the last step so a post-gesture snap-back is in
 * the trace.
 */
/**
 * Arm the per-rAF W6 recorder in the page (idempotent per arm: a new arm
 * replaces the previous recorder). Each frame: input sign (latest wheel), the
 * conductor (smooth / exact / nearest / direction / velocity), the camera
 * (measured yaw + pitch + camPos, the rig's pathYaw, skip-through state,
 * focus phase + blend, key light), the WorldNav aria-current chip, and the
 * docked panel box with its `data-closing` state. Stop with stopRecorder().
 */
export async function armRecorder(page) {
  await page.evaluate(() => {
    const prev = window.__captureSweep;
    if (prev) prev.stop();
    const frames = [];
    const state = { active: true, inputSign: 0 };
    const onWheel = (event) => {
      if (event.deltaY !== 0) state.inputSign = event.deltaY > 0 ? 1 : -1;
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    // Round 3: main-thread long tasks (gap attribution) and the per-render
    // yaw log (EvidenceBridges) for the same window.
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
      });
      observer.observe({ type: 'longtask' });
    } catch {
      observer = null;
    }
    // Wave-2 r3 (W6 judge: "the gap must name its source"): long animation
    // frames with their script attribution (invoker + function + source
    // position, top 4 by duration). Attached to the overlapping long tasks at
    // stop(), so every sidecar that already writes `longTasks` carries it.
    const loafs = [];
    let loafObserver = null;
    const takeLoafs = (entries) => {
      for (const entry of entries) {
        if (entry.duration < 100) continue;
        const scripts = Array.isArray(entry.scripts) ? entry.scripts : [];
        loafs.push({
          start: entry.startTime,
          duration: entry.duration,
          renderStart: entry.renderStart > 0 ? +(entry.renderStart - entry.startTime).toFixed(1) : null,
          scripts: scripts
            .map((s) => ({
              ms: Math.round(s.duration),
              invoker: s.invoker,
              type: s.invokerType,
              fn: s.sourceFunctionName || null,
              src: String(s.sourceURL || '').replace(/^.*\/_next\//, ''),
              at: s.sourceCharPosition,
              layoutMs: Math.round(s.forcedStyleAndLayoutDuration || 0),
            }))
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 4),
        });
      }
    };
    try {
      loafObserver = new PerformanceObserver((list) => takeLoafs(list.getEntries()));
      loafObserver.observe({ type: 'long-animation-frame' });
    } catch {
      loafObserver = null;
    }
    const renderLog = window.__routeWorldRenderLog && typeof window.__routeWorldRenderLog.start === 'function' ? window.__routeWorldRenderLog : null;
    if (renderLog) renderLog.start();
    window.__captureSweepExtras = null;
    const read = () => {
      const camera = typeof window.__routeWorldCamera === 'function' ? window.__routeWorldCamera() : null;
      if (camera) return camera;
      return typeof window.__routeWorldProbe === 'function' ? window.__routeWorldProbe() : null;
    };
    const num = (body, key) => (body && typeof body[key] === 'number' && Number.isFinite(body[key]) ? body[key] : null);
    // Round 2: walker group = the sorted ids of effectively visible figures
    // (station windows mount/show them), sampled at ~5 Hz — the figures
    // bridge projects every figure, too heavy for every rAF.
    let walkersAt = -Infinity;
    const readWalkers = (ts) => {
      if (ts - walkersAt < 200 || typeof window.__routeWorldFigures !== 'function') return null;
      walkersAt = ts;
      try {
        const report = window.__routeWorldFigures();
        const rows = report && Array.isArray(report.rows) ? report.rows : [];
        return rows
          .filter((row) => row && row.effectiveVisible)
          .map((row) => String(row.id))
          .sort()
          .join(',');
      } catch {
        return null;
      }
    };
    const tick = (ts) => {
      if (!state.active) return;
      let body = null;
      try {
        body = read();
      } catch {
        body = null;
      }
      const walkers = readWalkers(ts);
      const panel = document.querySelector('.world-focus-panel[open]');
      const box = panel ? panel.getBoundingClientRect() : null;
      const chip = document.querySelector('.world-nav-hud-track a[aria-current="true"]');
      const light = body && body.keyLight && typeof body.keyLight === 'object' ? body.keyLight : null;
      frames.push({
        t: ts,
        inputSign: state.inputSign,
        scrollY: window.scrollY,
        smooth: num(body, 'smooth'),
        exact: num(body, 'exact'),
        nearest: num(body, 'nearest'),
        direction: num(body, 'direction'),
        velocity: num(body, 'velocity'),
        yaw: num(body, 'yaw'),
        probeYaw: num(body, 'probeYaw'),
        pathYaw: num(body, 'pathYaw'),
        pitch: num(body, 'pitch'),
        // Round 3: the rig's own last turn step (null until CameraRig publishes it).
        lastTurnDeltaRad: num(body, 'lastTurnDeltaRad'),
        lastDt: num(body, 'lastDt'),
        camPos: body && Array.isArray(body.camPos) ? body.camPos.slice(0, 3) : null,
        // LOOK r6 (H7/H8): the live vertical fov, so a dolly still can be projected (look probe).
        fov: num(body, 'fov'),
        skip: body && body.skip && typeof body.skip === 'object' ? { ...body.skip } : null,
        focusPhase: body && typeof body.focusPhase === 'string' ? body.focusPhase : null,
        focusBlend: num(body, 'focusBlend'),
        keyLight: light ? { id: light.id, intensity: light.intensity, hash: light.hash } : null,
        chipHref: chip ? chip.getAttribute('href') : null,
        ...(walkers !== null ? { walkers } : {}),
        // Wave 2 (2H): the latched settle signal (null until 2A publishes
        // it) and the Station Card box, so the card's enter / exit edge can
        // be judged against `direction` (2B acceptance).
        settled: body && typeof body.settled === 'boolean' ? body.settled : null,
        caption: (() => {
          const card = document.querySelector('[data-station-caption]');
          if (!card) return null;
          const r = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          // Wave 2 round 2 (W6 judge): the card's own enter / exit edge and
          // latched direction, recorded explicitly (not derived from y).
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            opacity: Number.parseFloat(style.opacity || '1'),
            visible: style.visibility !== 'hidden' && style.display !== 'none',
            station: card.getAttribute('data-station'),
            state: card.getAttribute('data-card-state'),
            edge: card.getAttribute('data-edge'),
            direction: card.getAttribute('data-direction'),
            travel: card.getAttribute('data-travel'),
          };
        })(),
        // Wave 2 round 2 (W6 judge): the plaza station-window map per frame
        // (useStationWindow's __c089Windows; null in worlds without it) as
        // key -> [entered, resident, skipGate, station], so a mid-skip mount
        // is measured, not inferred from frame gaps.
        windows: (() => {
          const map = window.__c089Windows;
          if (!map || typeof map !== 'object') return null;
          const out = {};
          for (const [k, w] of Object.entries(map)) {
            if (w && typeof w === 'object') out[k] = [w.entered === true ? 1 : 0, w.resident === true ? 1 : 0, typeof w.skipGate === 'string' ? w.skipGate : null, typeof w.station === 'number' ? w.station : null];
          }
          return out;
        })(),
        panel: box
          ? {
              x: box.x,
              y: box.y,
              w: box.width,
              h: box.height,
              closing: panel.hasAttribute('data-closing'),
              opacity: Number.parseFloat(getComputedStyle(panel).opacity || '1'),
            }
          : null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__captureSweep = {
      stop: () => {
        if (!state.active) return frames;
        state.active = false;
        window.removeEventListener('wheel', onWheel, { capture: true });
        if (observer) {
          for (const entry of observer.takeRecords()) longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name });
          observer.disconnect();
        }
        if (loafObserver) {
          takeLoafs(loafObserver.takeRecords());
          loafObserver.disconnect();
          for (const task of longTasks) {
            const hit = loafs.filter((l) => l.start < task.start + task.duration && l.start + l.duration > task.start);
            if (hit.length > 0) task.loaf = hit.map((l) => ({ start: +l.start.toFixed(1), ms: Math.round(l.duration), renderStart: l.renderStart, scripts: l.scripts }));
          }
        }
        let render = null;
        try {
          render = renderLog ? renderLog.stop() : null;
        } catch {
          render = null;
        }
        window.__captureSweepExtras = { longTasks: observer ? longTasks : null, render };
        return frames;
      },
      now: () => performance.now(),
    };
  });
}

/** Stop the in-page recorder and return its frames. */
export async function stopRecorder(page) {
  return page.evaluate(() => (window.__captureSweep ? window.__captureSweep.stop() : []));
}

/**
 * Round 3: what the last stopped recorder kept beside its frames — the
 * long-task list (null when the browser has no 'longtask' entry type) and the
 * render-log dump (null on pages without __routeWorldRenderLog).
 */
export async function takeRecorderExtras(page) {
  return page.evaluate(() => window.__captureSweepExtras ?? { longTasks: null, render: null });
}

export async function runSweep(page, { mode, toIndex, settleMs = 1500, stepPx = 100, waitMs = 60, maxSteps = 400 }) {
  await armRecorder(page);

  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
  const plan = sweepPlan(mode, { stepPx, waitMs, maxSteps });
  let steps = 0;
  let reached = false;
  for (const step of plan) {
    await page.mouse.wheel(0, step.dy);
    steps += 1;
    await page.waitForTimeout(step.waitMs);
    const status = await page.evaluate(() => {
      const fn = window.__routeWorldProbe;
      const body = typeof fn === 'function' ? fn() : null;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return { exact: body && typeof body.exact === 'number' ? body.exact : null, scrollY: window.scrollY, max };
    });
    const forward = mode !== 'up';
    const atEdge = forward ? status.scrollY >= status.max - 1 : status.scrollY <= 0;
    const atTarget =
      status.exact !== null && (forward ? status.exact >= toIndex - 0.02 : status.exact <= toIndex + 0.02);
    if (atTarget || atEdge) {
      reached = atTarget;
      break;
    }
  }
  await page.waitForTimeout(settleMs);
  const frames = await stopRecorder(page);
  const extras = await takeRecorderExtras(page);
  return { frames, steps, reached, render: extras.render, longTasks: extras.longTasks };
}

/** Wait (bounded) until the conductor sits on `index` and the rig has let go of any skip. */
/**
 * Wave 2 round 2: poll the conductor's latched `settled` signal (2A) until it
 * holds, bounded. `unmeasured` when the probe never publishes it.
 */
async function waitSettledLatch(page, { timeoutMs = 3000, pollMs = 50 } = {}) {
  const started = Date.now();
  for (;;) {
    const read = await page.evaluate(() => {
      const fn = window.__routeWorldProbe;
      const body = typeof fn === 'function' ? fn() : null;
      return { settled: body && typeof body.settled === 'boolean' ? body.settled : null, t: performance.now() };
    });
    if (read.settled === true) return { ok: true, at: read.t, waitedMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { ok: read.settled === null ? null : false, at: null, waitedMs: Date.now() - started, ...(read.settled === null ? { reason: 'probe publishes no settled field' } : {}) };
    await page.waitForTimeout(pollMs);
  }
}

async function waitLanded(page, index, { timeoutMs = 10_000, eps = 0.01 } = {}) {
  const started = Date.now();
  for (;;) {
    const read = await page.evaluate(() => {
      const fn = window.__routeWorldProbe;
      const body = typeof fn === 'function' ? fn() : null;
      return body
        ? { exact: body.exact, smooth: body.smooth, skip: body.skip ?? null, t: performance.now() }
        : null;
    });
    if (
      read &&
      typeof read.exact === 'number' &&
      typeof read.smooth === 'number' &&
      Math.abs(read.exact - index) < eps &&
      Math.abs(read.smooth - read.exact) < eps &&
      !(read.skip && read.skip.active && read.skip.influence > 0.01)
    ) {
      return { ok: true, waitedMs: Date.now() - started, at: read.t ?? null, read };
    }
    if (Date.now() - started > timeoutMs) return { ok: false, waitedMs: Date.now() - started, read };
    await page.waitForTimeout(50);
  }
}

/**
 * Click the WorldNav chip for `#<section>` WITHOUT moving the pointer
 * (element.click() in the page): a Playwright click would move the mouse onto
 * the chip and feed pointer parallax into the heading the jump verdict reads.
 */
export async function clickNavChip(page, section) {
  return page.evaluate((id) => {
    const chip = document.querySelector(`.world-nav-hud-track a[href="#${id}"]`);
    if (!chip) return { ok: false, reason: `no .world-nav-hud-track chip for #${id}` };
    chip.click();
    return { ok: true, t: performance.now() };
  }, section);
}

/**
 * --sweep jump: for each leg, land + assert the start station (`land` is the
 * harness's landStation), arm the recorder, click the target's nav chip,
 * wait until it has landed and the skip released, then assert the landing
 * (`assertLanding` = the harness's station-settle poll). Returns per-leg
 * frames and the summarizeJump verdict.
 */
export async function runJump(page, { legs, land, assertLanding, stationIds = STATION_IDS, tailMs = 600, settleLatchMs = 3000 }) {
  const out = [];
  for (const leg of legs) {
    const fromIndex = stationIds.indexOf(leg.from);
    const toIndex = stationIds.indexOf(leg.to);
    const startSettle = await land(leg.from);
    await armRecorder(page);
    await page.waitForTimeout(150); // a few pre-click frames
    const click = await clickNavChip(page, leg.to);
    if (!click.ok) {
      await stopRecorder(page);
      out.push({ ...leg, fromIndex, toIndex, startSettle, click, frames: [], analysis: { verdict: 'fail', reasons: [click.reason] } });
      continue;
    }
    const landed = await waitLanded(page, toIndex);
    // Wave 2 round 2 (W6 judge: films stopped at ~+1.4 s, the settled latch
    // lands at ~+2.2 s): keep recording until the conductor's settled latch
    // holds (bounded), then the tail, so the leg's frames and film reach the
    // settled station face.
    const settledLatch = await waitSettledLatch(page, { timeoutMs: settleLatchMs });
    await page.waitForTimeout(tailMs);
    const all = await stopRecorder(page);
    const extras = await takeRecorderExtras(page);
    const settle = await assertLanding(toIndex, leg.to);
    const frames = all.filter((f) => f.t >= click.t);
    // Round 3: the leg's own slice of the render log (from the click on).
    const render = extras.render ? { ...extras.render, samples: extras.render.samples.filter((s) => s.t >= click.t) } : null;
    const legGaps = attributeFrameGaps(frameGaps(frames), { longTasks: extras.longTasks, render });
    out.push({
      ...leg,
      fromIndex,
      toIndex,
      startSettle,
      clickAt: click.t,
      landed,
      settledLatch,
      settle,
      // Wave 2 round 2 (W6 judge): measured mid-skip window mounts and the
      // Station Card's explicit enter / exit edges over the leg.
      windowMounts: skipWindowMountVerdict(all, {
        clickT: click.t,
        landedT: landed.ok && typeof landed.at === 'number' ? landed.at : null,
        toIndex,
      }),
      cardEdges: cardEdgeVerdict(all, { stationIds }),
      // Round 4: the leg's frame-gap verdict (limit 250 ms) is part of it.
      analysis: withJumpFrameGap(summarizeJump(frames, { settle }), jumpFrameGapVerdict(legGaps, { frames: frames.length })),
      // Round 2 (additive): the rendered turn rate and hitches of the leg.
      // Round 3: + the per-render rate, gap attribution and the whole-leg
      // height excursion (a skip-through leaves the authored path).
      yawRate: peakYawRate(frames, { render }),
      frameGaps: legGaps,
      legHeight: legHeightExcursion(frames),
      render,
      frames: all,
    });
  }
  return out;
}

/**
 * Seek scrollY (bisection, in page) until the conductor's `exact` is within
 * `tol` of `target` (a fractional station coordinate), then wait for smooth
 * to catch it. Returns the reached { exact, smooth, scrollY }.
 */
export async function parkAt(page, target, { tol = 0.005, settleMs = 6000 } = {}) {
  return page.evaluate(
    async ({ goal, tolerance, waitMs }) => {
      const read = () => {
        const fn = window.__routeWorldProbe;
        return typeof fn === 'function' ? fn() : null;
      };
      const tick = () =>
        new Promise((resolveTick) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolveTick();
          };
          requestAnimationFrame(finish);
          setTimeout(finish, 32);
        });
      let lo = 0;
      let hi = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      let best = { y: window.scrollY, err: Infinity };
      for (let step = 0; step < 32; step += 1) {
        const mid = Math.round((lo + hi) / 2);
        window.scrollTo(0, mid);
        await tick();
        await tick();
        const body = read();
        if (!body || typeof body.exact !== 'number') continue;
        const err = Math.abs(body.exact - goal);
        if (err < best.err) best = { y: mid, err };
        if (err < tolerance) break;
        if (body.exact < goal) lo = mid;
        else hi = mid;
        if (hi - lo <= 1) break;
      }
      window.scrollTo(0, best.y);
      const started = performance.now();
      let body = read();
      while (performance.now() - started < waitMs) {
        await tick();
        body = read();
        if (body && typeof body.smooth === 'number' && Math.abs(body.smooth - body.exact) < 0.002) break;
      }
      return { exact: body?.exact ?? null, smooth: body?.smooth ?? null, nearest: body?.nearest ?? null, scrollY: window.scrollY, err: best.err };
    },
    { goal: target, tolerance: tol, waitMs: settleMs },
  );
}

/**
 * --sweep dither: for each park target (k + 0.5 ± 0.08 — inside the 0.15
 * latch band around the crossing midpoint), park, arm the recorder, then
 * wheel ±`stepPx` alternately `cycles` times (`waitMs` apart) and record
 * until `settleMs` after the last step. Verdict per park: zero nearest /
 * chip / key-light changes while dithering (ditherVerdict).
 */
export async function runDither(page, { k, offsets = [0.08, -0.08], cycles = 20, stepPx = 40, waitMs = 90, settleMs = 1200, band = 0.15 }) {
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
  const parks = [];
  for (const offset of offsets) {
    const target = k + 0.5 + offset;
    const parked = await parkAt(page, target);
    await armRecorder(page);
    // Alternate starting AWAY from the midpoint so the oscillation straddles
    // the park without walking toward the .5 boundary first.
    const first = offset > 0 ? 1 : -1;
    for (let i = 0; i < cycles * 2; i += 1) {
      await page.mouse.wheel(0, (i % 2 === 0 ? first : -first) * stepPx);
      await page.waitForTimeout(waitMs);
    }
    await page.waitForTimeout(settleMs);
    const frames = await stopRecorder(page);
    const lo = +(k + 0.5 - band).toFixed(3);
    const hi = +(k + 0.5 + band).toFixed(3);
    parks.push({ target, parked, frames, analysis: ditherVerdict(frames, { band: [lo, hi] }) });
  }
  return parks;
}

/**
 * --sweep panel: one subject pair per run. Cycles: focus A → wait for the
 * docked panel → release → wait for it to close, `cycles` times; then A open,
 * focus B while A is open (the cross-blend), release. The recorder runs across
 * all of it. `subjects` = [A, B] (B may be null: no cross-blend leg).
 */
export async function runPanelCycles(page, { subjects, cycles = 3, openWaitMs = 12_000, holdMs = 700 }) {
  const [a, b] = subjects;
  const waitPanel = async (open) => {
    try {
      if (open) await page.locator('.world-focus-panel[open]').first().waitFor({ state: 'visible', timeout: openWaitMs });
      else await page.waitForFunction(() => !document.querySelector('.world-focus-panel[open]'), null, { timeout: openWaitMs });
      return true;
    } catch {
      return false;
    }
  };
  const focus = (id) => page.evaluate((subject) => Boolean(window.__routeWorldFocus?.focus(subject)), id);
  const release = () => page.evaluate(() => window.__routeWorldFocus?.release());
  const log = [];
  await armRecorder(page);
  for (let i = 0; i < cycles; i += 1) {
    const focused = await focus(a);
    const opened = focused && (await waitPanel(true));
    await page.waitForTimeout(holdMs);
    await release();
    const closed = await waitPanel(false);
    await page.waitForTimeout(holdMs);
    log.push({ cycle: i, subject: a, focused, opened, closed });
  }
  let cross = null;
  if (b) {
    const focusedA = await focus(a);
    const openedA = focusedA && (await waitPanel(true));
    await page.waitForTimeout(holdMs);
    const tapAt = await page.evaluate(() => performance.now());
    const focusedB = await focus(b);
    await page.waitForTimeout(Math.max(holdMs, 1500));
    const stillOpen = await page.evaluate(() => Boolean(document.querySelector('.world-focus-panel[open]')));
    await release();
    const closed = await waitPanel(false);
    await page.waitForTimeout(holdMs);
    cross = { a, b, focusedA, openedA, tapAt, focusedB, stillOpen, closed };
  }
  const frames = await stopRecorder(page);
  return { frames, log, cross };
}

/**
 * Pick focus subjects whose panel uses `param` (e.g. team): tries registered
 * subjects in order (preferring ids matching `hint`), focusing each until the
 * bridge reports the panel param, releasing in between. Bounded by `limit`.
 */
export async function pickPanelSubjects(page, { param, hint = null, want = 2, limit = 10, waitMs = 4000 }) {
  const ids = await page.evaluate(() => window.__routeWorldFocus?.subjects() ?? []);
  const ordered = hint ? [...ids.filter((id) => hint.test(id)), ...ids.filter((id) => !hint.test(id))] : ids;
  const picked = [];
  let tried = 0;
  for (const id of ordered) {
    if (picked.length >= want || tried >= limit) break;
    tried += 1;
    const state = await page.evaluate(
      async ({ subject, ms }) => {
        const bridge = window.__routeWorldFocus;
        if (!bridge || !bridge.focus(subject)) return null;
        const started = performance.now();
        let s = bridge.state();
        while (performance.now() - started < ms) {
          s = bridge.state();
          if (s.id === subject && s.panel) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        bridge.release();
        return s;
      },
      { subject: id, ms: waitMs },
    );
    if (state && state.panel && state.panel.param === param) picked.push(id);
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => !document.querySelector('.world-focus-panel[open]'), null, { timeout: 8000 }).catch(() => {});
  return { picked, candidates: ids.length, tried };
}

/**
 * --flip-probe: read the page's station context BEFORE and AFTER the
 * Lite → route flip without touching the scroll in between. `before` must be
 * taken while the page is still Lite (preLive=false) for the probe to count.
 * Reads: which section sits at the conductor's activation line (0.35 ×
 * innerHeight), the WorldNav / any aria-current chip, scrollY, doc height.
 */
export async function readFlipContext(page) {
  return page.evaluate(() => {
    const live = document.documentElement.classList.contains('world-route-live');
    const sections = [...document.querySelectorAll('section[id]')].filter((s) => ['pulse', 'roster', 'teams', 'schedule', 'rules'].includes(s.id));
    const line = window.innerHeight * 0.35;
    let at = null;
    for (const s of sections) if (s.getBoundingClientRect().top <= line) at = s.id;
    const hud = document.querySelector('.world-nav-hud-track a[aria-current="true"]');
    const any = [...document.querySelectorAll('a[aria-current="true"]')].map((a) => a.getAttribute('href'));
    return {
      t: performance.now(),
      live,
      at,
      hudChip: hud ? hud.getAttribute('href') : null,
      currentLinks: any,
      scrollY: Math.round(window.scrollY),
      docHeight: document.documentElement.scrollHeight,
    };
  });
}

/** Flip-probe verdict: the station at the activation line and the active chip survive the flip. */
export function flipVerdict(before, after) {
  const reasons = [];
  if (!before || !after) return { verdict: 'unmeasured', reasons: ['missing read'] };
  if (before.live) return { verdict: 'unmeasured', reasons: ['page was already route-live before the scroll — no Lite→route flip observed'] };
  if (!after.live) return { verdict: 'unmeasured', reasons: ['world-route-live never set — no flip to judge'] };
  if (before.at !== after.at) reasons.push(`section at the activation line changed ${before.at} -> ${after.at}`);
  const chipBefore = before.hudChip ?? before.currentLinks.find((h) => h && h.startsWith('#')) ?? null;
  const chipAfter = after.hudChip ?? after.currentLinks.find((h) => h && h.startsWith('#')) ?? null;
  if (chipBefore !== null && chipAfter !== chipBefore) reasons.push(`active chip changed ${chipBefore} -> ${chipAfter}`);
  if (chipBefore === null && chipAfter !== null && chipAfter !== `#${before.at}`) reasons.push(`active chip after the flip (${chipAfter}) is not the pre-flip section #${before.at}`);
  return { verdict: reasons.length === 0 ? 'pass' : 'fail', reasons, chipBefore, chipAfter };
}

/**
 * Luma stddev of each composited screencast frame (32×32 greyscale
 * downsample) for frames whose t falls inside [from, to]. `frames` =
 * [{ t, data }] (encoded JPEG buffers).
 */
export async function compositeSpreads(frames, { from, to, size = 32, excludeBottomPx = 0 }) {
  const out = [];
  for (const frame of frames) {
    const at = typeof frame.tCapture === 'number' ? frame.tCapture : frame.t;
    if (at === null || at < from || at > to) continue;
    const stamp = typeof frame.tCapture === 'number' ? { tCapture: frame.tCapture } : {};
    try {
      // Round 3: the harness timecode strip (bottom rows) is cut away first,
      // so it can never make a blank page read as "not blank".
      let image = sharp(frame.data);
      if (excludeBottomPx > 0) {
        const meta = await sharp(frame.data).metadata();
        if (meta.width && meta.height && meta.height > excludeBottomPx + 8) {
          image = sharp(frame.data).extract({ left: 0, top: 0, width: meta.width, height: meta.height - excludeBottomPx });
          image = sharp(await image.png().toBuffer());
        }
      }
      const { data } = await image.greyscale().resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      let sumSq = 0;
      for (const v of data) {
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / data.length;
      out.push({ t: frame.t, ...stamp, mean: +mean.toFixed(2), spread: +Math.sqrt(Math.max(0, sumSq / data.length - mean * mean)).toFixed(2) });
    } catch (err) {
      out.push({ t: frame.t, ...stamp, mean: null, spread: null, error: String(err instanceof Error ? err.message : err) });
    }
  }
  return out;
}

/**
 * Wait for the loader trace to have seen the reveal (route live and the ball
 * gone for `quietMs`) or give up at `timeoutMs` after navigation start, then
 * stop the recorder and return its merged trace.
 */
export async function finishLoaderTrace(page, { timeoutMs = 18_000, quietMs = 1500, pollMs = 250 } = {}) {
  let quietSince = null;
  for (;;) {
    const status = await page.evaluate(() => {
      const trace = window.__captureLoaderTrace;
      return trace ? trace.status() : null;
    });
    if (!status) return { ok: false, reason: 'recorder-missing (addInitScript did not run)' };
    const settled = status.last && status.last.routeLive && !status.last.ballVisible;
    if (settled) quietSince = quietSince ?? status.now;
    else quietSince = null;
    if (!status.active) break;
    if (quietSince !== null && status.now - quietSince >= quietMs) break;
    if (status.now >= timeoutMs) break;
    await page.waitForTimeout(pollMs);
  }
  const dump = await page.evaluate(() => {
    const trace = window.__captureLoaderTrace;
    trace.stop();
    const out = trace.dump();
    // Round 5: whether three's per-program shader check ran in this trace
    // (EvidenceBridges, debug sessions; null = bridge absent).
    let glDebug = null;
    try {
      glDebug = typeof window.__routeWorldGlDebug === 'function' ? window.__routeWorldGlDebug() : null;
    } catch {
      glDebug = null;
    }
    // Wave 2 (2H, residual 4): the product's own logs, read once at the end —
    // ball / scene phase changes (a single-commit phase between two rAF
    // samples is still there), the wobble log with each rock's real
    // Animation.startTime, the milestone stamps and the last fault.
    let readiness = null;
    try {
      const r = typeof window.__routeWorldReadiness === 'function' ? window.__routeWorldReadiness() : null;
      readiness = r
        ? JSON.parse(
            JSON.stringify({
              ballTrace: r.ballTrace ?? null,
              phaseTrace: r.phaseTrace ?? null,
              wobbleTrace: r.wobbleTrace ?? null,
              milestones: r.milestones ?? null,
              lastFault: r.lastFault ?? null,
              // LOOK r2: the warm-stage log, the load signals and the stall
              // target (the stall detector's evidence).
              warmTrace: r.warmTrace ?? null,
              loadSignals: r.loadSignals ?? null,
              stallAt: typeof r.stallAt === 'number' ? r.stallAt : null,
              programsWarm: r.programsWarm ?? null,
              generation: r.generation ?? null,
              generationBegunAt: r.generationBegunAt ?? null,
              armedAt: r.armedAt ?? null,
              liveAt: r.liveAt ?? null,
            }),
          )
        : null;
    } catch {
      readiness = null;
    }
    // The ceremony animation audit (installCeremonyAnimationAudit), when armed.
    let ceremonyAnimations = null;
    try {
      ceremonyAnimations = window.__captureCeremonyAnimations ? window.__captureCeremonyAnimations.dump() : null;
    } catch {
      ceremonyAnimations = null;
    }
    return { ...out, glDebug, readiness, ceremonyAnimations };
  });
  return {
    ok: true,
    glDebug: dump.glDebug ?? null,
    merged: mergeLoaderTrace(dump.samples, dump.pixels),
    pixelPause: dump.pixelPause ?? null,
    ballTextIntersections: dump.ballTextIntersections ?? null,
    pixelReads: dump.pixels.length,
    pixelErrors: dump.pixels.filter((p) => p.error).length,
    readinessBridge: dump.readinessBridge,
    timeOrigin: dump.timeOrigin,
    // Wave 2 (2H).
    readiness: dump.readiness ?? null,
    // LOOK r2: the last readiness read per scene generation (recorder).
    attempts: dump.attempts ?? null,
    ceremonyAnimations: dump.ceremonyAnimations ?? null,
  };
}

/**
 * Montage frames into one labelled strip with sharp. `framePaths` entries are
 * file paths or encoded image Buffers (the --loader-film JPEG frames); sharp
 * reads both, so the --frames strip output is unchanged.
 */
export async function writeStrip(framePaths, outPath, labels = [], { crop = null, thumbW = null, maxCols = null } = {}) {
  if (framePaths.length === 0) return null;
  const meta = await sharp(framePaths[0]).metadata();
  // Round 3 --strip-crop: a region of every frame (image px), clamped to the
  // frame; the thumbnails keep the crop's own aspect.
  let region = null;
  if (crop && meta.width && meta.height) {
    const left = Math.min(Math.max(0, crop.x), meta.width - 1);
    const top = Math.min(Math.max(0, crop.y), meta.height - 1);
    region = { left, top, width: Math.max(1, Math.min(crop.w, meta.width - left)), height: Math.max(1, Math.min(crop.h, meta.height - top)) };
  }
  const layout = stripLayout({
    count: framePaths.length,
    frameW: region ? region.width : meta.width ?? 1,
    frameH: region ? region.height : meta.height ?? 1,
    ...(region ? { thumbW: Math.min(480, Math.max(160, region.width)) } : typeof thumbW === 'number' ? { thumbW } : {}),
    // LOOK r2: callers may cap the columns (the sweep film's 480 px cells).
    ...(typeof maxCols === 'number' ? { maxCols } : {}),
  });
  const layers = [];
  for (let i = 0; i < framePaths.length; i += 1) {
    const cell = layout.cells[i];
    const source = region ? sharp(framePaths[i]).extract(region) : sharp(framePaths[i]);
    const thumb = await source.resize(layout.thumbW, layout.thumbH, { fit: 'fill' }).png().toBuffer();
    layers.push({ input: thumb, left: cell.left, top: cell.top });
    const text = String(labels[i] ?? `f${i}`).replace(/[<>&"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.thumbW}" height="${layout.labelH}"><text x="4" y="${layout.labelH - 5}" font-family="sans-serif" font-size="12" fill="#e8e8e8">${text}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: cell.left, top: cell.labelTop });
  }
  await sharp({
    create: { width: layout.width, height: layout.height, channels: 3, background: { r: 18, g: 18, b: 22 } },
  })
    .composite(layers)
    .png()
    .toFile(outPath);
  return layout;
}

// ---------------------------------------------------------------------------
// Wave 2 round 2: arrival burst (W1 breathe / TEAMS roll call / card enter)
// ---------------------------------------------------------------------------

/**
 * Arm an in-page, rAF-clocked sampler with a FIXED cadence (default 200 ms):
 * on the first rAF at or after each tick it records the conductor probe, the
 * Station Card state, the 2C hover / breathe overlay, the HoloBeam stage, the
 * roll-call bridge (`window.__routeWorldRollCall`, when the page publishes
 * it) and a downscaled thumbnail of the world canvas (drawImage in the same
 * frame the renderer drew, so no present pipeline, PNG encode or occlusion
 * work runs per sample). A thumbnail read that comes back blank (the drawing
 * buffer was already cleared) is flagged `canvasBlank`, never passed off as a
 * frame. Stop and read with dumpArrivalBurst().
 */
export async function armArrivalBurst(page, { intervalMs = 200, thumbW = 320, maxSamples = 120 } = {}) {
  return page.evaluate(
    ({ every, tw, cap }) => {
      const prev = window.__captureBurst;
      if (prev) prev.stop();
      const samples = [];
      const thumbs = [];
      const state = { active: true, next: performance.now(), frames: 0 };
      const findCanvas = () => document.querySelector('[data-route-canvas] canvas') || document.querySelector('canvas');
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1 ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null;
      };
      const opacityOf = (el) => {
        let o = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === 'none' || s.visibility === 'hidden') return 0;
          o *= Number.parseFloat(s.opacity || '1');
        }
        return +o.toFixed(3);
      };
      const clone = (v) => {
        try {
          return v === undefined ? null : JSON.parse(JSON.stringify(v));
        } catch {
          return null;
        }
      };
      const tick = (now) => {
        if (!state.active) return;
        requestAnimationFrame(tick);
        state.frames += 1;
        if (now < state.next || samples.length >= cap) return;
        // Fixed cadence: the next tick is planned from the previous plan, so
        // a slow frame shortens the next gap instead of drifting the clock.
        state.next = Math.max(state.next + every, now - every / 2);
        const probeFn = window.__routeWorldProbe;
        let body = null;
        try {
          body = typeof probeFn === 'function' ? probeFn() : null;
        } catch {
          body = null;
        }
        const num = (k) => (body && typeof body[k] === 'number' && Number.isFinite(body[k]) ? +body[k].toFixed(4) : null);
        const card = document.querySelector('[data-station-caption]');
        const hover = document.querySelector('[data-focus-hover]');
        const bracketsEl = hover ? (hover.children[0] ?? null) : null;
        const beam = document.querySelector('[data-holo-beam]');
        const rc = window.__routeWorldRollCall;
        let rollCall = null;
        try {
          rollCall = clone(typeof rc === 'function' ? rc() : rc);
        } catch {
          rollCall = { error: 'threw' };
        }
        // Per-sample the bridge's small state only; its bulky per-column
        // fit records ride once, as the last full snapshot in the dump.
        if (rollCall && typeof rollCall === 'object' && 'fits' in rollCall) {
          state.rollCallFull = rollCall;
          const { fits: _fits, ...small } = rollCall;
          rollCall = small;
        }
        let thumbIndex = null;
        let canvasBlank = null;
        const canvas = findCanvas();
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const th = Math.max(1, Math.round((tw * canvas.height) / canvas.width));
          const c2 = document.createElement('canvas');
          c2.width = tw;
          c2.height = th;
          const ctx = c2.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(canvas, 0, 0, tw, th);
            const px = ctx.getImageData(0, 0, tw, th).data;
            let lit = 0;
            for (let i = 0; i < px.length; i += 4 * 97) if (px[i + 3] > 0 && px[i] + px[i + 1] + px[i + 2] > 6) lit += 1;
            canvasBlank = lit === 0;
            thumbIndex = thumbs.length;
            thumbs.push(c2);
          }
        }
        samples.push({
          t: +now.toFixed(1),
          rafFrames: state.frames,
          smooth: num('smooth'),
          exact: num('exact'),
          direction: num('direction'),
          settled: body && typeof body.settled === 'boolean' ? body.settled : null,
          skip: body && body.skip && typeof body.skip === 'object' ? clone(body.skip) : null,
          chip: document.querySelector('.world-nav-hud-track a[aria-current="true"]')?.getAttribute('href') ?? null,
          card: card
            ? {
                station: card.getAttribute('data-station'),
                state: card.getAttribute('data-card-state'),
                edge: card.getAttribute('data-edge'),
                direction: card.getAttribute('data-direction'),
                opacity: opacityOf(card),
                rect: box(card),
              }
            : null,
          hover: hover
            ? {
                mode: hover.getAttribute('data-mode'),
                target: hover.getAttribute('data-target') || null,
                visible: hover.getAttribute('data-visible') === 'true',
                brackets: box(bracketsEl),
                bracketsOpacity: bracketsEl ? opacityOf(bracketsEl.firstElementChild || bracketsEl) : null,
                bracketsTransform: bracketsEl?.firstElementChild ? getComputedStyle(bracketsEl.firstElementChild).transform : null,
              }
            : null,
          beam: beam ? beam.getAttribute('data-stage') : null,
          rollCall,
          thumbIndex,
          canvasBlank,
        });
      };
      requestAnimationFrame(tick);
      window.__captureBurst = {
        stop: () => {
          state.active = false;
        },
        dump: () => ({
          samples,
          rollCallFull: state.rollCallFull ?? null,
          thumbs: thumbs.map((c) => c.toDataURL('image/jpeg', 0.82)),
        }),
      };
      return { ok: true, t: performance.now() };
    },
    { every: intervalMs, tw: thumbW, cap: maxSamples },
  );
}

/** Stop the arrival burst and return its samples plus JPEG data-URL thumbnails. */
export async function dumpArrivalBurst(page) {
  return page.evaluate(() => {
    const b = window.__captureBurst;
    if (!b) return { samples: [], thumbs: [] };
    b.stop();
    return b.dump();
  });
}

/**
 * Pure: summarize an arrival burst. `clickT` = page time of the nav-chip
 * click (null = no click). Reports the real cadence (median / p95 / max gap,
 * so a 200 ms claim is checkable), when the target was landed and settled,
 * when the card reached `enter` at >= 0.99, the breathe window (hover overlay
 * in `breathe` mode AND visible), and the roll-call bridge's last snapshot.
 * Breathe is `absent` when no sample shows it; `unmeasured` when the overlay
 * was never mounted (it mounts only on the live route).
 */
export function summarizeArrivalBurst(samples, { clickT = null, intervalMs = 200, target = null } = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].t - rows[i - 1].t);
  const sorted = [...gaps].sort((a, b) => a - b);
  const pick = (q) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1) : null);
  const rel = (t) => (t === null || t === undefined ? null : clickT === null ? +t.toFixed(1) : +(t - clickT).toFixed(1));
  const after = clickT === null ? rows : rows.filter((r) => r.t >= clickT);
  const targetHref = target ? `#${target}` : null;
  const onTarget = (r) => (targetHref ? r.chip === targetHref : true);
  const landed = after.find(
    (r) => onTarget(r) && typeof r.smooth === 'number' && typeof r.exact === 'number' && Math.abs(r.smooth - r.exact) < 0.01 && !(r.skip && r.skip.active),
  );
  // The camera reaches the target pose (smooth == exact) up to ~1.6 s before
  // the skip gate releases (its influence decays after arrival): landedAt is
  // the gate release, poseReachedAt the pose itself (live probe 2026-09-27:
  // pose +1204 ms, gate +2806 ms, roll-call first column +1638 ms).
  const poseReached = after.find((r) => onTarget(r) && typeof r.smooth === 'number' && typeof r.exact === 'number' && Math.abs(r.smooth - r.exact) < 0.01);
  const settled = after.find((r) => r.settled === true && onTarget(r));
  const cardIn = after.find((r) => r.card && r.card.state === 'enter' && r.card.opacity >= 0.99 && (!target || r.card.station === target));
  const mounted = rows.some((r) => r.hover !== null && r.hover !== undefined);
  const breathing = after.filter((r) => r.hover && r.hover.mode === 'breathe' && r.hover.visible);
  const breathe = !mounted
    ? { verdict: 'unmeasured', reason: 'hover overlay never mounted ([data-focus-hover]; needs the live route)' }
    : breathing.length === 0
      ? { verdict: 'absent', reason: 'no sample shows the overlay in breathe mode and visible' }
      : {
          verdict: 'seen',
          target: breathing[0].hover.target,
          firstAt: rel(breathing[0].t),
          lastAt: rel(breathing[breathing.length - 1].t),
          spanMs: +(breathing[breathing.length - 1].t - breathing[0].t).toFixed(1),
          samples: breathing.length,
          afterSettleMs: settled ? +(breathing[0].t - settled.t).toFixed(1) : null,
        };
  const lastRc = [...rows].reverse().find((r) => r.rollCall && !r.rollCall.error) ?? null;
  // Roll-call stagger: the first sample each ledger column shows a light
  // state other than its first-seen (rest) state, relative to the click.
  // Resolution is the sampling interval; spacingMs = the median step
  // between consecutive columns' first-lit samples (a 140 ms stagger reads
  // as alternating 1- and 2-column steps at 200 ms).
  let stagger = null;
  const lit = rows.filter((r) => r.rollCall && Array.isArray(r.rollCall.lights));
  if (lit.length > 0) {
    const restState = lit[0].rollCall.lights.map((l) => l);
    const cols = restState.length;
    const firstLit = Array.from({ length: cols }, (_, i) => {
      const hit = lit.find((r) => r.rollCall.lights[i] !== restState[i]);
      return hit ? rel(hit.t) : null;
    });
    const seen = firstLit.filter((v) => v !== null);
    const leftToRight = seen.every((v, i) => i === 0 || v >= seen[i - 1]);
    const arrivals = [...new Set(lit.map((r) => r.rollCall.arrivals).filter((a) => typeof a === 'number'))];
    const span = seen.length > 1 ? +(seen[seen.length - 1] - seen[0]).toFixed(1) : null;
    stagger = {
      columns: cols,
      restState: restState[0] ?? null,
      firstLitAt: firstLit,
      leftToRight,
      spanMs: span,
      perColumnMs: span !== null && seen.length > 1 ? +(span / (seen.length - 1)).toFixed(1) : null,
      arrivalsSeen: arrivals,
      resolutionMs: intervalMs,
    };
  }
  const p95 = pick(0.95);
  return {
    samples: rows.length,
    intervalMs,
    cadence: {
      medianMs: pick(0.5),
      p95Ms: p95,
      maxMs: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
      spanMs: rows.length > 1 ? +(rows[rows.length - 1].t - rows[0].t).toFixed(1) : 0,
    },
    cadenceOk: p95 !== null && p95 <= intervalMs * 1.6,
    clickAt: clickT === null ? null : 0,
    poseReachedAt: poseReached ? rel(poseReached.t) : null,
    landedAt: landed ? rel(landed.t) : null,
    settledAt: settled ? rel(settled.t) : null,
    cardEnterAt: cardIn ? rel(cardIn.t) : null,
    breathe,
    rollCall: lastRc
      ? { source: 'window.__routeWorldRollCall', last: lastRc.rollCall, stagger }
      : { source: null, reason: 'the page publishes no window.__routeWorldRollCall bridge (TEAMS)' },
    canvasBlankSamples: rows.filter((r) => r.canvasBlank === true).length,
  };
}

// ---------------------------------------------------------------------------
// Wave 2 round 3: roll-call verdict (TEAMS judge)
// ---------------------------------------------------------------------------

/** D16 roll-call schedule (src/lib/route-world/roll-call.ts; mirrored — the harness is plain JS). */
export const ROLL_CALL_SCHEDULE = { leadMs: 180, stepMs: 140, pulseMs: 420 };
/** One display frame of tolerance on the 140 ms step. */
export const ROLL_CALL_TOLERANCE_MS = 17;
/** The call window must hold at least this many samples to be judged. */
export const ROLL_CALL_MIN_SAMPLES = 8;

const LIGHT_RANK = { rest: 0, calling: 1, called: 2 };

/** The modelled light of column k at `elapsedMs` after the call started (pure mirror of rollCallLights). */
export function modelRollCallLight(k, elapsedMs, { leadMs, stepMs, pulseMs } = ROLL_CALL_SCHEDULE) {
  if (elapsedMs === null) return 'rest';
  const since = elapsedMs - (leadMs + k * stepMs);
  if (since < 0) return 'rest';
  return since < pulseMs ? 'calling' : 'called';
}

/**
 * Pure (TEAMS judge: "no evidence of the roll-call stagger or of its
 * once-per-arrival behaviour"): judge the roll call from burst samples that
 * carry `rollCall` { startedAt, arrivals, columns, lights[] } (the
 * __routeWorldRollCall bridge, read at every sample).
 *  - the call after the click: its startedAt S, columns n, window
 *    [S, S + lead + (n-1)·step + pulse] (1580 ms for 8 columns);
 *  - >= ROLL_CALL_MIN_SAMPLES samples inside, else `unmeasured`
 *    (insufficient-sampling);
 *  - every sampled light matches the D16 model at t − S within ± one frame
 *    (rest -> calling -> called, left to right, one column per 140 ms);
 *  - no column's light ever steps back while the call runs;
 *  - arrivals rises by exactly 1 at the arrival, and the ±40 px micro-scroll
 *    window (`microScroll` { fromT, toT }) neither re-arms the call (a new
 *    startedAt) nor changes arrivals.
 * Verdict: fail on any violation; else unmeasured when sampling is short;
 * else pass.
 */
export function rollCallVerdict(samples, { clickT = null, microScroll = null, schedule = ROLL_CALL_SCHEDULE, toleranceMs = ROLL_CALL_TOLERANCE_MS, minSamples = ROLL_CALL_MIN_SAMPLES } = {}) {
  const rows = (Array.isArray(samples) ? samples : []).filter((r) => r && typeof r.t === 'number' && r.rollCall && Array.isArray(r.rollCall.lights));
  if (rows.length === 0) return { verdict: 'unmeasured', reasons: ['no sample carries window.__routeWorldRollCall (debug-gated TEAMS bridge)'] };
  const before = clickT === null ? rows[0] : ([...rows].reverse().find((r) => r.t < clickT) ?? rows[0]);
  const arrivalsBefore = typeof before.rollCall.arrivals === 'number' ? before.rollCall.arrivals : null;
  const after = clickT === null ? rows : rows.filter((r) => r.t >= clickT);
  const call = after.find((r) => typeof r.rollCall.startedAt === 'number' && (clickT === null || r.rollCall.startedAt >= clickT - 1));
  const reasons = [];
  if (!call) {
    const settled = (Array.isArray(samples) ? samples : []).some((r) => r && (clickT === null || r.t >= clickT) && r.settled === true);
    return {
      verdict: settled ? 'fail' : 'unmeasured',
      arrivalsBefore,
      reasons: [settled ? 'the station settled but no roll call started after the arrival' : 'the arrival never settled inside the sample window'],
    };
  }
  const S = call.rollCall.startedAt;
  const n = typeof call.rollCall.columns === 'number' && call.rollCall.columns > 0 ? call.rollCall.columns : call.rollCall.lights.length;
  const doneMs = n <= 0 ? 0 : schedule.leadMs + (n - 1) * schedule.stepMs + schedule.pulseMs;
  const end = S + doneMs;
  const inside = rows.filter((r) => r.t >= S && r.t <= end);
  const judged = rows.filter((r) => r.t >= S && r.t <= end + 400 && r.rollCall.startedAt === S);
  const mismatches = [];
  for (const r of judged) {
    const e = r.t - S;
    r.rollCall.lights.forEach((light, k) => {
      const allowed = new Set([modelRollCallLight(k, e - toleranceMs, schedule), modelRollCallLight(k, e, schedule), modelRollCallLight(k, e + toleranceMs, schedule)]);
      if (!allowed.has(light)) mismatches.push({ t: +e.toFixed(1), column: k, observed: light, expected: modelRollCallLight(k, e, schedule) });
    });
  }
  const regressions = [];
  for (let k = 0; k < n; k += 1) {
    let rank = -1;
    for (const r of judged) {
      const cur = LIGHT_RANK[r.rollCall.lights[k]] ?? -1;
      if (cur < rank) regressions.push({ column: k, t: +(r.t - S).toFixed(1), from: rank, to: cur });
      rank = Math.max(rank, cur);
    }
  }
  // Per-column call brackets: (last rest sample, first lit sample].
  const brackets = Array.from({ length: n }, (_, k) => {
    let lastRest = null;
    let firstLit = null;
    for (const r of judged) {
      const e = +(r.t - S).toFixed(1);
      if (r.rollCall.lights[k] === 'rest') {
        if (firstLit === null) lastRest = e;
      } else if (firstLit === null) firstLit = e;
    }
    return { column: k, expectedMs: schedule.leadMs + k * schedule.stepMs, lastRestMs: lastRest, firstLitMs: firstLit };
  });
  const lit = brackets.filter((b) => b.firstLitMs !== null).map((b) => b.firstLitMs);
  const leftToRight = lit.every((v, i) => i === 0 || v >= lit[i - 1]);
  if (!leftToRight) reasons.push('columns lit out of left-to-right order');
  if (mismatches.length) reasons.push(`${mismatches.length} sampled light(s) off the D16 model (${schedule.stepMs} ms per column ± ${toleranceMs} ms)`);
  if (regressions.length) reasons.push(`${regressions.length} light regression(s) while the call ran`);
  // Once per arrival.
  const arrivalsAtCall = call.rollCall.arrivals;
  if (arrivalsBefore !== null && typeof arrivalsAtCall === 'number' && arrivalsAtCall !== arrivalsBefore + 1) reasons.push(`arrivals ${arrivalsBefore} -> ${arrivalsAtCall} at the arrival (expected +1)`);
  let micro = null;
  if (microScroll && typeof microScroll.fromT === 'number') {
    const win = rows.filter((r) => r.t >= microScroll.fromT && (typeof microScroll.toT !== 'number' || r.t <= microScroll.toT));
    const starts = [...new Set(win.map((r) => r.rollCall.startedAt).filter((v) => typeof v === 'number' && v !== S))];
    const arrivals = [...new Set(win.map((r) => r.rollCall.arrivals).filter((v) => typeof v === 'number'))];
    micro = { samples: win.length, newStarts: starts.length, arrivalsSeen: arrivals, arrivalsHeld: arrivals.length > 0 && arrivals.every((a) => a === arrivalsAtCall) };
    if (win.length === 0) reasons.push('no sample inside the micro-scroll window');
    if (starts.length) reasons.push(`the ±40 px micro-scroll re-armed the call (${starts.length} new startedAt)`);
    if (arrivals.some((a) => a !== arrivalsAtCall)) reasons.push(`arrivals changed during the micro-scroll (${arrivals.join(', ')}; call had ${arrivalsAtCall})`);
  }
  const fail = reasons.length > 0;
  const short = inside.length < minSamples;
  return {
    verdict: fail ? 'fail' : short ? 'unmeasured' : 'pass',
    ...(short && !fail ? { unmeasuredReason: 'insufficient-sampling' } : {}),
    rule: `lights rest -> calling -> called, left to right, one column per ${schedule.stepMs} ms ± ${toleranceMs} ms (lead ${schedule.leadMs}, pulse ${schedule.pulseMs}); arrivals +1 per arrival; a ±40 px micro-scroll never re-arms`,
    startedAt: +S.toFixed(1),
    startedAfterClickMs: clickT === null ? null : +(S - clickT).toFixed(1),
    columns: n,
    windowMs: doneMs,
    samplesInWindow: inside.length,
    minSamples,
    arrivalsBefore,
    arrivalsAtCall: typeof arrivalsAtCall === 'number' ? arrivalsAtCall : null,
    microScroll: micro,
    leftToRight,
    brackets,
    mismatches: mismatches.slice(0, 24),
    regressions: regressions.slice(0, 24),
    reasons: short && !fail ? [`only ${inside.length} sample(s) inside the ${doneMs} ms call window (< ${minSamples})`] : reasons,
  };
}

// ---------------------------------------------------------------------------
// Wave 2 round 2: W6 skip-through window mounts + Station Card edges
// ---------------------------------------------------------------------------

/**
 * Pure (W6 judge: "suppression of intermediate window mounts is inferred
 * from gaps, not measured"): from recorder frames carrying `windows`
 * (key -> [entered, resident, skipGate, station]), every window that turns
 * entered or resident false -> true between the click (`clickT`) and the
 * landing (`landedT`, else the last frame). A transition of a window whose
 * station is not the jump's target (`toIndex`) is a violation: a
 * skip-through must not mount the windows it passes through. The target's
 * own mounts are listed as `targetMounts` (allowed). `unmeasured` when no
 * frame carries the map (worlds without __c089Windows).
 */
export function skipWindowMountVerdict(frames, { clickT, landedT = null, toIndex }) {
  const rows = (Array.isArray(frames) ? frames : []).filter((f) => f && typeof f.t === 'number');
  const withMap = rows.filter((f) => f.windows && typeof f.windows === 'object');
  if (withMap.length === 0) return { verdict: 'unmeasured', reasons: ['no frame carries window.__c089Windows (plaza-only bridge)'] };
  const end = typeof landedT === 'number' ? landedT : rows[rows.length - 1].t;
  const before = [...withMap].reverse().find((f) => f.t <= clickT) ?? withMap[0];
  const prev = new Map(Object.entries(before.windows));
  const violations = [];
  const targetMounts = [];
  for (const f of withMap) {
    if (f.t <= clickT || f.t > end) continue;
    for (const [key, w] of Object.entries(f.windows)) {
      const p = prev.get(key) ?? [0, 0, null, w[3]];
      for (const [slot, name] of [
        [0, 'entered'],
        [1, 'resident'],
      ]) {
        if (p[slot] === 0 && w[slot] === 1) {
          const row = { key, field: name, t: +(f.t - clickT).toFixed(1), station: w[3], skipGate: w[2], smooth: typeof f.smooth === 'number' ? f.smooth : null };
          if (w[3] === toIndex) targetMounts.push(row);
          else violations.push(row);
        }
      }
      prev.set(key, w);
    }
  }
  return {
    verdict: violations.length > 0 ? 'fail' : 'pass',
    rule: 'between the chip click and the landing, no station window other than the target turns entered / resident false -> true',
    window: { fromMs: 0, toMs: +(end - clickT).toFixed(1) },
    violations,
    targetMounts,
    framesWithMap: withMap.length,
    reasons: violations.map((v) => `${v.key} (station ${v.station}, gate ${v.skipGate}) ${v.field} at +${v.t} ms, smooth ${v.smooth}`),
  };
}

/**
 * Pure (W6 judge: assert the card edge explicitly, not from y): over recorder
 * frames carrying `caption` { station, state, edge, travel, direction }, each
 * new card (a station change in `enter`) must enter from the edge opposite
 * the travel: a forward step (higher station index) enters from `bottom`, a
 * backward step from `top`. Each exit must leave the way the world moves:
 * forward travel (`data-travel` > 0, else direction > 0) exits `top`,
 * backward `bottom`. `flips` = edge changes within one card episode (same
 * station, same state). `stationIds` maps data-station to an index.
 */
export function cardEdgeVerdict(frames, { stationIds = STATION_IDS } = {}) {
  const rows = (Array.isArray(frames) ? frames : []).filter((f) => f && f.caption && typeof f.caption.state === 'string');
  if (rows.length === 0) return { verdict: 'unmeasured', reasons: ['no frame carries the Station Card state'] };
  const entries = [];
  const exits = [];
  let flips = 0;
  let last = null;
  let lastShownStation = null;
  for (const f of rows) {
    const c = f.caption;
    const episode = `${c.station}|${c.state}`;
    if (last && last.episode === episode && last.edge !== c.edge) flips += 1;
    if (!last || last.episode !== episode) {
      if (c.state === 'enter') {
        const from = stationIds.indexOf(lastShownStation);
        const to = stationIds.indexOf(c.station);
        if (from !== -1 && to !== -1 && from !== to) {
          const expected = to > from ? 'bottom' : 'top';
          entries.push({ t: f.t, from: lastShownStation, to: c.station, edge: c.edge, expected, ok: c.edge === expected });
        }
        lastShownStation = c.station;
      } else if (c.state === 'exit') {
        const travel = Number.parseFloat(c.travel ?? '');
        const dir = Number.isFinite(travel) && travel !== 0 ? travel : Number.parseFloat(c.direction ?? '');
        const expected = Number.isFinite(dir) && dir !== 0 ? (dir > 0 ? 'top' : 'bottom') : null;
        exits.push({ t: f.t, station: c.station, edge: c.edge, travel: c.travel ?? null, direction: c.direction ?? null, expected, ok: expected === null ? null : c.edge === expected });
      }
    }
    last = { episode, edge: c.edge };
  }
  const bad = [...entries.filter((e) => !e.ok), ...exits.filter((e) => e.ok === false)];
  return {
    verdict: bad.length > 0 || flips > 0 ? 'fail' : entries.length + exits.length === 0 ? 'unmeasured' : 'pass',
    rule: 'enter: forward step from bottom, backward from top; exit: forward travel leaves top, backward bottom; no edge flip within an episode',
    entries,
    exits,
    flips,
    reasons: [...bad.map((e) => `${'to' in e ? `enter ${e.from}->${e.to}` : `exit ${e.station}`} edge ${e.edge} (expected ${e.expected}) at ${e.t}`), ...(flips ? [`${flips} edge flip(s) within an episode`] : [])],
  };
}
