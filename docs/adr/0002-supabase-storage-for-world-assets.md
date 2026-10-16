---
status: accepted
date: 2026-09-02
---

# World assets are hosted in a Supabase Storage public bucket

The plaza needs every Pokémon form a league roster can reach (base, stage 2, stage 3 for ~92 lines, roughly 250 GLBs at 60–100 MB) plus KTX2 texture sets and HDRIs. The 92 base-stage GLBs currently live untracked under `public/models/`, which does not survive a fresh clone or a Vercel build and would bloat git if committed. We decided to host all world assets in a Supabase Storage public bucket (`world-assets`), uploaded by a one-time script from a local processing pipeline, with a generated `manifest.json` (dexId, form, kb, `heightm`, bounds, clip names) that the client fetches once. Supabase is already the project's data layer, the bucket is served through its CDN, and no build-time download step is needed on Vercel.

## Considered options

- `public/` gitignored + postinstall download: rejected; every Vercel build would re-download ~100 MB from a third-party GitHub raw URL.
- Runtime fetch from `raw.githubusercontent.com`: rejected; third-party uptime, no KTX2 pipeline, CSP widening for an origin we do not control.
- Vercel Blob: viable, rejected only because Supabase is already provisioned and the service-role upload path already exists in `src/lib/supabase/client.ts` conventions.

## Consequences

- `next.config.mjs` CSP gains the bucket origin in `connect-src` and `img-src`; `.env.example` gains `NEXT_PUBLIC_WORLD_ASSETS_URL`.
- `src/lib/route-world/model-manifest.ts` stops being a hand-maintained table and becomes a loader over the generated manifest; `heightm` is baked at upload time by a server-side script using `new Generations(Dex)`, so no runtime species-size API is needed.
- Uploading requires `SUPABASE_SERVICE_ROLE_KEY` locally; the script never runs in the browser or in CI.

## Update (2026-10, D42)

The shipped manifest is now `manifest.v3.json` (`WORLD_MANIFEST_FILE` in `src/lib/route-world/model-manifest.ts`), not `manifest.json`. It describes the D42 asset set: lossless meshopt GLBs under content-hashed names with a one-year cache, while the manifest itself is uploaded last with `cacheControl: 0` and fetched with `cache: 'no-cache'`. The published `manifest.json` is the v2 descriptor that older deployed builds read and is never rewritten; only the debug mirror arms (`?routeAssetBase=`) read a `manifest.json`. The publish flow is `scripts/world-assets/README.md`; the runtime summary is `docs/worlds.md` ("World assets").
