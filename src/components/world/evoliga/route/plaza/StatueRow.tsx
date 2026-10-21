'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { FURNITURE } from '@/lib/route-world/layout';
import { figureUrl, useFigureIndex } from '@/lib/route-world/model-manifest';
import { homeSpriteUrl } from '@/lib/pkmn/sprite-styles';
import { useQuality } from '@/components/world/route/QualityGovernor';
import Figure from '@/components/world/route/figures/Figure';
import { preloadFigure } from '@/components/world/route/figures/figure-loader';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import RollCallLedger from '@/components/world/route/teams/RollCallLedger';
import { PLAZA_LEDGER_MATERIAL, PLAZA_LEDGER_STYLE } from '@/components/world/route/teams/ledger-styles';
import { formationAces, ledgerCopy, teamsRoster, type TeamsRosterEntry } from '@/components/world/route/teams/teams-roster';
import { useStaggeredMount } from '@/components/world/route/useStationWarmup';
import type { SubjectBounds, Vec3Tuple } from '@/lib/route-world/focus';
import {
  PLAZA_ROW_RESEAT_Z,
  PLAZA_TEAMS_PLAN,
  makeTeamsSite,
  teamsFormation,
  type RiserLayout,
  type TeamsSlot,
} from '@/lib/route-world/teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { useEvoligaRouteData } from '../route-data';
import { DormancyScope, ResidentSuspense, usePopulationCeiling, useResidencyHold } from '@/components/world/route/residency-store';
import { useN3RetagOnMount } from '@/components/world/route/post/n3-retag';
import { useStationWindowState } from '../useStationWindow';
import { PEDESTAL_H, usePlinthStone, type PlinthStone } from './Plinth';
import { useDataLocale, useLocale } from '@/i18n/client';
import { routeT } from '@/lib/route-world/paint-copy';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

/** Aces shorter than this get a pedestal insert so their eye-line meets the camera. */
export const TINY_M = 0.5;

/**
 * Wave-2 r2 (TEAMS judge): the row's plinths are PLAIN STONE. The Meshy
 * `statue-plinth` GLB (C-054) carried a baked black plaque on its face that a
 * first-time visitor read as a missing label — and since D16 every name lives
 * on the Roll-Call Ledger, so the plaque had nothing to say. The plinth is
 * now Plinth.tsx's authored course profile (footing, base, battered shaft,
 * cavetto, gym band, cap) WITHOUT the plate, in the row's shared limestone
 * pair, so the static batcher folds every course of the row into one draw per
 * material — the 8 unbatched 14.4 k-tri GLB plinths are gone (the draw and
 * triangle delta DRAW-LEDGER records). The gym band stays, the ledger chip's
 * colour. A colossal ace stands on a LOW plinth (footing, band, cap; the
 * formation's `pedestalH`) under its own feet on the back line.
 */

/** Course heights / half-widths — Plinth.tsx's profile, restated (the plate is the only omission). */
const COURSE = {
  footH: 0.1,
  baseH: 0.1,
  cavettoH: 0.08,
  bandH: 0.05,
  capH: 0.1,
  footHalf: 0.54,
  baseHalf: 0.48,
  shaftBottom: 0.445,
  shaftTop: 0.4,
  capHalf: 0.52,
} as const;

/** Square-plan battered block: a four-sided cylinder turned an eighth so its flats face the axes. */
function Course({
  halfBottom,
  halfTop,
  height,
  y,
  material,
  receiveShadow = false,
}: {
  halfBottom: number;
  halfTop: number;
  height: number;
  y: number;
  material: THREE.Material;
  receiveShadow?: boolean;
}) {
  return (
    <mesh position={[0, y + height / 2, 0]} rotation={[0, Math.PI / 4, 0]} material={material} castShadow receiveShadow={receiveShadow}>
      <cylinderGeometry args={[halfTop * Math.SQRT2, halfBottom * Math.SQRT2, height, 4, 1]} />
    </mesh>
  );
}

/**
 * One plain plinth, `height` tall (cap top = the ace's feet). A full plinth
 * (≥ 0.6 m) keeps every course, its shaft taking up the height; a low plinth
 * is footing + gym band + cap.
 */
function PlainPlinth({
  height,
  band,
  pedestal,
  night,
  stone,
}: {
  height: number;
  band: string;
  pedestal: boolean;
  night: boolean;
  stone: PlinthStone;
}) {
  const c = COURSE;
  const full = height >= 0.6;
  const shaftH = full ? Math.max(0.05, height - (c.footH + c.baseH + c.cavettoH + c.bandH + c.capH)) : 0;
  const footH = full ? c.footH : Math.max(0.04, height - c.bandH - c.capH);
  const shaftY = c.footH + c.baseH;
  const bandY = full ? shaftY + shaftH + c.cavettoH : footH;
  const capY = bandY + c.bandH;
  return (
    <group>
      <Course halfBottom={c.footHalf} halfTop={c.footHalf - 0.03} height={footH} y={0} material={stone.body} receiveShadow />
      {full ? (
        <>
          <Course halfBottom={c.baseHalf} halfTop={c.baseHalf - 0.035} height={c.baseH} y={c.footH} material={stone.body} receiveShadow />
          <Course halfBottom={c.shaftBottom} halfTop={c.shaftTop} height={shaftH} y={shaftY} material={stone.body} />
          <Course halfBottom={c.shaftTop} halfTop={c.capHalf - 0.05} height={c.cavettoH} y={shaftY + shaftH} material={stone.cap} />
        </>
      ) : null}
      {/* Team-colour band under the cap — the ledger chip's colour. */}
      <mesh position={[0, bandY + c.bandH / 2, 0]} castShadow>
        <boxGeometry args={[(c.capHalf - 0.045) * 2, c.bandH, (c.capHalf - 0.045) * 2]} />
        <meshStandardMaterial color={band} emissive={band} emissiveIntensity={night ? 0.85 : 0.22} roughness={0.34} metalness={0.3} />
      </mesh>
      {/* Cap: the ace stands and drops its shadow here. */}
      <Course halfBottom={c.capHalf} halfTop={c.capHalf - 0.012} height={c.capH} y={capY} material={stone.cap} receiveShadow />
      {pedestal ? (
        <group position={[0, height, 0]}>
          <mesh position={[0, PEDESTAL_H / 2, 0]} castShadow receiveShadow material={stone.cap}>
            <cylinderGeometry args={[0.3, 0.36, PEDESTAL_H, 20]} />
          </mesh>
          <mesh position={[0, PEDESTAL_H - 0.018, 0]} castShadow receiveShadow material={stone.cap}>
            <cylinderGeometry args={[0.34, 0.3, 0.036, 20]} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

/** Size of a figure as it renders: `[width, height, depth]` in its own frame. */
type FigureSize = readonly [number, number, number];

function spriteProxyUrl(species: string): string {
  return `/api/proxy-image?url=${encodeURIComponent(homeSpriteUrl(species))}`;
}

/**
 * Slack around a measured figure so the focus frame is not flush with the
 * silhouette. Small on purpose: every centimetre here is frame the ace does
 * not fill, and the focus distance carries the footprint's half-depth.
 */
const BOUNDS_MARGIN = 0.02;

/**
 * World AABB of one trainer's statue subject: the plinth (at its seat, its
 * formation height) and the ace at its feet position, turned `yaw`. `size` is the box the figure
 * measured once loaded and relaxed; the manifest stature/footprint is the
 * fallback until then (PB-091). The plinth half-width is the plan's.
 */
function statueBounds(
  slot: TeamsSlot,
  ace: TeamsRosterEntry,
  size: FigureSize | undefined,
  plinthHalf: number,
  lift: number,
): SubjectBounds {
  const height = size ? Math.max(0.2, size[1]) : ace.entry ? ace.heightM : 0.96;
  const half = size ? Math.max(0.12, Math.max(size[0], size[2]) / 2 + BOUNDS_MARGIN) : Math.max(0.12, ace.footprintM / 2);
  const f = slot.figure;
  const p = slot.pedestal;
  return {
    min: [Math.min(p[0] - plinthHalf, f[0] - half), p[1], Math.min(p[2] - plinthHalf, f[2] - half)],
    max: [Math.max(p[0] + plinthHalf, f[0] + half), Math.max(p[1] + slot.pedestalH + lift, f[1] + height), Math.max(p[2] + plinthHalf, f[2] + half)],
  };
}

/**
 * Suspense stand-in while an ace's GLB streams in, and the last resort when a
 * line has no model at all: the HOME sprite mounted in a framed card on the
 * plinth — bezel, dark glass, sprite — never a naked plane (PB-078). The
 * sprite comes through `/api/proxy-image` because `connect-src` blocks the
 * PokéAPI CDN.
 */
function AceBillboard({ species, heightM }: { species: string; heightM: number }) {
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

  // A framed picture, not a stand-in body: the card stays portrait-sized so a
  // plinth waiting on its GLB never reads as a Pokémon-shaped slab.
  const cardH = Math.min(1.05, Math.max(0.55, heightM * 0.78));
  const cardW = cardH * 0.84;
  const centreY = cardH / 2 + 0.06;

  return (
    <group>
      <mesh position={[0, centreY, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[cardW + 0.08, cardH + 0.08, 0.05]} />
        <meshStandardMaterial color="#4c3f2c" roughness={0.4} metalness={0.58} />
      </mesh>
      <mesh position={[0, centreY, 0.012]}>
        <planeGeometry args={[cardW, cardH]} />
        <meshStandardMaterial color="#161b22" roughness={0.22} metalness={0.1} />
      </mesh>
      {texture ? (
        <mesh position={[0, centreY, 0.02]}>
          <planeGeometry args={[cardW * 0.86, cardW * 0.86]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/** Terrace coursing: blocks along the run — one stretched box would read as a slab (PB-069). */
const TERRACE_COURSES = 6;

/**
 * The rear rank's stone riser: a plinth course, a run of coursed ashlar
 * blocks and an overhanging cap, in the same limestone as the plinths so the
 * step reads as the plaza's masonry. Extent and height come from the
 * formation's ray-height law (`riser`, formation frame: +x back from the
 * front line, +z screen right).
 */
function Terrace({ stone, riser }: { stone: PlinthStone; riser: RiserLayout }) {
  const span = riser.x1 - riser.x0;
  const baseH = Math.min(0.16, riser.height * 0.3);
  const capH = Math.min(0.15, riser.height * 0.3);
  const bodyH = Math.max(0.01, riser.height - baseH - capH);
  const blockZ = (riser.z1 - riser.z0) / TERRACE_COURSES;
  return (
    <group>
      {Array.from({ length: TERRACE_COURSES }, (_, i) => {
        const z = riser.z0 + blockZ * (i + 0.5);
        return (
          <group key={i} position={[0, 0, z]}>
            <mesh position={[riser.x0 + span / 2, baseH / 2, 0]} material={stone.body} receiveShadow>
              <boxGeometry args={[span + 0.14, baseH, blockZ]} />
            </mesh>
            {/* Battered ashlar: recessed off the base, with an open joint each side. */}
            <mesh
              position={[riser.x0 + 0.05 + (span - 0.05) / 2, baseH + bodyH / 2, 0]}
              material={stone.body}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[span - 0.05, bodyH, blockZ - 0.035]} />
            </mesh>
            <mesh
              position={[riser.x0 + span / 2, riser.height - capH / 2, 0]}
              material={stone.cap}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[span + 0.08, capH, blockZ]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** The plaza site: the frozen #teams endpoints + the plan (teams-formation.ts). */
const PLAZA_TEAMS_SITE = makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN);
const TEAMS_INDEX = PLAZA_STATIONS.findIndex((s) => s.id === 'teams');


function Aces({ night }: { night: boolean }) {
  const { participants, trackers, standings } = useEvoligaRouteData();
  const index = useFigureIndex();
  const { heroFigures: requestedHeroFigures } = useQuality();
  // D23 / plan item 7: frozen at reveal. A lower rung would swap a GLB ace
  // for a sprite billboard (a post-reveal fetch + upload) and re-lay the
  // ledger, so the governor never changes the row once the world is live.
  const heroFigures = usePopulationCeiling(requestedHeroFigures, false);
  const stone = usePlinthStone(night);
  const [sizes, setSizes] = useState<Record<string, FigureSize>>({});

  // Figures report the box they really occupy once loaded and relaxed; the
  // Focus proxy and the orbit framing both read it. Same numbers = same state,
  // so a re-mounted clone never loops the row.
  const handleMeasure = useCallback((playerId: string, size: FigureSize) => {
    setSizes((current) => {
      const previous = current[playerId];
      if (
        previous &&
        Math.abs(previous[0] - size[0]) < 1e-3 &&
        Math.abs(previous[1] - size[1]) < 1e-3 &&
        Math.abs(previous[2] - size[2]) < 1e-3
      ) {
        return current;
      }
      return { ...current, [playerId]: size };
    });
  }, []);

  // D16: standings order — the formation, the ledger and the 390 rail agree.
  const roster = useMemo(
    () => teamsRoster(participants, trackers, standings, index, heroFigures),
    [participants, trackers, standings, index, heroFigures],
  );
  const liftOf = useCallback(
    (ace: TeamsRosterEntry) => (ace.entry && ace.heightM < TINY_M ? PEDESTAL_H : 0),
    [],
  );
  const formation = useMemo(
    () => teamsFormation(PLAZA_TEAMS_SITE, formationAces(roster, liftOf)),
    [roster, liftOf],
  );
  const copy = useMemo(() => ledgerCopy(roster), [roster]);
  // i18n D11: subject labels in the viewer's language, aces in the viewer's
  // Pokémon-data language.
  const t = routeT(useLocale());
  const dataLocale = useDataLocale();

  // Kick every ace's GLB at once (PB-100).
  useEffect(() => {
    for (const ace of roster) {
      if (ace.entry) preloadFigure(figureUrl(ace.entry));
    }
  }, [roster]);

  // `facing` has to keep its identity between renders or the subject
  // re-registers every frame and the focus rig never settles (PB-090).
  const facings = useMemo(
    () => formation.slots.map((slot): Vec3Tuple => [Math.sin(slot.yaw), 0, Math.cos(slot.yaw)]),
    [formation],
  );
  // Review r5 (W6): the figures arrive one per idle slice, never all eight
  // in one commit (that single commit was the upward sweep's 550 ms freeze).
  // D23: the row mounts at load, so the stagger runs inside the ceremony, and
  // it holds residency open until the last ace is in (the reveal waits).
  // Plinths mount at once; each figure fills its cap in turn. Kept through
  // the D16 formation rework: slot i is rank i + 1.
  const figuresShown = useStaggeredMount(roster.length, true);
  useResidencyHold('plaza:teams-aces-stagger', figuresShown < roster.length);

  const { frame } = formation;
  const plinthHalf = PLAZA_TEAMS_PLAN.pedestal.half;

  return (
    <>
      {roster.length > 1 ? (
        <group position={[frame.origin[0], frame.origin[1], frame.origin[2]]} rotation={[0, frame.yaw, 0]}>
          <Terrace stone={stone} riser={formation.riser} />
        </group>
      ) : null}
      {formation.slots.map((slot, i) => {
        const ace = roster[i];
        const lift = liftOf(ace);
        const band = ace.band;
        return (
          <FocusSubject
            key={ace.playerId}
            id={`team:${ace.playerId}`}
            kind="ace"
            label={t('subject.aceOf', {
              species: ace.species ? localizeSpecies(ace.species, dataLocale) : '—',
              name: ace.playerName,
            })}
            facing={facings[i]}
            panel={{ param: 'team', value: ace.playerId }}
            bounds={statueBounds(slot, ace, sizes[ace.playerId], plinthHalf, lift)}
          >
            <group position={[slot.pedestal[0], slot.pedestal[1], slot.pedestal[2]]} rotation={[0, slot.yaw, 0]}>
              <PlainPlinth height={slot.pedestalH} band={band} pedestal={lift > 0} night={night} stone={stone} />
            </group>
            {/* The ace at its feet position (its plinth's cap; a colossal's low plinth on the back line). */}
            {i >= figuresShown || !ace.species ? null : (
              <group position={[slot.figure[0], slot.figure[1], slot.figure[2]]} rotation={[0, slot.yaw, 0]}>
                {ace.entry ? (
                  <ResidentSuspense
                    id={`plaza:teams-ace:${ace.playerId}`}
                    fallback={<AceBillboard species={ace.species} heightM={ace.heightM} />}
                  >
                    <Figure
                      entry={ace.entry}
                      clip="idle"
                      role="ace"
                      subjectId={ace.playerId}
                      name={`ace-${ace.playerId}`}
                      onMeasure={(size) => handleMeasure(ace.playerId, size)}
                    />
                  </ResidentSuspense>
                ) : (
                  <AceBillboard species={ace.species} heightM={ace.heightM} />
                )}
              </group>
            )}
          </FocusSubject>
        );
      })}
      {roster.length > 0 ? (
        <RollCallLedger
          layout={formation.ledger}
          copy={copy}
          style={PLAZA_LEDGER_STYLE}
          material={PLAZA_LEDGER_MATERIAL}
          night={night}
          teamsIndex={TEAMS_INDEX}
          label={t('subject.rollCall')}
        />
      ) : null}
    </>
  );
}

/** Where the two soft practicals hang, across and in front of the row. */
const PRACTICAL_Z = 3.5;

/**
 * East statue forecourt — one plinth per participant with their ace at its
 * Pokédex height, in the D16 ZIPPER FORMATION (standings order: odd ranks in
 * front, even ranks on the rear riser at a half-pitch offset, screen order
 * 1 … N — `teams-formation.ts`), over the stone Roll-Call Ledger that names
 * every trainer under their statue. Aces above 1.5 m stand on a low plinth
 * on the riser's back line at full stature (no clamping); aces under 0.5 m
 * get a pedestal insert.
 *
 * Two soft practicals sit between the camera and the row so night stills read
 * the aces' skin and fur instead of eight silhouettes, and pool light on the
 * cobbles in front of the plinths.
 */
export default function StatueRow({ night }: { night: boolean }) {
  const { statues } = FURNITURE;
  const rowLight = night ? '#ffd9a0' : '#fff2dc';
  // D23: the row's GLB population (aces + plinths) is TEAMS-station content
  // but resident from load (C-089's teams-window deferral is reversed). The
  // window [1,3] now only decides dormancy: outside [0,4] the aces' mixers
  // would pause (with the one-station lead the row is awake everywhere on a
  // five-station route). The row's own practicals stay mounted throughout.
  const { dormant } = useStationWindowState(1, 3);

  return (
    <group>
      <group position={[statues.x, 0, statues.z]}>
        {([-1, 1] as const).map((side) => (
          <pointLight
            key={side}
            position={[-2.6, 3.1, side * PRACTICAL_Z]}
            color={rowLight}
            intensity={night ? 16 : 1.4}
            distance={15}
            decay={2}
          />
        ))}
      </group>
      {/* The formation is laid out in WORLD coordinates (teams-formation.ts):
          this group cancels PlazaHall's C-051 re-seat offset around the row. */}
      <group position={[0, 0, -PLAZA_ROW_RESEAT_Z]}>
        <DormancyScope dormant={dormant}>
          <ResidentSuspense id="plaza:teams-row">
            <Aces night={night} />
          </ResidentSuspense>
        </DormancyScope>
      </group>
    </group>
  );
}
