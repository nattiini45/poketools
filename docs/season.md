# Season Module

> Leagues ("seasons") — creation, participants, format gating, Core Liga type-core assignment, and EPB lifecycle (format rules, redraft, tokens, advancement). Route contract lives in [`poketools-spec.md` §5](./poketools-spec.md).

## Overview
A **season** (a.k.a. league) is the top-level container: it groups participants, tournaments/stages, a ruleset, and (for Evolution Point Buy) a point-buy list and format rules. `src/lib/season/*` holds pure league-scoped logic; the Supabase persistence layer lives in `src/lib/supabase/queries/seasons.ts`, and the REST surface is `src/app/api/seasons/**`.

## File Structure
```
src/lib/season/
├── core-assignment.ts      # Seeded random assignment of 3-type cores
├── epb-phase.ts            # Hinrunde (first-half) completion detection
├── format-capabilities.ts  # Per-format capability flags
├── format-rules-defaults.ts# EPB default rules + auto-initialization
├── format-utils.ts         # Format predicates + EPB route gate
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
- **`getFormatCapabilities(format)`** — `format-capabilities.ts` — returns the frozen capability config for a `SeasonFormatType` (`singles`, `doubles`, `draft`, `evolution_point_buy`).
- **`isDraftLike` / `isEvolutionPointBuy` / `assertEpbSeason`** — `format-utils.ts` — format predicates; `assertEpbSeason` throws a `UserFacingError` (404/400) for non-EPB seasons, gating all EPB-only routes.
- **`EPB_DEFAULT_RULES` / `initializeEpbFormatRules(seasonId)`** — `format-rules-defaults.ts` — default EPB ruleset (budget, picks, token ratio and caps, bans, Tera, tiebreakers from the active format pack's `epb.defaults`; `docs/format-packs.md`) upserted on EPB season creation.
- **Query layer** — `src/lib/supabase/queries/seasons.ts` — `listSeasons`, `listArchivedSeasons`, `listSeasonsByIds`, `listAllSeasonIds`, `getSeasonById`, `getSeasonWithDetails`, `createSeason`, `updateSeason`, `deleteSeason`, `getSeasonsByPlayer`; participants (`getSeasonParticipants`, `addSeasonParticipant`, `removeSeasonParticipant`, `updateParticipantGymType`); cores (`getCorePool`, `setCorePool`, `updateParticipantCoreTypes`, `getParticipantCore`, `setParticipantCores`).

## Data Flows

- **Input**: Season/participant/form data via Zod-validated route bodies; `seasons` + `season_participants` rows.
- **Processing**:
  1. `POST /api/seasons` creates the row and, for EPB, auto-initializes format rules and best-effort binds the active point-buy list version.
  2. Participants are added/removed and their `gym_type` / `core_types` updated (core updates validated against the pool + unique index).
  3. `POST …/cores/assign` runs the seeded shuffle and bulk-writes normalized triples.
  4. EPB lifecycle: format rules gate draft/kill tokens, redraft (free swaps + consent-mediated trades), progress corrections, and evolution-point recalc.
- **Output**: `SeasonWithDetails` (participant/tournament counts, ruleset name), core pool/assignments, EPB phase/redraft/token state, advancement results.

## Dependencies

- **External Libraries**: `node:crypto` (`randomInt`), `server-only`, `zod` (route validation).
- **Internal Modules**:
  - [Supabase](./supabase.md) — `seasons` + `format-rules`/`point-buy-lists`/`evolutions`/`epb-token-grants`/`redraft`/`redraft-trade-requests` queries.
  - [Evolution Point Buy](./evolution-point-buy.md) and [Draft](./draft.md) — `progress-engine`, `point-buy-engine`, `redraft-engine`, `trade-consent`, `evolution-points-engine`.
  - [Tournament](./tournament.md) — `computeAdvancement` (stage advancement).
  - [Auth](./auth.md) — `requirePlayer` / `requireResourceAdmin` / `requireAnyAdmin` / `requireAdmin`.
  - [Reconcile](./reconcile.md) — `rebuildAfterSeasonDelete` on DELETE.
  - [Discord](./discord.md) and [Social](./social.md) — season-advance notifications.

## API Routes

- `GET/POST /api/seasons` — list active leagues, test leagues excluded / create (archived list requires admin); create accepts an optional `route_theme` (`routeThemeSchema`, default `auto`).
- `GET /api/seasons/me` — leagues the current player participates in.
- `GET/PATCH/DELETE /api/seasons/[id]` — details / update (point-buy rebind, archive, test-league flag, `route_theme` 3D world pin) / delete (cascade + derived-data rebuild). How `route_theme` resolves against `?world=` and the format auto-map: [Worlds](./worlds.md).
- `GET/POST/DELETE/PATCH /api/seasons/[id]/participants` — list (redacted) / add / remove / update `gym_type` + `core_types`.
- `GET/PATCH /api/seasons/[id]/cores` — read pool + assignments / replace pool.
- `POST /api/seasons/[id]/cores/assign` — seeded random core assignment.
- `POST /api/seasons/[id]/draft-tokens` — allocate post-draft tokens (one-shot per player).
- `GET/POST /api/seasons/[id]/kill-tokens` — earned kill tokens / distribute (redraft phase only).
- `GET/POST /api/seasons/[id]/progress` — evolution progress / admin correction.
- `GET/PUT /api/seasons/[id]/format-rules` — read / upsert EPB format rules.
- `POST /api/seasons/[id]/evolution-points/recalculate` — rebuild evolution-point counters.
- `GET/POST /api/seasons/[id]/redraft` — redraft state / execute free swap (trades → pending request).
- `GET/PATCH /api/seasons/[id]/redraft/phase` — redraft phase status / open/close (requires Hinrunde complete).
- `POST /api/seasons/[id]/redraft/trade-request` — initiate two-sided trade (pending consent).
- `GET /api/seasons/[id]/redraft/trade-requests` — pending requests (own; admins get all).
- `POST /api/seasons/[id]/redraft/trade-request/[rid]/consent|cancel` — consent / cancel a trade request.
- `POST /api/seasons/[id]/advance` — advance players to the next completed→upcoming stage (delegates to `syncStandingsEnrollment`; accepts `{ force: true }` to overwrite frozen enrollment or existing rounds)

## Test leagues

- `seasons.is_test_season` marks a league kept for testing. Site admins set it on the admin league page (**Test League** section: *Test league — excluded from public lists and all-time stats*), which PATCHes `{ is_test_season }` to `/api/seasons/[id]`. The flag is site-admin only: a league (resource) admin who sends it gets **403** before anything is written; a non-boolean is a **400**. A change is one `updateSeason` write, audited as `season.set_test_flag` (`metadata.is_test_season`), and expires the league's reads and the season list (`expireSeasonReads`).
- Public league lists leave test leagues out: `listSeasons()` filters them by default, so `/leagues`, the home page teaser and the insights scope picker (all through `publicReads.seasonList`) and `GET /api/seasons` never show one; the creator content dashboard reads the same list. Admin lists pass `{ includeTestSeasons: true }` and badge them **Test**. A test league stays reachable by its own URL (`getSeasonById` / `getSeasonWithDetails` do not filter).
- All-time stats: each game freezes `games.exclude_all_time` when it is recorded (`shouldExcludeFromAllTime`), so the flag applies to games recorded after it is set; earlier games stay in the all-time aggregates, and clearing the flag does not bring excluded games back.

## League phases & enrollment

Phase CRUD and per-phase enrollment live under `/api/seasons/[id]/phases/*` (see [Tournament](./tournament.md)). League-scoped highlights:

- **Auto-sync / freeze**: `enrollment_source` on each phase tracks `{ type, source_phase_id, synced_at, frozen }`. Unfrozen phases re-sync from the prior phase table on create; first manual seed/participant edit or bracket generation freezes enrollment.
- **Re-sync guards**: `assertEnrollmentSyncAllowed` blocks `sync-standings` and `advance` when frozen (`ENROLLMENT_FROZEN`) or rounds exist (`ENROLLMENT_ROUNDS_EXIST`) unless the client sends `{ force: true }` (SeedingTable prompts on re-import).
- **Seeding writes** (`updateParticipantSeeds`, behind `PATCH /api/tournaments/[id]/participants`, `PATCH …/phases/[phaseId]/participants` and `POST …/participants/seed-by-rating`): `tournament_participants_seed_unique` is a non-deferrable unique index on `(tournament_id, seed)`, so the old one-UPDATE-per-row write failed with a 500 as soon as two players traded seeds, with some rows already rewritten. The write now reads the current seeds once, refuses a requested seed held by a player outside the request (**409** `SEED_CONFLICT`, nothing written), clears every changing seed to null in one UPDATE, then writes the new values (rows that do not change are not written). A failure after that clear is **500** `SEED_UPDATE_PARTIAL` (the route still expires the phase's reads; saving the seeding again completes it); a failure before any write keeps the generic 500. Errors: `src/lib/tournament/seed-errors.ts`; tests: `src/lib/supabase/queries/__tests__/participant-seeds.test.ts` (a fake that enforces the index).
- **Standings source**: enrollment uses `computeStandingsForSeason()` so EPB leagues advance by the full standings chain, not raw W-L.
- **Phase insert**: `POST .../phases` accepts optional `insert_at`; inserting before a non-`upcoming` phase returns **400** `PHASE_INSERT_LOCKED`.
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
- **Guest claim** (`POST /api/players/[id]/claim`): transfers auth from a fresh empty account onto a guest row; **409** `SOURCE_HAS_ACTIVITY` when the source account has any season/tournament/match/team/proposal/draft/wiki/EPB activity (use substitute instead).

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
