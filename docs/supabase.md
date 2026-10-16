# Supabase Module

## Overview
The Supabase module provides the typed server-side client and table-specific query modules used across PokéTools.

## File Structure
```
src/lib/supabase/
├── client.ts  # Typed service-role client singleton
├── realtime-client.ts  # Browser anon client for Cast Studio Realtime broadcasts only
└── queries/
    ├── achievements.ts
    ├── aggregates.ts
    ├── avatar-gallery.ts
    ├── broadcast-moments.ts
    ├── broadcast-presets.ts
    ├── discord-webhooks.ts
    ├── draft-pool-entries.ts
    ├── draft-pool-templates.ts
    ├── draft-replay-events.ts
    ├── draft-tier-limits.ts
    ├── drafts.ts
    ├── evolutions.ts
    ├── games.ts
    ├── legacy-standings.ts
    ├── match-analyses.ts
    ├── match-prep-analyses.ts
    ├── match-prep-teams.ts
    ├── matches.ts
    ├── meta-usage.ts
    ├── players.ts
    ├── ratings.ts
    ├── resource-admins.ts
    ├── rounds.ts
    ├── rulesets.ts
    ├── sample-sets.ts
    ├── seasons.ts
    ├── signatures.ts
    ├── social-integrations.ts
    ├── streaks.ts
    ├── teams.ts
    ├── tournament-groups.ts  # Read-only: getGroupsByTournament only (write/member functions removed 2026-07, no reachable callers)
    ├── tournament-reports.ts
    ├── tournaments.ts
    ├── usage-hybrid.ts
    └── wiki-notes.ts
```

## Core Functions/Classes

### Supabase Client
- **File**: `client.ts`
- **Purpose**: Typed service-role client singleton for server-only data access
- **Key Methods**: constant export `supabase`

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
- API roles: `anon` and `authenticated` hold no privilege on any table, sequence or function in `public`, and postgres's default privileges give new objects nothing for them (`20261008081402_revoke_anon_private_match_columns.sql`, `20261008081443_close_public_api_roles.sql`, applied to live 2026-10-08; post-checks in the status header of `docs/security/anon-match-columns.md`). `supabase_admin`'s default privileges still grant both roles on live, and postgres cannot change them: an object created from the dashboard (as `supabase_admin`) is open until a migration revokes it, so run V7 and V10 after creating one. The baseline's `"Public read ..."` policies remain but have no effect; only the service-role client reads the tables. Every table has RLS on. A restored dump does not carry this: re-run both files after any restore (`docs/security/anon-match-columns.md`).
- `matches`: `notes`, `submitter_id`, `auto_confirm_at` and `confirmed_at` are admin-only (see [Match Module](./match.md)); the database refuses the whole table to the API roles.
- `cast_sessions.realtime_key` scopes Cast Studio Realtime channels without exposing service-role credentials.
- `games.aggregate_applied_at` tracks whether aggregate increments have been durably applied before edit/delete/reset rollback.
- `wiki_notes` is read only through service-role API routes (moderation queues included); its baseline policy (`approved = true`) has no effect, because `anon` holds no privilege.
- `wiki_note_reports` stores player reports for approved community notes and is API-only.

## Related Modules
- All feature modules depend on Supabase queries for persistence
