'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useDataLocale, useLocale } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { SubjectBounds, Vec3Tuple } from '@/lib/route-world/focus';
import { REDUCED_MOTION_QUERY } from '@/lib/route-world/quality';
import {
  ROLL_CALL_GATE_IDLE,
  nextRollCallTick,
  rollCallCallAt,
  rollCallDoneAt,
  rollCallLights,
  stepRollCallGate,
  type ColumnLight,
  type RollCallGate,
} from '@/lib/route-world/roll-call';
import type { LedgerLayout } from '@/lib/route-world/teams-formation';
import { focusStore, useFocusState } from '../focus/focus-store';
import { emitRollCall } from '@/lib/route-world/ambient-beats';
import { getActiveFigureDirector } from '../figures/FigureDirector';
import { skipThroughOf } from '../useScrollConductor';
import { useStandbyDim } from '../useStandbyDim';
import { useStationSettle } from '../useStationSettle';
import { useWorldState } from '../WorldStateProvider';
import { paintLedger, type LedgerColumnCopy, type LedgerColumnFit, type LedgerStyle } from './ledger-painter';
import type { LedgerMaterial } from './ledger-styles';

/**
 * The Roll-Call Ledger (fidelity wave 2, seat 2G; D16): the one rail at the
 * teams forecourt's front edge that names every trainer, in standings order,
 * each column under its own statue. It replaces the per-pedestal plaques in
 * all four worlds — a name the thing it names can never cover.
 *
 * Budget: exactly TWO meshes — the leaning slab (bezel) and the painted face
 * — against the 8 × 2 plaque meshes it retires (−14 draws per teams
 * station; the invisible hit plane is never drawn). The face is a board-local
 * canvas repainted only on roll-call ticks (≤ 2 N repaints per arrival).
 *
 * Focus: every column is its trainer's statue subject (`team:<id>` — the
 * same FocusSubject the pedestal registers; a click or hover on the column
 * resolves to it), and the rail itself registers `ledger:teams` (no panel —
 * focusing it frames the rail; the luma harness judges the teams station on
 * it). The rail's subject is registered straight on the store, not through a
 * `FocusSubject`, so it adds no proxy box that would steal the column clicks.
 */


/** Module store the wave-3 fidget hook and the evidence readout key on. */
interface RollCallState {
  startedAt: number | null;
  arrivals: number;
  columns: number;
}

const rollCallState: RollCallState = { startedAt: null, arrivals: 0, columns: 0 };
const rollCallListeners = new Set<() => void>();

export const rollCall = {
  /** `performance.now()` of the current arrival's call (null at rest). */
  startedAt(): number | null {
    return rollCallState.startedAt;
  },
  subscribe(listener: () => void): () => void {
    rollCallListeners.add(listener);
    return () => {
      rollCallListeners.delete(listener);
    };
  },
};

function publish(next: Partial<RollCallState>): void {
  Object.assign(rollCallState, next);
  for (const listener of rollCallListeners) listener();
}

type RollCallHost = Window & {
  __routeWorldRollCall?: () => RollCallState & { lights: ColumnLight[]; fits: LedgerColumnFit[] };
};

/**
 * Wave-2 r2 (W1 judge, 390): with a `?team=` panel docked as the phone's
 * bottom sheet, the busy ledger read through the sheet's glass behind its
 * chips. While a team panel is open on a phone the painted face drops to an
 * unlit black slate, so no world glyph reads through the panel body; the
 * sheet carries that trainer's data meanwhile. Round 2 live check: a
 * #262626 / 0.04 dim still left "▲2 Nele Brandt" legible through the glass,
 * so diffuse AND emissive go to zero (the canvas only modulates those two —
 * the uniform roughness sheen carries no glyph). Uniform-only: no program
 * recompile at the focus moment.
 */
const LEDGER_DIM_COLOR = '#000000';
const LEDGER_DIM_EMISSIVE = 0;

/**
 * Wave-2 r3 (LUMA, W1 "plaza teams-390 face P99 179.9 vs 198.6"): the face's
 * own emission, lifted from 0.4 / 0.85 so the active ledger out-reads the
 * light-theme sky strip and the night lamp pools around it. The standby
 * patch's luminance ceiling (`DATA_EMISSIVE_CEILING`) still caps the glyphs
 * under the bloom threshold, and a neighbour ledger stands by (× 0.3).
 */
const LEDGER_EMISSIVE_DAY = 0.52;
const LEDGER_EMISSIVE_NIGHT = 0.95;
const LEDGER_FACE_IDS = ['teams:ledger'] as const;
/** The ledger's columns are `team:<id>` subjects: focusing one lights the ledger. */
const ownsTeamFocus = (focusId: string): boolean => focusId.startsWith('team:');

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** A box whose top verts lean back by tan(tilt) — one mesh from the ground to the face top. */
function slabGeometry(width: number, height: number, depth: number, tilt: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height / 2, -depth / 2);
  const position = geometry.getAttribute('position');
  const lean = Math.tan(tilt);
  for (let i = 0; i < position.count; i += 1) {
    position.setZ(i, position.getZ(i) - position.getY(i) * lean);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The rail's one canvas + texture, created outside React state (the Board
 * ticker idiom): `paint` redraws the canvas in place and flags the upload.
 */
function createLedgerSurface(
  width: number,
  height: number,
): { texture: THREE.CanvasTexture; paint: <T>(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => T) => T | null } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const paint = <T,>(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => T): T | null => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const out = fn(ctx, canvas.width, canvas.height);
    texture.needsUpdate = true;
    return out;
  };
  return { texture, paint };
}

export default function RollCallLedger({
  layout,
  copy: copyIn,
  style,
  material,
  night,
  teamsIndex,
  label,
}: {
  layout: LedgerLayout;
  /** Standings order; `id` = the trainer id (the `team:<id>` subject); species as stored (English). */
  copy: readonly LedgerColumnCopy[];
  style: LedgerStyle;
  material: LedgerMaterial;
  night: boolean;
  /** The teams station's index in this world's route. */
  teamsIndex: number;
  /** The rail subject's label (the viewer's language). */
  label: string;
}) {
  // i18n D11: words in the viewer's language, aces in the viewer's
  // Pokémon-data language — both known before the first paint.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const copy = useMemo(
    () => copyIn.map((column) => (column.species ? { ...column, species: localizeSpecies(column.species, dataLocale) } : column)),
    [copyIn, dataLocale],
  );
  const { conductor, debug, mobile } = useWorldState();
  const { station, settled } = useStationSettle();
  const focus = useFocusState();
  const teamPanelOpen =
    mobile && focus.subject?.panel?.param === 'team' && (focus.phase === 'focusing' || focus.phase === 'focused');
  // Wave-2 r3 (LUMA): a neighbour ledger stands by like every other data face
  // (the station-index form — this rail never sees its world's surfaces).
  const standby = useStandbyDim({
    stationIndex: teamsIndex,
    subjectId: 'ledger:teams',
    faceIds: LEDGER_FACE_IDS,
    ownsFocus: ownsTeamFocus,
  });

  // ── Canvas + texture (one per rail; repainted in place) ────────────────
  const surface = useMemo(
    () => createLedgerSurface(layout.canvas.width, layout.canvas.height),
    [layout.canvas.width, layout.canvas.height],
  );
  useEffect(() => () => surface?.texture.dispose(), [surface]);
  const texture = surface?.texture ?? null;

  const lightsRef = useRef<ColumnLight[]>(rollCallLights(copy.length, null));
  const fitsRef = useRef<LedgerColumnFit[]>([]);

  const repaint = useCallback(
    (lights: ColumnLight[]) => {
      lightsRef.current = lights;
      const fits = surface?.paint((ctx, w, h) => paintLedger(ctx, w, h, layout, copy, lights, style, locale));
      if (fits) fitsRef.current = fits;
    },
    [surface, layout, copy, style, locale],
  );

  // ── Roll call: once per arrival, on the latched settle ─────────────────
  // No React state: the call is a timer chain that repaints the canvas on
  // its ticks; the React tree never re-renders for it.
  const gateRef = useRef<RollCallGate>(ROLL_CALL_GATE_IDLE);
  const runRef = useRef<number | null>(null);
  const timerRef = useRef(0);
  const repaintRef = useRef(repaint);
  const countRef = useRef(copy.length);
  const copyRef = useRef(copy);

  const paintNow = useCallback(() => {
    const run = runRef.current;
    repaintRef.current(rollCallLights(countRef.current, run === null ? null : performance.now() - run));
  }, []);

  const stopCall = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    runRef.current = null;
  }, []);

  const startCall = useCallback(() => {
    window.clearTimeout(timerRef.current);
    const run = performance.now();
    runRef.current = run;
    const step = () => {
      const elapsed = performance.now() - run;
      repaintRef.current(rollCallLights(countRef.current, elapsed));
      const next = nextRollCallTick(countRef.current, elapsed);
      timerRef.current =
        next !== null && elapsed < rollCallDoneAt(countRef.current) + 50
          ? window.setTimeout(step, Math.max(0, next - elapsed))
          : 0;
    };
    step();
  }, []);

  // The latest painter + count for the timer chain; repaint when they change
  // (rest, or the call's current lights mid-sweep).
  useEffect(() => {
    repaintRef.current = repaint;
    countRef.current = copy.length;
    copyRef.current = copy;
    paintNow();
  }, [repaint, copy, paintNow]);

  useEffect(() => {
    const skip = skipThroughOf(conductor.progress.current);
    const { gate, start, leave } = stepRollCallGate(gateRef.current, {
      station,
      settled,
      teamsIndex,
      skipActive: skip.active,
      skipTo: skip.to,
      reducedMotion: prefersReducedMotion(),
    });
    gateRef.current = gate;
    if (start) {
      publish({ startedAt: performance.now(), arrivals: rollCallState.arrivals + 1, columns: countRef.current });
      // POKEMON-CORE A2 (D16): the call's participants in ledger order and each column's start (s) → the director's roll call.
      // R35: `emitRollCall` stamps the event with the bus's awake clock (D40), like every other event on the channel.
      emitRollCall(getActiveFigureDirector()?.bus, copyRef.current.map((c) => c.id), copyRef.current.map((_, k) => rollCallCallAt(k) / 1000));
      startCall();
    } else if (leave) {
      publish({ startedAt: null });
      stopCall();
      paintNow();
    }
  }, [station, settled, teamsIndex, conductor, startCall, stopCall, paintNow]);

  useEffect(() => stopCall, [stopCall]);

  // ── The rail's own focus subject (store-registered; no proxy box) ──────
  const railBounds = useMemo<SubjectBounds>(() => {
    const corners: [number, number, number][] = [];
    const hw = layout.width / 2 + layout.margin;
    const hh = layout.height / 2 + layout.margin;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        corners.push([
          layout.center[0] + layout.right[0] * hw * sx + layout.up[0] * hh * sy,
          layout.center[1] + layout.right[1] * hw * sx + layout.up[1] * hh * sy,
          layout.center[2] + layout.right[2] * hw * sx + layout.up[2] * hh * sy,
        ]);
      }
    }
    corners.push([layout.base[0], layout.base[1], layout.base[2]]);
    const min = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a])));
    const max = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a])));
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
  }, [layout]);
  const facing = useMemo<Vec3Tuple>(() => {
    const len = Math.hypot(layout.normal[0], layout.normal[2]) || 1;
    return [layout.normal[0] / len, 0, layout.normal[2] / len];
  }, [layout]);

  useEffect(
    () => focusStore.register({ id: 'ledger:teams', kind: 'ledger', label, facing, bounds: railBounds }),
    [label, facing, railBounds],
  );

  // Evidence readout (debug builds only — the other bridges' rule).
  useEffect(() => {
    if (!debug) return;
    const host = window as RollCallHost;
    host.__routeWorldRollCall = () => ({ ...rollCallState, lights: [...lightsRef.current], fits: [...fitsRef.current] });
    return () => {
      delete host.__routeWorldRollCall;
    };
  }, [debug]);

  // ── Geometry ───────────────────────────────────────────────────────────
  const rise = layout.center[1] - layout.base[1];
  const alongUp = rise / Math.cos(layout.tilt);
  const slabHeight = (alongUp + layout.height / 2 + layout.margin) * Math.cos(layout.tilt);
  const slab = useMemo(
    () => slabGeometry(layout.width + layout.margin * 2, slabHeight, layout.thickness, layout.tilt),
    [layout.width, layout.margin, slabHeight, layout.thickness, layout.tilt],
  );
  useEffect(() => () => slab.dispose(), [slab]);
  // Face centre in the slab's local frame (+Z toward the eye, +Y up).
  const faceLocal: [number, number, number] = [0, rise, -rise * Math.tan(layout.tilt)];

  // ── Column hit mapping (one invisible plane over the face) ─────────────
  const hoveredRef = useRef<string | null>(null);
  const subjectAt = (event: ThreeEvent<PointerEvent | MouseEvent>): string => {
    const uv = event.uv;
    if (!uv) return 'ledger:teams';
    const across = (uv.x - 0.5) * layout.width;
    const line: 0 | 1 = layout.lines === 2 && uv.y < 0.5 ? 1 : 0;
    // Wave-2 r3: the painter re-tiles the cells by ink, so the painted cells
    // (the last paint's fits) are the hit map; the layout cells are the
    // fallback before the first paint.
    const painted = fitsRef.current.find((f) => f.cell.line === line && across >= f.cell.left && across <= f.cell.right);
    if (painted) return `team:${painted.id}`;
    const hit = layout.columns.find((c) => c.line === line && Math.abs(c.cellAcross - across) <= c.width / 2);
    return hit ? `team:${hit.id}` : 'ledger:teams';
  };
  const setHover = (id: string | null) => {
    if (hoveredRef.current === id) return;
    if (hoveredRef.current) focusStore.unhover(hoveredRef.current);
    hoveredRef.current = id;
    if (id) focusStore.hover(id);
  };
  useEffect(
    () => () => {
      if (hoveredRef.current) focusStore.unhover(hoveredRef.current);
    },
    [],
  );

  return (
    <group position={[layout.base[0], layout.base[1], layout.base[2]]} rotation={[0, layout.yaw, 0]} name="teams-ledger">
      <mesh geometry={slab} castShadow receiveShadow name="teams-ledger-slab">
        <meshStandardMaterial color={material.bezel} roughness={material.roughness} metalness={material.metalness} />
      </mesh>
      <group position={faceLocal} rotation={[-layout.tilt, 0, 0]}>
        {texture ? (
          <mesh position={[0, 0, 0.004]} name="teams-ledger-face">
            <planeGeometry args={[layout.width, layout.height]} />
            <meshStandardMaterial
              map={texture}
              emissiveMap={texture}
              color={teamPanelOpen ? LEDGER_DIM_COLOR : '#ffffff'}
              emissive="#ffffff"
              emissiveIntensity={teamPanelOpen ? LEDGER_DIM_EMISSIVE : night ? LEDGER_EMISSIVE_NIGHT : LEDGER_EMISSIVE_DAY}
              roughness={0.5}
              metalness={0.05}
              fog={false}
              {...standby.materialProps}
            />
          </mesh>
        ) : null}
        <mesh
          position={[0, 0, 0.012]}
          visible={false}
          userData={{ focusSubject: 'ledger:teams' }}
          onClick={(event) => {
            event.stopPropagation();
            const id = subjectAt(event);
            const current = focusStore.get();
            if (current.subject?.id === id && current.phase !== 'releasing') return;
            focusStore.focusById(id);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            document.body.style.cursor = 'pointer';
            if (event.nativeEvent.pointerType !== 'touch') setHover(subjectAt(event));
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
            setHover(null);
          }}
        >
          <planeGeometry args={[layout.width, layout.height]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}
