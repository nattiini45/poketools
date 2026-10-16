'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import * as THREE from 'three';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useSakuraPalette } from '../use-sakura-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import {
  buildFestivalBannerPayloads,
  paintBanner,
  BANNER_TEX_H,
  BANNER_TEX_W,
  type BannerPayload,
} from '../content/paint';
import { SAKURA_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { SakuraRouteData } from '../types';
import { BANNERS, bannerRowFor } from './layout';
import { useStandbyDim, type StandbyMaterialProps } from '@/components/world/route/useStandbyDim';
import { SAKURA_DATA_SURFACES } from './data-faces';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #schedule hero: a festival banner row (nobori) on the north-east
 * shore. Every banner face is painted once from `buildBoardContent(data,
 * locale)` — this matchday's fixtures, the next matchday, the latest results
 * and the league pulse — so standings and fixtures arrive through the W2
 * builder, exactly the plaza's data path, in the viewer's language.
 */

/**
 * Cloth emission. Wave-2 r3 (LUMA, W1 "sakura-dark schedule-390 face P99
 * 153.6 vs a 158.9 path pool"): night 0.6 → 0.72 — the cloth ink still emits
 * well under the 1.6 data ceiling. Day keeps 0.95 (the light-theme sky
 * strip is an exposure clamp, not a face gain).
 */
const BANNER_EMISSIVE_NIGHT = 0.72;
const BANNER_EMISSIVE_DAY = 0.95;

/** Cross-arm height the cloth hangs from (pole grows with the cloth). */
const ARM_Y = 6.5;

/** Desktop cloth plane size (Banner's W/H, 1:3) and its local z on the row frame. */
const CLOTH_W = bannerRowFor(false).clothW;
const CLOTH_H = CLOTH_W * 3;
const CLOTH_Z = 0.075;

/** The row yaw — the banner plane faces the schedule camera (south-south-west). */
const ROW_YAW = Math.atan2(1.2 - BANNERS.x, -3.4 - BANNERS.z);

/**
 * Hand-authored world AABB of the whole cloth row, swung by `ROW_YAW` into
 * world axes: the schedule content spans all five banners (fixtures, up next,
 * results, pulse, table), and auto-measure would include the 7.4 m poles and
 * finials. The depth span covers arm (z 0.06) and cloth (z 0.075) plus margin.
 */
const ROW_BOUNDS: SubjectBounds = (() => {
  const sin = Math.sin(ROW_YAW);
  const cos = Math.cos(ROW_YAW);
  const halfW = ((BANNERS.count - 1) / 2) * BANNERS.spacing + CLOTH_W / 2 + 0.15;
  const halfH = CLOTH_H / 2 + 0.12;
  const centreY = ARM_Y - CLOTH_H / 2 - 0.06;
  const zc = CLOTH_Z;
  const hd = 0.14;
  const cx = BANNERS.x + zc * sin;
  const cz = BANNERS.z + zc * cos;
  const ex = halfW * Math.abs(cos) + hd * Math.abs(sin);
  const ez = halfW * Math.abs(sin) + hd * Math.abs(cos);
  return {
    min: [cx - ex, centreY - halfH, cz - ez],
    max: [cx + ex, centreY + halfH, cz + ez],
  };
})();

/** The cloths' world normal: the row frame's local +Z swung by `ROW_YAW`. */
const ROW_FACING: Vec3Tuple = [Math.sin(ROW_YAW), 0, Math.cos(ROW_YAW)];

const SCHEDULE_PANEL: SubjectPanel = { param: 'board', value: 'schedule' };

/** The row's data-face ids (data-faces.ts `schedule:banner:<i>`) — the standby dim's key. */
const SCHEDULE_FACE_IDS = SAKURA_DATA_SURFACES.faces
  .filter((face) => face.id.startsWith('schedule:banner:'))
  .map((face) => face.id);

/** Pole + one painted banner (`clothW`: layout.ts `bannerRowFor` — narrower on the landed 390 pose). */
function Banner({ x, clothW, paint, night, palette, standby }: { x: number; clothW: number; paint: (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) => void; night: boolean; palette: ReturnType<typeof useSakuraPalette>; standby: StandbyMaterialProps }) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  // C-105 r1: each nobori face is a board page — shared paint path (schedule
  // station). C-102 r2: the cloth widened 1.15 → 2.0 m at its 1:3 ratio
  // (6.0 m tall, poles raised to carry it), dropping the station's
  // pose-derived floor to 33 painter px so every fixture row re-flows and
  // reads COMPLETE (the r1 visual review's criterion-6 defect).
  // Fidelity W1 r4: the paint path gets the REAL face width, so the mobile
  // cloth's floor re-derives (never under the pose-derived minimum).
  const texture = usePaintedBoardTexture(paint, BANNER_TEX_W, BANNER_TEX_H, SAKURA_STATIONS[3], clothW);
  // Banner plane: `clothW` wide × 3·clothW tall (the texture's 1:3).
  const W = clothW;
  const H = clothW * 3;
  return (
    <group position={[x, 0, 0]}>
      {/* Pole. */}
      <mesh position={[0, 3.7, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.055, 7.4, 8]} />
        <meshStandardMaterial color="#4a3b33" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 7.44, 0]} castShadow>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color={palette.toriiRed} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Cross-arm the banner hangs from. */}
      <mesh position={[0, ARM_Y, 0.06]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, W + 0.18, 8]} />
        <meshStandardMaterial color="#4a3b33" roughness={0.6} metalness={0.3} />
      </mesh>
      {texture ? (
        <mesh position={[0, ARM_Y - H / 2 - 0.06, 0.075]} castShadow receiveShadow>
          <planeGeometry args={[W, H]} />
          {/* Fidelity W1 r3 (light-theme 390 read white-on-white): the
              self-lit data-face lever (the jumbotron / clouds flagship
              pattern). Lit, the cloth AND its ink took the same key + hemi +
              HDRI additive, which the AgX grade then lifted until the ink
              sat near the cloth. Base color black leaves the paint to its own
              emission: the ink keeps its painted value, no fog, no sheen. */}
          <meshStandardMaterial
            map={texture}
            color="#000000"
            emissiveMap={texture}
            emissive="#ffffff"
            emissiveIntensity={night ? BANNER_EMISSIVE_NIGHT : BANNER_EMISSIVE_DAY}
            roughness={1}
            metalness={0}
            side={THREE.DoubleSide}
            fog={false}
            ref={bindEnv}
            envMapIntensity={0}
            {...standby}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export default function FestivalBanners() {
  const palette = useSakuraPalette();
  const data = useRouteData<SakuraRouteData>();
  const night = palette.exposure < 0.75;
  // i18n D11: the viewer's language, read before the textures are built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);
  // Fidelity W1 r4: the narrower mobile row only where the rig lands on the
  // mobile endpoint (the same flag that picks it — mountain's TrailSigns law).
  const { mobile } = useWorldState();
  const row = bannerRowFor(mobile);
  // Fidelity wave 2 (2F): the whole row stands by as one subject.
  const standby = useStandbyDim({
    surfaces: SAKURA_DATA_SURFACES,
    subjectId: 'board:schedule',
    faceIds: SCHEDULE_FACE_IDS,
  });

  // Review r2 (W1): the payloads come from the shared builder in
  // content/paint.ts — PULSE rows are stats and TABLE rows standings, so
  // only the fixture/result banners ever pair names with "vs".
  const payloads = useMemo<BannerPayload[]>(
    () => buildFestivalBannerPayloads(content, undefined, locale),
    [content, locale],
  );

  const colors = useMemo(
    () => ({ cloth: palette.bannerCloth, ink: palette.bannerInk, accent: palette.toriiRed }),
    [palette],
  );

  const paints = useMemo(
    () =>
      payloads.map(
        (payload) => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
          paintBanner(ctx, w, h, payload, colors, tools, locale),
      ),
    [payloads, colors, locale],
  );

  return (
    <FocusSubject
      id="board:schedule"
      kind="board"
      label={t('subjects.sakura.schedule')}
      facing={ROW_FACING}
      panel={SCHEDULE_PANEL}
      bounds={ROW_BOUNDS}
    >
      {/* Face the banner plane toward the schedule camera (south-south-west). */}
      <group position={[BANNERS.x, 0, BANNERS.z]} rotation={[0, ROW_YAW, 0]}>
        {paints.map((paint, i) => (
          <Banner
            key={i}
            x={(i - (BANNERS.count - 1) / 2) * row.pitch}
            clothW={row.clothW}
            paint={paint}
            night={night}
            palette={palette}
            standby={standby.materialProps}
          />
        ))}
      </group>
    </FocusSubject>
  );
}
