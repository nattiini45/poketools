import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ENGINE r3 source contracts (the pieces that only a browser run exercises):
 * - the reveal handoff flags live on their own context, so the arm commit does
 *   not re-render every world-state consumer; every component that acts on them
 *   reads `useWorldHandoff` / `WorldHandoffContext`;
 * - a day/night palette swap is a new scene generation (its own ceremony);
 * - the load warm re-enters on a later generation instead of stopping for good;
 * - the canvas mounts the world in stages and re-provides the handoff context.
 */
const SRC = join(process.cwd(), 'src');
const ROUTE = join(SRC, 'components', 'world', 'route');

// ENGINE-A4: reads and the components/ walk are cached once per file (the
// walk timed out under a loaded full suite); walking tests carry a timeout.
const FILE_WALK_TIMEOUT_MS = 30_000;
const texts = new Map<string, string>();
function read(path: string): string {
  let text = texts.get(path);
  if (text === undefined) {
    text = readFileSync(path, 'utf8');
    texts.set(path, text);
  }
  return text;
}

const walked = new Map<string, string[]>();
function sources(dir: string): string[] {
  let files = walked.get(dir);
  if (files === undefined) {
    files = walkSources(dir);
    walked.set(dir, files);
  }
  return files;
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(path).isDirectory()) walkSources(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe('ENGINE r3 contracts', () => {
  it('no component destructures the handoff flags from useWorldState()', () => {
    const offenders: string[] = [];
    for (const file of sources(join(SRC, 'components'))) {
      const text = read(file);
      const pattern = /const\s*\{([^}]*)\}\s*=\s*useWorldState\(\)/g;
      for (const match of text.matchAll(pattern)) {
        if (/\b(routeSceneLive|routeRevealArmed|routeRevealArmedAt)\b/.test(match[1])) offenders.push(file);
      }
      if (/useContext\(WorldStateContext\)\?\.\s*routeSceneLive/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  }, FILE_WALK_TIMEOUT_MS);

  it('the provider serves the handoff on its own context and keys generations on day/night', () => {
    const provider = read(join(ROUTE, 'WorldStateProvider.tsx'));
    expect(provider).toMatch(/export const WorldHandoffContext = createContext<WorldHandoffValue>/);
    expect(provider).toMatch(/<WorldHandoffContext\.Provider value=\{handoff\}>/);
    // R6 E1: the (theme, day/night) key is planned from the DOM (`planGenerationBegin`).
    expect(provider).toMatch(/const key = sceneGenerationKey\(input\.themeId, input\.domNightKey\);/);
    expect(provider).toMatch(/beginSceneGeneration\(plan\.key\)/);
    // The palette observer begins the new generation before the palette commits.
    expect(provider).toMatch(/const swapKey = inputs\.themeId !== null \? sceneGenerationKey\(inputs\.themeId, nextKey\) : null;/);
    expect(provider).toMatch(/beginSceneGeneration\(swapKey\);\s*\}\s*setPalette/);
    // The world-state value's identity does not carry the handoff flags.
    const deps = provider.slice(provider.indexOf('const value = useMemo<WorldStateValue>'));
    const depList = deps.slice(deps.indexOf('}, ['), deps.indexOf(']);'));
    expect(depList).not.toMatch(/routeSceneLive|routeRevealArmed/);
  });

  it('the canvas stages the world, re-provides the handoff and never stops its warm for good', () => {
    const canvas = read(join(ROUTE, 'RouteWorldCanvas.tsx'));
    expect(canvas).toMatch(/<StagedWorld>\{children\}<\/StagedWorld>/);
    expect(canvas).toMatch(/<WorldHandoffContext\.Provider value=\{handoff\}>/);
    const warmer = canvas.slice(canvas.indexOf('frameCheck.current = () => {'), canvas.indexOf('return () => {', canvas.indexOf('frameCheck.current = () => {')));
    expect(warmer).not.toMatch(/stopped = true/);
    expect(warmer).not.toMatch(/world-route-live/);
    // The warm's content gate waits for the staged mounts, the paint queue and live loads.
    expect(canvas).toMatch(/worldStaged\(gl\) &&\s*paintQueueIdle\(\) &&\s*!assetLoadsInFlight\(\)/);
  });

  it('the world-state value carries a stable conductor; the nav reads the conductor state context', () => {
    const provider = read(join(ROUTE, 'WorldStateProvider.tsx'));
    expect(provider).toMatch(/export const WorldConductorContext = createContext<ConductorState>/);
    expect(provider).toMatch(/const conductor = useMemo<RouteConductor>\(\s*\(\) => \(\{[\s\S]*?\}\),\s*\[\],\s*\);/);
    const nav = read(join(SRC, 'components', 'world', 'WorldNav.tsx'));
    expect(nav).toMatch(/useConductorState\(\)/);
    expect(nav).not.toMatch(/conductor\.(activeIndex|measured|stationIds)/);
  });

  it('a governor step holds material disposals (program-neutral rebuilt materials)', () => {
    const governor = read(join(ROUTE, 'QualityGovernor.tsx'));
    expect(governor).toMatch(/holdMaterialDisposals\(\);/);
    // ENGINE r4: released (with the retained data textures) when the canvas unmounts.
    expect(governor).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*releaseMaterialDisposals\(\);\s*releaseDataTextureDisposals\(\);/);
  });
});
