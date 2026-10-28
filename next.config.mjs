import { existsSync } from 'node:fs';
import { examplePackProductionWarning } from './scripts/format-pack-notice.mjs';

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

// Next.js + React 19 dev mode (Fast Refresh, error overlay, cross-realm stack
// reconstruction) requires eval(). Production must keep the strict policy.
//
// The 3D draft room (three.js) additionally needs:
//  - blob:        — DRACOLoader spawns its decode worker from a blob: URL, and
//                   some browsers check that worker script against script-src.
//  - wasm-unsafe-eval (prod) — the Draco decoder and the KTX2/Basis transcoder
//                   (route-world textures) instantiate WebAssembly.
//                   (dev's 'unsafe-eval' already permits WASM.)
//
// The EvoLiga route world fetches GLBs, KTX2 textures, HDRIs and manifest.json
// from the Supabase Storage public bucket (NEXT_PUBLIC_WORLD_ASSETS_URL); that
// origin is already covered by https://*.supabase.co in img-src / connect-src.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://va.vercel-scripts.com"
  : "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://va.vercel-scripts.com";

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
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://img.pokemondb.net https://play.pokemonshowdown.com https://*.supabase.co",
      "font-src 'self'",
      // three.js DRACOLoader / MeshoptDecoder spawn their decode workers from blob: URLs.
      // Without blob: here, worker-src falls back to script-src and the workers are blocked,
      // which breaks loading of the 3D draft room models.
      "worker-src 'self' blob:",
      // three.js loads GLB textures (WebP) via fetch(blob:) in production builds, so
      // connect-src must allow blob: or every texture fails with a CSP NetworkError.
      // troika-three-text (drei <Text>) additionally fetches its unicode font-fallback
      // resolver from cdn.jsdelivr.net and fallback glyphs from fonts.gstatic.com.
      "connect-src 'self' blob: https://cdn.jsdelivr.net https://fonts.gstatic.com https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
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

const nextConfig = {
  poweredByHeader: false,
  // Web Push sender (src/lib/push/send.ts, docs/push.md): a Node-only CommonJS package with native `crypto`/`https`
  // use. It stays an external require on the server instead of being bundled; it never reaches a client bundle.
  serverExternalPackages: ['web-push'],
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
      {
        source: '/sw.js',
        headers: [
          ...securityHeaders,
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [...securityHeaders, ...apiHeaders],
      },
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
