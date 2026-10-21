'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  MOBILE_MAX_WIDTH,
  partialFaceTable,
  type DataSurfaceTheme,
  type ViewportKey,
} from '@/lib/route-world/data-surfaces';
import { focusStore, type FocusPhase } from './focus/focus-store';
import { useWorldState } from './WorldStateProvider';

/**
 * STANDBY DIM + THE DATA LUMINANCE BUDGET (fidelity wave 2, seat 2F LUMA;
 * WAVE-PLAN §1 "the station's board is the brightest, sharpest thing on
 * screen", §5.10 "neighbour boards at full brightness cropped mid-word").
 *
 * Every painted data material carries a `uStandby` uniform, created WITH the
 * material (the uniform object exists before the first compile and the
 * shader patch is installed at construction — never added lazily, so a
 * standby change never recompiles a program, §5.13). At `uStandby = s`:
 *
 *  - emission × (1 − 0.7 s) — the face recedes to "next stop";
 *  - albedo mixed 35 % × s toward the live scene fog colour — it sits back
 *    into the air instead of reading as a black hole (the self-lit faces
 *    are base colour black, so at s = 0 the mix is a no-op);
 *  - the eased level moves over 400 ms (a glow change, so reduced motion
 *    keeps it: §5.14 allows glow on forced-route reduced motion).
 *
 * Which faces stand by is keyed on the ONE hysteretic nearest station
 * (`progress.nearest`, the latch every consumer shares — a jitter around
 * x.5 cannot flip it, so a crossing costs at most one transition) plus 2A's
 * precomputed partial-face table:
 *
 *  - a face of the active station is lit (reason `active`; `active-partial`
 *    when the table says that face is cut by the frame at this viewport —
 *    it is still THE data, so it is never dimmed, only reported);
 *  - every other station's face stands by (`neighbour`, or
 *    `neighbour-partial` for the faces the table lists as cut off at the
 *    frozen pose — the §5.10 case the dim exists for);
 *  - focus overrides both: while a subject is focusing/focused, the focused
 *    subject is lit (`focused`) and every other data face stands by
 *    (`focus-quiet` — "opening a panel quiets the world").
 *
 * The luminance budget half: `DATA_EMISSIVE_CEILING` caps a data face's
 * emitted LUMINANCE (hue kept — the whole radiance is scaled) under the
 * night bloom threshold, so glyphs never halo (bloom blurs text) and the
 * ceiling is the one number every non-data practical is budgeted against.
 *
 * Honest limits:
 *  - the partial table is computed at the three capture viewports of record
 *    (1440×900, 768×1024, 390×844); another window size uses the nearest
 *    key by the same rule the rig uses (mobile ≤ 767 px, else portrait →
 *    tablet, else desktop), so an unusual aspect can mislabel a reason. It
 *    never changes WHICH faces stand by (the station rule does that);
 *  - `stepStandby` is frame-clocked (R3F delta), so a parked (demand) canvas
 *    finishes its ease on the next rendered frame, which is the next frame
 *    anyone sees anyway.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Emission lost at full standby: emissive × (1 − 0.7 s). */
export const STANDBY_EMISSIVE_DROP = 0.7;
/** Albedo share mixed toward the fog colour at full standby. */
export const STANDBY_FOG_MIX = 0.35;
/** Ease time of one standby transition. */
export const STANDBY_EASE_MS = 400;

/**
 * Night bloom threshold, restated from `post/PostStack.tsx` (`BLOOM_THRESHOLD`,
 * not exported there; the day threshold is 2.0). postprocessing's luminance
 * pass is `smoothstep(threshold, threshold + smoothing, l)`, so energy
 * strictly under 1.7 never reaches the blur at either time of day.
 */
export const BLOOM_THRESHOLD_NIGHT = 1.7;

/**
 * The data luminance ceiling: the brightest linear luminance a painted data
 * face may emit — a 0.1 margin under the night bloom threshold. Every data
 * material's shader clamps to it (`patchStandbyShader`), and the plaza
 * board's panel gain is authored AT it.
 */
export const DATA_EMISSIVE_CEILING = 1.6;

/** Day bloom threshold, restated from `post/PostStack.tsx` (`DAY_BLOOM_THRESHOLD`). */
export const BLOOM_THRESHOLD_DAY = 2.0;

/**
 * The DAY data luminance ceiling (wave 2 r2, W1 luma budget): the same 0.1
 * margin under the day bloom threshold. A light theme's sky and paving sit
 * near the top of the tonemapper, so the active face needs the day headroom
 * to stay the brightest thing in frame ("an emissive floor on the active
 * face"). Hand-written data shaders set `uDataCeiling` to it in day; the
 * standard-material faces keep the night-safe default.
 */
export const DATA_EMISSIVE_CEILING_DAY = 1.9;

/** Rec. 709 luminance weights (linear light) — the bloom pass's own weights. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// ── Pure: which faces stand by ───────────────────────────────────────────────

export type StandbyReason =
  | 'active'
  | 'active-partial'
  | 'neighbour'
  | 'neighbour-partial'
  | 'focused'
  | 'focus-quiet';

export interface StandbyInput {
  /** The focus subject this data material belongs to. */
  subjectId: string;
  /** Station ids of the subject's data faces (all equal in practice). */
  faceStations: readonly string[];
  /** The subject's data-face ids (data-faces.ts ids). */
  faceIds: readonly string[];
  /** The hysteretic nearest station's id; null before the conductor measures. */
  activeStationId: string | null;
  /** Face ids the partial-face table lists at the active station and viewport. */
  partialIds: readonly string[];
  /** The focus store's subject id and phase. */
  focusId: string | null;
  focusPhase: FocusPhase;
}

export interface StandbyDecision {
  target: 0 | 1;
  reason: StandbyReason;
}

/** The standby target for one data subject (see the module comment). */
export function standbyTarget(input: StandbyInput): StandbyDecision {
  const focusing = input.focusId !== null && (input.focusPhase === 'focusing' || input.focusPhase === 'focused');
  if (focusing) {
    return input.focusId === input.subjectId ? { target: 0, reason: 'focused' } : { target: 1, reason: 'focus-quiet' };
  }
  const partial = input.faceIds.some((id) => input.partialIds.includes(id));
  if (input.activeStationId === null || input.faceStations.includes(input.activeStationId)) {
    return { target: 0, reason: partial ? 'active-partial' : 'active' };
  }
  return { target: 1, reason: partial ? 'neighbour-partial' : 'neighbour' };
}

export interface StandbyLevel {
  /** Linear ease clock, 0 (lit) … 1 (standby). */
  level: number;
  target: 0 | 1;
  /** Target changes seen — the "one transition per crossing" evidence. */
  transitions: number;
}

export function createStandbyLevel(target: 0 | 1 = 0): StandbyLevel {
  return { level: target, target, transitions: 0 };
}

/**
 * One ease step: the level walks linearly toward the target over
 * `STANDBY_EASE_MS` (a reversal mid-ease turns around from where it is, so
 * a flip never jumps). Returns `prev` itself when nothing moved.
 */
export function stepStandby(prev: StandbyLevel, target: 0 | 1, dtMs: number): StandbyLevel {
  const transitions = target !== prev.target ? prev.transitions + 1 : prev.transitions;
  const step = Math.max(0, dtMs) / STANDBY_EASE_MS;
  const level = target > prev.level ? Math.min(target, prev.level + step) : Math.max(target, prev.level - step);
  if (level === prev.level && transitions === prev.transitions) return prev;
  return { level, target, transitions };
}

/** The uniform value for an ease level: smoothstep, so the fade starts and lands soft. */
export function standbyCurve(level: number): number {
  const t = Math.min(1, Math.max(0, level));
  return t * t * (3 - 2 * t);
}

/** The partial-face viewport key for a canvas size (the rig's own mobile rule). */
export function viewportKeyFor(width: number, height: number): ViewportKey {
  if (width <= MOBILE_MAX_WIDTH) return 'mobile';
  return height > width ? 'tablet' : 'desktop';
}

// ── Pure: the luminance budget ───────────────────────────────────────────────

/** Linear luminance of an sRGB hex colour. */
export function linearLuminance(hex: string): number {
  const c = new THREE.Color(hex);
  return LUMA_R * c.r + LUMA_G * c.g + LUMA_B * c.b;
}

/**
 * The largest emissive intensity that keeps a `color`-tinted emitter at or
 * under `share` × a board's ink luminance (`inkHex` × `inkEmission`). Used
 * for the non-data practicals that must stay below the data (clouds light
 * bridges: ≤ 0.6 × the board ink at night).
 */
export function emissiveUnderInk(color: string, inkHex: string, inkEmission: number, share: number): number {
  const own = linearLuminance(color);
  if (own <= 1e-6) return 0;
  return (share * linearLuminance(inkHex) * inkEmission) / own;
}

/**
 * A board-layer point light's intensity clamp. three's direct diffuse term is
 * `albedo / π × I / d² × N·L` (physical falloff, decay 2), so the brightest
 * radiance the light can put on its nearest lit surface (albedo `albedo`,
 * `nearestM` away, facing it) stays at or under `ceiling` when
 * I ≤ ceiling × π × d² / albedo. Returns min(authored, that bound).
 *
 * Honest limit: `nearestM` is the authored geometry's nearest lit surface,
 * restated by hand at each call site (named there); the capture's `--luma`
 * arm is the measurement of record.
 */
export function clampBoardLight(authored: number, nearestM: number, albedo: number, ceiling: number): number {
  const a = Math.max(1e-3, albedo);
  const bound = (ceiling * Math.PI * nearestM * nearestM) / a;
  return Math.min(authored, bound);
}

// ── The shader patch (created with the material, never lazily) ──────────────

export interface StandbyUniforms {
  uStandby: THREE.IUniform<number>;
  uStandbyFog: THREE.IUniform<THREE.Color>;
  uDataCeiling: THREE.IUniform<number>;
  [uniform: string]: THREE.IUniform;
}

export function createStandbyUniforms(): StandbyUniforms {
  return {
    uStandby: { value: 0 },
    uStandbyFog: { value: new THREE.Color('#808080') },
    uDataCeiling: { value: DATA_EMISSIVE_CEILING },
  };
}

/** Program cache key: every standby program is keyed apart from plain standard materials. */
export const STANDBY_PROGRAM_KEY = 'route-standby-v1';

/** GLSL declarations shared by the standard-material patch and hand-written data shaders. */
export const STANDBY_GLSL_DECLARE = /* glsl */ `
uniform float uStandby;
uniform vec3 uStandbyFog;
uniform float uDataCeiling;
vec3 standbyCeiling(vec3 radiance) {
  float l = dot(radiance, vec3(${LUMA_R}, ${LUMA_G}, ${LUMA_B}));
  return radiance * min(1.0, uDataCeiling / max(l, 1e-4));
}
`;

const COLOR_ANCHOR = '#include <color_fragment>';
const EMISSIVE_ANCHOR = '#include <emissivemap_fragment>';

/**
 * Patch a MeshStandardMaterial program (the `physical` fragment the standard
 * material compiles): declarations after `<common>`, the fog-ward albedo mix
 * after `<color_fragment>`, the emissive drop + luminance ceiling after
 * `<emissivemap_fragment>`. Throws if an anchor is missing (a three upgrade
 * must fail loudly in the unit test, not silently skip the dim).
 */
export function patchStandbyShader(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: StandbyUniforms): void {
  const src = shader.fragmentShader;
  if (!src.includes(COLOR_ANCHOR) || !src.includes(EMISSIVE_ANCHOR) || !src.includes('#include <common>')) {
    throw new Error('[standby] standard fragment anchors missing — three chunk layout changed');
  }
  shader.uniforms.uStandby = uniforms.uStandby;
  shader.uniforms.uStandbyFog = uniforms.uStandbyFog;
  shader.uniforms.uDataCeiling = uniforms.uDataCeiling;
  shader.fragmentShader = src
    .replace('#include <common>', `#include <common>\n${STANDBY_GLSL_DECLARE}`)
    .replace(
      COLOR_ANCHOR,
      `${COLOR_ANCHOR}\ndiffuseColor.rgb = mix(diffuseColor.rgb, uStandbyFog, ${STANDBY_FOG_MIX.toFixed(2)} * uStandby);`,
    )
    .replace(
      EMISSIVE_ANCHOR,
      `${EMISSIVE_ANCHOR}\ntotalEmissiveRadiance = standbyCeiling(totalEmissiveRadiance * (1.0 - ${STANDBY_EMISSIVE_DROP.toFixed(2)} * uStandby));`,
    );
}

/**
 * Props for a data face's `<meshStandardMaterial>`: R3F applies them at
 * construction, before the material's first compile, so the program is
 * built WITH the uniforms (the "never lazily" rule).
 */
export interface StandbyMaterialProps {
  onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  customProgramCacheKey: () => string;
}

export function standbyMaterialProps(uniforms: StandbyUniforms): StandbyMaterialProps {
  return {
    onBeforeCompile: (shader) => patchStandbyShader(shader, uniforms),
    customProgramCacheKey: () => STANDBY_PROGRAM_KEY,
  };
}

/**
 * Constructor parameters for a hand-written data `ShaderMaterial` that reads
 * the standby uniforms (the plaza board panel). Pass them as the element's
 * `args` — `<shaderMaterial args={[params]} />` — and NEVER as a `uniforms`
 * prop.
 *
 * Why (fidelity wave 2 round 2, W1/W6 "the arrived SPIELPLAN face renders in
 * standby while PULS stays lit"): R3F 9.7's `applyProps` keeps a
 * ShaderMaterial's uniforms target stable by SHALLOW-COPYING every uniform
 * (`uniforms[name] = { ...uniform }`). The material then holds its own
 * `{ value }` objects, so the hook's per-frame `uStandby.value` writes never
 * reach the program: each panel froze at the standby level of the frame it
 * mounted on (loaded at pulse → pulse lit and the schedule face washed out
 * for the rest of the session, whatever the station). three's
 * `ShaderMaterial` constructor assigns `parameters.uniforms` by reference, so
 * the constructor path keeps the hook's objects bound — the same contract
 * `patchStandbyShader` keeps for standard materials.
 */
export function standbyShaderParameters<U extends StandbyUniforms>(
  uniforms: U,
  vertexShader: string,
  fragmentShader: string,
): THREE.ShaderMaterialParameters & { uniforms: U } {
  return { uniforms, vertexShader, fragmentShader };
}

// ── Readout (routeDebug only) ────────────────────────────────────────────────

export interface StandbyRow {
  subjectId: string;
  faceIds: readonly string[];
  station: string | null;
  activeStationId: string | null;
  viewport: ViewportKey;
  target: 0 | 1;
  reason: StandbyReason;
  /** The uniform value on screen (eased). */
  value: number;
  transitions: number;
}

const rows = new Map<symbol, StandbyRow>();

/** Every mounted data subject's standby state — `window.__routeWorldStandby()` in `?routeDebug=1`. */
export function standbyReadout(): StandbyRow[] {
  return [...rows.values()].map((row) => ({ ...row }));
}

type StandbyHost = Window & { __routeWorldStandby?: () => StandbyRow[] };

function installReadout(): void {
  if (typeof window === 'undefined') return;
  (window as StandbyHost).__routeWorldStandby = standbyReadout;
}

function uninstallReadoutIfIdle(): void {
  if (typeof window === 'undefined' || rows.size > 0) return;
  delete (window as StandbyHost).__routeWorldStandby;
}

// ── The hook ─────────────────────────────────────────────────────────────────

interface StandbyOptionsBase {
  /** The FocusSubject id the material belongs to (focus override). */
  subjectId: string;
  /** The data-face ids this material paints (data-faces.ts ids). */
  faceIds: readonly string[];
  /**
   * Wave-2 r3 (LUMA): further focus subjects that count as THIS face being
   * focused (the teams ledger's columns are `team:<id>` subjects — focusing
   * one must light the ledger, not quiet it).
   */
  ownsFocus?: (focusId: string) => boolean;
}

export interface SurfaceStandbyOptions extends StandbyOptionsBase {
  /** The world's data surfaces (the `<THEME>_DATA_SURFACES` of its data-faces.ts). */
  surfaces: DataSurfaceTheme;
}

/**
 * Wave-2 r3 (LUMA): the station-index form, for a shared component that is
 * mounted by every world and never sees its world's `DataSurfaceTheme` (the
 * Roll-Call Ledger). It keys on the same hysteretic nearest index; there is
 * no partial table, so its reasons are only `active` / `neighbour` / focus.
 */
export interface StationStandbyOptions extends StandbyOptionsBase {
  /** The face's station index in this world's route. */
  stationIndex: number;
}

export type StandbyOptions = SurfaceStandbyOptions | StationStandbyOptions;

/** Station key for the station-index form (never collides with a station id). */
function stationIndexKey(index: number): string {
  return `#station:${index}`;
}

export interface StandbyHandle {
  uniforms: StandbyUniforms;
  /** Spread onto a `<meshStandardMaterial>` (or several — they share the uniforms). */
  materialProps: StandbyMaterialProps;
}

const scratchFog = new THREE.Color();

/**
 * Standby dim for one data subject. Returns the uniforms (created once with
 * the hook — pass them to the material at construction) and the standard
 * material props. Drives the eased value per frame from the hysteretic
 * nearest station, the partial-face table and the focus store.
 */
export function useStandbyDim(options: StandbyOptions): StandbyHandle {
  const { subjectId, faceIds, ownsFocus } = options;
  const surfaces = 'surfaces' in options ? options.surfaces : null;
  const stationIndex = 'stationIndex' in options ? options.stationIndex : null;
  const { conductor, debug } = useWorldState();
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const uniforms = useMemo(() => createStandbyUniforms(), []);
  const materialProps = useMemo(() => standbyMaterialProps(uniforms), [uniforms]);
  const table = useMemo(() => (surfaces ? partialFaceTable(surfaces) : null), [surfaces]);
  const faceStations = useMemo(
    () =>
      surfaces
        ? faceIds.map((id) => surfaces.faces.find((face) => face.id === id)?.station ?? '').filter(Boolean)
        : stationIndex !== null
          ? [stationIndexKey(stationIndex)]
          : [],
    [faceIds, surfaces, stationIndex],
  );
  const levelRef = useRef<StandbyLevel | null>(null);
  const keyRef = useRef<symbol>(Symbol(subjectId));

  useEffect(() => {
    const key = keyRef.current;
    return () => {
      rows.delete(key);
      uninstallReadoutIfIdle();
    };
  }, []);

  useFrame((_, delta) => {
    const nearest = conductor.progress.current?.nearest;
    const activeStationId =
      typeof nearest !== 'number'
        ? null
        : surfaces
          ? (surfaces.stations[nearest]?.id ?? null)
          : stationIndexKey(nearest);
    const viewport = viewportKeyFor(size.width, size.height);
    const partialIds = activeStationId && table ? (table[activeStationId]?.[viewport] ?? []) : [];
    const focus = focusStore.get();
    const rawFocusId = focus.subject?.id ?? null;
    // A focus on a subject this face owns (ledger columns) counts as its own.
    const focusId = rawFocusId !== null && ownsFocus?.(rawFocusId) ? subjectId : rawFocusId;
    const decision = standbyTarget({
      subjectId,
      faceStations,
      faceIds,
      activeStationId,
      partialIds,
      focusId,
      focusPhase: focus.phase,
    });
    // The first frame lands AT its target: a board that mounts while its
    // station is elsewhere must not fade down in front of the visitor.
    const prev = levelRef.current ?? createStandbyLevel(decision.target);
    const next = stepStandby(prev, decision.target, delta * 1000);
    levelRef.current = next;
    uniforms.uStandby.value = standbyCurve(next.level);

    const fog = scene.fog;
    if (fog) uniforms.uStandbyFog.value.copy(fog.color);
    else if (scene.background instanceof THREE.Color) uniforms.uStandbyFog.value.copy(scene.background);
    else uniforms.uStandbyFog.value.copy(scratchFog.set('#808080'));

    if (debug) {
      if (!rows.has(keyRef.current)) installReadout();
      rows.set(keyRef.current, {
        subjectId,
        faceIds,
        station: faceStations[0] ?? null,
        activeStationId,
        viewport,
        target: decision.target,
        reason: decision.reason,
        value: uniforms.uStandby.value,
        transitions: next.transitions,
      });
    }
  });

  return { uniforms, materialProps };
}
