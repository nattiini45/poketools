import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, ShaderMaterial } from 'three';
import { BALL_TIMING, INITIAL_BALL, stepBall, type BallInput, type BallState } from '@/lib/route-world/ball-loader-state';
import { THEME_VEIL, THEME_VEIL_IDLE, veilBallSettled, veilHoldsWorldDraws, veilReleaseAfterBallMs } from '@/lib/route-world/theme-veil';
import { pointLightCeiling } from '../light-loop';
import {
  captureThemeSwap,
  envProgramState,
  pointCountRose,
  releaseThemeSwapRetention,
  settleThemeSwap,
  themeSwapCaptured,
  themeSwapRetention,
  VEILED_WARM,
  veiledLinkBudget,
} from '../useStationWarmup';
import {
  ceremonyRenderHold,
  isVeiledGeneration,
  markVeiledGeneration,
  noteBallLoaderMounted,
  noteRevealArmed,
  publishBallPhase,
  resetSceneProgressForTests,
  VEILED_QUIET_MS,
} from '../scene-progress';
import { beginSceneGeneration, resetSceneReadiness } from '../world-readiness';

/**
 * ENGINE-FIX (rollout part A2). D32: a day/night swap of a live world is a
 * short fade, not a reload — the veiled generation reveals silently, keeps
 * the programs the swap re-creates, evicts nothing but a risen point-light
 * count, and runs its warm unthrottled behind the opaque veil.
 */

const ROUTE = join(__dirname, '..');
const read = (file: string) => readFileSync(file, 'utf8');

const BASE: BallInput = {
  active: true,
  armed: false,
  armedAtMs: null,
  phase: 'loading',
  generation: 1,
  begunAtMs: 0,
  milestones: 0,
  nowMs: 0,
  reducedMotion: false,
};

/** Drive the machine from a finished first reveal into generation 2 (a swap). */
function doneBall(): BallState {
  let ball = stepBall(INITIAL_BALL, { ...BASE, nowMs: 10 });
  ball = stepBall(ball, { ...BASE, armed: true, armedAtMs: 5000, phase: 'presented', nowMs: 5000 });
  ball = stepBall(ball, { ...BASE, armed: true, armedAtMs: 5000, phase: 'presented', nowMs: 5000 + BALL_TIMING.openMs });
  ball = stepBall(ball, { ...BASE, armed: true, armedAtMs: 5000, phase: 'presented', nowMs: 5000 + BALL_TIMING.openMs + BALL_TIMING.releaseBoundMs });
  expect(ball.phase).toBe('done');
  return ball;
}

describe('the silent ceremony of a veiled swap (ball-loader-state)', () => {
  it('a first load is never silent, and plays the full ceremony', () => {
    const ball = stepBall(INITIAL_BALL, { ...BASE, nowMs: 10 });
    expect(ball.phase).toBe('loading');
    expect(ball.silent).toBe(false);
    const opening = stepBall(ball, { ...BASE, armed: true, armedAtMs: 5000, phase: 'presented', nowMs: 5000 });
    expect(opening.mode).toBe('full');
  });

  it('a generation after a finished ceremony loads silently and reveals in three steps with no beat time', () => {
    const done = doneBall();
    const swap: BallInput = { ...BASE, generation: 2, begunAtMs: 20_000, nowMs: 20_000 };
    const loading = stepBall(done, swap);
    expect(loading.phase).toBe('loading');
    expect(loading.silent).toBe(true);
    const armed = { ...swap, armed: true, armedAtMs: 21_000, phase: 'presented' as const };
    const opening = stepBall(loading, { ...armed, nowMs: 21_000 });
    expect(opening.phase).toBe('opening');
    expect(opening.quick).toBe(true);
    // No wall-clock wait between the beats: each next step advances.
    const releasing = stepBall(opening, { ...armed, nowMs: 21_000 });
    expect(releasing.phase).toBe('releasing');
    const ended = stepBall(releasing, { ...armed, nowMs: 21_000 });
    expect(ended.phase).toBe('done');
  });

  it('a second flip under the veil keeps the swap silent', () => {
    const loading = stepBall(doneBall(), { ...BASE, generation: 2, begunAtMs: 20_000, nowMs: 20_000 });
    const rebased = stepBall(loading, { ...BASE, generation: 3, begunAtMs: 20_500, nowMs: 20_500 });
    expect(rebased.generation).toBe(3);
    expect(rebased.silent).toBe(true);
  });
});

describe('the veil lifts on the new palette, not on the ball (theme-veil)', () => {
  it('without the DPR clamp the veil outwaits only the silent ball’s own commits', () => {
    expect(veilReleaseAfterBallMs(false)).toBe(THEME_VEIL.releaseAfterSilentBallMs);
    expect(THEME_VEIL.releaseAfterSilentBallMs).toBeLessThan(THEME_VEIL.releaseAfterBallMs);
    expect(veilBallSettled({ hasBall: true, phase: 'releasing', since: 0, now: 5000, dprClamp: false })).toBe(false);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 0, now: THEME_VEIL.releaseAfterSilentBallMs - 1, dprClamp: false })).toBe(false);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 0, now: THEME_VEIL.releaseAfterSilentBallMs, dprClamp: false })).toBe(true);
  });

  it('with the DPR clamp the veil outwaits its restore', () => {
    expect(veilReleaseAfterBallMs(true)).toBe(THEME_VEIL.releaseAfterBallMs);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 0, now: THEME_VEIL.releaseAfterBallMs - 1, dprClamp: true })).toBe(false);
    expect(veilBallSettled({ hasBall: true, phase: 'done', since: 0, now: THEME_VEIL.releaseAfterBallMs, dprClamp: true })).toBe(true);
    expect(veilBallSettled({ hasBall: true, phase: 'opening', since: 0, now: 5000, dprClamp: true })).toBe(false);
  });

  it('the store holds the veil while an armed ball has not stepped into its reveal', () => {
    const store = read(join(ROUTE, 'theme-veil-store.ts'));
    expect(store).toMatch(/getBallPhase\(\) === 'loading' && getRevealArmedAt\(\) !== null/);
  });
});

describe('veiled generations in the progress store (scene-progress)', () => {
  beforeEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });
  afterEach(() => {
    resetSceneReadiness();
    resetSceneProgressForTests();
  });

  it('marks the swap generation and never holds its draws for a ceremony', () => {
    const release = noteBallLoaderMounted();
    const first = beginSceneGeneration('plaza:day')!;
    markVeiledGeneration(first + 1);
    const swap = beginSceneGeneration('plaza:night')!;
    expect(isVeiledGeneration(swap)).toBe(true);
    expect(isVeiledGeneration(first)).toBe(false);
    noteRevealArmed(swap, 100);
    publishBallPhase('loading');
    expect(ceremonyRenderHold(150)).toBe(false);
    release();
  });

  it('a veiled generation settles in the short quiet window', () => {
    expect(VEILED_QUIET_MS).toBeLessThan(300);
    const residency = read(join(ROUTE, 'residency-store.ts'));
    expect(residency).toMatch(/isVeiledGeneration\(\) \? VEILED_QUIET_MS : RESIDENCY_QUIET_MS/);
  });
});

describe('the warm behind the veil (useStationWarmup)', () => {
  it('only a key-relevant environment change makes variants stale', () => {
    expect(envProgramState('uuid-a:1:303/1024x512')).toBe(envProgramState('uuid-b:1:303/1024x512'));
    expect(envProgramState('uuid-a:0:303/0x0')).not.toBe(envProgramState('uuid-a:1:303/1024x512'));
    expect(envProgramState('-')).toBe('-');
  });

  it('evicts behind the veil only on a risen point-light count', () => {
    expect(pointCountRose('20/0', '27/0')).toBe(true);
    expect(pointCountRose('27/0', '20/0')).toBe(false);
    expect(pointCountRose('27/0', '27/0')).toBe(false);
  });

  it('issues more links per step behind the veil, bounded by the in-flight cap', () => {
    expect(veiledLinkBudget(0)).toBe(VEILED_WARM.newProgramsPerStep);
    expect(veiledLinkBudget(VEILED_WARM.maxLinksInFlight - 3)).toBe(3);
    expect(veiledLinkBudget(VEILED_WARM.maxLinksInFlight + 5)).toBe(0);
  });
});

describe('theme-swap program retention (useStationWarmup)', () => {
  afterEach(() => releaseThemeSwapRetention());

  const disposals = (material: { addEventListener: (type: 'dispose', fn: () => void) => void }) => {
    const seen = { count: 0 };
    material.addEventListener('dispose', () => {
      seen.count += 1;
    });
    return seen;
  };

  it('defers the swap commit’s disposals, keeps the left palette and releases the target’s old set', () => {
    const scene = new Scene();
    const geometry = new BoxGeometry();
    const dayShader = new ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    const shared = new MeshStandardMaterial();
    const dayMesh = new Mesh(geometry, dayShader);
    scene.add(dayMesh, new Mesh(geometry, shared));
    const dayDisposed = disposals(dayShader);
    const sharedDisposed = disposals(shared);

    captureThemeSwap(scene, 'plaza:day');
    expect(themeSwapCaptured()).toBe(true);
    // The swap's commit: the component replaces its material and disposes the old.
    const nightShader = new ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    dayMesh.material = nightShader;
    dayShader.dispose();
    // A disposal asked for a LIVE material (the warm's own eviction) is dropped.
    shared.dispose();
    expect(dayDisposed.count).toBe(0);
    expect(sharedDisposed.count).toBe(0);

    expect(settleThemeSwap(scene, 'plaza:night')).toEqual({ kept: 1, released: 0 });
    expect(themeSwapRetention()).toEqual({ open: false, kept: { 'plaza:day': 1 } });
    expect(dayDisposed.count).toBe(0);
    expect(sharedDisposed.count).toBe(0);

    // The way back: the day palette's kept set is released once its successors are warm.
    captureThemeSwap(scene, 'plaza:night');
    const dayAgain = new ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' });
    dayMesh.material = dayAgain;
    nightShader.dispose();
    expect(settleThemeSwap(scene, 'plaza:day')).toEqual({ kept: 1, released: 1 });
    expect(dayDisposed.count).toBe(1);
    expect(themeSwapRetention().kept).toEqual({ 'plaza:night': 1 });
    // Disposal works normally again once the capture closed.
    dayAgain.dispose();
    expect(Object.prototype.hasOwnProperty.call(dayAgain, 'dispose')).toBe(false);
  });

  it('a world that goes away honours every deferred disposal and releases the kept sets', () => {
    const scene = new Scene();
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    scene.add(mesh);
    const seen = disposals(material);
    captureThemeSwap(scene, 'sakura:day');
    mesh.removeFromParent();
    material.dispose();
    expect(seen.count).toBe(0);
    releaseThemeSwapRetention();
    expect(seen.count).toBe(1);
    expect(themeSwapRetention()).toEqual({ open: false, kept: {} });
  });
});

describe('the host wiring (RouteWorldCanvas, provider, CSS)', () => {
  it('captures before the swap commits and settles once the swap generation is warm', () => {
    const provider = read(join(ROUTE, 'WorldStateProvider.tsx'));
    const commit = provider.match(/const commitSwap = \(\) => \{[\s\S]*?\n {4}\};/)?.[0] ?? '';
    expect(commit.indexOf('runThemeSwapHooks')).toBeGreaterThan(-1);
    expect(commit.indexOf('runThemeSwapHooks')).toBeLessThan(commit.indexOf('beginSceneGeneration'));
    const canvas = read(join(ROUTE, 'RouteWorldCanvas.tsx'));
    expect(canvas).toMatch(/registerThemeSwapHook\(/);
    expect(canvas).toMatch(/settleThemeSwap\(scene, swapToKey\)/);
    expect(canvas).toMatch(/padTarget = Math\.max\(padTarget, pointLightCeiling\(realLights\)\)/);
    expect(canvas).toMatch(/syncPointLightPad\(scene, pads, Math\.max\(0, padTarget - realLights\)\)/);
    // The other palette's HDRI bytes are prefetched during the FIRST load only.
    expect(canvas).toMatch(/function OtherPaletteHdriPrefetch\(\)[\s\S]*?getRevealArmedAt\(\) !== null/);
  });

  it('pad lights add no light and cast no shadow', () => {
    const canvas = read(join(ROUTE, 'RouteWorldCanvas.tsx'));
    const pad = canvas.match(/function syncPointLightPad[\s\S]*?\n\}/)?.[0] ?? '';
    expect(pad).toMatch(/new THREE\.PointLight\(0x000000, 0,/);
    expect(pad).toMatch(/pad\.castShadow = false/);
  });

  it('the veil shows its Pokéball from 600 ms into the opaque hold, still under reduced motion', () => {
    const globals = read(join(ROUTE, '..', '..', '..', 'app', 'globals.css'));
    const status = globals.match(/html\[data-route-veil\] \.route-theme-veil-status \{[\s\S]*?\}/)?.[0] ?? '';
    expect(status).toMatch(new RegExp(`animation: route-veil-status-in 240ms ease-out ${THEME_VEIL.inMs + 600}ms both`));
    const block = globals.slice(globals.indexOf('=== D32 veil Pokéball'), globals.indexOf('=== end D32 veil Pokéball'));
    expect(block).toMatch(/\.route-theme-veil-ball \{[\s\S]*?animation: route-veil-ball-rock/);
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*html\[data-route-veil\] \.route-theme-veil-ball\s*\{\s*animation: none;/);
    // Transform only (a compositor rock), no slab behind it (D25).
    const keyframes = block.match(/@keyframes route-veil-ball-rock \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(keyframes).not.toMatch(/opacity|background/);
  });

  it('a marked beam part is pre-rastered in one pulse, not composited for the rest of the load', () => {
    const css = read(join(ROUTE, 'BallLoader.module.css'));
    expect(css).toMatch(/:is\(\.glow, \.core, \.ring, \.ray, \.spark\)\[data-warm\] \{\s*animation: beamPrime 400ms steps\(1, end\) forwards;/);
    expect(css).toMatch(/\.sweep\[data-warm\] \{\s*animation:\s*sweepPark 100000s steps\(1, end\) infinite,\s*beamPrime 400ms steps\(1, end\) forwards;/);
    const prime = css.match(/@keyframes beamPrime \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(prime).toMatch(/from \{\s*opacity: 0\.002;/);
    expect(prime).toMatch(/to \{\s*opacity: 0;/);
  });
});

describe('ENGINE-FIX A2 round 2: the veil at the start rung', () => {
  it('pads the point-light count to a power-of-two ceiling (plaza 20 and 27 share 32)', () => {
    expect(pointLightCeiling(0)).toBe(0);
    expect(pointLightCeiling(1)).toBe(1);
    expect(pointLightCeiling(8)).toBe(8);
    expect(pointLightCeiling(11)).toBe(16);
    expect(pointLightCeiling(20)).toBe(32);
    expect(pointLightCeiling(27)).toBe(32);
    expect(pointLightCeiling(pointLightCeiling(20))).toBe(pointLightCeiling(27));
  });

  it('holds the world draws while the veil closes over it, never once the swap is committed', () => {
    const base = { ...THEME_VEIL_IDLE };
    expect(veilHoldsWorldDraws({ ...base, phase: 'idle' })).toBe(false);
    expect(veilHoldsWorldDraws({ ...base, phase: 'in' })).toBe(true);
    expect(veilHoldsWorldDraws({ ...base, phase: 'opaque', committed: false })).toBe(true);
    expect(veilHoldsWorldDraws({ ...base, phase: 'opaque', committed: true })).toBe(false);
    expect(veilHoldsWorldDraws({ ...base, phase: 'out', committed: true })).toBe(false);
    const canvas = read(join(ROUTE, 'RouteWorldCanvas.tsx'));
    expect(canvas).toMatch(/ceremonyRenderHold\(performance\.now\(\)\) \|\| themeVeilHoldsWorldDraws\(\)/);
  });

  it('pads from the first load on, and a veiled swap compiles only once its environment is back', () => {
    const canvas = read(join(ROUTE, 'RouteWorldCanvas.tsx'));
    // Not gated on a swap: every generation's frame check pads.
    expect(canvas).not.toMatch(/if \(padTarget > 0 && veiled\(\)\) syncPointLightPad/);
    const ready = canvas.match(/compileReady: \(\) => \{[\s\S]*?\n {6}\},/)?.[0] ?? '';
    expect(ready).toMatch(/!swapEnvPending\(\)/);
    const complete = canvas.match(/contentComplete: \(\) => \{[\s\S]*?\n {6}\},/)?.[0] ?? '';
    expect(complete).toMatch(/!swapEnvPending\(\)/);
    expect(canvas).toMatch(/swapEnvSince = scene\.environment !== null \? performance\.now\(\) : null/);
  });

  it('behind the veil: one batched compile, the first pose only, no redraw of unchanged objects', () => {
    const warm = read(join(ROUTE, 'useStationWarmup.ts'));
    const veiledCompile = warm.match(/const compileVeiled = [\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(veiledCompile).toMatch(/proxyScene\.add\(proxy\)/);
    expect(veiledCompile).toMatch(/gl\.compile\(proxyScene, camera, scene\)/);
    // Exactly the queued variants — never a whole-scene compile there.
    expect(veiledCompile).not.toMatch(/gl\.compile\(scene, camera\)/);
    expect(warm).toMatch(/if \(deps\.veiled\?\.\(\) === true && posesDone > 0\) \{\s*poseQueue\.length = 0;/);
    expect(warm).toMatch(/if \(veiled && itemBytes === 0 && itemFresh === 0\) \{\s*buffersDone \+= 1;\s*continue;/);
  });
});
