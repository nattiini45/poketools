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
| `@tanstack/react-virtual` 3.14.23 (exact pin) | The Ruleset Studio entry picker's virtualized list (`src/components/ruleset-studio/picker/EntryList.tsx`). Row heights are fixed pixel values that assume the app's 18 px root font size (`src/lib/ruleset-studio/editor/picker/layout.ts`: a card row is as tall as its content, and a row any shorter clips the card's footer), so `measureElement` is never used; do not add dynamic row heights, and change `ROW_HEIGHT` together with any card content change. The table density is a plain paginated table and is not virtualized. Focus stays on the listbox container and the active option is announced with `aria-activedescendant` (virtualized rows come and go, so they cannot hold focus). Pass `initialRect` so server rendering and tests render rows (a zero-size scroller renders none). Pinned to an exact version: bump it deliberately and re-run the picker tests and the manual keyboard and screen-reader pass |
| `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` (dev) | The DOM test environment. The suite stays on `node`; only a file with a `@vitest-environment jsdom` docblock gets a DOM (see "DOM tests" below). `@testing-library/dom` is a peer of `@testing-library/react`, so it is installed explicitly. `jsdom` 30 needs Node `^22.22.2 || ^24.15.0 || >=26` (`.nvmrc` and CI use 22, which resolves to a new enough 22.x; an older local Node only prints `EBADENGINE` warnings on install) |
| `@gltf-transform/cli` (dev) | Owns every GLB/KTX2 transform in `scripts/world-assets/`. Do not hand-edit GLBs; re-run the pipeline. KTX2 needs the `toktx` binary (KTX-Software) on PATH |

## DOM tests

`npm run test` runs in the `node` environment (`vitest.config.ts`), so a render test is `renderToStaticMarkup` (`renderWithI18n` in `src/test/i18n.tsx`). A component test that has to click, type, upload a file, move focus or watch state change opts into a DOM per file, with a docblock at the top of the file:

```tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
```

- **Setup.** `src/test/dom-setup.ts` is the only setup file. It registers Testing Library's `cleanup` after each test when the file has a `document`, and does nothing in a node file (it loads nothing there). Do not add DOM globals or matchers to it; nothing in it may change what a node test sees.
- **Render with the providers.** `render(withI18n(<Foo />, { locale: 'de' }))`; `withI18n` is the same wrapper `renderWithI18n` uses. Query by role and accessible name (`getByRole`, `getByLabelText`), drive with `userEvent.setup()` (`await user.click(...)`, `user.type`, `user.selectOptions`, `user.upload`), and prefer `findBy*` / `waitFor` over timers. `expectUniqueIds`, `expectLabelledControls` and `expectNoLeftovers` from `src/test/markup.ts` take `container.innerHTML`.
- **Never add a prop so a test can reach a state.** A component does not take an `initialTab`, `initialStart` or a pre-made report for tests: the test clicks the tab, picks the radio or uploads a file. A prop that a page or a dev preview route uses to open a state (`RoomAdminSheet.initialTab` for `/draft-preview`, `InsightsTabs.initialTab` for the `?tab=` of the insights page) is real API and stays.
- Keep the node default for everything that does not need a DOM: a jsdom file starts slower, and the whole suite would pay for it if the default changed.

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
- `postcss-selector-parser` is pinned to `^7.1.6` (GHSA-rj75-hqrm-r3gf; Tailwind 3 asks for 6.x, which has no patched release). The emitted CSS was byte-identical with 6.1.4 and 7.1.6 on 2026-10-16. Drop the pin when moving to Tailwind 4.
- Dependabot opens npm PRs for security alerts only (`open-pull-requests-limit: 0` stops version bumps). A security fix that needs a major upgrade, such as Tailwind 3 → 4, fails CI; close the PR and pin a patched transitive version through an override, as above, or treat the upgrade as its own migration.
