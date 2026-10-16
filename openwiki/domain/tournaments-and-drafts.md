# Tournaments & Drafts

> Tournament management, match lifecycle, draft engines, and replay parsing.

## Tournament Engine

**Docs:** `docs/tournament.md`

The tournament module provides pairing generation, standings computation, advancement logic, and match-state validation across four bracket types.

### Supported bracket types
- **Single elimination** — `src/lib/tournament/single-elim.ts`
- **Double elimination** — `src/lib/tournament/double-elim.ts`
- **Round robin** — `src/lib/tournament/round-robin.ts`
- **Swiss** (Monrad/Dutch) — `src/lib/tournament/swiss.ts`

### Key components

| File | Purpose |
|---|---|
| `src/lib/tournament/index.ts` | Pairing dispatcher — `generateRound()` routes to the correct engine |
| `src/lib/tournament/match-state.ts` | Match transition validation state machine |
| `src/lib/tournament/standings.ts` | Standings computation: `computeStandings()`, `buildPairingHistory()` |
| `src/lib/tournament/advancement.ts` | Advancement logic: `computeAdvancement()` |
| `src/lib/tournament/types.ts` | Shared tournament engine types |

### Match State Machine

`src/lib/tournament/match-state.ts` enforces legal status transitions. Legal transitions are defined in Spec §8. Key functions:
- `isValidTransition(from, to)` — boolean check
- `validateTransition(from, to)` — throws on illegal transition
- `hasReachedBoThreshold(results, bestOf)` — best-of-N completion check

**Rule:** No direct status overwrites. Every match status change must go through `validateTransition()`.

### Data flow
1. Admin creates tournament with bracket type and ruleset
2. `generateRound()` produces pairings for the current round
3. Players submit results → `validateTransition()` checks legality
4. `updateAggregates()` recomputes stats on game/match writes
5. `computeStandings()` ranks players; `computeAdvancement()` determines who moves forward

## Match Lifecycle

**Docs:** `docs/match.md`

Matches are the atomic competition unit. A match links two players, belongs to a round, and contains one or more games.

### Result submission paths
- **Replay import** — Parse Pokémon Showdown replay URL (`POST /api/parse-replay`)
- **Manual result** — Direct stat entry (`POST /api/manual-result`)
- **Admin import** — Admin replay import with manual assign (`POST /api/admin/matches/[id]/replay-import`)

### Key files
- `src/lib/match/aggregation.ts` — `updateAggregates()` — recomputes stats on game/match writes
- `src/lib/match/result-effects.ts` — Post-result side effects (achievements, streaks, social, Discord)

### Match proposals
- `src/lib/supabase/queries/match-proposals.ts` — Proposal/counter-offer flow for scheduling
- `src/components/match/MatchSchedulingPanel.tsx` — UI for proposing and confirming match times

## Draft System

**Docs:** `docs/draft.md`

Draft leagues let participants build teams through a structured pick process.

### Draft types
- **Snake draft** — Alternating direction each round
- **Linear draft** — Same order each round

### Key components

| File | Purpose |
|---|---|
| `src/lib/draft/engine.ts` | Draft state computation, pick validation, order generation |
| `src/lib/draft/evolution-engine.ts` | Evolution-league progression tracking and validation |

### Core functions
- `computeDraftState(draftId)` — Current picker, order, rosters
- `validatePick(draftId, pokemon)` — Turn, duplicates, budget, tier checks
- `generateSnakeOrder(participants, rounds)` — Alternating pick order
- `isDraftComplete(draftId)` — All picks made?

### Evolution leagues
Special draft variant where picked Pokémon can evolve under defined conditions:
- `checkEvolutions(draftId)` — Evaluate evolution conditions
- `checkPlayerEvolutions(draftId, playerId)` — Per-player evolution check
- `validateEvoLeaguePick(draftId, pokemon)` — Draft-eligible + evolution-eligible check

### API routes
- `/api/drafts` — CRUD
- `/api/drafts/[id]/picks` — Pick submission
- `/api/drafts/[id]/state` — Current draft state
- `/api/drafts/[id]/undo` — Undo last pick
- `/api/draft-pool-entries` — Pool management
- `/api/draft-pool-templates` — Reusable pool templates
- `/api/draft-tier-limits` — Tier-based constraints
- `/api/evolutions` — Evolution tracker CRUD

## Replay Parsing

**Docs:** `docs/pkmn.md`

The replay pipeline parses Pokémon Showdown replay URLs into structured game data.

### Flow
1. Player or admin submits replay URL → `POST /api/parse-replay`
2. `@pkmn/protocol` + `@pkmn/client` parses the battle log
3. Battle stats extracted (KOs, damage, switches, etc.)
4. `games` row created with `parsed = true`
5. `updateAggregates()` recomputes usage, standings, move stats

### Key files
- `src/lib/pkmn/replay-frames.ts` — Frame extraction from replay logs
- `src/lib/pkmn/teams.ts` — Team parsing and serialization
- `src/lib/pkmn/validation.ts` — Set legality validation against rulesets
- `src/lib/pkmn/tiers.ts` — Tier data helpers

### Replay library
Public spoiler-free replay browser at `/replays` — see `docs/replays.md`.
- `src/lib/supabase/queries/replay-library.ts` — Query module
- `src/app/(public)/replays/` — Page + filter/sort utilities

## Rulesets

Custom rulesets define format constraints (allowed Pokémon, moves, items, clauses, team size, etc.).

- `/api/rulesets` — CRUD
- `/api/seed-rulesets` — Populate from Smogon tier defaults
- `/api/validate-team` — Validate a team against a ruleset
- `src/lib/supabase/queries/rulesets.ts` — Query module including `resolveEffectiveRuleset()` (base-tier upgrade)
