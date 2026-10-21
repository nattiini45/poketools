'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useScrollConductor, type RouteConductor } from './useScrollConductor';
import {
  readCapabilities,
  REDUCED_MOTION_QUERY,
  resolveTierDecision,
  type LiteReason,
  type RouteTier,
  type TierDecision,
  type UrlTierOverride,
  type ViewerCapabilities,
} from '@/lib/route-world/quality';
import { DEFAULT_WORLD_EXPERIENCE, type WorldExperience } from '@/types/player';
import {
  createWorldStateSampler,
  type StationWorldState,
  type WorldStateSampler,
} from '@/lib/route-world/chapters';
import {
  FALLBACK_PALETTE,
  isNight,
  readWorldPalette,
  samePalette,
  type WorldPalette,
} from '@/lib/route-world/palette';
import { resolveRouteTheme, type AnyRouteTheme } from '@/components/world/themes';
import { writeWorldOverride } from './world-override-store';
import {
  beginSceneGeneration,
  currentSceneGeneration,
  getGenerationBegunAt,
  getLastSceneFault,
  getPhaseChangedAt,
  getSceneFailure,
  getGenerationLog,
  getScenePhaseTrace,
  getScenePhase,
  getServerScenePhase,
  markSceneFailed,
  resetSceneReadiness,
  getReadyDeadlineMs,
  isReadyDeadlineRelaxed,
  subscribeScenePhase,
  type GenerationLogEntry,
  type SceneFault,
  type ScenePhase,
  type ScenePhaseEntry,
} from './world-readiness';
import {
  getBallPhase,
  getBallPhaseTrace,
  getAttemptLog,
  getCeremonyTrace,
  getLoadSignals,
  getProgramsWarmRelay,
  getRevealArmedAt,
  getSceneProgress,
  getWarmFrames,
  getWarmTrace,
  loadStallAt,
  loadStalled,
  noteRevealArmed,
  getServerSceneProgress,
  getWobbleTrace,
  scheduleAtWallClock,
  subscribeSceneProgress,
  type AttemptRecord,
  type BallPhaseEntry,
  type CeremonyTraceEntry,
  type SceneProgressSnapshot,
  type WarmFrameEntry,
  type WarmStageEntry,
  type WobbleTraceEntry,
} from './scene-progress';
import { revealArmLastAt, revealGate, type BallPhase } from '@/lib/route-world/ball-loader-state';
import { planPaletteSwap } from '@/lib/route-world/theme-veil';
import {
  abortThemeVeil,
  cancelThemeVeil,
  getThemeVeilPhase,
  getThemeVeilState,
  getThemeVeilTrace,
  noteThemeVeilCommitted,
  requestThemeVeil,
  runThemeSwapHooks,
} from './theme-veil-store';

/**
 * Shared state for a world: route progress, the resolved experience tier,
 * viewport class, and the palette read off the world's own CSS tokens.
 *
 * Lives above the canvas rather than inside it, because the DOM needs the
 * conductor whether or not the 3D ever mounts — the anchor nav reads the same
 * progress the camera does.
 */

/** Viewport width below which the mobile camera endpoints take over. */
const MOBILE_QUERY = '(max-width: 767px)';

/** The server, and the first client paint, always render Lite. */
const SERVER_TIER: TierDecision = { tier: 'lite', reason: null };

/**
 * Sentinel capabilities for the server snapshot. Identity-compared, never fed
 * through the resolver, so SSR output can never depend on the viewer
 * preference — the server render stays Lite-first exactly as before.
 */
const SERVER_CAPS: ViewerCapabilities = {
  saveData: false,
  reducedMotion: false,
  lowMemory: false,
  lowCores: false,
  hasWebGL: false,
};

/**
 * Capability detection is a property of the device, not of a render, so the
 * signals are cached at module scope — that also gives `useSyncExternalStore`
 * the referentially stable snapshot it requires. The tier DECISION is derived
 * per render by the pure `resolveTierDecision`, because it also depends on the
 * URL override and the viewer's persisted preference.
 */
let cachedCaps: ViewerCapabilities | null = null;

/** The explicit `?tier=` / `?routeDebug=1` debug/share override from the URL. */
function readUrlTierOverride(): UrlTierOverride {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tier') === 'lite') return 'lite';
  // Preview / debug must see the plaza even if the viewer opted out or a
  // prior probe cached limiting signals.
  if (params.get('tier') === 'route' || params.get('routeDebug') === '1') {
    return 'route';
  }
  return null;
}

function getNullTierOverride(): UrlTierOverride {
  return null;
}

function getCapabilities(): ViewerCapabilities {
  return (cachedCaps ??= readCapabilities());
}

function getServerCapabilities(): ViewerCapabilities {
  return SERVER_CAPS;
}

/**
 * Capability detection is re-run when a motion preference changes mid-session.
 *
 * The cached signals are correct for hardware, but `prefers-reduced-motion` is
 * a live OS/browser setting: a visitor who enables it while the world is
 * running must actually get Lite, and one who disables it should be allowed
 * back. Without this subscription the first detection would stand for the rest
 * of the page's life.
 */
function subscribeTier(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const handle = () => {
    cachedCaps = null;
    onChange();
  };
  query.addEventListener('change', handle);
  return () => query.removeEventListener('change', handle);
}

/** Values that cannot change without a navigation need no subscription. */
function subscribeStatic(): () => void {
  return () => {};
}

function subscribeViewport(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getDebug(): boolean {
  return new URLSearchParams(window.location.search).get('routeDebug') === '1';
}

/**
 * Observability WITHOUT tier forcing (review r3): `?routeTrace=1` exposes
 * the readiness trace (`__routeWorldReadiness`, which carries the ball phase)
 * but — unlike `routeDebug=1` — never sets the URL tier override, so the
 * natural tier decision (reduced motion → Lite, D12) can be evidenced. It
 * changes nothing else: no overlay, no deadline relaxation, no debug
 * bridges. `routeDebug=1` still implies it.
 */
function getTrace(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('routeTrace') === '1' || params.get('routeDebug') === '1';
}

function getFalse(): boolean {
  return false;
}

/** The server snapshot of the scene generation: no attempt has begun. */
function getServerSceneGeneration(): number {
  return 0;
}

/**
 * The reveal gate's per-generation latch (W7 / D3): when the gate armed for
 * `generation`, and whether the page handoff has happened since.
 */
interface RevealLatch {
  generation: number;
  armedAt: number;
  live: boolean;
  /** `performance.now()` of the handoff, null until live. */
  liveAt: number | null;
}

/** Read-only trace for the capture harness's `--loader-trace` recorder. */
interface ReadinessTrace {
  phase: ScenePhase;
  generation: number;
  phaseChangedAt: number;
  generationBegunAt: number;
  milestones: SceneProgressSnapshot;
  ball: BallPhase;
  /**
   * Time-stamped ball phase changes (bounded, oldest first) — the phase
   * trace a reveal-gate timeout sidecar records (review r4).
   */
  ballTrace: BallPhaseEntry[];
  /**
   * Review r5 (wobble / milestone alignment): every render where the
   * ball's shake or settled shake changed, plus the loader's
   * animationstart / animationend / animationcancel events.
   */
  wobbleTrace: WobbleTraceEntry[];
  /**
   * Wave 2 (compositor-driven ceremony): per reveal, the plan that ran
   * (full / short / quick, time scale, flight lead), the reveal commit, the
   * CSS timeline's real start, and every ceremony animation with the
   * properties it animates (transform / opacity only, by contract).
   */
  ceremony: CeremonyTraceEntry[];
  /**
   * Review r5: time-stamped scene phase changes (a `failed` that is reset
   * to `idle` by the Lite flip inside one task is still recorded) and the
   * last fault with its caller's reason (sticky) — why Lite appeared.
   */
  phaseTrace: ScenePhaseEntry[];
  /** R6: every generation bump — begin (key) or reset (reason) — bounded. */
  generationLog: GenerationLogEntry[];
  lastFault: SceneFault | null;
  /** Programs-warm relay (trace only since wave 2 — retired from the reveal gate). */
  programsWarm: boolean;
  /**
   * D23: the load warm's stage stamps (compile, shadows, textures, passes,
   * poses, frame, settle, done) — a long stage is visible, never faked.
   */
  warmTrace: WarmStageEntry[];
  /** D23: the stall detector's signal high-water marks for the current generation. */
  loadSignals: Record<string, number>;
  /** D23: when the current generation would count as stalled (null = not armed). */
  stallAt: number | null;
  /**
   * ENGINE r2: ended attempts (failed, or superseded by a newer generation)
   * with their final milestones, stall signals, stall point and warm stages —
   * the Lite flip resets the live fields above to a fresh generation.
   */
  attempts: AttemptRecord[];
  /** ENGINE r2: the load warm's per-frame log (stage, step ms, frame interval, programs, link cap). */
  warmFrames: WarmFrameEntry[];
  armed: boolean;
  live: boolean;
  /**
   * `performance.now()` when the reveal gate armed / handed over for the
   * current generation (null before). D23: the gate arms the moment the
   * world is complete, so a judge reads its lateness as `armedAt` minus the
   * latest of presented, the `assets` stamp, residency and `warmAt`.
   */
  armedAt: number | null;
  liveAt: number | null;
  /**
   * The readiness deadline in force for the current generation (ms) and
   * whether the DEBUG-ONLY capture relaxation (`?routeDebug=1&readyDeadlineMs=N`,
   * never in production) widened it past `SCENE_READY_TIMEOUT_MS`.
   */
  deadlineMs: number;
  deadlineRelaxed: boolean;
  /**
   * The tier in force and its Lite reason (review r3): with `?routeTrace=1`
   * (no tier forcing) the trace can evidence the reduced-motion Lite floor.
   */
  tier: RouteTier;
  liteReason: LiteReason | null;
  /** The two-phase handoff as written to <html> (`HideHtmlOnRoute`). */
  handoff: boolean;
  worldRouteLive: boolean;
}

type ReadinessHost = Window & {
  __routeWorldReadiness?: () => ReadinessTrace;
};

/** Sampler for worlds without a route theme — neutral channels. */
const EMPTY_SAMPLER: WorldStateSampler = createWorldStateSampler([]);

/**
 * Merge the theme's furniture palette over the token-derived core. Extension
 * keys win (plaza re-states the sky literal so one authored source owns it);
 * without a theme the core passes through untouched.
 */
/**
 * The key one scene generation is begun for: the route theme and the
 * palette's day/night side (ENGINE r3 — a day/night swap is a new
 * generation with its own ceremony). Exported for tests.
 */
export function sceneGenerationKey(themeId: string, nightKey: 'day' | 'night'): string {
  return `${themeId}:${nightKey}`;
}

function resolvePalette(core: WorldPalette, theme: AnyRouteTheme | null): WorldPalette {
  if (!theme) return core;
  return { ...core, ...theme.paletteExtension(core, isNight(core.exposure)) };
}

/** The day/night side of a resolved palette (the generation key's second half). */
function nightKeyOf(palette: WorldPalette): 'day' | 'night' {
  return isNight(palette.exposure) ? 'night' : 'day';
}

/**
 * What the (tier, theme, palette) effect does about the scene generation
 * (R6 E1). Exported for tests.
 */
export type GenerationBeginPlan = { action: 'reset' } | { action: 'begin'; key: string } | { action: 'none' };

/**
 * R6 E1 (CAR r5: dark loads revealed on generation 2). The effect that begins
 * the generation ran BEFORE the effect that reads the palette off the DOM,
 * and the palette STATE starts at the day fallback — so every dark load began
 * a `:day` generation (fetching the day HDRI), the palette read then flipped
 * it to `:night` and the visitor waited on a second generation.
 *
 * The key's day/night side is therefore read from the DOM at the effect
 * (`domNightKey`), never from the palette state. A key this provider already
 * began (`begunKey`) whose generation is still live (`phase` not idle) is not
 * begun again: the palette state catching up (the effect's `nightKey`
 * dependency) or the palette observer having begun the swap's generation
 * first are no-ops, so a load begins exactly one generation. An idle phase
 * (StrictMode's unmount reset, a Lite round trip) begins afresh. Pure.
 */
export function planGenerationBegin(input: {
  tier: RouteTier;
  themeId: string | null;
  domNightKey: 'day' | 'night';
  begunKey: string | null;
  phase: ScenePhase;
}): GenerationBeginPlan {
  if (input.tier !== 'route' || input.themeId === null) return { action: 'reset' };
  const key = sceneGenerationKey(input.themeId, input.domNightKey);
  if (input.begunKey === key && input.phase !== 'idle') return { action: 'none' };
  return { action: 'begin', key };
}

/** The shared world-state snapshot; exported for context re-provision (RouteScene fallback). */
export interface WorldStateValue {
  conductor: RouteConductor;
  /** Resolved on the client only; the server and first paint are always Lite. */
  tier: RouteTier;
  liteReason: LiteReason | null;
  /** Drop to Lite in place — used on WebGL context loss. */
  degradeToLite: (reason: LiteReason) => void;
  /**
   * Scene readiness handshake. The route tier commits the page (hides the
   * semantic paint) only on `'presented'` — never on capability detection
   * alone, which would leave a blank interval while the scene streams in.
   */
  scenePhase: ScenePhase;
  /** The current scene generation (read-only; the attempt key for the loader). */
  sceneGeneration: number;
  // ENGINE r2: the load milestones are NOT on the context. They change at
  // load rate (every loaded item), and a context change re-renders every
  // world-state consumer in the scene — hundreds of components, 0.4-1 s React
  // tasks per notification on dev, plus effect re-runs. The one reader (the
  // Pokéball) subscribes to `subscribeSceneProgress` itself.
  /**
   * The reveal gate armed for the current generation (D3, D23): `presented`
   * (witnessed, as below) AND assets idle AND every population resident AND
   * the load warm settled — no cap, no partial reveal. The loader's ceremony
   * starts here.
   */
  routeRevealArmed: boolean;
  /**
   * `performance.now()` at which the gate armed for the current generation,
   * null while not armed. The loader picks its ceremony plan from it (full,
   * time-scaled short, or the crossfade — `ceremonyPlan`) and anchors its
   * reveal timeline there.
   */
  routeRevealArmedAt: number | null;
  /**
   * Whether the route-tier scene may take the page: true from the SAME
   * commit as `routeRevealArmed` (review r3 — no held lead-in). It starts
   * the two-phase handoff in `HideHtmlOnRoute`: the canvas rises over the
   * still-painted page first, the sections hide only once it composited.
   * Built on route tier + a `'presented'` phase this
   * PROVIDER witnessed arrive. The readiness store
   * is module-scope and outlives provider instances, so a soft navigation
   * can mount a provider while the previous world's `'presented'` is still
   * current; the trust latch lives here — above every `HideHtmlOnRoute` — so
   * a layout change that remounts the hider alone can never strand a stale
   * latch and suppress the handover (PR #63 review).
   */
  routeSceneLive: boolean;
  /** Clear a recoverable Lite failure and attempt the route tier again. */
  retryRouteScene: () => void;
  mobile: boolean;
  palette: WorldPalette;
  /** `?routeDebug=1` — shows the station/camera overlay and the graybox. */
  debug: boolean;
  /**
   * The resolved route theme, or null for DOM-only worlds. Engine consumers
   * (camera, debug overlay, env) read stations, holds, light rig geometry and
   * vocabulary from here; theme scene code may narrow it back to its concrete
   * definition (plaza: `plazaTheme` / `usePlazaPalette`).
   */
  theme: AnyRouteTheme | null;
  /**
   * Set the viewer override (persisted to localStorage); `null` follows the
   * season again. Non-registered ids are treated as `null` — ignored and
   * cleared. The WRITE half only: reading the pick back is the server's job
   * (`resolveViewerWorld`), so this never changes the mounted theme in place.
   * Exposed through the context rather than imported by the switcher so
   * `world-override-store` stays the single localStorage owner behind one seam.
   */
  setRouteThemeOverride: (id: string | null) => void;
  /** World-state channels at a conductor position, sampled from the theme's stations. */
  sampleWorldState: (position: number) => StationWorldState;
}

/**
 * Exported so the canvas can re-provide it inside the scene tree.
 *
 * `<Canvas>` mounts its own React reconciler root, and context does not cross
 * that boundary — without an explicit bridge every scene actor throws on
 * `useWorldState` and the canvas renders an empty tree, which looks exactly
 * like a scene that failed to light rather than one that failed to mount.
 */
export const WorldStateContext = createContext<WorldStateValue | null>(null);

export function useWorldState(): WorldStateValue {
  const value = useContext(WorldStateContext);
  if (!value) throw new Error('useWorldState must be used inside a WorldStateProvider');
  return value;
}

/**
 * The reveal handoff flags, on their OWN context (ENGINE r3). The arm flips
 * them; were they on the world-state value, that one commit re-rendered all
 * ~55 `useWorldState` consumers (the whole scene tree through the canvas's
 * re-provide, and the DOM chrome) — a 0.1-0.25 s dev main-thread hitch right
 * at the arm (CAR r2). Only the components that act on the handoff read this.
 * The world-state value keeps the three fields as live getters for type
 * compatibility, but its identity no longer changes at the arm, so a
 * component that must RE-RENDER on the handoff reads `useWorldHandoff`.
 */
export interface WorldHandoffValue {
  routeRevealArmed: boolean;
  routeRevealArmedAt: number | null;
  routeSceneLive: boolean;
}

const NO_HANDOFF: WorldHandoffValue = { routeRevealArmed: false, routeRevealArmedAt: null, routeSceneLive: false };

/** Exported so the canvas can re-provide it inside the scene tree (like `WorldStateContext`). */
export const WorldHandoffContext = createContext<WorldHandoffValue>(NO_HANDOFF);

export function useWorldHandoff(): WorldHandoffValue {
  return useContext(WorldHandoffContext);
}

/**
 * The conductor's render-facing state (ENGINE r3): the station index React
 * mirrors, whether the first measurement landed, and the measured station
 * ids. On its own context so a station crossing re-renders only the
 * components that render from it (the nav), not every world-state consumer.
 */
export interface ConductorState {
  activeIndex: number;
  measured: boolean;
  stationIds: readonly string[];
}

const NO_CONDUCTOR_STATE: ConductorState = { activeIndex: 0, measured: false, stationIds: [] };

export const WorldConductorContext = createContext<ConductorState>(NO_CONDUCTOR_STATE);

export function useConductorState(): ConductorState {
  return useContext(WorldConductorContext);
}

interface WorldStateProviderProps {
  /** Station ids in route order — the world registry's section manifest. */
  stationIds: readonly string[];
  /**
   * Route theme for 3D worlds. Pass the definition directly from client
   * components, or its registry id (`SeasonWorld.routeThemeId`) from server
   * components — theme definitions carry functions, which cannot cross the
   * RSC boundary, so the shell passes the id and the provider resolves it.
   * Omitted = DOM-only world (no stations beyond the ids, core palette).
   */
  theme?: AnyRouteTheme;
  routeThemeId?: string;
  /**
   * The signed-in viewer's persisted 3D world preference
   * (`players.world_experience`), threaded from the page's server read.
   * Optional and defaulted to DEFAULT_WORLD_EXPERIENCE ('off'), so every call
   * site without a stored choice (tournaments, draft room, signed-out
   * visitors) shows the simple version. The dev route-preview passes 'auto'.
   */
  worldExperience?: WorldExperience;
  children: ReactNode;
}

export default function WorldStateProvider({
  stationIds,
  theme,
  routeThemeId,
  worldExperience = DEFAULT_WORLD_EXPERIENCE,
  children,
}: WorldStateProviderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * The mounted world's theme, from the SERVER-resolved prop only. The viewer
   * override (`?world=`, then localStorage) is deliberately not read here:
   * world resolution is server-owned (`resolveViewerWorld` reads the param;
   * `WorldOverrideRedirect` mirrors the persisted pick into it), so the scene
   * root, the token namespace, the station manifest and the DOM sections all
   * come from ONE world. Re-resolving the theme from the store would repaint
   * this theme's palette/stations/camera over the previous world's
   * still-mounted furniture during the navigation round trip (PR #63 review —
   * the mixed-theme window).
   */
  const resolvedTheme = useMemo(
    () => theme ?? resolveRouteTheme(routeThemeId),
    [theme, routeThemeId],
  );
  const liveConductor = useScrollConductor(stationIds, resolvedTheme?.holdIds ?? []);
  /**
   * ENGINE r3 (quiet probe: 50-110 ms dev commits at every station crossing
   * in the theme worlds): the conductor object is rebuilt whenever its
   * `activeIndex` changes, and it sat on the world-state value — so every
   * crossing re-rendered all ~55 `useWorldState` consumers, the whole scene
   * tree included (trees, lanterns, the board groups). The value now carries
   * a STABLE conductor that reads through to the latest one; the few
   * components that render from `activeIndex` / `measured` / `stationIds`
   * read `useConductorState` (its own context).
   */
  const conductorRef = useRef(liveConductor);
  useLayoutEffect(() => {
    conductorRef.current = liveConductor;
  }, [liveConductor]);
  const conductor = useMemo<RouteConductor>(
    () => ({
      get progress() {
        return conductorRef.current.progress;
      },
      get activeIndex() {
        return conductorRef.current.activeIndex;
      },
      get measured() {
        return conductorRef.current.measured;
      },
      get stationIds() {
        return conductorRef.current.stationIds;
      },
      remeasure: () => conductorRef.current.remeasure(),
      subscribe: (listener: () => void) => conductorRef.current.subscribe(listener),
      sync: () => conductorRef.current.sync(),
      goToStation: (id: string) => conductorRef.current.goToStation(id),
    }),
    [],
  );
  const conductorState = useMemo<ConductorState>(
    () => ({
      activeIndex: liveConductor.activeIndex,
      measured: liveConductor.measured,
      stationIds: liveConductor.stationIds,
    }),
    [liveConductor.activeIndex, liveConductor.measured, liveConductor.stationIds],
  );

  const caps = useSyncExternalStore(subscribeTier, getCapabilities, getServerCapabilities);
  const urlTierOverride = useSyncExternalStore(
    subscribeStatic,
    readUrlTierOverride,
    getNullTierOverride,
  );
  const mobile = useSyncExternalStore(subscribeViewport, getMobile, getFalse);
  const debug = useSyncExternalStore(subscribeStatic, getDebug, getFalse);
  const trace = useSyncExternalStore(subscribeStatic, getTrace, getFalse);
  const scenePhase = useSyncExternalStore(subscribeScenePhase, getScenePhase, getServerScenePhase);
  const sceneGeneration = useSyncExternalStore(
    subscribeScenePhase,
    currentSceneGeneration,
    getServerSceneGeneration,
  );

  /**
   * Presentation trust latch (consumed as `routeSceneLive`). The readiness
   * store is module-scope and outlives provider instances, so a soft
   * navigation can mount THIS provider while the PREVIOUS world's
   * 'presented' is still current — before this provider's effects have begun
   * their own generation. Any render observing a non-presented phase arms the
   * latch, so a stale 'presented' at mount cannot hand the page over
   * (PR #63 review). Monotonic false→true: the (tier, themeId) effect always
   * transitions the phase away from an inherited 'presented', so the latch
   * arms before the new scene can legitimately present. Living here rather
   * than in `HideHtmlOnRoute` makes it impossible for a future layout to
   * remount the hider alone and strand the latch.
   */
  const [sawNonPresented, setSawNonPresented] = useState(scenePhase !== 'presented');
  const [prevPhase, setPrevPhase] = useState(scenePhase);
  if (prevPhase !== scenePhase) {
    // React's documented "storing information from previous renders" pattern:
    // a guarded render-phase update, re-rendered before anything commits.
    setPrevPhase(scenePhase);
    if (scenePhase !== 'presented') setSawNonPresented(true);
  }

  /**
   * The tier decision: URL override > viewer preference > hard floors >
   * advisory checks — resolved by the pure `resolveTierDecision`. The server
   * snapshot sentinel short-circuits to `SERVER_TIER`, so SSR and the first
   * client paint stay Lite regardless of the preference.
   */
  const detected: TierDecision =
    caps === SERVER_CAPS
      ? SERVER_TIER
      : resolveTierDecision(urlTierOverride, worldExperience, caps);

  const [forcedLite, setForcedLite] = useState<LiteReason | null>(null);
  const [palette, setPalette] = useState<WorldPalette>(() =>
    resolvePalette(FALLBACK_PALETTE, resolvedTheme),
  );

  const sampler = useMemo(
    () => (resolvedTheme ? createWorldStateSampler(resolvedTheme.stations) : EMPTY_SAMPLER),
    [resolvedTheme],
  );

  const degradeToLite = useCallback((reason: LiteReason) => setForcedLite(reason), []);

  const setRouteThemeOverride = useCallback((id: string | null) => {
    writeWorldOverride(id);
  }, []);

  const tier: RouteTier = forcedLite ? 'lite' : detected.tier;
  const liteReason: LiteReason | null = forcedLite ?? detected.reason;
  const themeId = resolvedTheme?.id ?? null;

  /**
   * One scene generation per (theme, route-tier) pair. Starting a generation
   * is what makes a late completion from an abandoned theme unable to present
   * itself as ready for the new one. `beginSceneGeneration` is idempotent
   * while this theme's generation is already loading, so a re-entry in the
   * same round trip (retry) can never bump past the number the canvas
   * reporter captured (PR #63 review).
   */
  const nightKey = nightKeyOf(palette);
  /**
   * R6 E1: the generation key this provider last began (null after a
   * reset). The begin effect and the palette observer both compare against
   * it, so the palette state catching up never begins a second generation.
   */
  const begunKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // R6 E1: the day/night side from the DOM, not the (possibly still
    // fallback) palette state — see `planGenerationBegin`.
    const domNightKey = nightKeyOf(resolvePalette(readWorldPalette(rootRef.current), resolvedTheme));
    const plan = planGenerationBegin({ tier, themeId, domNightKey, begunKey: begunKeyRef.current, phase: getScenePhase() });
    if (plan.action === 'reset') {
      begunKeyRef.current = null;
      // D32: no world, no veil (Lite is the page).
      abortThemeVeil();
      resetSceneReadiness();
      return;
    }
    if (plan.action === 'none') return;
    begunKeyRef.current = plan.key;
    beginSceneGeneration(plan.key);
  }, [tier, themeId, nightKey, resolvedTheme]);

  /**
   * ENGINE r3 (CAR r2: the theme toggle rebuilt the world after reveal with
   * no ceremony — a fetch, ~60 program links, uploads and 13-17 s main-thread
   * freezes). A day/night palette swap changes the scene's program state
   * (lights, environment, textures), so it is a NEW generation with the full
   * complete-at-reveal ceremony: the handoff withdraws (the page shows), the
   * ball loads, the load warm compiles, uploads and renders the new palette,
   * and the world is revealed again. The generation is begun HERE, in the
   * palette observer, before the palette state commits — so no frame can
   * draw the new palette's content under the previous generation's reveal
   * (the warm hold keys off the generation). The (tier, theme, palette)
   * effect above re-asks for the same key and is a no-op then.
   */
  const generationInputs = useRef({ tier, themeId, nightKey });
  useLayoutEffect(() => {
    generationInputs.current = { tier, themeId, nightKey };
  }, [tier, themeId, nightKey]);

  /**
   * Unmount invalidation, in the LAYOUT phase so it runs synchronously with
   * the commit instead of in the passive flush. A departing world's pending
   * settle timer (250 ms) still matches its captured generation in the window
   * between the DOM mutation and the passive effects; without this it calls
   * `markScenePresented()` there and hands `world-route-live` to the incoming
   * world for one task — HTML hidden over a canvas that has not painted yet
   * (PR #63 review).
   */
  // `'unmount'`: a StrictMode / remount re-begin continues the visitor's
  // attempt clock (world-readiness `ATTEMPT_CHAIN_MS`).
  useLayoutEffect(
    () => () => {
      abortThemeVeil();
      resetSceneReadiness('unmount');
    },
    [],
  );

  /**
   * D32: whether the current generation's reveal is live (the world is the
   * page). Read by the palette observer at flip time; kept current after
   * every commit (the flag itself is derived further down).
   */
  const worldLiveRef = useRef(false);

  const sceneProgress = useSyncExternalStore(
    subscribeSceneProgress,
    getSceneProgress,
    getServerSceneProgress,
  );

  /**
   * Clear the recoverable failure; the (tier, themeId) effect above begins the
   * fresh generation once the route tier is actually re-entered. Deliberately
   * does NOT begin one here: a retry clicked after the device flipped to a
   * hard-floor Lite mid-session would otherwise arm a loading generation no
   * canvas ever answers — a 10 s no-op loop whose timeout then masks the true
   * Lite reason (PR #63 review).
   */
  const retryRouteScene = useCallback(() => {
    setForcedLite(null);
  }, []);

  // The palette is a function of the theme, so re-read it whenever the theme
  // attribute flips rather than only at mount.
  //
  // R6 E1: in the LAYOUT phase, so the palette state is right in the commit
  // that mounts (and before the render that first flips the tier to route):
  // the canvas never mounts against the day fallback on a dark load (which
  // began the day HDRI fetch for nothing). The generation key itself comes
  // from the DOM in the begin effect above (`planGenerationBegin`), so the
  // order of the two effects no longer matters.
  //
  // D32 (owner: a day/night switch after the reveal is covered by a fade):
  // while the world IS the page, a flip does not begin the new generation
  // here. It asks the theme veil to fade in (page background colour, ~220
  // ms) and defers the swap — the palette state AND the generation begin —
  // to the first frame after the veil is fully opaque (`commitSwap`). Until
  // then the scene keeps drawing the old palette, so no frame shows a
  // half-switched world; the page chrome switches at once (CSS tokens). The
  // new generation then loads, warms and arms behind the veil exactly like a
  // first reveal, and the veil fades out once it is resident and warm
  // (theme-veil-store). Before the reveal (and under Lite) the page itself
  // covers the swap, as before.
  useLayoutEffect(() => {
    const read = () => {
      const next = readNext();
      const inputs = generationInputs.current;
      const nextKey = nightKeyOf(next);
      // R6 E1: compared with the key this provider actually began (the
      // palette state lags it), so the observer never re-begins the key the
      // begin effect already started.
      const swapKey = inputs.themeId !== null ? sceneGenerationKey(inputs.themeId, nextKey) : null;
      const swapping =
        inputs.tier === 'route' &&
        swapKey !== null &&
        swapKey !== begunKeyRef.current &&
        getScenePhase() !== 'idle';
      const veil = getThemeVeilState();
      const plan = planPaletteSwap({ swapping, worldLive: worldLiveRef.current, veil });
      if (plan === 'veil') {
        // The palette state is held: the world keeps drawing the old one.
        requestThemeVeil({ target: nextKey, commit: commitSwap });
        return;
      }
      if (plan === 'commit') {
        commitSwap();
        return;
      }
      if (plan === 'cancel') cancelThemeVeil();
      // A deferred swap is pending behind the fading veil: the palette
      // state waits for its commit.
      if (plan === 'none' && (veil.phase === 'in' || veil.phase === 'opaque') && !veil.committed) return;
      if (plan === 'immediate' && swapKey !== null) {
        begunKeyRef.current = swapKey;
        beginSceneGeneration(swapKey);
      }
      setPalette((current) => (samePalette(current, next) ? current : next));
    };
    const readNext = () => resolvePalette(readWorldPalette(rootRef.current), resolvedTheme);
    // Behind the opaque veil: re-read the DOM (the visitor may have flipped
    // again meanwhile) and begin whatever is current now.
    const commitSwap = () => {
      const next = readNext();
      const inputs = generationInputs.current;
      const key = inputs.themeId !== null ? sceneGenerationKey(inputs.themeId, nightKeyOf(next)) : null;
      if (inputs.tier !== 'route' || key === null || key === begunKeyRef.current || getScenePhase() === 'idle') {
        cancelThemeVeil();
      } else {
        // ENGINE-FIX (D32): the canvas keeps the leaving palette's programs
        // alive through this commit (its successors reuse them — no link).
        runThemeSwapHooks({ fromKey: begunKeyRef.current, toKey: key });
        begunKeyRef.current = key;
        const begun = beginSceneGeneration(key);
        noteThemeVeilCommitted(begun ?? currentSceneGeneration(), nightKeyOf(next));
      }
      setPalette((current) => (samePalette(current, next) ? current : next));
    };
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  /**
   * Reveal gate (W7 / D3, rewritten for D23 "complete at reveal"). Product requirement:
   * "I don't want anything to stream in after the world appears, that's what
   * the pokeball loading animation is for". The gate arms only for a
   * COMPLETE world (`revealGate`, ball-loader-state): the generation is
   * presented (and witnessed by this provider), its assets are idle, every
   * population is resident (seat R's residency store, relayed by the canvas)
   * and the load warm settled (programs incl. shadow and pass variants,
   * uploads, pose renders — RouteWorldCanvas `LoadWarmer`). There is no cap
   * and no late partial arm: past `revealArmLastAt` the gate never arms, and
   * the readiness deadline below sends the visitor to Lite.
   *
   * The arm IS the handoff (review r3): `routeSceneLive` turns on in the
   * same commit as `routeRevealArmed`. The ball's `data-revealing` renders
   * from this same commit, and the hinge, the beam, the canvas fade and the
   * ball's exit are CSS delays off it — one compositor timeline that stays in
   * step however late the main thread gets. The canvas is revealed OVER the
   * still-painted page (`html[data-route-handoff]`) and the sections are
   * hidden only after it composited (`HideHtmlOnRoute`, two-phase).
   *
   * Re-evaluated on every phase / generation / progress notification (the
   * warm, residency and milestones all notify the progress store); a due arm
   * fires from a 0 ms task through `scheduleAtWallClock`, never synchronously
   * in the effect body. Every failure flips the tier, which drops
   * `presentedTrusted` and with it both flags in the same render.
   */
  const presentedTrusted = tier === 'route' && scenePhase === 'presented' && sawNonPresented;
  const [reveal, setReveal] = useState<RevealLatch | null>(null);
  const revealForCurrent = reveal !== null && reveal.generation === sceneGeneration ? reveal : null;
  const armPending = presentedTrusted && revealForCurrent === null;
  const progressCurrent = sceneProgress.generation === sceneGeneration;
  const assetsIdle = progressCurrent && sceneProgress.assets;
  const sceneWarm = progressCurrent && sceneProgress.warm;
  const resident = progressCurrent && sceneProgress.resident;
  // `programsWarm` (the r5 relay) stays in the trace only; the D23 warm's
  // own settle (`sceneWarm`) is the programs input now.

  useLayoutEffect(() => {
    if (!armPending) return;
    const generation = sceneGeneration;
    const verdict = revealGate({
      nowMs: performance.now(),
      presented: true,
      assetsIdle,
      residencyComplete: resident,
      sceneWarm,
      begunAtMs: getGenerationBegunAt(),
      deadlineMs: getReadyDeadlineMs(),
    });
    if (verdict !== 'arm') return;
    return scheduleAtWallClock(performance.now(), () => {
      if (currentSceneGeneration() !== generation) return;
      // Re-checked at the task: the last arm point may have passed meanwhile.
      // Exclusive, as revealGate: at the bound itself the ball starts its abort fade.
      if (performance.now() >= revealArmLastAt(getGenerationBegunAt(), getReadyDeadlineMs())) return;
      // Wave-2 r2: the renderer's ceremony hold keys off the arm itself, not
      // the ball machine's later `opening` step (scene-progress).
      if (getRevealArmedAt() === null) noteRevealArmed(generation, performance.now());
      setReveal((current) => {
        if (current !== null && current.generation === generation) return current;
        const at = performance.now();
        return { generation, armedAt: at, live: true, liveAt: at };
      });
    });
  }, [armPending, sceneGeneration, assetsIdle, sceneWarm, resident, sceneProgress, scenePhase]);

  const armedForCurrent = revealForCurrent !== null;

  /**
   * Finite readiness deadline (D1; 20 s since D23), wall clock from the
   * attempt start (`getGenerationBegunAt()`), re-derived on every phase /
   * generation / milestone notification so one long task that pre-empts the
   * timer cannot let the attempt outlive it. Gated on the route tier: the
   * deadline governs an ACTUAL scene attempt, and a 'loading' phase that
   * outlives a flip to Lite must not overwrite the true Lite reason (PR #63
   * review).
   *
   * D23: it governs every generation that is not yet ARMED — loading, or
   * presented but incomplete (the gate has no cap any more). Past it the
   * outcome is Lite (`readiness-timeout`), never a partial reveal. A
   * presentation that lands past the deadline is refused by the store
   * (`markScenePresented` -> failed, `late-present`) and resolves Lite here
   * too; other failures degrade at their own call site with their own reason,
   * which this never overwrites.
   */
  useEffect(() => {
    if (tier !== 'route') return;
    if (scenePhase === 'failed') {
      if (getSceneFailure() !== 'late-present') return;
      const late = window.setTimeout(() => degradeToLite('readiness-timeout'), 0);
      return () => window.clearTimeout(late);
    }
    const unarmed = scenePhase === 'loading' || (scenePhase === 'presented' && !armedForCurrent);
    if (!unarmed) return;
    return scheduleAtWallClock(getGenerationBegunAt() + getReadyDeadlineMs(), () => {
      if (scenePhase === 'presented') markSceneFailed('readiness-timeout');
      degradeToLite('readiness-timeout');
    });
    // `sceneGeneration` keys the budget to the ATTEMPT: a mid-load theme
    // switch bumps the generation without a phase change, and the new scene
    // gets its own budget, not the abandoned attempt's remainder (PR #63
    // review). `sceneProgress` re-checks the wall clock on every milestone.
  }, [tier, scenePhase, sceneGeneration, sceneProgress, armedForCurrent, degradeToLite]);

  /**
   * No-progress stall detector (D23): while the generation is unarmed and
   * its renderer is up, no load signal advancing for `READINESS_STALL_MS`
   * (6 s) sends the visitor to Lite (`readiness-stall`) without waiting out
   * the 20 s deadline. The signals (bytes, items, programs, ready programs,
   * uploads, residency, warm stage, poses, milestones) live in the progress
   * store, outside React; this effect only schedules a wall-clock check at
   * the window's end and re-arms it from the latest progress when a signal
   * moved in between. Slow-but-moving is never a stall.
   */
  useEffect(() => {
    if (tier !== 'route') return;
    const unarmed = scenePhase === 'loading' || (scenePhase === 'presented' && !armedForCurrent);
    if (!unarmed) return;
    let cancel: (() => void) | null = null;
    let stopped = false;
    const arm = () => {
      cancel?.();
      cancel = null;
      if (stopped) return;
      const at = loadStallAt();
      // Not armed yet (no renderer): look again shortly — the renderer's
      // rise notifies the progress store, which re-runs this effect anyway.
      cancel = scheduleAtWallClock(at ?? performance.now() + 1000, check);
    };
    const check = () => {
      if (stopped) return;
      if (loadStalled(performance.now())) {
        stopped = true;
        markSceneFailed('readiness-stall');
        degradeToLite('readiness-stall');
        return;
      }
      arm();
    };
    arm();
    return () => {
      stopped = true;
      cancel?.();
    };
    // Deliberately NOT keyed on `sceneProgress`: the check re-reads the
    // store at its target, so the effect need not re-run per milestone.
  }, [tier, scenePhase, sceneGeneration, armedForCurrent, degradeToLite]);

  const routeRevealArmed = presentedTrusted && revealForCurrent !== null;
  const routeSceneLive = routeRevealArmed && revealForCurrent !== null && revealForCurrent.live;
  const routeRevealArmedAt =
    routeRevealArmed && revealForCurrent !== null ? revealForCurrent.armedAt : null;
  const routeSceneLiveAt = routeSceneLive && revealForCurrent !== null ? revealForCurrent.liveAt : null;
  useLayoutEffect(() => {
    worldLiveRef.current = routeSceneLive;
  }, [routeSceneLive]);

  /**
   * Trace-gated readiness trace (`?routeTrace=1`, or `?routeDebug=1` which
   * implies it): lives on the provider so it exists before — and without —
   * any canvas (a Lite run included), for the harness's loader recorder. Reads the module stores at call time; the handoff flags come
   * through a ref kept current after each commit.
   */
  const traceFlags = useRef<{
    armed: boolean;
    live: boolean;
    armedAt: number | null;
    liveAt: number | null;
    tier: RouteTier;
    liteReason: LiteReason | null;
  }>({ armed: false, live: false, armedAt: null, liveAt: null, tier: 'lite', liteReason: null });
  useEffect(() => {
    traceFlags.current = {
      armed: routeRevealArmed,
      live: routeSceneLive,
      armedAt: routeRevealArmedAt,
      liveAt: routeSceneLiveAt,
      tier,
      liteReason,
    };
  }, [routeRevealArmed, routeSceneLive, routeRevealArmedAt, routeSceneLiveAt, tier, liteReason]);

  useEffect(() => {
    if (!trace) return;
    const host = window as ReadinessHost;
    // ENGINE r2: the logs are GETTERS (enumerable, so a JSON dump still
    // carries them): the harness samples this bridge on every animation
    // frame for the scalar fields, and copying every log per frame was
    // per-frame main-thread cost inside the very ceremony it measures.
    host.__routeWorldReadiness = () => ({
      phase: getScenePhase(),
      generation: currentSceneGeneration(),
      phaseChangedAt: getPhaseChangedAt(),
      generationBegunAt: getGenerationBegunAt(),
      milestones: getSceneProgress(),
      ball: getBallPhase(),
      get ballTrace() {
        return getBallPhaseTrace();
      },
      get wobbleTrace() {
        return getWobbleTrace();
      },
      get ceremony() {
        return getCeremonyTrace();
      },
      get phaseTrace() {
        return getScenePhaseTrace();
      },
      get generationLog() {
        return getGenerationLog();
      },
      // D32: the theme veil's phase and its time-stamped log (the quiet
      // probe's judged theme leg reads the veil-opaque window from it).
      themeVeil: getThemeVeilPhase(),
      get themeVeilTrace() {
        return getThemeVeilTrace();
      },
      lastFault: getLastSceneFault(),
      programsWarm: getProgramsWarmRelay(),
      get warmTrace() {
        return getWarmTrace();
      },
      get loadSignals() {
        return getLoadSignals();
      },
      stallAt: loadStallAt(),
      get attempts() {
        return getAttemptLog();
      },
      get warmFrames() {
        return getWarmFrames();
      },
      armed: traceFlags.current.armed,
      live: traceFlags.current.live,
      armedAt: traceFlags.current.armedAt,
      liveAt: traceFlags.current.liveAt,
      deadlineMs: getReadyDeadlineMs(),
      deadlineRelaxed: isReadyDeadlineRelaxed(),
      tier: traceFlags.current.tier,
      liteReason: traceFlags.current.liteReason,
      handoff: document.documentElement.hasAttribute('data-route-handoff'),
      worldRouteLive: document.documentElement.classList.contains('world-route-live'),
    });
    return () => {
      delete host.__routeWorldReadiness;
    };
  }, [trace]);

  // ENGINE r3: the handoff flags on their own context (see `useWorldHandoff`).
  const handoff = useMemo<WorldHandoffValue>(
    () => ({ routeRevealArmed, routeRevealArmedAt, routeSceneLive }),
    [routeRevealArmed, routeRevealArmedAt, routeSceneLive],
  );
  const handoffRef = useRef<WorldHandoffValue>(handoff);
  useLayoutEffect(() => {
    handoffRef.current = handoff;
  }, [handoff]);

  const value = useMemo<WorldStateValue>(() => {
    const base = {
      conductor,
      tier,
      liteReason,
      degradeToLite,
      scenePhase,
      sceneGeneration,
      retryRouteScene,
      mobile,
      palette,
      debug,
      theme: resolvedTheme,
      setRouteThemeOverride,
      sampleWorldState: sampler.worldStateAt,
    };
    // Live getters (type compatibility): the value's identity does not
    // change at the arm; re-rendering readers use `useWorldHandoff`.
    return Object.defineProperties(base, {
      routeRevealArmed: { enumerable: true, get: () => handoffRef.current.routeRevealArmed },
      routeRevealArmedAt: { enumerable: true, get: () => handoffRef.current.routeRevealArmedAt },
      routeSceneLive: { enumerable: true, get: () => handoffRef.current.routeSceneLive },
    }) as WorldStateValue;
  }, [
    conductor,
    tier,
    liteReason,
    degradeToLite,
    scenePhase,
    sceneGeneration,
    retryRouteScene,
    mobile,
    palette,
    debug,
    resolvedTheme,
    setRouteThemeOverride,
    sampler,
  ]);

  return (
    <WorldStateContext.Provider value={value}>
      <WorldHandoffContext.Provider value={handoff}>
        <WorldConductorContext.Provider value={conductorState}>
          {/* `display: contents` — the element exists only to anchor the palette
              read; it must not become a box in the world's layout. */}
          <div ref={rootRef} className="contents">
            {children}
          </div>
        </WorldConductorContext.Provider>
      </WorldHandoffContext.Provider>
    </WorldStateContext.Provider>
  );
}
