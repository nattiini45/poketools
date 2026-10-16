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
import { useSakuraPalette } from '../use-sakura-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import { paintRosterWall, ROSTER_TEX_H, ROSTER_TEX_W } from '../content/paint';
import { rosterWallNote } from '../content/roster-note';
import { SAKURA_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { SakuraRouteData } from '../types';
import StoneLantern from './StoneLantern';
import { Shrub, SteppingStones } from './Props';
import { SHRINE, SHRINE_DRESSING } from './layout';
import { STANDBY_EMISSIVE_DROP, useStandbyDim } from '@/components/world/route/useStandbyDim';
import { SAKURA_DATA_SURFACES } from './data-faces';

/**
 * The #roster hero: a stone shrine wall on the west edge. The wall's east
 * face (toward the station camera) carries the roster frieze — every tile
 * from the contract's `rosterTiles` (EPB list lines, or the participant
 * fallback with ace species + gym band), painted once from
 * `WorldRouteData`-derived data. Lanterns stand on the coping; their glow
 * reads the frieze at dusk.
 *
 * C-093 r3 wall-dressing pass: the wall reads as BUILT structure, not a UI
 * panel pressed onto stone — a proud stone base course at the foot, a timber
 * header beam carried on two framing end posts (just inside the frame edges
 * at the authored pose), a flanking ground-lantern pair, planted shrub edges
 * along the foot and stepping-stone aprons north and south of the path mouth
 * (|z| ≥ 1.3 clear of the crossing path strip).
 */

/** Tiles the frieze can carry: 4 per band row × 3 rows on the 4:1 canvas —
 * 21 → 12 by C-102 r2: at the roster station's 40 px painter font floor the
 * r1 236 px tiles clipped species names mid-word ("01BULB…"); tiles re-flow
 * to 470 px (three rows of four) so number + species and the price/band line
 * each hold the longest real fixture strings whole (the note names the
 * full-roster overflow — the self-disclosure the visual review accepted). */
const FRIEZE_TILES = 12;

/**
 * Hand-authored world AABB of the frieze plane on the wall's east face
 * (local x 0.36, `SHRINE.length` along Z, `SHRINE.height − 0.14` tall):
 * auto-measure would drag the coping, the lanterns and the dressing into the
 * proxy.
 *
 * Fidelity wave 2 (2D, reversing the old "no panel" ruling — D15 corollary):
 * the frieze paints 12 tiles and no frozen pose can show a 92-line roster, so
 * the wall now opens the full `?board=roster` list panel (ThemeOverlays'
 * RosterListPanel) beside its focus close-up.
 */
const FRIEZE_BOUNDS: SubjectBounds = {
  min: [SHRINE.x + 0.36 - 0.2, 0.02, SHRINE.z - SHRINE.length / 2 - 0.1],
  max: [SHRINE.x + 0.36 + 0.2, SHRINE.height - 0.02, SHRINE.z + SHRINE.length / 2 + 0.1],
};

/** The frieze faces east (+X), toward the roster station eye. */
const FRIEZE_FACING: Vec3Tuple = [1, 0, 0];

/** The full roster list (`?board=roster`, ThemeOverlays' RosterListPanel). */
const ROSTER_PANEL: SubjectPanel = { param: 'board', value: ROSTER_BOARD_VALUE };

/** The wall's data-face id (data-faces.ts) — the standby dim's key. */
const ROSTER_FACE_IDS = ['roster:wall'] as const;

/**
 * Wave-2 r3 (LUMA, W1 "sakura-light roster face P99 under the sky strip"):
 * the frieze's own emission. Day 0.12 → 0.22 lifts the cream ink over the
 * light-theme sky without washing the stone (the ink/stone ratio is the
 * paint's; the standby ceiling caps the glyphs under bloom). Night keeps 0.55.
 */
const FRIEZE_EMISSIVE_DAY = 0.22;
const FRIEZE_EMISSIVE_NIGHT = 0.55;
/** The frieze wash light (the lantern pool on the wall face). */
const WASH_NIGHT = 14;
const WASH_DAY = 1.6;

export default function RosterShrine({ night }: { night: boolean }) {
  const palette = useSakuraPalette();
  const { rosterTiles } = useRouteData<SakuraRouteData>();
  // i18n D11: the viewer's language (and Pokémon-name language), read before
  // the texture is built.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const t = useT(worldThemesMessages);

  const paint = useMemo(() => {
    const shown = rosterTiles.slice(0, FRIEZE_TILES);
    // Fidelity W1: the note names the tap affordance, never the route-hidden
    // DOM section it used to point at. Wave 2 (2D): a tap now opens the full
    // list panel, so the note may promise every line (`fullListOnTap`).
    const note = rosterWallNote(shown.length, rosterTiles.length, true, locale);
    return (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintRosterWall(
        ctx,
        w,
        h,
        shown,
        { stone: '#57504a', ink: '#f3ebe0', accent: palette.toriiRed },
        tools,
        note,
        locale,
        dataLocale,
      );
  }, [rosterTiles, palette.toriiRed, locale, dataLocale]);

  // C-105 r1: the frieze is a board page — shared paint path (roster station,
  // 9.4 m wall face).
  const frieze = usePaintedBoardTexture(paint, ROSTER_TEX_W, ROSTER_TEX_H, SAKURA_STATIONS[1], SHRINE.length);

  // Wave-2 r3 (LUMA): the wall stands by away from the roster station, and
  // its wash light fades with it — a neighbour frieze's lantern pool must not
  // out-read the active face (§5.10).
  const standby = useStandbyDim({ surfaces: SAKURA_DATA_SURFACES, subjectId: 'roster:wall', faceIds: ROSTER_FACE_IDS });
  const washRef = useRef<THREE.PointLight | null>(null);
  const washBase = night ? WASH_NIGHT : WASH_DAY;
  useFrame(() => {
    const light = washRef.current;
    if (light) light.intensity = washBase * (1 - STANDBY_EMISSIVE_DROP * standby.uniforms.uStandby.value);
  });

  const lanternZ = useMemo(() => {
    const half = (SHRINE.lanterns - 1) / 2;
    return Array.from({ length: SHRINE.lanterns }, (_, i) => (i - half) * (SHRINE.length / (SHRINE.lanterns + 1)));
  }, []);

  return (
    <group>
      {/* r3 dressing that stands on the WORLD ground (posts, lanterns,
          shrubs, aprons) — world-anchored siblings, not wall-local children,
          so their footing is the lawn the camera reads. */}
      <group>
        {/* Framing end posts (world z ±4.95, just inside the frame edges). */}
        {([-1, 1] as const).map((side) => (
          <group key={side} position={[SHRINE_DRESSING.endPosts.x, 0, side * SHRINE_DRESSING.endPosts.z]}>
            <mesh position={[0, SHRINE_DRESSING.endPosts.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry
                args={[
                  SHRINE_DRESSING.endPosts.side,
                  SHRINE_DRESSING.endPosts.height,
                  SHRINE_DRESSING.endPosts.side,
                ]}
              />
              <meshStandardMaterial color={palette.lanternStone} roughness={0.9} metalness={0.02} />
            </mesh>
            {/* Wood cap carrying the header beam. */}
            <mesh position={[0, SHRINE_DRESSING.endPosts.height + 0.06, 0]} castShadow>
              <boxGeometry args={[0.66, 0.12, 0.66]} />
              <meshStandardMaterial color={palette.bridgeWood} roughness={0.7} metalness={0.08} />
            </mesh>
          </group>
        ))}
        {/* Flanking ground lanterns. */}
        {SHRINE_DRESSING.flankLanterns.map((l) => (
          <group key={l.z} position={[l.x, 0, l.z]}>
            <StoneLantern scale={l.scale} night={night} practical={l.practical} />
          </group>
        ))}
        {/* Planted shrub edges along the wall foot (C-102 r3: per-shrub scale
            from layout — capped so the blobs stay under the bottom band row's
            sight lines). */}
        {SHRINE_DRESSING.shrubs.map((s) => (
          <Shrub key={s.z} x={s.x} z={s.z} s={s.s} />
        ))}
        {/* Stepping-stone aprons north and south of the path mouth. */}
        {SHRINE_DRESSING.aprons.map((a, i) => (
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
        id="roster:wall"
        kind="roster"
        label={t('subjects.sakura.roster')}
        facing={FRIEZE_FACING}
        panel={ROSTER_PANEL}
        bounds={FRIEZE_BOUNDS}
      >
        <group position={[SHRINE.x, 0, SHRINE.z]}>
          {/* Wall body, coursed stone. */}
          <mesh position={[0, SHRINE.height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.7, SHRINE.height, SHRINE.length]} />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.9} metalness={0.02} />
          </mesh>
          {/* r3: proud base course at the foot — the wall grows out of the
              ground instead of meeting it as a paper edge. */}
          <mesh
            position={[SHRINE_DRESSING.baseCourse.x - SHRINE.x, SHRINE_DRESSING.baseCourse.h / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry
              args={[
                SHRINE_DRESSING.baseCourse.w,
                SHRINE_DRESSING.baseCourse.h,
                SHRINE_DRESSING.baseCourse.length,
              ]}
            />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.94} metalness={0.02} />
          </mesh>
          {/* Coping. */}
          <mesh position={[0, SHRINE.height + 0.09, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.86, 0.18, SHRINE.length + 0.24]} />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.85} metalness={0.02} />
          </mesh>
          {/* r3: timber header beam on the end posts, proud of the coping face
              — the roofline that makes the wall a built structure. */}
          <mesh
            position={[SHRINE_DRESSING.headerBeam.x - SHRINE.x, SHRINE_DRESSING.headerBeam.y, 0]}
            castShadow
          >
            <boxGeometry
              args={[
                SHRINE_DRESSING.headerBeam.w,
                SHRINE_DRESSING.headerBeam.h,
                SHRINE_DRESSING.headerBeam.length,
              ]}
            />
            <meshStandardMaterial color={palette.bridgeWood} roughness={0.72} metalness={0.08} />
          </mesh>
          {/* Roster frieze on the east face (+X, toward the station camera). */}
          {frieze ? (
            <mesh position={[0.36, SHRINE.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={2}>
              <planeGeometry args={[SHRINE.length, SHRINE.height - 0.14]} />
              <meshStandardMaterial
                map={frieze}
                emissiveMap={frieze}
                emissive="#ffffff"
                emissiveIntensity={night ? FRIEZE_EMISSIVE_NIGHT : FRIEZE_EMISSIVE_DAY}
                roughness={0.72}
                metalness={0.02}
                fog={false}
                {...standby.materialProps}
              />
            </mesh>
          ) : null}
          {/* Lanterns on the coping. */}
          {lanternZ.map((z) => (
            <group key={z} position={[0.06, SHRINE.height + 0.18, z]}>
              <StoneLantern scale={0.92} night={night} />
            </group>
          ))}
          {/* A soft wash so the frieze reads after sunset. */}
          <pointLight
            ref={washRef}
            position={[1.6, 2.4, 0]}
            color={palette.lanternGlow}
            intensity={washBase}
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
