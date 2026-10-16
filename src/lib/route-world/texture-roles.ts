/**
 * Theme texture-role resolution (C-100 criterion 2).
 *
 * `RouteThemeDefinition.textureRoles` declares which PBR sets a theme's
 * asset pipeline provides; this module is the pure half of the consumer
 * that turns that declaration into a load plan. The React half lives at
 * `src/components/world/route/env/ThemeTextureSet.tsx`. Resolution goes
 * through `envTextureSetUrls` — the same manifest lookup the closed plaza
 * union uses — so a declared role always resolves to the exact URLs the
 * pipeline wrote, and a theme that declares NOTHING resolves to a plan
 * with ZERO loads (the empty-role no-op is structural, not a branch the
 * loader has to remember).
 *
 * Pure data — no client-only imports, unit-testable in node.
 */

import {
  envTextureSetUrls,
  hasEnvTextureSet,
  type TextureSetUrls,
} from './world-env';
import type { WorldManifest } from './model-manifest';

/** Number of textures a complete set fetches (diff + nor, plus arm when present). */
function setLoadCount(urls: TextureSetUrls): number {
  return (urls.diff ? 1 : 0) + (urls.nor ? 1 : 0) + (urls.arm ? 1 : 0);
}

/** One declared role's resolution: the URL set, or `null` when not loadable. */
export interface ResolvedTextureRole {
  /** The role exactly as the theme declared it. */
  role: string;
  /** Resolved URLs, or `null` when the manifest does not ship a complete set. */
  urls: TextureSetUrls | null;
}

/** The load plan for a theme's `textureRoles` declaration. */
export interface ThemeTexturePlan {
  /** One entry per declared role, in declaration order. */
  resolved: readonly ResolvedTextureRole[];
  /** Textures the plan would fetch — `0` for an empty declaration. */
  loadCount: number;
  /** URL strings of every fetch the plan implies (deduped, declaration order). */
  urls: readonly string[];
}

/**
 * Resolve a theme's texture-role declaration against the manifest.
 *
 * `roles: []` — the sakura/mountain/clouds declarations — returns an empty
 * plan: no roles, `loadCount: 0`, no URLs. A declared role whose set is
 * missing or incomplete resolves to `urls: null` (the material falls back
 * to its procedural default; an unbuilt env folder must never blank a
 * wall), and contributes zero to `loadCount`.
 */
export function planThemeTextureRoles(manifest: WorldManifest, roles: readonly string[]): ThemeTexturePlan {
  const resolved: ResolvedTextureRole[] = [];
  const urls: string[] = [];
  let loadCount = 0;
  for (const role of roles) {
    if (!hasEnvTextureSet(manifest, role)) {
      resolved.push({ role, urls: null });
      continue;
    }
    const set = envTextureSetUrls(manifest, role);
    resolved.push({ role, urls: set });
    loadCount += setLoadCount(set);
    for (const url of [set.diff, set.nor, set.arm]) {
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return { resolved, loadCount, urls };
}
