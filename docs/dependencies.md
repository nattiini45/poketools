# Key Dependencies (Gotcha-Prone)

> Dependencies with non-obvious usage patterns that trip up agents. See `package.json` for the full list.

Check this doc before adding or updating any of these packages; check changelogs before bumping major versions.

| Package | Gotcha |
|---------|--------|
| `next-auth` 5.0.0-beta.30 | Beta API — check changelog before updating |
| `@pkmn/dex` + `@pkmn/data` | Use `new Generations(Dex)`, never `Dex.forFormat()`. Server-side only — never import in client components (2MB+). See the Pokémon Data Rules in [`AGENTS.md`](../AGENTS.md#pokemon-data-rules) |
| `@pkmn/protocol` + `@pkmn/client` | The replay-parsing pair. NOT `@pkmn/logs` (doesn't exist) |
| `@smogon/calc` | Phase 8 damage calc — import server-side |
| `motion` (not `framer-motion`) | Package renamed — import from `motion` |
| `@ai-sdk/openai` v3.x | OpenAI-compatible mode: no Responses API, no reasoning detection. See `src/lib/ai/kale/provider.ts` |
| `zod` v4 | Use `z.iso.date()` for `<input type="date">` payloads hitting Postgres `date` columns; `z.string().datetime()` rejects `YYYY-MM-DD`. See [`src/lib/AGENTS.md`](../src/lib/AGENTS.md) |
| `@react-three/postprocessing` | Route-world only (`src/components/world/route/PostStack.tsx`). Effects are gated by the quality ladder; never mount it outside the plaza canvas. Decision: [ADR-0001](./adr/0001-sourced-art-and-postprocessing.md) |
| `@gltf-transform/cli` (dev) | Owns every GLB/KTX2 transform in `scripts/world-assets/`. Do not hand-edit GLBs; re-run the pipeline. KTX2 needs the `toktx` binary (KTX-Software) on PATH |

## German Pokémon data after a `@pkmn/dex` upgrade (not npm)

`src/lib/pkmn/i18n/data/*.json` (German names and descriptions) is generated from PokeAPI CSVs pinned in `scripts/pkmn-i18n/source.json`, keyed by the @pkmn ids of the installed `@pkmn/dex`. After every `@pkmn/dex` / `@pkmn/data` upgrade:

1. `node scripts/pkmn-i18n/fetch-csv.mjs` (once per pinned commit; the CSVs land in the git-ignored `scripts/pkmn-i18n/.cache/csv`).
2. `node scripts/pkmn-i18n/generate.mjs`, then commit the changed `data/*.json`.
3. `src/lib/pkmn/i18n/__tests__/coverage.test.ts` fails until you do: every Gen 9 species, move, item and ability needs a German entry. New ids PokeAPI lacks go to the reviewed `scripts/pkmn-i18n/overrides/*.de.json` (Gen 9 ids may never be allowlisted).

`node scripts/pkmn-i18n/generate.mjs --check` exits 1 when the committed data differs from a fresh generation. Details: [`pkmn.md`](./pkmn.md#localization-deen).

## World-asset provenance (not npm)

The plaza's Pokémon figures are GLBs from the [Pokemon-3D-api](https://github.com/Pokemon-3D-api/assets) fan pipeline (Sketchfab rips, Draco/WebP-optimized). The models are Nintendo / Creatures Inc. / GAME FREAK intellectual property; the pipeline code is MIT but that licence does not cover the assets. PokéTools is a non-commercial fan project, which is the only footing this use has. These files are not distributed with this repository (see [NOTICE.md](../NOTICE.md)); a deployment that uses them hosts its own copy in its own `world-assets` bucket — never ship them in anything commercial. Environment textures come from Poly Haven / ambientCG (CC0), kit geometry is authored in-house in Blender, hero props are Meshy generations owned by the project. See [ADR-0002](./adr/0002-supabase-storage-for-world-assets.md) for hosting.

### Hero props (Meshy text-to-3D)

Generated through `scripts/world-assets/props.mjs` against the Meshy REST API
(`api.meshy.ai/openapi/v2/text-to-3d`, preview + refine). Licence: outputs of
the project's Meshy subscription are owned by the account holder under the
Meshy terms of service — same non-commercial footing as the rest of
the world assets. Machine note: this workstation has no `toktx` binary, so
textures are WebP (not KTX2), as for the earlier props; the pipeline switches
back to KTX2 automatically where KTX-Software is installed.

| Prop | Generator | Credits | State |
|------|-----------|---------|-------|
| `props/led-board-cabinet.glb` | Meshy text-to-3D, meshy-6, remesh 20 k tris, refine PBR 2k, `remove_lighting` | 30 | generated r1 — 18 084 tris, 1 100 KB after transform |
| `props/haussmann-lamp-post.glb` | Meshy text-to-3D, meshy-6, remesh 20 k tris, refine PBR 2k, `remove_lighting` | 30 | generated r1 (probe) — 20 319 tris, 1 007 KB after transform |
| `props/statue-plinth.glb` | Meshy text-to-3D, meshy-6, remesh 20 k tris, refine PBR 2k, `remove_lighting` | 30 | generated r1 — 14 427 tris, 565 KB after transform |
| `props/gate-crest-ornament.glb` | Meshy text-to-3D, meshy-6, remesh 20 k tris, refine PBR 2k, `remove_lighting` | 30 | generated r1 — 20 534 tris, 682 KB after transform |

Per-call credit log lives in `scripts/world-assets/.cache/props/credits.json`
(8 tasks, meshy-6, 120 credits total for the batch — probe first, then the
remaining three). Meshy normalizes each GLB to its own box (~1.9 units on the
longest axis), not to 1 m = 1 unit; the manifest records per-prop `bounds`,
and consumers scale from those at placement. All four emissive maps are solid
black (no baked lighting; `remove_lighting` was set on every refine).

## Related

- `npm audit` runs in CI twice: `npm audit --omit=dev --audit-level=high` blocks on critical/high findings in production dependencies; `npm audit --audit-level=high` reports every dependency without blocking (`continue-on-error`). Since 2026-10-06 dev tooling only warns, because `braces` <=3.0.3 (GHSA-vfj7-8cjw-p6xm) has no patched release and reaches Tailwind 3, `@next/eslint-plugin-next` and `@gltf-transform/cli` at their latest versions. Revisit when a patch or a braces-free release lands.
- Version pins live in `package.json` overrides; see the repo's npm-audit history before hand-editing.
