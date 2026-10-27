# src/components — Component Rules

Module rules for `src/components/` (337 source files). Load when a task touches components here. Root policy (component decision tree, `never-do` list) lives in [`../../AGENTS.md`](../../AGENTS.md). Design tokens and `ui/` primitives: [`../../docs/design.md`](../../docs/design.md); full catalog: [`../../docs/modules-index.md`](../../docs/modules-index.md).

## Teambuilder (v3)

- Teambuilder UI is v3 `TeamsEditor` via `TeambuilderClient`; per-slot set editing is the inline `v3/workspace/SetWorkspace.tsx` (Cast Studio has its own `creator/studio/CastSetEditor.tsx`). Do not reintroduce V1/V2 workspaces — see `docs/deprecations.md` and `docs/teambuilder-editor.md`.
- Broadcast team overlays still use legacy `src/components/broadcast/*` (not yet migrated to `v3/broadcast/`).

## Match detail

- `MatchHighlightCard` shows games-won (e.g. 2-1) for Bo3+ and surviving-Pokémon score for Bo1, with in-card Overview + per-game tabs that swap content inside `id="match-highlight-card"`.
- Moves render through `MovesOverflowList` (one row + `+N` popover, tap-toggle on touch) instead of being hard-truncated.
- PNG exports in `src/lib/utils/capture-node.ts` (html-to-image) and `src/lib/utils/export-node.ts` (html2canvas) honor `data-export-hide`.
- Per-game helpers (`computeMatchGamesWon`, `aggregateTeamFromGame`, `computePokemonScoreForGame`, `computeQuickStatsForGame`) live in `src/lib/match/aggregation.ts`.

## Per-game inline edit (admin-only)

- Per-game inline edit on `GameDetailCard` is gated to site admins + tournament resource admins (`isResourceAdminFor`). It uses `InlinePokemonPicker` (strict typeahead against `@pkmn/data`) with per-row delete and saves via `PATCH /api/admin/games/[id]` (full `battle_stats` replace). The `games.stats_locked` mechanics are owned by [`../lib/AGENTS.md`](../lib/AGENTS.md#stats-locking).

## Tests

- Component tests run in `node` with `renderToStaticMarkup` by default (`renderWithI18n`). Use a DOM when the test has to interact: put `/** @vitest-environment jsdom */` as the first line of the file, `render(withI18n(<Foo />, { locale }))` from `@testing-library/react` and `src/test/i18n.tsx`, and `userEvent.setup()` for clicks, typing, `selectOptions` and `upload`. `src/test/dom-setup.ts` unmounts after each test; there is nothing else to wire. Query by role and accessible name, as a viewer would find the control. Setup and rules: [`docs/dependencies.md`](../../docs/dependencies.md#dom-tests).
- A component never takes a prop that only a test uses (`initialTab`, `initialStart`, an `initialImportReport`, `initialPlayers`): the test clicks the tab, picks the radio, uploads the file or types the number. Dependency seams that a dev preview route injects (`actions`, `dataSource`, `initialAdminTab` of the draft room) are real API and stay.

## i18n

Rules: root [`AGENTS.md`](../../AGENTS.md) "Text goes through `src/i18n`"; module doc [`../../docs/i18n.md`](../../docs/i18n.md).

- Client components import the namespace object and call `const t = useT(fooMessages)`; there is no message registry and no string-named namespace. Hooks never throw without a provider (they render English), so unwrapped English render tests stay green; German assertions use `renderWithI18n(ui, { locale: 'de' })` from `src/test/i18n.tsx`.
- Universal components (no `'use client'`, rendered from a server component) cannot call hooks. One that renders text either takes already-translated `labels` props, gets `'use client'` when it is a cheap leaf, or takes a `locale` prop and uses `createTranslator`.
- Never store translated text in state (`useState(t('x'))`). Store keys, enum values or the `ApiErrorLike` object, and translate during render, so a language switch re-renders correctly.
- Existing `labels` / `copy` props stay as optional overrides; their defaults come from the owning namespace (`useMessages(ns)` / `getMessagesFor(ns)`).
- Dates and numbers go through `useFormatter()`, `<LocalTime>` and `<RelativeTime>`; Pokémon names through `src/lib/pkmn/i18n` with `useDataLocale()`.
