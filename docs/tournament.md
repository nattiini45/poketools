# Tournament Module

## Overview
The Tournament module provides pairing generation, standings/advancement logic, bracket structure/propagation for elimination formats, and match-state transition validation across supported bracket types. League **phases** are tournaments with `season_id` set; phase CRUD and enrollment live under `/api/seasons/[id]/phases/*`.

## File Structure
```
src/lib/tournament/
├── bipartite.ts             # Format-kit A-vs-B pairings: the pre-generated schedule (cyclic Latin rectangle in seed order) and the standings-based fallback
├── index.ts                 # Pairing dispatcher (Swiss/RR/legacy per-round SE/DE)
├── bracket-structure.ts     # Full SE/DE slot graph (Bracket Engine v2)
├── bracket-generate.ts      # Generate / regenerate all elimination rounds
├── bracket-propagation.ts   # Materialize + un-materialize feeder slots
├── enrollment-sync.ts       # Standings → phase enrollment sync/freeze
├── generate-options.ts      # Optional `{ start_round }` body of the three generate routes
├── league-phase.ts          # Phase editability guardrails
├── regenerate-guard.ts      # Refuses a bracket regeneration of a phase whose stage already ended (custom leagues)
├── serpentine.ts            # Serpentine group assignment from seeds
├── double-elim.ts           # Legacy per-round DE pairings + bracket state
├── match-state.ts           # Match transition validation/state machine
├── round-robin.ts           # Round-robin pairings
├── single-elim.ts           # Traditional seeding + legacy SE pairings
├── standings.ts             # Standings computation
├── startup-checklist.ts     # Pure start-up checklist of the round manager (what blocks Generate)
├── swiss.ts                 # Swiss pairings
├── types.ts                 # Shared tournament engine types
├── __tests__/
    ├── bracket-propagation.test.ts
    ├── bracket-structure.test.ts
    ├── generate-options.test.ts
    ├── serpentine.test.ts
    ├── double-elim.test.ts
    ├── match-state.test.ts
    ├── round-robin.test.ts
    ├── single-elim.test.ts
    ├── standings.test.ts
    ├── startup-checklist.test.ts
    └── swiss.test.ts
├── best-of.ts  # Best-of values of a match series
├── byes.ts, scoring-byes.ts  # Round byes and the byes a tournament's standings score
├── clinch-scenarios.ts  # Playoff clinch and elimination status of each player
├── evolution-standings.ts, head-to-head.ts  # Evolution Point Buy standings and head-to-head tiebreaker
├── group-first-half.ts, group-rounds.ts, group-schedule.ts, group-standings.ts  # League groups: first half, rounds, week plan and tables
├── phase-week-plan.ts  # The planned weeks of a phase whose groups mirror league groups
├── previous-round-guard.ts  # Refuses legacy elimination generation over unfinished matches
├── schedule-drift.ts  # Drift guard of the round-robin schedule
├── season-standings.ts, standings-rules.ts  # Format-aware standings entry point and the scoring rules it follows
├── seed-errors.ts  # Domain errors of the participant seed update
├── settings-patch.ts, standalone-lock.ts  # Standalone settings fields and their lock after the start
├── round-state.ts  # roundMachine: the status moves of a round (docs/state-machines.md); the round manager's actions
├── tournament-state.ts  # tournamentMachine: the status moves of a tournament or phase (docs/state-machines.md)
├── tournament-transition.ts  # updateTournamentWithStatus: checked, guarded status write and its effects (both PATCH routes)
└── startup-checklist.server.ts  # The server side of the start-up checklist
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
  - **SE third place** (per tournament, `tournaments.third_place_enabled`, default off; migration `20261104100000_third_place_match.sql`; a format stage with `pairing.third_place` sets it on attach): a single-elimination bracket of four or more players adds a match between the two semifinal losers (`isThirdPlace`, `THIRD_PLACE_BRACKET_POS = 1`), played in the final's round next to the final (position 0); every other bracket type ignores the flag. `bracket-propagation.ts` materializes it when both semifinals are decided; `isThirdPlaceMatch()` recognises it by its round and position. Existing brackets keep their graph.
    - **Toggle**: the create form and the settings editor (single elimination only), or `PATCH /api/tournaments/[id]` with `{ third_place_enabled }`, allowed at any phase status. A change runs `syncThirdPlaceSetting()`: switching off deletes a scheduled, zero-game third-place match and keeps a played one; switching on runs `repairBracket()`, so the match appears at once when both semifinals are decided. **Enabling after the final round is completed is a no-op**: a new match would sit in a finished round, so nothing is created and the sync result carries `skipped_final_completed: true` (the setting itself stays saved). A sync failure is logged, audited in the `tournament.update` metadata (`third_place_sync`, `third_place_sync_error`) and never blocks the update; the public reads expire after the sync.
  - **DE losers-bracket starts**: keep one seed-ordered participant list. `bracketStructureInputsFromParticipants()` derives `{ participantCount, lbStarterSeeds }` (1-indexed positions). WB is sized by WB starters and uses traditional seeding on that cohort; LB starters play a seeded Losers Round 1 **among themselves** (`buildSeededLosersRound1`, traditional seeding on the LB cohort; an odd starter gets a bye); WB R1 losers drop into Losers Round 2, and later WB rounds' losers drop in every other LB round. A single WB starter auto-advances and the LB starters consolidate alone. Extra LR1 width consolidates back to the standard drop-in width so every WB slot still feeds exactly one LB slot. All-LB rosters fall back to the standard all-WB graph. Every generate/propagate/repair/reset/public-render callsite must use `buildBracketStructureForParticipants()` so the graph stays identical.
  - **DE loss marks**: every double-elimination match card (the tournament phase page and the league hub share `ElimBracketView`) shows each entrant's losses going INTO that match as a small `{n} L` mark (German `{n} N`) with an sr-only "Losses before this match: n". `lossesEnteringMatches()` (`src/components/bracket/entry-losses.ts`) counts a losers-side starter's nominal loss plus the completed matches the player lost earlier in bracket order (round number, then `bracket_pos`; a match's own result never counts), so the Grand Final reads 0 against 1 and the reset 1 against 1. Single-elimination cards carry no mark. Tests: `src/components/bracket/__tests__/entry-losses.test.tsx`.
  - **Seeding UI**: `SeedingTable` is canonical (including the DE “start in losers” toggle). The retired `SeedingBoard` is gone — see `docs/deprecations.md`.
  - **DB**: `matches (tournament_id, bracket_side, bracket_pos)` is unique when both are set (migration `20260822210000_matches_bracket_slot_unique.sql`).
- **Propagation**: `finalizeMatchCompletion` surfaces `propagation_failed: true` and audits `match.propagation_failed` when slot materialization fails after the match is already complete; admins can heal via repair-bracket.

### Legacy elimination fallback
- **Detection**: `isLegacyElimBracketData()` in `src/components/bracket/legacy.ts` — rounds lack `bracket_side` and/or matches lack `bracket_pos`. Zero rounds is **not** legacy (new tournaments use v2 UI).
- **Rendering**: `SingleElimBracket` / `DoubleElimBracket` accept `legacyMode` for flat per-round lists; public tournament page auto-detects.
- **Generation (frozen)**: `POST /api/generate-round/[tid]` no longer starts an elimination bracket. With zero rounds it answers **400** `BRACKET_V2_REQUIRED` before reading anything (use `generate-bracket`); the Admin Assistant's `propose_start_phase` refuses the same phases when it stages the card. `POST /api/tournaments/[id]/rounds/manual` refuses a first round of an elimination phase with the same **400** `BRACKET_V2_REQUIRED` (an unstructured first round would let the legacy generator carry on), and the round manager disables Create Manual Round while Generate Bracket is offered. With structure-tagged rounds it answers **400** `BRACKET_V2_MANAGED`. A tournament that already holds legacy per-round elimination rounds still continues round by round, but the next round is refused with **409** `rounds_previous_matches_unfinished` while the previous round holds a match that is not completed (`generate-round` and `rounds/manual` share the guard, `assertLegacyEliminationRoundSettled`, and refuse before any write).

### Enrollment sync
- **File**: `enrollment-sync.ts`
- **Purpose**: Auto-enroll phase participants from prior-phase standings; freeze on manual edit or bracket generation
- **Standings source**: `computeStandingsForSeason()` (EPB-aware league standings chain, not raw W-L only)
- **Guards**: `assertEnrollmentSyncAllowed(phaseId, force)` — without `force`, refuses when `enrollment_source.frozen` (`ENROLLMENT_FROZEN`) or rounds exist (`ENROLLMENT_ROUNDS_EXIST`). `sync-standings` and `POST /api/seasons/[id]/advance` accept `{ force: true }` to overwrite; a forced sync (`phase.enrollment.sync`), a forced or hand-listed advance (`season.phase.advance`) and a manual round (`round.generate` with `manual: true`) leave an audit entry.
- **Concurrent syncs**: a kit phase fed by several edges is the sum of its sources (`enrollment_source.contributions`, `mergeKitContributions`). The write is a compare-and-set: `replacePhaseEnrollment` calls `tournament_enrollment_replace`, which locks the phase row, compares the stored `enrollment_source.synced_at` with the one the sync read and only then replaces the roster and the source in one transaction. A sync that lost the race reads and merges again (up to `ENROLLMENT_SYNC_MAX_ATTEMPTS`), so two sources that complete together keep both blocks; after the last attempt the call answers 409 `ENROLLMENT_SYNC_CONFLICT` and the caller repeats it.
- **Used by**: `POST .../phases/[phaseId]/participants/sync-standings`, phase creation, `ParticipantManager` / `SeedingTable` re-import for season-linked stages

### Pairing Dispatcher
- **File**: `index.ts`
- **Purpose**: Dispatch next-round generation by bracket type (Swiss/RR still sequential)
- **Key Methods**: `generateRound()`

### Match State Validation
- **File**: `match-state.ts`
- **Purpose**: Enforce legal status transitions
- **Key Methods**: `isValidTransition()`, `validateTransition()`, `hasReachedBoThreshold()`, `canReopenMatch()`
- **Player transitions**: `scheduled -> in_progress`, `in_progress -> pending_confirmation`, `pending_confirmation -> completed | disputed`, `disputed -> completed`.
- **Admin-only transitions** (`ADMIN_TRANSITIONS`, refused for non-admins with `match_reset_admin_only`):

  | From | Admin may also go to |
  |---|---|
  | `scheduled` | `completed` (the admin settle, `POST /api/admin/matches/[id]/result`; refused for a non-admin with `match_settle_admin_only`; `POST /api/confirm-match/[mid]` refuses it with 409 `match_settle_use_result_route`, because only the settle route requires the reason and writes the audit event) |
  | `in_progress` | `scheduled`, `completed`, `disputed` |
  | `pending_confirmation` | `in_progress`, `scheduled` |
  | `completed` | `scheduled`, `in_progress` |
  | `disputed` | `scheduled`, `in_progress` |

  The `in_progress` targets of `completed` and `disputed` are the reopen. `canReopenMatch(status)` is true for `completed`, `pending_confirmation` and `disputed` (`REOPENABLE_MATCH_STATUSES`); what a reopen reverses is in [Match](./match.md) ("Admin Match Page Verbs").

### Advancement
League phases advance through `syncStandingsEnrollment()` in `enrollment-sync.ts`: it ranks the source phase and enrolls the top N of the target phase's `advancement_rule` (overall, or per group). There is no separate advancement module.

### Standings
- **File**: `standings.ts`
- **Purpose**: Compute ranked standings and pairing history
- **Key Methods**: `computeStandings()`, `buildPairingHistory()`, `havePlayed()`
- **Evolution Point Buy tables**: `computeStandingsForFormat()` ranks them by the season's stored `format_rules.tiebreaker_order` (checked by `effectiveTiebreakerChain` in `standings-rules.ts`; a missing row or an unusable order falls back to the pack's `epb.tiebreakerChain`) and scores the pack's `epb.matchPoints` whatever points the caller passes (`effectiveMatchPoints`). Every other league type keeps its numbers: round robin 3 / 0 (`roundRobinMatchPoints`), Swiss and the generic default 1 / ½. A caller holding the season gets the stored order through `SeasonStandingsContext.tiebreakerOrder` (`loadSeasonStandingsContext`, the batched `loadSeasonStandingsContexts`, the world payload's format rules, or the cached `publicReads.seasonFormatRules`); saving format rules expires the league's and each phase's reads.

### Bracket Engines (legacy per-round)
- **Files**: `single-elim.ts`, `double-elim.ts`, `round-robin.ts`, `swiss.ts`
- **Purpose**: Bracket-specific pairing algorithms for sequential round generation
- **Swiss pairing** (`swiss.ts`): top-down Monrad order within the standings, but never a rematch when any pairing of the round avoids one: a bounded backtracking search (`SWISS_SEARCH_STEP_LIMIT`) pairs the highest-ranked unpaired player with the best-placed opponent it has not met and backtracks when the rest cannot be paired cleanly. With an odd count the bye goes to the lowest-placed player without a bye whose removal still leaves a rematch-free pairing. Only when no bye and pairing avoid every rematch does the lowest-placed bye candidate sit out and the others get the pairing with the fewest rematches (or the greedy pairing, with a warning, if the search runs out of steps).
- **Swiss pairing history counts every pairing**: `generate-round` reads `getPairedMatchRecords` (all matches whatever their status) for the "never a rematch" history, so a pairing that is still scheduled or in progress is never repeated; scores and tiebreaks still come from completed matches only (`GenerateRoundOptions.pairedMatches`).
- **Round robin schedule drift guard** (`schedule-drift.ts`): an ungrouped round robin schedule is recomputed from the current participant order on every call, so roster or seed changes after round 1 would shift it. Before the first write, `generate-round` and `generate-all-rounds` compare the pairings they are about to write with the matches of the rounds already generated (unordered pair, any status; the round being refilled is ignored). A pair that already exists in another round answers **409** `round_robin_schedule_drift` and nothing is written. The way out is a manual round (`POST /api/tournaments/[id]/rounds/manual`) or deleting the unplayed rounds and regenerating. Grouped phases follow their stored week plan and are not checked.
- **Games played**: counted per match id (`MatchRecord.match_id`, `gamesByMatch`), so a rematch of the same pair counts its own games and the round filter applies to games too. Legacy tables pass `gamesByMatch` for round robin only (a legacy Swiss table shows 0 games). Kit leagues count games for every bracket type: `loadKitStandingsData` reads one game count per match (`KitStandingsData.gameCounts`, `StageStandingsInput.gameCounts`), and a match present in `gamesByMatch` wins over its count. Kills (`kill_differential`) are the same shape: legacy and public round robin tables sum `battle_stats`, a Swiss table does not, and the kit's advancement, pairing and runtime tables read them for round robin stages only (`getPhaseBattleStats`), so they rank as the public page does.
- **Byes (Swiss / round robin)**: a generated round stores its byes in `rounds.bye_player_ids` (generate, generate-all and manual rounds). Swiss pairing reads them back through `buildPairingHistory`, so nobody gets a second bye while another player has had none. In Swiss standings a stored bye is a win worth `pointsPerWin`, with no games, kills or Buchholz contribution (`StandingsOptions.byes`, `scoringByeRecords` in `byes.ts`, loader `scoring-byes.ts`). A bye scores from the moment its round is generated, whatever the round's manual status (byes are awarded at pairing, an admin may never complete the last round, and resetting a round must not take its bye away). Round-robin byes score nothing. A grouped round robin phase follows the week plan and stores no bye; a grouped Swiss phase stores each group's bye. Evolution Point Buy leagues score no bye anywhere, whatever bracket type their stages have: not in the season tables, the stage and tournament tables, the standings preview, Insights (any scope), the league hub, profiles, or the AI and Kale text. One gate decides it, `formatScoresByes` (`byes.ts`), and every reader asks it before it reads a round, so an EPB league's rounds are not read for byes at all: `loadScoringByes` and `loadScoringByesBatch` (`scoring-byes.ts`) apply it to the `season_format_type` on the tournament row (`getTournamentById`, `getTournamentWithDetails` and `listTournamentsByIds` join it), and the readers that hold the league's format (the season-wide loaders, the standings preview, Insights, the league hub's groups tab and the broadcast standings, which pass the season's format) apply it to that format. The season-wide merged tables (league schedule, insights league scope, standings preview) score each Swiss stage's byes as wins too, so they agree with the stage tables: the rounds of all Swiss stages come in one read (`loadSeasonSwissByeRounds`), an EPB league skips it, and the merged table's rank movement leaves out the byes generated after the latest matchday (a later round of its stage, or any round of a later stage). Every merged table gives a win one point whatever its stage, so a bye is worth one point there. The recap and Kale prompts name the byes inside a record ("3W-1L, incl. 1 bye win without a match"), since a bye is a win with no match in the match list; they count exactly the byes the shown standings scored (none in an EPB league, none for a player the standings do not hold), never the raw rounds.
- **Double elim LB start (legacy per-round only)**: participants with `starting_bracket = 'losers'` are excluded from Winners R1 and carry one nominal loss in `computeBracketState()`. New brackets use engine v2 (above); do not wire `double-elim.ts` into v2 generate/propagate.

### Seeding
- **UI**: `SeedingTable` (via `ParticipantManager`) is the only seeding surface. Double-elim phases expose a per-player “start in losers” toggle while `status = 'upcoming'` (locked once rounds exist).
- **Persistence**: `PATCH /api/tournaments/[id]/participants` accepts `{ seeds: [{ player_id, seed, starting_bracket? }] }` (`seed` is a positive integer or `null`; duplicate non-null seeds are refused with **400** `tournament_seed_duplicate`). The `starting_bracket` column is the data model; the board modules of the retired `SeedingBoard` were deleted. A successful save is audited as `tournament.seeds.update` (participant and seeded counts); a refused or partly failed save writes no event.
- **The visible order is authoritative**: what the table shows is what Save writes. Dragging, moving up or down, shuffling and auto-seeding renumber every row 1..n by position (a previously unseeded row that is dragged becomes seeded at its position); typing a seed number re-sorts the list when the input is committed (blur or Enter), so list order and numbers never disagree. Duplicates a typed number creates are still reported on Save, never silently renumbered. Clear sends `null` for every row.

### Start-up checklist
- **Module**: `src/lib/tournament/startup-checklist.ts` (pure, client-safe). `buildStartupChecklist()` turns the participant summary, the rounds and the tournament's settings into the items shown above Generate in the round manager (standalone tournaments and league phases); the UI is `StartupChecklist` plus `useParticipantsSummary`, which reads the live participant count (the roster can change in another section or tab).
- **Setup items** (no round yet): participants (blocked below 2), ruleset, default best-of, league groups (only for a phase that mirrors league groups: blocked while a participant has no group) and seeding (attention only: unseeded participants are ordered by name). **Next-round items** (rounds exist; Swiss, round robin, legacy elimination): previous round (blocked until the last round is completed; not for round robin, which can be generated ahead) and, for a round robin without groups, the rounds remaining (blocked once every circle-method round exists, attention when a gap sits below the last round number).
- **What blocks Generate**: only items in the `blocked` state disable Generate Bracket, Generate Next Round and Generate All Rounds; an unknown participant list never does. A roster that fails to load is unknown, not empty: `ParticipantManager` announces only a roster it read (`loadParticipants` returns `participants: null` otherwise), so a failed read cannot block Generate. The server stays the authority and enforces the same rules (`tournament_participants_too_few`, `tournament_current_round_incomplete`, `rounds_all_generated`). Manual round creation is not gated. An elimination bracket the bracket engine already built, and a completed tournament, have no items.
- **Pending rounds**: `nextRoundToStart()` returns the lowest-numbered pending round whose earlier rounds are all completed; the round manager shows a banner with a one-click Start for it, since a generated round stays pending (players cannot report) until it is started. Generate also offers a default-off "Start the new round right away" option (the optional `start_round` body below).
- **Round robin size**: `roundRobinProgress()` gives the round count (n - 1 for an even field, n for an odd one), how many exist and the first missing one; with groups the week plan decides and the UI relies on the `rounds_all_generated` answer.

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
- `/api/tournaments/[id]/generate-bracket` — full SE/DE bracket generation. Optional body `{ "start_round": true }` also marks the first round active (best effort; the result then carries `started_round_id`, otherwise the result is exactly `{ rounds_created, matches_materialized }`). **400** `tournament_participants_too_few` below 2 participants, **409** `bracket_already_generated` once rounds exist. Audited as `bracket.generate`
- `/api/tournaments/[id]/regenerate-bracket` — destructive rebuild (cascade-resets played matches first; **409** `REGENERATE_PLAYED` without `cascade: true`; **409** `bracket_regenerate_phase_completed` before anything is written for a phase of a custom league whose stage already ended, so a closed phase is never wiped and restarted behind the format's back: reopen the phase first; a phase of a league without an attached format keeps the old behaviour). A cascade is audited as `bracket.generate` with `metadata.regenerated: true` and `completed` (false when it stopped part-way), and always expires the match pages, ratings and player reads it rolled back. Both bracket routes apply the kit league's first-round gate and announce the first round like the round generators (see [Format kit](./format-kit.md)); `?force=true` overrides the gate
- `POST /api/tournaments/[id]/repair-bracket` — re-run bye resolution + slot materialization after failed propagation (RoundManager "Repair bracket")
- `/api/seasons/[id]/phases` — phase list/create (`insert_at` in `1..highest stage_order + 1`, **400** `PHASE_INSERT_INVALID` outside it and **400** `PHASE_INSERT_LOCKED` when inserting before a started phase; **409** `PHASE_NAME_TAKEN` for a name another phase of the league has)
- `/api/seasons/[id]/phases/[phaseId]` — phase update/delete (season-linked PATCH locked: `PHASE_BRACKET_LOCKED`, `PHASE_STAGE_ORDER_LOCKED`, `PHASE_COMPLETED_LOCKED`; **409** `PHASE_NAME_TAKEN` on a rename; `{ status: 'active' }` on a completed phase reopens it)
- `/api/seasons/[id]/phases/reorder`
- `/api/seasons/[id]/phases/[phaseId]/participants` (+ `sync-standings` with optional `force`, `seed-by-rating`)
- `/api/seasons/[id]/phases/[phaseId]/groups` (+ `members`, `repair`: group rows left by pre-handover substitutions, see [Season](./season.md))
- `/api/tournaments/[id]/participants` — locked for started season phases (`PHASE_PARTICIPANTS_LOCKED` via `league-phase.ts`); an `active` phase of an attached format answers 409 `format_phase_owned` instead and takes the change with `force: true` and a `reason` (audited `phase.roster.force`; see [Format Kit](./format-kit.md))
- `/api/tournaments/[id]/groups` (GET — public list)
- `/api/tournaments/[id]/rounds` and nested round/match routes. **Round numbers are unique per tournament**: `rounds_tournament_round_number_key` (`UNIQUE (tournament_id, round_number)`). A second writer of the same number (two admins generating at once, a retry racing the first call) gets **409** `rounds_round_already_written` from `generate-round`, `generate-all-rounds`, `generate-bracket` and `rounds/manual`; the loser of a bracket race fails on its first round and writes nothing. The migration raises an exception instead of deleting when duplicate round numbers exist. The constraint does not cover the "reuse an empty round" path (a grouped round robin week, or a retry after an interrupted call): two concurrent callers that both find the same empty round can both fill it. A sequential retry is safe (a round that already has matches answers 409 `rounds_round_already_written`). No unique index on a round's pairings guards it: the e2e seed and the local database tests insert several matches for one pair in one round, so such an index would break them. Closing the concurrent case needs a transactional generate RPC, which is a separate change.
- `PATCH /api/tournaments/[id]/rounds/[rid]` — `{ status: 'completed' }` is refused with **409** `round_matches_unfinished` (`{round, count}`) while the round holds a match that is not `completed`, for every bracket format. The first check is a read that precedes every write of the request, so the refusal writes nothing. The locked recheck below can still refuse after a `best_of` change of the same request was written (a match appeared in between); it then completes nothing, writes no `deadline`, audits nothing and fires nothing, and repeating the request converges. A resource admin may complete it anyway with `{ status: 'completed', force: true, reason }` (`reason` 1–500 characters, required with `force`; `force` is valid only with `completed`): the matches stay as they are and the call is audited as `round.force_complete` with the status change and `{ tournament_id, round_number, unfinished_matches, reason }`. A force on a round with no open match writes no audit row. The audit row, the `round_completed` Discord/social event and the recap belong to the one call that really moves the round to `completed`: the status change is the database function `round_complete(round, force)` (`completeRound`), which locks the round row `FOR UPDATE` and counts the unfinished matches again under that lock: a challenge accepted since the first read is counted (the call is refused with the same **409**, or forced and audited with the count it really left open), and one accepted after it finds the round completed, because an accept locks the round `FOR SHARE` before it inserts its match. Only the call that moves the round gets it back, so a repeated PATCH (a retry, or two overlapping submissions) on an already completed round answers **200** with the round, even without `force` while matches stay open, and writes, audits and emits nothing. `RoundManager` disables Complete with "N matches are still open" and offers "Complete anyway" with a required reason field.
- `GET /api/tournaments/[id]/rounds/[rid]` — public round detail; matches leave as `PublicMatch`. **404** `Round not found` with `code: 'INVALID_ROUND_ID'` for a malformed (non-UUID) tournament or round id (checked before any query; PATCH checks the round id after its auth guard), plain **404** `Round not found` for an unknown round, **404** `Round does not belong to this tournament` when the round is another tournament's
- `/api/generate-round/[tid]` — Swiss/RR (and legacy per-round elim); **400** `BRACKET_V2_MANAGED` for structure brackets; **400** `rounds_all_generated` for a round robin past its last circle-method round (nothing is written). Optional body `{ "start_round": true }` also starts the new round (`pending` → `active`); the start is best effort, so if it fails the round comes back `pending` with **201** and the round manager's banner offers Start. No body, or `false`, leaves the round pending as before. Anything else in the body is a **400** `validation_failed`. Audited as `round.generate`
- `/api/tournaments/[id]/generate-all-rounds` — every missing round robin round (grouped phases follow their week plan); **400** `rounds_all_generated` when none is missing. The same optional `{ "start_round": true }` starts only the lowest-numbered round this call created, the others stay pending. Audited once per call as `round.generate`
- **Kit leagues (custom format on the `kit` engine).** `POST /api/generate-round/[tid]`, `POST /api/tournaments/[id]/generate-all-rounds` and `POST /api/tournaments/[id]/rounds/manual` share the helpers of `src/lib/format-engine/route-guards.ts`, so a round reads the same whichever route wrote it. Guards: the generators refuse a stage nobody may pair for them (a `manual` pairing stage answers 409 `rounds_manual_pairing`, a challenge ladder 409 `rounds_challenge_ladder`; their rounds are created in the manual round editor), a phase whose stage reached its `end_when` bound answers 409 `rounds_stage_ended`, and the first round of a format with a draw or a gift form answers 409 `format_not_ready` (`?force=true`, audited `season.format.round.force_start` once the round is written; a relation that a `stage_start` or `round_start` rule draws right after the round does not block it). All three write the round and its matches in one transaction under the phase lock (`round_write`, `createRoundWithMatches`; an existing empty round gets its matches, and the new byes of a retry, through `addMatchesToRound` in the same transaction): a phase completed after the guards above read it answers 409 `rounds_phase_completed` and nothing is written, and a concurrent generation of the same round number answers 409 `rounds_round_already_written`. A `generate-all-rounds` batch refused part-way keeps the earlier rounds it wrote, each with its matches, and generating again continues from there. Every round written by any of the three gets its deadline from the stage calendar, fires `stage_start` (when it opens the phase) and `round_start` for the format's rules, and opens a `pairing_forbidden` or rematch check when a filtered or Swiss round could not avoid one; generate-all and manual used to activate a kit phase without any of this and now run it for each round they write. A bipartite stage pairs from the pre-generated schedule of `buildBipartiteSchedule` (a cyclic Latin rectangle built from the two sides in seed order: in round `r` the `i`-th player of the smaller side meets the `(i + r) mod m`-th of the larger side, so over `max(|A|, |B|)` rounds every A meets every B exactly once whatever the standings do); a pair already played moves the round to the next schedule round, and only when every meeting has happened does the standings-based search take over, reporting the extra meetings as rematches. Concurrent first-round generation cannot duplicate groups (`uq_tournament_groups_tournament_group_number`, with the loser answering 409 `groups_forming_in_progress`). See [Format Kit](./format-kit.md#format-engine-and-runtime).
- `POST /api/admin/matches/[id]/reset` — cascade un-propagates downstream; **409** `DOWNSTREAM_PLAYED` without `cascade: true`; optional `reason` (audit metadata)
- `GET /api/admin/matches/[id]/reset-preview` — read-only: games removed, whether ratings are rebuilt, the played later bracket matches a cascade also resets
- `POST /api/admin/matches/[id]/reopen` — `completed`, `pending_confirmation` or `disputed` back to `in_progress` with games kept; `reason` required; **409** `match_reopen_downstream_played` when a later bracket match was played (a game edit or delete in that case asks for approval instead: **409** `game_change_downstream_played`, then `confirm_downstream`, see [Match](./match.md)); a reopen of a completed match in a phase whose stage already ended carries `stage_already_ended` in its result
- `PATCH /api/admin/matches/[id]/schedule` — set, change or clear `scheduled_at`; **409** `match_schedule_completed` for a completed match; cancels pending time proposals
- `GET /api/admin/matches/[id]/history` — paged audit history of the match and its games
- `POST /api/admin/rounds/[id]/reset` — same cascade semantics as match reset
- `DELETE /api/admin/rounds/[id]` — round delete; **400** `STRUCTURE_ELIM_ROUND_DELETE` for v2 elim rounds (use regenerate-bracket); runs `rebuildAggregatesForScope` after delete; each non-scheduled match is taken back with `resetMatch`, and the first `stage_already_ended` notice of those resets (a completed format phase that already advanced players) is returned in `data.stage_already_ended` and audited as `stage_already_ended: true`, next to `format_revert_failed`

## Standalone tournament settings
`PATCH /api/tournaments/[id]` (any tournament; resource admins of that tournament) edits name, ruleset, best-of and overrides, doubles, bracket type, team visibility, the grand-final reset and the status. League phases keep their own guards there (`PHASE_BRACKET_LOCKED`, `PHASE_STAGE_ORDER_LOCKED`, `PHASE_COMPLETED_LOCKED`) and additionally refuse a rename onto another phase's name (**409** `PHASE_NAME_TAKEN`). A **standalone** tournament (no `season_id`) locks three fields once it has **started** (`isTournamentStarted`, `src/lib/tournament/standalone-lock.ts`: status is not `upcoming`, or it has at least one round):

| Field | Refusal when changed after the start |
|---|---|
| `bracket_type` | **400** `tournament_bracket_locked` |
| `ruleset_id` | **400** `tournament_ruleset_locked` |
| `is_doubles` | **400** `tournament_doubles_locked` |

`ruleset_id` is the **pin** (the id of an immutable ruleset version): any change runs `assertRulesetUsable` first (the ruleset exists and the actor may see it). After the start the ruleset only moves to another version of the same ruleset, through `POST /api/ruleset-definitions/[id]/pins` ([Ruleset Studio](./ruleset-studio.md#pins-and-their-moves)); a plain edit of a started phase answers `409` `ruleset_pin_started` for a league phase, and the standalone tournament lock above applies to it.

A value equal to the stored one passes (the settings form sends the whole object). The rounds are read (`getRoundsByTournament`) only when one of the three fields really changes. Name, `best_of_default`, `bo_overrides`, `team_visibility` and `bracket_reset_enabled` stay editable at any status, and a completed standalone tournament is not given the league phase's completed lock. The `tournament.update` audit diff records `name`, `status`, `archived`, `bracket_reset_enabled`, `bracket_type`, `ruleset_id`, `best_of_default`, `is_doubles`, `team_visibility` and `bo_overrides` (compared as key-sorted entries); the description is never logged.

- **Best-of is odd, 1 to 15.** Every best-of in the API (`best_of_default`, the values of `bo_overrides`, a round's `best_of`, a manual round's `best_of`) goes through `bestOfSchema` (see [Validation](./validation.md)); even values are **400** `validation_failed`. The pickers offer `BEST_OF_VALUES` (`src/lib/tournament/best-of.ts`) and merge a stored legacy even value in (`bestOfChoices`), so editing an old record does not silently change it. A record that already holds an even value keeps it until someone saves a different best-of on it. The phase `PATCH` parses the best-of leniently (any integer 1 to 15) because the phase form sends the whole record back, then refuses an even `best_of_default` or `bo_overrides` value that is not the one the phase already holds (`newEvenBestOfIssues`): saving a rename on such a phase works, picking a different even value is **400** `validation_failed`.
- **Group count is 2 to 26** (`phaseGroupsCreateSchema`, `MAX_SEASON_GROUPS`); the phase groups panel offers the same range.
- **Reopen.** `PATCH` with `{ status: 'active' }` on a completed tournament or phase writes only the status column (the same call "Mark completed" uses the other way). Matches, results, standings and rounds are untouched, and players already advanced into the next phase stay there. Completing it again emits the completion Discord and social events again.
- **Status moves.** The status goes through `tournamentMachine` (`src/lib/tournament/tournament-state.ts`, [State machines](./state-machines.md)): upcoming to active or completed, active to completed, completed to active. Nothing moves a tournament or phase back to `upcoming` (**409** `state_transition_invalid`). Both `PATCH /api/tournaments/[id]` and `PATCH /api/seasons/[id]/phases/[phaseId]` write it through `updateTournamentWithStatus` (`src/lib/tournament/tournament-transition.ts`): a compare-and-set on the status read (**409** `tournament_status_changed` when it moved meanwhile), then the format reaction, the auto advance and the completion announcement, so a phase completed from either page has the same effects.

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
