/**
 * The Content-Security-Policy builders (issue #37, docs/security-patterns.md "Content-Security-Policy"). A plain `.mjs`
 * module because `next.config.mjs` (the static policy) and `src/proxy.ts` (the per-request nonce policy) both import it.
 *
 * Two policies share every directive except `script-src`:
 *  - the static policy is what `next.config.mjs` sends on every response. Its `script-src` still allows
 *    `'unsafe-inline'`, so a page keeps working however the nonce rollout goes;
 *  - the nonce policy drops `'unsafe-inline'` for a per-request `'nonce-...'` plus `'strict-dynamic'`. The proxy sends
 *    it as `Content-Security-Policy-Report-Only`, or as the enforced `Content-Security-Policy` when `CSP_ENFORCE` is set.
 */

/** The report endpoint (`src/app/api/csp-report/route.ts`). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The Reporting API endpoint name that `report-to` refers to; defined by the `Reporting-Endpoints` header. */
export const CSP_REPORT_GROUP = 'csp';

const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const FALSE_VALUES = new Set(['', '0', 'false', 'off', 'no']);

/**
 * Whether the nonce policy is enforced instead of only reported: `CSP_ENFORCE` set to anything but an off value.
 * @param {Record<string, string | undefined>} [env]
 */
export function cspEnforced(env = process.env) {
  return !FALSE_VALUES.has((env.CSP_ENFORCE ?? '').trim().toLowerCase());
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
 * Every directive except `script-src` and `upgrade-insecure-requests`.
 * @param {{ dev: boolean }} options
 */
function commonDirectives({ dev }) {
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
    ...(dev ? [] : ['upgrade-insecure-requests']),
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
 * The policy `next.config.mjs` sends on every response (the enforced policy while `CSP_ENFORCE` is off).
 * @param {{ dev: boolean }} options
 */
export function buildStaticPolicy({ dev }) {
  // Next.js + React 19 dev mode (Fast Refresh, error overlay, stack reconstruction) needs eval(); production does not.
  const scriptSrc = dev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${VERCEL_SCRIPTS}`
    : `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: ${VERCEL_SCRIPTS}`;
  return withScriptSrc(commonDirectives({ dev }), scriptSrc);
}

/**
 * The per-request policy: scripts run only with this request's nonce, or when a nonced script loaded them.
 * 'self' and the Vercel host stay for browsers that do not know 'strict-dynamic' (it makes the others ignore host lists).
 * @param {{ nonce: string, dev: boolean }} options
 */
export function buildNoncePolicy({ nonce, dev }) {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('CSP nonce must be base64');
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''} ${VERCEL_SCRIPTS}`;
  return withScriptSrc(commonDirectives({ dev }), scriptSrc);
}
