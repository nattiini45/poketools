# Match Module

## Overview
The Match module focuses on match/team stat aggregation helpers used by UI, reporting, and notification layers.

## File Structure
```
src/lib/match/
├── aggregation.ts  # Match/team aggregation helpers
├── aggregate-queue.ts  # Deferred aggregate processing
├── finalize.ts  # Shared completion side effects for manual/cron finalization
└── public-match.ts  # PublicMatch shape + allowlist mapper (client, cache and public-response boundary)
```

## Core Functions/Classes

### Team Aggregation
- **File**: `aggregation.ts`
- **Purpose**: Aggregate battle stats into display/report structures
- **Key Methods**: `aggregateTeamFromStats()`, `computePokemonScore()`, `computeQuickStats()`

### Match Finalization
- **File**: `finalize.ts`
- **Purpose**: Centralizes completion side effects so manual confirmation and auto-confirm cron share the same behavior
- **Key Methods**: `finalizeMatchCompletion()`
- **Bracket propagation**: for single- and double-elimination tournaments it calls `propagateBracketOnMatchComplete()` synchronously (bracket integrity, not a background job). A propagation error does not undo the completed match: the result carries `propagation_failed: true`, an audit row `match.propagation_failed` is written, and an admin heals the bracket with repair-bracket. See [Tournament](./tournament.md) (Bracket Engine v2).

### Aggregate Queue
- **File**: `aggregate-queue.ts`
- **Purpose**: Processes deferred aggregate jobs and marks `games.aggregate_applied_at` after successful application

### Public Match Shape
- **File**: `public-match.ts` (pure, type-only imports: safe in server and client modules)
- **Purpose**: The only match fields that may reach a `'use client'` component, a public read-cache entry or a public API response.
- **Shape**: `PublicMatch` is `MatchWithPlayers` without the admin-only columns `notes` (admin notes / dispute log), `submitter_id`, `auto_confirm_at` and `confirmed_at` (`PRIVATE_MATCH_FIELDS`). Everything else stays, `social_image_url` (the public social card) and every `GameSummary` field included (`PUBLIC_MATCH_FIELDS`, `PUBLIC_GAME_FIELDS`).
- **Key Methods**: `toPublicMatch()`, `toPublicMatches()`. They copy each field by name (never a spread) and pass values through unchanged; a compile-time check fails the build when a `MatchWithPlayers` key is neither public nor private, so a new `matches` column must be classified.
- **Who gets full rows**: admins, resource admins of the match's tournament or league, and the match's own participants. Everyone else gets `PublicMatch`.
- **Database boundary**: the same four columns are closed at the database for direct REST and GraphQL callers. `anon` and `authenticated` hold no privilege on `public.matches` (`supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql`), nor on anything else in `public` (`20261008081443_close_public_api_roles.sql`), so the browser anon key reads no match column at all. Both are applied to live (2026-10-08): an anon `GET /rest/v1/matches` answers 401 with code 42501. Objects created later from the dashboard as `supabase_admin` are not covered, because its default privileges still grant the API roles; check them with V7 and V10 (`docs/security/anon-match-columns.md`). The opt-in LIVE-LOCAL test `src/lib/supabase/__tests__/api-role-grants.local.test.ts` proves it on a local stack; `src/lib/supabase/__tests__/migration-api-grants.test.ts` fails if a migration reopens the table (a grant, a default privilege, role membership, or a recreated table without the close-out). A restored dump does not carry the revokes, so every restore re-runs both migration files above.
- **Where it is applied**: `assembleLeagueSchedule` (`LeagueFixture.match` is `PublicMatch`, so the league schedule and the world payload hold no private columns) and again in `assembleWorldRouteData`; `publicReads.tournamentMatches` (inside the cache callback); the creator `/content` page; `GET /api/matches/[id]`; `GET /api/matches/head-to-head` (served from `publicReads.tournamentHeadToHead`, which maps inside its cache callback); `GET /api/tournaments/[id]/rounds/[rid]` (`RoundWithMatches.matches` is `PublicMatch[]`). The public read-cache entries that hold matches are named `tournament-matches-public`, `tournament-h2h-public`, `world-route-data-public` and `league-schedule-public`, so entries cached before the narrowing (which held the notes) are never served.
- **Notes on the match detail page**: `/tournaments/[id]/matches/[mid]` renders the notes only for a site admin confirmed by the live `getLiveAccess()` read, never by the session copy. The page returns 404 for a malformed (non-UUID) tournament or match id, before any query, and for a match whose `tournament_id` is not the URL's tournament.
- **Admin match pages**: `/admin/matches/[id]`, `/admin/matches/[id]/import-replay` and `/admin/matches/[id]/games/[gid]/edit` need more than `AdminGuard`'s any-admin check. The viewer must be a site admin or a resource admin of that match's tournament or its league: `canAdministerMatch(match.tournament_id)` in `src/app/admin/matches/[id]/match-access.tsx`, decided from the live `getLiveAccess()` read. Any other admin gets `MatchAccessDenied`, so the notes and override controls never render for an admin of an unrelated tournament or league. This is the same rule as `POST /api/admin/matches/[id]/reset` and `/api/admin/games/[id]`.

## Social Images
- **Route**: `POST` and `DELETE /api/matches/[id]/social-image`, site admins only (`requireAdmin()`). The match page's `CreateSocialImageButton` captures the match card, POSTs it, and calls `router.refresh()` after the 201 so the page shows the new URL.
- **Naming**: each upload is a NEW object in the `social-images` bucket at `matches/<matchId>/<uuid>.png`, written with `cacheControl: '31536000'` (one year) and `upsert: false`. An object is never overwritten; `matches.social_image_url` is updated to the new URL.
- **Re-upload keeps the old object** on purpose: a Discord or social post made with the old URL keeps its image.
- **DELETE** removes only the object the stored URL names, and only when `socialImagePathFromUrl` (`src/app/api/matches/[id]/social-image/storage-path.ts`) accepts it: the project's own origin, the `social-images` bucket, and a path of THIS match (the legacy `matches/<id>.png` or `matches/<id>/<uuid>.png`). A foreign, other-match or path-escape URL clears the column without touching Storage. A failed removal returns 500 `STORAGE_REMOVE_FAILED` and keeps the URL.

## Data Flows
- **Input**: Battle stats grouped by game + player IDs
- **Processing**:
  1. Fold per-game stats into per-Pokémon totals
  2. Compute survivor-based Pokémon score
  3. Compute quick KO summaries
- **Output**: Aggregated team and scoreboard structures

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [PKMN Module](./pkmn.md)
  - [Supabase Module](./supabase.md) - write-side aggregate updates happen in `queries/aggregates.ts`

## API Routes
- `/api/matches/[id]` (public GET: returns `PublicMatch`; 404 `INVALID_MATCH_ID` for a malformed id, before any query; plain 404 for an unknown match)
- `/api/matches/head-to-head?tournament_id=&player_1_id=&player_2_id=` (public GET: the pair's completed matches in either seat order, with their games, as `PublicMatch`, oldest first; served from the pair-scoped cached read `publicReads.tournamentHeadToHead` (only the pair's matches, so no tournament-wide row cap applies; 30 s, `tournament:<id>` and `players` tags, one entry per pair in either order); 400 `MISSING_PARAM`, `INVALID_PARAM` or `SAME_PLAYER`)
- `/api/tournaments/[id]/rounds/[rid]` (public GET: the round with `PublicMatch[]`; 404 when the round belongs to another tournament)
- `/api/matches/me` (the player's own matches: full rows)
- `/api/matches/[id]/social-image` (site admins: POST uploads, DELETE removes; 404 `INVALID_MATCH_ID` for a malformed id; see Social Images)
- `/api/manual-result`
- `/api/confirm-match/[mid]` (participants and admins: full `Match`; only admins write `notes`)
- `/api/cron/auto-confirm`
- `/api/matches/[mid]/proposals`
- `/api/match-proposals/[id]/accept` (the responding participant: full row)
- `/api/match-proposals/[id]/reject`
- `/api/match-prep`
- `/api/admin/**` match routes (admins: full rows)

## Scheduling and Auto-Confirm
- Match scheduling uses `rounds.deadline`, `matches.scheduled_at`, and `match_proposals`.
- Proposal routes are participant-only and keep writes API-owned.
- Auto-confirm uses `matches.auto_confirm_at`: replay results use a 24h window, manual results with screenshots use 48h, and manual results without screenshots stay in admin review.
- Completion side effects must go through `finalizeMatchCompletion()` to avoid divergence between manual confirmation and cron completion.

## Usage Examples

```typescript
import { aggregateTeamFromStats } from '@/lib/match/aggregation';

const team = aggregateTeamFromStats(statsByGame, playerId, true);
```

## Testing
- **Test Files**: `src/lib/match/__tests__/`. The public shape: `public-match.test.ts`, with the sentinel helper `private-match-fields.ts` (`fullMatchRow`, `expectNoPrivateMatchData`) that the public route, read-cache and world-payload tests use. The database grants: `src/lib/supabase/__tests__/api-role-grants.local.test.ts` (LIVE-LOCAL, opt-in with `LOCAL_SUPABASE_GRANTS=1`) and `src/lib/supabase/__tests__/migration-api-grants.test.ts` (static, in CI). The live post-checks (2026-10-08) are in the status header of `docs/security/anon-match-columns.md`.
- **Testing Approach**: unit tests with mocked Supabase, plus API/integration verification

## Related Modules
- [Tournament Module](./tournament.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)
