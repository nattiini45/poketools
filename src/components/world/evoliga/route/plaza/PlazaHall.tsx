'use client';

import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { useHasWorldTextureSet, useWorldTextureSet } from '@/components/world/route/env/world-textures';
import { useThemeTextureRoleActive, useThemeTextureSet } from '@/components/world/route/env/ThemeTextureSet';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { ResidentSuspense } from '@/components/world/route/residency-store';
import { useStationSettle } from '@/components/world/route/useStationSettle';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { useEvoligaRouteData } from '../route-data';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import { cobblePigment, type PlazaWorldPalette } from '@/components/world/themes/plaza/theme-palette';
import {
  ashlarPlaceholderMaps,
  assignAshlarMaps,
  disposeAshlarMaps,
  patchAshlar,
  publishAshlarMaps,
  publishedAshlarMaps,
  subscribeAshlarMaps,
  plazaWindowClear,
} from '@/components/world/themes/plaza/paint-ashlar';
import { FURNITURE, GATE, PLAZA } from '@/lib/route-world/layout';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_LAMPS } from '@/lib/route-world/teams-formation';
import { propUrl, useWorldManifest, type PropEntry } from '@/lib/route-world/model-manifest';
import { KERB, plazaBlockPlans, plazaKerb, type BlockPlan } from '@/lib/route-world/haussmann';
import { plazaMaskUrl } from '@/lib/route-world/world-env';
import { PLAZA_GROUND_PLANE } from '@/lib/route-world/plaza-ground';
import { activeEmitters, emitterColor, PLAZA_EMITTER_SLOTS } from '@/lib/route-world/plaza-emitters';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { registerGenerationPrefetch } from '@/components/world/route/figures/generation-prefetch';
import { PLAZA_LAMP_PROP, plazaKnownGLBs } from './plaza-prefetch';
import AmbientFigures from './AmbientFigures';
import Board from './board/Board';
import { buildBoardContent } from './board/board-content';
import { useLocale } from '@/i18n/client';
import CenterDesk from './CenterDesk';
import ChallengeGate from './ChallengeGate';
import DeskHolo from './DeskHolo';
import HaussmannBlock, { type FacadeMaps } from './HaussmannBlock';
import { prefetchFacadeKit, useFacadeKit, useHasFacadeKit, type KitModels } from './facade-kit';
import { createPaintedGround, pigmentLuminance, unitLuma, type PaintedGround } from './paint-ground';
import { useAshlarPair, type AshlarPairTints } from './Plinth';
import StatueRow from './StatueRow';
import Trees from './Trees';
import LampHalos from './LampHalos';

const COBBLE_PLANE = PLAZA_GROUND_PLANE.size;
/** Poly Haven `cobblestone_floor_08` (and its painted bake) covers ≈ 2 m per tile. */
const GROUND_REPEAT: readonly [number, number] = [COBBLE_PLANE / 2.1, COBBLE_PLANE / 2.1];

// ── Ground ───────────────────────────────────────────────────────────────────

/**
 * Point the painted ground at the resolved `plaza-ground` set (the theme
 * declares the role and the manifest ships it). Suspends while it loads.
 */
function PaintedGroundSet({ ground }: { ground: PaintedGround }) {
  const set = useThemeTextureSet('plaza-ground', GROUND_REPEAT);
  useLayoutEffect(() => {
    if (!set) return undefined;
    ground.setSurface({ map: set.map, normalMap: set.normalMap });
    return () => ground.setSurface(null);
  }, [ground, set]);
  return null;
}

/** Until the theme declares `plaza-ground`, the scanned cobble set feeds the same material. */
function ScannedGroundSet({ ground }: { ground: PaintedGround }) {
  const set = useWorldTextureSet('cobble', GROUND_REPEAT);
  useLayoutEffect(() => {
    ground.setSurface({ map: set.map, normalMap: set.normalMap });
    return () => ground.setSurface(null);
  }, [ground, set]);
  return null;
}

/**
 * The baked story mask (`env/plaza/mask.webp`). three's texture defaults are
 * exactly its contract — linear (NoColorSpace), clamped, flipY — so the
 * loaded texture is used as is and shares drei's one upload.
 */
function GroundMask({ ground, url }: { ground: PaintedGround; url: string }) {
  const mask = useTexture(url);
  useLayoutEffect(() => {
    ground.setMask(mask);
    return () => ground.setMask(null);
  }, [ground, mask]);
  return null;
}

function GroundMaps({ ground }: { ground: PaintedGround }) {
  const painted = useThemeTextureRoleActive('plaza-ground');
  const scanned = useHasWorldTextureSet('cobble');
  const maskUrl = plazaMaskUrl(useWorldManifest());
  return (
    <>
      {painted ? <PaintedGroundSet ground={ground} /> : scanned ? <ScannedGroundSet ground={ground} /> : null}
      {maskUrl ? <GroundMask ground={ground} url={maskUrl} /> : null}
    </>
  );
}

const _emit = new THREE.Color();

/**
 * Palette / night / rung look of the ground — uniform writes only.
 * Hue-only tint (LOOK-PLAN §1.2): the pigment's hue at unit luminance, lerped
 * 0.35 from white; its value rides separately as the pigment's luminance, so
 * the ground keeps today's footer luma (the ⅓ rule). Reflections: the first
 * `emitters` table entries, night only.
 */
function writeGroundLook(
  ground: PaintedGround,
  look: {
    stone: readonly [number, number, number];
    wet: number;
    emitters: number;
    palette: { boardPulse: string; boardSchedule: string; centerRed: string };
    /** LOOK r6 (L6.2): the latched settled station — its practicals reflect first. */
    station?: string | null;
  },
): void {
  const u = ground.uniforms;
  const [sr, sg, sb] = look.stone;
  unitLuma(new THREE.Color().setRGB(sr / 255, sg / 255, sb / 255, THREE.SRGBColorSpace), u.uPgTint.value);
  u.uPgValue.value = pigmentLuminance(look.stone);
  u.uPgWet.value = look.wet;
  const emitters = activeEmitters(look.emitters, look.station);
  for (let i = 0; i < PLAZA_EMITTER_SLOTS; i += 1) {
    const e = emitters[i];
    if (!e) {
      u.uPgEmitA.value[i].set(0, 0, 0, 0);
      u.uPgEmitB.value[i].set(0, 0, 0, 0);
      continue;
    }
    _emit.set(emitterColor(e, look.palette)).multiplyScalar(e.intensity);
    u.uPgEmitA.value[i].set(e.at[0], e.y[0], e.at[1], e.halfWidth);
    u.uPgEmitB.value[i].set(_emit.r, _emit.g, _emit.b, e.y[1]);
  }
  u.uPgEmitCount.value = emitters.length;
}

/**
 * The painted plaza floor (LOOK-PLAN §2 S.1–2). ONE material for the life of
 * the plaza (`createPaintedGround`): palette, night and rung are uniform
 * writes, the resolved textures are assignments over same-configuration
 * placeholders — nothing here ever relinks, and the 2048² procedural cobble
 * generator is gone (a manifest without the sets keeps the placeholder
 * stone, never a CPU bake). The maps load under a residency-counted
 * boundary, so the reveal waits for them.
 */
/**
 * LOOK r6 (L6.2): the settled station, LATCHED — it changes only when the
 * visitor has arrived at a different station (never mid-dolly), so the
 * emitter order is a rare uniform write, never a per-frame one.
 */
function useLatchedStationId(): string | null {
  const { station, settled } = useStationSettle();
  const id = settled ? (plazaTheme.stations[station]?.id ?? null) : null;
  const [latched, setLatched] = useState<string | null>(id);
  // Derived state (React's "adjust state while rendering"): the latch moves only on arrival.
  if (id !== null && id !== latched) setLatched(id);
  return id ?? latched;
}

function PlazaGround({ night, palette }: { night: boolean; palette: PlazaWorldPalette }) {
  const ground = useMemo(() => createPaintedGround(), []);
  useEffect(() => () => ground.dispose(), [ground]);
  const { puddleEmitters } = useQuality();
  const pigment = cobblePigment(palette);
  const [sr, sg, sb] = pigment.stone;
  const wet = night ? Math.max(pigment.wetness, 0.85) : pigment.wetness;
  const { boardPulse, boardSchedule, centerRed } = palette;
  const station = useLatchedStationId();

  useLayoutEffect(() => {
    writeGroundLook(ground, {
      stone: [sr, sg, sb],
      wet: night ? wet : 0,
      emitters: night ? puddleEmitters : 0,
      palette: { boardPulse, boardSchedule, centerRed },
      station,
    });
  }, [ground, night, sr, sg, sb, wet, puddleEmitters, boardPulse, boardSchedule, centerRed, station]);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, PLAZA_GROUND_PLANE.y, 0]}
        receiveShadow
        material={ground.material}
        name="plaza-ground"
      >
        <planeGeometry args={[COBBLE_PLANE, COBBLE_PLANE]} />
      </mesh>
      <ResidentSuspense id="plaza:ground-maps">
        <GroundMaps ground={ground} />
      </ResidentSuspense>
    </>
  );
}

// ── Perimeter ────────────────────────────────────────────────────────────────

/** SlotWriter UVs are metres / 1.55, so one texture tile spans 1.55 m of wall. */
const FACADE_REPEAT: readonly [number, number] = [1, 1];

/**
 * The five blocks, each carrying the plaza window-light keep-out: a lit pane
 * whose world sphere reaches a keep-out wedge or a calm box stays dark
 * (LOOK-PLAN §2 S.3). Static — the plans never change.
 */
const PLAZA_PLANS: readonly BlockPlan[] = plazaBlockPlans(PLAZA.half).map((plan) => ({
  ...plan,
  windowClear: plazaWindowClear,
}));

interface PerimeterProps {
  stone: string;
  night: boolean;
  facade: FacadeMaps | null;
  kit: KitModels | null;
}

function PerimeterBlocks({ stone, night, facade, kit }: PerimeterProps) {
  return (
    <group>
      {PLAZA_PLANS.map((plan) => (
        <HaussmannBlock key={plan.id} plan={plan} stone={stone} night={night} scanned={facade} kit={kit} />
      ))}
    </group>
  );
}

/** Loads the Blender façade modules once for all five blocks. */
function KitPerimeter(props: Omit<PerimeterProps, 'kit'>) {
  const kit = useFacadeKit();
  return <PerimeterBlocks {...props} kit={kit} />;
}

function SourcedKitPerimeter(props: Omit<PerimeterProps, 'kit'>) {
  const hasKit = useHasFacadeKit();
  return hasKit ? <KitPerimeter {...props} /> : <PerimeterBlocks {...props} kit={null} />;
}

type FacadeRoles = { stone: string; roof: string };
/** The painted sets (LOOK-PLAN §2 A.3) once the theme declares them; the scans until then. */
const PAINTED_ROLES: FacadeRoles = { stone: 'plaza-ashlar', roof: 'plaza-slate' };

/**
 * Hands a loaded stone set to every block and publishes it for the stone
 * furniture outside the perimeter (plinths, terrace, planters, kerb), which
 * build on same-configuration placeholders and swap it in without a relink.
 */
function FacadeFromSets({
  stoneSet,
  roofSet,
  ...props
}: Omit<PerimeterProps, 'kit' | 'facade'> & {
  stoneSet: { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture | null };
  roofSet: { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture | null };
}) {
  const facade = useMemo<FacadeMaps>(
    () => ({
      stone: { color: stoneSet.map, rough: stoneSet.arm, normal: stoneSet.normalMap, ao: stoneSet.arm },
      zinc: { color: roofSet.map, rough: roofSet.arm, normal: roofSet.normalMap, ao: roofSet.arm },
    }),
    [stoneSet, roofSet],
  );
  useLayoutEffect(() => {
    if (!stoneSet.arm) return undefined;
    const maps = { map: stoneSet.map, normalMap: stoneSet.normalMap, arm: stoneSet.arm };
    publishAshlarMaps(maps);
    return () => {
      if (publishedAshlarMaps() === maps) publishAshlarMaps(null);
    };
  }, [stoneSet]);
  return <SourcedKitPerimeter {...props} facade={facade} />;
}

function PaintedPerimeter(props: Omit<PerimeterProps, 'kit' | 'facade'>) {
  const stoneSet = useThemeTextureSet(PAINTED_ROLES.stone, FACADE_REPEAT);
  const roofSet = useThemeTextureSet(PAINTED_ROLES.roof, FACADE_REPEAT);
  if (!stoneSet || !roofSet) return <SourcedKitPerimeter {...props} facade={null} />;
  return <FacadeFromSets {...props} stoneSet={stoneSet} roofSet={roofSet} />;
}

/** Loads limestone + slate once for all five blocks; suspends until both resolve. */
function ScannedPerimeter(props: Omit<PerimeterProps, 'kit' | 'facade'>) {
  const limestone = useWorldTextureSet('limestone', FACADE_REPEAT);
  const slate = useWorldTextureSet('slate', FACADE_REPEAT);
  return <FacadeFromSets {...props} stoneSet={limestone} roofSet={slate} />;
}

function SourcedPerimeter(props: Omit<PerimeterProps, 'kit' | 'facade'>) {
  // D42 N7a: the kit modules download beside the stone / slate sets below
  // (their suspensions used to come first, then the kit one module at a time).
  prefetchFacadeKit(useWorldManifest());
  const paintedStone = useThemeTextureRoleActive(PAINTED_ROLES.stone);
  const paintedRoof = useThemeTextureRoleActive(PAINTED_ROLES.roof);
  const painted = paintedStone && paintedRoof;
  const hasLimestone = useHasWorldTextureSet('limestone');
  const hasSlate = useHasWorldTextureSet('slate');
  if (painted) return <PaintedPerimeter {...props} />;
  if (hasLimestone && hasSlate) return <ScannedPerimeter {...props} />;
  return <SourcedKitPerimeter {...props} facade={null} />;
}

/**
 * The perimeter mounts once its maps are in: no procedural stand-in renders
 * (and compiles) under the ceremony only to be replaced. The boundary counts
 * toward residency, so the reveal waits for it.
 */
function Perimeter(props: { stone: string; night: boolean }) {
  return (
    <ResidentSuspense id="plaza:perimeter">
      <SourcedPerimeter {...props} />
    </ResidentSuspense>
  );
}

// ── Kerb ─────────────────────────────────────────────────────────────────────

const KERB_TINT = { day: '#d6c9b0', night: '#7f796f' } as const;

/**
 * The kerb band (LOOK-PLAN §2 S.5): one InstancedMesh of RoundedBox stones
 * at |x|, |z| ≈ 17.2 m on the instanced painted-ashlar program with coursing
 * off (the stones ARE the courses). Seats: `plazaKerb()` — façade spans only,
 * clear of the gate, the gantry, the Center and every walker route.
 */
function Kerb({ night }: { night: boolean }) {
  const seats = useMemo(() => plazaKerb(), []);
  const geometry = useMemo(
    () => new RoundedBoxGeometry(KERB.length, KERB.height, KERB.depth, 2, KERB.radius),
    [],
  );
  const stone = useMemo(() => {
    const placeholders = ashlarPlaceholderMaps();
    const material = new THREE.MeshStandardMaterial({
      map: placeholders.map,
      normalMap: placeholders.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: placeholders.arm,
      aoMap: placeholders.arm,
      aoMapIntensity: 0.7,
      roughness: 0.9,
      metalness: 0.02,
    });
    patchAshlar(material, { courseOn: 0, detail: 0.7 });
    return { material, placeholders };
  }, []);
  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(geometry, stone.material, Math.max(1, seats.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    seats.forEach((seat, i) => {
      q.setFromAxisAngle(up, seat.yaw);
      m.compose(new THREE.Vector3(seat.x, KERB.height / 2, seat.z), q, new THREE.Vector3(1, 1, 1));
      instanced.setMatrixAt(i, m);
    });
    instanced.count = seats.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.name = 'plaza-kerb';
    return instanced;
  }, [geometry, stone, seats]);

  useLayoutEffect(() => {
    const apply = () => assignAshlarMaps(stone.material, publishedAshlarMaps() ?? stone.placeholders);
    apply();
    return subscribeAshlarMaps(apply);
  }, [stone]);
  useLayoutEffect(() => {
    stone.material.color.set(night ? KERB_TINT.night : KERB_TINT.day);
  }, [stone, night]);
  useEffect(
    () => () => {
      mesh.dispose();
      geometry.dispose();
      stone.material.dispose();
      disposeAshlarMaps(stone.placeholders);
    },
    [mesh, geometry, stone],
  );

  if (seats.length === 0) return null;
  return <primitive object={mesh} />;
}

/**
 * Lattice tower tiers, bottom to top: [baseY, topY, legRadiusAtBase,
 * legRadiusAtTop]. Four legs on the diagonals lean inward tier by tier, so the
 * silhouette is the Eiffel/Prism flare rather than a straight mast.
 */
const TOWER_TIERS: readonly [number, number, number, number][] = [
  [0, 22, 6.2, 3.4],
  [22, 42, 3.4, 1.7],
  [42, 60, 1.7, 0.7],
];
const TOWER_LEG_ANGLES = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2);
const UP = new THREE.Vector3(0, 1, 0);

function legPoint(y: number, r: number, angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
}

/** A box member spanning two points — legs, rings and X-braces all use it. */
function Bar({ a, b, w, material }: { a: THREE.Vector3; b: THREE.Vector3; w: number; material: THREE.Material }) {
  const { position, quaternion, length } = useMemo(() => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    return { position: a.clone().add(b).multiplyScalar(0.5), quaternion: q, length: len };
  }, [a, b]);
  return (
    <mesh position={position} quaternion={quaternion} material={material}>
      <boxGeometry args={[w, length, w]} />
    </mesh>
  );
}

function PrismTower({ night }: { night: boolean }) {
  const { tower } = FURNITURE;
  const core = night ? '#ff7ad9' : '#5ad0ff';

  const steel = useMemo(
    // LOOK r4 (CLARITY: the deck's sun specular behind the schedule board set
    // the frame's outside P99.5): a satin painted steel, not a mirror.
    () => new THREE.MeshStandardMaterial({ color: '#b4bec8', roughness: 0.72, metalness: 0.3 }),
    [],
  );
  useEffect(() => () => steel.dispose(), [steel]);

  const members = useMemo(() => {
    const out: { key: string; a: THREE.Vector3; b: THREE.Vector3; w: number }[] = [];
    TOWER_TIERS.forEach(([y0, y1, r0, r1], tier) => {
      const legW = 0.34 - tier * 0.08;
      TOWER_LEG_ANGLES.forEach((angle, k) => {
        const next = TOWER_LEG_ANGLES[(k + 1) % 4];
        out.push({ key: `leg-${tier}-${k}`, a: legPoint(y0, r0, angle), b: legPoint(y1, r1, angle), w: legW });
        // Ring beams at the tier's base and X-braces on each face.
        out.push({ key: `ring-${tier}-${k}`, a: legPoint(y0, r0, angle), b: legPoint(y0, r0, next), w: legW * 0.7 });
        const mid = (y0 + y1) / 2;
        const rm = (r0 + r1) / 2;
        out.push({ key: `xa-${tier}-${k}`, a: legPoint(y0, r0, angle), b: legPoint(mid, rm, next), w: legW * 0.42 });
        out.push({ key: `xb-${tier}-${k}`, a: legPoint(y0, r0, next), b: legPoint(mid, rm, angle), w: legW * 0.42 });
        out.push({ key: `xc-${tier}-${k}`, a: legPoint(mid, rm, angle), b: legPoint(y1, r1, next), w: legW * 0.42 });
        out.push({ key: `xd-${tier}-${k}`, a: legPoint(mid, rm, next), b: legPoint(y1, r1, angle), w: legW * 0.42 });
        out.push({ key: `mid-${tier}-${k}`, a: legPoint(mid, rm, angle), b: legPoint(mid, rm, next), w: legW * 0.5 });
      });
    });
    // Crown ring where the legs meet the spire.
    const [, topY, , topR] = TOWER_TIERS[TOWER_TIERS.length - 1];
    TOWER_LEG_ANGLES.forEach((angle, k) => {
      const next = TOWER_LEG_ANGLES[(k + 1) % 4];
      out.push({ key: `crown-${k}`, a: legPoint(topY, topR, angle), b: legPoint(topY, topR, next), w: 0.16 });
    });
    return out;
  }, []);

  const topY = TOWER_TIERS[TOWER_TIERS.length - 1][1];

  return (
    <group position={[tower.x, 0, tower.z]}>
      {members.map((m) => (
        <Bar key={m.key} a={m.a} b={m.b} w={m.w} material={steel} />
      ))}
      {/* Observation deck at the second tier line */}
      <mesh position={[0, TOWER_TIERS[1][0] + 0.4, 0]} material={steel}>
        <cylinderGeometry args={[4.1, 4.1, 0.8, 16]} />
      </mesh>
      {/* Lit spine and spire */}
      <mesh position={[0, topY / 2 + 2, 0]}>
        <cylinderGeometry args={[0.14, 0.14, topY + 4, 8]} />
        <meshStandardMaterial
          color={core}
          emissive={core}
          // LOOK r4 (CLARITY schedule headroom): the day spine glows, it never outshines a face.
          emissiveIntensity={night ? 5 : 1.5}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, topY + 6, 0]} material={steel}>
        <coneGeometry args={[0.9, 12, 8]} />
      </mesh>
      <pointLight position={[0, topY * 0.55, 0]} color={core} intensity={night ? 22 : 8} distance={52} />
    </group>
  );
}

/** The north façade's two boards, fed once from the page-loaded league data. */
function BoardWall({ palette, night }: { palette: PlazaWorldPalette; night: boolean }) {
  const { pulseBoard, scheduleBoard } = FURNITURE;
  const data = useEvoligaRouteData();
  // i18n D11: the boards paint in the viewer's language; the locale is known
  // before the page textures are built, so they are complete at the reveal.
  const locale = useLocale();
  const content = useMemo(() => buildBoardContent(data, locale), [data, locale]);
  const pulseTheme = useMemo(
    () => ({ accent: palette.boardPulse, red: palette.centerRed, live: palette.live }),
    [palette.boardPulse, palette.centerRed, palette.live],
  );
  const scheduleTheme = useMemo(
    () => ({ accent: palette.boardSchedule, red: palette.centerRed, live: palette.live }),
    [palette.boardSchedule, palette.centerRed, palette.live],
  );

  return (
    <group>
      <BoardGantry z={pulseBoard.z - 1.7} />
      <Board kind="pulse" at={pulseBoard} content={content} theme={pulseTheme} night={night} />
      <Board kind="schedule" at={scheduleBoard} content={content} theme={scheduleTheme} night={night} />
    </group>
  );
}

const GANTRY_STEEL = { color: '#15171c', roughness: 0.48, metalness: 0.62 } as const;
const GANTRY_STEEL_LIGHT = { color: '#23262d', roughness: 0.42, metalness: 0.66 } as const;

/** One pylon: tapered lattice column with base flange, bolt plates and a cap. */
function GantryPylon({ x, top, wide }: { x: number; top: number; wide: boolean }) {
  const w = wide ? 0.5 : 0.36;
  return (
    <group position={[x, 0, 0]}>
      {/* Base flange plate on the cobbles, four anchor bolts. */}
      <mesh position={[0, 0.045, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.5, 0.09, w + 0.5]} />
        <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
      </mesh>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh key={i} position={[(sx * (w + 0.28)) / 2, 0.13, (sz * (w + 0.28)) / 2]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.16, 6]} />
          <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
        </mesh>
      ))}
      {/* Shaft, a mid collar, and a cap plate under the beam seat. */}
      <mesh position={[0, top / 2 + 0.09, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, top - 0.18, w]} />
        <meshStandardMaterial {...GANTRY_STEEL} />
      </mesh>
      <mesh position={[0, top * 0.55, 0]} castShadow>
        <boxGeometry args={[w + 0.1, 0.14, w + 0.1]} />
        <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
      </mesh>
      <mesh position={[0, top - 0.09, 0]} castShadow>
        <boxGeometry args={[w + 0.3, 0.14, w + 0.3]} />
        <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
      </mesh>
    </group>
  );
}

/**
 * Stadium scoreboard gantry filling the north through-void: three lattice
 * pylons with flanged bases and bolt plates, twin box beams trussed with
 * diagonals, and a cable tray strung along the top chord — a real section,
 * not three prisms.
 */
function BoardGantry({ z }: { z: number }) {
  const halfSpan = 9.2;
  const top = 7.4;
  return (
    <group position={[0, 0, z]}>
      {([-halfSpan, 0, halfSpan] as const).map((x) => (
        <GantryPylon key={x} x={x} top={top} wide={x !== 0} />
      ))}
      {/* Twin chords per beam: top + bottom box sections. */}
      {([1.35, top - 0.2] as const).map((y) =>
        ([-0.24, 0.24] as const).map((dz) => (
          <mesh key={`${y}-${dz}`} position={[0, y, dz]} castShadow receiveShadow>
            <boxGeometry args={[halfSpan * 2 + 0.5, 0.26, 0.22]} />
            <meshStandardMaterial {...GANTRY_STEEL} />
          </mesh>
        )),
      )}
      {/* Zigzag web between each chord pair. */}
      {([1.35, top - 0.2] as const).map((y) =>
        Array.from({ length: 12 }, (_, i) => {
          const x = -halfSpan + (i * (halfSpan * 2)) / 11;
          const lean = i % 2 === 0 ? 1 : -1;
          const rise = 0.78;
          return (
            <mesh
              key={`web-${y}-${i}`}
              position={[x, y + lean * 0.18, 0]}
              rotation={[lean * 0.5, 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.12, rise, 0.12]} />
              <meshStandardMaterial {...GANTRY_STEEL} />
            </mesh>
          );
        }),
      )}
      {/* Cable tray: U channel on the top beam, strapped at every pylon. */}
      <mesh position={[0, top + 0.06, 0.34]} castShadow>
        <boxGeometry args={[halfSpan * 2 + 0.4, 0.05, 0.3]} />
        <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
      </mesh>
      {[-1, 0, 1].map((k) => (
        <group key={k}>
          <mesh position={[k * halfSpan, top + 0.13, 0.34]} castShadow>
            <boxGeometry args={[0.34, 0.12, 0.12]} />
            <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
          </mesh>
          <mesh position={[k * halfSpan, top + 0.16, 0.2]} castShadow>
            <boxGeometry args={[0.1, 0.16, 0.36]} />
            <meshStandardMaterial {...GANTRY_STEEL_LIGHT} />
          </mesh>
        </group>
      ))}
      {/* Diagonal braces in the outer bays */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={side}
          position={[side * (halfSpan / 2), top / 2 + 0.55, 0]}
          rotation={[0, 0, side * 0.62]}
          castShadow
        >
          <boxGeometry args={[0.14, 7.2, 0.14]} />
          <meshStandardMaterial {...GANTRY_STEEL} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * World box of a mounted prop scene (C-043's HeroProps idiom, reused for the
 * station fixtures — PB-194's reference implementation is read, not moved).
 * Static exports only — no skinning to relax — so the geometry boxes are exact;
 * the union still runs through each node's world matrix because exporters park
 * scales on inner nodes.
 */
function propMeshBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return;
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local || local.isEmpty()) return;
    box.union(local.clone().applyMatrix4(node.matrixWorld));
  });
  return box;
}

/**
 * Uniform scale putting `sizeM` real-world metres along one axis of the prop's
 * RECORDED bounds. Meshy normalizes every generation to its own ~1.9-unit box,
 * so the model unit is meaningless — only the bounds-extent ratio is (PB-166).
 */
function propScale(entry: PropEntry, sizeM: number, axis: 'x' | 'y'): number {
  const { min, max } = entry.bounds;
  const extent = axis === 'x' ? max[0] - min[0] : max[1] - min[1];
  return sizeM / Math.max(extent, 1e-3);
}

/**
 * C-054: the six street-lamp seats now carry the manifest's Meshy
 * `haussmann-lamp-post` (20,319 tris) instead of the authored twin-globe
 * fixture — the deep station replacement C-043 deferred. SEATS UNCHANGED:
 * north pair outside the board span (±8.2) so no head crosses a cabinet from
 * the #pulse / #schedule endpoints; east pair flanking the statue-row apron
 * (wave-2 r3: re-seated to (12.2, ±5.2), see below); south pair in the gate forecourt.
 * The GLB is fitted to 4.4 m — the height C-043 proved for this prop, which
 * matches the authored posts' trim envelope (C-041's postH 3.85 lamps topped
 * out at the ≈4.4–4.5 m arm line), so the committed frame compositions carry
 * over; the head-line projection per station is re-verified by C-054.
 */
const LAMP_PROP = PLAZA_LAMP_PROP;
const LAMP_SIZE_M = 4.4;
const LAMP_NIGHT_POOL = {
  color: '#ffd9a0',
  /** The authored StreetLamp's pool class (postH − 0.2 ≈ 3.65): same warm
   * cobble pools at the same seats, and the lantern head reads lit at night
   * (PB-198 — the GLB itself carries no emissive channel). */
  y: 3.65,
  intensity: 34,
  distance: 16,
} as const;

/**
 * Wave-2 r3 (TEAMS judge): the seats are `PLAZA_LAMP_SEATS`
 * (teams-formation.ts) — the one list the data faces box and the teams
 * keep-out test judges. The east pair moved from the C-041 seats
 * (12.2, ±2.6), which stood in front of ranks 2 / 7 / 8 and filled every
 * `?team=` focus shot, to `PLAZA_TEAMS_LAMPS` (12.2, ±5.2): outside every
 * ace column and the ledger at 1440 / 768 / 390.
 */
const LAMP_POSTS = PLAZA_LAMP_SEATS;

/**
 * LOOK r4 (CLARITY residual: "tall street lamps stand in front of the teams
 * tableau on the approach"): the teams pair (`PLAZA_TEAMS_LAMPS`) stands
 * shorter — the same seats (the keep-out law and the tests read them), a
 * smaller lamp inside the same 4.4 m box, its head and pool lowered with it.
 */
const TEAMS_LAMP_SIZE_M = 3.3;

function isTeamsLamp(at: readonly [number, number]): boolean {
  return PLAZA_TEAMS_LAMPS.some((seat) => seat[0] === at[0] && seat[1] === at[1]);
}

function lampSizeAt(at: readonly [number, number]): number {
  return isTeamsLamp(at) ? TEAMS_LAMP_SIZE_M : LAMP_SIZE_M;
}

function StreetLamp({ entry, at }: { entry: PropEntry; at: readonly [number, number] }) {
  const gltf = useFigureGLTF(propUrl(entry));

  const fitted = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    root.scale.setScalar(propScale(entry, lampSizeAt(at), 'y'));
    const box = propMeshBounds(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
    }
    return root;
  }, [gltf.scene, entry, at]);

  return (
    <group position={[at[0], 0, at[1]]} name="street-lamp-prop">
      <primitive object={fitted} />
    </group>
  );
}

/**
 * The lamps' night pools (LOOK r2, ENGINE follow-up): mounted OUTSIDE every
 * Suspense boundary, from the first frame of a night generation, so the
 * scene's light count never changes while the load warm compiles (a light
 * arriving with its GLB re-keyed every lit program mid-load).
 */
function StreetLampPools({ night }: { night: boolean }) {
  if (!night) return null;
  return (
    <group>
      {LAMP_POSTS.map((at) => (
        <pointLight
          key={`${at[0]}-${at[1]}`}
          position={[at[0], (LAMP_NIGHT_POOL.y * lampSizeAt(at)) / LAMP_SIZE_M, at[1]]}
          color={LAMP_NIGHT_POOL.color}
          intensity={LAMP_NIGHT_POOL.intensity}
          distance={LAMP_NIGHT_POOL.distance}
          decay={2}
          castShadow={false}
        />
      ))}
    </group>
  );
}

/**
 * The six lamps as manifest props. The manifest fetch suspends under the OUTER
 * boundary PlazaHall wraps around this component; each GLB then suspends under
 * its own seat boundary with a null fallback — the preload effect commits as
 * soon as the manifest resolves and kicks every seat's GLB at once (PB-194).
 * A manifest without the prop simply renders no lamps (a re-bake gap never
 * blanks the plaza).
 */
function StreetLamps() {
  const manifest = useWorldManifest();
  const entry = manifest.props.find((prop) => prop.name === LAMP_PROP) ?? null;

  useEffect(() => {
    if (entry) preloadFigure(propUrl(entry));
  }, [entry]);

  if (!entry) return null;
  return (
    <group>
      {LAMP_POSTS.map((at) => (
        <Suspense key={`${at[0]}-${at[1]}`} fallback={null}>
          <StreetLamp entry={entry} at={at} />
        </Suspense>
      ))}
    </group>
  );
}

/**
 * Night accent on the gate's keystone pendant (C-040): the authored console
 * dropping from the entablature is lit cream by day but sat unlit against the
 * cornice shadow at night and read as a detached grey box (C-033 chief
 * residual 1). One warm, night-only, UNSHADOWED pool just off the pendant
 * face washes the console and the fascia band above it in the pier lanterns'
 * glow class, so the pendant reads as part of the gate — a warm pool of the
 * gate head, never a rival to the boards (look-sheet dark law). Night-only,
 * so light-theme stills stay byte-class unchanged; `castShadow={false}` keeps
 * the rung's `shadowedLights` budget untouched.
 */
const KEYSTONE_ACCENT = {
  /** Pendant centre height (gate-local y): the console spans y 4.35–5.09. */
  y: 4.45,
  /** Gate-local −Z is toward the #rules camera; the light rides ~1 m proud of
   * the console face (pier face −GATE.depth/2, console a further 0.55 out). */
  z: -GATE.depth / 2 - 1.6,
  /** The pier lanterns' warm glow class (ChallengeGate `LANTERN_GLOW`). */
  glow: '#ffcb87',
  intensity: 7,
  distance: 6,
} as const;

function GateKeystoneAccent({ night }: { night: boolean }) {
  const { gate } = FURNITURE;
  if (!night) return null;
  return (
    <pointLight
      position={[gate.x, KEYSTONE_ACCENT.y, gate.z + KEYSTONE_ACCENT.z]}
      color={KEYSTONE_ACCENT.glow}
      intensity={KEYSTONE_ACCENT.intensity}
      distance={KEYSTONE_ACCENT.distance}
      decay={2}
      castShadow={false}
    />
  );
}

/**
 * C-051: the statue row re-seat. At the frozen #teams pose the east wall has
 * exactly one shopfront bay in frame — bay z ≈ −3.83 m (bays 0/2 clip the
 * frame edge, bays 6–9 carry the LED assembly) — and every eye→glass ray of
 * its column (px ≈ 328..432, 1440) crossed the front-rank ace's body at
 * (14.1, −2.7): a dense raycast found 221/223 grid cells first-hitting the
 * SkinnedMesh, zero glass-first hits. Sliding the whole row 1.35 m south
 * moves that body (measured span z −3.0..−2.4) clear of the column's
 * sight-line band (z −2.96..−1.98 across the plinth depth) with ≥ 0.3 m
 * margin, tolerant of an ace up to ~0.86 m half-width at the slot; the rear
 * plinths (band −4.10..−2.54 at their depth), the terrace (y < 1.05 only) and
 * the shifted front-inner figure all clear by ≥ 0.3 m as well.
 *
 * Legality (PB-136): the row stays inside the ambient HERO_SEGMENTS capsule
 * (x 11.6..15.4, z −8.2..8.2 — walkers are excluded from the whole zone), off
 * the teams dolly corridor (ends x 11.2) and clear of the east lamp seats
 * (`PLAZA_TEAMS_LAMPS`, 12.2, ±5.2 since wave-2 r3 — outside every ace
 * column and the ledger; the retired C-041 seats (12.2, ±2.6) stood in front
 * of the aces) — the plinths never leave x ≥ 12.87. The
 * terrace keeps 0.73 m to the #teams frame edge, so the row stays the hero of
 * the composition, re-seated rather than reframed (chapters.ts is frozen).
 */
const STATUE_ROW_RESEAT_Z = 1.35;

/**
 * Planters (LOOK-PLAN §2 S.4): the painted ashlar family on RoundedBox
 * courses (0.03 m arrises) — body, proud rims and a chamfered foot — with the
 * soil bed plain. The planting is the shared Tree system's (`Trees.tsx`,
 * C-108): one real tree per seat, trunk based at the soil line.
 */
const PLANTER_TINT: AshlarPairTints = {
  day: { body: '#b4a78f', cap: '#9c907b' },
  night: { body: '#6f685d', cap: '#5f594f' },
};
const PLANTER_SOIL = { color: '#2a211a', roughness: 0.96 } as const;
const PLANTER_ARRIS = 0.03;
const PLANTER_SEATS: readonly (readonly [number, number])[] = [
  [-6, 8],
  [6, 8],
  [-9, 14],
  [9, 14],
];

function Planters({ night }: { night: boolean }) {
  const stone = useAshlarPair(night, PLANTER_TINT);
  const geometry = useMemo(
    () => ({
      body: new RoundedBoxGeometry(2.2, 0.4, 1.1, 2, PLANTER_ARRIS),
      foot: new RoundedBoxGeometry(2.34, 0.12, 1.24, 2, PLANTER_ARRIS),
      rim: new RoundedBoxGeometry(2.32, 0.1, 1.22, 2, PLANTER_ARRIS),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.body.dispose();
      geometry.foot.dispose();
      geometry.rim.dispose();
    },
    [geometry],
  );
  return (
    <group>
      {PLANTER_SEATS.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.2, 0]} geometry={geometry.body} material={stone.body} castShadow receiveShadow />
          <mesh position={[0, 0.06, 0]} geometry={geometry.foot} material={stone.cap} castShadow receiveShadow />
          <mesh position={[0, 0.43, 0]} geometry={geometry.rim} material={stone.cap} castShadow receiveShadow />
          {/* Soil bed inset below the rim — the tree's ground. */}
          <mesh position={[0, 0.46, 0]} receiveShadow>
            <boxGeometry args={[2.08, 0.04, 0.98]} />
            <meshStandardMaterial {...PLANTER_SOIL} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The League Challenge plaza — one hall, furniture on the walls, sky and a
 * Prism-like tower beyond the jumbotron. Materials follow the ZA stills:
 * cream stone, wet cobbles, red Center signage, authored LED boards.
 */
export default function PlazaHall() {
  const palette = usePlazaPalette();
  const night = palette.exposure < 0.75;
  const stone = night ? '#8d8680' : '#d9cbb6';

  return (
    <group>
      <PlazaGround night={night} palette={palette} />
      <Perimeter stone={stone} night={night} />
      <Kerb night={night} />
      <PrismTower night={night} />
      <CenterDesk palette={palette} night={night} />
      <DeskHolo palette={palette} night={night} />
      <BoardWall palette={palette} night={night} />
      {/* C-051: the row group carries the re-seat offset so every child —
          plinths, aces, terrace, focus bounds, the row's own practicals —
          moves together and the focus rig frames the aces at their new seats. */}
      <group position={[0, 0, STATUE_ROW_RESEAT_Z]}>
        <StatueRow night={night} />
      </group>
      <ChallengeGate night={night} live={palette.live} />
      <GateKeystoneAccent night={night} />
      <Planters night={night} />
      {/* C-108: one real tree per planter seat (the shared Tree system over
          the package's own skins) replaces the topiary foliage masses. */}
      <Trees />
      {/* C-054: the outer boundary covers only the manifest fetch; each lamp
          GLB suspends under its own seat boundary inside (PB-194). */}
      <Suspense fallback={null}>
        <StreetLamps />
      </Suspense>
      <StreetLampPools night={night} />
      {/* LOOK r6 (L6.5): fog halos round the lamp heads and gate lanterns —
          always mounted (one program, warmed in the ceremony), gain 0 by day. */}
      <LampHalos night={night} />
      <AmbientFigures />
    </group>
  );
}

// D42 N7b: the plaza GLBs the manifest alone names (the façade kit, the lamp,
// the gate crest, the hero props) start downloading when a plaza generation
// begins, before this scene renders: registered once, when the scene chunk
// evaluates.
registerGenerationPrefetch(plazaTheme.id, plazaKnownGLBs);
