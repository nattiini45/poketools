/**
 * The Content-Security-Policy builders (issue #37, docs/security-patterns.md "Content-Security-Policy"). A plain `.mjs`
 * module because `next.config.mjs` (the static policy) and `src/proxy.ts` (the per-request nonce policy) both import it.
 *
 * Two policies share every directive except `script-src`:
 *  - the static policy is the enforced default. Its `script-src` still allows `'unsafe-inline'`, so a page keeps
 *    working however the nonce rollout goes. `next.config.mjs` sends it on the paths the proxy skips, the proxy on pages;
 *  - the nonce policy drops `'unsafe-inline'` for a per-request `'nonce-...'` plus `'strict-dynamic'`. The proxy sends
 *    it as `Content-Security-Policy-Report-Only`, or as the enforced `Content-Security-Policy` when `CSP_ENFORCE` is set.
 */

/** The report endpoint (`src/app/api/csp-report/route.ts`). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The Reporting API endpoint name that `report-to` refers to; defined by the `Reporting-Endpoints` header. */
export const CSP_REPORT_GROUP = 'csp';

/**
 * The `next.config.mjs` header sources the proxy does not run for: the complement of `config.matcher` in `src/proxy.ts`
 * (a test holds the two together). These get the static policy from `next.config.mjs`; a page gets it from the proxy,
 * because a `Content-Security-Policy` header from the config would shadow the proxy's one in the render's request.
 */
export const PROXY_SKIPPED_SOURCES = [
  '/api/:path*',
  '/_next/static/:path*',
  '/_next/image',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/avatar/:path*',
  '/basis/:path*',
  '/characters/:path*',
  '/fonts/:path*',
  '/models/:path*',
  '/pwa/:path*',
  '/textures/:path*',
  '/offline.html',
  '/sw.js',
  '/sw-routing.js',
];

const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const FALSE_VALUES = new Set(['', '0', 'false', 'off', 'no']);

/**
 * Whether the nonce policy is enforced instead of only reported: `CSP_ENFORCE` set to anything but an off value.
 * @param {Record<string, string | undefined>} [env]
 */
export function cspEnforced(env = process.env) {
  return !FALSE_VALUES.has((env.CSP_ENFORCE ?? '').trim().toLowerCase());
}

/** @param {string} nonce */
function assertNonce(nonce) {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('CSP nonce must be base64');
}

/** A fresh nonce: 16 random bytes, base64. Never reused across requests. */
export function newNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// The 3D draft room (three.js) needs:
//  - blob: in worker-src / connect-src: DRACOLoader and MeshoptDecoder spawn their decode workers from blob: URLs, and
//    production builds load GLB textures (WebP) through fetch(blob:);
//  - 'wasm-unsafe-eval': the Draco decoder and the KTX2/Basis transcoder (route-world textures) instantiate WebAssembly
//    (dev's 'unsafe-eval' already permits WASM);
//  - troika-three-text (drei <Text>) fetches its unicode font-fallback resolver from cdn.jsdelivr.net and fallback
//    glyphs from fonts.gstatic.com.
// The route world fetches GLBs, KTX2 textures, HDRIs and the manifest from the Supabase Storage public bucket
// (NEXT_PUBLIC_WORLD_ASSETS_URL); https://*.supabase.co in img-src / connect-src covers that origin.
//
// style-src keeps 'unsafe-inline': React inline `style` attributes and the overlay keyframes `<style>` cannot carry a nonce.
const VERCEL_SCRIPTS = 'https://va.vercel-scripts.com';

/**
 * Every directive except `script-src`. `upgrade-insecure-requests` is only valid in an enforced policy: a browser
 * logs a console error for it in a report-only one.
 * @param {{ dev: boolean, enforced: boolean }} options
 */
function commonDirectives({ dev, enforced }) {
  return [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.pokemondb.net https://play.pokemonshowdown.com https://*.supabase.co",
    "font-src 'self'",
    "worker-src 'self' blob:",
    `connect-src 'self' blob: https://cdn.jsdelivr.net https://fonts.gstatic.com https://*.supabase.co wss://*.supabase.co ${VERCEL_SCRIPTS}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev || !enforced ? [] : ['upgrade-insecure-requests']),
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ];
}

/**
 * Puts `script-src` right after `default-src`, so the header reads in the order the policy was always written in.
 * @param {string[]} directives
 * @param {string} scriptSrc
 */
function withScriptSrc(directives, scriptSrc) {
  const [first, ...rest] = directives;
  return [first, scriptSrc, ...rest].join('; ');
}

/**
 * The enforced policy while `CSP_ENFORCE` is off.
 *
 * `next.config.mjs` sends it, without a nonce, on the paths the proxy does not run for. The proxy sends it, with the
 * request's nonce, on pages. Next.js stamps its own scripts with the nonce it finds in the request's
 * `Content-Security-Policy` header (the report-only header only when that one is absent), and a deployment platform
 * can hand the render the response header of that name instead of the proxy's request override (Vercel does: the
 * static policy of `next.config.mjs` reached the render and no Next script got a nonce). So the enforced header has to
 * carry the nonce itself, and a nonce in `script-src` would make a browser ignore its `'unsafe-inline'` (the policy
 * would stop being the one that is already in force). With a nonce, `Script-Src` is therefore written with a capital:
 * directive names are case-insensitive to a browser, but Next.js only recognises a lowercase `script-src` and otherwise
 * reads `default-src`, where the nonce goes. A nonce in `default-src` changes nothing for the directives that fall back
 * to it (`frame-src`, `media-src`, ...): a nonce-source only ever matches scripts and styles, and both have their own
 * directive here.
 * @param {{ dev: boolean, nonce?: string }} options
 */
export function buildStaticPolicy({ dev, nonce }) {
  // Next.js + React 19 dev mode (Fast Refresh, error overlay, stack reconstruction) needs eval(); production does not.
  const sources = dev
    ? `'self' 'unsafe-inline' 'unsafe-eval' blob: ${VERCEL_SCRIPTS}`
    : `'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: ${VERCEL_SCRIPTS}`;
  const directives = commonDirectives({ dev, enforced: true });
  if (nonce === undefined) return withScriptSrc(directives, `script-src ${sources}`);
  assertNonce(nonce);
  const [, ...rest] = directives;
  return [`default-src 'self' 'nonce-${nonce}'`, `Script-Src ${sources}`, ...rest].join('; ');
}

/**
 * The per-request policy: scripts run only with this request's nonce, or when a nonced script loaded them.
 * 'self' and the Vercel host stay for browsers that do not know 'strict-dynamic' (it makes the others ignore host lists).
 * @param {{ nonce: string, dev: boolean, enforce?: boolean }} options `enforce`: the policy is sent as the enforced
 *   header (`CSP_ENFORCE`), not as report-only.
 */
export function buildNoncePolicy({ nonce, dev, enforce = false }) {
  assertNonce(nonce);
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''} ${VERCEL_SCRIPTS}`;
  return withScriptSrc(commonDirectives({ dev, enforced: enforce }), scriptSrc);
}
