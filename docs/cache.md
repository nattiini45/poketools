# Cache (public read cache)

The tagged public read cache: server-side reads of public data wrapped in Next's data cache (`unstable_cache`), with PII stripping and tag-based expiry on writes. The rules (root AGENTS.md): a PUBLIC entry holds no session and nothing about the viewer, so one cached entry serves every caller; a write route expires the tags of everything its write can change.

## File Structure

```
src/lib/cache/
├── public-reads.ts           # publicReads: the cached reads of the public pages (leagues, tournaments, matches, players)
├── format-reads.ts           # formatReads: cached reads of the format library, kept apart so its test sample stays small
└── phase-public-reads.ts     # phasePublicReads: cached reads of the native league phases (PublicPhase, phase matches)
```

## Core Functions/Classes

- **`publicReads`** (`public-reads.ts`) — the cached reads behind the public pages, keyed and tagged per resource. TTLs: `PUBLIC_LIST_TTL_S` (60) for lists, `PUBLIC_DETAIL_TTL_S` (30) for details. `PUBLIC_PROFILE_PLAYER_FIELDS` is the exact column list a cached player profile read may select — the private columns of a `players` row never enter the cache.
- **`formatReads`** (`format-reads.ts`) — the format library's gallery shelf and per-league format reads, tagged `publicTags.formatLibrary` so every library write route expires them. Kept in its own module because `public-reads.ts` pulls in every query module and its test requires a sample for every key it exports.
- **`phasePublicReads`** (`phase-public-reads.ts`) — the same treatment for native league phases: `PublicPhase` omits the phase internals (`stage_spec`, `enrollment_source`) a visitor never sees; `toPublicPhaseMatch` strips a phase match to its public shape.

## Data flow

A write route calls its library entry point and expires the affected tags (`revalidateTag`); `src/lib/__tests__/write-route-tags.test.ts` requires every write handler to do so or be exempt. The cache test-suite fakes Next's cache through `src/lib/cache/__tests__/fake-next-cache.ts`.

## Testing

- **Test Files — `src/lib/cache/`**: `src/lib/cache/__tests__/` (4 test files): `catalogue-write-routes.test.ts`, `format-reads.test.ts`, `phase-public-reads.test.ts`, `public-reads.test.ts`.
- **Running Tests**: `npx vitest run src/lib/cache/__tests__`

## Related Modules

- [Supabase](./supabase.md) — the query modules the cached reads wrap.
- [League phase](./league-phase.md) — the native phases the phase reads serve.
- [Format Kit](./format-kit.md) — the format library the format reads serve.
