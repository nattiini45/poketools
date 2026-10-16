'use client';

import { loadWorldManifest, type WorldManifest } from '@/lib/route-world/model-manifest';
import { currentSceneGeneration, getGenerationLog, getScenePhase, subscribeScenePhase } from '@/components/world/route/world-readiness';
import { prefetchFigureGLB } from './figure-loader';

/**
 * D42 N7b: the GLBs a world will certainly mount whose URLs the MANIFEST alone
 * decides (no cast, no roster) start downloading when the scene generation
 * begins, not when the component that mounts them first renders.
 *
 * A world's scene module registers a selector for its theme id at module
 * scope (it runs when the scene chunk evaluates, before any of the scene
 * renders); whenever a generation of that theme is loading — already, at
 * registration, or later (a palette swap, a re-entry) — the manifest is
 * requested and every selected URL goes to `prefetchFigureGLB` (idempotent,
 * no residency accounting: each consumer's own boundary still holds the
 * reveal; failures are counted in `failedFigureLoads`).
 *
 * Only texture-free or non-KTX2 GLBs belong here: a prefetch can start
 * before the renderer exists (KTX2 textures would wait for it, N7b's lazy
 * arm, but nothing in the manifest uses KHR_texture_basisu).
 */

export type GenerationPrefetchSelect = (manifest: WorldManifest) => readonly string[];

const sources = new Map<string, Set<GenerationPrefetchSelect>>();
/** The last generation each theme's sources ran for. */
const ranFor = new Map<string, number>();
let subscribed = false;

/** The theme id of the generation loading now (`<themeId>:<day|night>` keys), or null. */
export function loadingThemeId(): string | null {
  if (getScenePhase() !== 'loading') return null;
  const generation = currentSceneGeneration();
  const log = getGenerationLog();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i];
    if (entry.generation !== generation) continue;
    if (entry.kind !== 'begin') return null;
    const colon = entry.detail.lastIndexOf(':');
    return colon > 0 ? entry.detail.slice(0, colon) : entry.detail;
  }
  return null;
}

function runFor(themeId: string): void {
  const selects = sources.get(themeId);
  if (!selects || selects.size === 0) return;
  const generation = currentSceneGeneration();
  if (ranFor.get(themeId) === generation) return;
  ranFor.set(themeId, generation);
  const pending = [...selects];
  void loadWorldManifest().then((manifest) => {
    // A generation that was abandoned meanwhile prefetches nothing more.
    if (currentSceneGeneration() !== generation) return;
    for (const select of pending) {
      // A selector that throws loses only its own prefetch (the mounts still
      // load their GLBs): the others run, and nothing escapes as an
      // unhandled rejection (Kilo, PR #65).
      try {
        for (const url of select(manifest)) prefetchFigureGLB(url);
      } catch (error) {
        console.warn(`[route-world] generation prefetch for ${themeId} failed:`, error);
      }
    }
  });
}

function onPhase(): void {
  const themeId = loadingThemeId();
  if (themeId !== null) runFor(themeId);
}

/**
 * Register `select` for generations of `themeId`; runs at once when such a
 * generation is loading now. Returns the unregister.
 */
export function registerGenerationPrefetch(themeId: string, select: GenerationPrefetchSelect): () => void {
  let set = sources.get(themeId);
  if (!set) {
    set = new Set();
    sources.set(themeId, set);
  }
  set.add(select);
  if (!subscribed) {
    subscribed = true;
    subscribeScenePhase(onPhase);
  }
  // A late registration (the scene chunk evaluates after the generation began).
  ranFor.delete(themeId);
  onPhase();
  return () => {
    sources.get(themeId)?.delete(select);
  };
}

/** Test seam. */
export function resetGenerationPrefetchForTests(): void {
  sources.clear();
  ranFor.clear();
}
