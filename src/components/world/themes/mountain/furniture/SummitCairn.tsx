'use client';

import { useMemo } from 'react';
import { useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import * as THREE from 'three';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useMountainPalette } from '../use-mountain-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintSummitBoard, BOARD_TEX_H, BOARD_TEX_W } from '../content/paint';
import { MOUNTAIN_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { MountainRouteData } from '../types';
import { clampBoardLight, useStandbyDim } from '@/components/world/route/useStandbyDim';
import { MOUNTAIN_DATA_SURFACES } from './data-faces';
import { knollHeight, PULSE_WAYMARKERS, SUMMIT, SUMMIT_SURROUND } from './layout';
import {
  CacheBox,
  PennantCluster,
  RopeRailing,
  Scrub,
  seeded,
  SignPost,
  SnowPatch,
  StormLantern,
  TimberFence,
} from './Props';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #pulse hero — the landmark: the SUMMIT STATION. A stone tower on the
 * knoll's south-east shoulder carries the valley's standings board (the
 * summit plaque the whole league reads), framed by the snow-capped crag
 * pinnacles behind it and dressed with the summit station's working kit:
 * the rope-railed viewing deck at the switchback head, the trail-marker
 * pennants, the rescue cache box, a storm-lantern pair and snow patches on
 * the ledges — plus the midground waymarker beat on the bench south of the
 * deck (PULSE_WAYMARKERS). Content arrives through `buildBoardContent(data,
 * locale)` in the viewer's language; the tower is procedural granite, the face a painted slate field.
 */

/** Stone shoulder under the board: battered courses from the seat up. */
const SHOULDER_HALF_BOTTOM = 2.3;
const SHOULDER_HALF_TOP = 1.95;

/**
 * Seat lift for the waymarker beat: the knoll MOUND's vertex interpolation
 * renders ≈ 0.7-0.95 m proud of the analytic `knollHeight` field on this
 * flank (live raycast sweep of the r3 spot still: surface median ≈ 2.2 m at
 * the bench vs field 1.49). Seating at the field alone buries the stones —
 * they bed 0.7 m up, so the base tier sits in the rendered grass and the
 * crown clears the local bump (surface max 2.44 vs cairn top 2.95).
 */
const WAYMARKER_SEAT_LIFT = 0.7;

/** Board hardware depth along the tower group's local +Z: the granite bezel
 * box spans 0.47..0.77 (z 0.62, 0.3 deep) and the painted slate rides 0.79. */
const BOARD_Z0 = 0.42;
const BOARD_Z1 = 0.89;

/**
 * Hand-authored world AABB of the bezel + slate face, swung by
 * `SUMMIT.faceYaw` into world axes (the plaza Board's discipline).
 * Auto-measure would frame the whole cairn — tower shoulder, sill and finial
 * pennant — and the focus camera would stand far off the lit face instead.
 */
const BOARD_BOUNDS: SubjectBounds = (() => {
  const sin = Math.sin(SUMMIT.faceYaw);
  const cos = Math.cos(SUMMIT.faceYaw);
  const halfW = (SUMMIT.boardW + 0.6) / 2 + 0.1;
  const halfH = (SUMMIT.boardH + 0.6) / 2 + 0.1;
  const zc = (BOARD_Z0 + BOARD_Z1) / 2;
  const hd = (BOARD_Z1 - BOARD_Z0) / 2;
  const cx = SUMMIT.board.x + zc * sin;
  const cz = SUMMIT.board.z + zc * cos;
  const ex = halfW * Math.abs(cos) + hd * Math.abs(sin);
  const ez = halfW * Math.abs(sin) + hd * Math.abs(cos);
  return {
    min: [cx - ex, SUMMIT.board.y - halfH, cz - ez],
    max: [cx + ex, SUMMIT.board.y + halfH, cz + ez],
  };
})();

/** The board's world normal: the tower group's local +Z swung by `faceYaw`. */
const BOARD_FACING: Vec3Tuple = [Math.sin(SUMMIT.faceYaw), 0, Math.cos(SUMMIT.faceYaw)];

const PULSE_PANEL: SubjectPanel = { param: 'board', value: 'pulse' };

/** The summit board's data-face ids (data-faces.ts) — the standby dim's key. */
const PULSE_FACE_IDS = ['pulse:board'] as const;

/**
 * Fidelity wave 2 (2F): the board-layer spill light, clamped by the
 * luminance budget (`clampBoardLight`). It sits inside the bezel box, so the
 * face, bezel front and sides all see it from behind (N·L ≤ 0); the nearest
 * surface it lights head-on is the sill course top, 1.73 m below it
 * (boardH / 2 − the sill's 0.24 m rise), at the granite's ≈ 0.14 linear
 * albedo (cliffColor day). The bound it yields (≈ 54) sits far above the
 * authored 6 / 1.0 — the clamp is inert TODAY and exists so a re-author
 * cannot put a hotspot above the board's paper white (the r0 "orange hotspot
 * on the pulse glass", MD, came from the light's old seat 2.4 m in FRONT of
 * the face; review r2 moved it). Target radiance: the face's night paper
 * white (0.92 emission × the #eef4f2 ink ≈ 0.8 linear).
 */
const SPILL_NEAREST_M = 1.73;
const SPILL_ALBEDO = 0.14;
const SPILL_TARGET = 0.8;
const SPILL_NIGHT = clampBoardLight(6, SPILL_NEAREST_M, SPILL_ALBEDO, SPILL_TARGET);
const SPILL_DAY = clampBoardLight(1.0, SPILL_NEAREST_M, SPILL_ALBEDO, SPILL_TARGET);

/**
 * A trail waymarker: three battered stone tiers on the knoll slope (the
 * pass's route-marking idiom, ~0.76 m tall at s = 1). Seated on
 * `knollHeight` + the measured mound lift so the rendered surface keeps
 * contact — the layout.ts law, corrected for the mesh's interpolation bulge.
 * R4: exported as the shared cairn idiom, with an explicit `seatY` override
 * for beats off the knoll (the pass gate's waymarker line seats on the flat
 * meadow disc, where the field is identically 0 — no lift, no bulge).
 */
export function WaymarkerCairn({
  x,
  z,
  s,
  seatY,
}: {
  x: number;
  z: number;
  s: number;
  seatY?: number;
}) {
  const palette = useMountainPalette();
  const seat = seatY ?? knollHeight(x, z) + WAYMARKER_SEAT_LIFT;
  return (
    <group
      position={[x, seat, z]}
      rotation={[0, seeded(Math.round(x * 31 + z * 17)) * Math.PI, 0]}
    >
      <mesh position={[0, 0.15 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3 * s, 0.38 * s, 0.3 * s, 6]} />
        <meshStandardMaterial color={palette.lanternStone} roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh position={[0.03, 0.44 * s, -0.02]} rotation={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.22 * s, 0.29 * s, 0.26 * s, 6]} />
        <meshStandardMaterial color={palette.rockColor} roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh position={[-0.02, 0.66 * s, 0.02]} rotation={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.14 * s, 0.21 * s, 0.2 * s, 5]} />
        <meshStandardMaterial color={palette.lanternStone} roughness={0.92} metalness={0.02} />
      </mesh>
    </group>
  );
}

export default function SummitCairn() {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const palette = useMountainPalette();
  const data = useRouteData<MountainRouteData>();
  const night = palette.exposure < 0.75;
  // i18n D11: the viewer's language, read before the texture is built.
  const locale = useLocale();
  const t = useT(worldThemesMessages);
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);

  const colors = useMemo(
    () => ({ field: palette.boardField, accent: palette.boardAccent, ink: '#eef4f2' }),
    [palette],
  );
  // C-105 r1: the summit board is a board page — shared paint path (pulse
  // station, 7.0 m board face).
  const paint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintSummitBoard(ctx, w, h, content, colors, tools, locale),
    [content, colors, locale],
  );
  const board = usePaintedBoardTexture(paint, BOARD_TEX_W, BOARD_TEX_H, MOUNTAIN_STATIONS[0], SUMMIT.boardW);
  // Fidelity wave 2 (2F): standby dim — uniforms exist before the face's first compile.
  const standby = useStandbyDim({ surfaces: MOUNTAIN_DATA_SURFACES, subjectId: 'board:pulse', faceIds: PULSE_FACE_IDS });

  const { board: boardPos, boardW, boardH, faceYaw, seatY } = SUMMIT;
  // The tower body: from the knoll seat up to the board's bottom edge.
  const towerH = boardPos.y - boardH / 2 - seatY;

  return (
    <group>
      <FocusSubject
        id="board:pulse"
        kind="board"
        label={t('subjects.mountain.pulse')}
        facing={BOARD_FACING}
        panel={PULSE_PANEL}
        bounds={BOARD_BOUNDS}
      >
        <group position={[boardPos.x, 0, boardPos.z]} rotation={[0, faceYaw, 0]}>
          {/* Battered stone shoulder, seat → board sill (rotated frame: the
              board faces +Z-local toward the authored eye). */}
          <mesh position={[0, seatY + towerH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[
              SHOULDER_HALF_TOP * Math.SQRT2,
              SHOULDER_HALF_BOTTOM * Math.SQRT2,
              towerH,
              4,
              1,
            ]} />
            <meshStandardMaterial color={palette.rockColor} roughness={0.92} metalness={0.02} />
          </mesh>
          {/* Sill course under the board. */}
          <mesh position={[0, boardPos.y - boardH / 2 + 0.09, 0.3]} castShadow>
            <boxGeometry args={[boardW + 0.9, 0.3, 1.0]} />
            <meshStandardMaterial color={palette.cliffColor} roughness={0.9} metalness={0.02} />
          </mesh>
          {/* Board bezel: recessed slate in a granite frame. */}
          <mesh position={[0, boardPos.y, 0.62]} castShadow>
            <boxGeometry args={[boardW + 0.6, boardH + 0.6, 0.3]} />
            <meshStandardMaterial color={palette.cliffColor} roughness={0.88} metalness={0.03} />
          </mesh>
          {board ? (
            <mesh position={[0, boardPos.y, 0.79]} renderOrder={2}>
              <planeGeometry args={[boardW, boardH]} />
              {/* Fidelity W1 r5: the self-lit data-face lever (FestivalBanners /
                  clouds flagship). Lit, the slate took key + hemi + the HDRI
                  specular (roughness 0.3) as a milky upper-left wash, and the
                  1.3 night emission crossed the bloom knee into glyph halos.
                  Base colour black + envMapIntensity 0 leave the face to its
                  own emission; ≤ 1.0 with toneMapped off keeps every painted
                  value at or below its texel (well under BLOOM_THRESHOLD 1.7),
                  so the face-ground luma is flat across the whole slate. */}
              <meshStandardMaterial
                map={board}
                color="#000000"
                emissiveMap={board}
                emissive="#ffffff"
                emissiveIntensity={night ? 0.92 : 1.0}
                roughness={1}
                metalness={0}
                ref={bindEnv}
                envMapIntensity={0}
                toneMapped={false}
                fog={false}
                {...standby.materialProps}
              />
            </mesh>
          ) : null}
          {/* Fidelity wave 2 (2F, audit issue 16): the summit CROSS read as a
              religious summit cross — a cultural misread on a league board —
              and outlined the frame's crown. It is now a trail PENNANT finial
              (the pass's own marker idiom, Props.tsx Pennant): a timber mast
              and one triangular flag in the board accent. Same two meshes, so
              the draw count is unchanged. The flag is lit albedo (no
              emission), so it never outshines the face. */}
          <group position={[0, boardPos.y + boardH / 2 + 0.6, 0]}>
            <mesh position={[0, 0.55, 0]} castShadow>
              <cylinderGeometry args={[0.045, 0.06, 1.4, 7]} />
              <meshStandardMaterial color={palette.timberColor} roughness={0.7} metalness={0.08} />
            </mesh>
            <mesh position={[0.3, 1.02, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
              <coneGeometry args={[0.2, 0.62, 3]} />
              <meshStandardMaterial color={palette.boardAccent} roughness={0.8} metalness={0} side={THREE.DoubleSide} />
            </mesh>
          </group>
          {/* A soft spill of the board's own light over the shoulder at night.
              Review r2 (W1): seated just BEHIND the face plane (0.79 → 0.7,
              inside the bezel) so N·L ≤ 0 on the face — at 2.4 m in front it
              painted an orange hotspot disc between the names and the W–L
              column. It still washes the knoll, sill and deck below. */}
          <pointLight
            position={[0, boardPos.y, 0.7]}
            color={palette.boardAccent}
            intensity={night ? SPILL_NIGHT : SPILL_DAY}
            distance={11}
            decay={2}
            castShadow={false}
          />
        </group>
      </FocusSubject>

      {/* The summit station's working kit (world-anchored surround). */}
      <group>
        {/* Viewing deck at the switchback head, seated on the knoll. */}
        <group position={[SUMMIT.deck.x, SUMMIT.deck.seatY, SUMMIT.deck.z]}>
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <boxGeometry args={[SUMMIT.deck.w, 0.24, SUMMIT.deck.d]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
          </mesh>
          {([-1, 1] as const).map((side) => (
            <mesh key={side} position={[side * (SUMMIT.deck.w / 2 - 0.2), -0.2, 0]} castShadow>
              <boxGeometry args={[0.18, 0.4, SUMMIT.deck.d - 0.3]} />
              <meshStandardMaterial color={palette.cliffColor} roughness={0.92} metalness={0.02} />
            </mesh>
          ))}
        </group>
        <RopeRailing x={SUMMIT.deck.x - SUMMIT.deck.w / 2 + 0.15} posts={[-12.1, -13.1, -13.9]} />
        <PennantCluster poles={SUMMIT_SURROUND.pennants} />
        <CacheBox x={SUMMIT_SURROUND.cacheBox.x} z={SUMMIT_SURROUND.cacheBox.z} yaw={0.5} />
        <SignPost
          x={SUMMIT_SURROUND.signpost.x}
          z={SUMMIT_SURROUND.signpost.z}
          yaw={SUMMIT_SURROUND.signpost.yaw}
        />
        {SUMMIT_SURROUND.lanterns.map((l) => (
          <group key={l.z} position={[l.x, 0, l.z]}>
            <StormLantern scale={l.scale} night={night} practical={l.practical} />
          </group>
        ))}
        {/* Snow patches on the knoll's upper ledges. */}
        {SUMMIT_SURROUND.snowPatches.map((p) => (
          <SnowPatch
            key={`${p.x},${p.z}`}
            x={p.x}
            z={p.z}
            s={p.s}
            y={Math.max(0.02, knollHeight(p.x, p.z) + 0.02)}
          />
        ))}
        {/* The summit fence: a rail line along the deck's meadow side. */}
        <TimberFence x0={-7.2} x1={-3.4} z={-11.7} posts={4} railY={[0.5, 0.92]} />
        {/* The waymarker beat (r3): cairn pair + scrub on the bench south of
            the deck, seated at the measured mound surface — see
            PULSE_WAYMARKERS for the both-pose camera projection and clearance
            check (below the board's sight ray). */}
        {PULSE_WAYMARKERS.cairns.map((c) => (
          <WaymarkerCairn key={`${c.x},${c.z}`} x={c.x} z={c.z} s={c.s} />
        ))}
        {PULSE_WAYMARKERS.scrubs.map((p) => (
          <group key={`${p.x},${p.z}`} position={[0, knollHeight(p.x, p.z) + WAYMARKER_SEAT_LIFT, 0]}>
            <Scrub x={p.x} z={p.z} />
          </group>
        ))}
      </group>
    </group>
  );
}
