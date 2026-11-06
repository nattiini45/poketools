# Audit Module
> Fire-and-forget audit logging for administrative and system activity, with an admin-only read API and UI.

## Overview
The Audit module records who did what to which resource, with optional before/after diffs and metadata. Writes are fire-and-forget: `logAuditEvent` never blocks or breaks the calling route, and write failures are swallowed (logged to console). Reads are admin-only and exposed via a paginated, filterable query API consumed by the admin UI.

## File Structure
```
src/lib/audit/
├── log.ts       # AuditAction type, AuditLogEntry type, logAuditEvent writer, diffField helper
├── queries.ts   # listAuditLogEntries query helper + result record types
└── agent-context.ts  # Who stands behind a write the Admin Assistant makes (audit actor context)

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
- **`logAuditEventStrict(entry: AuditLogEntry): Promise<void>`** — the same row, awaited: it resolves once the row is written and rejects with the generic message `Audit entry could not be written` when the insert fails (the database error is only logged). It exists for the few reads whose audit entry is the price of the data (`POST /api/seasons/[id]/format/relations/unmask`), which await it before they build the body and answer 503 without data when it fails. Agent provenance is added the same way as in `logAuditEvent` (both build the row with one private helper). Every other writer keeps using `logAuditEvent`.
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
| `match.replay_unresolved` | `recordGameResult` (`src/lib/pkmn/game-pipeline.ts`), when a Showdown replay ended as a tie; actor System (`actor_id` null) | `status` before/after (`disputed`) | `tournament_id`, `replay_url`, `submitter_id`, `reason` (`replay_engine_tie`), `outcome_recorded: false` when the outcome row could not be written (see [Match](./match.md#match-outcomes)) |

`match.reset` and `game.delete` gained an optional `metadata.reason`. Admin disputes through the Admin Override form are now `match.dispute`; `match.override` covers only the move to `completed`.

## League Trash Actions
Written by the league recycle bin ([Season](./season.md#league-recycle-bin)). Resource type `season`, the league id as `resource_id`.

| Action | Written by | `metadata` |
|---|---|---|
| `season.delete` | `DELETE /api/seasons/[id]` (a move to the trash, not a destruction) | `trash_id`, `purge_after`, `counts` (the row counts the trash page shows), `frozen_pools` (running drafts paused), `rebuild`, `rebuild_error` |
| `season.restore` | `POST /api/admin/league-trash/[id]/restore` (superadmin) | `trash_id`, `restored` (rows per table), `shift_seconds` (the time spent in the trash), `paused_pools`, `queued_aggregate_jobs`, `schema_version_at_delete`, `warnings`, `rebuild`, `rebuild_error` |
| `season.rebuild` | `POST /api/admin/league-trash/[id]/rebuild` (superadmin) | `trash_id`, `kind` (`delete` or `restore`), `rebuild`, `rebuild_error` |
| `season.purge` | the expiry cron (`/api/cron/expire-league-trash`) | per removed league: `trash_id`, `deleted_at`, `purge_after`, `matches` (written right after the expiry, before the storage sweep, whose outcome is in the response body and the server log). The actor is System (`actor_id` null, `actor_name` `System`), like the other crons |

The `audit_log` and `draft_action_log` rows of a purged league are kept: both logs are append-only by design and carry no foreign key to the league. Achievements are not touched.

## Format Kit Actions
Written by the format kit routes and the engine cron ([Format Kit](./format-kit.md), "Audit actions"). Resource type `season`, the league id as `resource_id`, except `season.format.round.force_start`, which is written against the phase: resource type `tournament`, the tournament (phase) id as `resource_id` and the league id in `metadata.season_id` (filter on the tournament resource type to find forced starts). The actions are `season.format.attach`, `season.format.detach`, `season.format.engine`, `season.format.action.submit`, `season.format.challenge.make`, `season.format.challenge.answer`, `season.format.challenge.withdraw`, `season.format.adjustment`, `season.format.check.resolve`, `season.format.relations.view_hidden` and `season.format.round.force_start`; the engine cron adds `season.format.action.auto_pick`. The Format Kit module doc describes the routes that write them. `season.format.round.force_start` is written once the forced round exists, so a request that is still refused afterwards (too few players, groups forming, a pairing error) leaves no entry. A resource adjustment records the resource key, the player and the amount, never the item (every site admin reads this log and one may be a recipient of that gift). `season.format.relations.view_hidden` is the one entry written with `logAuditEventStrict`: no hidden side leaves the server unless the entry was stored first. A refused adjustment (for example `insufficient_holding`) writes no entry. The engine cron also writes System entries (`actor_id` null, `actor_name` `System`): `season.format.action.auto_pick` for a pick it drew for a player whose action window closed (`seeded_random_pick`; resource type `season`; `metadata.via` `seeded_random_pick`, `action_id`, `pick_count`, and `player_id` unless a relation still hides the giver, in which case `giver_hidden` true and no player), and two under existing actions, told apart by `metadata.via`: a forfeit applied by a calendar deadline policy is recorded as `match.admin_result` (resource type `match`; `metadata.via` `deadline_policy`, plus `outcome` `forfeit`, `tournament_id`, `loser_id`, `reason` and `stage`), which the admin label reads as "Match result recorded by an admin" although no admin acted, and the end of a stage by its calendar is recorded as `tournament.update` (resource type `tournament`; `metadata.via` `stage_end`, plus `reason`, `auto_advanced` and `auto_advance_error`). Filter on `metadata.via` to separate them from admin-made entries. `season.format.action.submit` names no giver (`actor_id` null, `actor_name` `Player`, `metadata.giver_hidden` true) for an action whose giver a relation still hides (Secret Santa), because every site admin reads this log and one may be a recipient.

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
