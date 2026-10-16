'use client';

import { useMemo } from 'react';
import ThemeFigures, { type FigureSlot } from '@/components/world/route/figures/ThemeFigures';
import { type ThemeFigurePlan, type ThemeFigureRosterEntry } from '@/lib/route-world/figure-contract';
import { figureHeightM, useFigureIndex } from '@/lib/route-world/model-manifest';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import type { CloudsRouteData } from '../types';
import { floatAces, floatSeats } from './AcesFloats';
import { FLOAT_ROW, RIDER_BACKFILL_FRONT, RIDER_BACKFILL_REAR, SKY_WILDS } from './layout';
import { DormancyScope, ResidentSuspense } from '@/components/world/route/residency-store';
import { useCloudsStationWindowState } from './useCloudsStationWindow';

/**
 * The isles' Pokémon habitation (C-104 criterion 1), mounted through the
 * C-100 figure contract: `<ThemeFigures plan slots/>` — the engine's shared
 * pipeline (KTX2-armed loader, fitted/animated `Figure`, manifest fallbacks,
 * colossal/tiny stances from the recorded bounds). NO abstract statue
 * substitutes at hero stations:
 *
 *  - Float riders at #teams: every float of the aces row carries a LIVE
 *    rider — the trainer's ace when it resolves at the rank's stature
 *    (front rank rides TINY species only, the rear rank standards up to
 *    1.8 m — FLOAT_ROW.riderMaxByRank), or the next fitted pool backfill
 *    (RIDER_BACKFILL_FRONT/REAR, idle-clipped flight/electric lines)
 *    otherwise. Wave 2 (2G, D16): the floats stand in the zipper formation
 *    in standings order (`floatSeats` — front/rear by rank parity) and the
 *    plaques are gone (the names live on the Roll-Call Ledger), so every
 *    rider rides its gondola roof (`FLOAT_ROW.riderLift`); the r2 perch law
 *    retired with the plaques. The abstract egg balloons are gone.
 *  - Sky wilds: pool-driven, thematically fitted flight/electric lines per
 *    station window — every species idle-clipped in the manifest so animated
 *    idles read in-frame (the motion-proof law; the pulse window's
 *    Zapdos-Galar/Pikachu/Magnemite sit on the summit isle's west rim beside
 *    the sail, in-frame and clear at both poses, pre-capture scan-proven).
 *  - The grounded leviathan: Lugia (7 m, colossal stance — the mounter
 *    grounds it) on the rules isle's east rim, GROUNDED LATERALLY: its sight
 *    ray crosses the plaque plane right of the ring at both poses
 *    (colossals-grounded-laterally law; scan-proven).
 *
 * Every group roots under the `clouds-prop-` family prefix: several idle
 * exports carry STATIC child meshes parented under animated skeletons, and
 * the static batcher merged those children at idle-pose extremes — the next
 * animation frame invalidated the batch, and the 41↔43-batch oscillation
 * reset the render-path quiet window forever (every capture residency wait
 * timed out). The prefix is the mechanism for exactly this: named
 * GLB families are never merged, so frustum culling stays per figure.
 *
 * Budget lever (criterion 5; since D23 every group is resident from load): per-station counts, once gated by the
 * in-package residency latch (`useCloudsStationWindow`) — pulse 3, roster
 * +2, teams +2 (+ up to 8 riders), schedule +2, rules +2 (+1 colossal):
 * at most 20 wilds/colossals + 8 riders at full residency.
 */

/** Per-float rider declaration: the ace, or a rank-fitted backfill. */
function useRiderGroups(): {
  aceGroup: { plan: ThemeFigurePlan; slots: readonly FigureSlot[] };
  backfillGroup: { plan: ThemeFigurePlan; slots: readonly FigureSlot[] };
} | null {
  const { participants, trackers, standings } = useRouteData<CloudsRouteData>();
  const index = useFigureIndex();

  return useMemo(() => {
    // Wave 2 (2G): standings order + the zipper seats (AcesFloats owns both).
    const aces = floatAces(participants, trackers, standings);
    const seats = floatSeats(aces.length);
    const acePlan: ThemeFigureRosterEntry[] = [];
    const aceSlots: FigureSlot[] = [];
    const backfillSpecies: string[] = [];
    const backfillSlots: FigureSlot[] = [];

    aces.forEach((copy, i) => {
      const seat = seats[i];
      if (!seat) return;
      const maxM = FLOAT_ROW.riderMaxByRank[seat.rank];
      const resolved = index.resolve(copy.ace, null);
      if (resolved !== null && figureHeightM(resolved) <= maxM) {
        acePlan.push({ id: `${copy.name}-${i}`, label: copy.name, species: copy.ace, baseSpecies: null });
        aceSlots.push({ position: [seat.x, seat.riderY, seat.z], yaw: seat.yaw, subjectId: copy.playerId });
      } else {
        const pool = seat.rank === 0 ? RIDER_BACKFILL_FRONT : RIDER_BACKFILL_REAR;
        const species = pool[backfillSpecies.length % pool.length];
        backfillSpecies.push(species);
        backfillSlots.push({ position: [seat.x, seat.riderY, seat.z], yaw: seat.yaw });
      }
    });

    return {
      aceGroup: { plan: { roster: acePlan }, slots: aceSlots },
      backfillGroup: { plan: { pool: backfillSpecies }, slots: backfillSlots },
    };
  }, [participants, trackers, standings, index]);
}

/** One windowed wild group: resident from load (D23). */
function WildGroup({ station }: { station: number }) {
  // D23: mounted at load, so GLBs, programs and uploads land in the
  // ceremony. After reveal `visible={false}` (colour AND shadow passes skip
  // the subtree) until the entry latch flips `shown` at exactly the moment
  // the old mount did; off-window the figures are dormant. The
  // `clouds-prop-` root name keeps the static batcher off these figures,
  // hidden or shown.
  const { mounted, shown, dormant } = useCloudsStationWindowState(station, 4);
  const plan = useMemo<ThemeFigurePlan>(
    () => ({ pool: SKY_WILDS.filter((w) => w.station === station).map((w) => w.species) }),
    [station],
  );
  const slots = useMemo<readonly FigureSlot[]>(
    () =>
      SKY_WILDS.filter((w) => w.station === station).map((w) => ({
        position: [w.x, w.y, w.z],
        yaw: w.yaw,
      })),
    [station],
  );
  if (!mounted) return null;
  return (
    <group name={`clouds-prop-wilds-${station}`} visible={shown}>
      <DormancyScope dormant={dormant}>
        <ResidentSuspense id={`clouds:wilds-${station}`}>
          <ThemeFigures plan={plan} slots={slots} />
        </ResidentSuspense>
      </DormancyScope>
    </group>
  );
}

/**
 * The habitation layer. The pulse wilds mount immediately — they ARE the
 * first judged station's population (and the motion-proof figures); the
 * riders latch with the teams window, the later windows as the visitor
 * scrolls.
 */
export default function SkyFigures() {
  // Riders: resident from load, shown on the teams entry latch after reveal.
  const riders = useCloudsStationWindowState(2, 4);
  const riderGroups = useRiderGroups();

  return (
    <group>
      <WildGroup station={0} />
      <WildGroup station={1} />
      {riders.mounted && riderGroups ? (
        <group name="clouds-prop-riders" visible={riders.shown}>
          <DormancyScope dormant={riders.dormant}>
            <ResidentSuspense id="clouds:riders-aces">
              <ThemeFigures plan={riderGroups.aceGroup.plan} slots={riderGroups.aceGroup.slots} />
            </ResidentSuspense>
            <ResidentSuspense id="clouds:riders-backfill">
              <ThemeFigures plan={riderGroups.backfillGroup.plan} slots={riderGroups.backfillGroup.slots} />
            </ResidentSuspense>
          </DormancyScope>
        </group>
      ) : null}
      <WildGroup station={3} />
      <WildGroup station={4} />
    </group>
  );
}
