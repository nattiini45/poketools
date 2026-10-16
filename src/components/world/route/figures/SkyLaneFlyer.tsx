'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { AmbientBeatBus, BeatSphere, BeatTicket } from '@/lib/route-world/ambient-beats';
import { hash01, hashText, mix32 } from '@/lib/route-world/clip-phase';
import { slotSeed } from '@/lib/route-world/figure-behavior';
import type { ActorFrame, DirectorStepContext } from '@/lib/route-world/figure-director';
import type { FigureEntry } from '@/lib/route-world/model-manifest';
import {
  buildSkyLane,
  createLaneStepOut,
  initLaneFlyerState,
  pinLaneFlyer,
  stepLaneFlyer,
  type LaneFlyerState,
  type LaneStepInput,
  type SkyLaneSpec,
} from '@/lib/route-world/sky-lanes';
import { registerLatchActor, useDormancy } from '@/components/world/route/residency-store';
import Figure from './Figure';
import { findFigure, registerActor, type FigureRegistration } from './figure-registry';
import { noteCoreActorFlip, type CoreActorDebugRow } from './core-actor-probe.data';
import { ACTOR_PROGRAM_SHARE_DEFAULT, useActorProgramShare, type ActorProgramShare } from './actor-programs';

/**
 * A lane flyer (POKEMON-CORE-PLAN §4 SEAT D step 5; C4, C5, C7, C13, C15;
 * L2, L6, L7): a figure carried in its idle pose along a sky lane
 * (`sky-lanes.ts`), banked into its turns, one idle2 accent at 30–40 % of the
 * pass. Never `walk` (the glide is disclosed).
 *
 * D23 / C4: mounted at load under the probe's `ResidentSuspense`, GLB kicked
 * with the world's other figures. Between passes it is HIDDEN through the
 * push latch only (L7: 0 draws, no skeleton, and — R18 c — no mixer); every
 * warm (load, D32 veil) finds it shown at the lane entry. A pass starts only
 * when the lane entry is outside the current frustum and the bus grants the
 * `flyover` hero beat; at the end it stays shown until it is outside the
 * frustum, then hides and releases the beat. The lane's ends are proven off
 * frame at every audited pose (the probe keep-out test); the frustum checks
 * here are the second guard. While the director hands its "everywhere"
 * frustum (the camera moving, a focus open), nothing counts as outside: a
 * pass never starts and a finished flyer never hides mid-move.
 *
 * Below `figureLife` full it switches to its perch only while both its
 * current point and the perch are outside the frustum (`perch: null` stays
 * hidden); reduced motion under the forced route tier: no passes, no perch.
 * A lane with `portrait: false` flies no pass at portrait widths (the
 * caption band rule, plan risk 6).
 *
 * C13 / L6: `castShadow=false`. C15: the root is `<world>-prop-flyer-<lane>`.
 * One loop: an `ActorStep` in the figure director; its figure registers with
 * `directorOwnsClip: false` (R18 b). Per frame: pose, visibility and clip are
 * imperative; no React state; a steady frame allocates nothing.
 *
 * `?beatForce=flyover@<s>` requests the first pass at that forced second
 * (the bus's `consumeForce`, a forced request); later passes follow the
 * seeded 45–90 s schedule on the actor's awake clock (D40).
 *
 * R49 K9: while hidden it costs no draw and no skinning (the renderer skips
 * an invisible subtree); its world matrices stay updated by the scene, so
 * the latch's show-flip root-box test (K8, the governor's appearance) reads
 * where it is now (fix D-R1 dropped a `matrixWorldAutoUpdate = visible`
 * toggle that froze them while hidden and saved nothing in three 0.185).
 * Its materials go through `adoptSharedPrograms` (`programShare`) in the
 * commit that mounts it, so it compiles no world-new program (D26).
 */

export interface SkyLaneFlyerProps {
  slotId: string;
  /** Prop-family root name (C15): `<world>-prop-flyer-<lane>`. */
  rootName: string;
  entry: FigureEntry;
  lane: SkyLaneSpec;
  station: number | null;
  /** Dev-only readout row. */
  debug?: CoreActorDebugRow;
  /** Program-sharing rules for the figure's materials (default: `ACTOR_PROGRAM_SHARE_DEFAULT`). */
  programShare?: ActorProgramShare;
}

const CROSSFADE_S = 0.35;
const PORTRAIT_MAX_WIDTH = 767;

export default function SkyLaneFlyer(props: SkyLaneFlyerProps) {
  const { rootName, entry, lane: laneSpec, station } = props;
  const root = useRef<THREE.Group>(null);
  const isDormant = useDormancy();
  const width = useThree((state) => state.size.width);
  const lane = useMemo(() => buildSkyLane(laneSpec), [laneSpec]);
  const figureName = `${rootName}:figure`;

  useActorProgramShare(root, props.programShare ?? ACTOR_PROGRAM_SHARE_DEFAULT, props.debug);

  const live = useRef({ props, isDormant, width, lane });
  useEffect(() => {
    live.current = { props, isDormant, width, lane };
  });

  useEffect(() => {
    const group = root.current;
    if (group) group.rotation.order = 'YXZ';
    let figure: FigureRegistration | null = null;
    let seed = -1;
    let state: LaneFlyerState | null = null;
    /** The lane's lowest sample (the beat sphere), found once. */
    let low = 0;
    const out = createLaneStepOut();
    const input: LaneStepInput = {
      laneT: 0,
      active: false,
      forced: false,
      granted: false,
      entryOut: false,
      currentOut: false,
      perchWanted: false,
      perchOut: false,
    };
    let ticket: BeatTicket | null = null;
    /** The director's bus the ticket came from (the unmount hands an open ticket back to it). */
    let bus: AmbientBeatBus | null = null;
    const sphere: BeatSphere = { x: 0, y: 0, z: 0, r: 1 };
    const scratch = { clip: null as string | null, wants: true, accentUntil: -1, lastMode: 'idle' as string };

    const figureNow = (): FigureRegistration | null => {
      if (figure === null || figure.object.current === null) figure = findFigure(figureName);
      return figure;
    };

    const playClip = (fig: FigureRegistration, clip: string) => {
      if (clip === scratch.clip || !(fig.clips ?? []).includes(clip)) return;
      const dur = fig.durations?.[clip] ?? 1;
      fig.play?.(clip, hash01(seed >>> 0, hashText(clip)) * dur, scratch.clip === null ? 0 : CROSSFADE_S, 1);
      scratch.clip = clip;
    };

    const step = (ctx: DirectorStepContext, frame: ActorFrame) => {
      const g = root.current;
      const fig = figureNow();
      if (g === null || fig === null) return;
      const { lane: built, width: viewWidth, props: p } = live.current;
      const spec = built.spec;
      const nextSeed = mix32(ctx.seed >>> 0, slotSeed(p.slotId)) >>> 0;
      if (state === null || seed !== nextSeed) {
        seed = nextSeed;
        state = initLaneFlyerState(seed, built);
        low = 0;
        for (let i = 1; i < built.count; i += 1) if (built.py[i] < built.py[low]) low = i;
      }
      const r = spec.bodyRadiusM;
      const frustum = ctx.frustum;
      const portraitBlocked = spec.portrait === false && viewWidth <= PORTRAIT_MAX_WIDTH;
      input.laneT = frame.t;
      input.active = ctx.live && !frame.dormant && ctx.motion === 'full' && ctx.life === 'full' && !portraitBlocked;
      input.forced = ctx.bus.consumeForce('flyover', ctx.forceClockS);
      bus = ctx.bus;
      // A pending ticket the bus dropped (a pin, a new generation) is asked for again.
      if (state.mode === 'pending' && (ticket === null || ticket.state === 'released')) {
        ticket = ctx.bus.request('flyover', rootName, sphere, state.forcedRequest ? { forced: true } : undefined);
      }
      input.granted = ticket !== null && ticket.state === 'granted';
      input.entryOut = !frustum.intersectsSphere(built.px[0], built.py[0], built.pz[0], r);
      input.currentOut = !frustum.intersectsSphere(out.frame.x, out.frame.y, out.frame.z, r);
      input.perchWanted = ctx.live && ctx.motion === 'full' && ctx.life !== 'full';
      const perch = spec.perch;
      input.perchOut = perch === null || !frustum.intersectsSphere(perch.x, perch.y, perch.z, r);
      const wasMode = state.mode;
      stepLaneFlyer(state, built, ctx.dt, input, out);
      // The beat sphere (the bus's NDC precondition): the lane's lowest point, where a pass reads on screen.
      sphere.x = built.px[low];
      sphere.y = built.py[low];
      sphere.z = built.pz[low];
      sphere.r = r;
      const row = p.debug;
      if (out.request) {
        ticket = ctx.bus.request('flyover', rootName, sphere, out.forced ? { forced: true } : undefined);
        if (row) row.requests += 1;
      }
      if (out.release && ticket !== null) {
        ctx.bus.release(ticket);
        ticket = null;
      }
      if (wasMode === 'exit' && state.mode === 'idle' && row) row.passes += 1;
      if (out.clip === 'idle2') {
        playClip(fig, 'idle2');
        scratch.accentUntil = frame.t + (fig.durations?.idle2 ?? 0);
      } else if (out.clip === 'idle' || (scratch.clip === 'idle2' && frame.t >= scratch.accentUntil) || scratch.clip === null) {
        playClip(fig, 'idle');
      }
      const f = out.frame;
      g.position.set(f.x, f.y, f.z);
      // YXZ: heading, then nose up (−x lifts +Z), then the bank (+bank = into a +yaw turn: the +X side down).
      g.rotation.set(-f.pitch, f.yaw, -f.bank);
      if (out.wantsVisible !== scratch.wants) {
        scratch.wants = out.wantsVisible;
        if (row) noteCoreActorFlip(row, out.wantsVisible, frustum.intersectsSphere(f.x, f.y, f.z, r), ctx.awakeS);
      }
      if (row) {
        row.mode = state.mode;
        row.wants = out.wantsVisible;
        row.x = f.x;
        row.y = f.y;
        row.z = f.z;
      }
    };

    const pin = () => {
      if (state !== null) pinLaneFlyer(state, live.current.lane);
      ticket = null;
      scratch.clip = null;
      scratch.accentUntil = -1;
      const fig = figureNow();
      if (fig) playClip(fig, 'idle');
    };

    const releaseActor = registerActor({
      id: rootName,
      kind: 'flyer',
      object: root,
      station,
      isDormant: () => live.current.isDormant(),
      mover: false,
      step,
      pin,
      figureId: figureName,
    });
    const releaseLatch = registerLatchActor({ id: rootName, root: () => root.current, wants: () => scratch.wants });
    return () => {
      // The bus never expires a ticket: one left open by an unmount mid-generation would hold every
      // later hero beat `busy` (granted) or be granted to no one (pending) until the next reset.
      if (ticket !== null && bus !== null) bus.release(ticket);
      ticket = null;
      releaseActor();
      releaseLatch();
    };
    // The actor registers once per mount (a re-registration after the reveal is the D23 tripwire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The warm pose: the lane entry (40 m up, off frame everywhere), shown by the latch while any warm runs.
  const start: [number, number, number] = [lane.px[0], lane.py[0], lane.pz[0]];
  return (
    <group ref={root} name={rootName} position={start}>
      <Figure entry={entry} name={figureName} role="flyer" station={station} directorOwnsClip={false} castShadow={false} breathe={false} />
    </group>
  );
}
