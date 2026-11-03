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

- Public browse without login: tournaments, leagues, `/insights` (merged stats + rankings hub with `ScopeSelector` global | league | tournament; `/leaderboard` and per-entity `/stats` redirect into it), wiki, broadcast overlays, `/players` directory. `/players/[id]` renders anonymously (only the match sections need login) but is `noindex` and not in the sitemap; `/dashboard` is the registered-player command center. The same scope model is shared with wiki usage and teambuilder.
- Public player directory APIs: `GET /api/players/public` and `GET /api/players/[id]/public-profile` — do not relax the admin `/api/players` routes.

## i18n

Rules: root [`AGENTS.md`](../../AGENTS.md) "Text goes through `src/i18n`"; module doc [`../../docs/i18n.md`](../../docs/i18n.md).

- Server pages translate with `const t = await getT(<ns>Messages)` and format calendar dates with `getFormatter()`; an instant with a time of day renders as `<LocalTime>` (a client leaf), never formatted on the server.
- Metadata: every public page gets its own title. The root layout owns the title template (`meta.titleTemplate`, `%s | PokéTools`), so a page's title message never carries the brand. Entity pages (wiki, `/pokemon/[name]`, leagues, tournaments, players) export `generateMetadata` that reads through the same cached read as the page (`src/lib/seo/page-reads.ts`, React `cache()`), so metadata adds no cold query; index pages use `generateMetadata` with a `meta.pages.*` message. Descriptions come from the `meta` namespace in both languages and never carry league, roster or participant data. A page behind a login, a bearer token or a viewerless overlay is `NOINDEX` (`src/lib/seo/robots.ts`): the `(player)`, `(broadcast)`, `auth`, `admin` and `creator` layouts set it once, and `/teams/shared/[token]`, `/draft-room/trainer-creator` and `/players/[id]` set it on the page. `src/app/robots.ts` and `src/app/sitemap.ts` (dynamic, no build-time read) are the crawler entry points.
- A page whose subject can be missing (a team share link, a library entry, a league, a tournament, a species or wiki entry) answers a real 404: the root `loading.tsx` commits a 200 before `notFound()` runs, so `src/proxy.ts` asks `pageNotFoundGate` (`src/lib/seo/page-gate.ts`) first and a new such route joins it. The page still calls `notFound()` for the race between the two reads.
- `/teams/shared/[token]` and `/teams/library/[id]` are async server components over `src/lib/team/page-loaders.ts` (React `cache()`, live reads, never `publicReads`): the share page serves only the `filterTeamForShare` allowlist, counts the same `team-shared` rate-limit bucket as `GET /api/teams/shared/[token]` and shows a notice instead of a 429, and only the copy and fork buttons are client islands, so no name table ships to the browser.
- `(broadcast)` pages never call `getLocale()`: they resolve the overlay language with `resolveOverlayLocale` (`?lang=`, then the league's `seasons.language`, then `'de'`) and wrap the overlay in a nested `<I18nProvider>`; the OBS browser source's cookie says nothing about the stream's audience. Likewise sprites: `(broadcast)/layout.tsx` wraps overlays in `SpriteStyleProvider initialPreference="site"`, so the `plc_sprite_style` cookie never reaches an overlay (docs/pkmn.md, "Sprite styles").
- API routes keep the English `error` text and add a `code` (plus `params`) from the domain's `src/i18n/messages/errors/<domain>` catalog. They never translate the response; live per-viewer AI routes read the viewer's language with `getRequestLocale(request)`.
