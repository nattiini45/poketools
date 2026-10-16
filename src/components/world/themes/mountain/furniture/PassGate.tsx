'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useMountainPalette } from '../use-mountain-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintPlaque, plaqueCopy, PLAQUE_TEX_H, PLAQUE_TEX_W } from '../content/paint';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import { MOUNTAIN_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { MountainRouteData } from '../types';
import { GATE, GATE_SURROUND, GATE_WAYMARKERS, RULES_SCRUBS } from './layout';
import StormLantern, {
  Bench,
  PennantCluster,
  RopeRailing,
  Scrub,
  SignPost,
  SnowPatch,
  SteppingStones,
} from './Props';
import { WaymarkerCairn } from './SummitCairn';
import { useStandbyDim } from '@/components/world/route/useStandbyDim';
import { MOUNTAIN_DATA_SURFACES } from './data-faces';

/**
 * The #rules hero — the entry moment: a great mountain-pass gate at the
 * valley's south entrance, facing the station camera (north). Procedural:
 * two battered stone pillars with splayed footings, a heavy timber lintel
 * with its cross-brace and snow-dusted caps, and a hanging tablet plaque
 * painted with the ruleset of record — the contract's stage-fallback-aware
 * `rulesetName` plus headline rules shaped by `plaqueCopy`. A storm-lantern
 * pair flanks the approach, and the GATE_SURROUND forecourt (scrub, rock,
 * bench, signpost, pennants, railing, stone aprons — the sakura rules-fix
 * tier) layers the midground the 21 m pose reads through; the trail passes
 * under the gate and into the valley.
 */

/** Pillar centres, gate-local metres. */
const HALF_SPAN = GATE.span / 2;

/**
 * The hanging tablet, in gate-local metres. One source for both the mesh and
 * the focus proxy, so the camera can never frame a box the paint moved out of.
 */
const TABLET = {
  w: 5.6,
  h: 2.24,
  d: 0.12,
  y: 4.1,
  z: 0.36,
} as const;

/**
 * Hand-authored world AABB of the tablet alone (the plaza Board / clouds
 * SkyGate discipline): auto-measure would swallow the 7.4 m span, both
 * battered pillars, the lintel stack and the approach lanterns, and the focus
 * camera would stand far too deep to read the rules rows at the painter floor.
 */
const TABLET_BOUNDS: SubjectBounds = {
  min: [GATE.x - TABLET.w / 2 - 0.1, TABLET.y - TABLET.h / 2 - 0.1, GATE.z + TABLET.z - TABLET.d / 2 - 0.15],
  max: [GATE.x + TABLET.w / 2 + 0.1, TABLET.y + TABLET.h / 2 + 0.1, GATE.z + TABLET.z + TABLET.d / 2 + 0.1],
};

/** The tablet's painted face looks north, down the trail, at the rules station. */
const TABLET_FACING: Vec3Tuple = [0, 0, 1];

/** The only rules value the overlay map answers (ThemeOverlays RULE_VALUES). */
const GATE_RULES_PANEL: SubjectPanel = { param: 'rules', value: 'gate' };

/** The tablet's data-face id (data-faces.ts) — the standby dim's key. */
const RULES_FACE_IDS = ['rules:tablet'] as const;
/**
 * Wave-2 r3 (LUMA, W1 "mountain-light rules face P99 203.1 vs 204.1"): the
 * tablet's day emission 0.3 → 0.38 so the stone ground clears the light sky
 * by a margin. Night keeps 0.9.
 */
const TABLET_EMISSIVE_DAY = 0.38;
const TABLET_EMISSIVE_NIGHT = 0.9;

export default function PassGate() {
  const palette = useMountainPalette();
  const night = palette.exposure < 0.75;
  const { formatRules, rulesetName, league, stages } = useRouteData<MountainRouteData>();
  // The format decides the rows (EPB draft numbers, else format and best-of);
  // primitives as deps so the plaque repaints only when they change.
  const { format, bestOf } = rulesCopyContext({ league, stages });
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);

  const copy = useMemo(
    () => plaqueCopy(formatRules, rulesetName, { format, bestOf }, locale),
    [formatRules, rulesetName, format, bestOf, locale],
  );
  const paint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      // Light tablet ground (dark ink on warm stone): the near-black ground
      // first tried on the park's plaque read as a void at distance — the
      // valley's tablet is sun-lit stone from the start.
      paintPlaque(ctx, w, h, copy, { ground: '#ddd5c2', ink: '#2b2f26', accent: palette.boardAccent }, tools, locale),
    [copy, palette.boardAccent, locale],
  );
  // C-105 r1: the gate tablet is a board page — shared paint path (rules
  // station, 5.6 m board face).
  const plaque = usePaintedBoardTexture(paint, PLAQUE_TEX_W, PLAQUE_TEX_H, MOUNTAIN_STATIONS[4], TABLET.w);

  const stone = palette.rockColor;
  // Wave-2 r3 (LUMA): the tablet stands by away from the rules station.
  const standby = useStandbyDim({ surfaces: MOUNTAIN_DATA_SURFACES, subjectId: 'rules:gate', faceIds: RULES_FACE_IDS });

  return (
    <>
      {/* The pass-gate forecourt, world-anchored (GATE_SURROUND): ground
          dressing, flanking props and a layered approach — the sakura
          rules-fix tier, so the 21 m pose reads a lived-in entrance instead
          of an empty meadow. Anchors are angle-checked in layout.ts against
          BOTH rules poses and clear the trail corridors. */}
      <group>
        {GATE_SURROUND.scrub.map((s, i) => (
          <Scrub key={`${s.x},${s.z}`} x={s.x} z={s.z} s={0.85 + (i % 2) * 0.25} />
        ))}
        {/* C-103 r3: the rules-center scrub fill (RULES_SCRUBS) — planted
            rest-stop clusters folded into the center/far beats, the station's
            own scrub vocabulary (see layout.ts for the scan of record). */}
        {RULES_SCRUBS.map((s) => (
          <Scrub key={`r3-${s.x},${s.z}`} x={s.x} z={s.z} s={s.s} />
        ))}
        {GATE_SURROUND.boulders.map((b) => (
          <mesh
            key={`${b.x},${b.z}`}
            position={[b.x, b.r * 0.62, b.z]}
            scale={[1, 0.72, 0.9]}
            castShadow
            receiveShadow
          >
            <icosahedronGeometry args={[b.r, 1]} />
            <meshStandardMaterial
              color={palette.rockColor}
              roughness={0.95}
              metalness={0.02}
              flatShading
            />
          </mesh>
        ))}
        <Bench x={GATE_SURROUND.bench.x} z={GATE_SURROUND.bench.z} yaw={GATE_SURROUND.bench.yaw} />
        <SignPost x={GATE_SURROUND.signpost.x} z={GATE_SURROUND.signpost.z} yaw={2.1} />
        <PennantCluster poles={GATE_SURROUND.pennants} />
        <RopeRailing x={GATE_SURROUND.railing.x} posts={GATE_SURROUND.railing.posts} />
        {GATE_SURROUND.aprons.map((a, i) => (
          <SteppingStones
            key={i}
            x0={a.x0}
            x1={a.x1}
            z0={a.z0}
            z1={a.z1}
            count={7}
            seed={820 + i * 41}
          />
        ))}
        {/* The pass's own trail vocabulary: a waymarker cairn line flanking
            the worn approach (mouth pair at the gate shoulders, then stones
            stepping south toward the ring plaza). Seated on the flat meadow
            disc (knollHeight ≡ 0 out here — the knoll is 25+ m north);
            GATE_WAYMARKERS in layout.ts carries the both-pose projection and
            clearance numbers. */}
        {GATE_WAYMARKERS.cairns.map((c) => (
          <WaymarkerCairn key={`${c.x},${c.z}`} x={c.x} z={c.z} s={c.s} seatY={0.02} />
        ))}
      </group>
      <FocusSubject
        id="rules:gate"
        kind="rules"
        label={t('subjects.mountain.rules')}
        facing={TABLET_FACING}
        panel={GATE_RULES_PANEL}
        bounds={TABLET_BOUNDS}
      >
      <group position={[GATE.x, 0, GATE.z]}>
      {/* Approach storm lanterns flanking the south trail (layout.ts): the
          mid-ground pair the 21 m rules pose otherwise reads past as empty
          meadow. */}
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          position={[side * GATE.approachLantern.x, 0, GATE.approachLantern.z - GATE.z]}
        >
          <StormLantern scale={1.5} night={night} practical={side === 1} />
        </group>
      ))}
      {/* Stone footings flanking the gate mouth. */}
      {GATE.footings.map((f) => (
        <mesh key={f.x} position={[f.x - GATE.x, 0.35, f.z - GATE.z]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 0.7, 0.9]} />
          <meshStandardMaterial color={palette.cliffColor} roughness={0.94} metalness={0.02} flatShading />
        </mesh>
      ))}
      {/* Pillars: battered tapered stone, sunk and slightly splayed. */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * HALF_SPAN, 0, 0]} rotation={[0, 0, side * -0.01]}>
          <mesh position={[0, GATE.height * 0.44, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.62, 0.92, GATE.height * 0.88, 8]} />
            <meshStandardMaterial color={stone} roughness={0.92} metalness={0.02} />
          </mesh>
          {/* Stone base collar. */}
          <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.05, 1.18, 0.64, 8]} />
            <meshStandardMaterial color={palette.cliffColor} roughness={0.94} metalness={0.02} />
          </mesh>
          {/* Snow cap on the pillar head. */}
          <SnowPatch x={0} z={0} s={1.6} y={GATE.height * 0.88 + 0.1} />
        </group>
      ))}
      {/* Lintel: the heavy through-beam with its cross-brace. */}
      <mesh position={[0, GATE.height * 0.8, 0]} castShadow>
        <boxGeometry args={[GATE.span + 1.6, 0.62, 0.66]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.72} metalness={0.06} />
      </mesh>
      <mesh position={[0, GATE.height * 0.92, 0]} castShadow>
        <boxGeometry args={[GATE.span + 2.2, 0.42, 0.56]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.74} metalness={0.05} />
      </mesh>
      {/* Snow roll on the lintel. */}
      <mesh position={[0, GATE.height * 0.92 + 0.28, 0]} castShadow>
        <boxGeometry args={[GATE.span + 2.0, 0.14, 0.5]} />
        <meshStandardMaterial color={palette.snowColor} roughness={0.82} metalness={0} />
      </mesh>
      {/* Hanging tablet plaque between the beams — the painted rules face
          toward the north station camera. R4: sized for the 21.4 m station
          pose (the plaza arch frieze's scale — the r3 1.4 × 1.95 m card
          measured ~11 % of the 1440 frame and its text could not read). The
          5.6 × 2.24 m board spans the opening between the battered pillars
          (clear width ≈ 6.0 m at the board's top edge, ≈ 0.12 m margin per
          side) and reads ≈ 24 % of the 1440 frame / ≈ 44 % of the landed 390
          frame — inside the ≤ 60 % / ≤ 75 % board-face caps (measured from
          the r4 stills). The box carries the paint (no separate face plane):
          cream fallback while (or if) the paint uploads, so the gate never
          shows a black void. */}
      <mesh position={[0, TABLET.y, TABLET.z]} castShadow receiveShadow>
        <boxGeometry args={[TABLET.w, TABLET.h, TABLET.d]} />
        <meshStandardMaterial
          map={plaque}
          emissiveMap={plaque}
          emissive="#ffffff"
          emissiveIntensity={night ? TABLET_EMISSIVE_NIGHT : TABLET_EMISSIVE_DAY}
          color={plaque ? '#ffffff' : '#ddd5c2'}
          roughness={0.5}
          metalness={0.08}
          toneMapped={false}
          {...standby.materialProps}
        />
      </mesh>
      {/* Iron hangers bridging board top → lintel underside. */}
      {([-1.8, 1.8] as const).map((dx) => (
        <mesh key={dx} position={[dx, 5.32, 0.36]} castShadow>
          <boxGeometry args={[0.07, 0.34, 0.05]} />
          <meshStandardMaterial color="#2a2622" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
        {/* Warm up-light so the tablet reads after sunset. */}
        <pointLight
          position={[0, 1.4, 2.4]}
          color={palette.lanternGlow}
          intensity={night ? 16 : 1.6}
          distance={13}
          decay={2}
          castShadow={false}
        />
      </group>
      </FocusSubject>
    </>
  );
}
