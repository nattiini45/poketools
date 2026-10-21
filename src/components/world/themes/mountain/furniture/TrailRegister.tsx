'use client';

import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useMountainPalette } from '../use-mountain-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintRegisterWall, registerNote, ROSTER_TEX_H, ROSTER_TEX_W } from '../content/paint';
import { MOUNTAIN_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { MountainRouteData } from '../types';
import { REGISTER, REGISTER_DRESSING } from './layout';
import { Scrub, SteppingStones, StormLantern } from './Props';
import { STANDBY_EMISSIVE_DROP, useStandbyDim } from '@/components/world/route/useStandbyDim';
import { MOUNTAIN_DATA_SURFACES } from './data-faces';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The #roster hero: the trail register lodge wall on the west edge. The
 * wall's east face (toward the station camera) carries the register frieze —
 * the first 9 tiles of the contract's `rosterTiles` (EPB list lines, or the
 * participant fallback with ace species + gym band), painted once from
 * `WorldRouteData`-derived data; a tap opens the full `?board=roster` list. The lodge is deliberately 6.6 m long so the readable
 * 5.6 m frieze fits the board-face budget at the PINNED station cameras
 * (≤ 60 % of the 1440 frame, ≤ 75 % of the landed 390 frame). Storm lanterns
 * stand on the sill; their glow reads the frieze at dusk.
 *
 * Density tier (the plaza's teams-tier discipline): the wall reads as BUILT
 * structure — a proud stone base course at the foot, a shingled roof carried
 * on two framing end posts, a flanking storm-lantern pair, planted scrub
 * edges along the foot and stepping-stone aprons north and south of the
 * path mouth (|z| ≥ 1.3 clear of the crossing trail).
 */

/** Tiles the frieze can carry: 3 per row × 3 rows on the 1536 canvas — the
 * C-103 r1 measured tile grid (468 px tiles at the roster station's 50 px
 * painter floor; the count trade 18 → 9 is disclosed on the painted note,
 * the C-102 r2 mechanism). Nine is the vertical honest maximum: a wrapped
 * name (two 50 px lines) plus its band needs the full 166 px tile, and
 * (640 − 140) / 166 = 3 rows — the r1 spot still showed the 15-tile grid
 * collapsing tileH to 100 and the base course clipping row 5's band. */
const FRIEZE_TILES = 9;

/**
 * Hand-authored world AABB of the register frieze on the wall's east face
 * (local x 0.36, `REGISTER.friezeW` along Z, `REGISTER.height − 0.14` tall):
 * auto-measure would drag the roof, sill lanterns and dressing into the
 * proxy.
 *
 * Fidelity wave 2 (2D): the frieze paints 9 tiles, so the lodge now opens
 * the full `?board=roster` list panel (ThemeOverlays' RosterListPanel)
 * beside its focus close-up. (The painted note's copy is 2E's painter.)
 */
const FRIEZE_BOUNDS: SubjectBounds = {
  min: [REGISTER.x + 0.36 - 0.2, 0.02, REGISTER.z - REGISTER.friezeW / 2 - 0.1],
  max: [REGISTER.x + 0.36 + 0.2, REGISTER.height - 0.02, REGISTER.z + REGISTER.friezeW / 2 + 0.1],
};

/** The frieze faces east (+X), toward the roster station eye. */
const FRIEZE_FACING: Vec3Tuple = [1, 0, 0];

/** The full roster list (`?board=roster`, ThemeOverlays' RosterListPanel). */
const ROSTER_PANEL: SubjectPanel = { param: 'board', value: ROSTER_BOARD_VALUE };

/** The frieze's data-face id (data-faces.ts) — the standby dim's key. */
const ROSTER_FACE_IDS = ['roster:frieze'] as const;
/**
 * Wave-2 r3 (LUMA, W1 "mountain-dark roster face P99 184.9 vs the sill
 * lanterns 201.6, at every viewport"): the self-lit frieze's night emission
 * 0.7 → 1.05. The cream ink (#f3efe6, linear ≈ 0.89) then emits ≈ 0.93 —
 * well under the 1.6 data ceiling, so no glyph reaches the bloom pass — and
 * the tiles out-read the lantern glass above them. Day keeps 0.95 (the light
 * sky is an exposure clamp, not a face gain: see the r3 LUMA report).
 */
const FRIEZE_EMISSIVE_NIGHT = 1.05;
const FRIEZE_EMISSIVE_DAY = 0.95;
/** The sill pool light (night 6 → 5: under the lifted face with margin). */
const POOL_NIGHT = 5;
const POOL_DAY = 1.0;

export default function TrailRegister({ night }: { night: boolean }) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const palette = useMountainPalette();
  const { rosterTiles } = useRouteData<MountainRouteData>();
  // i18n D11: the viewer's language (and Pokémon-name language), read before
  // the texture is built.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const t = useT(worldThemesMessages);

  const paint = useMemo(() => {
    const shown = rosterTiles.slice(0, FRIEZE_TILES);
    // Fidelity W1 r1: the note names the tap affordance (the frieze's focus
    // pose) instead of the route-hidden section "BELOW" — `registerNote`.
    const note = registerNote(shown.length, rosterTiles.length, undefined, locale);
    return (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintRegisterWall(
        ctx,
        w,
        h,
        shown,
        { stone: '#54504a', ink: '#f3efe6', accent: palette.boardAccent },
        tools,
        note,
        locale,
        dataLocale,
      );
  }, [rosterTiles, palette.boardAccent, locale, dataLocale]);

  // C-105 r1: the register frieze is a board page — shared paint path
  // (roster station, 5.6 m frieze face).
  const frieze = usePaintedBoardTexture(paint, ROSTER_TEX_W, ROSTER_TEX_H, MOUNTAIN_STATIONS[1], REGISTER.friezeW);

  // Wave-2 r3 (LUMA): the frieze stands by away from the roster station, and
  // its sill pool fades with it (a neighbour's light spill must not lift the
  // frame around the active face, §5.10).
  const standby = useStandbyDim({ surfaces: MOUNTAIN_DATA_SURFACES, subjectId: 'roster:lodge', faceIds: ROSTER_FACE_IDS });
  const poolRef = useRef<THREE.PointLight | null>(null);
  const poolBase = night ? POOL_NIGHT : POOL_DAY;
  useFrame(() => {
    const light = poolRef.current;
    if (light) light.intensity = poolBase * (1 - STANDBY_EMISSIVE_DROP * standby.uniforms.uStandby.value);
  });

  const lanternZ = useMemo(() => {
    const half = (REGISTER.lanterns - 1) / 2;
    return Array.from(
      { length: REGISTER.lanterns },
      (_, i) => (i - half) * (REGISTER.length / (REGISTER.lanterns + 1)),
    );
  }, []);

  return (
    <group>
      {/* Dressing that stands on the WORLD ground (posts, lanterns, scrubs,
          aprons) — world-anchored siblings, not wall-local children, so
          their footing is the meadow the camera reads. */}
      <group>
        {/* Framing end posts (world z ±4.95, just inside the frame edges). */}
        {([-1, 1] as const).map((side) => (
          <group key={side} position={[REGISTER_DRESSING.endPosts.x, 0, side * REGISTER_DRESSING.endPosts.z]}>
            <mesh position={[0, REGISTER_DRESSING.endPosts.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry
                args={[
                  REGISTER_DRESSING.endPosts.side,
                  REGISTER_DRESSING.endPosts.height,
                  REGISTER_DRESSING.endPosts.side,
                ]}
              />
              <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
            </mesh>
            {/* Stone cap carrying the roof. */}
            <mesh position={[0, REGISTER_DRESSING.endPosts.height + 0.06, 0]} castShadow>
              <boxGeometry args={[0.66, 0.12, 0.66]} />
              <meshStandardMaterial color={palette.lanternStone} roughness={0.88} metalness={0.02} />
            </mesh>
          </group>
        ))}
        {/* Flanking storm lanterns. */}
        {REGISTER_DRESSING.flankLanterns.map((l) => (
          <group key={l.z} position={[l.x, 0, l.z]}>
            <StormLantern scale={l.scale} night={night} practical={l.practical} />
          </group>
        ))}
        {/* Planted scrub edges along the wall foot (scales data-driven from
            layout.ts — the corridor-checked cap lives in the data). */}
        {REGISTER_DRESSING.shrubs.map((s) => (
          <Scrub key={s.z} x={s.x} z={s.z} s={s.s} />
        ))}
        {/* Stepping-stone aprons north and south of the path mouth. */}
        {REGISTER_DRESSING.aprons.map((a, i) => (
          <SteppingStones
            key={i}
            x0={a.x0}
            x1={a.x1}
            z0={a.z0}
            z1={a.z1}
            count={9}
            seed={700 + i * 37}
          />
        ))}
      </group>

      <FocusSubject
        id="roster:lodge"
        kind="roster"
        label={t('subjects.mountain.roster')}
        facing={FRIEZE_FACING}
        panel={ROSTER_PANEL}
        bounds={FRIEZE_BOUNDS}
      >
        <group position={[REGISTER.x, 0, REGISTER.z]}>
          {/* Wall body: coursed lodge timber. */}
          <mesh position={[0, REGISTER.height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.7, REGISTER.height, REGISTER.length]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.82} metalness={0.04} />
          </mesh>
          {/* Proud base course at the foot — the wall grows out of the
              meadow instead of meeting it as a paper edge. */}
          <mesh
            position={[REGISTER_DRESSING.baseCourse.x - REGISTER.x, REGISTER_DRESSING.baseCourse.h / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry
              args={[
                REGISTER_DRESSING.baseCourse.w,
                REGISTER_DRESSING.baseCourse.h,
                REGISTER_DRESSING.baseCourse.length,
              ]}
            />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.94} metalness={0.02} />
          </mesh>
          {/* Sill beam. */}
          <mesh position={[0, REGISTER.height + 0.09, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.86, 0.18, REGISTER.length + 0.24]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
          </mesh>
          {/* Shingled roof on the end posts, proud of the sill — the roofline
              that makes the wall a built lodge structure. */}
          <mesh
            position={[REGISTER_DRESSING.roof.x - REGISTER.x, REGISTER_DRESSING.roof.y, 0]}
            rotation={[0, 0, 0]}
            castShadow
          >
            <boxGeometry args={[REGISTER_DRESSING.roof.w, REGISTER_DRESSING.roof.h, REGISTER_DRESSING.roof.length]} />
            <meshStandardMaterial color={palette.cliffColor} roughness={0.92} metalness={0.02} />
          </mesh>
          <mesh
            position={[REGISTER_DRESSING.roof.x - REGISTER.x, REGISTER_DRESSING.roof.y + REGISTER_DRESSING.roof.ridge / 2, 0]}
            rotation={[0, 0, 0]}
            castShadow
          >
            <boxGeometry args={[REGISTER_DRESSING.roof.w * 0.5, REGISTER_DRESSING.roof.ridge, REGISTER_DRESSING.roof.length + 0.1]} />
            <meshStandardMaterial color={palette.cliffColor} roughness={0.92} metalness={0.02} />
          </mesh>
          {/* A snow roll on the roof's ridge — the lodge in winter dress. */}
          <mesh
            position={[REGISTER_DRESSING.roof.x - REGISTER.x + 0.2, REGISTER_DRESSING.roof.y + REGISTER_DRESSING.roof.ridge + 0.06, 0]}
            castShadow
          >
            <boxGeometry args={[0.5, 0.12, REGISTER_DRESSING.roof.length - 1.4]} />
            <meshStandardMaterial color={palette.snowColor} roughness={0.82} metalness={0} />
          </mesh>
          {/* Register frieze on the east face (+X, toward the station camera).
              The readable face is the 5.6 m frieze (REGISTER.friezeW), sized
              to the board-face budget at the pinned cameras — 57.4 % of the
              1440 frame, 63.1 % of the landed 390 frame (r1 measured 96.4 %
              / 105.9 % over the 9.4 m wall, with edge tiles clipped). */}
          {frieze ? (
            <mesh position={[0.36, REGISTER.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={2}>
              <planeGeometry args={[REGISTER.friezeW, REGISTER.height - 0.14]} />
              {/* Fidelity W1 r5: the self-lit data-face lever (FestivalBanners /
                  SummitCairn). The sill wash below (14 at night, 1.6 m in
                  front) bloomed a halo around "02 CHARMANDER" and the TAP TO
                  READ note; base colour black + envMapIntensity 0 take the
                  frieze out of every scene light, so it reads at its painted
                  values in both themes. */}
              <meshStandardMaterial
                map={frieze}
                color="#000000"
                emissiveMap={frieze}
                emissive="#ffffff"
                emissiveIntensity={night ? FRIEZE_EMISSIVE_NIGHT : FRIEZE_EMISSIVE_DAY}
                roughness={1}
                metalness={0}
                ref={bindEnv}
                envMapIntensity={0}
                fog={false}
                {...standby.materialProps}
              />
            </mesh>
          ) : null}
          {/* Storm lanterns on the sill. */}
          {lanternZ.map((z) => (
            <group key={z} position={[0.06, REGISTER.height + 0.18, z]}>
              <StormLantern scale={0.92} night={night} />
            </group>
          ))}
          {/* The lanterns' warm pool on the meadow at the wall's foot.
              Fidelity W1 r5: the frieze is self-lit now, so this no longer
              has to light it — lowered off the face (y 2.4 → 0.5) and
              softened (14 → 6 at night) so it cannot halo the tiles. */}
          <pointLight
            ref={poolRef}
            position={[1.6, 0.5, 0]}
            color={palette.lanternGlow}
            intensity={poolBase}
            distance={11}
            decay={2}
            castShadow={false}
          />
        </group>
      </FocusSubject>
    </group>
  );
}

/** Exposed for tests: the frieze's tile budget. */
export const friezeTileBudget = FRIEZE_TILES;
