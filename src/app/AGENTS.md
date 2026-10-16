# src/app — Route & API Surface Rules

Module rules for `src/app/` (366 source files). Load when a task touches routes, pages, or API handlers here. Root policy (auth guards, validation, `safeErrorResponse()`) lives in [`../../AGENTS.md`](../../AGENTS.md); deep patterns in [`../../docs/security-patterns.md`](../../docs/security-patterns.md). Module docs: [`../../docs/modules-index.md`](../../docs/modules-index.md) → Public Site, Insights, Wiki, Replays.

## Route groups

- User-facing App Router groups: `(public)`, `(player)`, `(broadcast)`; broadcast layouts omit NavBar (OBS overlays).
- `src/app/api/` holds 130+ API routes — follow the root security requirements on every one; read an existing route before writing a new one (e.g. `api/players/route.ts`).

## Wiki routes (`/wiki/*`)

- Canonical wiki at `/wiki/*` (`/creator/wiki/*` redirects). List pages: `/wiki/{pokemon,moves,items,abilities,tera}` (Tera is a fixed 19-tile grid; the other four share `src/components/wiki/WikiIndexTable.tsx` with facets, sortable columns, and URL state — each client must be wrapped in `<Suspense>`: the pages render dynamically because the root layout reads the language cookie; the `<Suspense>` boundary is still required for `useSearchParams`). Species detail stays at `/pokemon/[name]`.
- Wiki list pages walk gens 1–9; detail-page lookups must use the NatDex-aware resolvers — see [`../lib/AGENTS.md`](../lib/AGENTS.md#pkmn-lookups) (the bare gen-9 resolvers 404 NatDex-only entities).
- Wiki community notes require login to read and write; there is no `wiki_pages` table — dex data comes from `@pkmn/data`, community notes only in `wiki_notes`.

## Public vs. authenticated surfaces

- Public browse without login: tournaments, leagues, `/insights` (merged stats + rankings hub with `ScopeSelector` global | league | tournament; `/leaderboard` and per-entity `/stats` redirect into it), wiki, broadcast overlays, `/players` directory. Full `/players/[id]` requires login; `/dashboard` is the registered-player command center. The same scope model is shared with wiki usage and teambuilder.
- Public player directory APIs: `GET /api/players/public` and `GET /api/players/[id]/public-profile` — do not relax the admin `/api/players` routes.

## i18n

Rules: root [`AGENTS.md`](../../AGENTS.md) "Text goes through `src/i18n`"; module doc [`../../docs/i18n.md`](../../docs/i18n.md).

- Server pages translate with `const t = await getT(<ns>Messages)` and format calendar dates with `getFormatter()`; an instant with a time of day renders as `<LocalTime>` (a client leaf), never formatted on the server.
- Metadata: only pages that already have a title use `generateMetadata` (plus the root layout); no other page gains metadata for translation.
- `(broadcast)` pages never call `getLocale()`: they resolve the overlay language with `resolveOverlayLocale` (`?lang=`, then the league's `seasons.language`, then `'de'`) and wrap the overlay in a nested `<I18nProvider>`; the OBS browser source's cookie says nothing about the stream's audience.
- API routes keep the English `error` text and add a `code` (plus `params`) from the domain's `src/i18n/messages/errors/<domain>` catalog. They never translate the response; live per-viewer AI routes read the viewer's language with `getRequestLocale(request)`.
