import { describe, expect, it } from 'vitest';
import * as canvas from '../RouteWorldCanvas';
import * as warm from '../useStationWarmup';
import { canvasModules, readRoute, warmModules } from './route-sources';

/**
 * M15 / M16: `RouteWorldCanvas.tsx` and `useStationWarmup.ts` were split into
 * one module per concern (`canvas/`, `warm/`) with no behaviour change. These
 * pins keep the split honest: both original import paths still expose exactly
 * the runtime surface they had before the split, the warm's entry only
 * re-exports, and no split module imports back through its entry (an import
 * cycle through the entry would make module-load order depend on who imported
 * first).
 */

/** The 93 runtime exports `useStationWarmup.ts` had before the split. */
const WARM_EXPORTS = [
  'armStationWarmup', 'captureThemeSwap', 'COMPILE_HOLD_MAX_MS', 'compileHeldCount', 'compileShadowVariants',
  'compileVariantKey', 'compileWeight', 'createLinkCap', 'createLoadWarm', 'createLoadWarmIO',
  'createProgramsWarmTrack', 'deferExternalUploads', 'describeDataFace', 'enqueueWindowLatch', 'envProgramState',
  'getProgramsWarm', 'GUARD_TEXTURE_BUDGET_MS', 'guardCompileFrame', 'initSkipGate', 'isCompileHeld',
  'isLeadStation', 'LOAD_WARM_STAGES', 'loadWarmAllowsDraw', 'markLoadWarmComplete', 'MOUNT_SLICE_BUDGET_MS',
  'MOUNT_SLICE_TIMEOUT_MS', 'nextFreshBudget', 'noteProgramsFrame', 'onIdleSlice', 'passMaterials',
  'pointCountRose', 'postPassesToWarm', 'PROGRAMS_WARM_STABLE_FRAMES', 'queuedWindowLatches',
  'registeredWarmPostPasses', 'registerWarmPostPass', 'registerWarmPrepare', 'releaseHeldMask',
  'releaseThemeSwapRetention', 'renderTargetsOf', 'resetLoadWarmRegistriesForTests', 'resetProgramsWarmForTests',
  'resetWindowLatchQueueForTests', 'runWarmPrepare', 'settleThemeSwap', 'skipGateOpen', 'skipWindowRole',
  'STATION_LEAD_IDLE_MS', 'STATION_TRAVEL_LEAD', 'stationLeadAllowed', 'stepLinkCap', 'stepLoadWarm',
  'stepProgramsWarm', 'stepSkipGate', 'subscribeProgramsWarm', 'textureUploadBytes', 'themeSwapCaptured',
  'themeSwapRetention', 'travelLeadWanted', 'useSkipGate', 'useStaggeredMount', 'useStationLead', 'useWarmCompile',
  'VEILED_WARM', 'veiledLinkBudget', 'WARM_BUFFER_BYTES_PER_FRAME', 'WARM_BUFFER_DRAW_NEW_MATERIALS',
  'WARM_BUFFER_DRAWS_PER_STEP', 'WARM_BUFFER_LAYER', 'WARM_BUFFER_NEW_MATERIALS', 'WARM_BUFFER_NEW_MATERIALS_MAX',
  'WARM_COMPILE_BUDGET_MS', 'WARM_FENCE_MAX_MS', 'WARM_FRAME_SLOW_MS', 'WARM_FRAME_SMOOTH_MS',
  'WARM_FRAME_STALLED_MS', 'WARM_GPU_HEAVY_MS', 'WARM_GPU_REST_FACTOR', 'WARM_LINK_CAP_RAMP_FRAMES',
  'WARM_LINK_CAP_START', 'WARM_LINK_MAX_MS', 'WARM_MAX_LINKS_IN_FLIGHT', 'WARM_NEW_PROGRAMS_PER_FRAME',
  'WARM_POSE_SCALE', 'WARM_PRIME_BUDGET_MS', 'WARM_SHADOW_CASTERS_PER_FRAME', 'WARM_SIGNATURE_STABLE_FRAMES',
  'WARM_TEXTURE_BYTES_PER_STEP', 'WARM_TEXTURE_BYTES_WHILE_LINKING', 'WARM_VERIFY_MAX_PASSES', 'warmLinkBudget',
  'warmOutputsFor', 'warmShadowVariants',
];

/** The runtime exports `RouteWorldCanvas.tsx` had before the split. */
const CANVAS_EXPORTS = [
  'BATCH_BUILD_SLICE_MS', 'default', 'isDataFaceMaterial', 'LOAD_INERT_DRAW_MS', 'materialSignature',
  'POINT_LIGHT_PAD_NAME', 'routeCanvasMounts', 'VEILED_ENV_WAIT_MS', 'WARM_MAX_REWARMS', 'WARM_RECHECK_MS',
  'worldStaged',
];

const sorted = (names: readonly string[]) => [...names].sort();

/** Source with comments stripped, so prose never matches. */
const code = (file: string) =>
  readRoute(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('the M15 / M16 split keeps both import paths whole', () => {
  it('useStationWarmup exposes exactly its pre-split runtime surface', () => {
    expect(WARM_EXPORTS).toHaveLength(93);
    expect(sorted(Object.keys(warm))).toEqual(sorted(WARM_EXPORTS));
  });

  it('RouteWorldCanvas exposes exactly its pre-split runtime surface, the canvas as its default', () => {
    expect(sorted(Object.keys(canvas))).toEqual(sorted(CANVAS_EXPORTS));
    expect(typeof canvas.default).toBe('function');
    expect(canvas.default.name).toBe('RouteWorldCanvas');
  });

  it('the warm entry only re-exports: every concern lives in a warm/ module', () => {
    const statements = code('useStationWarmup.ts')
      .replace(/^'use client';$/m, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement).toMatch(/^export (type )?\{[^}]*\} from '\.\/warm\/[a-z-]+'$/);
  });

  it('no split module imports back through its entry', () => {
    const viaWarmEntry = /from '\.\.\/useStationWarmup'/;
    const viaCanvasEntry = /from '\.\.\/RouteWorldCanvas'/;
    const warmSplit = warmModules().filter((file) => file.startsWith('warm/'));
    const canvasSplit = canvasModules().filter((file) => file.startsWith('canvas/'));
    expect(warmSplit.length).toBeGreaterThan(0);
    expect(canvasSplit.length).toBeGreaterThan(0);
    for (const file of warmSplit) expect(code(file), file).not.toMatch(viaWarmEntry);
    for (const file of canvasSplit) expect(code(file), file).not.toMatch(viaCanvasEntry);
  });

  it("canvas/ modules import the warm's concrete modules, not the useStationWarmup re-export path", () => {
    for (const file of canvasModules().filter((f) => f.startsWith('canvas/'))) {
      expect(code(file), file).not.toMatch(/from '\.\.\/useStationWarmup'/);
    }
  });

  it("'use client' marks only split modules that use React; pure helpers carry no directive", () => {
    const usesReact = (src: string) => /from 'react'|from '@react-three\//.test(src);
    const splitModules = [...canvasModules(), ...warmModules()].filter((f) => /^(canvas|warm)\//.test(f));
    let pure = 0;
    for (const file of splitModules) {
      const src = readRoute(file);
      const directive = /^'use client';$/m.test(src.split('\n', 1)[0]);
      if (usesReact(code(file))) expect(directive, file).toBe(true);
      else {
        pure += 1;
        expect(directive, file).toBe(false);
      }
    }
    // batch-merge, frame-hold and eight warm/ helpers (load-warm, programs-warm, ...).
    expect(pure).toBe(10);
  });

  it('the module-load installs run only in the canvas entry, never in a split module', () => {
    const entry = code('RouteWorldCanvas.tsx');
    expect(entry).toMatch(/^installPointLightLoop\(\);$/m);
    expect(entry).toMatch(/^installSkeletonGuard\(\);$/m);
    for (const file of canvasModules().slice(1)) {
      expect(code(file), file).not.toMatch(/^installPointLightLoop\(\);$/m);
      expect(code(file), file).not.toMatch(/^installSkeletonGuard\(\);$/m);
    }
  });
});
