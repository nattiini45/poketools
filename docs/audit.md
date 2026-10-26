# Audit Module
> Fire-and-forget audit logging for administrative and system activity, with an admin-only read API and UI.

## Overview
The Audit module records who did what to which resource, with optional before/after diffs and metadata. Writes are fire-and-forget: `logAuditEvent` never blocks or breaks the calling route, and write failures are swallowed (logged to console). Reads are admin-only and exposed via a paginated, filterable query API consumed by the admin UI.

## File Structure
```
src/lib/audit/
├── log.ts       # AuditAction type, AuditLogEntry type, logAuditEvent writer, diffField helper
└── queries.ts   # listAuditLogEntries query helper + result record types

src/app/
├── api/admin/audit-log/route.ts  # GET endpoint (admin-only)
└── admin/audit/
    ├── page.tsx            # Admin page wrapper (AdminGuard)
    └── AuditLogBrowser.tsx # Table/filter UI component
```

## Core Functions/Classes

### Writer
- **File**: `src/lib/audit/log.ts`
- **`logAuditEvent(entry: AuditLogEntry): void`** — inserts a row into the `audit_log` table without awaiting; catches and logs all errors so callers are never disrupted.
- **`diffField(changes, field, before, after): void`** — mutates a `changes` map with a `{ before, after }` diff only when values differ.
- **`AuditAction`** — union of valid action strings (e.g. `player.delete`, `match.reset`, `admin.export`, `season.delete`).
- **`AuditLogEntry`** — input shape: `actor_id`, `actor_name`, `action`, `resource_type`, `resource_id`, optional `resource_name`, `changes`, `metadata`, `ip_address`.

### Queries
- **File**: `src/lib/audit/queries.ts`
- **`listAuditLogEntries(filters: AuditLogQueryInput): Promise<AuditLogListResult>`** — builds a filtered `audit_log` query (exact matches on `action`/`actor_id`/`resource_type`/`resource_id`, `ilike` on `actor_name`, `gte`/`lte` on `created_at`), orders by `created_at` descending, and paginates with `range()`.
- **Filter types**: `actor_id` and `resource_id` must be UUIDs (the `audit_log.resource_id` column is `uuid`), enforced by `auditLogQuerySchema`; the route answers `400 validation_failed` before any query runs, and `AuditLogBrowser` shows an inline message (`isValidAuditResourceId`) and disables Apply. `action`, `resource_type` and the `actor` name search are free text.
- **`AuditLogRecord`** / **`AuditLogListResult`** — row and paginated-result shapes (`entries`, `total`, `limit`, `offset`).
- **`listMatchAuditEvents(matchId, { limit, offset }): Promise<MatchHistoryPage>`** — the per-match History read for `GET /api/admin/matches/[id]/history`. The id must be a UUID (`assertValidUuid`, checked before any query). One `or()` filter selects `resource_type` `match` with `resource_id` = the id, and `resource_type` `game` with `metadata->>match_id` = the id; ordered `created_at` descending, then `id` descending, with an exact count and `range()`. Rows are mapped by `toMatchHistoryEntry` (`src/lib/admin/match-detail.ts`), which drops `ip_address` and keeps the reason (`metadata.reason`) and well-formed before/after `changes`.
- **`getLatestMatchDispute(matchId): Promise<MatchDisputeInfo | null>`** — the newest `match.dispute` event of the match (actor, time, reason, `by_admin`), or `null` when the match was disputed before disputes were audited.

## Match Page Actions
Actions written by the admin match page and the confirm route (module doc [Match](./match.md), "Admin Match Page Verbs"). All use `resource_type` `match` and the match id as `resource_id`, and carry `tournament_id` in `metadata`.

| Action | Written by | `changes` | `metadata` |
|---|---|---|---|
| `match.schedule` | `PATCH /api/admin/matches/[id]/schedule` | `scheduled_at` before/after | `proposals_cancelled`, `proposals_cancel_failed` (an unchanged time writes no event) |
| `match.dispute` | `POST /api/confirm-match/[mid]` with `action: 'dispute'`, by a player or an admin | `status` before/after (`disputed`) | `reason` (when given), `by_admin` |
| `match.reopen` | `POST /api/admin/matches/[id]/reopen` | `status` (to `in_progress`) and `winner_id` (to null) | `reason`, `from_status`, `ratings_rebuilt_players`, `bracket_matches_removed`; `incomplete` and `failed_steps` when a follow-up step failed |

`match.reset` and `game.delete` gained an optional `metadata.reason`. Admin disputes through the Admin Override form are now `match.dispute`; `match.override` covers only the move to `completed`.

## League Trash Actions
Written by the league recycle bin ([Season](./season.md#league-recycle-bin)). Resource type `season`, the league id as `resource_id`.

| Action | Written by | `metadata` |
|---|---|---|
| `season.delete` | `DELETE /api/seasons/[id]` (a move to the trash, not a destruction) | `trash_id`, `purge_after`, `counts` (the row counts the trash page shows), `frozen_pools` (running drafts paused), `rebuild`, `rebuild_error` |
| `season.restore` | `POST /api/admin/league-trash/[id]/restore` (superadmin) | `trash_id`, `restored` (rows per table), `shift_seconds` (the time spent in the trash), `paused_pools`, `queued_aggregate_jobs`, `schema_version_at_delete`, `warnings`, `rebuild`, `rebuild_error` |
| `season.rebuild` | `POST /api/admin/league-trash/[id]/rebuild` (superadmin) | `trash_id`, `kind` (`delete` or `restore`), `rebuild`, `rebuild_error` |
| `season.purge` | the expiry cron (`/api/cron/expire-league-trash`) | per removed league: `trash_id`, `deleted_at`, `purge_after`, `matches`, `social_images` (the sweep result). The actor is System (`actor_id` null, `actor_name` `System`), like the other crons |

The `audit_log` and `draft_action_log` rows of a purged league are kept: both logs are append-only by design and carry no foreign key to the league. Achievements are not touched.

## Ruleset Actions
Written by the Ruleset Studio routes ([Ruleset Studio](./ruleset-studio.md#api)). Saving a draft and the pin impact check write nothing.

| Action | Written by | Resource | `changes` / `metadata` |
|---|---|---|---|
| `ruleset.create` | `POST /api/ruleset-definitions`; `POST /api/rulesets` (site admins, `metadata.via` `builder`) | `ruleset` | the slug is the resource name |
| `ruleset.fork` | `POST /api/ruleset-definitions/[id]/fork`, `.../presets/[presetId]/fork` | `ruleset` | `forked_from` and `source_slug`, or `preset` (and `tour_overlay: true` when the Smogon tour extras were added) |
| `ruleset.publish` | `POST .../publish`; `PATCH /api/rulesets/[id]` (`via` `builder`) | `ruleset` | `version_no`, `content_hash`, `resolved_hash` |
| `ruleset.visibility` | `PATCH /api/ruleset-definitions/[id]` | `ruleset` | `visibility` before/after |
| `ruleset.delete` | `DELETE /api/ruleset-definitions/[id]`, `DELETE /api/rulesets/[id]` | `ruleset` | the slug is the resource name |
| `ruleset.pin` | `POST .../pins`; one event per moved target | `season` or `tournament` | `ruleset_id` before/after (version ids); `ruleset` (slug), `version_no`, `started` |
| `ruleset.seed` | `POST /api/seed-rulesets` | `ruleset` | `count` of rulesets created |

## Data Flows
- **Writers**: API routes across modules call `logAuditEvent` after mutations (actions span players, tournaments, games, matches, rounds, Discord webhooks, admin, cast/broadcast, wiki, resource admin, seasons, point-buy lists).
- **Storage**: all entries land in the Supabase `audit_log` table.
- **Readers**: the admin UI calls `GET /api/admin/audit-log`, which validates filters, runs `listAuditLogEntries`, and returns paginated `AuditLogRecord`s rendered by `AuditLogBrowser`.

## Dependencies
- **External Libraries**: none
- **Internal Modules**:
  - [Supabase](./supabase.md) (`@/lib/supabase/client`)
  - [Validation](./validation.md) (`AuditLogQueryInput`, `auditLogQuerySchema`, `formatZodErrors`)
  - [Auth](./auth.md) (`requireAdmin`)
  - [Security Patterns](./security-patterns.md) (`safeErrorResponse` / error handling)

## API Routes
- `GET /api/admin/audit-log` — admin-only; parses query params via `auditLogQuerySchema`, returns `{ success, data }` with `{ entries, total, limit, offset }` or a 400 on validation failure.

## Related Modules
- [Admin](./admin.md)
- [Security Patterns](./security-patterns.md)
- [Supabase](./supabase.md)
