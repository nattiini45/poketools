import { describe, expect, it } from 'vitest';
import {
  BALL_TIMING,
  ballLifeEndAt,
  ballRevealing,
  ballVisible,
  ballWakeAt,
  ceremonyMs,
  ceremonyPlan,
  fullCeremonyMs,
  FULL_LENGTH_REMAINING_MS,
  HANDOFF_COMPOSITE,
  INITIAL_BALL,
  INITIAL_COMPOSITE_GATE,
  LOADER_MILESTONES,
  placeLoaderChip,
  loaderStageLine,
  revealArmLastAt,
  revealGate,
  routeHandoffAllowed,
  timelineOffsetMs,
  stepBall,
  stepHandoffComposite,
  wobblePlan,
  wobblePlays,
  type BallInput,
  type BallPhase,
  type BallState,
  type CompositeGate,
  type CompositeSample,
} from '../ball-loader-state';
import { SCENE_READY_TIMEOUT_MS } from '@/components/world/route/world-readiness';

/**
 * W7 loading ceremony — the pure contract. The component only feeds these
 * inputs and schedules `ballWakeAt`, so everything the vetoes care about
 * (milestone-driven shakes, no delayed Lite, bounded dwell, generation
 * safety, reduced motion, phase order, deadline margin, two-phase handoff)
 * is pinned here.
 */

const BASE: BallInput = {
  active: true,
  armed: false,
  armedAtMs: null,
  phase: 'loading',
  generation: 7,
  begunAtMs: 1000,
  milestones: 0,
  nowMs: 1000,
  reducedMotion: false,
};

/** Wall-clock deadline of the BASE attempt (begun at 1000). */
const DEADLINE = 1000 + SCENE_READY_TIMEOUT_MS;
/** The ball is gone by this point (deadline − margin). */
const LIFE_END = DEADLINE - BALL_TIMING.deadlineMarginMs;
/** A still-loading ball starts leaving here so it is gone by LIFE_END. */
const LOADING_EXIT = LIFE_END - Math.max(BALL_TIMING.abortFadeMs, BALL_TIMING.reducedFadeMs);

/** Armed at t = 2000 (the arm IS the handoff since r3). */
const ARMED: Partial<BallInput> = { armed: true, armedAtMs: 2000, phase: 'presented' };

function input(patch: Partial<BallInput>): BallInput {
  return { ...BASE, ...patch };
}

/** A ball already loading generation 7 at t = 1000. */
function loadingBall(patch: Partial<BallInput> = {}): BallState {
  const ball = stepBall(INITIAL_BALL, input(patch));
  expect(ball.phase).toBe('loading');
  return ball;
}

function openingBall(): BallState {
  const ball = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000 }));
  expect(ball.phase).toBe('opening');
  return ball;
}

/** Released on the machine clock at t = 2000 + handoffMs. */
function releasingBall(): BallState {
  const ball = stepBall(openingBall(), input({ ...ARMED, nowMs: 2000 + BALL_TIMING.handoffMs }));
  expect(ball.phase).toBe('releasing');
  return ball;
}

describe('ball-loader-state — activation', () => {
  it('enters loading for an active route attempt and captures its generation', () => {
    const ball = loadingBall();
    expect(ball.generation).toBe(7);
    expect(ball.since).toBe(1000);
    expect(ball.begunAt).toBe(1000);
    expect(ballVisible(ball)).toBe(true);
  });

  it('stays hidden on a DOM-only world (never an infinite spinner)', () => {
    // DOM-only worlds report route tier with an idle phase and no theme.
    expect(stepBall(INITIAL_BALL, input({ active: false, phase: 'idle' }))).toBe(INITIAL_BALL);
    expect(stepBall(INITIAL_BALL, input({ active: false }))).toBe(INITIAL_BALL);
  });

  it('stays hidden while no attempt is in flight (idle phase)', () => {
    expect(stepBall(INITIAL_BALL, input({ phase: 'idle' }))).toBe(INITIAL_BALL);
  });

  it('does not start a ceremony when mounted after the gate already armed', () => {
    expect(stepBall(INITIAL_BALL, input({ ...ARMED }))).toBe(INITIAL_BALL);
  });

  it('shows the ball while presented but the reveal gate has not armed yet', () => {
    expect(stepBall(INITIAL_BALL, input({ phase: 'presented' })).phase).toBe('loading');
  });

  it('returns the SAME object when nothing changed (setter bail-out, no loops)', () => {
    const ball = loadingBall();
    expect(stepBall(ball, input({ nowMs: 1500 }))).toBe(ball);
  });
});

describe('ball-loader-state — milestone-driven shakes', () => {
  it('wobbles exactly once per observed milestone rise', () => {
    let ball = loadingBall();
    ball = stepBall(ball, input({ milestones: 1, nowMs: 1100 }));
    expect(ball.shakes).toBe(1);
    ball = stepBall(ball, input({ milestones: 2, nowMs: 1400 }));
    expect(ball.shakes).toBe(2);
  });

  it('a rise during a wobble is counted in the SAME step (its rock queues — wobblePlan)', () => {
    // 10 ms after the previous wobble started (it plays 620 ms): the next
    // rise is owed at once; the component plays it after the running rock.
    let ball = stepBall(loadingBall(), input({ milestones: 1, nowMs: 1100 }));
    ball = stepBall(ball, input({ milestones: 2, nowMs: 1110 }));
    expect(ball.shakes).toBe(2);
  });

  it('is never driven by time: no milestone, no wobble, however long the wait', () => {
    let ball = loadingBall();
    for (let t = 1000; t < LOADING_EXIT; t += 250) {
      ball = stepBall(ball, input({ nowMs: t }));
    }
    expect(ball.phase).toBe('loading');
    expect(ball.shakes).toBe(0);
  });

  it('1:1 (wave 2): a burst of several milestones in one step owes one wobble EACH', () => {
    const ball = stepBall(loadingBall(), input({ milestones: 4, nowMs: 1050 }));
    expect(ball.shakes).toBe(4);
    expect(ball.milestones).toBe(4);
  });

  it('baselines at entry: milestones reached before the ball was up never replay', () => {
    const ball = loadingBall({ milestones: 3 });
    expect(ball.shakes).toBe(0);
    expect(stepBall(ball, input({ milestones: 3, nowMs: 1200 }))).toBe(ball);
  });

  it('a burst never delays the reveal: armed wins over a pending wobble', () => {
    const ball = stepBall(
      loadingBall(),
      input({ ...ARMED, milestones: 4, armedAtMs: 1050, nowMs: 1050 }),
    );
    expect(ball.phase).toBe('opening');
    expect(ball.since).toBe(1050);
  });

  it('reduced motion records milestones without moving the ball', () => {
    const ball = stepBall(
      loadingBall({ reducedMotion: true }),
      input({ milestones: 2, reducedMotion: true, nowMs: 1100 }),
    );
    expect(ball.shakes).toBe(0);
    expect(ball.milestones).toBe(2);
  });
});

describe('ball-loader-state — reveal', () => {
  it('opens on the armed gate of the CURRENT generation', () => {
    expect(openingBall().generation).toBe(7);
  });

  it('cannot open before the current generation presents', () => {
    const ball = loadingBall();
    // An armed flag without `presented` (stale or racing) is not a reveal.
    expect(stepBall(ball, input({ ...ARMED, phase: 'loading', nowMs: 1500 })).phase).toBe('loading');
  });

  it('a generation bump that is already armed re-presents the NEW attempt (never the stale one)', () => {
    const next = stepBall(
      loadingBall(),
      input({ ...ARMED, generation: 8, begunAtMs: 1500, armedAtMs: 1600, nowMs: 1600 }),
    );
    expect(next.phase).toBe('opening');
    expect(next.generation).toBe(8);
    expect(next.begunAt).toBe(1500);
  });

  it('the ceremony budget is hinge lead-in + release and stays ≤ 1.3 s (+ the ≤ 640 px flight ≤ 1.4 s)', () => {
    expect(BALL_TIMING.openMs).toBe(BALL_TIMING.handoffMs + BALL_TIMING.releaseMs);
    expect(BALL_TIMING.openMs).toBeLessThanOrEqual(1300);
    expect(BALL_TIMING.hingeStartMs).toBeLessThan(BALL_TIMING.handoffMs);
    expect(fullCeremonyMs(false)).toBe(BALL_TIMING.openMs);
    expect(fullCeremonyMs(true)).toBe(BALL_TIMING.flightMs + BALL_TIMING.openMs);
    expect(fullCeremonyMs(true)).toBeLessThanOrEqual(1400);
  });

  it('opening is capped to the authored lead-in on the machine clock (no latch to wait on)', () => {
    const opening = openingBall();
    expect(ballRevealing(opening)).toBe(true);
    expect(ballWakeAt(opening)).toBe(2000 + BALL_TIMING.handoffMs);
    expect(stepBall(opening, input({ ...ARMED, nowMs: 2000 + BALL_TIMING.handoffMs - 1 }))).toBe(opening);
    const releasing = stepBall(opening, input({ ...ARMED, nowMs: 2000 + BALL_TIMING.handoffMs }));
    expect(releasing.phase).toBe('releasing');
    expect(ballWakeAt(releasing)).toBe(2000 + BALL_TIMING.openMs);
    const done = stepBall(releasing, input({ ...ARMED, nowMs: 2000 + BALL_TIMING.openMs }));
    expect(done.phase).toBe('done');
    expect(ballVisible(done)).toBe(false);
    expect(ballWakeAt(done)).toBeNull();
  });

  it('never exits a phase in the step that entered it (each phase is committed)', () => {
    // The step that sees the arm very late (the whole ceremony slot passed)
    // still only enters opening.
    const late = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000 + 5000 }));
    expect(late.phase).toBe('opening');
    // Wave-2 r3: `opening` mirrors the CSS hinge from its own entry (≈ the
    // reveal commit) — a late step can no longer leave it back to back.
    expect(stepBall(late, input({ ...ARMED, nowMs: 7001 }))).toBe(late);
    const releasing = stepBall(late, input({ ...ARMED, nowMs: 7000 + BALL_TIMING.handoffMs }));
    expect(releasing.phase).toBe('releasing');
  });

  it('a late release is compressed to minReleaseMs, never skipped', () => {
    const opening = openingBall();
    // The machine only got to run 3 s after the arm (a main-thread stall).
    const releasing = stepBall(opening, input({ ...ARMED, nowMs: 5000 }));
    expect(releasing.phase).toBe('releasing');
    expect(ballWakeAt(releasing)).toBe(5000 + BALL_TIMING.minReleaseMs);
    expect(stepBall(releasing, input({ ...ARMED, nowMs: 5000 + BALL_TIMING.minReleaseMs - 1 }))).toBe(
      releasing,
    );
    expect(stepBall(releasing, input({ ...ARMED, nowMs: 5000 + BALL_TIMING.minReleaseMs })).phase).toBe(
      'done',
    );
  });

  it('reduced motion: opening → releasing (200 ms crossfade) → done, no beam timeline', () => {
    let ball = loadingBall({ reducedMotion: true });
    ball = stepBall(ball, input({ ...ARMED, reducedMotion: true, nowMs: 2000 }));
    expect(ball.phase).toBe('opening');
    expect(ceremonyMs(ball)).toBe(BALL_TIMING.reducedFadeMs);
    expect(BALL_TIMING.reducedFadeMs).toBe(200);
    expect(ballWakeAt(ball)).toBe(2000);
    ball = stepBall(ball, input({ ...ARMED, reducedMotion: true, nowMs: 2001 }));
    expect(ball.phase).toBe('releasing');
    ball = stepBall(ball, input({ ...ARMED, reducedMotion: true, nowMs: 2201 }));
    expect(ball.phase).toBe('done');
  });

  it('latches the motion preference at the reveal so a toggle cannot re-time the ceremony', () => {
    const ball = openingBall();
    const toggled = stepBall(ball, input({ ...ARMED, reducedMotion: true, nowMs: 2100 }));
    expect(toggled.phase).toBe('opening');
    expect(ceremonyMs(toggled)).toBe(BALL_TIMING.openMs);
  });

  it('a reveal armed with < shortMinMs of life left plays the quick crossfade, gone by the life end', () => {
    const armedAt = LIFE_END - BALL_TIMING.shortMinMs + 1;
    const ball = stepBall(loadingBall(), input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt }));
    expect(ball.quick).toBe(true);
    expect(ball.mode).toBe('quick');
    expect(ceremonyMs(ball)).toBe(BALL_TIMING.reducedFadeMs);
    const releasing = stepBall(ball, input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt }));
    expect(releasing.phase).toBe('releasing');
    expect(ballWakeAt(releasing)).toBe(armedAt + BALL_TIMING.reducedFadeMs);
    expect(ballWakeAt(releasing) ?? Infinity).toBeLessThanOrEqual(LIFE_END);
  });

  it('anchors the reveal timeline at the ARM, not at the (later) ball step', () => {
    // The arm committed at 2000 (CSS timeline start); the ball step landed at 2150.
    const ball = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2150 }));
    expect(ball.openedAt).toBe(2000);
    // Until the CSS timeline's start is read, the hinge counts from the
    // phase entry (wave-2 r3: `opening` is never skipped)...
    expect(ballWakeAt(ball)).toBe(2150 + BALL_TIMING.handoffMs);
    // ...and once read (the animations started with the arm commit), the
    // machine mirrors it exactly.
    const timed = stepBall(ball, input({ ...ARMED, nowMs: 2160, timelineAtMs: 2000 }));
    expect(timed.phase).toBe('opening');
    expect(ballWakeAt(timed)).toBe(2000 + BALL_TIMING.handoffMs);
  });
});

describe('ball-loader-state — failure paths abort at once (never delay Lite)', () => {
  const failures: Array<[string, Partial<BallInput>]> = [
    ['readiness timeout (tier flips Lite)', { active: false, phase: 'idle' }],
    ['context loss (phase failed)', { phase: 'failed' }],
    ['scene error (phase failed)', { phase: 'failed' }],
    ['late present (phase failed, tier Lite)', { phase: 'failed', active: false }],
    ['ladder exhaustion (phase failed, tier Lite)', { phase: 'failed', active: false }],
  ];

  for (const [label, patch] of failures) {
    it(`aborts from loading on ${label}`, () => {
      const ball = stepBall(loadingBall(), input({ ...patch, nowMs: 1300 }));
      expect(ball.phase).toBe('aborted');
      expect(ball.since).toBe(1300);
    });

    it(`aborts from opening on ${label}`, () => {
      const ball = stepBall(openingBall(), input({ ...patch, nowMs: 2100 }));
      expect(ball.phase).toBe('aborted');
    });

    it(`aborts from releasing on ${label}`, () => {
      const ball = stepBall(releasingBall(), input({ ...patch, nowMs: 2600 }));
      expect(ball.phase).toBe('aborted');
    });
  }

  it('navigation to a DOM-only world mid-load aborts (no theme ⇒ inactive)', () => {
    const next = input({ active: false, phase: 'idle', generation: 8 });
    expect(stepBall(loadingBall(), { ...next, nowMs: 1300 }).phase).toBe('aborted');
    expect(stepBall(openingBall(), { ...next, nowMs: 2100 }).phase).toBe('aborted');
  });

  it('a transient idle (reset under a still-active ball) is NOT a failure — held, bounded by the life end', () => {
    const loading = loadingBall();
    const gap = input({ phase: 'idle', generation: 8, nowMs: 1300 });
    expect(stepBall(loading, gap)).toBe(loading);
    const opening = openingBall();
    expect(stepBall(opening, { ...gap, nowMs: 2100 })).toBe(opening);
    // …but it can never outlive the attempt it presents.
    expect(stepBall(loading, { ...gap, nowMs: LOADING_EXIT }).phase).toBe('aborted');
  });

  it('first load: idle → loading → (generation bump before arming) → presented + armed never aborts', () => {
    let ball = INITIAL_BALL;
    const seen: string[] = [];
    const armed = { ...ARMED, generation: 9, begunAtMs: 1020, milestones: 3, armedAtMs: 6000 };
    const steps: Array<Partial<BallInput>> = [
      { phase: 'idle', generation: 6, nowMs: 900 },
      { phase: 'loading', generation: 7, begunAtMs: 1000, nowMs: 1000 },
      // StrictMode double-mount / remount: reset → idle, then a new begin.
      { phase: 'idle', generation: 8, begunAtMs: 1000, nowMs: 1010 },
      { phase: 'loading', generation: 9, begunAtMs: 1020, nowMs: 1020 },
      { phase: 'loading', generation: 9, begunAtMs: 1020, milestones: 2, nowMs: 3000 },
      { phase: 'presented', generation: 9, begunAtMs: 1020, milestones: 3, nowMs: 5000 },
      { ...armed, nowMs: 6000 },
      { ...armed, nowMs: 6000 + BALL_TIMING.handoffMs },
      { ...armed, nowMs: 6000 + BALL_TIMING.openMs },
    ];
    for (const patch of steps) {
      ball = stepBall(ball, input(patch));
      seen.push(ball.phase);
    }
    expect(seen).not.toContain('aborted');
    expect(seen.slice(-3)).toEqual(['opening', 'releasing', 'done']);
    expect(ball.generation).toBe(9);
  });

  it('loading → transient idle → presented recovers without an abort', () => {
    let ball = loadingBall();
    ball = stepBall(ball, input({ phase: 'idle', generation: 8, nowMs: 1500 }));
    expect(ball.phase).toBe('loading');
    ball = stepBall(ball, input({ phase: 'presented', generation: 9, begunAtMs: 1600, nowMs: 4000 }));
    expect(ball.phase).toBe('loading');
    expect(ball.generation).toBe(9);
    ball = stepBall(
      ball,
      input({ ...ARMED, generation: 9, begunAtMs: 1600, armedAtMs: 4500, nowMs: 4500 }),
    );
    expect(ball.phase).toBe('opening');
  });

  it('a superseded reveal never finishes the stale ceremony: a new armed generation re-presents', () => {
    const ball = stepBall(
      openingBall(),
      input({ ...ARMED, generation: 8, begunAtMs: 2050, armedAtMs: 2100, nowMs: 2100 }),
    );
    expect(ball.phase).toBe('opening');
    expect(ball.generation).toBe(8);
    expect(ball.openedAt).toBe(2100);
  });

  it('a theme switch mid-reveal re-presents the new attempt from loading (Lite untouched)', () => {
    const ball = stepBall(openingBall(), input({ generation: 8, phase: 'loading', nowMs: 2100 }));
    expect(ball.phase).toBe('loading');
    expect(ball.generation).toBe(8);
    expect(ball.since).toBe(2100);
  });

  it('every abort is observable in the SAME step as the failure (zero added latency)', () => {
    const cases: Array<Partial<BallInput>> = [
      { active: false, phase: 'idle' },
      { phase: 'failed' },
      { phase: 'failed', active: false },
      { active: false, phase: 'idle', generation: 8 },
    ];
    for (const patch of cases) {
      for (const start of [loadingBall(), openingBall(), releasingBall()]) {
        const at = start.since + 1;
        const next = stepBall(start, input({ ...patch, nowMs: at }));
        expect(next.phase).toBe('aborted');
        expect(next.since).toBe(at);
      }
    }
  });

  it('the abort fade is short and then the ball is gone', () => {
    const aborted = stepBall(loadingBall(), input({ phase: 'failed', nowMs: 1300 }));
    expect(BALL_TIMING.abortFadeMs).toBeLessThanOrEqual(150);
    expect(ballWakeAt(aborted)).toBe(1300 + BALL_TIMING.abortFadeMs);
    const gone = stepBall(
      aborted,
      input({ active: false, phase: 'idle', nowMs: 1300 + BALL_TIMING.abortFadeMs }),
    );
    expect(gone.phase).toBe('hidden');
  });
});

describe('ball-loader-state — deadline and generations', () => {
  it('the ball lifetime bound equals the readiness deadline, with a safety margin', () => {
    expect(BALL_TIMING.maxLoadingMs).toBe(SCENE_READY_TIMEOUT_MS);
    expect(BALL_TIMING.deadlineMarginMs).toBeGreaterThanOrEqual(100);
    expect(ballLifeEndAt(1000, SCENE_READY_TIMEOUT_MS)).toBe(LIFE_END);
  });

  it('an unpresented ball starts leaving so it is gone by deadline − margin (even if the Lite flip regressed)', () => {
    const ball = loadingBall();
    expect(ballWakeAt(ball)).toBe(LOADING_EXIT);
    const capped = stepBall(ball, input({ nowMs: LOADING_EXIT }));
    expect(capped.phase).toBe('aborted');
    expect(capped.since + BALL_TIMING.abortFadeMs).toBeLessThanOrEqual(LIFE_END);
  });

  it('the cap is measured from the ATTEMPT START, not from when the ball appeared', () => {
    const ball = stepBall(INITIAL_BALL, input({ begunAtMs: 600, nowMs: 1000 }));
    expect(ballWakeAt(ball)).toBe(ballLifeEndAt(600, SCENE_READY_TIMEOUT_MS) - 200);
  });

  it('D23: presented but never armed by the life end aborts — no late partial arm, Lite follows at the deadline', () => {
    const ball = stepBall(loadingBall(), input({ phase: 'presented', nowMs: 9000 }));
    expect(ball.phase).toBe('loading');
    const exited = stepBall(ball, input({ phase: 'presented', nowMs: LOADING_EXIT }));
    // Never `opening` onto an incomplete world (the r2 quick-crossfade path is gone).
    expect(exited.phase).toBe('aborted');
    expect(exited.since + BALL_TIMING.abortFadeMs).toBeLessThanOrEqual(LIFE_END);
    // An arm that shows up after the ball left never re-summons it.
    const hidden = stepBall(exited, input({ phase: 'presented', nowMs: LOADING_EXIT + BALL_TIMING.abortFadeMs }));
    expect(hidden.phase).toBe('hidden');
    expect(stepBall(hidden, input({ ...ARMED, armedAtMs: LIFE_END, nowMs: LIFE_END }))).toBe(hidden);
  });

  it('recaptures a new generation mid-load (theme switch) and restarts its clock', () => {
    const ball = stepBall(
      loadingBall({ milestones: 2 }),
      input({ generation: 8, begunAtMs: 4900, milestones: 0, nowMs: 5000 }),
    );
    expect(ball.phase).toBe('loading');
    expect(ball.generation).toBe(8);
    expect(ball.since).toBe(5000);
    expect(ball.milestones).toBe(0);
    expect(ballWakeAt(ball)).toBe(ballLifeEndAt(4900, SCENE_READY_TIMEOUT_MS) - 200);
  });

  it('shakes stay monotone across a recapture (the wobble key never regresses)', () => {
    let ball = stepBall(loadingBall(), input({ milestones: 1, nowMs: 1100 }));
    ball = stepBall(ball, input({ generation: 8, milestones: 0, nowMs: 1200 }));
    expect(ball.shakes).toBe(1);
    ball = stepBall(ball, input({ generation: 8, milestones: 1, nowMs: 1300 }));
    expect(ball.shakes).toBe(2);
  });

  it('an aborted generation stays hidden when it later presents and arms (no ceremony replay)', () => {
    const aborted = stepBall(loadingBall(), input({ nowMs: LOADING_EXIT }));
    expect(aborted.phase).toBe('aborted');
    const hidden = stepBall(aborted, input({ nowMs: LOADING_EXIT + BALL_TIMING.abortFadeMs }));
    expect(hidden.phase).toBe('hidden');
    expect(hidden.generation).toBe(7);
    expect(stepBall(hidden, input({ phase: 'presented', nowMs: DEADLINE + 400 }))).toBe(hidden);
    expect(stepBall(hidden, input({ ...ARMED, nowMs: DEADLINE + 500 }))).toBe(hidden);
  });

  it('retry after an abort re-enters loading for the new generation', () => {
    const aborted = stepBall(loadingBall(), input({ active: false, phase: 'idle', nowMs: 1300 }));
    const hidden = stepBall(aborted, input({ active: false, phase: 'idle', generation: 8, nowMs: 2000 }));
    expect(hidden.phase).toBe('hidden');
    const retried = stepBall(hidden, input({ generation: 9, begunAtMs: 9000, nowMs: 9000 }));
    expect(retried.phase).toBe('loading');
    expect(retried.generation).toBe(9);
  });

  it('a retry inside the abort fade goes straight back to loading', () => {
    const aborted = stepBall(loadingBall(), input({ phase: 'failed', nowMs: 1300 }));
    const retried = stepBall(aborted, input({ generation: 9, begunAtMs: 1340, nowMs: 1350 }));
    expect(retried.phase).toBe('loading');
  });

  it('a finished ceremony never replays for the same generation, but a new one loads', () => {
    let done = stepBall(openingBall(), input({ ...ARMED, nowMs: 5000 }));
    done = stepBall(done, input({ ...ARMED, nowMs: 5300 }));
    expect(done.phase).toBe('done');
    expect(stepBall(done, input({ ...ARMED, nowMs: 6000 }))).toBe(done);
    expect(stepBall(done, input({ generation: 8, begunAtMs: 7000, nowMs: 7000 })).phase).toBe(
      'loading',
    );
  });

  it('defaults the ball lifetime to the production deadline', () => {
    const ball = stepBall(INITIAL_BALL, input({}));
    expect(ball.deadlineMs).toBe(SCENE_READY_TIMEOUT_MS);
    expect(ballWakeAt(ball)).toBe(LOADING_EXIT);
  });

  it('a relaxed (debug capture) deadline moves the ball bound with it', () => {
    const ball = stepBall(INITIAL_BALL, input({ deadlineMs: 30_000 }));
    expect(ballWakeAt(ball)).toBe(ballLifeEndAt(1000, 30_000) - 200);
    const held = stepBall(ball, input({ deadlineMs: 30_000, nowMs: 1000 + SCENE_READY_TIMEOUT_MS + 5000 }));
    expect(held.phase).toBe('loading');
    const opened = stepBall(
      held,
      input({ deadlineMs: 30_000, armed: true, armedAtMs: 21_000, phase: 'presented', nowMs: 21_000 }),
    );
    expect(opened.phase).toBe('opening');
    expect(opened.quick).toBe(false);
  });
});

describe('reveal gate (D3, D23 complete at reveal)', () => {
  const complete = {
    nowMs: 5000,
    presented: true,
    assetsIdle: true,
    residencyComplete: true,
    sceneWarm: true,
    begunAtMs: 1000,
    deadlineMs: SCENE_READY_TIMEOUT_MS,
  };

  it('the ball lifetime (maxLoadingMs) equals the readiness deadline: 20 s', () => {
    expect(BALL_TIMING.maxLoadingMs).toBe(SCENE_READY_TIMEOUT_MS);
    expect(BALL_TIMING.maxLoadingMs).toBe(20_000);
  });

  it('arms only when the world is COMPLETE: presented, assets idle, resident and warm', () => {
    expect(revealGate(complete)).toBe('arm');
    for (const missing of ['presented', 'assetsIdle', 'residencyComplete', 'sceneWarm'] as const) {
      expect(revealGate({ ...complete, [missing]: false }), missing).toBe('wait');
    }
  });

  it('has NO assets cap: an incomplete world waits however long after presented, until the last arm point', () => {
    const waiting = { ...complete, sceneWarm: false };
    for (const nowMs of [5000, 7000, 9000, 12_000, 15_000, revealArmLastAt(1000, SCENE_READY_TIMEOUT_MS) - 0.1]) {
      expect(revealGate({ ...waiting, nowMs })).toBe('wait');
    }
  });

  it('never arms past the last arm point, even complete (no late partial arm; Lite follows)', () => {
    const last = revealArmLastAt(1000, SCENE_READY_TIMEOUT_MS);
    // The last arm point is the loading ball's own exit (the machine's `loadingExitAt`).
    expect(last).toBe(LOADING_EXIT);
    // PR #65 review: the bound is EXCLUSIVE on the gate's side. At exactly `last` an unarmed loading
    // ball already aborts (`nowMs >= loadingExitAt`; its wake lands at the first instant at or past it,
    // and both sides read `performance.now()` at 0.1 ms), so an arm read at that same instant could
    // follow the abort: a world without its ceremony. The machine's `>=` is the one that must stay (a
    // wake landing exactly on time must act); the gate yields the instant (Lite at the deadline).
    expect(stepBall(loadingBall(), input({ phase: 'presented', nowMs: last })).phase).toBe('aborted');
    expect(revealGate({ ...complete, nowMs: last - 0.1 })).toBe('arm');
    expect(revealGate({ ...complete, nowMs: last })).toBe('expired');
    expect(revealGate({ ...complete, nowMs: last + 1 })).toBe('expired');
    expect(revealGate({ ...complete, sceneWarm: false, nowMs: last + 1 })).toBe('expired');
  });

  it('a complete world early enough gets the FULL ceremony; a late complete one a scaled one, never a partial world', () => {
    const early = 1000 + 9000;
    expect(ceremonyPlan({ armedAtMs: early, begunAtMs: 1000, deadlineMs: SCENE_READY_TIMEOUT_MS, reducedMotion: false, flight: true }).mode).toBe('full');
    const late = LOADING_EXIT;
    expect(ceremonyPlan({ armedAtMs: late, begunAtMs: 1000, deadlineMs: SCENE_READY_TIMEOUT_MS, reducedMotion: false, flight: true }).mode).toBe('quick');
  });

  it('the relaxed (debug) deadline moves the last arm point with it', () => {
    expect(revealArmLastAt(1000, 30_000)).toBe(ballLifeEndAt(1000, 30_000) - 200);
    expect(revealGate({ ...complete, deadlineMs: 30_000, nowMs: 1000 + SCENE_READY_TIMEOUT_MS + 1000 })).toBe('arm');
  });

  // Wave 2: the r5 programs-warm latch is retired; the D23 warm settle
  // (`sceneWarm`) is the programs input now, and the gate reads no other.
  it('takes no programs-warm or cap input', () => {
    expect(Object.keys(complete satisfies Parameters<typeof revealGate>[0])).not.toContain('programsWarm');
    expect(Object.keys(complete)).not.toContain('presentedAtMs');
  });

  it('the ball stays docked and closed (loading) while the gate waits for the complete world', () => {
    let state = INITIAL_BALL;
    const base = {
      active: true,
      armed: false,
      armedAtMs: null,
      phase: 'presented' as const,
      generation: 4,
      begunAtMs: 1000,
      milestones: 4,
      reducedMotion: false,
    };
    state = stepBall(state, { ...base, phase: 'loading', milestones: 0, nowMs: 1000 });
    expect(state.phase).toBe('loading');
    for (let now = 5000; now < 7000; now += 100) {
      state = stepBall(state, { ...base, nowMs: now });
      expect(state.phase).toBe('loading');
    }
    // The complete world arms: the full ceremony (fits: 7000 + openMs well before the life end).
    const opened = stepBall(state, { ...base, armed: true, armedAtMs: 7000, nowMs: 7000 });
    expect(opened.phase).toBe('opening');
    expect(opened.quick).toBe(false);
  });
});

describe('ball-loader-state — review r5 (a stall never skips releasing)', () => {
  it('a step landing past both the release and the ceremony end still enters releasing first', () => {
    const loading = stepBall(INITIAL_BALL, input({}));
    const opening = stepBall(loading, input({ ...ARMED, nowMs: 2000 }));
    expect(opening.phase).toBe('opening');
    // One stalled step 1.5 s later: past releaseAt (2240) and the authored end (3060).
    const releasing = stepBall(opening, input({ ...ARMED, nowMs: 3500 }));
    expect(releasing.phase).toBe('releasing');
    // The compressed release still holds for its floor before done.
    expect(stepBall(releasing, input({ ...ARMED, nowMs: 3500 })).phase).toBe('releasing');
    expect(ballWakeAt(releasing)).toBeGreaterThanOrEqual(3500 + BALL_TIMING.minReleaseMs);
  });
});

/**
 * Properties (review r3; D23 gate), with the provider modelled exactly (arm
 * = handoff the moment the world is COMPLETE, never after the last arm point;
 * otherwise Lite at the deadline) and the ball stepped only at its own
 * `ballWakeAt` and the provider's transitions, each step landing LATE by a
 * pseudo-random 0–80 ms (timer / frame lateness):
 * - phase order: a presented generation always shows loading → opening →
 *   releasing → done, in order, never skipping one;
 * - deadline margin: no ball pixel survives the deadline, and a failed
 *   (never presented) attempt is aborted before it.
 */
describe('ceremony properties (phase order, deadline margin, lateness 0–80 ms)', () => {
  const BEGUN = 1000;
  const END = BEGUN + SCENE_READY_TIMEOUT_MS;
  const GEN = 3;

  /** Deterministic lateness in [0, 80] ms. */
  function lateness(seed: number): () => number {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) % 81;
    };
  }

  interface Run {
    phases: BallPhase[];
    final: BallState;
    /** Wall time at which the ball's last pixel is gone (done/hidden entry, or abort + fade). */
    goneAt: number;
    abortedAt: number | null;
  }

  function simulate(
    presentedAt: number | null,
    completeAt: number,
    reducedMotion: boolean,
    seed: number,
  ): Run {
    const late = lateness(seed);
    // D23: the gate arms when presented AND complete (assets, residency,
    // warm), and never past the last arm point (`revealGate`).
    const readyAt = presentedAt === null ? Infinity : Math.max(presentedAt, completeAt);
    const armedAt = readyAt < revealArmLastAt(BEGUN, SCENE_READY_TIMEOUT_MS) ? readyAt : Infinity;
    // The provider's own deadline (never armed → Lite) lands at END.
    const failAt = armedAt === Infinity ? END : Infinity;
    const at = (t: number): BallInput => ({
      active: t < failAt,
      armed: t >= armedAt,
      armedAtMs: t >= armedAt ? armedAt : null,
      phase: t >= failAt ? 'idle' : presentedAt !== null && t >= presentedAt ? 'presented' : 'loading',
      generation: GEN,
      begunAtMs: BEGUN,
      milestones: 0,
      nowMs: t,
      reducedMotion,
    });
    let ball = stepBall(INITIAL_BALL, at(BEGUN + 50));
    let now = BEGUN + 50;
    const phases: BallPhase[] = [ball.phase];
    let abortedAt: number | null = null;
    let goneAt = Infinity;
    const events = [presentedAt ?? Infinity, armedAt, failAt].filter(Number.isFinite);
    for (let guard = 0; guard < 64; guard += 1) {
      const wake = ballWakeAt(ball);
      const candidates = events.filter((t) => t > now);
      if (wake !== null) candidates.push(Math.max(wake, now) + late());
      if (candidates.length === 0) break;
      now = Math.min(...candidates);
      const next = stepBall(ball, at(now));
      if (next.phase !== ball.phase) {
        phases.push(next.phase);
        if (next.phase === 'aborted') {
          abortedAt = now;
          goneAt = now + BALL_TIMING.abortFadeMs;
        }
        if (next.phase === 'done' && goneAt === Infinity) goneAt = now;
      }
      ball = next;
      if (ball.phase === 'done' || ball.phase === 'hidden') break;
    }
    return { phases, final: ball, goneAt, abortedAt };
  }

  it('an armed generation never skips a phase; an unarmed one never opens (no partial reveal)', () => {
    let seed = 1;
    const lastArm = revealArmLastAt(BEGUN, SCENE_READY_TIMEOUT_MS);
    for (let presentedAt = BEGUN + 250; presentedAt <= END - 400; presentedAt += 97) {
      for (const completeLag of [0, 300, 1500, 5000]) {
        for (const reducedMotion of [false, true]) {
          const run = simulate(presentedAt, presentedAt + completeLag, reducedMotion, (seed += 7));
          const armed = presentedAt + completeLag < lastArm;
          expect(run.phases, `presented ${presentedAt}, complete +${completeLag}`).toEqual(
            armed ? ['loading', 'opening', 'releasing', 'done'] : ['loading', 'aborted', 'hidden'],
          );
        }
      }
    }
  });

  it('no ball pixel survives the deadline, with any 0–80 ms lateness per step', () => {
    let seed = 11;
    for (let presentedAt = BEGUN + 250; presentedAt <= END; presentedAt += 61) {
      for (const completeLag of [0, 700, 5000]) {
        for (const reducedMotion of [false, true]) {
          const run = simulate(presentedAt, presentedAt + completeLag, reducedMotion, (seed += 13));
          expect(['done', 'hidden', 'aborted']).toContain(run.final.phase);
          expect(run.goneAt, `presented ${presentedAt}`).toBeLessThanOrEqual(END);
        }
      }
    }
  });

  it('a never-presented attempt aborts before the deadline and is gone before it (timeout path)', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const run = simulate(null, Infinity, false, seed);
      expect(run.phases).toEqual(['loading', 'aborted', 'hidden']);
      // Scheduled at the life end minus the fade; ≤ 80 ms late at worst.
      expect(run.abortedAt ?? Infinity).toBeLessThanOrEqual(LOADING_EXIT + 80);
      expect(run.abortedAt ?? Infinity).toBeLessThan(END - BALL_TIMING.deadlineMarginMs);
      // Last visible pixel (abort commit + CSS fade) is well inside the deadline.
      expect(run.goneAt).toBeLessThanOrEqual(END - 20);
    }
  });

  it('a presentation early enough always gets the FULL ceremony (beam included)', () => {
    const run = simulate(BEGUN + 4000, BEGUN + 4200, false, 5);
    expect(run.final.phase).toBe('done');
    expect(run.final.quick).toBe(false);
  });
});

describe('two-phase handoff — sections are never hidden while the canvas is not fully composited', () => {
  const settled: CompositeSample = { canvasOpacity: 1, animating: false, renderedFrames: 10 };

  function run(samples: CompositeSample[]): boolean[] {
    let gate: CompositeGate = INITIAL_COMPOSITE_GATE;
    return samples.map((sample) => {
      const step = stepHandoffComposite(gate, sample);
      gate = step.gate;
      return step.live;
    });
  }

  it('waits for opacity 1, no running animation, consecutive frames and a drawn renderer frame', () => {
    const live = run([
      { canvasOpacity: 0, animating: true, renderedFrames: 1 },
      { canvasOpacity: 0.6, animating: true, renderedFrames: 2 },
      { canvasOpacity: 1, animating: true, renderedFrames: 3 }, // the iris still opening
      { ...settled, renderedFrames: 4 },
      { ...settled, renderedFrames: 5 },
    ]);
    expect(live).toEqual([false, false, false, false, true]);
  });

  it('a parked renderer (no frame drawn) still hands over after the fallback frames', () => {
    const live = run(Array.from({ length: HANDOFF_COMPOSITE.fallbackFrames }, () => settled));
    expect(live.at(-1)).toBe(true);
    expect(live.slice(0, -1).every((value) => !value)).toBe(true);
  });

  it('property: live is never reported on a sample whose opacity < 1 or that is animating', () => {
    let x = 12345;
    const rand = () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
    let gate: CompositeGate = INITIAL_COMPOSITE_GATE;
    let frames = 0;
    for (let i = 0; i < 5000; i += 1) {
      frames += rand() < 0.5 ? 1 : 0;
      const sample: CompositeSample = {
        canvasOpacity: rand() < 0.7 ? 1 : Math.round(rand() * 100) / 100,
        animating: rand() < 0.3,
        renderedFrames: frames,
      };
      const step = stepHandoffComposite(gate, sample);
      if (step.live) {
        expect(sample.canvasOpacity).toBe(1);
        expect(sample.animating).toBe(false);
        expect(step.gate.settled).toBeGreaterThanOrEqual(HANDOFF_COMPOSITE.settledFrames);
      }
      gate = step.live ? INITIAL_COMPOSITE_GATE : step.gate;
    }
  });

  it('a regression to opacity < 1 resets the settle count', () => {
    const live = run([settled, { ...settled, canvasOpacity: 0.99 }, { ...settled, renderedFrames: 11 }]);
    expect(live).toEqual([false, false, false]);
  });
});

describe('ball-loader-state — review r4 (phantom wobbles, stuck release, beam peak)', () => {
  it('a milestone dip never lowers the baseline: the climb back is NOT a new wobble', () => {
    let ball = stepBall(loadingBall(), input({ milestones: 2, nowMs: 1100 }));
    expect(ball.shakes).toBe(2);
    // A canvas remount releases M1/M2 (or one render reads a snapshot keyed to
    // another generation) — the count dips and climbs back.
    ball = stepBall(ball, input({ milestones: 0, nowMs: 1900 }));
    ball = stepBall(ball, input({ milestones: 1, nowMs: 1920 }));
    ball = stepBall(ball, input({ milestones: 2, nowMs: 1940 }));
    expect(ball.shakes).toBe(2);
    expect(ball.milestones).toBe(2);
    // Only a rise ABOVE the high-water mark shakes.
    ball = stepBall(ball, input({ milestones: 3, nowMs: 2000 }));
    expect(ball.shakes).toBe(3);
  });

  it('shakes increment only on milestone rises — phase, arm and generation noise add none', () => {
    let ball = stepBall(loadingBall(), input({ milestones: 1, nowMs: 1100 }));
    const shakes = ball.shakes;
    for (const phase of ['idle', 'loading', 'presented'] as const) {
      ball = stepBall(ball, input({ milestones: 1, phase, nowMs: 1200 }));
    }
    ball = stepBall(ball, input({ ...ARMED, milestones: 1, nowMs: 2000 }));
    ball = stepBall(ball, input({ ...ARMED, milestones: 4, nowMs: 2100 }));
    ball = stepBall(ball, input({ ...ARMED, milestones: 4, nowMs: 2300 }));
    expect(ball.shakes).toBe(shakes);
  });

  it('releasing goes done within the wall-clock bound even when the clock stalled (no rAF, no animationend)', () => {
    // Live at 2000; the opening step lands on time, then NOTHING runs until
    // one wake far past every beat (the r4 capture: 30 s in releasing).
    const releasing = releasingBall();
    const wake = ballWakeAt(releasing);
    expect(wake).not.toBeNull();
    expect((wake ?? Infinity) - releasing.since).toBeLessThanOrEqual(BALL_TIMING.releaseBoundMs);
    expect(BALL_TIMING.releaseBoundMs).toBe(BALL_TIMING.releaseMs + 500);
    const done = stepBall(releasing, input({ ...ARMED, nowMs: releasing.since + BALL_TIMING.releaseBoundMs }));
    expect(done.phase).toBe('done');
    expect(ballVisible(done)).toBe(false);
  });

  it('property: every releasing state wakes within releaseBoundMs of entry', () => {
    for (const armLag of [0, 100, 400, 900, 3000]) {
      for (const releaseLag of [0, 50, 300, 1200]) {
        const opening = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000 + armLag }));
        const releasing = stepBall(
          opening,
          input({ ...ARMED, nowMs: (ballWakeAt(opening) ?? Infinity) + releaseLag }),
        );
        expect(releasing.phase).toBe('releasing');
        const wake = ballWakeAt(releasing) ?? Infinity;
        expect(wake - releasing.since).toBeLessThanOrEqual(BALL_TIMING.releaseBoundMs);
        expect(wake).toBeLessThanOrEqual(LIFE_END);
      }
    }
  });

  it('a stalled reveal commit keeps the ball until the CSS beam (timed from the commit) passed its peak', () => {
    // Armed at 2000, but the commit that rendered data-revealing (and so the
    // machine's opening step) only landed at 2800 after a stall.
    const opening = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2800 }));
    expect(opening.openedAt).toBe(2000);
    expect(opening.revealCommitAt).toBe(2800);
    expect(stepBall(opening, input({ ...ARMED, nowMs: 2801 }))).toBe(opening);
    const releasing = stepBall(opening, input({ ...ARMED, nowMs: 2800 + BALL_TIMING.handoffMs }));
    expect(releasing.phase).toBe('releasing');
    const beamPeakEnd = 2800 + BALL_TIMING.handoffMs + BALL_TIMING.beamPeakMs;
    expect(ballWakeAt(releasing)).toBe(beamPeakEnd);
    expect(stepBall(releasing, input({ ...ARMED, nowMs: beamPeakEnd - 1 })).phase).toBe('releasing');
    expect(stepBall(releasing, input({ ...ARMED, nowMs: beamPeakEnd })).phase).toBe('done');
  });

  it('the quick crossfade has no beam floor (it plays no beam)', () => {
    const armedAt = LIFE_END - BALL_TIMING.shortMinMs + 1;
    const opening = stepBall(loadingBall(), input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt + 300 }));
    expect(opening.quick).toBe(true);
    const releasing = stepBall(opening, input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt + 301 }));
    expect(ballWakeAt(releasing)).toBe(armedAt + 301 + BALL_TIMING.reducedFadeMs);
  });
});

describe('wobblePlays — a rock plays once per shake, never replayed by a remount or phase change', () => {
  const LOADING = { phase: 'loading' as const, revealing: false, reduced: false };

  it('plays for a new shake while docked and loading', () => {
    expect(wobblePlays({ ...LOADING, shakes: 1, settledShake: 0 })).toBe(true);
    expect(wobblePlays({ ...LOADING, shakes: 0, settledShake: 0 })).toBe(false);
  });

  it('a remount after the rock ended does not replay it (settled = shakes)', () => {
    expect(wobblePlays({ ...LOADING, shakes: 2, settledShake: 2 })).toBe(false);
  });

  it('an abort / opening / releasing after a shake renders no data-wobble (the r3 ctx-opening replay)', () => {
    for (const phase of ['opening', 'releasing', 'aborted', 'done', 'hidden'] as const) {
      expect(wobblePlays({ phase, revealing: false, reduced: false, shakes: 3, settledShake: 2 })).toBe(false);
    }
  });

  it('the reveal and the crossfade preempt the rock; dropping them later cannot restart it', () => {
    expect(wobblePlays({ ...LOADING, revealing: true, shakes: 3, settledShake: 2 })).toBe(false);
    expect(wobblePlays({ ...LOADING, reduced: true, shakes: 3, settledShake: 2 })).toBe(false);
  });

  it('end to end: phase churn over one milestone yields exactly one playing render per shake', () => {
    // Shake 1 plays, ends (settled 1), then the ball opens and aborts —
    // every later render keeps data-wobble off.
    const renders = [
      { ...LOADING, shakes: 1, settledShake: 0 },
      { ...LOADING, shakes: 1, settledShake: 1 },
      { phase: 'opening' as const, revealing: true, reduced: false, shakes: 1, settledShake: 1 },
      { phase: 'aborted' as const, revealing: false, reduced: false, shakes: 1, settledShake: 1 },
    ];
    expect(renders.map((render) => wobblePlays(render))).toEqual([true, false, false, false]);
  });
});

/**
 * Wave 2 (W7 escalation, change of technique): the ceremony's visuals are
 * one compositor timeline; the machine only keys the unmount. These pin the
 * plan it shares with the render (full / time-scaled short / quick), the
 * ≤ 640 px flight lead, the timeline-start floor and 1:1 rock queueing.
 */
describe('ceremonyPlan — full, time-scaled short, quick', () => {
  const base = { begunAtMs: 1000, deadlineMs: SCENE_READY_TIMEOUT_MS, reducedMotion: false };

  it('full when the whole ceremony fits; the ≤ 640 px flight adds its lead', () => {
    expect(ceremonyPlan({ ...base, armedAtMs: 2000, flight: false })).toEqual({
      mode: 'full',
      scale: 1,
      beamScale: 1,
      leadMs: 0,
      totalMs: BALL_TIMING.openMs,
    });
    expect(ceremonyPlan({ ...base, armedAtMs: 2000, flight: true })).toEqual({
      mode: 'full',
      scale: 1,
      beamScale: 1,
      leadMs: BALL_TIMING.flightMs,
      totalMs: BALL_TIMING.flightMs + BALL_TIMING.openMs,
    });
  });

  it('a late arm with ≥ shortMinMs of life left gets the SHORTENED ceremony (beam kept), never the crossfade', () => {
    for (const flight of [false, true]) {
      for (let left = BALL_TIMING.shortMinMs; left < fullCeremonyMs(flight); left += 37) {
        const plan = ceremonyPlan({ ...base, armedAtMs: LIFE_END - left, flight });
        expect(plan.mode, `left ${left}`).toBe('short');
        expect(plan.scale).toBeGreaterThanOrEqual(0);
        expect(plan.scale).toBeLessThanOrEqual(1);
        expect(plan.beamScale).toBeLessThanOrEqual(1);
        // It always ends by the life end.
        expect(LIFE_END - left + plan.totalMs).toBeLessThanOrEqual(LIFE_END + 1e-6);
        // Wave-2 r2: the red/white release keeps ≥ shortMinMs (to the 1/100
        // scale floor) — the lead-in is squeezed first.
        expect(BALL_TIMING.releaseMs * plan.beamScale).toBeGreaterThanOrEqual(BALL_TIMING.shortMinMs - 9);
        // So the shafts (700 ms authored) burn ≥ ~500 ms.
        expect(700 * plan.beamScale).toBeGreaterThanOrEqual(500);
        expect(plan.totalMs).toBeCloseTo(timelineOffsetMs(plan, BALL_TIMING.openMs), 6);
      }
    }
  });

  it('under shortMinMs left, or reduced motion: the quick crossfade', () => {
    expect(ceremonyPlan({ ...base, armedAtMs: LIFE_END - BALL_TIMING.shortMinMs + 1, flight: false }).mode).toBe(
      'quick',
    );
    expect(ceremonyPlan({ ...base, armedAtMs: 2000, flight: true, reducedMotion: true })).toEqual({
      mode: 'quick',
      scale: 1,
      beamScale: 1,
      leadMs: 0,
      totalMs: BALL_TIMING.reducedFadeMs,
    });
  });

  it('a stall that pushes the arm up to (full − shortMinMs) past the cap clamp still plays a beam', () => {
    const clamp = LIFE_END - fullCeremonyMs(true);
    for (const flight of [false, true]) {
      const armedAt = clamp + (fullCeremonyMs(true) - BALL_TIMING.shortMinMs);
      expect(LIFE_END - armedAt).toBe(BALL_TIMING.shortMinMs);
      expect(ceremonyPlan({ ...base, armedAtMs: armedAt, flight }).mode).toBe('short');
    }
  });
});

describe('ball-loader-state — the machine follows the plan (wave 2)', () => {
  it('a short reveal scales every beat and still passes opening → releasing → done by the life end', () => {
    const armedAt = LIFE_END - 800;
    let ball = stepBall(loadingBall(), input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt }));
    expect(ball.phase).toBe('opening');
    expect(ball.mode).toBe('short');
    expect(ball.quick).toBe(false);
    const release = armedAt + timelineOffsetMs(ball, BALL_TIMING.handoffMs);
    expect(ballWakeAt(ball)).toBeCloseTo(release, 6);
    ball = stepBall(ball, input({ ...ARMED, armedAtMs: armedAt, nowMs: release }));
    expect(ball.phase).toBe('releasing');
    const end = ballWakeAt(ball) ?? Infinity;
    expect(end).toBeCloseTo(armedAt + timelineOffsetMs(ball, BALL_TIMING.openMs), 6);
    // The release itself kept ≥ shortMinMs (to the scale floor).
    expect(end - release).toBeGreaterThanOrEqual(BALL_TIMING.shortMinMs - 9);
    expect(end).toBeLessThanOrEqual(LIFE_END);
    expect(stepBall(ball, input({ ...ARMED, armedAtMs: armedAt, nowMs: end })).phase).toBe('done');
  });

  it('≤ 640 px: the flight lead offsets the release (the burst fires after the ball reached centre)', () => {
    const opening = stepBall(loadingBall(), input({ ...ARMED, flight: true, nowMs: 2000 }));
    expect(opening.leadMs).toBe(BALL_TIMING.flightMs);
    expect(ballWakeAt(opening)).toBe(2000 + BALL_TIMING.flightMs + BALL_TIMING.handoffMs);
    const releasing = stepBall(
      opening,
      input({ ...ARMED, flight: true, nowMs: 2000 + BALL_TIMING.flightMs + BALL_TIMING.handoffMs }),
    );
    expect(releasing.phase).toBe('releasing');
    expect(ballWakeAt(releasing)).toBe(2000 + fullCeremonyMs(true));
  });

  it('the plan is latched at the reveal: a later viewport change cannot re-time it', () => {
    const opening = stepBall(loadingBall(), input({ ...ARMED, flight: true, nowMs: 2000 }));
    const later = stepBall(opening, input({ ...ARMED, flight: false, nowMs: 2100 }));
    expect(later.leadMs).toBe(BALL_TIMING.flightMs);
  });

  it('a CSS timeline that started late (a stall before the first styled frame) holds done until its real end', () => {
    // Armed and committed at 2000, but the first frame that started the
    // animations only ran at 2400 (a 400 ms shader link in between).
    let ball = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000 }));
    ball = stepBall(ball, input({ ...ARMED, nowMs: 2000 + BALL_TIMING.handoffMs, timelineAtMs: 2400 }));
    // Wave-2 r3: `opening` mirrors the late CSS start (the hinge runs 2400 → 2640).
    expect(ball.phase).toBe('opening');
    expect(ball.timelineAt).toBe(2400);
    expect(ballWakeAt(ball)).toBe(2400 + BALL_TIMING.handoffMs);
    ball = stepBall(ball, input({ ...ARMED, nowMs: 2400 + BALL_TIMING.handoffMs, timelineAtMs: 2400 }));
    expect(ball.phase).toBe('releasing');
    expect(ballWakeAt(ball)).toBe(2400 + BALL_TIMING.openMs);
    const almost = input({ ...ARMED, nowMs: 2400 + BALL_TIMING.openMs - 1, timelineAtMs: 2400 });
    expect(stepBall(ball, almost).phase).toBe('releasing');
    const due = input({ ...ARMED, nowMs: 2400 + BALL_TIMING.openMs, timelineAtMs: 2400 });
    expect(stepBall(ball, due).phase).toBe('done');
  });

  it('the timeline floor never breaks the release bound or the life end', () => {
    let ball = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000 }));
    ball = stepBall(ball, input({ ...ARMED, nowMs: 2000 + BALL_TIMING.handoffMs, timelineAtMs: 9000 }));
    // An absurd start read holds `opening` no longer than its slack bound.
    expect(ball.phase).toBe('opening');
    expect(ballWakeAt(ball)).toBe(2000 + BALL_TIMING.handoffMs + BALL_TIMING.openingSlackMs);
    ball = stepBall(ball, input({ ...ARMED, nowMs: ballWakeAt(ball) ?? Infinity, timelineAtMs: 9000 }));
    expect(ball.phase).toBe('releasing');
    expect(ballWakeAt(ball)).toBe(ball.since + BALL_TIMING.releaseBoundMs);
    const armedAt = LIFE_END - 700;
    const late = stepBall(loadingBall(), input({ ...ARMED, armedAtMs: armedAt, nowMs: armedAt }));
    const lateRelease = stepBall(
      late,
      input({ ...ARMED, armedAtMs: armedAt, nowMs: LIFE_END - 400, timelineAtMs: LIFE_END - 300 }),
    );
    expect(ballWakeAt(lateRelease) ?? Infinity).toBeLessThanOrEqual(LIFE_END);
  });

  it('the first timeline read wins; a read offered with the reveal step itself is not trusted', () => {
    let ball = stepBall(loadingBall(), input({ ...ARMED, nowMs: 2000, timelineAtMs: 2050 }));
    expect(ball.timelineAt).toBe(-1);
    ball = stepBall(ball, input({ ...ARMED, nowMs: 2010, timelineAtMs: 2050 }));
    expect(ball.timelineAt).toBe(2050);
    expect(stepBall(ball, input({ ...ARMED, nowMs: 2020, timelineAtMs: 2400 })).timelineAt).toBe(2050);
  });
});

describe('wobblePlan — 1:1 rocks, in order, queued behind the running one (wave 2)', () => {
  const LOADING = { phase: 'loading' as const, revealing: false, reduced: false };

  it('rises at t and t + 80 ms produce two rocks: the second starts when the first ends (≤ one rock later)', () => {
    // Machine: two rises → shakes 1, then 2.
    let ball = stepBall(loadingBall(), input({ milestones: 1, nowMs: 1000 }));
    ball = stepBall(ball, input({ milestones: 2, nowMs: 1080 }));
    expect(ball.shakes).toBe(2);
    // Component: rock 1 plays from t; the rise at t + 80 does NOT restart it.
    expect(wobblePlan({ ...LOADING, shakes: 1, settledShake: 0 })).toEqual({ shake: 1, fast: false });
    expect(wobblePlan({ ...LOADING, shakes: 2, settledShake: 0 })?.shake).toBe(1);
    // Rock 1 ends at t + 620: rock 2 starts then, 540 ms after its rise.
    expect(wobblePlan({ ...LOADING, shakes: 2, settledShake: 1 })).toEqual({ shake: 2, fast: false });
    expect(1000 + BALL_TIMING.wobbleMs - 1080).toBeLessThanOrEqual(BALL_TIMING.wobbleMs);
  });

  it('a burst owes one rock per milestone; a backlog drains at the fast tempo', () => {
    const ball = stepBall(loadingBall(), input({ milestones: 3, nowMs: 1000 }));
    expect(ball.shakes).toBe(3);
    const plays: Array<{ shake: number; fast: boolean }> = [];
    for (let settled = 0; settled < 3; settled += 1) {
      const plan = wobblePlan({ ...LOADING, shakes: ball.shakes, settledShake: settled });
      if (plan !== null) plays.push(plan);
    }
    expect(plays).toEqual([
      { shake: 1, fast: true },
      { shake: 2, fast: true },
      { shake: 3, fast: false },
    ]);
    expect(BALL_TIMING.wobbleFastMs).toBeLessThan(BALL_TIMING.wobbleMs);
  });

  it('the reveal or an abort drops the queue: a later attempt never replays old rocks', () => {
    let ball = stepBall(loadingBall(), input({ milestones: 3, nowMs: 1000 }));
    // Rock 1 of 3 played, then the reveal preempts rocks 2 and 3.
    ball = stepBall(ball, input({ ...ARMED, milestones: 3, nowMs: 2000 }));
    expect(ball.rockFloor).toBe(3);
    expect(wobblePlan({ ...LOADING, shakes: ball.shakes, settledShake: 1, floor: ball.rockFloor })).toBeNull();
    // A retry after an abort: its first rise owes exactly one new rock.
    const loaded = stepBall(loadingBall(), input({ milestones: 2, nowMs: 1100 }));
    const aborted = stepBall(loaded, input({ phase: 'failed', nowMs: 1200 }));
    expect(aborted.rockFloor).toBe(2);
    let retry = stepBall(aborted, input({ generation: 9, begunAtMs: 1300, milestones: 0, nowMs: 1300 }));
    retry = stepBall(retry, input({ generation: 9, begunAtMs: 1300, milestones: 1, nowMs: 1400 }));
    expect(retry.shakes).toBe(3);
    expect(wobblePlan({ ...LOADING, shakes: retry.shakes, settledShake: 0, floor: retry.rockFloor })).toEqual({
      shake: 3,
      fast: false,
    });
  });

  it('never plays while revealing, reduced, or outside loading (the r4 contract holds)', () => {
    expect(wobblePlan({ ...LOADING, revealing: true, shakes: 2, settledShake: 0 })).toBeNull();
    expect(wobblePlan({ ...LOADING, reduced: true, shakes: 2, settledShake: 0 })).toBeNull();
    expect(wobblePlan({ phase: 'opening', revealing: false, reduced: false, shakes: 2, settledShake: 0 })).toBeNull();
  });
});

describe('placeLoaderChip — the DOM keep-out law (wave-2 r2)', () => {
  const vp = { width: 390, height: 844 };
  const chip = { width: 200, height: 70 };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const inside = (p: { left: number; top: number }) => {
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.top).toBeGreaterThanOrEqual(16);
    expect(p.left + chip.width).toBeLessThanOrEqual(vp.width - 16);
    expect(p.top + chip.height).toBeLessThanOrEqual(vp.height - 16);
  };

  it('no text: bottom centre, fully inside with the 16 px gutter', () => {
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets, obstacles: [] });
    expect(p.clear).toBe(true);
    expect(p.left).toBe(95);
    expect(p.top).toBe(844 - 16 - 70);
    inside(p);
  });

  it('a table row across the bottom (the r5 "12 Pkt." row): climbs to the free band above it', () => {
    const row = { left: 20, top: 700, width: 350, height: 140 };
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets, obstacles: [row] });
    expect(p.clear).toBe(true);
    expect(p.top + chip.height).toBeLessThanOrEqual(row.top);
    inside(p);
  });

  it('the safe-area inset is kept', () => {
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets: { ...insets, bottom: 34 }, obstacles: [] });
    expect(p.top + chip.height).toBeLessThanOrEqual(vp.height - 16 - 34);
  });

  it('wide screens use the free side margins before climbing', () => {
    const wide = { width: 1440, height: 900 };
    const column = { left: 360, top: 0, width: 720, height: 900 };
    const p = placeLoaderChip({ viewport: wide, chip: { width: 212, height: 134 }, gutterPx: 16, insets, obstacles: [column] });
    expect(p.clear).toBe(true);
    expect(p.top).toBe(900 - 16 - 134);
    expect(p.left + 212 <= 360 || p.left >= 1080).toBe(true);
  });

  it('nowhere clear: the least-overlapping box, flagged, still inside the viewport', () => {
    const wall = { left: 0, top: 0, width: 390, height: 844 };
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets, obstacles: [wall] });
    expect(p.clear).toBe(false);
    expect(p.band).toBeUndefined();
    inside(p);
  });

  it('wave-2 r3: with the lower band full, a clear slot higher up (below the top inset) wins', () => {
    // Text covers the lower 60 % of the viewport; the top band is free.
    const lowerText = { left: 0, top: 844 * 0.4, width: 390, height: 844 * 0.6 };
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets, obstacles: [lowerText] });
    expect(p.clear).toBe(true);
    expect(p.band).toBeUndefined();
    expect(p.top + chip.height).toBeLessThanOrEqual(lowerText.top);
    inside(p);
  });

  it('wave-2 r3: nowhere clear with a band given -> the compact row in the bottom HUD band', () => {
    const wall = { left: 0, top: 0, width: 390, height: 844 };
    const band = { width: 212, height: 48 };
    const p = placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets: { ...insets, bottom: 34 }, obstacles: [wall], band });
    expect(p.band).toBe(true);
    expect(p.clear).toBe(false);
    // Centred, bottom-docked above the safe-area inset with the 4 px edge.
    expect(p.left).toBe((390 - 212) / 2);
    expect(p.top).toBe(844 - 34 - 4 - 48);
    // A clear page never takes the band.
    expect(placeLoaderChip({ viewport: vp, chip, gutterPx: 16, insets, obstacles: [], band }).band).toBeUndefined();
  });
});

describe('wave-2 r3 contracts', () => {
  it('the page handoff is written only on the route tier and only from routeSceneLive (Lite floor)', () => {
    expect(routeHandoffAllowed({ tier: 'route', routeSceneLive: true })).toBe(true);
    expect(routeHandoffAllowed({ tier: 'route', routeSceneLive: false })).toBe(false);
    expect(routeHandoffAllowed({ tier: 'lite', routeSceneLive: true })).toBe(false);
    expect(routeHandoffAllowed({ tier: 'lite', routeSceneLive: false })).toBe(false);
  });

  it('more than FULL_LENGTH_REMAINING_MS of life at the arm always plans the full ceremony (k = 1)', () => {
    expect(fullCeremonyMs(true)).toBeLessThanOrEqual(FULL_LENGTH_REMAINING_MS);
    const begunAtMs = 1000;
    const lifeEnd = ballLifeEndAt(begunAtMs, SCENE_READY_TIMEOUT_MS);
    for (const flight of [true, false]) {
      const plan = ceremonyPlan({ armedAtMs: lifeEnd - FULL_LENGTH_REMAINING_MS - 1, begunAtMs, deadlineMs: SCENE_READY_TIMEOUT_MS, reducedMotion: false, flight });
      expect(plan.mode).toBe('full');
      expect(plan.scale).toBe(1);
      expect(plan.beamScale).toBe(1);
    }
  });
});

describe('loaderStageLine — the status line follows the real milestone', () => {
  it('German on the plaza, English elsewhere; the furthest stage wins', () => {
    expect(LOADER_MILESTONES).toBe(6);
    expect(loaderStageLine('de', { renderer: false, assets: false, firstFrame: false, count: 1 })).toBe('Welt wird geladen · 1/6');
    expect(loaderStageLine('de', { renderer: true, assets: false, firstFrame: false, count: 2 })).toBe('Grafik startet · 2/6');
    expect(loaderStageLine('de', { renderer: true, assets: true, compiled: true, firstFrame: false, count: 4 })).toBe('Shader bereit · 4/6');
    expect(loaderStageLine('en', { renderer: true, assets: true, compiled: true, uploaded: true, firstFrame: false, count: 5 })).toBe('Textures loaded · 5/6');
    expect(loaderStageLine('en', { renderer: true, assets: true, compiled: true, uploaded: true, firstFrame: true, count: 6 })).toBe('Building the world · 6/6');
  });
});
