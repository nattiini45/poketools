# Season Module

> Leagues ("seasons") — creation, participants, format gating, Core Liga type-core assignment, and EPB lifecycle (format rules, redraft, tokens, advancement). Route contract lives in [`poketools-spec.md` §5](./poketools-spec.md).

## Overview
A **season** (a.k.a. league) is the top-level container: it groups participants, tournaments/stages, a ruleset, and (for Evolution Point Buy) a point-buy list and format rules. A league has a **league type** (`seasons.format_type`): the classic `singles`, `doubles`, `draft`, `evolution_point_buy`, or `custom` (*Custom format (Format Studio)*), whose phases come from a published format attached to the league (see [Custom format leagues](#custom-format-leagues)). `src/lib/season/*` holds pure league-scoped logic; the Supabase persistence layer lives in `src/lib/supabase/queries/seasons.ts`, and the REST surface is `src/app/api/seasons/**`.

## File Structure
```
src/lib/season/
├── core-assignment.ts      # Seeded random assignment of 3-type cores
├── epb-phase.ts            # Hinrunde (first-half) completion detection
├── format-capabilities.ts  # Per-format capability flags
├── format-rules-defaults.ts# EPB default rules + auto-initialization
├── format-utils.ts         # Format predicates + EPB route gate
├── point-buy-battle-ruleset.ts # Point-buy leagues' shared battle ruleset (ensure on create)
├── season-engine.ts        # resolveSeasonEngine: legacy:<type> or kit
├── season-started.ts       # isSeasonStarted: the started rule (SQL twin: format_season_started)
├── group-repair.ts         # Planner: group rows left by pre-handover substitutions
├── repair-phase-groups.ts  # Loads the planner's inputs, applies its moves
└── __tests__/              # core-assignment, format-capabilities,
                            #   format-rules-defaults, format-utils, group-repair

src/lib/supabase/queries/seasons.ts  # Typed season/participant/core queries

src/app/api/seasons/                 # Route tree (see API Routes)
```

## Core Functions/Classes

- **`assignCoresFromPool(participants, pool, opts)`** — `core-assignment.ts` — draws one 3-type core triple per participant via a seedable Fisher–Yates shuffle (Mulberry32 PRNG; crypto seed when unspecified). Skips already-assigned players unless `force`.
- **`normalizeTriple` / `tripleKey` / `isTripleInPool`** — `core-assignment.ts` — order-independent triple helpers.
- **`CoreAssignmentError` / `CoreTypesConflictError` / `CoreNotInPoolError`** — `core-assignment.ts` — `UserFacingError` subclasses surfaced by `safeErrorResponse`.
- **`getEpbPhaseStatus(seasonId)`** — `epb-phase.ts` — computes whether the primary stage's Hinrunde (first half of rounds) is fully completed, with per-round match completion counts.
- **`getFormatCapabilities(format)`** — `format-capabilities.ts` — returns the frozen capability config for a `SeasonFormatType` (`singles`, `doubles`, `draft`, `evolution_point_buy`, `custom`). `custom` has every flag off (it equals `deriveCapabilities` of a format without legacy modules); gym types and Core Liga cores belong to the classic types.
- **`isDraftLike` / `isEvolutionPointBuy` / `assertEpbSeason`** — `format-utils.ts` — format predicates; `assertEpbSeason` throws a `UserFacingError` (404/400) for non-EPB seasons, gating all EPB-only routes. `isDraftLike('custom')` is false: a custom league has no draft gate.
- **`isLeagueDoubles(formatType, stages)`** — `format-utils.ts` — whether a league's matches are doubles: the type itself for the classic types, and for `custom` true when the league has stages and every one is doubles (callers pass the stages they already hold; no read).
- **`isSeasonStarted(signals)`** — `season-started.ts` — true when the status is `active` or `completed`, any phase has left `upcoming`, or any phase has a round. Participants and draft pools do not count. Gates attach, detach and the type switch; the SQL function `format_season_started` applies the same rule inside the attach and detach transactions.
- **`resolveSeasonEngine(season, attached?)`** — `season-engine.ts` — `legacy:<format_type>` for every league, `kit` only for a `custom` league whose attached format has `engine = 'kit'`. Today every league resolves to a legacy engine; nothing branches on the kit result yet.
- **`EPB_DEFAULT_RULES` / `initializeEpbFormatRules(seasonId)`** — `format-rules-defaults.ts` — default EPB ruleset (budget, picks, token ratio and caps, bans, Tera, tiebreakers from the active format pack's `epb.defaults`; `docs/format-packs.md`) upserted on EPB season creation.
- **`pointBuyBattleRulesetInput()` / `ensurePointBuyBattleRuleset(createdBy)`** — `point-buy-battle-ruleset.ts` — the Gen 9 singles, non-custom `rulesets` row a point-buy league uses, built from the active format pack; ensure reuses the oldest usable row with the pack's name (clearing any bans on it) or inserts one ([Evolution Point Buy](./evolution-point-buy.md#league-type--battle-ruleset)).
- **Query layer** — `src/lib/supabase/queries/seasons.ts` — `listSeasons`, `listArchivedSeasons`, `listSeasonsByIds`, `listAllSeasonIds`, `getSeasonById`, `getSeasonWithDetails`, `createSeason`, `updateSeason`, `deleteSeason`, `getSeasonsByPlayer`; participants (`getSeasonParticipants`, `addSeasonParticipant`, `getSeasonParticipantRow`, `swapSeasonParticipant`, `updateParticipantGymType`; removal is `removeLeagueParticipant` in `season-groups.ts`, the `season_participant_remove` RPC); cores (`getCorePool`, `setCorePool`, `updateParticipantCoreTypes`, `getParticipantCore`, `setParticipantCores`).

## Data Flows

- **Input**: Season/participant/form data via Zod-validated route bodies; `seasons` + `season_participants` rows.
- **Processing**:
  1. `POST /api/seasons` creates the row (with `clone_from`, it then copies the source's phases, see [below](#create-a-league-from-another-league-post-apiseasons-clone_from)). For EPB it first ensures the pack's battle ruleset (Gen 9 singles, no bans: point-buy bans live in `format_rules` only) and makes it the league default (`ruleset_id`, unless the body names one), then auto-initializes format rules and best-effort binds the active point-buy list version.
  2. Participants are added/removed and their `gym_type` / `core_types` updated (core updates validated against the pool + unique index).
  3. `POST …/cores/assign` runs the seeded shuffle and bulk-writes normalized triples.
  4. EPB lifecycle: format rules gate draft/kill tokens, redraft (secret drop; free swaps and trades retired), progress corrections, and evolution-point recalc.
- **Output**: `SeasonWithDetails` (participant/tournament counts, ruleset name), core pool/assignments, EPB phase/redraft/token state, advancement results.

## Dependencies

- **External Libraries**: `node:crypto` (`randomInt`), `server-only`, `zod` (route validation).
- **Internal Modules**:
  - [Supabase](./supabase.md) — `seasons` + `format-rules`/`point-buy-lists`/`evolutions`/`epb-token-grants`/`redraft` queries.
  - [Evolution Point Buy](./evolution-point-buy.md) and [Draft](./draft.md) — `progress-engine`, `point-buy-engine`, `redraft-engine`, `evolution-points-engine`.
  - [Tournament](./tournament.md) — `syncStandingsEnrollment` (`enrollment-sync.ts`: phase enrollment and stage advancement).
  - [Auth](./auth.md) — `requirePlayer` / `requireResourceAdmin` / `requireAnyAdmin` / `requireAdmin`.
  - [Reconcile](./reconcile.md) — `rebuildAfterSeasonDelete` on DELETE.
  - [Discord](./discord.md) and [Social](./social.md) — season-advance notifications.

## API Routes

- `GET/POST /api/seasons` — list active leagues, test leagues included (sorted last, `is_test_season` set) / create (archived list requires admin); create accepts an optional `route_theme` (`routeThemeSchema`, default `auto`) and an optional `clone_from: { season_id, copy_roster, copy_admins }` that starts the league from an existing one (below). The admin create form (`LeagueForm`) calls `format_type` the **League type** (form-local option labels: *Classic: Singles*, *Classic: Doubles*, *Draft*, and the pack's point-buy label) and the ruleset the **Battle ruleset**; a point-buy league shows *Battle format: Singles (fixed)* and its automatic ruleset instead of the ruleset select. Creating a point-buy league is `requireAnyAdmin`, so a resource admin may thereby insert the shared battle-ruleset row (or clear bans found on it), although `POST /api/rulesets` itself is site-admin only; the row's content is fixed server-side from the active pack, never taken from the request, and both writes are audited (`season.auto_create_battle_ruleset`, `season.clear_battle_ruleset_bans`).
- `GET /api/seasons/me` — leagues the current player participates in.
- `GET/PATCH/DELETE /api/seasons/[id]` — details / update (settings, point-buy rebind, archive, test-league flag, `route_theme` 3D world pin; guards in [League settings](#league-settings-patch-apiseasonsid); a change of `format_type` to or from `custom` is refused with 409 `season_format_type_locked` while a format is attached or after the league started, and a change between the classic types takes no extra read) / delete (cascade + derived-data rebuild). The delete is one `DELETE FROM seasons`: participants, groups, format rules, evolution tiers, tier limits, the classic draft pool list, the evolution tracker (with events, progress log and Redraft submissions), token rows and Redraft rows cascade; phases, draft pools, teams and storylines are not cascaded by the league DELETE and refuse it while they exist (phases have their own `DELETE /api/seasons/[id]/phases/[phaseId]`, so delete them first; SQLSTATE 23503, answered as 409 `SEASON_HAS_DEPENDENTS` with nothing deleted: `deleteSeason` in `src/lib/supabase/queries/seasons.ts` throws `SeasonHasDependentsError`; the derived-data rebuild and the audit record run only after a committed delete); cast sessions are kept, unlinked. The league admin Danger tab lists this from `src/lib/league-admin/season-delete.ts` (checked against the migrations by its test; details in [Admin](./admin.md#league-admin-page-adminleaguesid)). How `route_theme` resolves against `?world=` and the format auto-map: [Worlds](./worlds.md).
- `GET/POST/DELETE/PATCH /api/seasons/[id]/participants` — list (redacted) / add / remove / update `gym_type` + `core_types`.
- `GET/PATCH /api/seasons/[id]/cores` — read pool + assignments / replace pool.
- `POST /api/seasons/[id]/cores/assign` — seeded random core assignment.
- `POST /api/seasons/[id]/draft-tokens` — retired: answers `410 ENDPOINT_REPLACED` and touches no data (Draft Kill Tokens are bought one at a time through `POST /api/seasons/[id]/draft-kill-tokens`).
- `GET/POST /api/seasons/[id]/kill-tokens` — retired: both answer `410 ENDPOINT_REPLACED` and touch no data (Comeback Tokens are read in `GET /api/seasons/[id]/tokens/me` and spent through `POST /api/seasons/[id]/comeback-tokens/spend`).
- `GET/POST /api/seasons/[id]/progress` — evolution progress / admin correction.
- `GET/PUT /api/seasons/[id]/format-rules` — read / upsert EPB format rules.
- `GET/POST/DELETE /api/seasons/[id]/format` — the attached Format Studio format of a `custom` league: state (`not_custom`, `unattached`, `attached`, `can_start`, `started`, optional frozen spec) / attach a published version (201 first attach, 200 re-attach) / detach. League admin (or site admin) of that league; rate limit `format-attach`. See [Custom format leagues](#custom-format-leagues).
- `POST /api/seasons/[id]/evolution-points/recalculate` — rebuild evolution-point counters.
- `GET/POST /api/seasons/[id]/redraft` — redraft state / retired: POST answers `410 REDRAFT_TRADE_RETIRED` for every body without reading it (trades and the free swap are retired; the secret-drop redraft replaced them).
- `GET/PATCH /api/seasons/[id]/redraft/phase` — redraft phase status / open/close (requires Hinrunde complete).
- `POST /api/seasons/[id]/advance` — advance players to the next completed→upcoming stage (delegates to `syncStandingsEnrollment`; accepts `{ force: true }` to overwrite frozen enrollment or existing rounds)

## League settings (`PATCH /api/seasons/[id]`)

The admin league page edits a league's name, league type, ruleset and dates through this route (the form sends only the changed keys); the description, theme and content language have their own editors and use the same route. League admins may change their own league; the test-league flag stays site-admin only (above). The route reads the stored league once (`getSeasonById`) and answers **404** `SEASON_NOT_FOUND` for an unknown league. Guards run before anything is written; a refusal writes nothing:

- **Date order.** `start_date` and `end_date` are checked together (`assertSeasonDateRange`, `src/lib/season/settings-guards.ts`): an end before the start is **400** `SEASON_DATES_INVALID`; equal dates are valid and either date may be empty (`null` clears it). When only one date is sent, it is compared with the stored other one. A request that sends neither date is not held to a range the league already stores. `POST /api/seasons` runs the same check. The order lives in the routes, not in `seasonCreateSchema` / `seasonUpdateSchema`: Zod 4 refuses `.extend()` on a refined object, and the PATCH route extends `seasonUpdateSchema`.
- **League type lock.** A change of `format_type` is read against the league's start signals (`getSeasonPhaseStartSignals`, `src/lib/supabase/queries/season-start.ts`: one query, each phase's status and an embedded `rounds ( count )`; read only for a real change). A league has **started** (`isSeasonStarted`) when its status is `active` or `completed`, any phase status is not `upcoming`, or any phase has at least one round (this also covers a running league an admin flipped back to `upcoming`). Draft pools and participants deliberately do not count. A change on a started league is **409** `SEASON_FORMAT_LOCKED`. Resending the stored type is always allowed (the form sends the whole object).
- **Point-buy boundary.** A change to or from `evolution_point_buy` is **409** `SEASON_FORMAT_POINT_BUY_LOCKED`, started or not: only `POST /api/seasons` runs the point-buy setup (battle ruleset, format rules, list bind), so a PATCH must not move a league across that line. A point-buy league's form never sends `format_type` or `ruleset_id`. `formatChangeLock` and `editableFormatTypes` give the form the same answers (`FormatLockReason`: `started` or `point_buy`).
- **Audit.** A general edit is audited as `season.update` (fire-and-forget, after the write): `changes` holds `{ before, after }` for each of `name`, `format_type`, `ruleset_id`, `start_date`, `end_date`, `status`, `archived`, `route_theme` and `language` that changed. The description text is never copied into the row; an edit of it records `metadata: { description_changed: true }`. A request that changes none of these writes no row. `is_test_season` and `point_buy_list_id` keep their own events (`season.set_test_flag`, `season.bind_point_buy_list`). The response shape (`SeasonUpdateResult`) is unchanged.
- **Known limits.** The start signals are read before the write, so a round generated in between can still slip a type change through (a rare admin action; a database-side guard would need a migration). Changing the ruleset or renaming a league has effects outside the page: `season.ruleset_id` feeds team validation, and `resolveEffectiveRuleset` matches a custom ruleset of a group phase by the league name.

Tests: `src/lib/season/__tests__/settings-guards.test.ts` (helpers), `src/lib/supabase/queries/__tests__/season-start.test.ts`, `src/app/api/seasons/[id]/__tests__/settings-guards.test.ts` (route).

## Create a league from another league (`POST /api/seasons`, `clone_from`)

The admin create form (`/admin/leagues/new`) can start from an existing league: the **Start from** picker prefills league type, battle ruleset, theme, content language and description from the source, and the request carries `clone_from: { season_id: uuid, copy_roster: boolean, copy_admins: boolean }` (both flags default to `false`; the key is optional, and a request without it behaves exactly as before). Schemas: `seasonCloneOptionsSchema` and `seasonCreateRequestSchema` (`seasonCreateSchema` plus `clone_from`); the response is `201` with the league and, for a clone, `data.clone = { source_id, phases, participants, admins }`.

- **Who may clone.** `requireAnyAdmin`, then `assertCloneAllowed` (`src/lib/season/clone.ts`) runs before anything is written, against the live player: an unknown source is **404** `SEASON_NOT_FOUND`; a caller who is neither a site admin nor a league admin of the source is **403** `SEASON_CLONE_FORBIDDEN`; `copy_admins: true` is **403** `SEASON_CLONE_ADMINS_FORBIDDEN` unless the caller is a site admin (granting league admin stays a site-admin action). The source may be archived or a test league.
- **What is copied.** The league is created by the unchanged path (battle ruleset, format rules and list binding for a point-buy destination, the creator becomes league admin unless a site admin). Then the source's phases are created in order, renumbered from 1, each with name, description, bracket type, ruleset, best-of and overrides, doubles, team visibility, grand-final reset and the advancement rule exactly as stored on that phase; each is enrolled with `syncStandingsEnrollment`, as `POST …/phases` does. With `copy_roster` the source's player ids are added to the roster in one bulk insert (chunks of 500; gym type, core types and league groups are not copied); with `copy_admins` the source's league admins are granted on the new league. The phase-level group setup is the advancement rule's `per_group` flag; league groups (`season_groups`) are not copied.
- **What is never copied.** Rounds, matches, games, phase participants and seeds, groups, results, status (new phases are upcoming), archive and legacy flags, the point-buy list binding, core pool, tokens, draft data and format rules, and the test flag. The clone module does not read a point-buy source's format rules, tokens or draft rows.
- **Rollback.** PostgREST has no multi-statement transaction, so the league is created first and removed again if a later step fails: the new phases are deleted (newest first, since phases hold a no-action foreign key to the league), the league-admin grants made for it are removed by hand (that table has no foreign key to seasons), then the league is deleted. The request then answers **500** `SEASON_CLONE_FAILED` (nothing was kept). If the cleanup itself fails it answers **500** `SEASON_CLONE_CLEANUP_FAILED` with the league id and the number of phases and roster entries left behind, which a site admin can delete. Both errors are logged server-side. The shared battle ruleset a point-buy destination ensures is a shared row and is not rolled back. A crash or timeout between the create and the rollback can still leave a half-built league.
- **Audit.** One `season.clone` event (`source_id`, `source_name`, `phases`, `participants`, `admins`, `copy_roster`, `copy_admins`) on success; `season.clone_failed` (source, failed step, created counts, cleanup `complete` or `failed`) on failure.

Tests: `src/lib/season/__tests__/clone.test.ts`, `src/app/api/seasons/__tests__/clone-route.test.ts`, `src/lib/validation/__tests__/season-clone-schema.test.ts`, `src/lib/supabase/queries/__tests__/season-clone.test.ts`.

## Custom format leagues

The league type **Custom format (Format Studio)** (`format_type = 'custom'`, picked on the create form like any other type; it shows the normal battle-ruleset select) creates a league with no phases. Its phases come from a format:

1. A format is written and published in the library (`/api/formats`, [Format Kit](./format-kit.md#database-and-api)); it is an immutable, hash-checked version.
2. `POST /api/seasons/[id]/format` attaches a published version to a league that is `custom`, has not started and has no hand-made phase. In one transaction the server stores a frozen copy of the spec in `season_formats` (the league keeps working if the library definition is later changed or deleted), creates one `tournaments` phase per format stage (`tournaments.format_stage_key`, `tournaments.stage_spec`; bracket type, best of, round overrides, doubles flag and ruleset mapped from the stage, in the compiled stage order) and answers with the stages and the engine gaps. A re-attach replaces the format: stages that are still in the spec keep their id, stages that left it are deleted.
3. `DELETE /api/seasons/[id]/format` detaches it and removes the phases it created (a team that points at a phase blocks it).

**Readiness.** A custom league without an attached format cannot start: the database trigger `trg_seasons_require_attached_format` refuses a status change to `active` (409 `format_not_attached`), and the round and bracket generation routes refuse earlier, before anything is written. Once a format is attached or the league has started, its type cannot be switched to or from `custom` (`PATCH /api/seasons/[id]`).

**What the attached format does today.** It creates the phases and freezes the document. The phases are ordinary phases: pairing, standings, advancement, enrolment and group creation are the classic engine's, so group counts, round-robin legs, third-place matches and wildcard, threshold and bottom-N selections the format asks for are reported as warnings and not run (Phase 2b). Public pages treat a custom league like a classic one (the 3D world is the sakura park, the league is doubles when every stage is doubles). There is no editor UI yet.

## Test leagues

- `seasons.is_test_season` marks a league kept for testing. Site admins set it on the admin league page (**Settings** tab, **Test League** section: *Test league — listed with a test badge, excluded from ratings and all-time stats*), which PATCHes `{ is_test_season }` to `/api/seasons/[id]`. The flag is site-admin only: a league (resource) admin who sends it gets **403** before anything is written; a non-boolean is a **400**. Setting it is one `updateSeason` write, audited as `season.set_test_flag` (`metadata.is_test_season`, `changed`, `rating_rebuild`, `rating_rebuild_error`), and expires the league's reads and the season list (`expireSeasonReads`).
- Every request that sends the flag, changed or not, rebuilds the ratings of the players of the league's completed matches for the stored value (`rebuildRatingsAfterTestFlagChange`, `src/lib/rating/test-league-rebuild.ts`; the rebuild's gap healing may add players) and expires their rating reads (`expireRatingReads`: `ratings`, `player-profiles`, `player:<id>`); sending the same value again finishes a rebuild that was cut off. Re-sending the same value is an API path: the checkbox only sends a changed value, so in the admin UI it means switching the flag off and on again (two rebuilds) or running the repair. The rebuild repeats its pass over the rebuilt players while the last pass changed any of them (at most 8 passes that still change something, plus the one that confirms it), so the league's players replay against each other's rebuilt states; the summary reports `passes` and `settled` (details: [Rating](./rating.md#test-leagues)). The response `data` is the league plus `rating_rebuild` (the summary, null when the flag was not sent) and `rebuild_warning`: the flag stays saved when the rebuild fails, and the warning carries a catalogued code (`rating_history_incomplete`, `rating_rebuild_plan_too_large`, otherwise `test_flag_rating_rebuild_failed`) that `LeagueTestFlagControl` shows under the checkbox (*Rating rebuild: …*). A rebuild that reaches its pass cap unsettled keeps the flag saved as well and answers its summary with the warning `test_flag_rating_rebuild_unsettled`. After either warning, run the season reconcile repair for that league (see [Reconcile](./reconcile.md)) and repeat it until its dry run lists no rating mismatch: one repair run is a single rebuild pass. It covers every player of the league's completed matches, including players who left the roster. A save without an answer (network error, timeout) refreshes the checkbox to the stored flag and says the save is unconfirmed. Tests: `src/app/api/seasons/[id]/__tests__/test-flag-ratings.test.ts`, `src/lib/rating/__tests__/test-league-rebuild.test.ts`.
- Test leagues are listed so the community can test together (owner request, 2026-10): `listSeasons()` includes them by default and orders real leagues first, then test leagues, newest first in each group (in the query, before the 100-row cap). `/leagues` and the home page teaser (through `publicReads.seasonList`), `GET /api/seasons` (the same answer for every viewer; the Cast Studio league select reads it too) and the dashboard's My Leagues (`getSeasonsByPlayer`, same order) show them with a **Test league** / **Testliga** badge (`TestLeagueBadge`, `leagues` namespace `list.testBadge`). Two places keep them out: the home spotlight features only a real active league, and the insights scope picker filters them (`{ includeTestSeasons: false }` is the query-level opt-out). Admin lists badge them **Test**; the creator content dashboard reads the default list. Tests: `src/lib/supabase/queries/__tests__/seasons.test.ts`, `src/app/api/seasons/__tests__/route.test.ts`, `src/lib/cache/__tests__/public-reads.test.ts`, `src/app/(player)/dashboard/__tests__/DashboardContent.i18n.test.tsx`.
- Stats are unchanged by the listing: the all-time aggregates, global stats and Pokémon all-time usage leave test-league games out, and so do player ratings. Ratings follow the CURRENT flag: a test-league match writes no rating and no rating history (the live update returns `skipped_test_season`), every rebuild replays only the matches outside test leagues, and setting the flag rebuilds the league's players (above). Details: [Rating](./rating.md#test-leagues). The all-time aggregates instead freeze `games.exclude_all_time` per game when it is recorded (`shouldExcludeFromAllTime`), so for them the flag applies to games recorded after it is set; earlier games stay in the all-time aggregates, and clearing the flag does not bring excluded games back.

## League phases & enrollment

Phase CRUD and per-phase enrollment live under `/api/seasons/[id]/phases/*` (see [Tournament](./tournament.md)). League-scoped highlights:

- **Auto-sync / freeze**: `enrollment_source` on each phase tracks `{ type, source_phase_id, synced_at, frozen }`. Unfrozen phases re-sync from the prior phase table on create; first manual seed/participant edit or bracket generation freezes enrollment.
- **Re-sync guards**: `assertEnrollmentSyncAllowed` blocks `sync-standings` and `advance` when frozen (`ENROLLMENT_FROZEN`) or rounds exist (`ENROLLMENT_ROUNDS_EXIST`) unless the client sends `{ force: true }` (SeedingTable prompts on re-import).
- **Seeding writes** (`updateParticipantSeeds`, behind `PATCH /api/tournaments/[id]/participants`, `PATCH …/phases/[phaseId]/participants` and `POST …/participants/seed-by-rating`): `tournament_participants_seed_unique` is a non-deferrable unique index on `(tournament_id, seed)`, so the old one-UPDATE-per-row write failed with a 500 as soon as two players traded seeds, with some rows already rewritten. The write now reads the current seeds once, refuses a requested seed held by a player outside the request (**409** `SEED_CONFLICT`, nothing written), clears every changing seed to null in one UPDATE, then writes the new values (rows that do not change are not written). A failure after that clear is **500** `SEED_UPDATE_PARTIAL` (the route still expires the phase's reads; saving the seeding again completes it); a failure before any write keeps the generic 500. Errors: `src/lib/tournament/seed-errors.ts`; tests: `src/lib/supabase/queries/__tests__/participant-seeds.test.ts` (a fake that enforces the index).
- **Standings source**: enrollment uses `computeStandingsForSeason()` so EPB leagues advance by the full standings chain, not raw W-L.
- **Phase insert**: `POST .../phases` accepts optional `insert_at`; inserting before a non-`upcoming` phase returns **400** `PHASE_INSERT_LOCKED`. Positions run from the **highest `stage_order`**, not from the phase count: the default is `max + 1`, the valid range is `1..max + 1` (**400** `PHASE_INSERT_INVALID` otherwise), and only phases at or after `insert_at` shift. A league whose middle phase was deleted has a gap in its orders, and counting phases would hand the new phase an order another phase already holds.
- **Phase names** are unique per league (trimmed, case- and Unicode-composition-insensitive; `assertPhaseNameFree`, `src/lib/tournament/league-phase.ts`). A create or rename onto another phase's name is **409** `PHASE_NAME_TAKEN`, checked before anything is shifted or written, on `POST .../phases`, `PATCH .../phases/[phaseId]` and `PATCH /api/tournaments/[id]` for a league phase. Saving a phase's own name again passes, so leagues that already hold duplicates stay editable. The rule lives in the API only: the table has no unique constraint, so two simultaneous creates can still produce a duplicate.
- **Substitute** (`POST /api/seasons/[id]/participants/substitute`):
  - A completed or archived league takes no substitution: **409** `SEASON_CLOSED` before anything is read or written, the preview included (**404** `SEASON_NOT_FOUND` for an unknown league). The admin roster hides the **Substitute** actions there and says why.
  - `scope: 'league'` — swaps `season_participants` roster (one UPDATE in `swapSeasonParticipant`: gym and core metadata stay on the row) **and** enrollments in all upcoming/active phases; the outgoing player must be on the roster (`OUT_NOT_ON_ROSTER`), the incoming player must not (`IN_ALREADY_ON_ROSTER`), nor be enrolled in any phase the outgoing player is swapped out of (`IN_ALREADY_IN_PHASE`, e.g. a reserve promoted there earlier; checked before any write).
  - `scope: <phaseId>` — phase enrollment only (no roster swap); checks the phase enrollment, not the roster. The outgoing player must be enrolled in that phase (**400** `OUT_NOT_IN_PHASE`, before any write; nothing is recorded), so a reserve promoted earlier (enrolled, not on the roster) can be replaced in turn; the incoming player may be promoted from reserves (`IN_ALREADY_IN_PHASE` if already enrolled in that phase). The admin roster lists such reserves under **Promoted reserves** with their phases, and offers each player only the scopes they can take (a roster player the league and the active phases they are enrolled in; a reserve their phases only). The dialog keeps **Confirm substitute** off for a preview that would change nothing.
  - In every phase it touches, the incoming player takes the outgoing player's whole slot: the enrollment row (one UPDATE in `swapTournamentParticipant`, so seed and starting bracket stay on it; a double-elimination losers-side starter stays one) and group row (same group and seed, one UPDATE in `swapGroupMemberInTournament`), so per-group standings and advancement count their matches. While the outgoing player still holds a group row, a row the incoming player holds in that phase is stale and is removed; once the slot has moved (a re-run), the incoming player's row is kept. The preview lists each phase's group.
  - Repairs the outgoing player's scheduled matches with zero games. They are read per phase with `getScheduledMatchesForPlayerInTournament` (filtered on the server, paged with `.range()`, so no phase size hides any). Each repair is conditional (`repairScheduledMatchPairing`: no games, still `scheduled`, still the planned players): a match reported or re-paired between the preview and the write is left with the departed player and returned in `matches_skipped` (`reason: 'has_games' | 'changed'`); the dialog lists those after the apply. Only a game row inserted after the game count while the status is still `scheduled` can slip through (one round trip).
  - Matches against the departed player stop counting in that phase's standings and per-group advancement: they no longer hold the enrollment or the group row. Substitutions made before the group handover (2026-10) left the group row with the departed player: per-group advancement and round pairing still read those rows, while the league hub shows the enrolled substitute in that group (its group tables and phase cards alike, through `resolveGroupMembers` in `src/lib/league-hub/views.ts`; the group tables' kill difference also counts only the games of the matches they count). Repair them per phase from the admin phase page (Groups section, **Rows left by substitutions**: *Check group rows*, then *Apply repair*), which calls `POST /api/seasons/[id]/phases/[phaseId]/groups/repair` (`dry_run` required: `{ dry_run: true }` checks, `{ dry_run: false, moves }` applies; season resource admin; **404** `PHASE_NOT_FOUND` for a phase of another league). The planner (`planGroupRepair`, `src/lib/season/group-repair.ts`; loader and apply in `repair-phase-groups.ts`) pairs each row whose holder is no longer enrolled with the enrolled player who holds no row in the phase:
    - First from the substitution audit log (`season.participant.substitute` entries of the season, read in pages of 100 up to 2000). Chains A→B→C are followed forward in time; the slot is with the first player in the chain enrolled in the phase (a later step cannot have touched it), else with the last one, and a chain back to the holder names no one. A record counts for the phases it names in `metadata.phase_ids` (recorded since these fixes); an older record without them counts when its scope is `'league'` or this phase.
    - Else from the fixtures (the group most of the substitute's opponents hold a row in, a tie deciding nothing; within it, the slot of a departed player the substitute never met, when each side is the other's only option). A player the log already ties to a departed player whose row is not a candidate (rows in several groups, or none in this phase) is not offered here and is listed as unresolved. The fixtures are every pairing of the phase (`getTournamentPairings`: player ids only, ordered, paged up to 20 000 matches); a read that stops there is disclosed (`fixtures.truncated`, a warning in the control), like a truncated audit read (`history.truncated`).
    - Rows of enrolled holders are never touched, a target gets at most one row, and a departed player holding rows in several groups is left alone; everything unpaired is listed as unresolved and stays as it is.
    - An apply names the moves the admin reviewed (`group_id`, `from_player_id`, `to_player_id` of each move the check listed) and plans afresh: when that plan differs it writes nothing and returns **409** `PLAN_CHANGED`. Each move is then one conditional write (`handOverGroupRow`): the UPDATE names the expected holder of that row and runs only while the target holds no row in the phase, and it deletes nothing. A row that changed since the plan (a concurrent group edit, or a second apply of the same plan that got there first) writes nothing and stops the apply with **409** `PLAN_CHANGED`, so a duplicate apply records no second audit entry. A target placed in another group between that check and the UPDATE ends with two rows: the apply stops with **409** `GROUP_SLOT_CHANGED`. A completed apply expires the phase's reads and records `season.phase.groups.repair` with the moves. Because a re-run no longer plans the moves that landed, a failed apply records them right away (`metadata.partial: true`, `failure_code`, and `stopped_at`: the move it stopped at, with `written`, whether its own row moved, and `held_group_ids`, the groups its target held a row in). The read-cache expiry after a failure is guarded: its own failure is logged and neither replaces the apply's error nor skips that record.
    - The admin control reloads the groups after each check and each apply, failed ones included, and checks again after a failure, so its list holds only what is still open; a failed check clears the plan (no stale *Apply repair* next to the error). It shows the moves an apply wrote, and drops a plan checked before a group edit in the same panel.
  - The writes are not one transaction; they run in a resumable order (per phase: cancel each match's pending proposals, then repair its pairing; hand over the group row; swap the enrollment; the roster swap last), so re-running a failed apply finishes it. A failed apply still expires the league's read cache. A second apply racing the first (two tabs, a double click) finds its rows gone and stops with a distinct **409** instead of a generic 500: `ENROLLMENT_CHANGED` (the outgoing player left the phase meanwhile: `swapTournamentParticipant` returns `{ swapped, seed }`, and only `swapped: false` means no row moved; an unseeded row moves with `seed: null` and is a success), `IN_ALREADY_IN_PHASE` (the enrollment swap hit the primary key), `ROSTER_CHANGED` (the roster row is gone), `IN_ALREADY_ON_ROSTER` (the roster swap hit the primary key), or `GROUP_SLOT_CHANGED` (a group edited between planning and the swap).
  - Apply log (`SubstituteApplyLog`, `src/lib/season/substitute.ts`): filled as the apply runs, and it lists only real writes. A step that ran and changed nothing is left out: a match whose cancel found no pending proposal (`proposals_cancelled` lists only matches that had some), a group step that moved no slot and deleted no row (`swapGroupMemberInTournament` returns `{ written, held }`; a delete or UPDATE that matched no row is no write), an enrollment swap that moved no row. So an apply that lost the race to an identical one logs nothing. `groups_handed_over` names, per phase, the group the incoming player holds afterwards (null: none); a group step that threw after deleting a stale row is listed with null (`groupSwapWroteBeforeFailure`). `matches_skipped` lists the planned matches left as they were (no write), `phases_touched` the phases anything was handed over in, `stopped_at` the step that failed (`proposals`, `match`, `group`, `enrollment`, `roster`, with `phase_id` and `match_id`).
  - Partial signal: a failed apply (`dry_run: false`) that reached the substitution answers with its own status, message and code (`safeErrorResponse`) plus `partial` (`SubstituteApplyError`): null when it wrote nothing, else `SubstitutePartialApply` = `{ written, phase_ids, stopped_at }` from the log (`written`: `proposals_cancelled`, `matches_repaired`, `matches_skipped`, `groups_handed_over`, `enrollments_swapped`, `roster_swapped`). A request rejected before the substitution ran (auth, malformed body) has no `partial` field and wrote nothing; a preview never carries one.
  - Audit: a completed apply records `season.participant.substitute` with `metadata.phase_ids` (the phases handed over), `groups` (the group rows this apply moved, per phase; a slot an earlier, interrupted run moved is in that run's partial entry), `phases_updated`, `matches_repaired` and `matches_skipped`. A failed apply that wrote anything records the same action right away with `metadata.partial: true`, `failure_code`, and the partial signal's `phase_ids`, `written` and `stopped_at`; a failure that wrote nothing records nothing.
  - Dialog: after a failed apply it shows the error, warns from the partial signal (the steps written, by phase name) and checks the preview again (what is still open). The warning says to confirm the rest with the same replacement (another replacement would leave the first in the slots already handed over); it stays when that re-check fails too, and across later failed applies until one succeeds. Only when the request itself got no answer (network, a non-JSON response) is the warning inferred from the re-checked preview (a difference from the confirmed one, or a group slot or match the preview cannot show), or shown as *may have stopped partway* when the re-check fails as well. Closing the dialog after any apply reloads the roster.
- **Guest claim** (`POST /api/players/[id]/claim`): transfers auth from a fresh empty account onto a guest row; **409** `SOURCE_HAS_ACTIVITY` when the source account has any season/tournament/match/team/proposal/draft/wiki/EPB activity (use substitute instead). **409** `SOURCE_NOT_ACTIVE` when the source account is banned or suspended (a claim never lifts a sanction; the RPC re-checks under lock). The RPC also refuses (`SOURCE_HAS_ACTIVITY`) while any `ON DELETE CASCADE / SET NULL` reference still holds a row of the source, because deleting the source would destroy or orphan that data; only tables listed in `public.player_claim_disposable_refs` (disposable per-viewer state such as seen markers and rate-limit counters) are deleted with it. A deployment that adds such a table registers it there instead of editing the function.

## League groups (schedule and standings)

A league may split its trainers into league groups (draft side: [draft-room.md](./draft-room.md); the full rules:
[spec §6.4a](./poketools-spec.md)). Without groups nothing below applies and every page reads as before.

- **Making the groups.** League admins create, rename and fill the groups on the admin league page's Participants tab
  (`LeagueGroupsEditor`; `GET`/`PUT /api/seasons/[id]/groups`, `PATCH …/groups/[groupId]`, `PATCH …/groups/members`): split by
  seed (serpentine, seeds from the first phase), set by hand, rename, move a trainer, place a participant who joined later, or
  remove every group. Every write is audited. Details: [Admin](./admin.md#league-groups); the per-group drafts:
  [Draft Room](./draft-room.md#overview). The database enforces every rule (`20261018180000_league_groups.sql`,
  `20261018202000_league_groups_locks.sql`, `20261018202100_league_groups_participant_lock.sql`; codes in the `errors/draft`
  catalog):
  - **Schedule lock.** Once ANY phase of the league has a round, the membership is final: re-splitting, removing, a new group, a
    move and a first placement are refused (**409** `SEASON_GROUPS_SCHEDULED`); renaming stays possible, and so does a
    substitution (the incoming trainer takes the outgoing trainer's slot in its group). Why: the phases mirrored the groups at their
    first round, and the schedule, the group tables, per-group advancement and the per-group first half (Redraft order) all use that
    membership; a later move would put a trainer into another group's draft, tokens and table while the schedule keeps the old group.
    The editor reads the lock (`scheduleLocked` in its DTO: one round count over the league's phases) and greys every control but
    rename out, with the reason.
  - **The roster follows the same rules.** Leaving the league leaves the league group (the membership's participant key cascades),
    so removing a trainer (`DELETE /api/seasons/[id]/participants` -> RPC `season_participant_remove`, under the season's draft
    lock) who holds a group is refused once the league has a round (**409** `SEASON_GROUPS_SCHEDULED`), while that group has a live
    pool (any pool not cancelled, setup included: the admin cancels a setup pool first; lead ruling round 5) or the trainer holds
    lines drafted in it (**409** `SEASON_GROUP_LOCKED`), and when the group would keep fewer than two
    trainers (**422** `SEASON_GROUP_TOO_SMALL`). A trainer in no group is removed as before. Adding a trainer to a grouped league
    that already has a round is refused too (**409** `SEASON_GROUPS_SCHEDULED`, insert trigger on `season_participants`): they
    could join no group and would have no fixtures (lead ruling round 5: a replacement uses the substitution flow). A league without groups adds and removes trainers as before, and deleting a
    league still cascades through its groups (no delete guard). The roster manager shows each refusal in the viewer's language.
  - **Draft lock.** Re-splitting and removing are refused while any group has a live (not cancelled) draft pool or drafted lines
    (**409** `SEASON_GROUP_LOCKED`): `season_groups_replace` rewrites every membership, so it locks the whole league. A single move is
    refused only while the old or the new group has a live pool, or the trainer holds lines of the old group.
  - **Size and coverage.** Every group keeps at least two trainers (**422** `SEASON_GROUP_TOO_SMALL`: a split or manual groups with a
    smaller group, a move that leaves one trainer behind), and a split places every participant in exactly one group (**422**
    `SEASON_GROUP_MEMBERS_INVALID`). A participant who joins later is in no group until an admin places them; joining is possible only
    before the first round (see the roster rules above), so after it only a trainer added and left unplaced before that round can
    remain in no group (the editor lists them).
  - **Names** are unique per league ignoring case and surrounding blanks (`uq_season_groups_name_ci`): a rename to a taken name is
    **409** `SEASON_GROUP_NAME_TAKEN`; a re-split never repeats a kept name (new groups take the next free `Group X`).
  - **Substitution during a group draft.** A substitution of a trainer whose group's pool is in `submissions` (a Redraft) or
    `drafting` is refused (**409** `SEASON_GROUP_SUBSTITUTION_LOCKED`): the pool keeps the outgoing trainer's seat, which could
    then never pick, and a Redraft's deadline publishes the outgoing trainer's drops on its own (cancel the Redraft first to
    substitute during its submissions). A
    league-scope substitution checks it before its first write, the preview included (`substituteParticipant`: the outgoing
    trainer's group, `seasonGroupHasDraftingPool`), so a refusal writes nothing; a draft that starts between that check and the roster
    swap is refused by the membership trigger, which `swapSeasonParticipant` maps to the same 409 (the response's `partial` then lists
    the phase steps already written, and a re-run after the draft resumes them). A phase-scope substitution moves no league membership
    and is not affected by the draft lock. A substitution while the initial pool is in `setup` is allowed: re-seat the pool from the
    group's members before starting it. A group pool goes live (`draft_start`, a Redraft publish) only while its seats are exactly the
    group's members, else **409** `SEASON_GROUP_SEATS_STALE` and nothing changes (trigger `trg_draft_pools_group_seats`,
    `20261018202000_league_groups_locks.sql`). After the draft completes nothing is seated any more.
  - **Phase-scope substitution in a mirrored phase.** A phase-scope substitution moves the phase slot only (enrollment, phase group
    row, open matches); the roster and the league groups stay. In a phase whose groups mirror league groups the incoming trainer must
    already be in the league group the slot mirrors, else **409** `SUBSTITUTE_LEAGUE_GROUP_MISMATCH` (`errors/seasons`), checked
    before the first write, the preview included (`substituteParticipant`, `getSeasonGroupOfPlayer`). Otherwise the phase group and
    the league group would hold different trainers (the Group stage tab and the schedule against the Standings tab) with no repair
    path, since the phase group writes are league-managed. A substitute from another group or from outside the roster (a reserve)
    goes through the league scope, which moves the league group slot with the roster row. An unmirrored phase (a league without
    groups) is not checked.
- **Phases follow the league groups.** Before a table phase's first round, `ensurePhaseGroupsFromLeague`
  (`src/lib/tournament/group-rounds.ts`, called by `generate-round`, `generate-all-rounds` and the manual round route) rebuilds its groups from the league groups (one phase group per league group with enrolled
  trainers, `tournament_groups.season_group_id` set, members in enrollment order). After the first round they stay as they are. A
  trainer enrolled in the phase but in no league group: **409** `PHASE_PLAYER_WITHOUT_LEAGUE_GROUP`. The phase routes' group writes
  (regenerate, delete, move) answer **409** `PHASE_GROUPS_LEAGUE_MANAGED` in a grouped league, and the admin phase page's Groups
  section (`PhaseGroupsPanel` with `leagueManaged`) shows the mirrored groups read-only, links the league's Participants tab and says
  that "Generate All Rounds" stops before each placement week. The group-row repair after substitutions stays available. A manual
  round (`POST /api/tournaments/[id]/rounds/manual`) in a round robin phase of a grouped league is refused (**409**
  `rounds_manual_league_grouped`, `errors/tournaments`): it would skip the week plan. In any other phase of a league it mirrors the
  league groups first, like the generate routes (a Swiss phase before its first round), so no first round is written without the
  mirror.
- **Schedule.** `generate-round` and `generate-all-rounds` follow the week plan (`planGroupSchedule`,
  `src/lib/tournament/group-schedule.ts`): every group its own round count inside shared weeks (rest weeks for a smaller group), plus
  the cross-group weeks (bye pairings, dedicated cross weeks, a placement week closing each half). Both take the weeks to write from
  the plan (`pendingWeeks`: weeks without a round, and written rounds still without matches), never from
  `tournaments.current_round`, which an interrupted `generate-all-rounds` leaves behind; `current_round` never moves backwards. A
  placement week is generated only once every earlier match is completed (**409** `rounds_group_placement_not_ready`);
  `generate-all-rounds` stops in front of it. Past the last planned week: **400** `rounds_all_generated`. A layout the planner cannot
  schedule (an empty group, a trainer in two groups): **400** `rounds_group_layout_invalid`; no split of the in-group rounds that
  balances the halves (unreachable for every layout probed, kept as a coded refusal): **400** `rounds_group_schedule_unbalanced`.
- **Placement week.** Same-placed trainers of different groups meet, by the group tables after the week before. With three or more
  groups a trainer prefers a same-placed trainer it has not met yet; with two groups each place has exactly one candidate, so the
  same-placed rule wins and a rematch is allowed (5+5 week 4 repeats an earlier cross pairing). The dedicated cross weeks prefer
  unmet opponents too, and repeat one only when no other is left ("where possible").
- **Standings.** Group tables count every match of their members, cross-group matches included; the combined table ranks by points per
  match while match counts differ (`src/lib/tournament/group-standings.ts`). `getLeagueSchedule` / `assembleLeagueSchedule`
  (`src/lib/supabase/queries/league-standings.ts`) add `groupStandings` and `standingsRanking` for a grouped league; the world payload
  carries them (`buildWorldRouteData`, one extra read: the league groups), and the hub's Standings tab shows the group tables first
  and the combined table below (matches column on every table, points per match on the combined one while it ranks by them). The
  hub's Group stage tab counts cross-group matches in league-mirrored phase groups too; its results grid keeps the in-group matches.
  Per-group advancement (`syncStandingsEnrollment`, `advancement_rule.per_group`) uses the same group tables.
  Tiebreaks: the Standings tab's group and combined tables, the placement week and the per-group Redraft order rank by points
  (then Buchholz and wins) WITHOUT kill difference, like the season table: they read no battle stats (the default league render
  reads none, `AGENTS.md` query budgets). The hub's Group stage tab ranks round-robin phase groups with kill difference (it reads
  the phase's battle stats), so on a points tie the two tabs can order trainers differently. Not yet unified; until then
  this is the documented behaviour (spec §6.4a).
- **Hinrunde per group.** `getGroupFirstHalfTables(seasonId)` (`src/lib/tournament/group-first-half.ts`): each league group's table
  over the primary phase's first `floor(weeks / 2)` planned weeks, best first (pass it to `computeRedraftSeats` unchanged: it returns
  the worst-first seats itself); `getGroupedPhaseWeekPlan(phaseId)` (`src/lib/tournament/phase-week-plan.ts`): the planned week count,
  which the rounds written so far undercount until the last week exists. The EPB Hinrunde gate uses the same boundary:
  `getEpbPhaseStatus` / `getHinrundeScope` (`src/lib/season/epb-phase.ts`) take it from the plan for a primary phase whose groups mirror
  league groups, and `hinrunde_complete` needs every Hinrunde week `1..floor(weeks / 2)` written and completed (a 7+7 phase after weeks
  1-4: Hinrunde = weeks 1-5, not complete until the placement week 5 is played). A stage without league groups keeps "first half of its
  written rounds".
- **Interrupted writes.** A week's round and its matches are two writes, and `generate-all-rounds` writes week after week, not in
  one transaction: a database error midway leaves the earlier weeks written. A grouped week whose round exists without matches
  (`roundsAwaitingMatches`) is filled into that round by the next `generate-round` / `generate-all-rounds`, never skipped or
  duplicated; the next call continues where the failed one stopped. (One RPC writing a round and its matches together would make it
  atomic; not done.)
- **Small and unequal groups (lead ruling round 4: accepted as is).** Cross-match balance: in-group weeks pair every trainer without
  an in-group match across groups (rule 1), so with unequal groups the members of a smaller (resting) group get more cross matches
  than the rest. The "same number per half" target holds for equal groups (7+7, 6+6, 5+5, 4+4+4: one regular cross match plus the
  placement match each half); for unequal groups it stays "where possible" (cross matches per trainer, placement included: 7+6 0-2 in
  the first half and 1-3 in the second; 7+6+6+6+6+6 1-2 and 0-3; 2+3+4+5+6+7 1-3 and 0-5; pinned in `group-schedule.test.ts`).
  Balanced TOTAL match counts matter more than equal cross counts, and the combined table ranks by points per match while counts
  differ, so no extra balancing rule applies. A dedicated cross week can hold a single match when exactly two trainers are short
  (3+3: week 6), while the other trainers have no match that week: accepted. A league with one league group shows one table (its
  group table is the combined table).
- **Membership drift is closed.** The Standings tab's group tables read the current league membership, the schedule and the Group
  stage tab the phase groups frozen at the first round; the schedule lock above (group editor and roster alike) keeps the two equal
  from that round on, and so do substitutions (league scope moves both slots; phase scope only within the same league group,
  `SUBSTITUTE_LEAGUE_GROUP_MISMATCH` above). The window between the mirror (`ensurePhaseGroupsFromLeague`) and the first round's insert is closed in the
  database (`20261019110000_league_groups_first_round_guard.sql`): the first round of a phase whose groups mirror league groups takes
  the season's advisory lock (the key the membership guard takes) and is refused when the phase groups no longer match the league
  groups and the enrollment (**409** `PHASE_GROUPS_STALE`, `errors/seasons`; nothing written, generating again re-mirrors the phase).
  A membership write that waits for that lock sees the round and is refused (`SEASON_GROUPS_SCHEDULED`). Both orders were proven
  with two sessions on the local stack.
  The hub's displayed phase status cannot prove a grouped phase with cross-group matches finished from its matches
  (`roundRobinComplete` sees one connected set): it keeps the stored status. The DOM-only league page fallback (`DefaultWorld`) shows
  the combined table only.
- **Deploy order.** Migrations first, then the code (as everywhere in this repo, README "Release order"): the league groups code
  reads `season_groups`, `draft_pools.season_group_id` and the lock functions without a missing-column fallback
  (`getDraftPoolsBySeasonWithGroups` and the editor's reads fail loudly on a schema that lacks them). Order:
  `20261018180000_league_groups.sql`, then `20261018202000_league_groups_locks.sql` and
  `20261018202100_league_groups_participant_lock.sql` and `20261019110000_league_groups_first_round_guard.sql`, then the code that reads `scheduleLocked` and calls `season_participant_remove`
  (the roster's removal fails with a missing-function error until that migration is applied).
  `getDraftPoolsBySeason` has no deploy-before-migrate guard either any more (lead ruling round 5: a missing-column error propagates).
- **Tests:** `src/lib/tournament/__tests__/group-schedule.test.ts` (7+7, 6+6, 7+6, 5+5, 4+4+4, one group, determinism, balance,
  placement rematch preference),
  `group-standings.test.ts`, `group-rounds.test.ts`, `group-first-half.test.ts`, `enrollment-sync-groups.test.ts`;
  the grouped EPB Hinrunde in `src/lib/season/__tests__/epb-phase.test.ts`;
  `src/app/api/tournaments/[id]/generate-all-rounds/__tests__/league-groups.test.ts`, the grouped cases in
  `src/app/api/generate-round/[tid]/__tests__/route.test.ts`, `src/app/api/seasons/[id]/phases/[phaseId]/groups/__tests__/league-managed.test.ts`;
  `src/lib/supabase/queries/__tests__/league-standings-groups.test.ts`; the first-round guard's mapping in
  `src/lib/supabase/queries/__tests__/rounds-games.test.ts`; the substitution lock in `src/lib/season/__tests__/substitute.test.ts`
  and `src/lib/supabase/queries/__tests__/seasons.test.ts`; the hub in `src/lib/league-hub/__tests__/{views,load}.test.ts`
  and `src/components/league/hub/__tests__/league-hub.test.tsx` (the ungrouped standings panel against the pre-groups markup,
  `fixtures/standings-ungrouped.head.html`); the world payload in `src/lib/worlds/__tests__/route-data.test.ts`; the locks in
  `src/lib/draft/__tests__/league-groups-migration.test.ts` (migration text), the roster rules in
  `src/app/api/seasons/[id]/participants/__tests__/route.test.ts` and `src/lib/supabase/queries/__tests__/season-groups.test.ts`, and the editor routes in
  `src/app/api/seasons/[id]/groups/__tests__/routes.test.ts`, the editor in `src/components/league/groups/__tests__/`.

## Usage Examples

```typescript
import { assignCoresFromPool } from '@/lib/season/core-assignment';
import { getFormatCapabilities } from '@/lib/season/format-utils';

const caps = getFormatCapabilities('evolution_point_buy'); // evolutionRedraft: true

const assignments = assignCoresFromPool(
  participants.map((p) => ({ playerId: p.id, coreTypes: p.core_types })),
  corePool,
  { force: false },
);
```

## Testing
- **Test Files**: `src/lib/season/__tests__/` — `core-assignment.test.ts`, `format-capabilities.test.ts`, `format-rules-defaults.test.ts`, `format-utils.test.ts`, `group-repair.test.ts` (planner), `substitute.test.ts` (substitution, incl. a fake league for resumable, concurrent and conditional applies); the substitute route in `src/app/api/seasons/[id]/participants/substitute/__tests__/route.test.ts`, the repair route in `src/app/api/seasons/[id]/phases/[phaseId]/groups/repair/__tests__/route.test.ts`, their admin controls in `src/components/league/__tests__/PhaseGroupRepair.test.tsx` and `SubstituteDialog.test.tsx` (dialog and roster-manager helpers), `SubstituteDialog.partial.test.tsx` and `SubstituteDialog.signal.test.tsx` (the partial-apply warning and the route's `partial` signal), the paged reads and conditional writes in `src/lib/supabase/queries/__tests__/substitution-writes.test.ts`.
- **Custom format tests**: `src/lib/season/__tests__/` — `season-started.test.ts`, `season-engine.test.ts`, `custom-seams.test.ts` and the `custom` rows of `format-capabilities.test.ts` and `format-utils.test.ts`; the attach, detach and type-change guards in `src/lib/format-studio/__tests__/attach.test.ts`, the stage mapping in `materialise.test.ts`, the routes in `src/app/api/seasons/[id]/format/__tests__/route.test.ts` and `src/app/api/formats/__tests__/cross-owner.test.ts`, the `PATCH` guard matrix in `src/app/api/seasons/[id]/__tests__/route.test.ts`, and the readiness pre-check in the `generate-round` and `generate-bracket` route tests.
- **Running Tests**: `npm run test src/lib/season/__tests__/`

## Related Modules
- [Evolution Point Buy](./evolution-point-buy.md)
- [Draft](./draft.md)
- [Tournament](./tournament.md)
- [Match](./match.md)
- [Reconcile](./reconcile.md)
- [Supabase](./supabase.md)
- [Auth](./auth.md)
- [Discord](./discord.md)
- [Social](./social.md)
- [Worlds](./worlds.md)
