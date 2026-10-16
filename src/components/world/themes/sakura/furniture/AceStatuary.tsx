'use client';

import { Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { FigureEntry } from '@/lib/route-world/model-manifest';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import type { SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { useSakuraPalette } from '../use-sakura-palette';
import Figure from '@/components/world/route/figures/Figure';

/**
 * One participant's ace statuary (C-093 r3 density pass): a battered stone
 * pedestal in the park's granite, a gym-band course under the cap, and the
 * volumetric ace standing on the cap — the manifest's figure GLB inside the
 * quality ladder's budget, else a framed sprite card standing proud on the
 * cap, never a floating edge-on plane. The plaza's statue tier in sakura
 * materials; zero Meshy involvement.
 *
 * Fidelity wave 2 (seat 2G, D16): the walnut name plaque is GONE — the
 * trainer's name, ace and real height live on the Roll-Call Ledger at the
 * forecourt front edge, in the column under this statue (a plaque the rank
 * in front could cover is anti-pattern §5.9). Seats come from the zipper
 * formation (`teams-formation.ts`); a colossal ace (> 1.5 m) stands on a low
 * plinth on the riser's back line, at its real stature.
 */

/** Pedestal course heights, ground upward — the battered four-square idiom. */
const FOOT_H = 0.1;
const BASE_H = 0.1;
const SHAFT_H = 0.55;
const CAVETTO_H = 0.08;
const BAND_H = 0.06;
const CAP_H = 0.1;

/** Cap top in local metres — the ace's standing surface (a full pedestal). */
export const PEDESTAL_CAP_H = FOOT_H + BASE_H + SHAFT_H + CAVETTO_H + BAND_H + CAP_H;

/** Half-widths, bottom to top: the batter is what keeps it off box-shaped. */
const FOOT_HALF = 0.52;
const BASE_HALF = 0.46;
const SHAFT_HALF_BOTTOM = 0.42;
const SHAFT_HALF_TOP = 0.38;
const CAP_HALF = 0.46;

/** Aces taller than this stand set back on the rear riser (teams-formation TEAMS_COLOSSAL_M). */
export const STATUE_COLOSSAL_M = 1.5;

/** The square-plan battered course: a 4-sided cylinder on its flat. */
function Course({
  halfBottom,
  halfTop,
  height,
  y,
  color,
  receiveShadow = false,
}: {
  halfBottom: number;
  halfTop: number;
  height: number;
  y: number;
  color: string;
  receiveShadow?: boolean;
}) {
  return (
    <mesh
      position={[0, y + height / 2, 0]}
      rotation={[0, Math.PI / 4, 0]}
      castShadow
      receiveShadow={receiveShadow}
    >
      <cylinderGeometry args={[halfTop * Math.SQRT2, halfBottom * Math.SQRT2, height, 4, 1]} />
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.02} />
    </mesh>
  );
}

export interface AceSlot {
  playerId: string;
  playerName: string;
  gymType: string | null;
  /** Null when the trainer has no tracked ace: the pedestal stands empty. */
  species: string | null;
  entry: FigureEntry | null;
  /** Gym-band colour (teams-roster `bandOf`). */
  band: string;
}

/**
 * One participant's statuary group, in world coordinates from the formation:
 * the pedestal base at `pedestal`, the figure's feet at `figure` (the cap,
 * a colossal's low plinth on the back line), both turned by `yaw` so their local
 * +Z faces the #teams eye. The whole group is ONE focus subject,
 * `team:<id>` — the ledger column under it resolves to the same subject.
 */
export default function AceStatuary({
  slot,
  pedestal,
  figure,
  yaw,
  cardFor,
  pedestalH,
}: {
  slot: AceSlot;
  pedestal: Vec3Tuple;
  figure: Vec3Tuple;
  yaw: number;
  cardFor: (slot: AceSlot & { species: string }) => ReactNode;
  /**
   * The pedestal's height (the formation's `pedestalH`): the full cap, or a
   * colossal's low plinth. Absent, the rise from the pedestal base to the
   * figure's feet (the formation stands every figure on its own cap).
   */
  pedestalH?: number;
}) {
  const palette = useSakuraPalette();
  const t = useT(worldThemesMessages);
  const dataLocale = useDataLocale();
  const band = slot.band;
  const stone = palette.lanternStone;
  const capStone = palette.pathColor;

  // Wave-2 r2 (TEAMS judge): a colossal stands on a LOW plinth (footing,
  // gym band, cap) under its own feet — never behind an empty full pedestal.
  const height = Math.max(0.12, pedestalH ?? figure[1] - pedestal[1]);
  const full = height >= 0.6;
  const shaftH = full ? Math.max(0.05, height - (FOOT_H + BASE_H + CAVETTO_H + BAND_H + CAP_H)) : 0;
  const footH = full ? FOOT_H : Math.max(0.04, height - BAND_H - CAP_H);
  const shaftY = FOOT_H + BASE_H;
  const bandY = full ? shaftY + shaftH + CAVETTO_H : footH;

  // Memoized: a fresh literal every render would re-register the subject and
  // never settle the focus rig (PB-090).
  const facing = useMemo<Vec3Tuple>(() => [Math.sin(yaw), 0, Math.cos(yaw)], [yaw]);
  const panel = useMemo<SubjectPanel>(() => ({ param: 'team', value: slot.playerId }), [slot.playerId]);
  // The GLB ace resolves behind Suspense after the card fallback mounted, so
  // the auto-measured proxy would keep the card's box; the measure key re-fits
  // it once the real figure reports its size (the FocusSubject contract).
  const [figureKey, setFigureKey] = useState(0);
  const handleMeasure = useCallback(() => setFigureKey((key) => key + 1), []);

  const species = slot.species;
  const ace = species === null ? null : slot.entry ? (
    <Suspense fallback={cardFor({ ...slot, species })}>
      <Figure entry={slot.entry} clip="idle" role="ace" subjectId={slot.playerId} name={`sakura-ace-${slot.playerId}`} onMeasure={handleMeasure} />
    </Suspense>
  ) : (
    cardFor({ ...slot, species })
  );

  return (
    <FocusSubject
      id={`team:${slot.playerId}`}
      kind="ace"
      label={t('subjects.ace', {
        species: species === null ? slot.playerName : localizeSpecies(species, dataLocale),
        name: slot.playerName,
      })}
      facing={facing}
      panel={panel}
      measureKey={figureKey}
    >
      <group position={[pedestal[0], pedestal[1], pedestal[2]]} rotation={[0, yaw, 0]}>
        {/* Pedestal courses. */}
        <Course halfBottom={FOOT_HALF} halfTop={FOOT_HALF - 0.03} height={footH} y={0} color={stone} receiveShadow />
        {full ? (
          <>
            <Course halfBottom={BASE_HALF} halfTop={BASE_HALF - 0.03} height={BASE_H} y={FOOT_H} color={stone} receiveShadow />
            <Course halfBottom={SHAFT_HALF_BOTTOM} halfTop={SHAFT_HALF_TOP} height={shaftH} y={shaftY} color={stone} />
            <Course halfBottom={SHAFT_HALF_TOP} halfTop={CAP_HALF - 0.05} height={CAVETTO_H} y={shaftY + shaftH} color={capStone} />
          </>
        ) : null}
        {/* Gym-band course — the same band the ledger chip carries. */}
        <mesh position={[0, bandY + BAND_H / 2, 0]} castShadow>
          <boxGeometry args={[(CAP_HALF - 0.05) * 2, BAND_H, (CAP_HALF - 0.05) * 2]} />
          <meshStandardMaterial color={band} emissive={band} emissiveIntensity={0.18} roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Cap: the ace stands here and its shadow falls here. */}
        <Course halfBottom={CAP_HALF} halfTop={CAP_HALF - 0.012} height={CAP_H} y={bandY + BAND_H} color={capStone} receiveShadow />
      </group>
      {/* The volumetric ace at its real stature (never clamped). */}
      {ace ? (
        <group position={[figure[0], figure[1], figure[2]]} rotation={[0, yaw, 0]}>
          {ace}
        </group>
      ) : null}
    </FocusSubject>
  );
}
