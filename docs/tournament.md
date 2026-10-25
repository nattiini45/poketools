# Tournament Module

## Overview
The Tournament module provides pairing generation, standings/advancement logic, bracket structure/propagation for elimination formats, and match-state transition validation across supported bracket types. League **phases** are tournaments with `season_id` set; phase CRUD and enrollment live under `/api/seasons/[id]/phases/*`.

## File Structure
```
src/lib/tournament/
├── index.ts                 # Pairing dispatcher (Swiss/RR/legacy per-round SE/DE)
├── advancement.ts           # Advancement computation
├── bracket-structure.ts     # Full SE/DE slot graph (Bracket Engine v2)
├── bracket-generate.ts      # Generate / regenerate all elimination rounds
├── bracket-propagation.ts   # Materialize + un-materialize feeder slots
├── enrollment-sync.ts       # Standings → phase enrollment sync/freeze
├── league-phase.ts          # Phase editability guardrails
├── serpentine.ts            # Serpentine group assignment from seeds
├── double-elim.ts           # Legacy per-round DE pairings + bracket state
├── match-state.ts           # Match transition validation/state machine
├── round-robin.ts           # Round-robin pairings
├── single-elim.ts           # Traditional seeding + legacy SE pairings
├── standings.ts             # Standings computation
├── swiss.ts                 # Swiss pairings
├── types.ts                 # Shared tournament engine types
└── __tests__/
    ├── bracket-propagation.test.ts
    ├── bracket-structure.test.ts
    ├── serpentine.test.ts
    ├── double-elim.test.ts
    ├── match-state.test.ts
    ├── round-robin.test.ts
    ├── single-elim.test.ts
    ├── standings.test.ts
    └── swiss.test.ts
```

## Core Functions/Classes

### Bracket Engine v2 (elimination)
- **Files**: `bracket-structure.ts`, `bracket-generate.ts`, `bracket-propagation.ts`
- **Purpose**: Generate the complete SE/DE bracket upfront; lazy-match materialization on completion; un-propagation on reset
- **Key Methods**: `buildBracketStructureForParticipants()`, `buildBracketStructure()`, `generateEliminationBracket()`, `propagateBracketOnMatchComplete()`, `unpropagateBracketOnMatchReset()`, `repairBracket()`, `findSlotForMatch()`, `findMatchForSlot()`
- **Structure notes**:
  - **SE**: the championship round is named `Finals` (use this key in `bo_overrides`, e.g. `{ "Finals": 5 }`). Unaffected by `starting_bracket`.
  - **DE**: the last LB drop-in round is `Losers Finals` (WB-finals loser feeds it); GF is winner(WB Finals) vs winner(Losers Finals). LB drop-ins pair WB losers in **reversed index order** to avoid instant rematches. **n=2** with no LB starters: one WB match only; GF feeds from winner + loser of that match (no separate LB column).
  - **DE bracket reset** (per tournament, `tournaments.bracket_reset_enabled`, default on; migration `20261008200005_tournaments_bracket_reset_enabled.sql`): every DE graph (standard all-WB, `n=2`, LB starters) carries a `Grand Finals Reset` slot (`isBracketReset: true`, `appendBracketReset()`) in the GF round, fed winner(GF) vs loser(GF). `bracket-propagation.ts` skips it in bye resolution and materializes it only when the GF winner is not the WB champion (the LB champion handed them their first loss); its label reads "(if necessary)". `buildBracketStructureForParticipants(type, participants, { bracketResetEnabled })` builds without the slot when the toggle is off; generate, propagate, repair and unpropagate pass the tournament's setting.
    - **Toggle**: the RoundManager checkbox (double elim, before or after generation) or the create form; `PATCH /api/tournaments/[id]` with `{ bracket_reset_enabled }`, allowed at any phase status. A change runs `syncBracketResetSetting()`: switching off deletes an unplayed (scheduled, zero-game) reset match and keeps a played one; switching on runs `repairBracket()`, so a reset that is already due (the LB champion won a played GF) is created at once. A sync failure is logged and audited (`tournament.update` metadata) and never blocks the update; the public reads expire after the sync.
    - **Rendering**: `ElimBracketView` (phase page and league hub) always builds the graph with the reset slot and drops it through `unneededResetSlotKeys()`: when the GF went to the WB champion, or when the toggle is off and no reset match exists. A reset match that exists always renders.
  - **DE losers-bracket starts**: keep one seed-ordered participant list. `bracketStructureInputsFromParticipants()` derives `{ participantCount, lbStarterSeeds }` (1-indexed positions). WB is sized by WB starters and uses traditional seeding on that cohort; LB starters play a seeded Losers Round 1 **among themselves** (`buildSeededLosersRound1`, traditional seeding on the LB cohort; an odd starter gets a bye); WB R1 losers drop into Losers Round 2, and later WB rounds' losers drop in every other LB round. A single WB starter auto-advances and the LB starters consolidate alone. Extra LR1 width consolidates back to the standard drop-in width so every WB slot still feeds exactly one LB slot. All-LB rosters fall back to the standard all-WB graph. Every generate/propagate/repair/reset/public-render callsite must use `buildBracketStructureForParticipants()` so the graph stays identical.
  - **DE loss marks**: every double-elimination match card (the tournament phase page and the league hub share `ElimBracketView`) shows each entrant's losses going INTO that match as a small `{n} L` mark (German `{n} N`) with an sr-only "Losses before this match: n". `lossesEnteringMatches()` (`src/components/bracket/entry-losses.ts`) counts a losers-side starter's nominal loss plus the completed matches the player lost earlier in bracket order (round number, then `bracket_pos`; a match's own result never counts), so the Grand Final reads 0 against 1 and the reset 1 against 1. Single-elimination cards carry no mark. Tests: `src/components/bracket/__tests__/entry-losses.test.tsx`.
  - **Seeding UI**: `SeedingTable` is canonical (including the DE “start in losers” toggle). The PR #54 `SeedingBoard` was retired — see `docs/deprecations.md`.
  - **DB**: `matches (tournament_id, bracket_side, bracket_pos)` is unique when both are set (migration `20260822210000_matches_bracket_slot_unique.sql`).
- **Propagation**: `finalizeMatchCompletion` surfaces `propagation_failed: true` and audits `match.propagation_failed` when slot materialization fails after the match is already complete; admins can heal via repair-bracket.

### Legacy elimination fallback
- **Detection**: `isLegacyElimBracketData()` in `src/components/bracket/legacy.ts` — rounds lack `bracket_side` and/or matches lack `bracket_pos`. Zero rounds is **not** legacy (new tournaments use v2 UI).
- **Rendering**: `SingleElimBracket` / `DoubleElimBracket` accept `legacyMode` for flat per-round lists; public tournament page auto-detects.
- **Generation**: `RoundManager` shows per-round generate for legacy elim; `POST /api/generate-round/[tid]` returns **400** `BRACKET_V2_MANAGED` when structure-tagged rounds exist (use generate/regenerate-bracket instead).

### Enrollment sync
- **File**: `enrollment-sync.ts`
- **Purpose**: Auto-enroll phase participants from prior-phase standings; freeze on manual edit or bracket generation
- **Standings source**: `computeStandingsForSeason()` (EPB-aware league standings chain, not raw W-L only)
- **Guards**: `assertEnrollmentSyncAllowed(phaseId, force)` — without `force`, refuses when `enrollment_source.frozen` (`ENROLLMENT_FROZEN`) or rounds exist (`ENROLLMENT_ROUNDS_EXIST`). `sync-standings` and `POST /api/seasons/[id]/advance` accept `{ force: true }` to overwrite.
- **Used by**: `POST .../phases/[phaseId]/participants/sync-standings`, phase creation, `ParticipantManager` / `SeedingTable` re-import for season-linked stages

### Pairing Dispatcher
- **File**: `index.ts`
- **Purpose**: Dispatch next-round generation by bracket type (Swiss/RR still sequential)
- **Key Methods**: `generateRound()`

### Match State Validation
- **File**: `match-state.ts`
- **Purpose**: Enforce legal status transitions
- **Key Methods**: `isValidTransition()`, `validateTransition()`, `hasReachedBoThreshold()`

### Advancement Logic
- **File**: `advancement.ts`
- **Purpose**: Compute qualifying players for next stage
- **Key Methods**: `computeAdvancement()`

### Standings
- **File**: `standings.ts`
- **Purpose**: Compute ranked standings and pairing history
- **Key Methods**: `computeStandings()`, `buildPairingHistory()`, `havePlayed()`

### Bracket Engines (legacy per-round)
- **Files**: `single-elim.ts`, `double-elim.ts`, `round-robin.ts`, `swiss.ts`
- **Purpose**: Bracket-specific pairing algorithms for sequential round generation
- **Byes (Swiss / round robin)**: a generated round stores its byes in `rounds.bye_player_ids` (generate, generate-all and manual rounds). Swiss pairing reads them back through `buildPairingHistory`, so nobody gets a second bye while another player has had none. In Swiss standings a stored bye is a win worth `pointsPerWin`, with no games, kills or Buchholz contribution (`StandingsOptions.byes`, `scoringByeRecords` in `byes.ts`, loader `scoring-byes.ts`). A bye scores from the moment its round is generated, whatever the round's manual status (byes are awarded at pairing, an admin may never complete the last round, and resetting a round must not take its bye away). Round-robin byes score nothing. A grouped round robin phase follows the week plan and stores no bye; a grouped Swiss phase stores each group's bye. Evolution Point Buy leagues score no bye anywhere, whatever bracket type their stages have: not in the season tables, the stage and tournament tables, the standings preview, Insights (any scope), the league hub, profiles, or the AI and Kale text. One gate decides it, `formatScoresByes` (`byes.ts`), and every reader asks it before it reads a round, so an EPB league's rounds are not read for byes at all: `loadScoringByes` and `loadScoringByesBatch` (`scoring-byes.ts`) apply it to the `season_format_type` on the tournament row (`getTournamentById`, `getTournamentWithDetails` and `listTournamentsByIds` join it), and the readers that hold the league's format (the season-wide loaders, the standings preview, Insights, the league hub's groups tab and the broadcast standings, which pass the season's format) apply it to that format. The season-wide merged tables (league schedule, insights league scope, standings preview) score each Swiss stage's byes as wins too, so they agree with the stage tables: the rounds of all Swiss stages come in one read (`loadSeasonSwissByeRounds`), an EPB league skips it, and the merged table's rank movement leaves out the byes generated after the latest matchday (a later round of its stage, or any round of a later stage). Every merged table gives a win one point whatever its stage, so a bye is worth one point there. The recap and Kale prompts name the byes inside a record ("3W-1L, incl. 1 bye win without a match"), since a bye is a win with no match in the match list; they count exactly the byes the shown standings scored (none in an EPB league, none for a player the standings do not hold), never the raw rounds.
- **Double elim LB start (legacy per-round only)**: participants with `starting_bracket = 'losers'` are excluded from Winners R1 and carry one nominal loss in `computeBracketState()`. New brackets use engine v2 (above); do not wire `double-elim.ts` into v2 generate/propagate.

### Seeding
- **UI**: `SeedingTable` (via `ParticipantManager`) is the only seeding surface. Double-elim phases expose a per-player “start in losers” toggle while `status = 'upcoming'` (locked once rounds exist).
- **Persistence**: `PATCH /api/tournaments/[id]/participants` accepts `{ player_id, seed, starting_bracket? }`. The `starting_bracket` column is the data model; the PR #54 board modules were deleted.

## Data Flows
- **Input**: Participants, match history, bracket type, round number (or full seed list for v2)
- **Processing**:
  1. Swiss/RR: generate pairings round-by-round via `generateRound`
  2. SE/DE: `generateEliminationBracket` creates all rounds; propagation fills slots on match completion
  3. Validate match transitions as results are submitted
  4. Recompute standings and advancement
- **Output**: Pairings, bracket slots, validated transitions, standings, advancement sets

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Supabase Module](./supabase.md)
  - [Rating Module](./rating.md)

## API Routes
- `/api/tournaments` — standalone tournaments only (`season_id` rejected on POST)
- `/api/tournaments/[id]/generate-bracket` — full SE/DE bracket generation
- `/api/tournaments/[id]/regenerate-bracket` — destructive rebuild (cascade-resets played matches first; **409** `REGENERATE_PLAYED` without `cascade: true`)
- `POST /api/tournaments/[id]/repair-bracket` — re-run bye resolution + slot materialization after failed propagation (RoundManager "Repair bracket")
- `/api/seasons/[id]/phases` — phase list/create (`insert_at` in `1..highest stage_order + 1`, **400** `PHASE_INSERT_INVALID` outside it and **400** `PHASE_INSERT_LOCKED` when inserting before a started phase; **409** `PHASE_NAME_TAKEN` for a name another phase of the league has)
- `/api/seasons/[id]/phases/[phaseId]` — phase update/delete (season-linked PATCH locked: `PHASE_BRACKET_LOCKED`, `PHASE_STAGE_ORDER_LOCKED`, `PHASE_COMPLETED_LOCKED`; **409** `PHASE_NAME_TAKEN` on a rename; `{ status: 'active' }` on a completed phase reopens it)
- `/api/seasons/[id]/phases/reorder`
- `/api/seasons/[id]/phases/[phaseId]/participants` (+ `sync-standings` with optional `force`, `seed-by-rating`)
- `/api/seasons/[id]/phases/[phaseId]/groups` (+ `members`, `repair`: group rows left by pre-handover substitutions, see [Season](./season.md))
- `/api/tournaments/[id]/participants` — locked for started season phases (`PHASE_PARTICIPANTS_LOCKED` via `league-phase.ts`)
- `/api/tournaments/[id]/groups` (GET — public list)
- `/api/tournaments/[id]/rounds` and nested round/match routes
- `GET /api/tournaments/[id]/rounds/[rid]` — public round detail; matches leave as `PublicMatch`. **404** `Round not found` with `code: 'INVALID_ROUND_ID'` for a malformed (non-UUID) tournament or round id (checked before any query; PATCH checks the round id after its auth guard), plain **404** `Round not found` for an unknown round, **404** `Round does not belong to this tournament` when the round is another tournament's
- `/api/generate-round/[tid]` — Swiss/RR (and legacy per-round elim); **400** `BRACKET_V2_MANAGED` for structure brackets
- `POST /api/admin/matches/[id]/reset` — cascade un-propagates downstream; **409** `DOWNSTREAM_PLAYED` without `cascade: true`
- `POST /api/admin/rounds/[id]/reset` — same cascade semantics as match reset
- `DELETE /api/admin/rounds/[id]` — round delete; **400** `STRUCTURE_ELIM_ROUND_DELETE` for v2 elim rounds (use regenerate-bracket); runs `rebuildAggregatesForScope` after delete

## Standalone tournament settings
`PATCH /api/tournaments/[id]` (any tournament; resource admins of that tournament) edits name, ruleset, best-of and overrides, doubles, bracket type, team visibility, the grand-final reset and the status. League phases keep their own guards there (`PHASE_BRACKET_LOCKED`, `PHASE_STAGE_ORDER_LOCKED`, `PHASE_COMPLETED_LOCKED`) and additionally refuse a rename onto another phase's name (**409** `PHASE_NAME_TAKEN`). A **standalone** tournament (no `season_id`) locks three fields once it has **started** (`isTournamentStarted`, `src/lib/tournament/standalone-lock.ts`: status is not `upcoming`, or it has at least one round):

| Field | Refusal when changed after the start |
|---|---|
| `bracket_type` | **400** `tournament_bracket_locked` |
| `ruleset_id` | **400** `tournament_ruleset_locked` |
| `is_doubles` | **400** `tournament_doubles_locked` |

A value equal to the stored one passes (the settings form sends the whole object). The rounds are read (`getRoundsByTournament`) only when one of the three fields really changes. Name, `best_of_default`, `bo_overrides`, `team_visibility` and `bracket_reset_enabled` stay editable at any status, and a completed standalone tournament is not given the league phase's completed lock. The `tournament.update` audit diff records `name`, `status`, `archived`, `bracket_reset_enabled`, `bracket_type`, `ruleset_id`, `best_of_default`, `is_doubles`, `team_visibility` and `bo_overrides` (compared as key-sorted entries); the description is never logged.

- **Best-of is odd, 1 to 15.** Every best-of in the API (`best_of_default`, the values of `bo_overrides`, a round's `best_of`, a manual round's `best_of`) goes through `bestOfSchema` (see [Validation](./validation.md)); even values are **400** `validation_failed`. The pickers offer `BEST_OF_VALUES` (`src/lib/tournament/best-of.ts`) and merge a stored legacy even value in (`bestOfChoices`), so editing an old record does not silently change it. A record that already holds an even value keeps it until someone saves a different best-of on it. The phase `PATCH` parses the best-of leniently (any integer 1 to 15) because the phase form sends the whole record back, then refuses an even `best_of_default` or `bo_overrides` value that is not the one the phase already holds (`newEvenBestOfIssues`): saving a rename on such a phase works, picking a different even value is **400** `validation_failed`.
- **Group count is 2 to 26** (`phaseGroupsCreateSchema`, `MAX_SEASON_GROUPS`); the phase groups panel offers the same range.
- **Reopen.** `PATCH` with `{ status: 'active' }` on a completed tournament or phase writes only the status column (the same call "Mark completed" uses the other way). Matches, results, standings and rounds are untouched, and players already advanced into the next phase stay there. Completing it again emits the completion Discord and social events again.

Tests: `src/lib/tournament/__tests__/standalone-lock.test.ts`, `src/app/api/tournaments/[id]/__tests__/standalone-guards.test.ts`, `src/app/api/seasons/[id]/phases/[phaseId]/__tests__/patch.test.ts`.

## Match pages and admin round view
- **Public match page** `/tournaments/[id]/matches/[mid]`: 404 (`notFound()`) for a malformed id and for a match whose `tournament_id` is not `[id]`, so a match never renders under, or links back to, another tournament. The admin notes render only for a live site admin (`getLiveAccess().isSiteAdmin`; the read runs only when the match has notes and a viewer is signed in). Tests: `src/app/(public)/tournaments/[id]/matches/[mid]/__tests__/page.test.ts`.
- **Admin match pages** `/admin/matches/[id]` (override, `import-replay`, `games/[gid]/edit`): `AdminGuard` admits an admin of any resource, so each page also requires that the viewer administers this match: a site admin, or a resource admin of the match's tournament or its league (`canAdministerMatch` in `src/app/admin/matches/[id]/match-access.tsx`, live read, same rule as `POST /api/admin/matches/[id]/reset` and `/api/admin/games/[id]`). Anyone else gets "Access Denied" and never the notes. Tests: `src/app/admin/matches/[id]/__tests__/page.test.ts`.
- **RoundManager** (admin phase/rounds page): a failed round-detail fetch shows an error with a Retry in the expanded round (`fetchRoundMatches`, `RoundMatchesPanel`); "No matches in this round." means the round really has none. Tests: `src/components/tournament/__tests__/RoundManager.round-matches.test.tsx`.

## Usage Examples

```typescript
import { generateRound } from '@/lib/tournament';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';

const generated = generateRound(
  'swiss',
  participantIds,
  participantNames,
  matchHistory,
  roundNumber,
);

await generateEliminationBracket(tournament, participantsWithSeeds);
```

## Testing
- **Test Files**: `src/lib/tournament/__tests__/*`, `src/app/api/seasons/[id]/phases/__tests__/route.test.ts`, `src/app/api/tournaments/__tests__/season-id-reject.test.ts`
- **Running Tests**: `npm run test src/lib/tournament/__tests__/`

## Related Modules
- [Match Module](./match.md)
- [Season Module](./season.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)
