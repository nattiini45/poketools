'use client';

import { useEffect, useMemo, useState } from 'react';
import { aceExclusions, castSeed, scaledWidthM } from '@/lib/route-world/casting';
import { figureHeightM, figureUrl, indexFor, useWorldManifest, type FigureEntry } from '@/lib/route-world/model-manifest';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import { ResidentSuspense, useResidencyHold } from '@/components/world/route/residency-store';
import { pickAceTracker } from '@/components/world/route/teams/teams-roster';
import type { EvolutionTracker } from '@/types/evolution';
import { pendingFigureLoads, preloadFigure, subscribeFigureLoads } from './figure-loader';
import SkyLaneFlyer from './SkyLaneFlyer';
import WaterResident from './WaterResident';
import {
  CORE_PROBE_BODY_ID,
  CORE_PROBE_FLOATERS,
  CORE_PROBE_LAKE,
  CORE_PROBE_LANE,
  CORE_PROBE_PROGRAM_SHARE,
  CORE_PROBE_STATION,
  CORE_PROBE_SURFACER,
  CORE_PROBE_WADER,
  CORE_PROBE_WORLD,
  coreProbeCastFor,
  coreProbeFlyerRoot,
  coreProbeEnvelopeWarnings,
  coreProbeResidentRoot,
  createCoreActorDebugRow,
  parseCoreCastFile,
  parseCoreCastSeed,
  resolveCoreProbeCast,
  waitBehindWorldLoads,
  type BehindWorldLoadsDeps,
  type CoreActorDebugRow,
  type CoreProbeCast,
  type CoreProbeEmptyReason,
  type CoreProbeRole,
} from './core-actor-probe.data';

/**
 * The core actor probe (POKEMON-CORE-PLAN §4 SEAT D step 6, L10): a
 * routeDebug-only rig (`?routeDebug=1&coreActors=1`, the one
 * `RouteWorldCanvas.tsx` mount line) that puts 2 floaters, 1 wader, 1
 * surfacer and 1 probe lane flyer in sakura's lake so the CAPTURE stage can
 * measure the shared actors (K6–K10). Mounted at load (D23) under
 * `ResidentSuspense`: the manifest, then each actor's GLB (kicked in one
 * effect, the ThemeFigures pattern), all before the reveal. In any other
 * world it renders nothing.
 *
 * The cast (INTEGRATE; D step 6, L3–L5): one world-level `castSlots` batch
 * over `CORE_PROBE_SLOTS`, seeded by `castSeed(world, league)` (or the
 * routeDebug `?castSeed=`), excluding the live roster aces by dexId
 * (`aceExclusions` over the `pickAceTracker` picks). It is computed ONCE, in
 * the first render (this subtree mounts at load, before reveal), and latched
 * in state for the session: never recast (D23). The routeDebug
 * `?coreCastFile=` pin (a manifest FILE PATH per role, never a species, D18)
 * overrides its role's slots. An empty, excluded or no-type-data pick leaves
 * the slot EMPTY: nothing mounts there and the readout discloses the reason.
 * There is never a literal fallback.
 *
 * R49 K9 (reveal): the probe's GLBs queue BEHIND the world's own figure
 * loads, never ahead of them. Its actors (whose Figures fetch on render)
 * and its preload kick wait until a world figure preload is in flight
 * (`pendingFigureLoads() > 0`), or `CORE_PROBE_QUEUE_FALLBACK_MS` at most,
 * under a residency hold, so the reveal still waits for them (D23). Before,
 * the probe mounted first and its five requests went out ~0.4 s ahead of
 * the world's, delaying every world figure (the R49 dev probe's loader
 * timelines).
 *
 * No dormancy scope: the lake reads from the pulse and schedule stations and
 * their ±1 windows cover the whole route, so the probe is always awake
 * (disclosed).
 *
 * Evidence: `window.__routeWorldCoreActors()` (routeDebug) returns the cast
 * (per slot: file, source, empty reason, rank) and every actor's live row:
 * mode, visibility wish, position, beat requests, surfacings, passes, plays,
 * accepted wakes, waterline crossings and the visibility flip log with its
 * frustum flag (K8's per-actor companion to the warm-stats appearance log).
 */

interface CoreActorCastRow {
  slotId: string;
  role: CoreProbeRole;
  file: string | null;
  source: 'cast' | 'pin';
  reason: CoreProbeEmptyReason | null;
  rank: number;
  relaxed: boolean;
}

interface CoreActorHost {
  __routeWorldCoreActors?: () => {
    world: string;
    /** Role → file (the first floater's for `floater`); null = empty. */
    cast: Record<CoreProbeRole, string | null>;
    castSeed: number;
    castSlots: CoreActorCastRow[];
    actors: CoreActorDebugRow[];
  };
}

/** The slice of the page-loaded route data the cast reads. */
interface ProbeRouteData {
  league?: { id?: string | null } | null;
  participants?: readonly { id: string }[];
  trackers?: readonly EvolutionTracker[];
}

export default function CoreActorProbe() {
  const { theme } = useWorldState();
  if (!theme || theme.id !== CORE_PROBE_WORLD) return null;
  return (
    <ResidentSuspense id={`${CORE_PROBE_WORLD}:core-probe`}>
      <ProbeActors />
    </ResidentSuspense>
  );
}

/** The real figure loader and window clock behind `waitBehindWorldLoads` (a module constant). */
const BEHIND_WORLD_LOADS: BehindWorldLoadsDeps = {
  pending: pendingFigureLoads,
  subscribe: subscribeFigureLoads,
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
};

/**
 * True once a world figure preload is in flight (or the fallback elapsed):
 * the probe's loads then queue behind it. Latched; holds residency until then.
 */
function useBehindWorldLoads(): boolean {
  const [queued, setQueued] = useState(() => pendingFigureLoads() > 0);
  useResidencyHold(`${CORE_PROBE_WORLD}:core-probe:queue`, !queued);
  useEffect(() => {
    if (queued) return;
    return waitBehindWorldLoads(BEHIND_WORLD_LOADS, () => setQueued(true));
  }, [queued]);
  return queued;
}

function ProbeActors() {
  const manifest = useWorldManifest();
  const queued = useBehindWorldLoads();
  const routeData = useRouteData<ProbeRouteData>();
  // Computed once, in the first render (at load, before reveal), and latched for the session (D23).
  const [cast] = useState<CoreProbeCast>(() => {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const participants = routeData.participants ?? [];
    const trackers = routeData.trackers ?? [];
    const aces = participants
      .map((player) => pickAceTracker(trackers.filter((t) => t.player_id === player.id)))
      .filter((ace): ace is EvolutionTracker => ace !== null)
      .map((ace) => ({ currentForm: ace.current_form ?? null, baseSpecies: ace.base_pokemon ?? null }));
    return resolveCoreProbeCast({
      manifest,
      seed: parseCoreCastSeed(search) ?? castSeed(CORE_PROBE_WORLD, routeData.league?.id ?? ''),
      exclude: aceExclusions(aces, indexFor(manifest)),
      pin: parseCoreCastFile(search),
    });
  });
  const entries = useMemo(
    () => ({
      floaters: CORE_PROBE_FLOATERS.map((f) => coreProbeCastFor(cast, f.slotId).entry),
      wader: coreProbeCastFor(cast, CORE_PROBE_WADER.slotId).entry,
      surfacer: coreProbeCastFor(cast, CORE_PROBE_SURFACER.slotId).entry,
      flyer: coreProbeCastFor(cast, CORE_PROBE_LANE.slotId).entry,
    }),
    [cast],
  );

  const rows = useMemo(
    () => ({
      floaters: CORE_PROBE_FLOATERS.map((f) => createCoreActorDebugRow(coreProbeResidentRoot(f.slotId), 'floater')),
      wader: createCoreActorDebugRow(coreProbeResidentRoot(CORE_PROBE_WADER.slotId), 'wader'),
      surfacer: createCoreActorDebugRow(coreProbeResidentRoot(CORE_PROBE_SURFACER.slotId), 'surfacer'),
      flyer: createCoreActorDebugRow(coreProbeFlyerRoot(CORE_PROBE_LANE.id), 'flyer'),
    }),
    [],
  );

  // One effect kicks every GLB before the actors' own boundaries suspend (ThemeFigures' pattern).
  useEffect(() => {
    if (!queued) return;
    for (const entry of cast.loadEntries) preloadFigure(figureUrl(entry));
  }, [cast, queued]);

  useEffect(() => {
    const host = window as CoreActorHost;
    const all = [...rows.floaters, rows.wader, rows.surfacer, rows.flyer];
    const castRows: CoreActorCastRow[] = cast.slots.map((row) => ({
      slotId: row.slotId,
      role: row.role,
      file: row.entry?.file ?? null,
      source: row.source,
      reason: row.reason,
      rank: row.rank,
      relaxed: row.relaxed,
    }));
    const byRole: Record<CoreProbeRole, string | null> = {
      floater: entries.floaters[0]?.file ?? null,
      wader: entries.wader?.file ?? null,
      surfacer: entries.surfacer?.file ?? null,
      flyer: entries.flyer?.file ?? null,
    };
    host.__routeWorldCoreActors = () => ({
      world: CORE_PROBE_WORLD,
      cast: { ...byRole },
      castSeed: cast.seed,
      castSlots: castRows.map((row) => ({ ...row })),
      actors: all.map((row) => ({ ...row, flips: row.flips.map((flip) => ({ ...flip })) })),
    });
    const empty = castRows.filter((row) => row.file === null);
    if (empty.length > 0) {
      console.info(
        `[core-actor-probe] empty slots, nothing mounted: ${empty.map((row) => `${row.slotId}=${row.reason}`).join(', ')}`,
      );
    }
    const maxOf = (list: readonly (FigureEntry | null)[], measure: (e: FigureEntry) => number): number | null => {
      const values = list.filter((e): e is FigureEntry => e !== null).map(measure);
      return values.length > 0 ? Math.max(...values) : null;
    };
    // R31: a pin outside the envelope (height or width) is recorded; the keep-out proof does not cover it.
    const outside = coreProbeEnvelopeWarnings(
      {
        floater: maxOf(entries.floaters, figureHeightM),
        wader: maxOf([entries.wader], figureHeightM),
        surfacer: maxOf([entries.surfacer], figureHeightM),
        flyer: maxOf([entries.flyer], figureHeightM),
      },
      {
        floater: maxOf(entries.floaters, scaledWidthM),
        wader: maxOf([entries.wader], scaledWidthM),
        surfacer: maxOf([entries.surfacer], scaledWidthM),
        flyer: maxOf([entries.flyer], scaledWidthM),
      },
    );
    for (const warning of outside) console.warn(`[core-actor-probe] ${warning}`);
    return () => {
      delete host.__routeWorldCoreActors;
    };
  }, [rows, cast, entries]);

  if (!queued) return null;
  return (
    <group name={`${CORE_PROBE_WORLD}-prop-core-probe`}>
      {CORE_PROBE_FLOATERS.map((floater, i) => {
        const entry = entries.floaters[i];
        return entry ? (
          <ResidentSuspense key={floater.slotId} id={`${CORE_PROBE_WORLD}:core-probe:${floater.slotId}`}>
            <WaterResident
              mode="floater"
              slotId={floater.slotId}
              rootName={coreProbeResidentRoot(floater.slotId)}
              entry={entry}
              bodyId={CORE_PROBE_BODY_ID}
              surfaceY={CORE_PROBE_LAKE.surfaceY}
              station={CORE_PROBE_STATION}
              disc={floater.disc}
              yaw={floater.yaw}
              headroomBelowY={floater.headroomBelowY}
              driftMps={floater.driftMps}
              debug={rows.floaters[i]}
              programShare={CORE_PROBE_PROGRAM_SHARE}
            />
          </ResidentSuspense>
        ) : null;
      })}
      {entries.wader ? (
        <ResidentSuspense id={`${CORE_PROBE_WORLD}:core-probe:${CORE_PROBE_WADER.slotId}`}>
          <WaterResident
            mode="wader"
            slotId={CORE_PROBE_WADER.slotId}
            rootName={coreProbeResidentRoot(CORE_PROBE_WADER.slotId)}
            entry={entries.wader}
            bodyId={CORE_PROBE_BODY_ID}
            surfaceY={CORE_PROBE_LAKE.surfaceY}
            station={CORE_PROBE_STATION}
            anchor={CORE_PROBE_WADER.anchor}
            edge={CORE_PROBE_WADER.edge}
            speedMps={CORE_PROBE_WADER.speedMps}
            debug={rows.wader}
            programShare={CORE_PROBE_PROGRAM_SHARE}
          />
        </ResidentSuspense>
      ) : null}
      {entries.surfacer ? (
        <ResidentSuspense id={`${CORE_PROBE_WORLD}:core-probe:${CORE_PROBE_SURFACER.slotId}`}>
          <WaterResident
            mode="surfacer"
            slotId={CORE_PROBE_SURFACER.slotId}
            rootName={coreProbeResidentRoot(CORE_PROBE_SURFACER.slotId)}
            entry={entries.surfacer}
            bodyId={CORE_PROBE_BODY_ID}
            surfaceY={CORE_PROBE_LAKE.surfaceY}
            station={CORE_PROBE_STATION}
            spot={CORE_PROBE_SURFACER.spot}
            portrait={CORE_PROBE_SURFACER.portrait}
            debug={rows.surfacer}
            programShare={CORE_PROBE_PROGRAM_SHARE}
          />
        </ResidentSuspense>
      ) : null}
      {entries.flyer ? (
        <ResidentSuspense id={`${CORE_PROBE_WORLD}:core-probe:${CORE_PROBE_LANE.slotId}`}>
          <SkyLaneFlyer
            slotId={CORE_PROBE_LANE.slotId}
            rootName={coreProbeFlyerRoot(CORE_PROBE_LANE.id)}
            entry={entries.flyer}
            lane={CORE_PROBE_LANE}
            station={CORE_PROBE_STATION}
            debug={rows.flyer}
            programShare={CORE_PROBE_PROGRAM_SHARE}
          />
        </ResidentSuspense>
      ) : null}
    </group>
  );
}
