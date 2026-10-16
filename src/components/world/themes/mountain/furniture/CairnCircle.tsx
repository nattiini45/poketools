'use client';

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import * as THREE from 'three';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { figureUrl, useFigureIndex } from '@/lib/route-world/model-manifest';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { usePopulationCeiling } from '@/components/world/route/residency-store';
import { useN3RetagOnMount } from '@/components/world/route/post/n3-retag';
import { preloadFigure } from '@/components/world/route/figures/figure-loader';
import RollCallLedger from '@/components/world/route/teams/RollCallLedger';
import { MOUNTAIN_LEDGER_MATERIAL, MOUNTAIN_LEDGER_STYLE } from '@/components/world/route/teams/ledger-styles';
import { formationAces, ledgerCopy, pickAceTracker, teamsRoster } from '@/components/world/route/teams/teams-roster';
import { makeTeamsSite, teamsFormation, type RiserLayout } from '@/lib/route-world/teams-formation';
import type { MountainRouteData } from '../types';
import { MOUNTAIN_STATIONS } from '../theme';
import { useMountainPalette } from '../use-mountain-palette';
import Statuary from './Statuary';
import {
  PennantCluster,
  RopeRailing,
  Scrub,
  SnowPatch,
  SteppingStones,
  StormLantern,
} from './Props';
import { CAIRN_LINE } from './layout';

/**
 * The #teams hero: the east cairn terrace — the plaza's teams tier in
 * mountain materials. One statuary group per participant (battered stone
 * cairn + gym band + the volumetric ace). Fidelity wave 2 (seat 2G, D16):
 * the aces stand in the ZIPPER FORMATION in standings order
 * (`teams-formation.ts`), the rear rank on a coursed riser whose height the
 * ray-height law solves, and every name lives on ONE bronze Roll-Call Ledger
 * at the forecourt front edge — the per-cairn plates are gone (no lamp or
 * rope can stand over a name: they stand behind the ledger's face plane);
 * a paved stepping-stone forecourt under the row; the pine line as
 * the back rank and two tall bookend storm lanterns framing the foreground;
 * a trail-conditions board, a marker-pennant cluster and a rope railing
 * dressing the approach. The framed sprite card fallback stands PROUD on its
 * pedestal cap, turned to the station eye — never a floating edge-on plane.
 *
 * Zero Meshy involvement: the figures are the manifest GLBs the plaza row
 * already streams.
 */

/** Stable pseudo-random (the fixtures' law: no Math.random). */
const seeded = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The authored #teams eye (theme.ts) — plates and cards turn toward it. */
const TEAM_EYE = { x: 5.2, z: 0.2 } as const;

/** Yaw putting a group's local +Z face on the eye from (x, z). */
function faceEye(x: number, z: number): number {
  return Math.atan2(TEAM_EYE.x - x, TEAM_EYE.z - z);
}

/** Sprite URL through the image proxy (`connect-src` blocks the CDN). */
function spriteProxyUrl(species: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(getSpriteUrl(species))}`;
}

/**
 * The fallback shrine: a framed sprite card standing proud on the pedestal
 * cap — bezel, dark glass, sprite — never a naked plane (the plaza's PB-078
 * law). Rendered inside the statuary's eye-turned group, so the face is
 * always toward the camera.
 */
function AceShrineCard({ species }: { species: string }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      loaded = tex;
      setTexture(tex);
    };
    img.src = spriteProxyUrl(species);
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [species]);
  // D42 N3: the sprite plane is transparent and can mount after the reveal
  // (the proxy answers late); the exact AO pass retags it on its next frame.
  useN3RetagOnMount(texture);

  return (
    <group position={[0, 0.06, 0]}>
      <mesh position={[0, 0.45, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.74, 0.9, 0.06]} />
        <meshStandardMaterial color="#3c342a" roughness={0.4} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.45, 0.015]}>
        <planeGeometry args={[0.66, 0.82]} />
        <meshStandardMaterial color="#161b22" roughness={0.22} metalness={0.1} />
      </mesh>
      {texture ? (
        <mesh position={[0, 0.45, 0.022]}>
          <planeGeometry args={[0.62, 0.62]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/** The mountain site: the frozen #teams endpoints + the layout's plan. */
const MOUNTAIN_TEAMS_SITE = makeTeamsSite('mountain', MOUNTAIN_STATIONS, CAIRN_LINE.site);
const TEAMS_INDEX = MOUNTAIN_STATIONS.findIndex((s) => s.id === 'teams');


/**
 * The rear rank's riser: a plinth course, a run of coursed blocks and an
 * overhanging cap in the valley's granite — segmented so the coursing reads
 * at stone scale (PB-069), not one slab. Extent and height come from the
 * formation (`riser`, formation frame: +x back from the front line, +z
 * screen right).
 */
function Terrace({ riser }: { riser: RiserLayout }) {
  const palette = useMountainPalette();
  const courses = CAIRN_LINE.riserCourses;
  const span = riser.x1 - riser.x0;
  const baseH = Math.min(0.12, riser.height * 0.3);
  const capH = Math.min(0.15, riser.height * 0.3);
  const bodyH = Math.max(0.01, riser.height - baseH - capH);
  const blockZ = (riser.z1 - riser.z0) / courses;
  const body = palette.rockColor;
  const cap = palette.lanternStone;
  return (
    <group>
      {Array.from({ length: courses }, (_, i) => {
        const z = riser.z0 + blockZ * (i + 0.5);
        return (
          <group key={i} position={[0, 0, z]}>
            <mesh position={[riser.x0 + span / 2, baseH / 2, 0]} receiveShadow>
              <boxGeometry args={[span + 0.14, baseH, blockZ]} />
              <meshStandardMaterial color={body} roughness={0.9} metalness={0.02} />
            </mesh>
            {/* Battered ashlar: recessed off the base, an open joint each side. */}
            <mesh position={[riser.x0 + 0.05 + (span - 0.05) / 2, baseH + bodyH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[span - 0.05, bodyH, blockZ - 0.035]} />
              <meshStandardMaterial color={body} roughness={0.92} metalness={0.02} />
            </mesh>
            <mesh position={[riser.x0 + span / 2, riser.height - capH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[span + 0.08, capH, blockZ]} />
              <meshStandardMaterial color={cap} roughness={0.86} metalness={0.02} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** The participant's ace (re-exported for PassFigures — the shared teams-roster pick). */
export { pickAceTracker };

export default function CairnCircle({ night }: { night: boolean }) {
  const { participants, trackers, standings } = useRouteData<MountainRouteData>();
  const index = useFigureIndex();
  const t = useT(worldThemesMessages);
  // ENGINE r4 (D23; quiet probe governor leg: sprite fetches and a ledger
  // texture freed after the reveal): the hero population is frozen at the
  // reveal like the plaza's StatueRow — before it, it follows the rung.
  const { heroFigures: requestedHeroFigures } = useQuality();
  const heroFigures = usePopulationCeiling(requestedHeroFigures, false);

  // Standings order (D16): the formation, the ledger and the 390 rail agree.
  const roster = useMemo(
    () => teamsRoster(participants, trackers, standings, index, heroFigures),
    [participants, trackers, standings, index, heroFigures],
  );
  const formation = useMemo(() => teamsFormation(MOUNTAIN_TEAMS_SITE, formationAces(roster)), [roster]);
  const copy = useMemo(() => ledgerCopy(roster), [roster]);

  // Kick every GLB at once — mount-order fetches leave the last statue a
  // minute behind the first (the plaza's PB-100 law).
  useEffect(() => {
    for (const ace of roster) {
      if (ace.entry) preloadFigure(figureUrl(ace.entry));
    }
  }, [roster]);

  // Scree fringes around the forecourt (seeded, off both painted trails).
  const screePatches = useMemo(
    () =>
      (
        [
          [12.15, 5.95],
          [12.2, -5.9],
          [16.45, 2.3],
          [16.5, -2.1],
          [16.55, 0.1],
          [12.1, 2.1],
          [12.1, -2.2],
        ] as const
      ).map(([x, z], i) => ({ x, z, s: 0.8 + seeded(i + 311) * 0.7, seed: i })),
    [],
  );

  const backPineZ = useMemo(() => {
    const { count, spacing } = CAIRN_LINE.backPines;
    const half = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => (i - half) * spacing);
  }, []);

  const { frame } = formation;

  return (
    <group>
      {/* Paved forecourt under and around the statuary row — the crossing
          trail's stone arrival (painted strip ends at x=12.5; this starts
          12.6, so nothing overlaps either painted trail). */}
      <group position={[0, 0, 0]}>
        <SteppingStones
          x0={CAIRN_LINE.forecourt.x0}
          x1={CAIRN_LINE.forecourt.x1}
          z0={-CAIRN_LINE.forecourt.halfZ}
          z1={CAIRN_LINE.forecourt.halfZ}
          count={46}
          seed={500}
        />
        {screePatches.map((m) => (
          <SnowPatch key={m.seed} x={m.x} z={m.z} s={m.s} />
        ))}
      </group>

      {/* The coursed riser under the rear rank (formation frame). */}
      {roster.length > 1 ? (
        <group position={[frame.origin[0], frame.origin[1], frame.origin[2]]} rotation={[0, frame.yaw, 0]}>
          <Terrace riser={formation.riser} />
        </group>
      ) : null}

      {/* The zipper formation (standings order; eye-turned cairns). */}
      {formation.slots.map((slot, i) => {
        const ace = roster[i];
        return (
          <Statuary
            key={ace.playerId}
            slot={{
              playerId: ace.playerId,
              playerName: ace.playerName,
              gymType: ace.gymType,
              species: ace.species,
              entry: ace.entry,
              band: ace.band,
            }}
            pedestal={slot.pedestal}
            figure={slot.figure}
            yaw={slot.yaw}
            cardFor={(s) => <AceShrineCard species={s.species} />}
          />
        );
      })}

      {/* The Roll-Call Ledger: every name, under its statue, in standings order. */}
      {roster.length > 0 ? (
        <RollCallLedger
          layout={formation.ledger}
          copy={copy}
          style={MOUNTAIN_LEDGER_STYLE}
          material={MOUNTAIN_LEDGER_MATERIAL}
          night={night}
          teamsIndex={TEAMS_INDEX}
          label={t('subjects.rollCall')}
        />
      ) : null}

      {/* Scrub between the terrace and the back pine rank (the valley's
          east treeline reads behind the row). */}
      {backPineZ.filter((_, i) => i % 2 === 0).map((z) => (
        <group key={z} position={[15.9, 0, z]}>
          <Scrub x={0} z={0} s={1.15} />
        </group>
      ))}

      {/* Avenue flankers + foreground bookends (the framing lanterns). */}
      {CAIRN_LINE.flankers.map((p) => (
        <group key={`flank-${p.z}`} position={[p.x, 0, p.z]}>
          <StormLantern scale={0.95} night={night} />
        </group>
      ))}
      {([-1, 1] as const).map((side) => (
        <group key={`book-${side}`} position={[CAIRN_LINE.bookends.x, 0, side * CAIRN_LINE.bookends.z]}>
          <StormLantern scale={CAIRN_LINE.bookends.scale} night={night} practical={side === 1} />
        </group>
      ))}

      {/* Supporting props (angle-checked against the authored pose). */}
      <ConditionsBoard
        x={CAIRN_LINE.conditionsBoard.x}
        z={CAIRN_LINE.conditionsBoard.z}
        yaw={faceEye(CAIRN_LINE.conditionsBoard.x, CAIRN_LINE.conditionsBoard.z)}
      />
      <PennantCluster poles={CAIRN_LINE.pennants} />
      <RopeRailing x={CAIRN_LINE.railing.x} posts={CAIRN_LINE.railing.posts} />
    </group>
  );
}

/**
 * The trail-conditions board: a small post-mounted notice board at the
 * terrace approach — the valley's equivalent of the park's ema rack.
 */
function ConditionsBoard({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  const palette = useMountainPalette();
  const timber = palette.timberColor;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* Two legs + crossbar. */}
      <mesh position={[-0.62, 0.62, 0]} rotation={[0, 0, 0.12]} castShadow>
        <boxGeometry args={[0.07, 1.24, 0.07]} />
        <meshStandardMaterial color={timber} roughness={0.74} metalness={0.06} />
      </mesh>
      <mesh position={[0.62, 0.62, 0]} rotation={[0, 0, -0.12]} castShadow>
        <boxGeometry args={[0.07, 1.24, 0.07]} />
        <meshStandardMaterial color={timber} roughness={0.74} metalness={0.06} />
      </mesh>
      <mesh position={[0, 1.32, 0]} castShadow>
        <boxGeometry args={[1.5, 0.09, 0.07]} />
        <meshStandardMaterial color={timber} roughness={0.72} metalness={0.08} />
      </mesh>
      {/* Roof slat. */}
      <mesh position={[0, 1.46, 0]} castShadow>
        <boxGeometry args={[1.66, 0.05, 0.26]} />
        <meshStandardMaterial color={palette.cliffColor} roughness={0.88} metalness={0.02} />
      </mesh>
      {/* The notice face: pale board with routed ink lines. */}
      <mesh position={[0, 0.98, 0.02]} castShadow>
        <boxGeometry args={[1.2, 0.7, 0.04]} />
        <meshStandardMaterial color="#d9c9a8" roughness={0.8} metalness={0} />
      </mesh>
      {[0.16, 0.0, -0.16].map((dy, i) => (
        <mesh key={dy} position={[i === 1 ? -0.1 : -0.05, 0.98 + dy, 0.045]}>
          <boxGeometry args={[0.9 - i * 0.14, 0.05, 0.004]} />
          <meshStandardMaterial color="#4a3a28" roughness={0.7} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
