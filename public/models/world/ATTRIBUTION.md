# Pokémon figure attribution

All Pokémon figures under `models/` are optimized `.glb` files downloaded
from the [Pokemon-3D-api/assets](https://github.com/Pokemon-3D-api/assets)
`models/opt` tree (Draco-compressed source), then re-processed locally by
`scripts/world-assets/transform.mjs` (Draco decode, clip pruning to
`idle`/`idle2`/`walk`/`run`, KTX2/WebP textures, quantization) and merged
into `manifest.json` by `bake-manifest.mjs` / `pool-coverage.mjs`
(manifest v2).

License posture (per the archive README, "License & Credits", as read
2026-09-19):

- The archive's repository code is MIT; the models are NOT covered by it.
- The archive states: "All 3D assets are property of
  Nintendo/Creatures Inc./GAME FREAK inc." (Sketchfab-sourced fan assets).

These models are third-party intellectual property. They are NOT covered by
this repository's MIT licence, and they are not offered for standalone
redistribution. This project uses them non-commercially, in line with the
archive's own public distribution. The repository does not ship them: the
figure binaries live in each deployment's world-assets Storage bucket (and an
untracked local mirror), and the older `public/models/draft-room/` set is not
distributed either. See `NOTICE.md` at the repository root.

Coverage of record: manifest v2's `pool` section records the 860-entry
gen-9 pool universe (recomputed at bake time from the app's own dex
enumeration) and how it resolves: own-form GLB / stand-in file / sprite
billboard, with an upstream-absent reason for every permanent sprite
fallback. The 7 v1 `missingForms` resolve as: alolan/74–76 (Geodude-Alola
line) through regular stand-in entries (`sourceForm: "regular"`); regular
859, 860, 861, 1011 are absent from the archive (verified 404 / absent
from the 1361-entry tree, 2026-09-19) and are served by the never-crash
sprite-billboard path.

## Hero props under `props/`

The four plaza hero props are Meshy text-to-3D generations
(REST v2 preview + refine, `meshy-6`, PBR 2k, remove_lighting), optimized
by `scripts/world-assets/transform.mjs` and measured into `manifest.json`
by the bake step. The four Meshy props are `gate-crest-ornament`,
`haussmann-lamp-post`, `led-board-cabinet` and `statue-plinth`; the batch cost
120 credits (20 preview + 10 refine each). The per-task credit records were
written to `scripts/world-assets/.cache/props/credits.json`, a gitignored
pipeline cache that no longer exists — the totals here are the durable record.

The nine route-theme props (2026-09-19) are ORIGINAL works
authored in-house by `scripts/world-assets/blender/world-props-c107.py`
(headless Blender 5.2.1 CLI, bmesh geometry, Principled-BSDF material
slots, no textures, no Draco) — no third-party source, no AI generation,
0 credits; following the project rule "build in Blender where possible,
fall back to Meshy", no Meshy call was needed:

- `sakura-torii-hero` — myōjin torii (sakura pulse hero)
- `sakura-stone-lantern-tall` / `sakura-stone-lantern-low` — kasuga- and
  yukimi-style stone lanterns (sakura path practicals)
- `mountain-ridge-arch` — stone ridge arch (mountain crest)
- `mountain-cairn-small` / `-medium` / `-tall` — cairn marker set
  (mountain route dressing)
- `clouds-airship-hull` — broadside airship hull, long axis +X, face −Y
  (hullYaw law) (clouds roster sail)
- `clouds-halo-gate` — floating halo gate (clouds rules hero)

All 13 props ship as plain GLB carrying only KHR_mesh_quantization (+
EXT_texture_webp on the four Meshy props), with measured `bounds` /
`triangles` / `kb` in `manifest.json`'s `props[]` section.
