import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-text access for the contract tests that pin the route canvas and the
 * warm by regex (M15 / M16 split).
 *
 * `RouteWorldCanvas.tsx` and `useStationWarmup.ts` were split, without a
 * behaviour change, into one module per concern under `canvas/` and `warm/`;
 * the two original files stay as the entry (the canvas) and the import path
 * (the warm's re-exports). A contract that is about "the canvas" or "the
 * warm" as a whole reads every module of it, so a pattern keeps covering code
 * whatever module it lives in, and a negative pattern cannot pass vacuously
 * because the code it guards moved. A contract about one component reads that
 * component's module (`readRoute`).
 */

const ROUTE = join(__dirname, '..');

/** One file under `src/components/world/route/`, by its path relative to it. */
export function readRoute(file: string): string {
  return readFileSync(join(ROUTE, file), 'utf8');
}

/** `dir`'s own .ts / .tsx modules (no subdirectories), relative to the route directory, sorted. */
function modulesOf(dir: string): string[] {
  return readdirSync(join(ROUTE, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

/** The route canvas's modules: the entry first, then `canvas/`. */
export function canvasModules(): string[] {
  return ['RouteWorldCanvas.tsx', ...modulesOf('canvas')];
}

/** The warm's modules: the re-exporting entry first, then `warm/`. */
export function warmModules(): string[] {
  return ['useStationWarmup.ts', ...modulesOf('warm')];
}

/** Every module of the route canvas, concatenated (see the module note). */
export function canvasSource(): string {
  return canvasModules().map(readRoute).join('\n');
}

/** Every module of the warm, concatenated (see the module note). */
export function warmSource(): string {
  return warmModules().map(readRoute).join('\n');
}
