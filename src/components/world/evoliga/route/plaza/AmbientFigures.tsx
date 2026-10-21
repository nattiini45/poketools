'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useNearestStation } from '@/components/world/route/useNearestStation';
import Figure, { type FigureClip } from '@/components/world/route/figures/Figure';
import { preloadFigure, useFigureGLTF } from '@/components/world/route/figures/figure-loader';
import { findFigure, registerActor } from '@/components/world/route/figures/figure-registry';
import { gaitModelFor, matchGait } from '@/lib/route-world/walk-gait';
import { FIDGET_MAX_S, FIDGET_MIN_S } from '@/lib/route-world/clip-phase';
import {
  advanceWalkerPath,
  createWalkerPathState,
  NO_WALKER_FIDGET,
  type WalkerFidget,
  type WalkerPathState,
} from '@/lib/route-world/figure-behavior';
import { ResidentSuspense, usePopulationCeiling } from '@/components/world/route/residency-store';
import {
  AMBIENT_PATHS,
  LOITER_SPOTS,
  castAmbient,
  dailySeed,
  headingYaw,
  pathIndexForWalker,
  sampleTrack,
  seededRandom,
  trackFor,
  walkSpeed,
  type AmbientCandidate,
  type PathTrack,
} from '@/lib/route-world/ambient';
import {
  castKbOf,
  figureHeightM,
  figureUrl,
  useFigureIndex,
  type FigureEntry,
} from '@/lib/route-world/model-manifest';
import { PLAZA_STATION_IDS } from '@/components/world/themes/plaza/theme';
import { useEvoligaRouteData } from '../route-data';

/**
 * `?ambient=<n>` pins the head-count for the capture harness and debug
 * sessions (0 empties the plaza). Ignored for visitors.
 */
function readPinnedCount(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('ambient');
  if (raw === null || !/^\d$/.test(raw)) return null;
  return Number(raw);
}

interface WalkerProps {
  candidate: AmbientCandidate<FigureEntry>;
  track: PathTrack;
  /** Distance along the track the walker starts at. */
  startS: number;
  seed: number;
}

/**
 * One roster Pokémon walking a promenade path: advances along the track,
 * faces its heading, and pauses at every vertex in `idle` before moving on.
 * Transform lives on the group and is written per frame — no React state
 * except the clip flip, which happens once per stop.
 *
 * POKEMON-CORE A1 step 7: the frame loop is an ACTOR step in the figure
 * director (a mover: it holds a slot only while the rung's `figureLife`
 * allows paths; `advanceWalkerPath` in figure-behavior.ts). The path speed is
 * the pre-3A `walkSpeed(height)` (production-neutral); `matchGait` only picks
 * the walk clip's timeScale for that speed (stride-matched within its
 * [0.6, 1.6] clamp). The clip stays under prop control
 * (`directorOwnsClip: false`) until 3C.
 */
function Walker({ candidate, track, startS, seed }: WalkerProps) {
  const group = useRef<THREE.Group>(null);
  const [clip, setClip] = useState<FigureClip>('walk');
  const gltf = useFigureGLTF(figureUrl(candidate.entry));
  const random = useRef(seededRandom(seed));
  const state = useRef<WalkerPathState>(createWalkerPathState(startS));
  const speedMps = walkSpeed(candidate.heightM);
  const walkTimeScale = useMemo(() => {
    const walk = gltf.animations.find((animation) => animation.name === 'walk');
    return matchGait(speedMps, walk?.duration ?? null, gaitModelFor(candidate.entry).walkStrideM).timeScale;
  }, [gltf.animations, speedMps, candidate.entry]);
  const fidget = useMemo<WalkerFidget>(() => {
    const idle2 = gltf.animations.find((animation) => animation.name === 'idle2');
    return idle2 ? { clip: 'idle2', passS: Math.min(Math.max(idle2.duration, FIDGET_MIN_S), FIDGET_MAX_S) } : NO_WALKER_FIDGET;
  }, [gltf.animations]);

  // C-047 station groups swap a walker's track mid-session. Write the
  // transform at COMMIT time so the scene graph is correct before the next
  // frame renders — an FBO present that lands in the commit-to-rAF gap must
  // not paint the walker at its pre-hop floor.
  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    const sample = sampleTrack(track, state.current.s);
    node.position.set(sample.x, 0, sample.z);
    const yaw = headingYaw(sample.dx, sample.dz);
    state.current.yaw = yaw;
    node.rotation.y = yaw;
  }, [track]);

  const clipRef = useRef<FigureClip>(clip);
  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);
  // Latest inputs, read by the actor step: the registration itself is made
  // ONCE per walker (a re-registration after the reveal would be a D23 tripwire).
  const latest = useRef({ track, startS, seed, speedMps, walkTimeScale, fidget });
  useEffect(() => {
    latest.current = { track, startS, seed, speedMps, walkTimeScale, fidget };
  }, [track, startS, seed, speedMps, walkTimeScale, fidget]);

  useEffect(() => {
    const figureId = `ambient-${candidate.key}`;
    const toVertexAt = (s: number) => sampleTrack(latest.current.track, s).toVertex;
    const pose = (st: WalkerPathState, dt: number) => {
      const node = group.current;
      if (!node) return;
      const sample = sampleTrack(latest.current.track, st.s);
      node.position.set(sample.x, 0, sample.z);
      const targetYaw = headingYaw(sample.dx, sample.dz);
      if (!st.initialised) {
        st.yaw = targetYaw;
        st.initialised = true;
      } else {
        // Shortest-arc turn, ~0.3 s to settle.
        let diff = targetYaw - st.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        st.yaw += diff * Math.min(1, dt * 6);
      }
      node.rotation.y = st.yaw;
    };
    return registerActor({
      id: `ambient-walker-${candidate.key}`,
      kind: 'walker',
      object: group,
      mover: true,
      figureId,
      step: (ctx, frame) => {
        const st = state.current;
        const now = latest.current;
        const fidgetNow = ctx.motion === 'full' && ctx.budget.fidgets ? now.fidget : NO_WALKER_FIDGET;
        const next = advanceWalkerPath(st, ctx.dt, frame.moverSlot, now.speedMps, toVertexAt, random.current, fidgetNow) as FigureClip | null;
        if (next !== null && next !== clipRef.current) {
          clipRef.current = next;
          setClip(next);
        }
        pose(st, ctx.dt);
      },
      // The capture pin: the canonical start (walking from `startS`),
      // simulated forward `t` seconds, and the clip cut in at once. The
      // director then seats that clip at its hashed phase on the canonical
      // clock (seatBase, prop-controlled branch) before the pinned frame.
      pin: (t) => {
        const now = latest.current;
        random.current = seededRandom(now.seed);
        const st = createWalkerPathState(now.startS);
        let clipNow: FigureClip = 'walk';
        for (let k = 0, steps = Math.min(Math.round(t / 0.1), 6000); k < steps; k += 1) {
          clipNow = (advanceWalkerPath(st, 0.1, true, now.speedMps, toVertexAt, random.current, now.fidget) as FigureClip | null) ?? clipNow;
        }
        state.current = st;
        pose(st, 0);
        clipRef.current = clipNow;
        setClip(clipNow);
        findFigure(figureId)?.play?.(clipNow, 0, 0, clipNow === 'walk' ? now.walkTimeScale : 1);
      },
    });
  }, [candidate.key]);

  return (
    <group ref={group}>
      <Figure
        entry={candidate.entry}
        clip={clip}
        timeScale={clip === 'walk' ? walkTimeScale : 1}
        name={`ambient-${candidate.key}`}
        role="walker"
        directorOwnsClip={false}
      />
    </group>
  );
}

function Loiterer({
  candidate,
  spot,
}: {
  candidate: AmbientCandidate<FigureEntry>;
  spot: (typeof LOITER_SPOTS)[number];
}) {
  const yaw = headingYaw(spot.facing[0], spot.facing[1]);
  // A static idle this round (role `wild`); the loiter glance's consumer is 3C (plan §2, §7).
  return (
    <group position={[spot.at[0], 0, spot.at[1]]} rotation={[0, yaw, 0]}>
      <Figure entry={candidate.entry} clip="idle" name={`ambient-${candidate.key}`} role="wild" />
    </group>
  );
}

/** One live ambient figure as the debug audit hook reports it. */
interface AmbientAuditRow {
  name: string;
  heightM: number;
  x: number;
  z: number;
  /** Visible vs total meshes in the walker's subtree (C-047 render-drop
   *  diagnosis: a figure can be in the graph yet paint nothing). */
  meshes?: string;
}

type AmbientAuditHost = Window & { __ambientAudit?: () => AmbientAuditRow[] };

function Cast() {
  const { league, entries, trackers } = useEvoligaRouteData();
  const index = useFigureIndex();
  const { ambientFigures } = useQuality();
  const { debug } = useWorldState();
  const pinned = useMemo(() => readPinnedCount(), []);
  // D23 / plan item 7: the crew is frozen at reveal. A smaller cast is a
  // prefix of the larger one, but `pathIndexForWalker` re-allocates every
  // survivor's pocket by rank, so a governor step after live would hop
  // walkers across the plaza (a pop, possibly into frame); a rise would
  // fetch new GLBs. Before live the count follows the governor.
  const ambientCeiling = usePopulationCeiling(ambientFigures, false);
  const count = pinned ?? ambientCeiling;

  const candidates = useMemo<AmbientCandidate<FigureEntry>[]>(() => {
    const names = new Set<string>();
    for (const entry of entries) {
      names.add(entry.base_pokemon);
      if (entry.stage2_pokemon) names.add(entry.stage2_pokemon);
      if (entry.stage3_pokemon) names.add(entry.stage3_pokemon);
    }
    for (const tracker of trackers) {
      names.add(tracker.base_pokemon);
      if (tracker.current_form) names.add(tracker.current_form);
    }
    const out: AmbientCandidate<FigureEntry>[] = [];
    for (const name of names) {
      const entry = index.find(name);
      if (!entry) continue;
      out.push({
        key: entry.file,
        entry,
        heightM: figureHeightM(entry),
        kb: castKbOf(entry),
        canWalk: entry.clips.includes('walk'),
      });
    }
    return out;
  }, [entries, trackers, index]);

  const seed = useMemo(() => dailySeed(league.id), [league.id]);
  const cast = useMemo(() => castAmbient(candidates, count, seed), [candidates, count, seed]);

  // PB-100 at load (D23): kick every cast GLB at once, before any walker's
  // boundary commits, and let the residency store see each one settle.
  useEffect(() => {
    for (const candidate of [...cast.walkers, ...cast.loiterers]) preloadFigure(figureUrl(candidate.entry));
  }, [cast]);
  const tracks = useMemo(() => AMBIENT_PATHS.map(trackFor), []);

  // C-047 STATION GROUPS: the station the visitor occupies, read as the
  // conductor's NEAREST station — NOT activeIndex (floor): the capture
  // harness and real scrolls settle a hair SHORT of the integer
  // (sidecar-verified: roster 0.993, teams 1.994, rules 3.994), and floor()
  // would staff the PREVIOUS station's pockets at the frozen poses. W6: the
  // nearest signal is hysteretic (±NEAREST_STATION_BAND past the midpoint),
  // so the pocket-group hop still lands inside the crossing, where both
  // pocket floors sit at the frame periphery, but noise around the midpoint
  // can no longer hop the crew back and forth. Walkers beyond the boards six
  // staff THIS station's own pockets (ambient.ts STATION_POCKETS); at a
  // boards station they keep the crossing and the south loop — the C-036 r3
  // allocation exactly.
  //
  // Not a frame loop: the conductor's change channel fires inside its own
  // passive scroll listener, so the re-allocation COMMITS before any frame
  // must render — the capture harness's FBO present can otherwise land
  // between the commit and the next rAF and paint the crew at its pre-hop
  // floor.
  const stationPos = useNearestStation();
  const activeStation =
    PLAZA_STATION_IDS[Math.min(Math.max(stationPos, 0), PLAZA_STATION_IDS.length - 1)] ?? null;

  /**
   * Walker → (track, start offset). Allocation goes through
   * `pathIndexForWalker`: the six population pockets are filled in plan
   * order, one walker each — since every pocket is closed and entirely
   * inside its station's wedge, ≥ 3 simultaneous figures at #pulse and
   * #schedule is an invariant, not a lucky phase.
   *
   * SIZE-FOR-VISIBILITY / COLUMN-DISJOINTNESS (C-036 r3): plans are built
   * from the cast sorted height-descending (key as deterministic tiebreak),
   * so the two TALLEST walkers of the day take the east pockets — the
   * nearest, biggest-rendering seats, and the only pockets deep-classed to
   * need a ≥ 1.2 m walker to clear the pill band (worst 42 px at class
   * height; a 2.2 m species keeps ~176 px). Walkers 2/3 take the mid
   * pockets, 4/5 the west pockets (both safe for any ≥ 0.9 m walker). The
   * pockets' screen column bands are disjoint by construction (pulse
   * W[76,233] M[249,487] E[504,857]; schedule mirrored), which is what
   * keeps the trio COUNTABLE to a component scan — the r3 shared-rail
   * design rendered them as one merged cluster at most phases.
   *
   * C-047: the six board pockets are crewed at EVERY station (that floor is
   * invisible from roster/teams/rules, so holding it costs nothing and the
   * boards counts survive every scroll-back). The walkers beyond them — the
   * cast's two shortest — take the ACTIVE station's pockets instead
   * (roster/teams/rules, each sized so a 0.6 m walker clears the pill;
   * column-disjoint pairs by construction with 199-652 px gaps); at a
   * boards station they take the crossing and south loop as in r3, so no
   * boards count can regress by re-allocation.
   *
   * C-047 r2: rules owns THREE pockets but the crew beyond the boards six
   * is two, so while RULES is the active station the boards six's tail
   * walker (walker 5, the smallest, normally on schedule-west) is borrowed
   * onto `rules-center-pocket` (`pathIndexForWalker`'s over-staffing
   * branch, keyed on `cast.walkers.length`). Three walkers in-graph at
   * rules keeps >=2 painting through the r1 render drop (exactly one of N
   * in-graph walkers never paints); the borrow exists only in the
   * rules-active branch, so every pulse/schedule-active allocation - where
   * the no-reg counts are measured - is the r1 mapping exactly.
   */
  const walkerPlans = useMemo(() => {
    const byHeight = [...cast.walkers].sort(
      (a, b) => b.heightM - a.heightM || (a.key < b.key ? -1 : 1),
    );
    const occupancy = new Array<number>(tracks.length).fill(0);
    return byHeight.map((candidate, i) => {
      const pathIndex = pathIndexForWalker(i, tracks.length, activeStation, cast.walkers.length);
      const track = tracks[pathIndex];
      const startS = (track.length * occupancy[pathIndex] * 0.6180339887498949) % track.length;
      occupancy[pathIndex] += 1;
      return { candidate, track, startS, seed: seed + i * 101 };
    });
  }, [cast, tracks, seed, activeStation]);

  // `?routeDebug=1` only: publish the live cast (world x/z + authored height)
  // so measurement scripts can project in-frame counts at the frozen poses
  // from the sidecar camera pose without touching the scene. Read-only at
  // call time, uninstalled with the effect (C-036 evidence contract).
  const root = useRef<THREE.Group>(null);
  const heightsByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of [...cast.walkers, ...cast.loiterers]) map.set(`ambient-${c.key}`, c.heightM);
    return map;
  }, [cast]);
  useEffect(() => {
    if (!debug) return;
    const host = window as AmbientAuditHost;
    host.__ambientAudit = () => {
      const node = root.current;
      if (!node) return [];
      const at = new THREE.Vector3();
      const rows: AmbientAuditRow[] = [];
      for (const child of node.children) {
        child.getWorldPosition(at);
        let name = '';
        let visible = 0;
        let total = 0;
        child.traverse((descendant) => {
          if (!name && descendant.name.startsWith('ambient-')) name = descendant.name;
          if ((descendant as THREE.Mesh).isMesh) {
            total += 1;
            if (descendant.visible) visible += 1;
          }
        });
        const heightM = heightsByKey.get(name);
        if (heightM === undefined) continue;
        rows.push({
          name,
          heightM,
          x: +at.x.toFixed(3),
          z: +at.z.toFixed(3),
          meshes: visible + '/' + total,
        });
      }
      return rows;
    };
    return () => {
      delete host.__ambientAudit;
    };
  }, [debug, heightsByKey]);

  return (
    <group name="ambient-figures" ref={root}>
      {walkerPlans.map(({ candidate, track, startS, seed: walkerSeed }) => (
        <ResidentSuspense key={candidate.key} id={`plaza:ambient:${candidate.key}`}>
          <Walker candidate={candidate} track={track} startS={startS} seed={walkerSeed} />
        </ResidentSuspense>
      ))}
      {cast.loiterers.map((candidate, i) => (
        <ResidentSuspense key={candidate.key} id={`plaza:ambient:${candidate.key}`}>
          <Loiterer candidate={candidate} spot={LOITER_SPOTS[i % LOITER_SPOTS.length]} />
        </ResidentSuspense>
      ))}
    </group>
  );
}

/**
 * Ambient roster Pokémon on the plaza (CONTEXT.md "Ambient figure"): up to 10
 * on the desk rung (walkers concentrate on the population rails the frozen
 * #pulse / #schedule poses read — see `ambient.ts`), 3 on mobile, none once
 * the governor steps down. Cast is seeded daily by season so the same visitor
 * meets the same Pokémon all day.
 */
export default function AmbientFigures() {
  return (
    <ResidentSuspense id="plaza:ambient">
      <Cast />
    </ResidentSuspense>
  );
}
