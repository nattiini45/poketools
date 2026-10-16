# Evolution Point Buy (EPB) Module

Format-specific rules engine for the Evolution Point Buy league format
(`season_format_type = 'evolution_point_buy'`). Existing formats (`singles`,
`doubles`, `draft`) are unaffected: every EPB behavior sits behind
`isEvolutionPointBuy()` from `src/lib/season/format-utils.ts`.

This page describes the **mechanics**. A league's tuning (budget, picks, token
ratio and caps, bans, match points, Tera by stage, tiebreakers, the Comeback
table, the stage lock, Participation Tokens, price groups and tabs, per-line
rulings and threshold overrides, utility categories, the workbook layout) comes
from the active [format pack](./format-packs.md) (`epb` section, read through
`@/lib/format-pack`). Values quoted below as examples are the public example
pack's.

## Format Identifier & Gating Points

The stable identifier is `evolution_point_buy` (Postgres enum
`season_format_type`, Zod `seasonFormatTypeSchema`, admin `LeagueForm`).
Format gates:

- **API routes** — `assertEpbSeason(season)` (`src/lib/season/format-utils.ts`)
  is the first operation after auth in all five EPB routes:
  `/api/seasons/[id]/{format-rules,draft-tokens,kill-tokens,progress,redraft}`.
  Non-EPB seasons get 400 `format_mismatch`; missing seasons get 404. This
  protects legacy evo-league trackers from the EPB `total_kos` recompute.
- **Game pipeline** — `recordGameResult` / `recheckEvolutions`
  (`src/lib/pkmn/game-pipeline.ts`) branch on
  `tournament.season_format_type`, which `getTournamentById` joins from
  `seasons.format_type` (no extra query on the hot write path). EPB progress
  is owned by `src/lib/match/evolution-match-evaluator.ts`; legacy
  evo-leagues keep `checkPlayerEvolutions`.
- **Match completion** — `finalizeMatchCompletion` (`src/lib/match/finalize.ts`)
  runs the EPB matchday hooks (below) only for EPB seasons, wrapped in
  try/catch so EPB bookkeeping never blocks match completion.
- **Standings** — `computeStandingsForFormat` (pure, client-safe, in
  `src/lib/tournament/standings.ts`) and the server wrapper
  `computeStandingsForSeason` (`src/lib/tournament/season-standings.ts`)
  dispatch to `computeEvolutionPointBuyStandings` for EPB and to the generic
  `computeStandings` for everything else.

## Tables

| Table | Purpose |
|-------|---------|
| `point_buy_list_versions` | Versioned list container (name + version, unique) |
| `point_buy_list_entries` | The evolution lines of a version (prices, kill thresholds, ratings, `species_ids`, `special_rules` flags) |
| `format_rules` | Per-season config: bans, tera rules, tiebreakers, budget, picks, token constraints (initialized from the pack's `epb.defaults`) |
| `evolution_tracker` (extended) | Per-player line state: `line_id` (one tracker per line per season), the five source columns, `suspended_until_matchday`, `evolution_points_awarded`, `locked_stage3_pokemon`, `redraft_slot_id` |
| `evo_progress_log` | Progress audit log (one row per applied amount) |
| `evolution_events` | Development-event log: every stage transition (old/new form + stage, matchday, auto vs. `is_manual`) |
| `epb_token_grants` | Legacy one-shot gate per (season, player, grant_type); still counted in the points ledger |
| `epb_draft_token_purchases` | Draft Kill Token purchases, one row per token (append-only; points never come back) |
| `epb_comeback_token_spends` | Comeback Token spends, one row per line per request (append-only) |
| `redraft_slots` | Published secret drops: dropped line, its price (refunded), frozen real kills (transferred) |
| `redraft_history` | Redraft/trade audit trail (incl. `secret_drop` rows) |
| `team_roles` | Matchup-sheet role categories |

All EPB tables are **service-role only**: RLS is enabled with zero policies
by design; access goes through Next.js API routes (auth in handlers).

## Point-Buy List Snapshot & Binding Rules

- A season is bound to exactly one list version (`seasons.point_buy_list_id`).
- **First bind is allowed regardless of season status** when
  `point_buy_list_id` is still null (no snapshot to protect). Rebinding a
  different version is only allowed for `upcoming` seasons
  (`bindSeasonToList`, audited as `season.bind_point_buy_list`).
- **Auto-bind at creation**: when a new EPB season is created
  (`POST /api/seasons`), the currently active list version (the one row with
  `is_active` set) is bound automatically, audited as
  `season.auto_bind_point_buy_list` — upload once and every EPB league
  created afterwards is draft-ready. This is best-effort: if no active
  version exists the season is simply created unbound (manual bind stays
  available), and a bind failure never fails league creation. Rebind rules
  for upcoming seasons are unchanged.
- **Bound versions are immutable**: once any bound season leaves `upcoming`,
  entry writes are rejected by `bulkCreateListEntries` (409
  `list_version_immutable`), by `scripts/import-point-buy.ts` (aborts with a
  bump-`--version` hint), and by the DB trigger `trg_pble_immutable` as a
  race-safe backstop. A later import can never retroactively change prices,
  texts, or kill requirements of running/completed seasons.
- **The bound list is the single source of truth for EPB drafts**: the draft
  picks route creates trackers from `point_buy_list_entries` (never from
  `evolution_tiers`), stamps `line_id` and `locked_stage3_pokemon` from the
  entry (branched lines, e.g. Pichu → Raichu / Raichu-Alola or Oshawott →
  Samurott / Samurott-Hisui, are distinct lines keyed by `line_id`, e.g.
  `pichu--raichualola`), and enforces the
  `format_rules.draft_picks` cap (lines per trainer) plus the
  `format_rules.draft_budget` via `points_spent` from each entry price.

## Progress Model

Invariant (since migration M4): `total_kos = real_kills + transferred_evo_progress
+ draft_tokens + kill_tokens + cosmo_points`.

The progress sources stay separate (SPEC Prompt 7; spec names in
`src/lib/draft/progress-sources.ts`):

| Spec source | Column | Written by | Shown as kills / in kill rankings |
|---|---|---|---|
| self-earned real kills | `real_kills` | match pipeline, rebuild | **yes**, the only one (public rankings read `battle_stats`) |
| transferred progress | `transferred_evo_progress` | redraft pick into a slot, trade execution | no |
| Draft Kill Token | `draft_tokens` | `purchaseDraftKillToken` → `epb_purchase_draft_token` | no |
| Comeback Token | `kill_tokens` | `spendComebackTokens` → `epb_spend_comeback_tokens` | no |
| Participation Token | `cosmo_points` | `awardCosmoPoint` (match finalize), rebuild | no |

`total_kos` is total evolution progress and is never labelled kills. Every
source is 1:1 progress. The column and function names (`cosmo_points`,
`awardCosmoPoint`) are stored names and keep them; the user-facing token name
comes from the pack's messages.

- All progress writes go through the `epb_apply_progress` RPC (atomic
  increment + `evo_progress_log` row in one transaction), reachable via
  `applyTrackerProgressWithLog` (`src/lib/supabase/queries/evolutions.ts`).
- Stage resolution (`resolveEpbStage` in the evaluator) compares `total_kos`
  (transferred progress included) against the bound list's cumulative
  thresholds with the league overrides applied (`effectiveThresholds`);
  `locked_stage3_pokemon` overrides the entry's stage-3 form for branched
  lines. Every tracker → line lookup goes through `lineLookup`
  (`src/lib/match/epb-stage-resolution.ts`): by `line_id`, with a base-name
  fallback only for trackers without one (legacy evolution-tier leagues).
- Every stage transition is persisted to `evolution_events` (real-kill
  application, undo/rollback rechecks, and admin corrections — the latter
  with `is_manual = true`).
- Admin corrections (`POST /api/seasons/[id]/progress`) apply atomically and
  re-resolve the player's stages afterwards.

## Match Lifecycle Wiring

Game submission (`recordGameResult`) applies real kills and resolves stages.
Match completion (`finalizeMatchCompletion`, called from confirm-match and
the auto-confirm cron) runs, for EPB seasons only, with `matchday` = the
match's `rounds.round_number`:

1. `clearExpiredSuspensions` — suspensions served in earlier matchdays reset.
2. `awardCosmoPoint` — `epb.participationPoints.perMatchday` **Participation
   Tokens** per participation line (a pack `lineRules` entry with
   `participationPoints`, stored as the `special_rules.cosmog` flag; looked up
   by `line_id`) per matchday the line was **brought** into the match, while it
   is below `participationPoints.untilStage`. No battle stats → no token
   (brought cannot be proven); at most one award row per tracker per matchday
   (`getCosmoMatchdays` guard, so a re-finalized match adds nothing). Stages are
   re-resolved after token application so evolution points and the early
   stage lock can fire on participation-driven evolutions. A pack
   `lineOverrides` entry can replace a line's sheet thresholds
   (`src/lib/draft/league-overrides.ts`); the override applies on every read
   path.
3. `checkEarlyStage3Lock` — the pack's `epb.stageLock`: reaching `stage` by
   matchday `byMatchday` suspends the line for the next `suspendMatchdays`
   matchdays (example pack: stage 3 by matchday 2 → sits out 1 matchday).
4. Evolution points — max 1 per player per matchday, deduped via
   `evo_progress_log` / `recalculateEvolutionPoints` (admin endpoint available).

Comeback Tokens (formerly kill tokens) use the **surviving-Pokémon
scoreline** (loser 0 alive, winner N alive), not best-of games won. Only a
shutout earns tokens; the pack's `epb.comeback.table` sets how many: the
highest row whose `minWinnerSurvivors` the winner reaches
(`comebackTokensFromTable`; example pack: winner keeps 4+ → 1 token). They
accrue from every completed match of the season (no first-half cap) and are
computed on demand by
`computeEarnedComebackTokens` (totals + per-match history). Unspent balance =
earned − Σ `epb_comeback_token_spends`; spending opens once the redraft is
complete or the admin switch `format_rules.comeback_spend_open` is on.

Idempotency comes from finalize's `previousStatus === 'completed'` guard
plus evolution-point matchday dedupe. Match reset deletes
`match_evolution_snapshots` so historical pages cannot go stale.

## Token Ledger

Draft Kill Tokens and Comeback Tokens have their own append-only ledgers
(`epb_draft_token_purchases`, `epb_comeback_token_spends`), written only by
their RPCs under the season advisory lock (rules re-checked in SQL; twins in
`src/lib/draft/tokens.ts`). The points ledger is `seasonRemainingPoints`
(`src/lib/draft/budget.ts`, SQL twin `epb__season_remaining_points`):
initial pool budget − non-void picks of non-cancelled pools − legacy grant
tokens × ratio − Draft Kill Token purchases − legacy redraft spends + redraft
refunds. `computeRemainingPoints` / `loadDraftTokenLedger` +
`computeRemainingPointsFromLedger` (`progress-engine.ts`) read it once per
season.

### Legacy one-shot grants (S12 decision)

Before the draft tool, the spec's token-ledger attributes mapped onto two
existing tables (still read for seasons that used them):

| Ledger attribute | Where it lives |
|------------------|----------------|
| Tokenart | `epb_token_grants.grant_type` / `evo_progress_log.source` |
| Liga/Saison, Teilnehmer | `epb_token_grants` PK (`season_id`, `player_id`, `grant_type`) |
| Quelle | `evo_progress_log.source` + `note` |
| Anzahl | `epb_token_grants.token_count` (total) + `evo_progress_log.amount` (per line) |
| ausgegeben/ungenutzt | Grant row exists = spent (one-shot); earned kill tokens are computed on demand (`computeEarnedKillTokens`) |
| Ziel-Kaderplatz | `evo_progress_log.tracker_id` |
| Audit-Daten | `created_by` / `created_at` on both tables |

The `epb_grant_and_apply_tokens` RPC writes the grant row and all per-line
allocations in one transaction. The grant PK is the double-spend/race guard
(duplicate → unique violation → 409); it is player-scoped, so it survives
redrafts (tracker-scoped log lookups do not — redraft deletes trackers and
SET NULLs the log references). Draft-token purchases are budget-relevant:
`computeRemainingPoints` reads `token_count` from the grant, never from the
tracker columns.

## Redraft & Trade Semantics

- **Redraft = secret drop** (redraft pool, `redraft_*` RPCs): each player
  secretly submits the lines to drop; at the deadline all drops publish at
  once. Every dropped line becomes a fixed redraft slot (A, B, C…) whose
  dropped price is refunded and whose **real kills only** are frozen as
  transferred progress (no stage, no token or participation progress
  transfers). The line drafted into a slot gets that amount as
  `transferred_evo_progress` (`real_kills` 0); its own thresholds decide the
  stage. Redraft-locked lines (stored `special_rules.no_redraft`, written for
  every pack `lineRules` entry with `redraftLocked`) are neither droppable nor
  pickable in the redraft.
- **free_swap** is retired (the legacy route answers 410).
- **trade** (kept, consent flow): `prepareRedraftSwap` validates each side
  (redraft-lock exclusion both ways, ownership, price difference vs.
  server-computed remaining points; lines matched by `line_id`) and computes
  the missing-kills transfer, clamped to the target line's max stage; instant
  stage-3 targets (a pack `lineRules` entry with `instantFinalStage`,
  `additional_kills_to_stage3 = 0`) resolve to stage 3 immediately. The new tracker carries `line_id` and the transfer as
  `transferred_evo_progress` (never `real_kills`). `epb_execute_trade_request`
  re-checks points with `epb__season_remaining_points`, checks the target
  line free by `line_id`, and deletes the sources before inserting the new
  trackers (one tracker per line per season).

## API Payload Notes (drift since PR #47)

- `GET /api/seasons*` responses include `point_buy_list_id` (null for
  non-EPB seasons).
- `GET /api/evolutions/trackers` includes the EPB source columns
  (`real_kills`, `draft_tokens`, `kill_tokens`, `cosmo_points`,
  `suspended_until_matchday`, `evolution_points_awarded`,
  `locked_stage3_pokemon`) for all formats — always 0/null for legacy
  evo-leagues.
- The five EPB season routes return 400 `format_mismatch` for non-EPB
  seasons (previously they were reachable for any season).

## Key Files

| What | Where |
|------|-------|
| Format gate helpers | `src/lib/season/format-utils.ts` |
| Match evaluator (stage resolution, events) | `src/lib/match/evolution-match-evaluator.ts` |
| Match-completion hooks | `src/lib/match/finalize.ts` |
| Progress engine (tokens, cosmo, lock, points ledger) | `src/lib/draft/progress-engine.ts` |
| Progress sources (spec names, `displayKills`) | `src/lib/draft/progress-sources.ts` |
| Token rules (client-safe twins of the token RPCs) | `src/lib/draft/tokens.ts` |
| Redraft / trade helpers | `src/lib/draft/redraft-engine.ts` |
| Pure format math | `src/lib/draft/point-buy-engine.ts`, `src/lib/draft/special-rules.ts` |
| League tuning (format pack contract, accessors, example pack) | `src/lib/format-pack/`, `src/format-packs/example/` ([Format Packs](./format-packs.md)) |
| Standings dispatch | `src/lib/tournament/standings.ts`, `src/lib/tournament/season-standings.ts`, `src/lib/tournament/evolution-standings.ts` |
| Queries | `src/lib/supabase/queries/{point-buy-lists,evolutions,evolution-events,epb-token-grants,epb-draft-token-purchases,epb-comeback-tokens,epb-kill-tokens,progress-log,redraft,format-rules}.ts` |
| Migrations | `supabase/migrations/20260727000000_evolution_point_buy.sql`, `20260727010000_epb_review_fixes.sql`, `20260728000000_epb_remediation.sql`; draft tool: `20261012024103…120700` (line ids, queue, secret drop, progress sources, RPCs, token RPCs) |
| Importer | `scripts/import-point-buy.ts` (workbook layout: [Point-Buy Workbook Format](./point-buy-format.md)) |

## Deferred (later prompts)

- Team-validation enforcement of `format_rules.banned_moves` /
  `banned_items` and the stage-dependent tera rules at team-submit time
  (config + display are live; validation hooks land with the teambuilder
  prompt).
- Player-facing trade consent flow (trades are admin-mediated today).
