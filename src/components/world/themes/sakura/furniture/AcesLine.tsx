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
import { SAKURA_LEDGER_MATERIAL, SAKURA_LEDGER_STYLE } from '@/components/world/route/teams/ledger-styles';
import { formationAces, ledgerCopy, pickAceTracker, teamsRoster } from '@/components/world/route/teams/teams-roster';
import { makeTeamsSite, teamsFormation, type RiserLayout } from '@/lib/route-world/teams-formation';
import type { SakuraRouteData } from '../types';
import { SAKURA_STATIONS } from '../theme';
import { useSakuraPalette } from '../use-sakura-palette';
import StoneLantern from './StoneLantern';
import AceStatuary from './AceStatuary';
import {
  BlossomBed,
  EmaBoard,
  MossPatch,
  PennantCluster,
  RopeRailing,
  SteppingStones,
} from './Props';
import { ACES_LINE } from './layout';

/**
 * The #teams hero (C-093 r3 density pass): the east statuary terrace — the
 * plaza's teams tier in sakura materials. One statuary group per participant
 * (battered stone pedestal + gym band + the volumetric ace). Fidelity wave 2
 * (seat 2G, D16): the aces stand in the ZIPPER FORMATION in standings order
 * (`teams-formation.ts`), the rear rank on a coursed riser whose height the
 * ray-height law solves, and every name lives on ONE walnut Roll-Call Ledger
 * at the forecourt front edge — the per-pedestal plaques are gone; a paved
 * stepping-stone forecourt under the row;
 * the lantern line kept as the back rank and two tall bookend lanterns
 * framing the foreground; an ema board, a pennant cluster and a rope railing
 * dressing the approach. The framed sprite card fallback stands PROUD on its
 * pedestal cap, turned to the station eye — never a floating edge-on plane
 * (the r2 visual review's 12(e) finding).
 *
 * Zero Meshy involvement: the figures are the manifest GLBs the plaza row
 * already streams.
 */

/** Stable pseudo-random (the fixtures' law: no Math.random). */
const seeded = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The authored #teams eye (theme.ts) — plaques and cards turn toward it. */
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
        <meshStandardMaterial color="#4c3f2c" roughness={0.4} metalness={0.55} />
      </mesh>
      <mesh position={[0, 0.45, 0.015]}>
        <planeGeometry args={[0.66, 0.82]} />
        <meshStandardMaterial color="#161b22" roughness={0.22} metalness={0.1} />
      </mesh>
      {texture ? (
        <mesh position={[0, 0.45, 0.022]}>
          <planeGeometry args={[0.62, 0.62]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} fog={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/** The sakura site: the frozen #teams endpoints + the layout's plan. */
const SAKURA_TEAMS_SITE = makeTeamsSite('sakura', SAKURA_STATIONS, ACES_LINE.site);
const TEAMS_INDEX = SAKURA_STATIONS.findIndex((s) => s.id === 'teams');


/**
 * The rear rank's riser: a plinth course, a run of coursed blocks and an
 * overhanging cap in the park's granite — the plaza's Terrace idiom,
 * segmented so the coursing reads at stone scale (PB-069), not one slab.
 * Extent and height come from the formation (`riser`, formation frame:
 * +x back from the front line, +z screen right).
 */
function Terrace({ riser }: { riser: RiserLayout }) {
  const palette = useSakuraPalette();
  const courses = ACES_LINE.riserCourses;
  const span = riser.x1 - riser.x0;
  const baseH = Math.min(0.12, riser.height * 0.3);
  const capH = Math.min(0.15, riser.height * 0.3);
  const bodyH = Math.max(0.01, riser.height - baseH - capH);
  const blockZ = (riser.z1 - riser.z0) / courses;
  const body = palette.lanternStone;
  const cap = palette.pathColor;
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

/** The participant's ace (re-exported for ParkFigures — the shared teams-roster pick). */
export { pickAceTracker };

export default function AcesLine({ night }: { night: boolean }) {
  const { participants, trackers, standings } = useRouteData<SakuraRouteData>();
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
  const formation = useMemo(() => teamsFormation(SAKURA_TEAMS_SITE, formationAces(roster)), [roster]);
  const copy = useMemo(() => ledgerCopy(roster), [roster]);

  // Kick every GLB at once — mount-order fetches leave the last statue a
  // minute behind the first (the plaza's PB-100 law).
  useEffect(() => {
    for (const ace of roster) {
      if (ace.entry) preloadFigure(figureUrl(ace.entry));
    }
  }, [roster]);

  // Moss fringes around the forecourt (seeded, off both painted paths).
  const moss = useMemo(
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

  const backLanternZ = useMemo(() => {
    const { count, spacing } = ACES_LINE.backLanterns;
    const half = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => (i - half) * spacing);
  }, []);

  const { frame } = formation;

  return (
    <group>
      {/* Paved forecourt under and around the statuary row — the crossing
          path's stone arrival (painted strip ends at x=12.5; this starts
          12.6, so nothing overlaps either painted path). */}
      <group position={[0, 0, 0]}>
        <SteppingStones
          x0={ACES_LINE.forecourt.x0}
          x1={ACES_LINE.forecourt.x1}
          z0={-ACES_LINE.forecourt.halfZ}
          z1={ACES_LINE.forecourt.halfZ}
          count={46}
          seed={500}
        />
        {moss.map((m) => (
          <MossPatch key={m.seed} x={m.x} z={m.z} s={m.s} seed={m.seed} />
        ))}
      </group>

      {/* The coursed riser under the rear rank (formation frame). */}
      {roster.length > 1 ? (
        <group position={[frame.origin[0], frame.origin[1], frame.origin[2]]} rotation={[0, frame.yaw, 0]}>
          <Terrace riser={formation.riser} />
        </group>
      ) : null}

      {/* The zipper formation (standings order; eye-turned statuary). */}
      {formation.slots.map((slot, i) => {
        const ace = roster[i];
        return (
          <AceStatuary
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
            pedestalH={slot.pedestalH}
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
          style={SAKURA_LEDGER_STYLE}
          material={SAKURA_LEDGER_MATERIAL}
          night={night}
          teamsIndex={TEAMS_INDEX}
          label={t('subjects.rollCall')}
        />
      ) : null}

      {/* Back lantern rank behind the terrace (the park's east rhythm). */}
      <group position={[ACES_LINE.backLanterns.x, 0, 0]}>
        {backLanternZ.map((z, i) => (
          <group key={z} position={[0, 0, z]}>
            <StoneLantern scale={ACES_LINE.backLanterns.scale} night={night} practical={i % 3 === 0} />
          </group>
        ))}
      </group>

      {/* Avenue flankers + foreground bookends (the plaza framing lamps). */}
      {ACES_LINE.flankers.map((p) => (
        <group key={`flank-${p.z}`} position={[p.x, 0, p.z]}>
          <StoneLantern scale={0.95} night={night} />
        </group>
      ))}
      {([-1, 1] as const).map((side) => (
        <group key={`book-${side}`} position={[ACES_LINE.bookends.x, 0, side * ACES_LINE.bookends.z]}>
          <StoneLantern scale={ACES_LINE.bookends.scale} night={night} practical={side === 1} />
        </group>
      ))}

      {/* Supporting props (angle-checked against the authored pose). */}
      <EmaBoard
        x={ACES_LINE.ema.x}
        z={ACES_LINE.ema.z}
        yaw={faceEye(ACES_LINE.ema.x, ACES_LINE.ema.z)}
      />
      <PennantCluster poles={ACES_LINE.pennants} />
      <RopeRailing x={ACES_LINE.railing.x} posts={ACES_LINE.railing.posts} />

      {/* A blossom bed at each bookend's foot ties the approach together. */}
      <BlossomBed x={11.1} z={2.2} seed={71} />
      <BlossomBed x={11.1} z={-2.2} seed={72} />
    </group>
  );
}
