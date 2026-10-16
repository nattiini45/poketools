'use client';

import { useEffect, useMemo } from 'react';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import * as THREE from 'three';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { useWorldManifest } from '@/lib/route-world/model-manifest';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useCloudsPalette } from '../use-clouds-palette';
import { usePaintedBoardTexture } from '../content/use-painted-texture';
import {
  paintFlagshipBoard,
  paintRegisterSail,
  paintFixturesBoard,
  registerSailNote,
  BOARD_TEX_H,
  BOARD_TEX_W,
  SAIL_TEX_H,
  SAIL_TEX_W,
} from '../content/paint';
import { CLOUDS_STATIONS } from '../theme';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { CloudsRouteData } from '../types';
import { FLAGSHIP, REGISTER_AIRSHIP, FIXTURES_AIRSHIP, MOORINGS, TETHERS, ISLES, type Airship } from './layout';
import { ROSTER_BOARD_VALUE } from '@/components/world/route/focus/overlay-keys';
import {
  DATA_EMISSIVE_CEILING,
  useStandbyDim,
  type StandbyMaterialProps,
} from '@/components/world/route/useStandbyDim';
import { CLOUDS_DATA_SURFACES } from './data-faces';
import { useSceneEnvBinding } from '@/components/world/route/env/useSceneEnvBinding';

/**
 * The moored airships — the isles' diegetic board surfaces (the plaza's LED
 * screens idiom, translated into sky-faring canvas): every billboard is a
 * sail stretched on an airship's flank, tethered to its isle's mooring
 * spire. Three moored ships: the FLAGSHIP above the summit isle (standings),
 * the REGISTER broadside at the west isle (roster tiles) and the FIXTURES
 * board above the NE isle. Content arrives through `buildBoardContent(data,
 * locale)` / the contract's roster tiles, in the viewer's language. The register's ship BODY is the
 * C-107 Blender-built hull (PropMounts) — the procedural envelope renders
 * only while that prop is missing from the manifest (a re-bake gap never
 * blanks the ship).
 */

/**
 * THE SELF-LIT DAY-BOARD LEVER (C-104; the run-1 panel's named largest
 * gap — the sunlit flagship wash). The face material is already "base
 * color black + emission only" (the C-095 pattern), but the composer's
 * AgX grades the WHOLE frame at a heavy exposure (this rig lifts a 0.2
 * linear mid-gray to ≈ 0.92 display — measured live, raw-c104-probe5.txt)
 * and `toneMapped={false}` cannot exempt a fragment from a screen-space
 * pass, so ANY non-zero field — the old deep slate (#1d3040) as much as a
 * near-black draft (#0a1220, tried and measured identical) — lifts to the
 * same salmon pastel and the white ink lands within ~21–27 luma of it (the
 * C-105 residual). The lever's paint half is therefore ABSOLUTE: the field
 * is PURE #000000 — emission of exactly zero, which AgX maps to exactly
 * black at any exposure — and the ink reads by its own emission alone. The
 * fixtures board keeps the slate field (not this round's named surface).
 */
const FLAGSHIP_GLASS_FIELD = '#000000';

/**
 * Hand-authored world AABB of one ship's sail billboard (bezel + painted
 * face), swung by `faceYaw` into world axes (the plaza Board's discipline).
 * Auto-measure would include the envelope, fins and gondola and frame the
 * hull instead of the board. The rendered sail rides at `ship.hull.y` (the
 * face anchor lifted by `hullLift` — hullCentre in layout.ts); the bezel box
 * spans 0.14 behind the face anchor to the anchor, the painted plane 0.02
 * proud of it, so the depth range −0.2..0.08 along the normal covers both
 * with margin.
 */
function sailBounds(ship: Airship): SubjectBounds {
  const sin = Math.sin(ship.faceYaw);
  const cos = Math.cos(ship.faceYaw);
  // The bezel stands 0.5 proud of the face (boxGeometry faceW/faceH + 0.5).
  const halfW = ship.faceW / 2 + 0.35;
  const halfH = ship.faceH / 2 + 0.35;
  const zc = -0.06;
  const hd = 0.14;
  const cx = ship.face.x + zc * sin;
  const cz = ship.face.z + zc * cos;
  const ex = halfW * Math.abs(cos) + hd * Math.abs(sin);
  const ez = halfW * Math.abs(sin) + hd * Math.abs(cos);
  return {
    min: [cx - ex, ship.hull.y - halfH, cz - ez],
    max: [cx + ex, ship.hull.y + halfH, cz + ez],
  };
}

/** The sail's world normal: the face plane's +Z swung by `faceYaw`. */
function sailFacing(ship: Airship): Vec3Tuple {
  return [Math.sin(ship.faceYaw), 0, Math.cos(ship.faceYaw)];
}

const FLAGSHIP_BOUNDS = sailBounds(FLAGSHIP);
const FLAGSHIP_FACING = sailFacing(FLAGSHIP);
const REGISTER_BOUNDS = sailBounds(REGISTER_AIRSHIP);
const REGISTER_FACING = sailFacing(REGISTER_AIRSHIP);
const FIXTURES_BOUNDS = sailBounds(FIXTURES_AIRSHIP);
const FIXTURES_FACING = sailFacing(FIXTURES_AIRSHIP);

const PULSE_PANEL: SubjectPanel = { param: 'board', value: 'pulse' };
const SCHEDULE_PANEL: SubjectPanel = { param: 'board', value: 'schedule' };
/**
 * Fidelity wave 2 (2D → 2F): tapping the register sail opens the full
 * roster list panel (`?board=roster`, every world's overlay map answers
 * it), so the sail's "TAP FOR ALL N" note delivers what it promises.
 */
const ROSTER_PANEL: SubjectPanel = { param: 'board', value: ROSTER_BOARD_VALUE };

/** Each sail's data-face id (data-faces.ts) — the standby dim's key. */
const FLAGSHIP_FACE_IDS = ['pulse:board'] as const;
const REGISTER_FACE_IDS = ['roster:board'] as const;
const FIXTURES_FACE_IDS = ['schedule:board'] as const;

/**
 * Night emission of every sail. Fidelity wave 2 (2F LUMA): was 1.9 — the
 * white ink (≈ 0.91 linear) then emitted ≈ 1.73, over the 1.7 night bloom
 * threshold, so every glyph haloed. Data faces stay under the bloom
 * threshold: the night sails are authored AT the data luminance ceiling.
 * (`AIRSHIP_EMISSION` in content/paint.ts lists the emissions the contrast
 * model checks; its 1.9 entry is now stale and 1.6 sits inside the checked
 * 1.0–1.9 span — flagged to its owner.)
 */
const SAIL_NIGHT_EMISSION = DATA_EMISSIVE_CEILING;

interface AirshipProps {
  ship: Airship;
  night: boolean;
  face: THREE.Texture | null;
  /** The GLB hull body (PropMounts) carries this ship's silhouette — the
   * procedural envelope stays unmounted so the two never double-draw. */
  propHull?: boolean;
  /** Dead-specular self-lit face (the flagship lever): roughness 1 +
   * envMapIntensity 0 so no key/HDRI sheen lifts the black field. */
  pureEmission?: boolean;
  /** The sail's standby patch (fidelity wave 2, 2F) — applied at construction. */
  standby: StandbyMaterialProps;
}

function MooredAirship({ ship, night, face, propHull = false, pureEmission = false, standby }: AirshipProps) {
  // D42 N9: the material reads the scene environment, so its envMapIntensity 0 reaches the shader (r185).
  const bindEnv = useSceneEnvBinding();
  const palette = useCloudsPalette();
  const { hull, hullLength, hullRadius, hullYaw, faceYaw, hullShift } = ship;

  const hullGeo = useMemo(() => new THREE.SphereGeometry(1, 22, 14), []);
  useEffect(() => () => hullGeo.dispose(), [hullGeo]);

  const normal = useMemo(
    () => new THREE.Vector3(Math.sin(faceYaw), 0, Math.cos(faceYaw)),
    [faceYaw],
  );
  /** Long-axis (local +X) direction in world — the hull's slide axis. */
  const longAxis = useMemo(
    () => new THREE.Vector3(Math.cos(hullYaw), 0, -Math.sin(hullYaw)),
    [hullYaw],
  );

  return (
    <group position={[hull.x, hull.y, hull.z]}>
      {/* Envelope: an ellipsoid, long axis along local +X (broadside — see
          the hullYaw note in layout.ts), slid along its own axis so the
          ship reads beside the sail instead of hiding behind it. Skipped
          while the Blender hull prop carries the silhouette. */}
      {propHull ? null : (
        <group position={longAxis.clone().multiplyScalar(hullShift)} rotation={[0, hullYaw, 0]}>
          <mesh geometry={hullGeo} scale={[hullLength / 2, hullRadius, hullRadius]} castShadow>
            <meshStandardMaterial color={palette.sailCanvas} roughness={0.7} metalness={0.03} />
          </mesh>
          {/* Dorsal trim stripe along the envelope's crown. */}
          <mesh position={[0, hullRadius * 0.88, 0]} scale={[hullLength / 2.6, hullRadius * 0.3, hullRadius * 0.34]} castShadow>
            <sphereGeometry args={[1, 18, 10]} />
            <meshStandardMaterial color={palette.sailTrim} roughness={0.62} metalness={0.05} />
          </mesh>
          {/* Tail fins (cross of four, aft). */}
          {([0, Math.PI / 2] as const).map((roll) => (
            <mesh key={roll} position={[-hullLength / 2 + 0.55, 0, 0]} rotation={[roll, 0, Math.PI / 2]} castShadow>
              <boxGeometry args={[1.5, 0.08, 0.85]} />
              <meshStandardMaterial color={palette.sailTrim} roughness={0.66} metalness={0.04} />
            </mesh>
          ))}
          {/* Gondola slung under the hull. */}
          <mesh position={[0.4, -hullRadius - 0.38, 0]} castShadow>
            <boxGeometry args={[1.7, 0.5, 0.62]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
          </mesh>
          <mesh position={[0.4, -hullRadius - 0.66, 0]} castShadow>
            <boxGeometry args={[1.85, 0.09, 0.72]} />
            <meshStandardMaterial color={palette.stoneColor} roughness={0.8} metalness={0.05} />
          </mesh>
          {/* Rigging struts down to the gondola. */}
          {([-0.35, 1.15] as const).map((sx) => (
            <mesh key={sx} position={[sx, -hullRadius - 0.16, 0]} rotation={[0, 0, sx > 0.5 ? -0.28 : 0.28]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 0.5, 5]} />
              <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.1} />
            </mesh>
          ))}
        </group>
      )}

      {/* Billboard bezel + painted face, aimed by faceYaw off the hull flank. */}
      <mesh position={normal.clone().multiplyScalar(hullRadius - 0.07)} rotation={[0, faceYaw, 0]} castShadow>
        <boxGeometry args={[ship.faceW + 0.5, ship.faceH + 0.5, 0.14]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.72} metalness={0.08} />
      </mesh>
      {face ? (
        <mesh position={normal.clone().multiplyScalar(hullRadius + 0.02)} rotation={[0, faceYaw, 0]} renderOrder={2}>
          <planeGeometry args={[ship.faceW, ship.faceH]} />
          {/* Self-lit screen: base color black so the day key never lifts
              the field — the paint reads by its own emission alone. On the
              flagship (pureEmission) the specular family is ALSO dead
              (roughness 1, envMapIntensity 0): the live rig's key + HDRI
              are so strong that a rough-glass face catches a warm sheen
              that AgX lifts to the same salmon pastel as the old wash —
              measured live (raw-c104-probe5.txt: a mid-gray diffuse board
              renders ≈ cream; the C-105 rows 19–27 residual). With the
              sheen dead, the black field is EXACTLY zero emission and AgX
              maps zero to exactly black at any exposure, so the ink's
              contrast survives BY CONSTRUCTION. */}
          <meshStandardMaterial
            map={face}
            color="#000000"
            emissiveMap={face}
            emissive="#ffffff"
            // The board tier: the data luminance ceiling at night (see
            // SAIL_NIGHT_EMISSION — no longer over the bloom threshold).
            emissiveIntensity={night ? SAIL_NIGHT_EMISSION : pureEmission ? 1.15 : 1.0}
            // Fidelity W1 r3: the specular family is dead on EVERY sail, not
            // only the flagship — at roughness 0.32 the roster dock's practical
            // lantern (0.6 m off the sail) painted a specular hotspot over the
            // 06 tile at night. The field is already base-color black, so
            // with the sheen dead the paint reads by its emission alone.
            roughness={1.0}
            metalness={0}
            ref={bindEnv}
            envMapIntensity={0}
            toneMapped={false}
            // Fidelity W1 r3: data faces take no scene fog.
            fog={false}
            {...standby}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/** Tether line: a taut rope from a mooring masthead to a hull's gondola. */
function Tether({ from, to }: { from: readonly [number, number, number]; to: readonly [number, number, number] }) {
  const palette = useCloudsPalette();
  const { mid, length, quat } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    return { mid: a.clone().add(b).multiplyScalar(0.5), length: dir.length(), quat: q };
  }, [from, to]);
  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[0.022, 0.022, length, 5]} />
      <meshStandardMaterial color={palette.soilColor} roughness={0.85} metalness={0} />
    </mesh>
  );
}

/** The masthead anchor of a mooring spire (seated on its isle's top). */
function tetherAnchor(id: keyof typeof MOORINGS): readonly [number, number, number] {
  const m = MOORINGS[id];
  const isle = ISLES[id as keyof typeof ISLES];
  return [m.x, (isle ? isle.top : 0) + m.h + 0.85, m.z];
}

export default function Airships() {
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;
  const data = useRouteData<CloudsRouteData>();
  // i18n D11: the viewer's language (and Pokémon-name language), read before
  // the textures are built.
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const t = useT(worldThemesMessages);
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);
  const manifest = useWorldManifest();
  // The register's Blender hull (PropMounts) carries the silhouette; the
  // procedural envelope renders only while the prop is missing from the
  // manifest (a re-bake gap never blanks the ship).
  const registerHullMounted = useMemo(
    () => manifest.props.some((candidate) => candidate.name === 'clouds-airship-hull'),
    [manifest],
  );

  // The SELF-LIT DAY-BOARD LEVER's paint half: near-black glass field under
  // the flagship's white/gold ink (see FLAGSHIP_GLASS_FIELD above).
  const flagshipColors = useMemo(
    () => ({ field: FLAGSHIP_GLASS_FIELD, accent: palette.boardAccent, ink: '#eef6ff' }),
    [palette],
  );
  const fixturesColors = useMemo(
    () => ({ field: palette.boardField, accent: palette.boardAccent, ink: '#eef6ff' }),
    [palette],
  );

  // C-105 r1: every sail face is a board page — allocated and font-floored
  // through the shared paint path (pulse / roster / schedule stations).
  const flagshipPaint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintFlagshipBoard(ctx, w, h, content, flagshipColors, tools, locale),
    [content, flagshipColors, locale],
  );
  const flagshipFace = usePaintedBoardTexture(flagshipPaint, BOARD_TEX_W, BOARD_TEX_H, CLOUDS_STATIONS[0], FLAGSHIP.faceW);

  const sailPaint = useMemo(() => {
    // C-104 r1: the sail shows NINE tiles in a 3×3 whole-name grid (the
    // measured-width re-tile); the note is the measured 1426 px form
    // (budget 1440 — whole, raw-c104-measure.txt).
    // Review r2 (W1): the note names what a tap delivers ("9 OF 92 LINES ·
    // TAP TO READ UP CLOSE") — never the route-hidden section below.
    const shown = data.rosterTiles.slice(0, 9);
    const note = registerSailNote(shown.length, data.rosterTiles.length, undefined, locale);
    return (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintRegisterSail(
        ctx,
        w,
        h,
        shown,
        // C-104 r2: ink darkened #22324a → #16223a (+23% canvas contrast) —
        // the r1 visual review's thin-margin note (roster-1440 passed at 48 vs the
        // 45 gate). Paint-only step-up; no MET surface's geometry moves.
        { canvas: palette.sailCanvas, ink: '#16223a', accent: palette.boardAccent },
        tools,
        note,
        locale,
        dataLocale,
      );
  }, [data.rosterTiles, palette, locale, dataLocale]);
  const sailFace = usePaintedBoardTexture(sailPaint, SAIL_TEX_W, SAIL_TEX_H, CLOUDS_STATIONS[1], REGISTER_AIRSHIP.faceW);

  const fixturesPaint = useMemo(
    () => (ctx: CanvasRenderingContext2D, w: number, h: number, tools: BoardPaintTools) =>
      paintFixturesBoard(ctx, w, h, content, fixturesColors, tools, locale),
    [content, fixturesColors, locale],
  );
  const fixturesFace = usePaintedBoardTexture(fixturesPaint, BOARD_TEX_W, BOARD_TEX_H, CLOUDS_STATIONS[3], FIXTURES_AIRSHIP.faceW);

  // Fidelity wave 2 (2F): one standby dim per sail subject.
  const flagshipStandby = useStandbyDim({ surfaces: CLOUDS_DATA_SURFACES, subjectId: 'board:pulse', faceIds: FLAGSHIP_FACE_IDS });
  const registerStandby = useStandbyDim({ surfaces: CLOUDS_DATA_SURFACES, subjectId: 'roster:sail', faceIds: REGISTER_FACE_IDS });
  const fixturesStandby = useStandbyDim({ surfaces: CLOUDS_DATA_SURFACES, subjectId: 'board:schedule', faceIds: FIXTURES_FACE_IDS });

  return (
    <group>
      <FocusSubject
        id="board:pulse"
        kind="board"
        label={t('subjects.clouds.pulse')}
        facing={FLAGSHIP_FACING}
        panel={PULSE_PANEL}
        bounds={FLAGSHIP_BOUNDS}
      >
        <MooredAirship ship={FLAGSHIP} night={night} face={flagshipFace} pureEmission standby={flagshipStandby.materialProps} />
      </FocusSubject>
      <FocusSubject
        id="roster:sail"
        kind="roster"
        label={t('subjects.clouds.roster')}
        facing={REGISTER_FACING}
        panel={ROSTER_PANEL}
        bounds={REGISTER_BOUNDS}
      >
        <MooredAirship
          ship={REGISTER_AIRSHIP}
          night={night}
          face={sailFace}
          propHull={registerHullMounted}
          standby={registerStandby.materialProps}
        />
      </FocusSubject>
      <FocusSubject
        id="board:schedule"
        kind="board"
        label={t('subjects.clouds.schedule')}
        facing={FIXTURES_FACING}
        panel={SCHEDULE_PANEL}
        bounds={FIXTURES_BOUNDS}
      >
        <MooredAirship ship={FIXTURES_AIRSHIP} night={night} face={fixturesFace} standby={fixturesStandby.materialProps} />
      </FocusSubject>
      {TETHERS.map((t) => (
        <Tether key={t.from} from={tetherAnchor(t.from)} to={t.to} />
      ))}
    </group>
  );
}
