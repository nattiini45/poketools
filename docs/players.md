# Players

The player shapes and rules that decide what a player row may show to whom: the public/private field split, the hidden-players filter of public listings, the moderation state machine companions, the roster-access decision of participant lists, the admin player picker and the sort contract of the player directory. Client-safe and pure except where noted; the queries themselves live in `src/lib/supabase/queries/players.ts` ([Supabase](./supabase.md)).

## File Structure

```
src/lib/players/
├── public-player.ts            # The ONLY player fields that may cross into a client component or another browser
├── hidden-players.ts           # A ranking without the rows of players the public directory hides (applied after a cached read)
├── player-status-state.ts      # Moderation standing: players.status + suspended_until / ban_reason / sessions_valid_after
├── roster-access.ts            # Whether a public participant list route may answer the roster admin shape
├── player-search.ts            # Client-safe pieces of the admin player picker (GET /api/admin/player-search)
└── player-sort.ts              # Sort contract of the site-admin player directory (GET /api/players?sort=&dir=)
```

## Core Functions/Classes

- **`public-player.ts`** — a `players` row (and everything built on it: `SeasonParticipant`, `ParticipantWithSeed`) carries private columns — `discord_id`, `auth_user_id`, `ban_reason`, `suspended_until`, `status` — that must never cross into a client component or another player's browser. The public shapes here are the only permitted projection.
- **`hidden-players.ts`** — banned, suspended and test players are filtered out of the rating/streak leaderboards and the league/tournament/phase participant reads. Applied after a cached read, never inside it: the cache entry itself stays viewer-independent.
- **`player-status-state.ts`** — the moderation standing of a player: `suspended_until` is set only while suspended, `ban_reason` only while banned, and `sessions_valid_after` is the session epoch a suspension or ban moves to now, so every token issued before it is dead. The admin roster derives its row actions from it.
- **`roster-access.ts`** — anonymous callers and signed-in players with no admin role get `false` without a database read; the token copy decides, not a query.
- **`player-search.ts`** — the hit type, search URL, response parser and grey-out rules of the admin player picker, shared by the roster, substitute, link and enrolment pickers so the parser and the rules cannot drift apart.
- **`player-sort.ts`** — only the columns listed here can be ordered by, so a request never names an arbitrary column.

## Testing

- **Test Files — `src/lib/players/`**: `src/lib/players/__tests__/` (5 test files): `hidden-players.test.ts`, `player-search.test.ts`, `player-status-state.test.ts`, `public-player.test.ts`, `roster-access.test.ts`.
- **Running Tests**: `npx vitest run src/lib/players/__tests__`

## Related Modules

- [Profile](./profile.md) — the player profile pages and the avatar pipeline.
- [Security Patterns](./security-patterns.md) — the PII and authorization rules behind the public shapes.
- [Admin](./admin.md) — the admin surfaces the picker and the sort contract serve.
