'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import * as THREE from 'three';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useMountainPalette } from '../use-mountain-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import {
  buildTrailSignPayloads,
  paintTrailSign,
  SIGN_TEX_H,
  SIGN_TEX_W,
  TRAIL_SIGN_INK,
  TRAIL_SIGN_WOOD,
  type SignPayload,
} from '../content/paint';
import { MOUNTAIN_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { MountainRouteData } from '../types';
import { useStandbyDim, type StandbyMaterialProps } from '@/components/world/route/useStandbyDim';
import { MOUNTAIN_DATA_SURFACES } from './data-faces';
import {
  SIGNS,
  SIGNS_ROW_YAW,
  SIGNS_SURROUND,
  signClothWidthFor,
  signLocalToWorld,
  signSeatsFor,
  type SignSeat,
} from './layout';
import { Bench, SignPost } from './Props';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #schedule hero: the trail-sign meadow on the north-east shore. Every
 * sign face is painted once from `buildBoardContent(data, locale)` — this
 * matchday's fixtures, the next matchday, the latest results and the league
 * pulse — so standings and fixtures arrive through the W2 builder, exactly
 * the plaza's data path, in the viewer's language. A hiker bench, a foot
 * boulder pair and a direction signpost dress the meadow stop.
 */

/** Sign plane size (TrailSign's W/H) and its hanging arm's local geometry. */
const SIGN_W = 2.0;
const SIGN_H = 6.0;
const SIGN_ARM_Y = 7.1;
const SIGN_CLOTH_Z = 0.075;

/** The row yaw — every sign plane faces the schedule camera (south-south-west). */
const ROW_YAW = SIGNS_ROW_YAW;

/**
 * Hand-authored world AABB of the whole sign row: the schedule content
 * spans all five signs (fixtures, up next, results, pulse, table), and
 * auto-measure would include the 7.4 m poles and finials. Built from every
 * cloth's four footprint corners through the shared `signLocalToWorld` law
 * (the mobile arc seats signs at different depths), padded 0.15 m laterally
 * and 0.14 m in depth around arm (z 0.06) and cloth (z 0.075). One box per
 * seat set (fidelity W1 r2: flat on desktop, arced on mobile).
 */
function rowBounds(seats: readonly SignSeat[]): SubjectBounds {
  const halfH = SIGN_H / 2 + 0.12;
  const centreY = SIGN_ARM_Y - SIGN_H / 2 - 0.06;
  const xs: number[] = [];
  const zs: number[] = [];
  for (const seat of seats) {
    for (const dx of [-(SIGN_W / 2 + 0.15), SIGN_W / 2 + 0.15]) {
      for (const dz of [SIGN_CLOTH_Z - 0.14, SIGN_CLOTH_Z + 0.14]) {
        const [x, , z] = signLocalToWorld(seat, [dx, 0, dz]);
        xs.push(x);
        zs.push(z);
      }
    }
  }
  return {
    min: [Math.min(...xs), centreY - halfH, Math.min(...zs)],
    max: [Math.max(...xs), centreY + halfH, Math.max(...zs)],
  };
}

const ROW_BOUNDS_DESKTOP = rowBounds(signSeatsFor(false));
const ROW_BOUNDS_MOBILE = rowBounds(signSeatsFor(true));

/** The signs' world normal: the row frame's local +Z swung by `ROW_YAW`. */
const ROW_FACING: Vec3Tuple = [Math.sin(ROW_YAW), 0, Math.cos(ROW_YAW)];

const SCHEDULE_PANEL: SubjectPanel = { param: 'board', value: 'schedule' };

/** The row's data-face ids (data-faces.ts `schedule:sign:<i>`) — the standby dim's key. */
const SCHEDULE_FACE_IDS = MOUNTAIN_DATA_SURFACES.faces
  .filter((face) => face.id.startsWith('schedule:sign:'))
  .map((face) => face.id);

/** Pole + one painted sign (1:3 portrait board). */
function TrailSign({
  seat,
  clothW,
  paint,
  night,
  palette,
  standby,
}: {
  /** Its seat on the row (layout.ts `signSeatsFor`) — row frame, row yaw. */
  seat: SignSeat;
  /** Cloth width (layout.ts `signClothWidthFor`) — narrower on mobile (W1 r3 seams). */
  clothW: number;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) => void;
  night: boolean;
  palette: ReturnType<typeof useMountainPalette>;
  /** The row's shared standby patch (fidelity wave 2, 2F). */
  standby: StandbyMaterialProps;
}) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  // C-105 r1: each sign face is a board page — shared paint path (schedule
  // station). C-103 r1: the face grew 1.15 → 2.0 m (canvas 320 unchanged) so
  // the station's floored lines — 35 painter px, pose-derived — hold whole
  // words at MEASURED widths (the C-102 r2 banner fix for the same defect
  // class; the physical face is the only lever). Physical height follows the
  // canvas ratio (2.0 × 960/320 = 6.0 m).
  const texture = usePaintedBoardTexture(paint, SIGN_TEX_W, SIGN_TEX_H, MOUNTAIN_STATIONS[3], clothW);
  // Sign plane: 2.0 m wide × 6.0 m tall (the texture's 1:3), hung at the
  // 7.1 m arm — the r1 spot still showed the 5.9 m arm sinking the cloth's
  // bottom band/footer behind the knoll's east shoulder silhouette at the
  // schedule poses (the mound renders >1 m proud of the field at its toe).
  // At 7.1 the footer rides at world y ≈ 1.9, clear of the cut.
  const W = clothW;
  const H = clothW * (SIGN_TEX_H / SIGN_TEX_W);
  return (
    <group position={[seat.lx, 0, seat.lz]}>
      {/* Pole. */}
      <mesh position={[0, 3.7, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, 7.4, 8]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.7} metalness={0.12} />
      </mesh>
      <mesh position={[0, 7.44, 0]} castShadow>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Cross-arm the sign hangs from. */}
      <mesh position={[0, 7.1, 0.06]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, W + 0.18, 8]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.7} metalness={0.12} />
      </mesh>
      {texture ? (
        <mesh position={[0, 7.1 - H / 2 - 0.06, 0.075]} castShadow receiveShadow>
          <planeGeometry args={[W, H]} />
          {/* Fidelity W1 r5: the self-lit data-face lever (FestivalBanners /
              SummitCairn). Lit, the tan cloth rendered ≈ rgb 177,148,122 —
              far lighter than its #8a6f4d texel — so the ink fell to ≈ 2.6:1
              and every contrast choice made in texture space was wrong on
              screen. Base colour black + envMapIntensity 0 leave the cloth to
              its own emission: the render keeps the painted wood/ink pair.
              Wave-2 r3 (LUMA, W1 "mountain-dark schedule face P99 161.4 vs
              167.1"): night 0.7 → 0.85, still well under the data ceiling. */}
          <meshStandardMaterial
            map={texture}
            color="#000000"
            emissiveMap={texture}
            emissive="#ffffff"
            emissiveIntensity={night ? 0.85 : 0.95}
            roughness={1}
            metalness={0}
            ref={bindEnv}
            envMapIntensity={0}
            side={THREE.DoubleSide}
            // Fidelity W1 r3: data faces take no scene fog.
            fog={false}
            {...standby}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export default function TrailSigns() {
  const palette = useMountainPalette();
  const data = useRouteData<MountainRouteData>();
  const night = palette.exposure < 0.75;
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);

  // Fidelity W1 r2: one pure builder (mountain content/paint.ts) — unique
  // top bands per sign instead of five "SCHEDULE" kickers.
  const payloads = useMemo<SignPayload[]>(
    () => buildTrailSignPayloads(content, undefined, locale),
    [content, locale],
  );
  // The arc only where the rig lands on the mobile endpoint (the same flag
  // that picks `cameraMobile`); the flat 2.2 m row with air gaps elsewhere.
  const { mobile } = useWorldState();
  const seats = signSeatsFor(mobile);
  const clothW = signClothWidthFor(mobile);
  // Fidelity wave 2 (2F): the whole row stands by as one subject.
  const standby = useStandbyDim({
    surfaces: MOUNTAIN_DATA_SURFACES,
    subjectId: 'board:schedule',
    faceIds: SCHEDULE_FACE_IDS,
  });

  const colors = useMemo(
    () => ({ wood: TRAIL_SIGN_WOOD, ink: TRAIL_SIGN_INK, accent: palette.boardAccent }),
    [palette],
  );

  const paints = useMemo(
    () =>
      payloads.map(
        (payload) => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
          paintTrailSign(ctx, w, h, payload, colors, tools, locale),
      ),
    [payloads, colors, locale],
  );

  return (
    <group>
      <FocusSubject
        id="board:schedule"
        kind="board"
        label={t('subjects.mountain.schedule')}
        facing={ROW_FACING}
        panel={SCHEDULE_PANEL}
        bounds={mobile ? ROW_BOUNDS_MOBILE : ROW_BOUNDS_DESKTOP}
      >
        {/* Face the sign planes toward the schedule camera (south-south-west);
            on mobile each sign sits on its arced seat (bowed toward the eye,
            ends receding) so the whole row fits the landed 390 frame; on
            desktop the flat row keeps its air gaps. */}
        <group position={[SIGNS.x, 0, SIGNS.z]} rotation={[0, ROW_YAW, 0]}>
          {paints.map((paint, i) => (
            <TrailSign
              key={i}
              seat={seats[i]}
              clothW={clothW}
              paint={paint}
              night={night}
              palette={palette}
              standby={standby.materialProps}
            />
          ))}
        </group>
      </FocusSubject>
      {/* The meadow-stop dressing (angle-checked, see layout.ts). */}
      <Bench x={SIGNS_SURROUND.bench.x} z={SIGNS_SURROUND.bench.z} yaw={SIGNS_SURROUND.bench.yaw} />
      <SignPost x={SIGNS_SURROUND.signpost.x} z={SIGNS_SURROUND.signpost.z} yaw={0.9} />
      {/* Foot boulders. */}
      {SIGNS_SURROUND.boulders.map((b) => (
        <mesh key={`${b.x},${b.z}`} position={[b.x, b.r * 0.62, b.z]} scale={[1, 0.72, 0.9]} castShadow receiveShadow>
          <icosahedronGeometry args={[b.r, 1]} />
          <meshStandardMaterial color={palette.rockColor} roughness={0.95} metalness={0.02} flatShading />
        </mesh>
      ))}
    </group>
  );
}
