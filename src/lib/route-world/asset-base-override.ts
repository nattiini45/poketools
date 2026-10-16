/**
 * D42 (ENGINE/ASSET step, commit G): the dev-only asset-arm override.
 *
 * `?routeDebug=1&routeAssetBase=<arm>` points every world asset fetch of one
 * page (the manifest, every GLB, every env file) at an asset mirror, so a
 * capture block can serve arm A and arm B from ONE tree without a restart:
 *
 *  - `a`            the configured base (`NEXT_PUBLIC_WORLD_ASSETS_URL`, or
 *                   the local mirror) — the explicit "no override" arm;
 *  - `d42`          mirror B with the frozen cast metrics;
 *  - `d42c`         mirror B with the flipped cast metrics (block C);
 *  - `d42m`         the flipped metrics plus the material arm (block M);
 *  - `cand-<recipe>` an S0 candidate mirror (e.g. `cand-hq10`).
 *
 * Every arm but `a` lives under the local mirror root (`/models/world/<arm>`,
 * inside the ignored `public/models/world/`), never on the bucket.
 *
 * The parse is CLIENT-SIDE ONLY and routeDebug-only: the server render and a
 * production build always resolve the configured base. No server-rendered
 * markup carries an asset URL (every consumer sits inside the client-only
 * route canvas, `ssr: false`), so an override can never split a hydration.
 */

/**
 * D42 commit P: the manifest file every mirror arm directory holds. Each arm
 * but `a` is a frozen bake output (`compress-mirror.mjs`, `bake-manifest.mjs
 * --metrics`, `material-lint.mjs`; `<arm>.sha256` lists `./manifest.json`), so
 * an arm page reads `manifest.json` from its arm directory, while the
 * configured base (the `a` arm included) reads the shipped
 * `WORLD_MANIFEST_FILE` (`model-manifest.ts`, `worldManifestFile`).
 */
export const ROUTE_ASSET_ARM_MANIFEST_FILE = 'manifest.json';

/** The fixed mirror arms (the candidate arms are a pattern, see `isRouteAssetArm`). */
export const ROUTE_ASSET_ARMS = ['a', 'd42', 'd42c', 'd42m'] as const;
export type FixedRouteAssetArm = (typeof ROUTE_ASSET_ARMS)[number];

/** `cand-<recipe>`: lowercase letters and digits, optionally dash-joined; short. */
const CANDIDATE_ARM = /^cand-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANDIDATE_ARM_MAX = 32;

/** Whether `value` names an arm the override accepts (the whitelist). */
export function isRouteAssetArm(value: string): boolean {
  if ((ROUTE_ASSET_ARMS as readonly string[]).includes(value)) return true;
  return value.length <= CANDIDATE_ARM_MAX && CANDIDATE_ARM.test(value);
}

/**
 * The arm a query string asks for, or null: only with `routeDebug=1`, only a
 * whitelisted value (anything else is ignored, never interpolated into a URL).
 */
export function parseRouteAssetArm(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get('routeDebug') !== '1') return null;
  const arm = params.get('routeAssetBase');
  if (arm === null) return null;
  return isRouteAssetArm(arm) ? arm : null;
}

/**
 * The base URL an arm resolves to. `a` is the configured base itself (null:
 * the caller keeps it); every other arm is a directory of the local mirror.
 */
export function routeAssetArmBase(arm: string, localBase: string): string | null {
  if (arm === 'a') return null;
  return `${localBase.replace(/\/+$/, '')}/${arm}`;
}

interface OverrideState {
  /** The arm read from the URL (null: none or ignored). */
  arm: string | null;
  /** The base it resolves to (null: the configured base). */
  base: string | null;
}

/** Module state: `undefined` until the first client read installs it. */
let installed: OverrideState | undefined;

/** Server render or production build: the override never applies. */
function overrideForbidden(): boolean {
  return typeof window === 'undefined' || process.env.NODE_ENV === 'production';
}

/**
 * Read the override from the page URL once (client, non-production only).
 * Idempotent: the first call wins for the page's life, so every asset URL of
 * the page resolves against one base. Called by `getWorldAssetBase` on its
 * first client read (always inside the client-only canvas, i.e. before any
 * world fetch) and callable earlier by a world root.
 */
export function installRouteAssetBaseOverride(localBase: string): void {
  if (installed !== undefined || overrideForbidden()) return;
  let search = '';
  try {
    search = window.location.search;
  } catch {
    search = '';
  }
  const arm = parseRouteAssetArm(search);
  installed = { arm, base: arm === null ? null : routeAssetArmBase(arm, localBase) };
}

/**
 * The overriding base for this page, or null (no override, the `a` arm, the
 * server, production). `localBase` is the mirror root the arms live under.
 */
export function routeAssetBaseOverride(localBase: string): string | null {
  if (overrideForbidden()) return null;
  installRouteAssetBaseOverride(localBase);
  return installed?.base ?? null;
}

/** The arm in force for this page (trace/readout), null when none. */
export function routeAssetArm(): string | null {
  if (overrideForbidden()) return null;
  return installed?.arm ?? null;
}

/** Test seam: forget the installed override. */
export function resetRouteAssetBaseOverrideForTests(): void {
  installed = undefined;
}
