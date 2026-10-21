/**
 * Environment asset roles (ADR-0002) — HDRIs and PBR texture sets the plaza
 * pulls from the `world-assets` bucket. `scripts/world-assets/env-assets.mjs`
 * writes them; this module only knows the paths and how to resolve the
 * KTX2-or-WebP choice the pipeline made.
 */

import { KIT_BAY_IDS, type KitBayId } from './haussmann';
import { worldAssetUrl, type WorldManifest } from './model-manifest';
import { isNight } from './palette';

export type HdriRole = 'gold' | 'night';
export type TextureRole = 'cobble' | 'limestone' | 'slate';

/**
 * The painterly plaza sets (LOOK-PLAN §2 A.3, `paint-bake.mjs`), resolved
 * through the generic `envTextureSetUrls` like any theme-declared role.
 * `plaza-ground` ships diff + nor only (no ARM: AO is in the albedo and
 * roughness is derived in-shader); `plaza-ashlar` / `plaza-slate` ship
 * diff 1024 + nor / arm 512.
 */
export const PLAZA_PAINTED_ROLES = ['plaza-ground', 'plaza-ashlar', 'plaza-slate'] as const;
export type PlazaPaintedRole = (typeof PLAZA_PAINTED_ROLES)[number];
export type TextureMap = 'diff' | 'nor' | 'arm';

/**
 * Default HDRI yaws — the plaza's authored values, kept as the engine
 * fallback so a world that mounts `WorldEnvironment` without a resolved
 * theme behaves exactly as before themes existed. Themes override via
 * `RouteThemeDefinition.hdriYaw`.
 */
export const DEFAULT_HDRI_YAW: Record<HdriRole, number> = {
  gold: Math.PI * 0.62,
  night: Math.PI * 0.55,
};

export interface TextureSetUrls {
  diff: string | null;
  nor: string | null;
  arm: string | null;
  /** True when the set is KTX2 (needs the Basis transcoder), false for WebP. */
  ktx2: boolean;
}

/**
 * HDRI encodings on disk. `radiance` is the 1k Poly Haven `.hdr` every world
 * has always loaded; `gainmap` is its UltraHDR gain-map JPEG re-encode
 * (LOOK-PLAN §2 A.1, `env-assets.mjs --gainmap`): 22 KB day / 165 KB night
 * instead of 1 206 / 1 683 KB. drei 10.7.7 `useEnvironment` routes `.jpg`
 * through `HDRJPGLoader` (a renderer-backed decode into a HalfFloat target;
 * `useEnvironment.preload` cannot preload gain maps — nothing preloads it).
 * Probe-sphere ΔE76 vs the `.hdr` (diffuse + glossy, tone-mapped): day ≤ 0.07,
 * night ≤ 1.68; the sun / moon centroid is unmoved, so `hdriYaw` carries over.
 *
 * The DEFAULT stays `radiance`: sakura, mountain and clouds share
 * `WorldEnvironment`, and the blast-radius law keeps their pixels identical.
 * A theme opts in to the gain map (the plaza pilot) by passing `'gainmap'`.
 */
export type HdriFormat = 'radiance' | 'gainmap';

export function hdriFile(role: HdriRole, format: HdriFormat = 'radiance'): string {
  return `env/hdri/${role}.${format === 'gainmap' ? 'jpg' : 'hdr'}`;
}

export function hdriUrl(role: HdriRole, format: HdriFormat = 'radiance'): string {
  return worldAssetUrl(hdriFile(role, format));
}

/**
 * Manifest-aware HDRI URL: the requested format when the manifest lists it,
 * else the Radiance `.hdr` — a bucket published before the gain maps
 * (LOOK-PLAN §7 Q4) keeps lighting instead of 404-ing inside Suspense.
 */
export function hdriUrlFor(manifest: WorldManifest, role: HdriRole, format: HdriFormat = 'radiance'): string {
  return worldAssetUrl(hdriFileFor(manifest, role, format));
}

/** The manifest-relative file `hdriUrlFor` resolves to (same fallback law). */
export function hdriFileFor(manifest: WorldManifest, role: HdriRole, format: HdriFormat = 'radiance'): string {
  const wanted = hdriFile(role, format);
  return manifestFiles(manifest).has(wanted) ? wanted : hdriFile(role, 'radiance');
}

/**
 * The plaza's HDRI encoding (LOOK-PLAN §2 A.1): the gain map. This is the
 * value the plaza theme opts in with; every other world keeps `'radiance'`.
 * `hdriUrlFor(m, role, 'radiance')` is string-identical to `hdriUrl(role)`,
 * so a `WorldEnvironment` that routes through `hdriUrlFor` with the theme's
 * format (default `'radiance'`) leaves sakura, mountain and clouds untouched.
 */
export const PLAZA_HDRI_FORMAT: HdriFormat = 'gainmap';

/** HDRI for the current light; the palette's exposure is the day/night switch. */
export function hdriRoleFor(exposure: number): HdriRole {
  return isNight(exposure) ? 'night' : 'gold';
}

const MAPS: TextureMap[] = ['diff', 'nor', 'arm'];

/**
 * Generic role resolution over ANY role string (C-100 criterion 2): the
 * manifest's env layout is `env/tex/<role>/{diff,nor,arm}.{ktx2,webp}` for
 * every role, so a theme-declared role resolves through the exact same
 * lookup the closed plaza union uses. `textureSetUrls` delegates here with
 * its typed parameter — same body, same URLs, one resolution path.
 */
export function envTextureSetUrls(manifest: WorldManifest, role: string): TextureSetUrls {
  const picked = pickEnvTextureFiles(manifest, role);
  return {
    diff: picked[0] ? worldAssetUrl(picked[0].file) : null,
    nor: picked[1] ? worldAssetUrl(picked[1].file) : null,
    arm: picked[2] ? worldAssetUrl(picked[2].file) : null,
    ktx2: picked.some((entry) => entry?.ktx2 === true),
  };
}

function manifestFiles(manifest: WorldManifest): Set<string> {
  return new Set(manifest.environment.map((entry) => entry.file));
}

/** Per map (diff, nor, arm): the KTX2 file when shipped, else the WebP, else `null`. */
function pickEnvTextureFiles(manifest: WorldManifest, role: string): ({ file: string; ktx2: boolean } | null)[] {
  const files = manifestFiles(manifest);
  return MAPS.map((map) => {
    const ktx2 = `env/tex/${role}/${map}.ktx2`;
    if (files.has(ktx2)) return { file: ktx2, ktx2: true };
    const webp = `env/tex/${role}/${map}.webp`;
    if (files.has(webp)) return { file: webp, ktx2: false };
    return null;
  });
}

/** Manifest-relative files a complete role set loads (empty when diff or nor is missing). */
export function envTextureSetFiles(manifest: WorldManifest, role: string): string[] {
  const picked = pickEnvTextureFiles(manifest, role);
  if (!picked[0] || !picked[1]) return [];
  return picked.flatMap((entry) => (entry ? [entry.file] : []));
}

/**
 * Typed plaza-path resolution — the closed union every existing consumer
 * uses. Delegates to the generic body, so plaza keeps loading the exact
 * same URLs it always has (fileMaps parity depends on it).
 */
export function textureSetUrls(manifest: WorldManifest, role: TextureRole): TextureSetUrls {
  return envTextureSetUrls(manifest, role);
}

/** Generic-role availability: complete diff+nor pair, same completeness law. */
export function hasEnvTextureSet(manifest: WorldManifest, role: string): boolean {
  const set = envTextureSetUrls(manifest, role);
  return set.diff !== null && set.nor !== null;
}

export function hasTextureSet(manifest: WorldManifest, role: TextureRole): boolean {
  const set = textureSetUrls(manifest, role);
  return set.diff !== null && set.nor !== null;
}

export function kitBayFile(bay: KitBayId): string {
  return `env/kit/${bay}.glb`;
}

/** URLs for every façade kit module, or `null` when any is missing — the kit is all-or-nothing. */
export function kitBayUrls(manifest: WorldManifest): Record<KitBayId, string> | null {
  const files = manifestFiles(manifest);
  const urls = {} as Record<KitBayId, string>;
  for (const bay of KIT_BAY_IDS) {
    const file = kitBayFile(bay);
    if (!files.has(file)) return null;
    urls[bay] = worldAssetUrl(file);
  }
  return urls;
}

// ── Plaza story mask and skyline atlas (LOOK-PLAN §2 A.4 / A.5) ──────────────

/** The plaza story mask (`bake-plaza-mask.mts`; layout and channels in `plaza-ground.ts`). */
export const PLAZA_MASK_FILE = 'env/plaza/mask.webp';

/** The skyline silhouette atlas (`bake-plaza-skyline.mjs`). */
export const PLAZA_SKYLINE_FILE = 'env/plaza/skyline.webp';

/** URL of an env file when the manifest ships it, else `null` (callers fall back cleanly). */
function envFileUrl(manifest: WorldManifest, file: string): string | null {
  return manifest.environment.some((entry) => entry.file === file) ? worldAssetUrl(file) : null;
}

// ── Per-world env files (ROLLOUT §2.2 e) ─────────────────────────────────────

/** A world's own env file: `env/<themeId>/<name>` (the plaza's mask and atlas live under `env/plaza/`). */
export function worldEnvFile(themeId: string, name: string): string {
  return `env/${themeId}/${name}`;
}

/** URL of a world's skyline atlas (its spec's `file`) when the manifest ships it, else `null` (no ring). */
export function skylineUrlFor(manifest: WorldManifest, spec: { file: string }): string | null {
  return envFileUrl(manifest, spec.file);
}

/** URL of a world's story mask (`env/<themeId>/mask.webp`) when the manifest ships it, else `null`. */
export function maskUrlFor(manifest: WorldManifest, themeId: string): string | null {
  return envFileUrl(manifest, worldEnvFile(themeId, 'mask.webp'));
}

/** The plaza story mask (same path as ever: `maskUrlFor(m, 'plaza')`). */
export function plazaMaskUrl(manifest: WorldManifest): string | null {
  return maskUrlFor(manifest, 'plaza');
}

/** The plaza skyline atlas (same path as ever). */
export function plazaSkylineUrl(manifest: WorldManifest): string | null {
  return skylineUrlFor(manifest, { file: PLAZA_SKYLINE_FILE });
}

/**
 * The skyline atlas contract shared by the bake and the ring (SEAT K):
 *
 * - 2048 × 512 RGBA, lossless. R / G / B = the NEAR / MID / FAR silhouette
 *   coverage (255 inside, anti-aliased edge). A = static night window dots,
 *   drawn ONLY inside the near silhouettes and already masked out wherever a
 *   padded data-face rect's sky projection falls (every keep-out pose);
 *   apply A to the near band only.
 * - Every band samples the SAME uv: u = azimuth / 2π with azimuth =
 *   atan2(z, x) wrapped to [0, 2π) (u 0 = +X, east; u 0.25 = +Z, south), and
 *   v = y / layer height (v 0 at the ground, v 1 at the band top). Texture
 *   convention flipY = true: image row 0 is v = 1.
 * - Layer heights put the band tops at `topElevationDeg` seen from the plaza
 *   centre at ground level; silhouettes peak between 0.55 and 1.0 of it.
 */
export const PLAZA_SKYLINE_ATLAS = {
  width: 2048,
  height: 512,
  topElevationDeg: 16,
  layers: [
    { id: 'near', radius: 70, channel: 0 },
    { id: 'mid', radius: 100, channel: 1 },
    { id: 'far', radius: 140, channel: 2 },
  ],
} as const;

/**
 * Height (m) of a skyline band: its top sits at `topElevationDeg` from the
 * world centre at ground level (default the plaza's 16°).
 */
export function skylineLayerHeight(radius: number, topElevationDeg: number = PLAZA_SKYLINE_ATLAS.topElevationDeg): number {
  return radius * Math.tan((topElevationDeg * Math.PI) / 180);
}

/** World point on a skyline band for atlas uv (see `PLAZA_SKYLINE_ATLAS`). */
export function skylineWorldPoint(radius: number, u: number, v: number): [number, number, number] {
  const azimuth = u * Math.PI * 2;
  return [radius * Math.cos(azimuth), v * skylineLayerHeight(radius), radius * Math.sin(azimuth)];
}

// ── Plaza critical environment (LOOK-PLAN §5.1 / D23 byte budget) ─────────────

/**
 * Every manifest-relative ENV file the wired plaza loads for one palette:
 * the HDRI in `format` (fallback law of `hdriFileFor`), the painted
 * `PLAZA_PAINTED_ROLES` sets, the façade kit, the story mask and the skyline
 * atlas — each only when the manifest ships it, exactly as the consumers
 * resolve them. Props are not env files; the byte budget adds the plaza's
 * prop GLBs from `manifest.props`.
 *
 * This is the D23 "complete at reveal" env list: every entry must be
 * fetched and uploaded under the ceremony. A palette switch after reveal
 * would fetch the OTHER role's HDRI, so the warm should hold both roles.
 */
export function plazaCriticalEnvFiles(
  manifest: WorldManifest,
  role: HdriRole,
  format: HdriFormat = PLAZA_HDRI_FORMAT,
): string[] {
  const files = manifestFiles(manifest);
  const out = [hdriFileFor(manifest, role, format)];
  for (const painted of PLAZA_PAINTED_ROLES) out.push(...envTextureSetFiles(manifest, painted));
  if (KIT_BAY_IDS.every((bay) => files.has(kitBayFile(bay)))) out.push(...KIT_BAY_IDS.map(kitBayFile));
  for (const file of [PLAZA_MASK_FILE, PLAZA_SKYLINE_FILE]) if (files.has(file)) out.push(file);
  return out;
}

// ── Rollout atlases and story masks (ROLLOUT §3.3 / §5; ASSETS constants) ────

/**
 * A rollout world's skyline atlas, in `PLAZA_SKYLINE_ATLAS`'s layout and uv
 * law (R / G / B = near / mid / far coverage, flipY, u = azimuth / 2π from
 * +X) with a PER-BAND top elevation (`SkylineSpec.topElevationDeg`). A = 0
 * everywhere: none of the three worlds lights skyline windows, and the shared
 * skyline program cannot switch windows off (`SkylineSpec.windows: false`
 * needs A = 0). Baked by `bake-sakura-skyline.mjs`, `bake-mountain-ridges.mjs`
 * and `bake-clouds-farring.mjs`; a world's `SkylineSpec` copies `file`,
 * the size, `radii` and `topElevationDeg` from here.
 */
export interface WorldSkylineAtlas {
  file: string;
  width: number;
  height: number;
  radii: readonly [number, number, number];
  topElevationDeg: readonly [number, number, number];
}

/** Sakura: three hazed bands of wooded hills, one pagoda roof and a temple-gate silhouette (mid band). */
export const SAKURA_SKYLINE_ATLAS: WorldSkylineAtlas = {
  file: 'env/sakura/skyline.webp',
  width: 2048,
  height: 256,
  radii: [60, 90, 130],
  topElevationDeg: [8, 10, 11],
};

/** Mountain: the ridge atlas that replaces the runtime canvas ridges (r 46 / 74 / 120). */
export const MOUNTAIN_SKYLINE_ATLAS: WorldSkylineAtlas = {
  file: 'env/mountain/skyline.webp',
  width: 2048,
  height: 512,
  radii: [46, 74, 120],
  topElevationDeg: [15, 19, 22],
};

/** Clouds: the far ring of cumulus towers (near), distant isles with waterfall threads (mid) and cloud banks (far). */
export const CLOUDS_SKYLINE_ATLAS: WorldSkylineAtlas = {
  file: 'env/clouds/skyline.webp',
  width: 2048,
  height: 512,
  radii: [90, 130, 170],
  topElevationDeg: [9, 11, 12],
};

/**
 * A rollout world's story mask: `size`² RGBA lossless WebP at
 * `env/<themeId>/mask.webp`, covering the square of side `extentM` metres
 * centred on world (`centre[0]`, `centre[1]`) = (x, z). The uv law is the
 * plaza's (`worldToMaskUv`): u = (x − cx + extentM/2) / extentM,
 * v = (cz − z + extentM/2) / extentM (flipY, +v north); image row 0 is the
 * north edge. Outside the square every channel reads 0 (clamp-to-edge
 * texels are 0 by construction: the bake leaves a zero border). `channels`
 * names what each of R, G, B, A carries; B is always the one FORCED to 0
 * inside every keep-out wedge and dry band (dilated by `dryMarginM`).
 */
export interface WorldMaskLayout {
  file: string;
  size: number;
  centre: readonly [number, number];
  extentM: number;
  dryMarginM: number;
  channels: readonly [string, string, string, string];
}

export const SAKURA_MASK: WorldMaskLayout = {
  file: 'env/sakura/mask.webp',
  size: 512,
  centre: [0, -2],
  extentM: 68,
  dryMarginM: 0.25,
  channels: ['path wear', 'moss and tree AO', 'petal drift (0 in wedges and dry bands)', 'macro noise'],
};

export const MOUNTAIN_MASK: WorldMaskLayout = {
  file: 'env/mountain/mask.webp',
  size: 512,
  centre: [0, 0],
  extentM: 60,
  dryMarginM: 0.25,
  channels: ['trail wear', 'scree and contact', 'lee snow and wet tarn band (0 in wedges and dry bands)', 'macro noise'],
};

export const CLOUDS_MASK: WorldMaskLayout = {
  file: 'env/clouds/mask.webp',
  size: 512,
  centre: [0, 0],
  extentM: 44,
  dryMarginM: 0.25,
  channels: ['worn paths', 'cap-edge contact and tree AO', 'flower specks (0 in wedges and dry bands)', 'macro noise'],
};

/** The sakura painted grass-clump card (`bake-grass-card.mjs`): 256² RGBA, blade base at v 0. */
export const SAKURA_GRASS_CARD_FILE = 'env/sakura/grass-card.webp';
