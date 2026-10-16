'use client';

import { useMemo } from 'react';
import { useDataLocale, useT } from '@/i18n/client';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import FocusSubject from '@/components/world/route/focus/FocusSubject';
import RollCallLedger from '@/components/world/route/teams/RollCallLedger';
import { CLOUDS_LEDGER_MATERIAL, CLOUDS_LEDGER_STYLE } from '@/components/world/route/teams/ledger-styles';
import { bandOf, pickAceTracker } from '@/components/world/route/teams/teams-roster';
import type { SubjectBounds, SubjectPanel, Vec3Tuple } from '@/lib/route-world/focus';
import { figureHeightM, useFigureIndex } from '@/lib/route-world/model-manifest';
import {
  alternatingAces,
  makeTeamsSite,
  teamsFormation,
  teamsInStandingsOrder,
  type LedgerLayout,
  type TeamsAce,
  type TeamsFormation,
} from '@/lib/route-world/teams-formation';
import { useCloudsPalette } from '../use-clouds-palette';
import { CLOUDS_STATIONS } from '../theme';
import type { CloudsRouteData } from '../types';
import { FLOAT_ROW, ISLES, TEAMS_BOOKENDS } from './layout';
import { LanternPost } from './Props';

/**
 * The #teams hero: the ACES FLOAT ROW — one moored float per trainer on the
 * aces isle, each carrying a LIVE rider (mounted by SkyFigures on the seat
 * this module computes), over the brass Roll-Call Ledger.
 *
 * Fidelity wave 2 (seat 2G, D16): the floats stand in the ZIPPER FORMATION in
 * standings order (`teams-formation.ts` — odd ranks on the isle, even ranks
 * on the rear riser at a half-pitch offset; screen order 1 … N) and the
 * painted float plaques are GONE — they hid the front riders (KNOWN_OCCLUDED
 * `clouds:rider:*`) and could be covered by the riders behind them. Every
 * name now lives on ONE rail at the isle's west kerb, each column under its
 * float. With no plaque to clear, the r2 perch bollards retire too: every
 * rider rides its gondola roof. Content derives from the contract's
 * participants + trackers + standings only.
 */

/** The clouds site (the frozen #teams endpoints + the layout's plan). */
export const CLOUDS_TEAMS_SITE = makeTeamsSite('clouds', CLOUDS_STATIONS, FLOAT_ROW.site);

/**
 * The formation's view of `n` floats: the riser law is solved for the rank
 * caps' nominal riders (the tallest front tiny over the smallest rear rider)
 * so it holds for any rider SkyFigures later resolves inside those caps.
 */
export function floatFormationAces(n: number): TeamsAce[] {
  return alternatingAces(Math.min(n, FLOAT_ROW.maxFloats), FLOAT_ROW.nominal.front, FLOAT_ROW.nominal.rear, 'float');
}

const formationCache = new Map<number, TeamsFormation>();

/** The float formation for `n` trainers (memoized — pure, per count). */
export function floatFormation(n: number): TeamsFormation {
  const count = Math.min(n, FLOAT_ROW.maxFloats);
  let formation = formationCache.get(count);
  if (!formation) {
    formation = teamsFormation(CLOUDS_TEAMS_SITE, floatFormationAces(count));
    formationCache.set(count, formation);
  }
  return formation;
}

/**
 * The float formation's ledger with every column keyed by the trainer it
 * names (ROLLOUT-PLAN §3.2 E2, the clouds P0 blank ledger). `floatFormation`
 * is cached per COUNT, so its slots — and the ledger columns built from them
 * — carry the seat ids `float-0 … float-N`, while the ledger copy (and the
 * rail's click / hover mapping, `team:<id>`) is keyed by player id.
 * `paintLedger` paints only the columns whose id is in the copy, so every
 * column was dropped: a face with its frame and end caps only, at every
 * theme and width. Slot `index` is the standings position, so column i names
 * `playerIds[i]`. Returns a new layout; the shared cache is never mutated.
 */
export function floatLedgerLayout(formation: TeamsFormation, playerIds: readonly string[]): LedgerLayout {
  return {
    ...formation.ledger,
    columns: formation.ledger.columns.map((column) => ({ ...column, id: playerIds[column.index] ?? column.id })),
  };
}

/** One float's seat: world position, eye-turned yaw, row (0 front, 1 rear) and the rider stand height. */
export interface FloatSeat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  rank: 0 | 1;
  riderY: number;
}

/** The seats of `n` floats in standings order (shared with SkyFigures, which mounts the riders there). */
export function floatSeats(n: number): FloatSeat[] {
  return floatFormation(n).slots.map((slot) => ({
    x: slot.pedestal[0],
    y: slot.pedestal[1],
    z: slot.pedestal[2],
    yaw: slot.yaw,
    rank: slot.row === 'front' ? 0 : 1,
    riderY: slot.figure[1],
  }));
}

/** The floats' copy per trainer, in STANDINGS order (shared with SkyFigures' rider plan). */
export function floatAces(
  participants: CloudsRouteData['participants'],
  trackers: CloudsRouteData['trackers'],
  standings: readonly { player_id: string }[] = [],
): { playerId: string; name: string; ace: string; band: string }[] {
  return teamsInStandingsOrder(participants, standings)
    .slice(0, FLOAT_ROW.maxFloats)
    .map((player) => {
      const best = pickAceTracker(trackers.filter((t) => t.player_id === player.id));
      return {
        playerId: player.id,
        name: player.name,
        ace: best ? (best.current_form ?? best.base_pokemon) : '—',
        band: player.gym_type ?? 'Open',
      };
    });
}


function AcesFloat({
  seat,
  copy,
}: {
  seat: FloatSeat;
  copy: { playerId: string; name: string; ace: string };
}) {
  const palette = useCloudsPalette();
  const t = useT(worldThemesMessages);
  const dataLocale = useDataLocale();
  // `yaw` turns the float's local +Z to the authored #teams eye. Memoized:
  // a fresh literal every render would re-register the subject (PB-090).
  const facing = useMemo<Vec3Tuple>(() => [Math.sin(seat.yaw), 0, Math.cos(seat.yaw)], [seat.yaw]);
  const panel = useMemo<SubjectPanel>(() => ({ param: 'team', value: copy.playerId }), [copy.playerId]);
  // Float + its rider (SkyFigures mounts the rider on this seat, up to the rank's stature cap).
  const bounds = useMemo<SubjectBounds>(
    () => ({
      min: [seat.x - 0.45, seat.y, seat.z - 0.45],
      max: [seat.x + 0.45, seat.riderY + FLOAT_ROW.riderMaxByRank[seat.rank], seat.z + 0.45],
    }),
    [seat],
  );

  return (
    <FocusSubject
      id={`team:${copy.playerId}`}
      kind="ace"
      label={t('subjects.ace', {
        species: copy.ace === '—' ? copy.ace : localizeSpecies(copy.ace, dataLocale),
        name: copy.name,
      })}
      facing={facing}
      panel={panel}
      bounds={bounds}
    >
      <group position={[seat.x, seat.y, seat.z]} rotation={[0, seat.yaw, 0]}>
        {/* Deck ring the float is moored to. */}
        <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.5, 0.05, 6, 16]} />
          <meshStandardMaterial color={palette.stoneColor} roughness={0.85} metalness={0.05} />
        </mesh>
        {/* Gondola — the rider stands on its roof (FLOAT_ROW.riderLift). */}
        <mesh position={[0, 0.32, 0]} castShadow>
          <boxGeometry args={[0.72, 0.36, 0.56]} />
          <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
        </mesh>
      </group>
    </FocusSubject>
  );
}

export default function AcesFloats() {
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;
  const { participants, trackers, standings } = useRouteData<CloudsRouteData>();
  const index = useFigureIndex();
  const t = useT(worldThemesMessages);

  const aces = useMemo(() => floatAces(participants, trackers, standings), [participants, trackers, standings]);
  const formation = useMemo(() => floatFormation(aces.length), [aces.length]);
  const ledgerLayout = useMemo(() => floatLedgerLayout(formation, aces.map((a) => a.playerId)), [formation, aces]);
  const seats = useMemo(() => floatSeats(aces.length), [aces.length]);

  const copy = useMemo(
    () =>
      aces.map((a, i) => {
        const resolved = a.ace === '—' ? null : index.resolve(a.ace, null);
        const band = bandOf(participants.find((p) => p.id === a.playerId)?.gym_type ?? null);
        return {
          id: a.playerId,
          rank: i + 1,
          name: a.name,
          species: a.ace === '—' ? null : a.ace,
          heightM: resolved ? figureHeightM(resolved) : null,
          band: band.bg,
          bandInk: band.text,
        };
      }),
    [aces, index, participants],
  );

  const riser = formation.riser;
  const isle = ISLES.teams;
  // The formation's ground is the float deck seat; the riser is sunk to the isle top.
  const sink = FLOAT_ROW.site.groundY - isle.top;

  return (
    <group>
      {/* The rear riser: a stone tier under the rear rank, from the isle top
          up to the height the ray-height law solved. */}
      {aces.length > 1 ? (
        <group
          position={[formation.frame.origin[0], formation.frame.origin[1], formation.frame.origin[2]]}
          rotation={[0, formation.frame.yaw, 0]}
        >
          <mesh position={[(riser.x0 + riser.x1) / 2, (riser.height - sink) / 2, (riser.z0 + riser.z1) / 2]} castShadow receiveShadow>
            <boxGeometry args={[riser.x1 - riser.x0, riser.height + sink, riser.z1 - riser.z0]} />
            <meshStandardMaterial color={palette.stoneColor} roughness={0.92} metalness={0.02} />
          </mesh>
        </group>
      ) : null}

      {seats.map((seat, i) => {
        const ace = aces[i];
        return ace ? <AcesFloat key={ace.playerId} seat={seat} copy={ace} /> : null;
      })}

      {aces.length > 0 ? (
        <RollCallLedger
          layout={ledgerLayout}
          copy={copy}
          style={CLOUDS_LEDGER_STYLE}
          material={CLOUDS_LEDGER_MATERIAL}
          night={night}
          teamsIndex={CLOUDS_STATIONS.findIndex((s) => s.id === 'teams')}
          label={t('subjects.rollCall')}
        />
      ) : null}

      {/* Framing bookend lantern posts flanking the rear riser (TEAMS_BOOKENDS —
          outside every ace column and the ledger, keep-out judged). */}
      {TEAMS_BOOKENDS.posts.map((post) => (
        <LanternPost
          key={`${post.x},${post.z}`}
          x={post.x}
          z={post.z}
          y={isle.top}
          s={TEAMS_BOOKENDS.scale}
          night={night}
          practical={post.practical}
        />
      ))}
    </group>
  );
}
