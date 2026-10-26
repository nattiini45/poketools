# Core Modules

> Cross-cutting domain modules: auth, database, rating, gamification, social, Discord, and shared infrastructure.

## Authentication & Authorization

**Docs:** `docs/auth.md`, `docs/auth-email-password.md`

Two providers resolve to the same `players` row:
- **Discord OAuth** — primary login flow via NextAuth v5
- **Email/password** — secondary via Supabase Auth GoTrue (server-side only; no `@supabase/ssr`, no persisted Supabase sessions)

**Identity anchor:** `discord_id` or email-matched `players` row. Session managed by NextAuth v5 with JWT strategy.

**Superadmin:** Discord ID in `SUPERADMIN_DISCORD_ID` (Discord sessions) and optional `SUPERADMIN_EMAIL` (email sessions), auto-promoted on every request.

**Auth helpers** (`src/lib/auth/helpers.ts`):
```
requireAuth() → requirePlayer() → requireAdmin()
                                → requireCreator()
                                → requireResourceAdmin(type, id)
                                → requireDraftAdmin(poolId)
```

### Key files
- `src/auth.ts` — NextAuth v5 configuration
- `src/lib/auth/helpers.ts` — Guard functions used in API routes
- `src/lib/auth/__tests__/helpers.test.ts` — Auth test suite
- `src/lib/supabase/auth-client.ts` — Server-side GoTrue client for email/password

## Supabase / Database

**Docs:** `docs/supabase.md`

### Client setup
- **Service-role client** (`src/lib/supabase/client.ts`) — typed singleton for all server-side data access
- **Realtime client** (`src/lib/supabase/realtime-client.ts`) — browser anon client for Cast Studio broadcasts only

### Query modules
Table-specific modules in `src/lib/supabase/queries/`, for example:
- `players.ts`, `seasons.ts`, `tournaments.ts`, `matches.ts`, `rounds.ts`
- `games.ts`, `aggregates.ts`, `ratings.ts`, `achievements.ts`
- `teams.ts`, `drafts.ts`, `draft-pool-entries.ts`, `rulesets.ts`, `ruleset-definitions.ts`, `league-trash.ts`
- `broadcast-moments.ts`, `broadcast-presets.ts`
- `match-analyses.ts`, `match-prep-analyses.ts`
- `wiki-notes.ts`, `social-integrations.ts`, `signatures.ts`, `streaks.ts`
- and more — run `ls src/lib/supabase/queries/*.ts` for the full list

### Schema management
- **Migrations:** `supabase/migrations/` (SQL files)
- **Type regen:** Update `src/types/database.ts` after any schema change
- **Baseline:** `20260608100000_baseline_professional_schema.sql` (120KB — initial full schema)

## Rating (Glicko-2)

**Docs:** `docs/rating.md`

Implements Glicko-2 rating updates and a presentation-tier classifier.

| File | Purpose |
|---|---|
| `src/lib/rating/glicko2.ts` | Core math: `glicko2Update()`, `expectedScore()`, `inflateRD()` |
| `src/lib/rating/glicko2-preview.ts` | Read-only preview of next-game rating deltas |
| `src/lib/rating/updateRatings.ts` | Match-driven rating updates + rollback |
| `src/lib/rating/tiers.ts` | Pokéball tier classifier |

### Rating tiers (Spec §11.5)
- **Poké** — `rating < 1400` or `rd > 100` (provisional)
- **Great** — `1400–1599`
- **Ultra** — `1600–1899` (or `rating ≥ 1900` with `rd > 50`)
- **Master** — `rating ≥ 1900` AND `rd ≤ 50`

`rd === 0 | null | undefined` is the "RD unknown" sentinel — provisional and Master gates skipped (caps at Ultra).

## Gamification

**Docs:** `docs/gamification.md`

Three subsystems:

1. **Achievements** — Condition-based awards triggered by match results, streaks, or milestones. Admin CRUD at `/api/admin/achievements`. Player-facing at `/api/achievements/[playerId]`.
2. **Streaks** — Consecutive win/loss tracking. `src/lib/gamification/streaks.ts`. API: `/api/streaks/[playerId]`.
3. **Signatures** — Player signature Pokémon and moves. `src/lib/gamification/signatures.ts`. API: `/api/signatures/[playerId]`.

## Social Integration

**Docs:** `docs/social.md`

Publishing to X (Twitter), Threads, and Bluesky from match results and tournament events.

- **Credential encryption:** `src/lib/social/encryption.ts` — `encryptJson()` / `decryptJson()` with `SOCIAL_INTEGRATION_ENCRYPTION_KEY`
- **API routes:** `/api/social-integrations` — CRUD for per-player platform credentials
- **Publishing:** Fire-and-forget from match completion workflows (no `await` on Discord/social sends)

## Discord Notifications

**Docs:** `docs/discord.md`

Webhook-based event fan-out to configured Discord channels.

- **Webhook management:** `/api/discord-webhooks` — CRUD for per-league webhook URLs
- **Embeds:** `src/lib/discord/` — Embed builders for match results, round generation, draft events
- **Pattern:** Fire-and-forget — Discord sends are never awaited in the critical path

## API Infrastructure

### Error Handling
`src/lib/api/error-response.ts` — `safeErrorResponse(err, fallbackMessage)` is mandatory for every API route catch block. It:
1. Passes `UserFacingError` subclasses through (specific message + optional `code` + status)
2. Passes `AuthError` messages through
3. Logs everything else with `console.error` and returns the static fallback

`src/lib/api/user-facing-error.ts` — `UserFacingError` base class for domain errors that are safe to surface.

### Pagination
`src/lib/api/pagination.ts` — `parsePagination(searchParams, maxLimit)` — clamps limit to `[1, maxLimit]` with sensible defaults.

### Input Validation
Manual, domain-specific. No centralized Zod/Joi. Patterns:
- Whitelist enums with `VALID_*` constants and `.includes()`
- Length/bounds checks on strings and numbers
- `parseCreateBody()` style helpers for complex payloads
- Regex for structured strings (URLs, IDs)
- `validateUpload()` for MIME/size checks

### LRU Cache
`src/lib/utils/lru-cache.ts` — TTL-based LRU cache used by the AI agent tool executor (5-minute result cache). Distinguishes cached `undefined` from cache miss via `getEntry()`.

### Date Utilities
`src/lib/utils/date.ts` — `formatDateTime`, `formatDateTimeOrNull`, `formatDate`, `formatDateOnly`, `formatTimeAgo`.
