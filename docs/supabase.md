# Supabase Module

## Overview
The Supabase module provides the typed server-side client and table-specific query modules used across PokéTools.

## File Structure
```
src/lib/supabase/
├── client.ts  # Typed service-role client singleton
├── realtime-client.ts  # Browser anon client for Cast Studio Realtime broadcasts only
└── queries/          # one module per table or feature (see src/lib/supabase/queries/ for the current list)
```

## Core Functions/Classes

### Supabase Client
- **File**: `client.ts`
- **Purpose**: Typed service-role client singleton for server-only data access
- **Key Methods**: constant export `supabase`
- **Deadline**: every request goes through `createTimeoutFetch` (`timeout-fetch.ts`; also used by `auth-client.ts`): 10 s for PostgREST and GoTrue, 30 s for Storage, combined with a caller's own signal. A deadline that fires before the headers or while the body is read surfaces as `SupabaseTimeoutError` (PostgREST `{ error.message }` starts with `SupabaseTimeoutError:`; GoTrue reports it as `AuthRetryableFetchError`, Storage as `StorageUnknownError`, both with the same message). No retry (a timed-out write may have committed); routes answer it through `safeErrorResponse`, which recognises every one of these shapes (`isSupabaseTimeoutError`: the instance, the copied message, or a `cause` / `originalError` chain) and answers **504** with the catalogued `upstream_timeout` code (`errors/common`) and the route's fallback text, logged with the original error; every other failure keeps the route's own status.

### Realtime Client Exception
- **File**: `realtime-client.ts`
- **Purpose**: Browser-only anon Supabase client used only by Cast Studio Realtime broadcast channels
- **Guardrails**: No table reads/writes from browser Supabase; persistence still goes through API routes. The channel name includes `cast_sessions.realtime_key`, an unguessable per-session key returned only through protected creator routes. The anon key it carries reads nothing from `public` over REST or GraphQL: `anon` holds no privilege on any table, sequence or function there.

### Query Modules
- **File**: `queries/`
- **Purpose**: Table/domain-specific read/write operations
- **Key Methods**: `get*`, `list*`, `create*`, `update*`, `delete*`, `upsert*` patterns

## Data Flows
- **Input**: Domain query params from API routes/server modules
- **Processing**:
  1. Execute typed Supabase query
  2. Normalize table rows to domain types
  3. Return structured data or throw query error
- **Output**: Typed domain objects for upstream modules

## Dependencies
- **External Libraries**: `@supabase/supabase-js`
- **Internal Modules**:
  - [Utils Module](./utils.md)
  - [Types Layer](../src/types/database.ts)

## Usage Examples

```typescript
import { getPlayerById } from '@/lib/supabase/queries/players';

const player = await getPlayerById(playerId);
```

## Testing
- **Test Files**: Covered primarily through API route tests
- **Testing Approach**: Integration tests against query consumers
- **Database grants**: `__tests__/migration-api-grants.test.ts` (static, in CI) replays `supabase/migrations/` and fails if `anon`, `authenticated` or `PUBLIC` can reach anything in `public` (object grant, default privilege, role membership, a recreated object without the close-out) or a table lacks RLS. `__tests__/api-role-grants.local.test.ts` (LIVE-LOCAL, opt-in with `LOCAL_SUPABASE_GRANTS=1`, local stack only) probes REST as both roles.

## Current Schema Notes
- API roles: `anon` and `authenticated` hold no privilege on any table, sequence or function in `public`, and postgres's default privileges give new objects nothing for them (`20261008081402_revoke_anon_private_match_columns.sql`, `20261008081443_close_public_api_roles.sql`; post-checks in the status header of `docs/security/anon-match-columns.md`). `supabase_admin`'s default privileges may still grant both roles on a hosted project, and postgres cannot change them: an object created from the dashboard (as `supabase_admin`) is open until a migration revokes it, so run V7 and V10 after creating one. The baseline's `"Public read ..."` policies remain but have no effect; only the service-role client reads the tables. Every table has RLS on. A restored dump does not carry this: re-run both files after any restore (`docs/security/anon-match-columns.md`).
- `matches`: `notes`, `submitter_id`, `auto_confirm_at` and `confirmed_at` are admin-only (see [Match Module](./match.md)); the database refuses the whole table to the API roles.
- `cast_sessions.realtime_key` scopes Cast Studio Realtime channels without exposing service-role credentials.
- `games.aggregate_applied_at` tracks whether aggregate increments have been durably applied before edit/delete/reset rollback.
- `wiki_notes` is read only through service-role API routes (moderation queues included); its baseline policy (`approved = true`) has no effect, because `anon` holds no privilege.
- `wiki_note_reports` stores player reports for approved community notes and is API-only.
- `matches.finalized_at` marks a completed match whose finalize steps all succeeded ([Match Module](./match.md)); `games` is unique on `(match_id, game_number)`.
- `rate_limit_buckets` holds the durable request rate limiter's windows (hashed keys, `rate_limit_hit`); treat it as personal data like request logs ([Security patterns](./security-patterns.md), A04).
- `draft_pools.quiet_start_hour`, `quiet_end_hour`, `quiet_timezone`: a queue pool's pick-clock quiet window, fixed at creation from the format pack ([Draft Room](./draft-room.md)).
- `format_definitions`, `format_definition_versions` and `season_formats` (the Format Studio library and the format a custom league has attached) are service-role only: row level security on, no policy, no grant to `anon` or `authenticated`; their functions (`format_publish_version`, `format_attach_season`, `format_detach_season`, `format_season_started` and the two trigger functions) revoke execute from `PUBLIC`, `anon` and `authenticated`. Published versions are immutable (a trigger). `season_formats.seed` is read by server code only and is never sent to a client; the query layer reads these tables with explicit column lists, bounded, and the queries are `queries/format-definitions.ts` and `queries/season-formats.ts`. The enum value `custom` of `season_format_type` is added by its own migration (`20261024100000_season_format_type_custom.sql`, apply it alone and let it commit first); `tournaments` gains `format_stage_key` and `stage_spec` (not mapped into `Tournament`). Details: [Format Kit](./format-kit.md#database-and-api).
- New migrations on populated tables follow the lock rules in [Backups, Restore and Migration Safety](./operations-backup.md) (lock timeout, `CONCURRENTLY` for large indexes); the full table list is spec section 4.13.

## Related Modules
- All feature modules depend on Supabase queries for persistence
