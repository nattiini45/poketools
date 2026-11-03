import { existsSync } from 'node:fs';
import { examplePackProductionWarning } from './scripts/format-pack-notice.mjs';
import { CSP_REPORT_GROUP, CSP_REPORT_PATH, PROXY_SKIPPED_SOURCES, buildStaticPolicy, isVercelPreview } from './src/lib/security/csp-policy.mjs';

// Format pack (docs/format-packs.md): `@format-pack` resolves to exactly one pack entry. The
// private pack (companion overlay, gitignored; fetched by scripts/fetch-private-assets.mjs on the
// maintainers' Vercel build) wins when it is on disk; FORMAT_PACK=example forces the public example
// pack; FORMAT_PACK=private makes a missing private pack a hard error (set for Production). Any
// other FORMAT_PACK value is an error. Turbopack only: a `webpack` key would make `next build` fail.
const PRIVATE_PACK = './src/format-packs/private/index.ts';
const EXAMPLE_PACK = './src/format-packs/example/index.ts';
function activeFormatPack() {
  const mode = (process.env.FORMAT_PACK ?? '').trim();
  if (mode !== '' && mode !== 'example' && mode !== 'private') {
    throw new Error(`[format-pack] FORMAT_PACK must be unset, 'example' or 'private' (got '${mode}')`);
  }
  if (mode === 'example') return EXAMPLE_PACK;
  const hasPrivate = existsSync(new URL(PRIVATE_PACK, import.meta.url));
  if (mode === 'private' && !hasPrivate) {
    throw new Error('[format-pack] FORMAT_PACK=private but src/format-packs/private/index.ts is missing');
  }
  return hasPrivate ? PRIVATE_PACK : EXAMPLE_PACK;
}
const FORMAT_PACK_ENTRY = activeFormatPack();
// Pack extensions (docs/format-packs.md, "Pack extensions"): `@pack-extensions` is the active
// pack's `extensions/index.ts`, picked with the pack itself so the two can never disagree.
const PACK_EXTENSIONS_ENTRY = FORMAT_PACK_ENTRY.replace(/index\.ts$/, 'extensions/index.ts');
if (!existsSync(new URL(PACK_EXTENSIONS_ENTRY, import.meta.url))) {
  throw new Error(`[format-pack] ${PACK_EXTENSIONS_ENTRY} is missing (a pack without extensions exports {})`);
}
// The Vercel build log is checked against this line.
console.log(`[format-pack] using ${FORMAT_PACK_ENTRY.includes('/private/') ? 'private' : 'example'} pack`);
// A production build that fell back to the example pack (FORMAT_PACK unset) warns: its placeholder
// numbers would be written into new point-buy seasons. FORMAT_PACK=example acknowledges it (CI).
const examplePackWarning = examplePackProductionWarning({
  pack: FORMAT_PACK_ENTRY.includes('/private/') ? 'private' : 'example',
  formatPackEnv: process.env.FORMAT_PACK,
  nodeEnv: process.env.NODE_ENV,
});
if (examplePackWarning) console.warn(examplePackWarning);

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

// The static policy, for the paths the proxy does not run for. A page gets its policy (and its nonce) from src/proxy.ts,
// and must not get one here: on Vercel a `Content-Security-Policy` header of this config reaches the render in place of
// the proxy's, and Next.js then finds no nonce. Both are built by src/lib/security/csp-policy.mjs
// (docs/security-patterns.md, "Content-Security-Policy").
const contentSecurityPolicyHeaders = [{ key: 'Content-Security-Policy', value: buildStaticPolicy({ dev: isDev, previewToolbar: isVercelPreview() }) }];

const RULES_WITH_OWN_POLICY = new Set(['/api/:path*', '/sw.js', '/sw-routing.js']);

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    // Names the endpoint that the policy's `report-to` directive points at.
    key: 'Reporting-Endpoints',
    value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  },
];

// API-specific headers: prevent search-engine indexing but allow route-level
// Cache-Control (e.g., broadcast overlays, avatar manifest, proxy-image).
// Routes needing no-cache should set it explicitly in the response.
const apiHeaders = [
  {
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow',
  },
];

// The service worker (public/sw.js) names its cache after this id, so a deploy replaces the previous deploy's caches.
// Derived here, not a variable anyone sets: Vercel provides the commit SHA, a local build is 'dev'.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim().slice(0, 12) || 'dev';

const nextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Web Push sender (src/lib/push/send.ts, docs/push.md): a Node-only CommonJS package with native `crypto`/`https`
  // use. It stays an external require on the server instead of being bundled; it never reaches a client bundle.
  serverExternalPackages: ['web-push'],
  // CI type-checks once, in its `typecheck:example` step, and sets this on the build step only. Never key it off `CI`:
  // Vercel sets that too, and a production build there keeps its type gate.
  typescript: { ignoreBuildErrors: process.env.CI_SKIP_BUILD_TYPECHECK === '1' },
  turbopack: {
    resolveAlias: {
      '@format-pack': FORMAT_PACK_ENTRY,
      '@pack-extensions': PACK_EXTENSIONS_ENTRY,
      // Pack validation runs on the server only; client bundles get the identity (no zod).
      '@/lib/format-pack/validate': { browser: './src/lib/format-pack/validate.browser.ts' },
    },
  },
  // C-034: hide the dev-mode route indicator entirely (Next 16 shape —
  // node_modules/next/dist/docs/.../devIndicators.md: `devIndicators: false`;
  // the old appIsrStatus/buildActivity options were removed in v16).
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.pokemondb.net',
        pathname: '/sprites/**',
      },
      {
        protocol: 'https',
        hostname: 'play.pokemonshowdown.com',
        pathname: '/sprites/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/avatars/**',
      },
    ],
  },
  async headers() {
    return [
      // The worker and the routing script it imports: a stale copy of either would run the previous deploy's policy.
      ...['/sw.js', '/sw-routing.js'].map((source) => ({
        source,
        headers: [
          ...securityHeaders,
          ...contentSecurityPolicyHeaders,
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      })),
      {
        source: '/api/:path*',
        headers: [...securityHeaders, ...contentSecurityPolicyHeaders, ...apiHeaders],
      },
      // The rest of the paths the proxy skips (assets, images, public folders).
      ...PROXY_SKIPPED_SOURCES.filter((source) => !RULES_WITH_OWN_POLICY.has(source)).map((source) => ({
        source,
        headers: contentSecurityPolicyHeaders,
      })),
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
