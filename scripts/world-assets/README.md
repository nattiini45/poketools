# World-asset pipeline

Produces every asset the EvoLiga route world loads from the `world-assets`
Supabase Storage bucket (decision: `docs/adr/0002`). Run the steps in
order; each one is idempotent and skips work it has already done.

```bash
node scripts/world-assets/download-pokemon-models.mjs   # Pokemon-3D-api → .cache/raw
node scripts/world-assets/env-assets.mjs                # Poly Haven → out/env (HDRIs, texture sets)
node scripts/world-assets/kit-assets.mjs                # Blender façade kit → out/env/kit
node scripts/world-assets/props.mjs --dry-run           # Meshy hero props: prompts + credit table
node scripts/world-assets/props.mjs                     #   probe (lamp post) — then --all once it passes
node scripts/world-assets/transform.mjs                 # .cache/raw + .cache/props → out/models + out/props
node scripts/world-assets/bake-manifest.mjs --mirror    # out/manifest.json (+ public/models/world mirror)
# R1 (DRY RUN): the hashed publish set + plan, then its offline checks
node scripts/world-assets/upload-supabase.mjs --from-mirror --manifest-name manifest.v3.json --plan-dir <R1>
node scripts/world-assets/publish-verify.mjs --plan-dir <R1> --manifest-name manifest.v3.json --v2-manifest <published v2 manifest.json>
# R2 (LIVE, owner's go only): refuses unless the set equals R1's plan
node scripts/world-assets/upload-supabase.mjs --from-mirror --manifest-name manifest.v3.json --live --expect-plan <R1>
```

Then set `NEXT_PUBLIC_WORLD_ASSETS_URL` (printed by the upload step) in the
Vercel production env only. Without it the app reads the local mirror at
`/models/world`, which is what dev servers and captures must use (the
`.claude/local-assets.cjs` preload pins it; AGENTS.md: automation never
spends the Supabase quota).

The local mirror's manifests (`public/models/world/manifest.v3.json` and the v2
`manifest.json`) list a league's figure pool, so they are untracked (git-ignored):
a checkout does not include them. A maintainer keeps them in the private companion
overlay, which tracks both paths, and restores missing copies with
`git --git-dir=<overlay> checkout -- public/models/world/manifest.json public/models/world/manifest.v3.json`; anyone else bakes their own world-assets set with this pipeline. The roster roots come from the private pack's `world-roster.json`
(`lib.mjs` `rosterRootSpecies`), else from the example pack's list. Without the
manifests the tests that read them skip, and the route world renders with sprite
billboards instead of 3D figures and no props (the loader falls back to an empty
manifest).

## Publishing (DATA-PLAN fix 7, D37)

`upload-supabase.mjs` is a **dry run by default**: it lists the publish set,
writes the published manifest and `publish-plan.json` to
`.cache/publish/` (or `--plan-dir`), reads no env and creates no client. A
real upload needs `--live --expect-plan <R1 plan dir>`, and runs only with the
owner's go at upload time (ENGINE-ASSET-PLAN §7: R1 dry run, then R2 live). It
refuses unless the recomputed set equals R1's plan (entries and manifest by
sha256) and passes publish-verify's plan checks; `--only` is dry-run only.
`publish-verify.mjs` needs `--v2-manifest <the published v2 manifest.json>`
(fetched by a maintainer) for a new manifest name; `--no-v2-check` runs without it
and marks the verdict as not valid for R1.
It exits non-zero when the source has no manifest (for example the unbuilt
`out/`), when the manifest names a file that is missing, or when the set is
empty.

The publish set (`publish-set.mjs`) leaves the source untouched; only the
bucket gets new names:

- Every file the manifest references is uploaded as
  `<dir>/<name>.<sha256[:12]>.<ext>` with `cacheControl: 31536000`.
- The published manifest is `manifest.v3.json` (`--manifest-name`;
  `WORLD_MANIFEST_FILE` in `src/lib/route-world/model-manifest.ts`). It points
  `figures[].file` and `props[].file` at those names, and is uploaded
  **last**, with `cacheControl: 0`. The app fetches it with
  `cache: 'no-cache'`, so the browser revalidates it by ETag. From the
  promoted mirror its source is `manifest.v3.json`; the v2 `manifest.json`
  beside it is never published.
- No object named `manifest.json` is ever written: the live v2 manifest stays
  what older deployed builds read. `publish-verify.mjs` fails a plan that would
  write it, and a set under that name carrying a meshopt GLB is refused, dry
  run included.
- `environment[].file` stays logical, because `src/lib/route-world/world-env.ts`
  resolves env files by logical name. Each env file is therefore also uploaded
  under its logical name with the one-day cache (`compat`). The manifest's
  `files` map (logical → hashed) is ready for when world-env resolves through
  it; then publish with `--no-env-compat`.
- `ATTRIBUTION.md` is uploaded under its own name; unreferenced files are
  skipped and listed.

## Requirements

- `npm install` (dev deps `@gltf-transform/*`, `sharp`, `draco3dgltf`, and
  `meshoptimizer` 1.2.0, D49 — the encoder, decoder and simplifier every
  script takes from `meshopt-codec.mjs`; a test pins the version).
- KTX-Software `toktx` for KTX2 textures — user-local install is fine
  (`%LOCALAPPDATA%\KTX-Software\bin`), or set `KTX_BIN`. Without it the
  transform falls back to WebP (`--webp` forces that). **The shipped mirror
  was built without it: it holds 0 KTX2 textures, and 427 of its 446 GLBs
  carry WebP** (D42 assets reader, 2026-10-04).
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
  for the upload step only.

## What the transform does

- Decodes Draco so the browser never needs the Draco decoder. (The D42
  meshopt arms below DO need the meshopt decoder: `figure-loader.ts` wires
  three's `MeshoptDecoder`, plan item N1.)
- Keeps at most four clips per figure — `idle`, `idle2`, `walk`, `run` — and
  renames them; game rips carry 20–60 clips and that data, not textures, is
  what made a 5 MB Fuecoco.
- Textures ≤ 1024²: ETC1S for colour and UASTC for normal/roughness/occlusion
  where `toktx` exists, WebP otherwise (the shipped case, see Requirements).
  Figures above 1.5 MB are retried at 512².
- Quantizes normals and texcoords; positions stay float so skins are exact.
  The shipped files do not declare `KHR_mesh_quantization` (400 of 446 fail
  the validator on `MESH_PRIMITIVE_ATTRIBUTES_ACCESSOR_INVALID_FORMAT`; three
  loads them anyway); the D42 encode declares it.

## Manifest

`out/manifest.json` → `{ version, generatedAt, figures[], props[], environment[], missingForms[] }`.
Each figure: `dexId`, `form` (`regular|alolan|galarian|hisuian|paldean`),
`species`, `aliases` (cosmetic formes that share the file), `file`,
`sourceForm` (`regular` when a regional file was missing upstream), `kb`,
`heightm` (PokéAPI, metres; `null` if unknown), `bounds` (rest pose, model
units), `clips`, `triangles`.
Each prop (C-030): `name` (slug stations request), `file`, `kb`,
`triangles` (≤ 40 k bar), `bounds`.

Heights come from PokéAPI because `@pkmn/dex` dropped `heightm`; they are
cached in `.cache/heights.json`.

## D42: meshopt arms and the outlier decimation (ENGINE-ASSET-PLAN §4 SEAT ASSET)

Mirror A (`public/models/world/`) stays the originals. Every arm is a full
mirror (GLBs, byte-identical `env/`, `ATTRIBUTION.md`, `manifest.json`) in
its own ignored directory `public/models/world/<arm>/`, selected in dev by
`?routeDebug=1&routeAssetBase=<arm>` and in production by the env base:

| arm | what |
|---|---|
| `cand-hq10`, `cand-high8`, `cand-medium`, `cand-nq` | the S0 candidate recipes over mirror A |
| `d42` | B, metrics FROZEN (`castKb` and `triangles` = A's): since ASSET-11 the index-exact lossless `nqx` over all of A (D51: no decimation), so every decoded accessor, index buffers included, equals A's |
| `cand-nq-tri` | the previous B: lossless `nq` with TRIANGLES-mode index views (corners rotated; the frozen `cand-nq-tri.sha256`) |
| `d42c` | the same files, metrics FLIPPED (the decimated files' real `triangles` and A-encoding `castKb`) |
| `d42m` | the material arm: B (`d42`, lossless `nqx`) with JSON-only material fixes (BIN chunks byte-identical); metrics as `d42` + a `d42.materials` note |
| `a0` | mirror A + the 0bbe838a `manifest.json`, sha256-listed (`a0.sha256`): the production "before" base |

```bash
# A1: decimate the 13 static outliers to ~36 k (A encoding; writes cast-kb.json, a1-report.json)
node scripts/world-assets/decimate-figures.mjs --src public/models/world --out <scratch>/decimated
# the four candidate recipes (hand-composed meshopt; scene volume; env byte-identical)
node scripts/world-assets/compress-mirror.mjs --recipe hq10 --src public/models/world --out public/models/world/cand-hq10
# B = the A0-chosen recipe + the decimated overlay (+ per-file recipes A0 asks for)
node scripts/world-assets/compress-mirror.mjs --recipe hq10 --src public/models/world --out public/models/world/d42 \
  --overlay <scratch>/decimated --recipe-for models/regular/288.glb=nq
# B since D51 + ASSET-11: the index-exact lossless recipe over all of A (INDICES-mode index views)
node scripts/world-assets/compress-mirror.mjs --recipe nqx --src public/models/world --out <scratch>/nqx --jobs 4
node scripts/world-assets/d42-parity.mjs --recipe nqx --src public/models/world --arm <scratch>/nqx --jobs 4
# the arm manifests (additive kb / castKb / gpuKb / drawParts; d42.encode = the stamp's recipe and index mode)
node scripts/world-assets/bake-manifest.mjs --metrics frozen --dir public/models/world/d42 --cast-kb <scratch>/decimated/cast-kb.json --overlay <scratch>/decimated
node scripts/world-assets/bake-manifest.mjs --metrics flip --dir public/models/world/d42c --cast-kb <scratch>/decimated/cast-kb.json --overlay <scratch>/decimated
# A0 parity of an arm against A (the decimated files against their intermediates)
node scripts/world-assets/d42-parity.mjs --recipe hq10 --src public/models/world --arm public/models/world/d42 --overlay <scratch>/decimated
# the material arm's lint (dry run)
node scripts/world-assets/material-lint.mjs --src public/models/world --report <scratch>/material-lint.json
# the material arm d42m: JSON-only fixes over the frozen B (whole mirror copied; _encode.json lists every rewrite)
node scripts/world-assets/material-lint.mjs --src public/models/world/d42 --apply --mirror \
  --fix metal,blend-opaque,transmission,single-sided,unlit-color --out public/models/world/d42m \n  [--except file#index,... --except-reasons <reasons.json>]   # judged-out materials keep d42's JSON; reasons land in _encode.json
node scripts/world-assets/bake-manifest.mjs --metrics frozen --dir public/models/world/d42m --materials public/models/world/d42m/_encode.json
node scripts/world-assets/material-lint.mjs --check public/models/world/d42m
```

- **The material fixes are JSON-chunk patches** (`material-lint.mjs`): they
  apply to a meshopt encode directly, so `d42m` keeps `d42`'s BIN chunks byte
  for byte. The metal rule reads an OMITTED `metallicFactor`, which only the
  JSON shows (mirror A and `d42` carry the same material JSON). `single-sided`
  follows the measured translucent-shell rule (`SHELL_RULE`; evidence per
  material in the report); `unlit-color` drops an all-white `COLOR_0` from an
  unlit primitive (R50 item 4).

- **The encode is composed by hand**, never through `meshopt()` (which clamps
  normals to 8 bits and always reorders): dequantize POSITION where needed →
  optional `reorder` → `quantize` with explicit bits at `quantizationVolume:
  'scene'` (the per-mesh default clones skins) → `EXT_meshopt_compression`
  QUANTIZE or FILTER. `--no-reorder` / `--no-reorder-blend` re-encode a
  TRANSPARENT-ORDER file; `--recipe-for file=recipe` gives one file its own
  recipe (recorded per row in `_encode.json`). A meshopt source is refused.
- **Index views** (ASSET-11): the TRIANGLES index codec gltf-transform picks
  for a triangle list may rotate a triangle's corners (same triangle, winding
  and order), which flipped a z-fighting pupil (93.glb) at one station.
  `nqx` writes every index view in INDICES mode (`EXTMeshoptCompressionIndexExact`,
  about +3 % bytes over `nq`): the decoded index buffers are A's byte for
  byte. The stamp, every row and the manifest's `d42.encode` record
  `indexMode`; `d42-parity` fails an `nqx` file whose indices are not exact.
- **`env/` is never compressed** (`env/kit` GLBs resolve by logical name).
- **The cast currency is `castKb`** (bytes in A's encoding), so meshopt
  never moves the cast; `kb` stays the truthful wire size.
- Every NodeIO that reads world GLBs registers `meshopt.decoder`.

## Environment assets

Drop HDRIs, KTX2 texture sets and kit GLBs under `out/env/` (any structure);
`bake-manifest.mjs` lists them and `upload-supabase.mjs` uploads them.

## Hero props (Meshy)

`props.mjs` drives the Meshy text-to-3D REST API (v2 preview + refine, Bearer
auth) for the four plaza hero props — LED board cabinet, Haussmann lamp post,
statue plinth, gate crest ornament. Raw downloads land in `.cache/props/`,
`transform.mjs` optimizes them into `out/props/` (≤ 1024² textures, position
quantization, ≤ 40 k tris / ≤ 1.5 MB bar), and the manifest carries them in a
`props[]` section with per-prop stats.

- Needs `MESHY_API_KEY` in `.env` / `.env.local`. The key is never printed,
  logged, or committed; without it only `--dry-run` works.
- **Probe first**: a bare run generates only the lamp post (the stations'
  procedural lamps give it an in-code comparator) at the meshy-6 tier, prints
  an auto-check, and stops. Inspect it (floating parts, inverted normals,
  baked lighting), then run `--all`. A probe that fails as a task retries
  once at the 5-credit tier; use `--tier fallback` to force it.
- **Credit discipline**: every finished task is appended to
  `.cache/props/credits.json` (prop, phase, task id, ai_model,
  `consumed_credits`). The script stops before any call whose estimate would
  push the batch past 200 credits. FAILED tasks are refunded by Meshy.
- This machine has no `toktx` (C-032 precedent): prop textures are WebP, not
  KTX2; the transform switches to KTX2 wherever KTX-Software is installed.

## Licensing

Pokémon models are Nintendo / Creatures Inc. / GAME FREAK IP — private,
non-commercial use only (see `docs/dependencies.md`).
