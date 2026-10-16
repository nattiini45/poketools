# Environment asset attribution

All third-party assets are CC0 1.0 from [Poly Haven](https://polyhaven.com).

## Originals (re-encoded)

- `env/hdri/gold.hdr` — [rosendal_park_sunset_puresky](https://polyhaven.com/a/rosendal_park_sunset_puresky) 1k HDR
- `env/hdri/gold.jpg` — [rosendal_park_sunset_puresky](https://polyhaven.com/a/rosendal_park_sunset_puresky) 1k HDR re-encoded as an UltraHDR gain-map JPEG (`env-assets.mjs --gainmap`; point sources such as the moon re-painted as energy-equal 3-texel discs)
- `env/hdri/night.hdr` — [rogland_moonlit_night](https://polyhaven.com/a/rogland_moonlit_night) 1k HDR
- `env/hdri/night.jpg` — [rogland_moonlit_night](https://polyhaven.com/a/rogland_moonlit_night) 1k HDR re-encoded as an UltraHDR gain-map JPEG (`env-assets.mjs --gainmap`; point sources such as the moon re-painted as energy-equal 3-texel discs)
- `env/tex/cobble/` — [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) 1k Diffuse / nor_gl / arm
- `env/tex/limestone/` — [plaster_grey_04](https://polyhaven.com/a/plaster_grey_04) 1k Diffuse / nor_gl / arm
- `env/tex/slate/` — [roof_slates_03](https://polyhaven.com/a/roof_slates_03) 1k Diffuse / nor_gl / arm
- [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) 1k Diffuse / nor_gl / Displacement — original kept in the bake cache only (never shipped raw); source of sakura lawn and clouds isle cap
- [gravel_floor_02](https://polyhaven.com/a/gravel_floor_02) 1k Diffuse / nor_gl / Displacement — original kept in the bake cache only (never shipped raw); source of sakura raked gravel
- [rock_wall_08](https://polyhaven.com/a/rock_wall_08) 1k Diffuse / nor_gl — original kept in the bake cache only (never shipped raw); source of the shared stone grain (sakura granite, mountain masonry)
- [weathered_brown_planks](https://polyhaven.com/a/weathered_brown_planks) 1k Diffuse / nor_gl — original kept in the bake cache only (never shipped raw); source of the sakura bridge deck
- [forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) 1k Diffuse / nor_gl / Displacement — original kept in the bake cache only (never shipped raw); source of the mountain meadow
- [rock_face](https://polyhaven.com/a/rock_face) 1k Diffuse / nor_gl / Displacement — original kept in the bake cache only (never shipped raw); source of the mountain crag granite
- [snow_02](https://polyhaven.com/a/snow_02) 1k nor_gl — original kept in the bake cache only (never shipped raw); source of the mountain snow normal (albedo is procedural)

## Derived works (painterly bake, `paint-bake.mjs`)

Painted re-interpretations of the CC0 originals (Kuwahara filter, value ramp, quantised bands, cavity and edge light). CC0 needs no attribution; it is kept for provenance.

- `env/tex/plaza-ground/` — derived from [cobblestone_floor_08](https://polyhaven.com/a/cobblestone_floor_08) 1k Diffuse + nor_gl, with the 1k Displacement (cache only, never shipped) as the cavity / edge source
- `env/tex/plaza-ashlar/` — derived from [plaster_grey_04](https://polyhaven.com/a/plaster_grey_04) 1k Diffuse + nor_gl + arm (grain only; coursing is procedural in-material)
- `env/tex/plaza-slate/` — derived from [roof_slates_03](https://polyhaven.com/a/roof_slates_03) 1k Diffuse + nor_gl + arm
- `env/tex/sakura-lawn/` — derived from [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) 1k Diffuse + nor_gl, cavity from the 1k Displacement (cache only); spring-green ramp
- `env/tex/sakura-gravel/` — derived from [gravel_floor_02](https://polyhaven.com/a/gravel_floor_02) 1k Diffuse + nor_gl, cavity from the 1k Displacement (cache only); raked-granite ramp
- `env/tex/stone-grain/` — derived from [rock_wall_08](https://polyhaven.com/a/rock_wall_08) 1k Diffuse + nor_gl, grain only (macro blotch removed); shared by the painted-stone kit
- `env/tex/sakura-planks/` — derived from [weathered_brown_planks](https://polyhaven.com/a/weathered_brown_planks) 1k Diffuse + nor_gl at 512; weathered-timber ramp
- `env/tex/mountain-meadow/` — derived from [forrest_ground_01](https://polyhaven.com/a/forrest_ground_01) 1k Diffuse + nor_gl, cavity from the 1k Displacement (cache only); alpine-meadow ramp
- `env/tex/mountain-granite/` — derived from [rock_face](https://polyhaven.com/a/rock_face) 1k Diffuse + nor_gl, cavity from the 1k Displacement (cache only); cool granite ramp
- `env/tex/mountain-snow/` — derived from [snow_02](https://polyhaven.com/a/snow_02) 1k nor_gl only, at 512 (the snow albedo is procedural)
- `env/tex/clouds-cap/` — derived from [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) 1k Diffuse + nor_gl, cavity from the 1k Displacement (cache only); sea-green ramp
- `env/tex/clouds-strata/` — derived from [plaster_grey_04](https://polyhaven.com/a/plaster_grey_04) 1k Diffuse + nor_gl, grain only; cream-limestone ramp (the strata are procedural in-material)

## Authored in this repository (no third-party source)

- `env/plaza/mask.webp` — plaza ground story mask (wear lanes, contact grime, puddles, macro noise), baked by `bake-plaza-mask.mts`
- `env/plaza/skyline.webp` — Lumiose skyline silhouette atlas from authored polylines, baked by `bake-plaza-skyline.mjs`
- `env/sakura/skyline.webp` — sakura hill-and-pagoda skyline atlas (R/G/B near/mid/far coverage, A 0), baked by `bake-sakura-skyline.mjs`
- `env/sakura/mask.webp` — sakura ground story mask (path wear, moss and tree AO, petal drift, macro noise), baked by `bake-sakura-mask.mts`
- `env/sakura/grass-card.webp` — sakura painted grass-clump card (RGBA), baked by `bake-grass-card.mjs`
- `env/mountain/skyline.webp` — mountain ridge atlas (R/G/B near/mid/far coverage, A 0), baked by `bake-mountain-ridges.mjs`
- `env/mountain/mask.webp` — mountain ground story mask (trail wear, scree and contact, lee snow and wet tarn band, macro noise), baked by `bake-mountain-mask.mts`
- `env/clouds/skyline.webp` — clouds far ring of cumulus towers and distant isles (R/G/B near/mid/far coverage, A 0), baked by `bake-clouds-farring.mjs`
- `env/clouds/mask.webp` — clouds isle-cap story mask (worn paths, contact, flower specks, macro noise), baked by `bake-clouds-mask.mts`
