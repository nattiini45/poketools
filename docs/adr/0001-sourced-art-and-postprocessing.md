---
status: accepted
date: 2026-09-02
supersedes: the route-world design spec (maintainer-only; not in this repo) §6 "Every landmark is procedural" and the earlier `no-new-npm-packages` / `fake-bloom-only` constraints
---

# Sourced environment art and real post-processing for the Route World

The route-world bible (§6) required every landmark to be procedural code with no sourced art and no post-processing, to keep transfer near zero and avoid asset licensing. A 24-task iteration run (2026-08-25 → 08-28) closed every card against that constraint and still produced a saturated graybox: code-authored boxes with procedural DataTextures cannot reach the Legends Z-A register the reference stills (maintainer-only) demand, and faked bloom (emissive + halo planes) cannot read as a lit night plaza. We decided to lift both constraints: environment art is sourced (CC0 PBR textures from Poly Haven / ambientCG compressed to KTX2, a modular Haussmann façade kit authored in Blender, hero props generated with Meshy), and `@react-three/postprocessing` provides Bloom, SMAA, vignette, N8AO and AgX tone mapping. The trade is transfer and GPU cost, paid for by an explicit budget (≤ 4 MB critical, ≤ 15 MB lazy, 60 fps desktop / 40 fps mobile), a quality ladder that turns post-processing off from rung 2 down, and the Lite tier as the universal fallback.

## Considered options

- Keep procedural-only and accept the ceiling: rejected by the maintainer after seeing the wave-r1 stills next to the bar.
- Sourced art without post-processing: rejected; bar 03 (Prism night) is defined by bloomed practicals, and half-measures on emissive luminance were the most-repeated visual-review FAIL class.
- Change the bar to a low-poly register that procedural code can reach: rejected; the maintainer wants the Z-A register.

## Consequences

- Pokémon figures continue to come from the Pokemon-3D-api fan-asset pipeline (same source as the 92 GLBs already in the repo); this is Nintendo IP used privately and non-commercially, documented in `docs/dependencies.md`. Nothing in the plaza is fit for a commercial release without replacing those assets.
- Board CONFIG custom keys `no-new-npm-packages` and `fake-bloom-only` are retired at the next CONFIG supersession.
