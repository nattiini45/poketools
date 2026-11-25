# SEO (page metadata, gates and robots)

What a crawler and a link preview see: real 404 statuses for public pages whose subject does not exist, the `generateMetadata` builders of the league/tournament/player/wiki pages, the shared page reads that keep metadata free of extra queries, the robots helpers of the noindex routes and the share-limit marker. Live on the public path: `src/proxy.ts` asks the page gate before every public page render.

## File Structure

```
src/lib/seo/
├── page-gate.ts              # pageSubjectCoverage: which 404 mechanism each public dynamic route has; the proxy gate
├── phase-page-gate.ts        # phasePageGate: the same gate for league phases, called from src/proxy.ts next to pageGate
├── page-metadata.ts          # generateMetadata of the league, league-phase, tournament and player pages
├── wiki-metadata.ts          # Titles/descriptions of the wiki detail pages, from memoised locale-neutral wiki data
├── page-reads.ts             # The reads a detail page and its generateMetadata share (one React cache() entry per request)
├── robots.ts                 # Metadata for a route a crawler must not index (login, token or viewerless pages)
└── share-limit-marker.ts     # How the proxy tells the share page it already charged the team-shared rate limit
```

## Core Functions/Classes

- **The 404 gate** (`page-gate.ts`, `phase-page-gate.ts`) — the root `loading.tsx` commits a 200 before a page's `notFound()` runs, so a missing league, player, species or dead share link would answer 200 with the not-found UI (and `noindex`). The proxy asks the gate first and rewrites with a real 404. `pageSubjectCoverage` maps every public dynamic route to its 404 mechanism, and a test fails when a notFound-capable public page has none.
- **`page-metadata.ts`** — builds the `generateMetadata` export of the league, league-phase, tournament and player pages. A league or tournament description is never set: the phase gates decide what a visitor may see and `generateMetadata` runs outside the page, so it names the entity and nothing else (no roster, no participants). A missing entity returns no title — the page calls `notFound()`.
- **`wiki-metadata.ts`** — the same for every wiki entry and `/pokemon/[name]`, from memoised wiki data, so a request pays no database read for its metadata. An unknown name returns `{}`: the 404 must not carry the title of an entity that does not exist.
- **`page-reads.ts`** — Next memoises `fetch` only, not Supabase client calls, and `unstable_cache` does not dedupe two concurrent cold calls, so each page and its metadata share one React `cache()` entry per request: metadata adds no query to the page's cold-cache budget.
- **`share-limit-marker.ts`** — the proxy charges the `team-shared` rate limit once per original request (it answers the missing-link 404 before the page runs) and hands the verdict down in a request header, deleting whatever the client sent under that name, so the page never charges twice.

## Testing

- **Test Files — `src/lib/seo/`**: `src/lib/seo/__tests__/` (7 test files): `page-gate-coverage.test.ts`, `page-gate.test.ts`, `page-metadata.test.ts`, `phase-page-gate.test.ts`, `share-limit-marker.test.ts`, `share-limit.local.test.ts`, `wiki-metadata.test.ts`.
- **Running Tests**: `npx vitest run src/lib/seo/__tests__`

## Related Modules

- [Security Patterns](./security-patterns.md) — the proxy, the rate limits and the noindex rules.
- [Wiki](./wiki.md) — the wiki entries the metadata names.
- [League phase](./league-phase.md) — the phases the phase gate covers.
