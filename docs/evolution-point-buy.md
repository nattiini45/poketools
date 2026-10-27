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
  `computeStandings` for everything else. An EPB table ranks by the season's
  stored `format_rules.tiebreaker_order` and scores the pack's
  `epb.matchPoints`, in round robin and Swiss alike
  (`src/lib/tournament/standings-rules.ts`: `effectiveTiebreakerChain` falls
  back to the pack's `epb.tiebreakerChain` for a missing row or an unusable
  order; `effectiveMatchPoints`). `SeasonStandingsContext` carries the stored
  order next to the evolution points, so the league hub, the tournament page,
  the standings preview, Insights, profiles and the AI texts all rank alike.

## Tables

| Table | Purpose |
|-------|---------|
| `point_buy_list_versions` | Versioned list container (name + version, unique) |
| `point_buy_list_entries` | The evolution lines of a version (prices, kill thresholds, ratings, `species_ids`, `special_rules` flags) |
| `format_rules` | Per-season config: bans, tera rules, tiebreakers, budget, picks, token constraints (initialized from the pack's `epb.defaults`; edited in the league admin Rules tab, where Tera rules stay read-only; the tiebreaker order ranks the standings and falls back to the pack chain when unusable) |
| `evolution_tracker` (extended) | Per-player line state: `line_id` (one tracker per line per season and league group; `season_group_id` is NULL in a league without groups, see docs/draft-room.md "League groups"), the five source columns, `suspended_until_matchday`, `evolution_points_awarded`, `locked_stage3_pokemon`, `redraft_slot_id` |
| `evo_progress_log` | Progress audit log (one row per applied amount) |
| `evolution_events` | Development-event log: every stage transition (old/new form + stage, matchday, auto vs. `is_manual`) |
| `epb_token_grants` | Legacy one-shot gate per (season, player, grant_type); still counted in the points ledger |
| `epb_draft_token_purchases` | Draft Kill Token purchases, one row per purchase (append-only; points never come back); `tokens_used` is how many tokens the purchase counted for against the player's allowance (1, or the pack's rate on a participation line) |
| `epb_comeback_token_spends` | Comeback Token spends, one row per line per request (append-only) |
| `redraft_slots` | Published secret drops: dropped line, its price (refunded), frozen real kills (transferred) |
| `redraft_history` | Redraft audit trail (`secret_drop` rows; retired `trade`/`free_swap` rows kept as history) |
| `team_roles` | Matchup-sheet role categories |

All EPB tables are **service-role only**: RLS is enabled with zero policies
by design; access goes through Next.js API routes (auth in handlers).

## League Type & Battle Ruleset

`evolution_point_buy` is a **league type** (the admin `LeagueForm` labels the
field *League type* / *Liga-Typ*; the option text is the active pack's
`messages.<locale>.leagueAdmin.form.leagueTypeLabel`), not a battle format.
Point-buy battles are always **Gen 9 singles**: the form shows *Battle format:
Singles (fixed)* and offers no ruleset choice; instead it names the ruleset the
league will use (*Battle ruleset: {name} (set automatically)*).

Every phase still needs a ruleset version to pin (`tournamentCreateSchema.ruleset_id`),
so `POST /api/seasons` gives a point-buy league without an explicit
`ruleset_id` the pack's **battle ruleset** as its default (`seasons.ruleset_id`)
before inserting the season (`ensurePointBuyBattleRuleset`,
`src/lib/season/point-buy-battle-ruleset.ts`):

- The ruleset: name = the pack's `leagueAdmin.form.battleRulesetName` (English text; ruleset names are stored once),
  base format `gen9`, singles, clauses `['Item Clause']` (the clause the point-buy team validator enforces), **no
  bans** (all four lists empty), no added Pokémon, no custom rules and `team_constraints` null. It is a shared ruleset of
  the [Ruleset Studio](./ruleset-studio.md), created through its bridge, and the league pins its **head version**
  (`seasons.ruleset_id` is a version id).
- One shared ruleset, created on first use: the head of the oldest ruleset with that name that is still Gen 9 singles and
  has no team constraints, custom rules or added Pokémon is reused, so a retry or the next point-buy league creates
  nothing. Bans found on a reused ruleset are cleared by publishing a **new version** without them (audited as
  `season.clear_battle_ruleset_bans`); a league that already pins a version with bans keeps them until its pin is moved
  through the pin card. A creation is audited as `season.auto_create_battle_ruleset` (resource `ruleset`). A failed
  lookup or insert fails the league creation before the season row is written.
- An explicit `ruleset_id` in the request body is kept as is (API clients).
- The admin phase form preselects the league's default ruleset
  (`PhaseTimeline` / `PhaseForm` `defaultRulesetId`), so new phases need no
  manual ruleset. Leagues created before this change keep `ruleset_id` null
  until an admin sets one (`PATCH /api/seasons/[id]`).
- Team validation reads the ruleset the phase pins. `/api/validate-team` (the teambuilder's live check sends
  `tournament_id`) loads the pinned version with `getRulesetById(tournament.ruleset_id)`, runs `validateTeam()` against
  its frozen rules, and ANDs that with the point-buy validator, which builds its own ruleset from the season's
  `format_rules` (`src/lib/draft/epb-team-validation.ts`). That is why the shared ruleset carries no bans: `format_rules`
  is the only source of point-buy bans, so a ban a league lifts (`PUT /api/seasons/[id]/format-rules`) stops rejecting
  teams, and its one clause (Item Clause) is one the point-buy validator enforces anyway. The old read-time resolver (a
  fallback chain that guessed a ruleset from the league's name and type) is gone.
- Names are not unique, so two point-buy leagues created at the same moment can each create a ruleset; both are valid
  and later lookups take the oldest. No migration backfills `ruleset_id` on older point-buy leagues (see above).

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
| transferred progress | `transferred_evo_progress` | redraft pick into a slot (historically also trade execution) | no |
| Draft Kill Token | `draft_tokens` | `purchaseDraftKillToken` → `epb_purchase_draft_token` | no |
| Comeback Token | `kill_tokens` | `spendComebackTokens` → `epb_spend_comeback_tokens` | no |
| Participation Token | `cosmo_points` | `awardCosmoPoint` (match finalize), rebuild | no |

`total_kos` is total evolution progress and is never labelled kills. Every
source is 1:1 progress by default; a participation line converts at the pack's
rates instead (`epb.participationPoints`): a Comeback Token spend needs
`comebackTokensPerProgress` tokens per progress point, and the line's one Draft
Kill Token counts as (and costs) `draftKillTokensPerProgress` tokens for +1
progress (see "Token Ledger"). The column and function names (`cosmo_points`,
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

**Evolution progress waits for the confirmed result** (since 0.2.3).
Game submission (`recordGameResult`) records
the game, its `battle_stats` and its aggregate job, and credits **no** real
kills: a result that is still `pending_confirmation`, or `disputed`, moves no
tracker. The kills come from the game's `battle_stats` rows, which hold at
most one row per Pokémon per player per game (request schemas, plus the
unique index of `20261020100100_battle_stats_unique_pokemon.sql`, keyed on
JavaScript's trim set since `20261021100200_battle_stats_pokemon_key_js_trim.sql`).
A replay game's rows are the parsed stats of its replay, and one
battle can be recorded for only one game (`games.replay_hash`, see
[Match](./match.md#replay-binding)), so the same battle cannot add real kills
twice either.

Match completion (`finalizeMatchCompletion`, called from confirm-match, the
auto-confirm cron and an admin's dispute resolution through confirm-match)
runs, for EPB seasons only, with `matchday` = the match's
`rounds.round_number`:

0. **Real kills** (finalize step `epb_real_kills`, `creditMatchRealKills` in
   `src/lib/match/evolution-match-evaluator.ts`): every game of the match is
   credited **once**. Per game, `epb_credit_game_kills` adds each tracker's KOs
   through `epb_apply_progress` (logged `real_kill` on the matchday), sets
   `games.evolution_applied_at` and records what it credited in the game's
   credit ledger `games.evolution_credits` (`[{tracker_id, amount}]`), in one
   transaction under the season's credit fence and the game row lock
   (`supabase/migrations/20261020100200_games_evolution_credit.sql`,
   `20261021100100_epb_game_kill_credit_ledger.sql`). A game
   whose marker is set answers `already_applied` and writes nothing, so a
   finalize re-run or the cron heal (`FINALIZE_HEAL_POLICY.epb_real_kills =
   'rerun'`) never counts a game twice; a match that is no longer `completed`
   (reset or edited meanwhile) answers `match_not_completed` and writes nothing.
   The function also refuses a tracker that is not one of the match's players'
   trackers in its season. Stages are then re-resolved for both players
   (`recheckEpbStages`, events on the matchday). It runs before the steps
   below, so the Participation Token rule sees the stage the kills reached,
   in the same order as the season rebuild. When it fails, the matchday hooks
   are not run (`epb_hooks` blocked) and the heal retries both. When the
   hooks below fail, their rollback deletes only the evolution events the
   hook run added (the matchday's events are read before its first write and
   kept by id), so the stage transitions this step wrote, and the matchday's
   Evolution Point that depends on them, survive whatever the database clock
   says about their `created_at`.
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
accrue from the completed matches inside the pack's `epb.comeback.earnWindow`:
`season` counts every completed match, `first_half` only the Hinrunde of the
primary stage (`getHinrundeScope`, the same boundary as the redraft gate).
They are computed on demand by
`computeEarnedComebackTokens` (totals + per-match history). Unspent balance =
earned − Σ `epb_comeback_token_spends` (no legacy grant stock is
subtracted); spending opens once the redraft is
complete or the admin switch `format_rules.comeback_spend_open` is on.

Idempotency comes from finalize's `previousStatus === 'completed'` guard,
the per-game real-kill marker (`games.evolution_applied_at`) plus
evolution-point matchday dedupe. Match reset deletes
`match_evolution_snapshots` so historical pages cannot go stale.

**Admin changes and the real-kill marker.** New credit is made only for a
completed match's games, but a game of a match that is not completed can
still hold credited kills: the games of matches that were in flight when the
migration ran (credited at submission, see below), and the other games of a
completed match after an admin edit of one of its games (only the edited game
is debited; the others keep their credit and marker while the match waits for
its next confirmation, which credits nothing more for them). Every path keeps
the marker equal to what the trackers hold:

- **Game edit** (`editGame`): an edit moves a completed match back to
  `pending_confirmation` (or earlier), so a credited game is debited
  (`epb_uncredit_game_kills`, fenced on the marker read before the edit's
  writes; logged as negative `real_kill` on the same matchday, so the
  matchday's snapshot deltas net out) and its marker and ledger cleared. The
  debit is the game's ledger: exactly the amounts credited, to the trackers
  that got them, even when a redraft or trade has since changed which tracker
  one of the game's forms maps to. A tracker retired since (redraft drop,
  trade) is skipped: its kills were carried into the replacement line's
  `transferred_evo_progress`, a snapshot taken at the drop that the season
  rebuild preserves as well, so the edit does not follow them. A game whose
  marker predates the ledger (credited before 2026-10-21, season not rebuilt
  since) is debited, as before, by its old stats mapped through today's
  trackers; one rebuild of the season writes the ledger of every credited
  game. The
  edited stats are credited when the match is confirmed again, to the
  trackers that cover the game's forms then (what the season rebuild
  computes too). After the debit the
  edit re-reads the match: when a concurrent confirm completed it during the
  edit (also between the status change and the debit, when that confirm's
  finalize still saw the old marker and credited nothing), the edited stats
  are credited at once. A lost marker race, or a credit that cannot be made, is
  reported as `evolution_recheck_failed` (the season reconcile repairs it).
- **Game delete, match reset, an admin reopen of a completed match, season reconcile** rebuild the season
  (`repairSeasonEvolution`), which recomputes `real_kills` from the completed
  matches only and then, as its last write, aligns the markers and ledgers
  (`epb_sync_game_kill_credit`): games of the matches it replayed are marked
  with the per-game credits the rebuild computed, every other game of the
  season is unmarked, so a later completion credits exactly the games the
  trackers do not hold. The sync is fenced: every credit, debit and sync bumps
  the season's counter (`epb_kill_credit_epochs`, whose row lock serialises
  them), the rebuild reads it before it reads the season, and the sync refuses
  with nothing written when it moved or a credited match left `completed`; the
  rebuild then runs again from a fresh read (up to three attempts, then it
  fails and the reconcile is re-run). So a confirm that credits while a
  rebuild runs is never overwritten or unmarked. The Participation Token,
  stage-lock and Evolution Point writes of a concurrent matchday hook run are
  not fenced (as before). An admin reopen of a completed match
  (`reopenMatch`, [Match](./match.md#admin-match-page-verbs)) rebuilds the season
  the same way a game delete does, so the reopened match's games are unmarked
  until it is completed again. A dispute itself changes
  nothing: a disputed match has nothing credited, and it is credited when an
  admin resolves it to `completed` (or nothing, when the admin resets it).
- **Games recorded before 2026-10-20** were credited at submission. The
  migration marks every game that existed then, whatever its match's status,
  so nothing is credited twice and nothing is reversed: an in-flight match's
  progress stays visible until its completion, which credits nothing more for
  those games; a reset, a delete or a reconcile of its season drops and
  unmarks them like any pending game, and an edit debits them.
- **Deploy**: apply `20261020100200_games_evolution_credit.sql`, deploy
  right after, then mark the games submitted in between (the old code credited
  them at submission; the statement is in the migration header).
- **Local proof** (2026-10-20, local stack, BEGIN ... ROLLBACK): games that
  existed before the migration (one of a completed, one of a pending match)
  are marked and keep their `updated_at`, the default is dropped, a new game is
  unmarked; credit while pending → `match_not_completed`, nothing written;
  after completion → `applied` (+3, one `real_kill` log row on matchday 4),
  again → `already_applied`; a backfilled game → `already_applied`; a tracker
  of another player or season, a repeated tracker and a zero amount → 22023;
  debit with a wrong marker → `marker_changed`, with the right one →
  `rolled_back` (matchday 4 nets to 0), again → `not_applied`; the sync marks
  and clears per credited match and leaves other seasons alone; EXECUTE for
  `service_role` only. Two sessions on committed rows: a second credit of the
  same game waited on the first one's row lock and answered `already_applied`
  (one increment, one log row).
- **Ledger and fence** (`20261021100100_epb_game_kill_credit_ledger.sql`):
  apply, then deploy right away (it drops the unfenced sync signature, so a
  rebuild by the previous build fails loudly in between), then run the season
  reconcile once per EPB season so every credited game gets its ledger.
  Local proof (2026-10-21, local stack, BEGIN ... ROLLBACK): a credit writes
  the ledger and bumps the counter, `already_applied` does not; a debit whose
  caller-built debits name another tracker debits the ledger's tracker and
  leaves the other alone; a ledger tracker deleted meanwhile is skipped; a
  legacy marker (no ledger) debits the caller's debits; the sync with an old
  counter answers `stale` / `credit_changed` with nothing written, with the
  current one marks both games (the one without kills gets `[]`) and bumps
  the counter, an identical second sync rewrites nothing, a credited match
  that left `completed` answers `match_changed`, a zero amount, a repeated
  tracker and a game outside the credited matches → 22023; a ledger without a
  marker violates the CHECK; `service_role` can call the functions (including
  the internal lock helper they call), `authenticated` cannot.

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

### Draft Kill Tokens on a participation line

A Draft Kill Token normally counts as one token against the player's allowance
(`format_rules.draft_token_max`) and costs `draft_token_ratio` points for +1
progress, one purchase per line. On a participation line (`isCosmogLine`) the
exchange follows the pack's rate N: the one purchase for that line
counts as `participationPoints.draftKillTokensPerProgress` tokens against the
allowance and costs that many times `draft_token_ratio`, and it still adds
exactly +1 progress. The pack field is optional and falls back to
`comebackTokensPerProgress`, so a pack whose Comeback Tokens convert N:1 gets
the same N here without a second entry (with N = 3, the purchase counts as 3
tokens and costs 3 x the price). Every other line is unchanged (1 token, 1 x
the price, +1), and so are the per-line limit, the window and the rule that a
Draft Kill Token never triggers an evolution.

- `purchaseDraftKillToken` resolves the line like the token overview does (the
  season list entry's stored flag, else the base of the player's tracker) and
  passes the rate to `epb_purchase_draft_token(..., p_tokens_per_progress)`
  (default 1, validated 1..10, `service_role` only). The RPC checks
  `Σ tokens_used + legacy grant tokens + rate <= draft_token_max`
  (`TOKEN_PLAYER_LIMIT`: a player with one token left cannot buy the 2-token
  line) and `unspent points >= rate x draft_token_ratio` (`TOKEN_POINTS_SHORT`),
  and writes `points_spent = rate x draft_token_ratio` and `tokens_used = rate`
  to the ledger. The budget readers keep summing `points_spent`.
- The overview (`/api/seasons/[id]/tokens`) reports `draft_kill.owned` as the
  sum of `tokens_used` and per line `tokens_used` and `cost`. A line that already
  holds a token reports the stored `tokens_used` and `points_spent` of its
  purchase (a later change of the pack's rate does not rewrite it); a line
  without one reports the pack's current rate. The TS pre-check
  `draftKillLineRefusal` takes its reason inputs like the RPC does: the current
  rate for the player-limit check, which comes before the line-limit check even
  for a held line (a line bought at 1 token that the pack now rates at 2 reads
  `TOKEN_PLAYER_LIMIT` when the allowance cannot take the 2).
- The Draft Kill Token card shows the line's price on its button, a "counts as 2
  tokens" note, and the matching confirmation text. Copy says progress, never
  kills.
- Existing purchases carry `tokens_used = 1` (column default), so nothing
  already bought changes.

### Legacy one-shot grants

Before the draft tool, the spec's token-ledger attributes mapped onto two
existing tables (still read for seasons that used them):

| Ledger attribute | Where it lives |
|------------------|----------------|
| Tokenart | `epb_token_grants.grant_type` / `evo_progress_log.source` |
| Liga/Saison, Teilnehmer | `epb_token_grants` PK (`season_id`, `player_id`, `grant_type`) |
| Quelle | `evo_progress_log.source` + `note` |
| Anzahl | `epb_token_grants.token_count` (total) + `evo_progress_log.amount` (per line) |
| ausgegeben/ungenutzt | Legacy grants only: a grant row = a spent one-shot grant. Comeback Tokens are no grants: they are earned on demand (`computeEarnedComebackTokens`) and the balance is earned − Σ `epb_comeback_token_spends`; no `kill_token` grant is subtracted and none can be written |
| Ziel-Kaderplatz | `evo_progress_log.tracker_id` |
| Audit-Daten | `created_by` / `created_at` on both tables |

The `epb_grant_and_apply_tokens` RPC writes the grant row and all per-line
allocations in one transaction. The app no longer calls it (no TS wrapper), and
since `20261018140000_epb_comeback_rules.sql` the CHECK
`epb_token_grants_no_kill_token` refuses every new `kill_token` grant (there is no
legacy Comeback stock, so such a grant would be counted twice). Release order of
that migration: check `select count(*) from epb_token_grants where grant_type =
'kill_token'` is 0 (its precondition aborts otherwise), apply it, then deploy the
app that sends the per-line `ratio` (an older function ignores `ratio` and would
price a participation-line spend 1:1). The grant PK is the double-spend/race guard
(duplicate → unique violation → 409); it is player-scoped, so it survives
redrafts (tracker-scoped log lookups do not — redraft deletes trackers and
SET NULLs the log references). Draft-token purchases are budget-relevant:
`computeRemainingPoints` reads `token_count` from the grant, never from the
tracker columns.

## Redraft Semantics

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
- **trade** is retired: `POST /api/seasons/[id]/redraft`
  answers `410 REDRAFT_TRADE_RETIRED`, and migration
  `20261018140300_epb_retire_trades.sql` cancelled pending requests and dropped
  `epb_execute_trade_request` and the older `epb_execute_redraft`.
  `redraft_trade_requests` stays as a read-only archive; historical
  `redraft_history` rows with `transfer_type = 'trade'` and their
  `transferred_evo_progress` stay as they are.

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
| Redraft eligibility helper | `src/lib/draft/redraft-engine.ts` |
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
