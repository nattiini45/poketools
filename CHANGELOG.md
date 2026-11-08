# Changelog

All notable changes to PokéTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor version may
contain breaking changes; they are listed under **Changed** or **Removed** with the upgrade steps.

## [Unreleased]

Version 0.6.0 (`package.json`, `package-lock.json`); rename this section to `[0.6.0]` with the release date when it ships.

### Upgrade notes

- **Apply `20261027100000_admin_agent_tables.sql` BEFORE deploying the code.** It adds the Admin Assistant's own tables
  (conversations, messages, plans and their revisions, proposals, the action ledger, snapshots, references, usage),
  service-role only. Nothing else reads them, and the assistant stays off until it is switched on.
- **The Admin Assistant is off by default and fails closed.** It needs `ADMIN_AGENT_ENABLED` on the server and
  `NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT` for the UI; `ADMIN_AGENT_MAX_PHASE` (default `0`) decides what it may execute,
  `ADMIN_AGENT_GOLIVE` gates Go-live cards, and the model needs `ANTHROPIC_API_KEY`. Every setting and its default is in
  [docs/feature-flags.md](docs/feature-flags.md).
- **Apply `20261102120000_audit_log_game_match_id_index.sql` (any time; no downtime).** It is a single
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for the admin match history panel, so it takes no write lock on
  `audit_log`. A concurrent build that was cancelled leaves an INVALID index of the same name: check
  `SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.audit_log_game_match_id_idx'::regclass;`, and when it is
  `false` run `DROP INDEX CONCURRENTLY public.audit_log_game_match_id_idx;` and apply the file again.
- **Discord sign-in is optional.** Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` together to keep it, or leave
  both blank for email and password only (one without the other stops the server at startup). Existing deployments
  that set both see no change. A local `supabase start` stack now requires email confirmation like the hosted project;
  after pulling, restart it (`npx supabase stop && npx supabase start`) so `supabase/config.toml` takes effect.
- **Apply the six format-engine migrations, in this order, BEFORE deploying the code.** All are service-role only (RLS on,
  no policy, functions revoked from `PUBLIC`, `anon` and `authenticated`), none is `SECURITY DEFINER`, and every function
  sets its `search_path`.
  1. `20261104090000_match_outcomes.sql`: `match_outcomes` (how a match ended) and `match_outcome_record()`, classified
     in the league recycle bin.
  2. `20261104100000_third_place_match.sql`: `tournaments.third_place_enabled` (default false) and `format_attach_season`
     reading it.
  3. `20261104100100_season_format_engine_backfill.sql`: data only. **Every league that already has an attached format
     moves to `season_formats.engine = 'legacy'`**, so nothing changes under it until an admin switches it (Format tab,
     through `shadow` first); a league attached after this migration starts on `kit`. It also rewrites the
     `season_formats` rows captured in the league trash, so a restored pre-release league does not come back on `kit`.
  4. `20261105090000_format_runtime.sql`: the nine runtime tables (`format_relation_links`, `format_resource_items`,
     `format_action_submissions`, `format_event_log`, `format_flags`, `format_player_attrs`, `format_track_progress`,
     `format_checks`, `format_adjustments`) and their writer functions. Edited in place on this branch: the signature of
     `format_check_resolve` is now `(p_season_id, p_check_id, p_status, p_admin, p_note)` (a check id of another league
     resolves nothing), and the helpers `format__lock_action` (one advisory lock for save, submit and the lock op of an
     action) and `format__clear_runtime` are new, and `format_forfeit_complete` completes a deadline forfeit in one
     transaction with its revision and engine check. It also adds `season_formats.revision` (a number from one sequence,
     renewed by a trigger on every insert and update of the row), `format_action_save` and `format_action_submit` take
     it as `p_expected_revision` (the old five- and eight-argument forms are dropped), and `format__insert_item` now
     refuses a grant over the resource's `capacity` under a per-holding advisory lock. Rows that exist before the file
     take revision 0 and a real number at their first change. It also adds `season_formats.clock_shift_seconds` (the
     time a league spent in the recycle bin, see Fixed), `format_check_open(..., p_expected_revision)` (the old five-argument
     form is dropped), `format__apply_ops(season, ops, strict, tolerant)` (now returns the skipped grants), the helpers
     `format__lock_exclusive` / `format__lock_grants`, and `tournament_enrollment_replace(..., p_force)` plus
     `tournament_enrollment_freeze`.
  5. `20261105120000_format_foreach_group.sql`: `tournaments.format_group`, the unique index
     `uq_tournaments_season_format_stage` on `(season_id, format_stage_key, format_group)`, and the unique index
     **`uq_tournament_groups_tournament_group_number`** on `tournament_groups (tournament_id, group_number)`. The index
     **fails to build if a phase already has two groups with the same number**: check
     `SELECT tournament_id, group_number FROM tournament_groups GROUP BY 1, 2 HAVING count(*) > 1;` first (none is expected,
     because the group editors write one set). It also drops and recreates `format_attach_season` and
     `format_detach_season` with new `p_confirm_clear` and `p_confirmed_counts` arguments and adds the helpers
     `format__guard_runtime_clear` and `format__lock_phases`, and the trigger `trg_seasons_guard_format_type` (a league's
     `format_type` cannot change from or to `custom` while a format is attached or after the league started).
  6. `20261106090000_format_challenges.sql`: `format_challenges` and its functions. Edited in place:
     `format_challenge_respond(p_season_id, p_challenge_id, p_player, p_accept)` and
     `format_challenge_cancel(p_season_id, p_challenge_id, p_player)` take the league id, and the `format_checks.source`
     check gains `pairing_forbidden`, `deadline_missed` and `team_audit`; withdrawing a challenge whose accept window
     has run out stores it as `expired` instead of `cancelled`. `league_trash__inventory()` now lists 61 owned
     tables. `round_write` gains `p_expected_revision` (the seven-argument form is dropped) and `round_delete(round)` is
     new; `format_substitute_seat` (the seat
     handover of a substitution) is new. A database that already applied an earlier revision of this file lacks it, so
     substitutions in format leagues fail there until the file is applied again (reset it, see below).

  The migrations were edited in place because none of them had shipped: a development or preview database that applied an
  earlier revision of these files has to be reset (`supabase db reset` locally). Re-creating only the changed functions is
  not enough for `20261105090000`: its `format_action_save` / `format_action_submit` read the `season_formats.revision`
  column, which needs the sequence `season_format_revision_seq` and the trigger `trg_season_formats_revision` too, and the
  files are not idempotent (no `IF NOT EXISTS`), so a reset is the supported path; there is nothing to run on a database
  that has not applied them. The cron `GET /api/cron/format-engine` was already in
  `vercel.json` (it needs `CRON_SECRET` like the others). No new environment variable.
- **Switching a league to the kit engine applies its whole history.** The cron fires `match_completed` for every completed
  match of a league that was on `legacy` or `shadow` (up to 25 per run and 10 per league, so a long history takes several
  15-minute runs), including points, grants, track progress, expression checks and team-audit checks (each old match is
  audited against today's team rows and format, so teams edited since the match can open Team rule review checks; the
  shadow list does not preview these). Matches completed before
  `match_outcomes` existed have no outcome row and score as `played` with 0 faints, so per-faint points are 0 for them.
  Check the shadow list (`GET .../format/shadow`) before the switch.
- **`notify` effects are not delivered yet.** A format's `notify` effect is planned and returned by the event runner, but
  nothing stores it or sends it to a player or admin (no notice, push, Discord post or email). The shipped Wichtelcup
  carries two such rules; the organizer announces the gift form and week 4 outside the app.

### Added

- **Zero-setup local development.** `npm run dev:seed` gives a local stack a confirmed admin, the standard rulesets and
  one 8-player league; with Discord left unconfigured, the sign-in page and Settings show email and password only
  (CONTRIBUTING, "Local development without Discord").
- **`npm run test:db`** runs every local-stack suite (`*.local.test.ts`, `*.live-db.test.ts`) in its own Vitest
  project against a local Supabase stack, refusing any host but the loopback interface. CI runs it, plus a migration
  replay and `npm run db:types:check`, in an advisory `database` job on its own ephemeral stack.
- **`npm run test:e2e`**: a Playwright smoke suite (Chromium) over the local stack and a production build
  (`npm run build:e2e`) with the local asset mirrors, served on port 3152: public pages, email sign-up and sign-in through Mailpit, report and confirm, the admin match
  page, an overlay without the NavBar and the language switch. CI runs it in an advisory `e2e` job.
- **Admin Assistant (preview; spec section 18).** A chat for site admins at `/admin/assistant` and as a drawer that
  plans a league, a standalone tournament or a ruleset with the admin and then sets it up through the site's own routes,
  only after the admin approves a card the server writes:
  - **Plan:** the assistant fills a Plan the admin can see (and changes by asking), resolves names and dates with tools, asks about every
    value it would otherwise pick, and states the engine's limits plainly (for example a double round robin).
  - **Build card (phase 1):** creates the league, its roster and phases, or a standalone tournament and its players, in a
    fixed order derived by code. Every step writes a ledger row first, is re-checked against the route's own schema, and
    is read back afterwards; an unclear outcome is reconciled, never retried, and an interrupted Build can be resumed for
    10 minutes.
  - **Go-live cards:** publish a ruleset version, move a ruleset pin, start a phase, generate a bracket. One exact call
    per card, one acknowledgement per outward effect (the card lists the Discord and social channels it will post to),
    never resumed.
  - **Private ruleset drafts** created and edited in the chat; each edit keeps the previous document so it can be undone.
  - **Undo** of what a conversation built: archive a league or tournament, remove added players, move pins back, restore a
    draft, or delete a never-published ruleset created in that chat. Anything edited outside the chat is left alone, and
    the card lists what stays and why.
  - **Progress card** with each step's result, links to what was created, Resume and Undo.
  - **Audit:** `agent.*` events, and the routes' own events carry the conversation, step, tool and approving admin.
  - **Caps:** per-turn limits, rate limits, dollar budgets reserved before each model call, and per-conversation limits on
    leagues, tournaments, Go-live executions and pin targets (the ruleset and format limits are reserved).
- Evaluation harness `scripts/admin-agent-eval.ts`: plan, executor and end-to-end stages, the last two against a local
  Supabase stack only.
- **The format kit now runs a league (Format Studio phases 2b to 4).** A custom-format league on the `kit` engine is
  scheduled, scored, advanced and run by `src/lib/format-engine` and its `runtime/` folder; the old statement that "the
  engine does not run kit definitions" is gone from the docs. Details in [docs/format-kit.md](docs/format-kit.md).
  - **Engine (phase 2b):** stage standings from the kit's scoring and rank chain (forfeits and per-opponent-faint points
    from `match_outcomes`, head to head, a coin flip from the season seed, manual order, decision-match flags, custom
    metrics, `seed` and `rating` metrics, cross-stage views), Swiss and round robin pairing with legs, group formation,
    advancement along edges (`top_n`, `per_group`, wildcard, threshold, bottom N, manual list; rank, cross-group, random
    and manual seeding) and `auto` edges that advance when the source phase completes. `PUT /api/seasons/[id]/format/engine`
    switches a league between `legacy`, `shadow` and `kit` (audit `season.format.engine`); `GET .../format/shadow` lists
    the rows whose place or points would change. A manual-pairing phase refuses generated rounds (409
    `rounds_manual_pairing`).
  - **Runtime (phase 3):** attributes, domains, relations (a Secret Santa), resources, metrics, tunables, `rule.on_event`
    with effects, player actions, assisted checks, manual adjustments, track progression and placement points, with the
    nine `format_*` tables and one SQL function per write. The six new document sections are optional, so stored formats
    keep their hash and the golden snapshots did not move. 26 new compiler diagnostics.
  - **Phase 4 primitives:** `pairing.bipartite` (a pre-generated A x B schedule, a cyclic Latin rectangle in seed order, so
    every A meets every B once), `pairing.filter`, `pairing.challenge`, team constraints, the stage calendar with marks and
    deadline policies, `stage.end_when` and `stage.foreach_group`. 100 diagnostic codes in all; the new
    `bipartite_rounds_short` warns when a bipartite stage has fewer rounds than the larger side needs, and
    `deadline_policy_invalid` with reason `pick_after_close` refuses a random pick that could never be made.
  - **Cron `GET /api/cron/format-engine`** (every 15 minutes): fires calendar marks, applies match, team and action
    deadline policies (forfeit, admin review, auto lock, seeded random pick; action policies also run for an `upcoming`
    phase), expires challenges, fires lost `action_locked` events and backfills `match_completed` for finalized matches whose
    event never fired. A run handles at most 100 leagues in a window that moves on every 15-minute slot and stops starting
    leagues after 240 seconds; the summary reports `completions_backfilled` and `deferred`. It answers 500
    `format_cron_partial_failure` when a league failed. The README lists seven crons now.
- **Third-place match.** A single-elimination phase with four or more players can play a match for third place between
  the semifinal losers in the final's round (`tournaments.third_place_enabled`, the create form, the settings editor and
  `PATCH /api/tournaments/[id]`; a format stage with `pairing.third_place` sets it). Enabling it after the final round is
  completed does nothing (`skipped_final_completed` in the sync result), because a new match would sit in a finished round.
- **Match outcomes.** `match_outcomes` records how every completed match ended (played with each side's faints, forfeit,
  no-show, unresolved) and an admin can settle a result as a forfeit or no-show (`POST /api/admin/matches/[id]/result`,
  `outcome`). See Changed for the replay-tie behaviour. The format kit's environment allows forfeits (draws stay off).
- **Draft room: whose turn it is.** The clock bar reads "Round 3 of 6 - Pick 2 of 6" with a seat track, the player on
  the clock in an accent pill, make-up picks labelled, and round breaks in the order strip.
- **Guarded routes and two surfaces for a running kit league.** Players: `/dashboard/leagues/[id]/play`
  (action forms with draft, review and submit, items, relations, challenge ladders), linked from the league hub of every
  custom league. League admins: a **Live** tab (checks inbox, manual adjustments with a required reason and history,
  Open and Lock for actions, relations with an audited "show hidden sides", challenges). Routes under
  `/api/seasons/[id]/format/`: `me`, `actions/[actionId]` (PUT) and `.../submit`, `challenges`, `challenges/[challengeId]`
  (DELETE) and `.../answer`, `adjustments` (GET, POST), `checks` and `checks/[checkId]/resolve`, `relations/unmask`.
  Season-scoped ids, strict zod, nine rate-limit buckets (`format-challenge-make` and `format-adjust` fail closed), audit
  actions `season.format.action.submit`, `.challenge.make`, `.challenge.answer`, `.challenge.withdraw`, `.adjustment`,
  `.check.resolve` and `.relations.view_hidden`, EN and DE text (the German is unreviewed by a native speaker), and the
  privacy contract in [docs/format-kit.md](docs/format-kit.md#live-format-routes): a hidden relation side, another
  player's pick or a team-audit subject is never serialised to a player, and a relation draw is stored only as a link count.
- **Team rule audit.** A played team that breaks the stage's team constraints, differs from the replay or
  could not be audited opens a **Team rule review** check (`team_audit`, admin-only subject); a reset closes it. See Changed.
- **Wichtelcup.** A fourth shipped example format, `wichtelcup` (a Secret Santa cup written with kit
  primitives only: per-player pools, the player's own gifts, a New Year pool that opens in week 4, weekly obligations from
  the round) and the rule preset `gen9natdexwichtelcup` it uses (141 exact species/forms, item and ability bans including the
  forme-forcing items and Dragon Ascent, Species, Item, Terastal and Mega Rayquaza clauses, exactly six Pokémon). The
  organizer draws the Secret Santa with a confirmed admin action; the first round waits for the draw and the gift checks.
  The shipped example count is four.
- **Rule levels.** A ruleset document can carry `levels` (a policy `exact` or `max`, a default and per-species entries, each
  `experimental` or `approved`); `validateTeam` enforces approved entries (a missing Level line means 100), the Ruleset
  Studio has a Levels section, and the teambuilder validation panel shows the level requirements. `levels: null` is left
  out of every hashed form, so published rulesets keep their `content_hash` and `resolved_hash` and a no-op edit of an old
  ruleset is still "nothing new".
- **Showdown challenge string.** The read-only ruleset page shows a copyable `<format> @@@ <rules>` custom-rules string on
  the least restrictive Showdown format of the ruleset's generation, universe and game type (not a hard-coded National
  Dex format), with every entry written with its kind (`-item:metronome`, `-move:metronome`), explicit forme bans where an
  allowlisted base species would otherwise allow every forme, and cosmetic formes written as their base species. The page
  says that the string cannot carry level rules, team constraints or per-player pools.

### Changed

- **Supported Node is `^22.22.2 || ^24.15.0`, enforced.** `package.json` declares it in `engines` and `.npmrc` sets
  `engine-strict`, so `npm install` / `npm ci` fail on Node 23, 25 or a 22.x before 22.22.2 instead of printing a
  warning (jsdom 30, used by the DOM tests, needs it). `.nvmrc` pins 24.22.1 and CI reads it; `@types/node` is on 24.
  Upgrade Node locally before pulling this.
- The match history of the admin match page reads `audit_log` through an index on `metadata->>'match_id'` for game
  events instead of scanning the table.
- The build no longer needs `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` (CI dropped its placeholders).
- **CI runs the Vitest suite and the type-check once, with a 30 minute timeout and no lint warnings allowed**
  (`npm run lint` passes `--max-warnings=0`). `legacy-peer-deps` is gone from `.npmrc`.
- **Teams in kit leagues are no longer refused for breaking the stage rules.** `POST /api/teams`,
  `PATCH /api/teams/[id]` and `POST /api/match-prep` save the team and the success body carries the verdict as
  `team_check` (absent: no kit rules or rules met; `{ status: 'unmet', verdict }`; `{ status: 'unavailable' }` when the
  verdict could not be computed). **API contract change for external clients:** `team_check` moves from the error body to
  the success body with this new shape, and the 400 `team_check_failed` is no longer returned. Breaks of the phase's
  ruleset are advisory as well, as in the classic leagues. A match-bound team is judged at its match's round;
  `POST /api/validate-team` takes an optional `match_id` (with `tournament_id`; 404 `match_not_found`, 403
  `match_prep_not_participant`) and is rate limited to 240 per minute and player (429 `rate_limited`).
- **An engine tie in a Showdown replay no longer ends as a plain 400, for every league.** The match goes
  to `disputed` with an `unresolved` outcome, is never scored, is audited as `match.replay_unresolved` and answers 409
  `match_replay_unresolved`; a log without a winner and without a tie stays 400 `replay_winner_unknown`. `match_outcomes` is
  written for every completed match of every league type. A reset, a reopen or a deleted last game removes the row.
- **The first round of a kit league whose format has a draw or a gift form is refused until it is ready** (409
  `format_not_ready`: `relation_undrawn`, `action_incomplete`); a league admin can start anyway with `?force=true`, audited
  as `season.format.round.force_start`. The readiness checklist gains a calendar start item.
- **Re-attaching or detaching a format over a draw, gifts, submitted picks or adjustments is refused** (409
  `format_runtime_has_data`, with the counts) unless the request carries `confirm_clear: true`; a confirmed replace or
  detach empties the league's nine runtime tables, so stale "already fired" event keys and locked actions cannot block the
  new format.
- **Round routes.** `generate-all-rounds` and `rounds/manual` now fire `stage_start` and `round_start`, persist the stage
  calendar's deadline and open the pairing checks, like `generate-round` already did (a kit phase used to be activated
  without them). `generate-round` passes the table extras (adjustments, custom metrics, seeds, ratings) to the pairing, so
  Swiss ranks by the table the public sees.
- **Relation adjustments are validated.** Links must fit the roster and the relation's shape (`invalid_links`), a rank order
  must be the full roster (`invalid_order`), a revoke beyond the holding is refused (`insufficient_holding`), an item
  outside the domain as amended is refused, and a relation adjustment that asks for nothing is `invalid_links`; the history
  row of a relation adjustment keeps `link_count` instead of the pairs. A reason over 500 characters is a 400, not a 500.
- **A reset or reopen takes back what a completion applied.** Granted items are revoked and awarded points cancelled when a
  completed match of a kit league is reset or reopened, and its next completion is a new event
  (`match_reverted:<id>:<n>`, `match_completed:<id>:<n>`). A failed revert makes the reopen incomplete (500
  `match_reopen_incomplete`, failed step `format`) instead of success with an audit flag.
- **Admin settle writes the outcome first.** `POST /api/admin/matches/[id]/result` stores the admin's forfeit, no-show or
  played outcome before the status flip and removes it again when the flip loses, so a completed match can no longer lose a
  forfeit to a retried `played` row; the cron's deadline forfeit uses the same order.
- **A save over a submitted pick** (the narrow race the route does not close) demotes it to a draft, releases the exclusive
  items it granted and clears `submitted_at`; the lock then skips it and a deadline policy sees a player who has not submitted.
- **Rulesets:** the teambuilder shows level rules from the shared team check (`level_rules`), and `levels: null` no longer
  changes the hash of an existing ruleset (see Added).
- **Admin results, substitutions and rosters in custom-format leagues** (review round on the format studio PR).
  - Admin game edit or delete of a completed bracket match that already fed played later matches now asks for approval
    and resets those matches as a cascading reset does (409 `game_change_downstream_played`; resend naming the matches in
    `confirm_downstream`); a winner or battle stats of a player who is not in the match are refused before anything is
    reset. Regenerating the bracket of an already completed format phase is refused, and taking back a result in a
    completed format phase (match reset, reopen, game change, round delete) warns which players already advanced.
  - Substituting a player in a custom-format league moves the departed player's format data (links, items, picks,
    attributes, progress, open challenges) to the substitute in one transaction, with a preview, a warning when the
    player keeps another phase, and 409 on colliding data (`format_substitute_*_collide`); reverts of earlier matches,
    the late-joiner list and the effects of a match that still names the departed player follow the seat.
  - An admin can change the roster of a started format phase (add, remove, re-seed, sync, seed by rating) by forcing it
    with a reason, which is audited; the Live tab lists late joiners and the one-time events they missed; a player who
    left the league no longer acts (no submissions, no random picks); a player enrolled in an unfinished format league
    cannot be deleted until substituted or removed.
  - Format Studio: an admin who also plays no longer sees their own rows when unmasking Secret Santa relations (a
    "Show my rows" button reveals them per view), the compiler warns when a public rule such as a pairing filter reads a
    hidden relation, and the unused `review` flag on player actions is removed (old documents that carry it still load).
  - Wichtelcup: Toxtricity-Low-Key and Dragon Ascent are legal (the preset bans only what the rules text or Showdown
    bans); players may delete their own match-less team in a completed or archived league, and a league closure is
    refused with a league-specific message.

### Removed

- Unused dependencies `@dnd-kit/core`, `@dnd-kit/utilities`, `@react-three/rapier` and the direct `zustand` entry
  (`zustand` stays installed through `@react-three/fiber`); `tsx` is now a locked devDependency and the maintenance
  scripts are documented as `npx --no-install tsx`.

### Fixed

- **Format engine: phase ownership, closed-league team writes and finalize races** (review round on the format studio PR).
  - A started phase that a league's format created no longer takes roster, seed, status, delete or reorder writes through the
    phase routes (409 `format_phase_owned`); an upcoming format phase and a phase the format does not own stay editable.
  - Players can no longer edit or delete teams of a completed or archived tournament or league (they used to be blocked only
    for teams linked to a completed match). Admins are not affected.
  - Admin screens reload on a stale write instead of overwriting, and two new warnings appear: `round_format_revert_failed`
    (a round delete or regenerate whose revert of a played match failed) and `format_reaction_failed` (a phase status change
    whose format reaction failed).
  - The match finalize binds to the completion and the winner it was started for: a match reset, reopened or completed again
    with another winner in between answers 409 `match_state_changed` (settle, confirm) or a bulk conflict, instead of a 500.
    A failed tournament lookup after the caches were expired no longer turns a committed result into a 500.
  - A manual action lock fires `action_locked` through the re-reading path, so a format replaced in the gap burns no key;
    an undo of a grant takes the rows of that grant first (`revoke_item` carries `source` and `source_ref`).
  - Forced phase syncs, forced or hand-listed advances and manual rounds are audited (`phase.enrollment.sync`,
    `season.phase.advance`, `round.generate` with `manual: true`); season tables score a Swiss bye by its own stage; a
    stage page with no completed match yet ranks by its own stage rules.

- **Format engine: the database fences of the round, check, adjustment, enrollment and recycle-bin writers** (invariant
  audit of the format engine, all in the unapplied `2026110[4-6]` migrations and the code that calls them).
  - **A check opened from a stale context is refused.** `format_check_open` takes the revision of the context the check
    was planned from (hooks, the team audit, the pairing filter, the cron's deadline policies): a format replaced,
    switched, detached or amended since raises `format_context_stale` (nothing inserted, the dedupe key stays free), so a
    ghost check of the old spec never lands in the new runtime or in a league with no format. Every attach (a first one
    too) clears the runtime rows of a league, so an orphan cannot be inherited.
  - **A round write and a format attach, detach or league delete exclude each other.** `round_write` takes the season
    advisory lock and the seasons row `FOR KEY SHARE` first, checks the kit phase's revision, and moves the phase to
    `active` and `current_round` up in the same transaction (the generators no longer write them in a second request that
    a failed request left undone or that could overwrite an admin's completion). Attach and detach lock every phase row
    before they decide the league has not started, so a first round can no longer be cascade-deleted by a detach or
    re-specced by a replace. `generate-round`, `generate-all-rounds` and `rounds/manual` pass the revision of the phase
    they paired from (409 `format_context_stale` when the format was replaced since; a round deleted by another admin
    answers 404 `round_not_found` instead of a 500).
  - **The admin round delete is one transaction.** `round_delete` re-checks the round's matches under the round lock and
    refuses (409 `round_changed`, new error code) when a result landed after the application's reset; the challenges that
    point at a deleted match are cancelled with it.
  - **Adjustments decide the state-reading refusals twice.** A domain amendment that removes an entry a resource holding
    the domain still holds raises `domain_in_use`, an action adjustment to the state the action is in raises
    `action_state_unchanged`, and a revoke that finds fewer units than the holding had (a removal that did not take the
    holding lock) raises `insufficient_holding`, each under the locks the call holds, so the history never records a change
    that did not happen. Every remover of items (events, a save, a submit) now takes the holding lock, and the exclusive
    keys are locked in one sorted order, so two submits that grant `[X, Y]` and `[Y, X]` never deadlock. A domain
    adjustment carries no ops. Still decided from the application's snapshot only: that a started stage's team constraint
    counted the amended domain (`stage_start` fired).
  - **An event no longer loses its other ops to a grant that a concurrent writer made impossible.** A `grant_item` that
    hits capacity or an exclusive holder after the planner read its snapshot is skipped in a savepoint and recorded in the
    event's payload (`skipped_grants`); the event and its key still land. A player's submit and an admin adjustment still
    refuse the clash. The cron's deadline draw treats `resource_item_taken` like `resource_capacity_reached` (retried next
    pass, not a failure).
  - **Enrollment writes are decided under the phase lock.** `tournament_enrollment_replace` refuses a sync that is not
    forced when the stored source is frozen or a round exists (`ENROLLMENT_FROZEN` / `ENROLLMENT_ROUNDS_EXIST`) and keeps
    the stored `frozen` flag; the freeze is one atomic update (`tournament_enrollment_freeze`) that leaves `synced_at` and
    the contributions alone, and `addParticipant` / `removeParticipant` / `updateParticipantSeeds` freeze before they write (like the swap). The raw
    `setEnrollmentSource` writer is gone. Challenge create locks both enrollment rows `FOR KEY SHARE`, like the accept, and
    the admin overview no longer counts the open challenge of a player who left the phase.
  - **The confirmation of a clear names what the admin saw.** `confirm_clear` can carry `confirmed_counts` (the counts of
    the 409); a replace or detach that finds more rows since raises `format_runtime_has_data` again with the fresh counts.
    The attach panel sends them back. A replace also deletes `format_challenges` with the other runtime tables. A league's
    `format_type` cannot change from or to `custom` under a format or after the start (database trigger; the PATCH check
    stays the early answer).
  - **Locks.** `round_write` takes the season advisory lock before any phase lock (the order of `league_trash_delete`, which
    it deadlocked with), the challenge sweeps of create and expire lock rows in id order, a decline, a withdrawal, the
    expiry, a check resolution and `round_delete` take the seasons row `FOR KEY SHARE` so a league delete waits for them and its trash
    entry holds the final state. Known and left: the keyed upserts of one event (flags, attributes, track steps) are still
    applied in op order, so two events writing the same keys in opposite order can deadlock (the hook reports a failed
    step and the heal retries).
  - **Restoring a league no longer fires what fell due in the trash.** The stage calendar is made of absolute dates, so
    `league_trash_restore` adds the time away to `season_formats.clock_shift_seconds` and the calendar adds it to every
    instant it computes (marks, action policies, calendar-derived round policies, new round deadlines).
  - **Cron and hooks decide and write through one context.** A due mark and the lock events fire through the context they
    were decided from (a format replaced since is refused, not re-read and fired into the new format); the stage-end hook
    returns when the league left the kit engine instead of evaluating the old context; a failed bracket propagation blocks
    the format hook, so the phase cannot complete around the missing next-slot match; making a challenge on a league whose
    engine is not `kit` answers `challenge_ladder_inactive` (the documented code).
- Vercel Analytics is rendered only on a Vercel deployment (`VERCEL=1`). Anywhere else (a local `next start`, CI, the
  e2e suite) its `/_vercel/insights/script.js` is a 404 and every page logged console errors. Production behaviour is
  unchanged.
- `.claude/local-assets.cjs` refused every `next start` of a local build: it took the placeholder URL in the sprite-base
  error message (`https://<project>.supabase.co/...`) for a baked Storage bucket. It now needs a real host.
- `scripts/route-manifest.mjs` held a raw NUL byte, so git treated it as binary and its diff was hidden; a NUL byte in
  a tracked source file now fails `src/lib/__tests__/source-line-endings.test.ts`.
- **Format runtime: a pick is no longer stored against a format that changed, and a holding cannot outgrow its capacity.**
  A save or a submit of a player action (and the cron's deadline draw) now carries the revision of the format it was
  validated against; an attach, a replace, a detach, an engine switch or a domain amendment that lands in between makes the
  database refuse it as `format_context_stale` (409; the player view reloads and the pick is checked again; the cron
  draws again on the next pass). The capacity of a resource is enforced in SQL under one lock per
  (league, resource, player) that every grant takes, so concurrent submits of different actions, an event and an admin
  adjustment cannot together exceed it (`resource_capacity_reached`, 409, nothing of the refused call is written); an
  admin resource adjustment that would exceed the capacity is now refused too. Withdrawing a challenge after its accept
  window no longer turns it into a free `cancelled` one: it is stored as `expired`, which the cooldown counts, and answers
  `challenge_expired`.
- **Format engine review follow-ups.** Rank steps at an advancement cut and in the pairing use the same table as the public
  page (custom metrics, placements, point adjustments and the admin order were ignored there); a `foreach_group` stage keeps
  every group's adjustments; byes score only in a Swiss stage; an exclusive grant respects the resource's capacity; the
  `match_completed` hook never fires with zero faints after a failed `outcome` step (the finalize step is blocked, and the
  heal retries); `rel()` in a metric answers from the publicly visible links; the visible links of a relation are ordered by
  visible fields only, so the hidden side cannot be recovered by position; time marks are keyed by stage
  (`time:<stage>:<mark>`, a mark key is unique only within its stage); a lost `action_locked` cascade is repaired by the
  next retry or cron pass; a bipartite stage guarantees every A meets every B; two concurrent first-round generations can
  no longer duplicate a phase's groups; auto-advance continues with the other targets when one fails; the cron no longer
  starves leagues beyond the first 100 or ignores its time budget; an unevaluable `allow` expression of a filter is a 422
  instead of a generic 500.
- **Format runtime privacy and consistency (second review).**
  - A player's submission against a hidden pool (an `admins` domain, or a `when_unlocked` domain still locked) is
    answered with `domain_locked` alone, with no per-pick answer, so it can no longer tell a member id from a non-member.
    The cron's deadline pick keeps every check.
  - The `taken` flag of an action step is sent for any globally exclusive resource whatever its visibility, with no holder
    and no moment. The Wichtelcup premium step now shows taken species; the junk step shows none.
  - New compiler error `constraint_source_hidden_domain` (100 codes in all): a count source over an `admins` domain, or a
    `distinct by attr` rule over an `admins` domain whose entries carry the attribute, would leak the hidden pool through
    a verdict. A stored draft or fork that does this now fails to compile; no shipped example does.
  - The play page `/dashboard/leagues/[id]/play` applies the good-standing rule: a banned or suspended player (not a site
    admin) gets the "not a member" notice and no league data is read, like `GET .../format/me`.
  - `POST .../format/relations/unmask` writes and awaits its audit entry before it builds the body
    (`logAuditEventStrict`); when the write fails the answer is a 503 with no data.
  - The checks inbox shows redacted wording for a team audit whose subject is hidden from the viewer, instead of an empty
    rules or species list (EN and DE).
  - `POST /api/admin/matches/[id]/result` answers 409 `match_state_changed` with `params.status` `disputed` when the match
    is disputed and already has its `unresolved` outcome row (nothing is staged, no status flip); a lost race on a
    disputed match writes that row back instead of leaving the match without it. The cron's deadline forfeit skips such
    a match quietly.
  - The format cron retries a failed revert (a reset or reopen that left `match_completed` applied): per league and run it
    re-reverts up to 10 matches (25 per run) whose current completion key is fired but which are no longer completed.
    Limits stay: a match completed again before the retry keeps the old effects, and a hard-deleted match cannot be
    reverted.
  - Known limit: the locked action card shows the giver's stored picks ("Your pick"), not the recipient's current
    holdings, so an admin resource adjustment does not change it.
- **Kit leagues: a round is written together with its matches, and a round completion fires `round_end`.**
  `generate-round`, `generate-all-rounds` and `rounds/manual` write a round and its matches through the new `round_write`
  function (`20261106090000_format_challenges.sql`, one transaction under the phase lock), so a stage end that lands
  between the route's guards and the inserts can no longer leave an empty round or matches in a completed phase: the write
  answers 409 `rounds_phase_completed` and nothing is written (new error code, EN and DE), also not the new byes of a
  retry that fills a round an interrupted call left empty. A round of byes only leaves no unfinished match, so a stage end
  that comes right after it still completes the phase. A `generate-all-rounds` batch
  refused part-way keeps the rounds it already wrote, each with its matches, and generating again continues from there.
  Completing a round (`PATCH rounds/[rid]`) fires the kit `round_end` event and then evaluates the stage's `end_when`; the
  format cron fires it for completed rounds whose event never fired, which includes rounds completed before this change
  in leagues already running on the kit engine (bounded per run). Limits are listed in
  [docs/format-kit.md](docs/format-kit.md): a reopened and completed-again round does not fire `round_end` a second time,
  and a stage end that fails after `round_end` fired has no cron retry.
- **Admin Assistant review follow-ups.** A refused fact check other than "not found" or "forbidden" now reads as
  unavailable instead of "it does not exist"; a precondition read that fails stops a Build under its own code
  (`precondition_read_failed`) instead of "the situation changed"; an older card is retired before its replacement is
  stored; an unreadable stored Plan says so in the panel; a card whose status refresh fails shows a warning; the payload
  check refuses data too deep or too large to scan; an undo cut off at its step limit lists every row it leaves; a Build
  stops starting steps after 225 s so the last one ends inside the route's 300 s; an unpriced model id is logged.

## [0.5.0] - 2026-10-28

### Upgrade notes

- **Apply `20261028120000_push_subscriptions.sql` BEFORE deploying the code.** It adds the `push_subscriptions` table
  (service-role only). It is backwards compatible with 0.4.1 code, and the new code does not touch the table until a
  player turns push alerts on.
- **Web Push is off until the deployment has a key pair.** Run `npx web-push generate-vapid-keys` once and set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (before the build: it is baked into the client bundle), `VAPID_PRIVATE_KEY` (secret)
  and `VAPID_SUBJECT` (`mailto:` or https). Without all three valid the server sends nothing, the push endpoint
  answers `503 push_disabled` and the draft room hides the bell. See [docs/push.md](docs/push.md).
- **The draft room no longer raises local browser notifications.** Players who had turned the old alerts on will see
  "Turn on push alerts" and must enable it once per device (the old per-pool opt-in was never carried over).

### Added

- **Web Push for draft turn alerts.** A player's devices get "your pick" and the 8 h / 4 h / 1 h reminders of a slow
  draft, and the redraft publication, even when no PokéTools page is open. Works on Chrome, Edge, Firefox and Safari
  (desktop), on Chrome for Android (tab or installed app) and on iPhone/iPad 16.4+ once PokéTools is on the Home
  Screen (the bell says so). The pushes ride the existing `draft_claim_notifications` claims, so each goes out exactly
  once, in the language stored with the device, alongside the unchanged Discord pings.
- `/api/push/subscriptions` (`GET` my devices, `POST` subscribe or refresh, `DELETE` remove): live player guard,
  same-origin check, rate limit, a push-service host allow-list, catalogued English and German error codes.
- A "Push alerts" card on the settings page lists the devices (label, added, last alert) and removes them, with the
  privacy note.
- The service worker handles `push`, `notificationclick` and `pushsubscriptionchange`. With the PWA flag off but push
  configured it is registered as `/sw.js?mode=push`, which caches nothing.

### Changed

- The draft room's bell is now "Push alerts on this device" (per device, not per pool). It never prompts on its own,
  shows the Home Screen hint on iPhone/iPad tabs and how to unblock a blocked permission.
- The hidden-tab my-turn watch no longer shows notifications; it only keeps the server resolving due timeouts.
- `public/sw.js` cache version `v1` to `v2`.

### Removed

- The local `new Notification(...)` alerts of the draft room (they threw "Illegal constructor" on Android), their
  per-pool opt-in and cross-tab dedupe keys in `localStorage` (cleaned up on the next visit), and
  `src/lib/draft-ui/notify-schedule.ts`.

### Security

- A subscription endpoint is a URL the server requests later, so only `https` URLs on the browser vendors' push
  services are accepted (`src/lib/push/endpoint.ts`); the device list never returns keys or endpoints.

## [0.4.1] - 2026-10-27

### Upgrade notes

- **Apply two migrations BEFORE deploying the code.** Both are backwards compatible with 0.4.0 code.
  1. `20261027190000_draft_start_reroll_every_two_rounds.sql` replaces `draft_start` (same signature): an Initial
     draft draws a new order every two rounds. Drafts that have already started keep their queue.
  2. `20261027193000_draft_token_participation_rate.sql` adds `epb_draft_token_purchases.tokens_used` (default 1, so
     existing purchases keep counting as one token) and gives `epb_purchase_draft_token` a `p_tokens_per_progress`
     parameter with default 1. The 0.4.1 code passes it, so it fails against a database without this migration.

### Added

- **Delete a draft that has not started.** An Initial draft in setup (or a cancelled one) can be deleted from its draft
  panel and from the league group card, so the groups can change again and the draft can be created afresh. The
  delete is audited (`draft.pool.delete`) and filters on the phase itself, so a Start that lands at the same moment
  deletes nothing (409). The button is the UI's rule (Initial drafts only); `DELETE /api/drafts/[id]` itself accepts
  any queue pool in `setup` or `cancelled`.
- **Live or slow when creating a draft.** A slow draft without a pick time gets the 12-hour default; the merged
  settings are checked like an edit in the control panel.
- **Random draft order.** A new Initial draft seats its trainers in a random order (server-side, cryptographic RNG)
  instead of database order, and "Roll order" redraws it until the draft starts (`POST /api/drafts/[id]/roll-order`,
  audited as `draft.order.roll`).
- **A new order every two rounds.** Rounds 1-2 follow the seats (forward, then reversed); every later pair of rounds
  gets a freshly drawn order, forward then reversed; a lone last round of an odd roster runs forward only. The pair
  orders are logged when the draft starts. Redrafts keep the standings order with a plain snake.
- **Draft Kill Tokens on a participation line** cost and count as many tokens as that line's token rate (new optional
  pack field `participationPoints.draftKillTokensPerProgress`, which falls back to `comebackTokensPerProgress`), for
  +1 progress. Other lines are unchanged. A line that already holds a token keeps showing what its purchase was
  charged (the stored tokens and points); its refusal reason still follows the database, which checks the player
  allowance at the pack's current rate first.

### Changed

- The make-up pick time is a live-draft setting only: in a slow draft the form hides and does not send it and the
  merged-config check skips it, because every pick uses the ladder stage there; make-up chips show no clock in slow
  mode. The API body schema still bounds the field (at least 30 s, not above `pick_seconds`) in every mode.
- Deleting a legacy draft pool also filters on its status, closing the same race.

## [0.4.0] - 2026-10-26

### Upgrade notes

- **Apply three migrations, in this order, BEFORE deploying the code.**
  1. `20261024100000_season_format_type_custom.sql` adds the value `custom` to the league type enum. Apply it alone
     and let it commit before the next file (a new enum value cannot be used in the transaction that adds it). It
     cannot be undone.
  2. `20261024100100_format_definitions.sql` adds `format_definitions` and `format_definition_versions` and the
     function that publishes a version.
  3. `20261024100200_season_formats_and_stage_columns.sql` adds `season_formats`, the two `tournaments` columns
     `format_stage_key` and `stage_spec`, the attach and detach functions and the trigger that keeps a custom league
     without a format from starting.

  Without them a league created as "Custom format", the new format routes and the round and bracket generation of a
  custom league fail. Existing leagues, tournaments and Evolution Point Buy are unaffected by the migrations. There is
  no new environment variable.
- **Apply migration `20261025090000_wiki_note_resubmission_block.sql` BEFORE deploying the code.** It is independent
  of the three Format Studio migrations above. It adds `wiki_notes.resubmission_blocked_at` and
  `resubmission_blocked_by` (both nullable) with a CHECK and an index. Note reads keep working without it, but the
  writes that name the new columns fail until they exist: an author's edit of a note, approving a note, and blocking
  or unblocking resubmission. Old code keeps working after the migration until a note is blocked: its CHECK then
  refuses an old approve or author edit of that note, so do not roll back to old code once a note is blocked.
- API clients that send an even best-of value, or change the league type of a started league, now receive `400` /
  `409`.
- **Apply the league recycle bin, Format Studio preset and Ruleset Studio migrations in this order, BEFORE deploying the
  code, and not with one blanket `db push`.** The last file is the contract step of the ruleset change and must wait
  for the new code.
  1. `20261026090000_season_format_preset_rulesets.sql` (after the three Format Studio files above) adds
     `season_formats.preset_rulesets` and a new `format_attach_season` overload (the old 7-argument one is dropped).
     File 8 rewrites its cleanup function for ruleset definitions, so apply the files in this order.
  2. `20261026091000_league_trash.sql` adds the six `league_trash*` tables, the delete, restore and expiry functions
     and swaps `player_streaks.last_match_id` to `ON DELETE SET NULL` (`NOT VALID`).
  3. `20261026091100_league_trash_validate_streak_fk.sql` validates that key.
  4. `20261026091200`, `20261026091300`, `20261026091400` and `20261026091500` (`league_trash_index_*`) each build one
     index `CONCURRENTLY`. They are one statement per file on purpose; if your tooling sends files in a transaction,
     run them by hand at a quiet time with `SET lock_timeout = '5s';` first (`docs/operations-backup.md`).
  5. Before the first real league delete on a database that carries tables this repository cannot see, run
     `SELECT public.league_trash__assert_inventory();`: a table that references a league and is not classified makes
     the delete abort instead of losing data.
  6. `20261026100000_ruleset_definitions.sql` adds the ruleset library tables.
  7. Run `node scripts/ruleset/report-unknown-ids.mjs` against a read-only export of the rulesets (the queries are in
     its header). `foldedOnly` entries become **stricter** after the conversion and `foldMismatch` must be empty; decide
     per entry before continuing.
  8. `20261026100100_ruleset_conversion_and_pins.sql` (expand) converts every ruleset into a definition with one
     published version **whose id is the old ruleset's id**, replays the old "which ruleset does this phase enforce"
     heuristic once into the stored pins (every changed row is logged in `ruleset_pin_backfill_log`) and adds the pin
     foreign keys. From here until step 10, **pause creating and editing rulesets** with the old code.
  9. Deploy the code and run step 10 straight away. Until it runs, the pin keys of leagues and phases still point at the
     old table, so everything that publishes a ruleset version and pins it fails (a format attach with a rule-preset
     stage, the first point-buy league, a league or phase given a ruleset published after step 8). Check a league page
     and a team validation in that window, not a format attach with a preset stage.
  10. `20261026100200_ruleset_contract.sql` (contract) runs a catch-up conversion, aborts if the rules or the name of a
      ruleset were edited after the conversion (publish the edit as a new version or restore the row, then retry),
      rewrites format drafts that name a legacy ruleset id to its definition id, swaps the pin keys and renames
      `rulesets` to `rulesets_legacy`. Keep `rulesets_legacy` and `ruleset_pin_backfill_log` for one release as the
      revert source; a later cleanup migration drops them.
  The new code needs the files of steps 1 to 8; the code that is still deployed keeps working until step 10, which is
  why step 10 waits for the new code. There is no new environment variable. Migrations are forward-only (no down files).
- **New cron `/api/cron/expire-league-trash`** (daily, 03:40 UTC, declared in `vercel.json`). On another host call it
  once a day with `Authorization: Bearer <CRON_SECRET>`, like the other cron routes. Alert on non-2xx answers.
- **`@tanstack/react-virtual` 3.14.23** is a new dependency (the ruleset picker): run `npm ci`.
- **Deleting a league no longer destroys it**, and `DELETE /api/seasons/[id]` no longer answers `409
  SEASON_HAS_DEPENDENTS`. Clients that expect either must follow the new answer (see **Changed**).
- **Leagues and phases now pin a ruleset version.** API clients that read `ruleset_id` get a version id (for a converted
  ruleset the same uuid as before); `PATCH /api/rulesets/[id]` publishes a new version and returns a new id instead of
  editing in place.

### Added

- **Ruleset Studio.** Rulesets are now data you can inspect and trust: a ruleset is a base (a catalog preset or a blank
  page) plus bans, unbans, allowlists and clauses per category, edited as a draft and **published as an immutable,
  numbered version** whose effective rules are computed once and frozen. A league or phase **pins** a version, so editing
  a ruleset never changes a running league. `/admin/rulesets` is open to every admin tier and has a library (**Your
  rulesets**, **Shared with you**, **League rulesets**, the **Site catalog** and the **Rule presets**), a read-only page
  per ruleset (rules in plain sentences, versions with what each changed, where it is used) and an editor with a live
  summary against the base, an issues list with one-click fixes, an undo history and a change list with a revert per
  entry. A new ruleset starts blank, from a rule preset, from a shared ruleset or from a `.json` file. Rulesets are
  `private`, shared with league admins or in the gallery (site admins); the permission matrix is in
  `docs/ruleset-studio.md`. API: `/api/ruleset-definitions` (create, draft with a compare-and-set revision, publish,
  fork, usage, pins, version read) and the public `/api/rulesets` keeps its URL and flat shape (plus `gen`, `universe`,
  `allow`, `version`).
- **Entry picker.** Bans, unbans and allowlists are chosen in a virtualized picker over the catalog of one generation
  (cards, compact list or table): bilingual search, facets (state, type, tier, generation, number ranges, item category,
  forme), sorting, "include formes", multi-select with bulk actions and keyboard navigation with screen-reader
  announcements. `GET /api/pkmn/catalog/[kind]` serves the catalog (public, ETag, long cache); icons are drawn from the
  Showdown sheets by cell number (`SheetIcon`).
- **Rule preset catalog.** Every Showdown ladder format of generations 1 to 9 (singles, doubles, the National Dex family,
  Monotype, 1v1), the **Smogon draft formats** (Draft for generations 3 to 9, NatDex, NatDex LC, 6v6 and 4v4 doubles) and
  Pokémon Champions (a roster allowlist) as presets with their clauses, ban lists and rule facts, transcribed from
  Pokémon Showdown at a pinned commit and integrity-tested against the dex. **Add Smogon tour bans** applies the
  documented tournament extras of a draft preset as ordinary, editable entries. `GET /api/pkmn/presets/[id]/rules` and
  `.../tour-overlay`. See `docs/ruleset-presets.md`.
- **Move a league to a newer ruleset version, knowing what it costs.** The pin card on a league, phase or standalone
  tournament offers "update to version N". For a started target the confirmation first says how many already
  submitted teams would stop being valid (`POST /api/ruleset-definitions/[id]/pins/impact`; the real validator against
  both versions, differential, at most 2,000 teams per request), and the move needs an explicit confirmation. A completed
  target is locked. Every move is audited (`ruleset.pin`).
- **Library details.** Ruleset cards show how many leagues and phases use them and a **Catalog updated** badge when the
  published version was computed from older catalog data; the read-only page lists what each recent version changed
  against the one before; the ruleset select groups doubles rulesets; a league cloned with "Start from" shows the
  ruleset it starts with.
- **League recycle bin.** Deleting a league moves it to the trash for 90 days instead of destroying it. The superadmin
  sees the trash at **Admin > Leagues > League trash**, restores a league in one step (all or nothing; running drafts
  come back paused; every deadline moves by the time spent in the trash; statistics, ratings and streaks are rebuilt) and
  can run a rebuild that a delete or restore left pending. A daily cron (`/api/cron/expire-league-trash`) removes
  leagues whose time ran out and their social images. New audit events `season.restore`, `season.rebuild` and
  `season.purge`. While a league is in the trash its players, rulesets and point-buy lists cannot be deleted. See
  `docs/season.md`.
- **Draft room, after the first round of player feedback.** The left stage shows the pinned line as one **group
  portrait** of its stages that fits its pane by width and height; a slim status strip replaces the connection and
  spectator banners; the roster cards have a larger sprite row; filter chips are compact Showdown-style pills that wrap
  instead of scrolling; the finder has a **Base | Final** switch for the stat sorts; **My roster** has a collapsible
  **team weakness table** (which attacking types the owned lines are weak to, with Weak, Resist and Immune counts, for
  the base or the final stage); the screen is a fixed-height box on desktop so only the stage column and the wall scroll.
  `/draft-preview?scenario=live-roster` shows the table open.
- **Price groups filter the EvoLiga point-buy list.** The roster section of a league page has a row of price-group pills
  with line counts; the league admin Overview links the dates to the Settings tab.
- **Showdown formats as editable presets in the Format Studio.** A stage can name a rule preset (`gen9ou`, a draft
  format, Champions). Picking one on a stage pre-picks the doubles setting (a new format or an example fork also sets
  best of 3 for VGC; the series length of a stage is otherwise the editor's own choice); attaching the format creates a ruleset per
  preset for the league (version 1, editable in the Ruleset Studio), which a re-attach reuses and a detach removes.
  New diagnostic `ruleset_preset_unknown`.
- **Dev previews** `/ruleset-preview` (editor scenarios) and `/ruleset-preview/surfaces` (library, read-only page, pin
  and usage panels, dialogs, trash, Danger tab) render the real components against an in-memory library; they refuse
  every `/api` path they do not fake.
- Audit events `ruleset.create`, `ruleset.fork`, `ruleset.publish`, `ruleset.visibility`, `ruleset.delete`, `ruleset.pin`
  and `ruleset.seed`.
- New docs: `docs/ruleset-studio.md`, `docs/ruleset-presets.md`.
- **League settings editor.** The Settings tab of the admin league page opens with **League details**: name, league
  type, battle ruleset and the start and end date, saved with only the changed fields. The description, theme and
  content language keep their own editors.
- **Standalone tournament settings editor.** The admin tournament page opens with a **Settings** section (name, ruleset,
  best-of and overrides, doubles, bracket type, team visibility, grand-final reset). Bracket type, ruleset and doubles
  lock once the tournament has started.
- **Reopen a completed phase or tournament.** A **Reopen** button, with a confirmation that states the consequences,
  sets a completed phase or tournament back to active. Results and standings stay as they are; completing it again
  announces the completion again.
- **Insert position for new phases.** A new phase can be placed at the end, before or after an existing phase; options
  in front of a started phase are disabled.
- **`season.update` audit event.** A general league edit (name, league type, ruleset, dates, status, archive, theme,
  language) is now audited with the changed fields. The description text is never stored in the row.
- **Editable format rules.** The Format Rules section of a point-buy league's Rules tab is now an editor for the draft
  budget, picks, Draft Kill Token ratio and limits (total and per line), banned moves and items, and the stored
  tiebreaker order, with the schema's limits on every control and the errors under the field. Save sends the full set
  of rules to the existing endpoint; Tera rules stay on the format pack (shown read-only) and the redraft phase is
  shown, not edited. If the rules cannot be loaded the editor shows the error with **Retry** and disables
  **Initialize** and Save, so an unreadable row is never overwritten with defaults. On a started league Save asks
  first: the change applies from now on and existing draft pools are not recomputed. The tiebreaker order ranks the
  standings (see Changed).
- **Start from an existing league.** `/admin/leagues/new` has a **Start from** picker. A chosen league prefills the
  league type, battle ruleset, theme, language and description, and its phases are copied (name, bracket type,
  ruleset, best-of, doubles, visibility, grand-final reset, advancement rule and order). Optionally the roster is
  copied, and site admins can also copy the league admins; league admins can only start from their own leagues.
  Picking or changing the league keeps the name and dates already typed.
  Rounds, matches, results, phase participants, groups, point-buy lists, tokens, draft data and format rules are
  never copied. If a step fails the new league is removed again; if that cleanup fails too, the error names what
  remains. A league with the custom type is not offered as a source and the server refuses it (the phases of a custom
  league come from its attached format, so a copy could never start). The API takes an optional `clone_from` on
  `POST /api/seasons`.
- **Format drift report** on the admin Data page (site admins). **Run report** lists, read-only, leagues whose stored
  tiebreaker order differs from the format pack's default (information: the standings use the stored order; an order
  the standings cannot use is marked, because the table then falls back to the pack default) and phase pairs
  whose advancement rule sits on the source or the target phase or differs between them (enrollment reads the rule
  from the phase being enrolled, the phase timeline shows it on the phase before). It changes nothing, is not loaded
  until requested, and reads at most 10,000 rows per list. `GET /api/admin/format-drift`.
- **`season.clone` and `season.clone_failed` audit events** for a league started from another league.
- **Format kit library.** `src/lib/format-kit` now holds the document schema with bilingual text, a safe expression language, a primitive registry, a compiler that reports diagnostics with fixes, and three preset definitions (classic league, cup, Swiss with top cut). On its own it changes no page or route; the format definitions API below builds on it. See `docs/format-kit.md`.
- **Format Studio.** Site admins and league admins get a **Formats** entry in the admin navigation. The gallery at `/admin/formats` shows three example formats, each marked "Example. Change anything.", and **Your leagues** with a generated descriptor per league (league admins see only their own). The detail pages show a stage outline, the rules text in English and German, diagnostics in plain words and a coverage line, and the league admin page gains a **Format** tab with the same view. Public pages are unchanged, and existing leagues and Evolution Point Buy behave exactly as before. For an Evolution Point Buy league the Format view describes what its tables do: the stored tiebreaker order (else the pack's chain) and the pack's match points in round robin and Swiss. See `docs/format-kit.md`.
- **Format definitions API.** Admins can create, save, publish, fork, share and delete formats through `/api/formats`.
  A draft is any JSON object and is saved with a revision check (`draft_rev`), so two editors cannot overwrite each
  other silently. Publishing compiles the draft with the format kit and stores an immutable, hash-checked version;
  a draft with an error is refused with the count of errors. A format is `private`, shared with all admins
  (`league`) or in the gallery (site admins only); league admins see only their own formats and the shared ones. The name
  and summary other admins see follow the draft only while a format is private; once it is shared, only a publish updates them (from the published version's identity). A name that holds a NUL character or
  a lone surrogate is refused with a 400 instead of a server error, and a list page past the last row answers an empty
  page with the real total.
  Forking copies the latest published version of a format, or one of the three shipped examples, into a private
  format of the caller. A format that was published or is attached to a league cannot be deleted. Bodies are bounded
  (1 MiB raw, 256 KB document) and every write is rate limited and audited.
- **Custom format league type.** A league can be created with the new league type **Custom format (Format Studio)**.
  `POST /api/seasons/[id]/format` attaches a published format version to it before it starts: the version is frozen
  into the league (later changes to the format do not touch it) and one phase is created per format stage with its
  bracket type, best-of lengths, round overrides, doubles flag and ruleset. Attaching again replaces the format and
  keeps the phases the new version still has; `DELETE` detaches it. The answer lists what the engine does not run yet
  (round-robin legs, a third-place match, wildcard, threshold and bottom-N selections, groups, round lengths the
  phase round names cannot express) as codes.
- **A custom league without a format cannot start.** The round and bracket generation routes refuse it with
  `format_not_attached` before anything is written, and a database trigger refuses to set the league active.
- **Format Studio editor.** Admins can now write formats in `/admin/formats`. **New format** starts from a blank
  document, one of the shipped examples (or a gallery format), a league's structure (the "Copy as a new format" button
  on a league's Studio page, which drops the league's module facts and resets named rulesets) or an imported `.json`
  file, with a report of unknown fields and an option to remove them. The editor is a form with an outline and an
  inspector for the identity, stages (participants, groups, pairing, match length with round exceptions, ruleset,
  scoring, ranking chain), advancement rules, Honor cards and rules text, in English and German. A live preview shows
  the **Issues** in plain words with jump-to-field and one-click fixes, the generated **Rules** text and a **Schedule**
  estimate (rounds, matches, byes and weeks for a chosen number of players and cadence). Saving is explicit (Save draft
  or Ctrl/Cmd+S) with a "changed elsewhere" dialog when another editor saved first (a publish that finds a newer
  revision opens it too); leaving with unsaved changes asks first, the browser's back button included. Number fields
  take a decimal comma where decimals are allowed. A format can be published with an optional English and German changelog, shared (private, shared with league
  admins, or in the gallery for site admins), forked and deleted. The index lists **Your formats** and **Shared with
  you**, and each has a read-only page.
- **Attach a format to a custom league.** The Format tab of a custom league has an attach panel: pick one of your
  published formats, one shared with league admins or a gallery format, see the phases the attach would create (and
  the parts the engine does not run yet, in plain words), then attach, re-attach or detach. The panel says why the
  button is disabled (nothing chosen, version with errors, no league ruleset for a stage that needs one, hand-made
  phases, league already started) and shows the attached version, its frozen hash and the phases created.
- **Readiness checklist.** A custom league that has not started shows "Ready to start?" on its overview and Format tabs: a format is
  attached, its phases exist, enough players are registered, every stage has a ruleset, each with a link to where it is
  fixed. Until a format is attached the **Active** status is disabled and says why, instead of failing after the click.
  Creating a league of the type Custom format now opens its Format tab.
- **Not in the engine yet.** Attaching a format creates its phases, but the engine still pairs, scores and advances
  them like any other phase: there is no mock standings preview, sentence builder, flow canvas or simulator, groups are
  not created, and round-robin legs, third-place matches and wildcard, threshold and bottom-N selections are not run.
  The shipped examples are forked from code, not stored as rows.
- Wiki moderation: the superadmin can close a rejected note for resubmission ("Block from resubmitting", behind a
  confirmation, undone with "Allow resubmitting"). `/admin/wiki` gains a "Rejected" view with a "Blocked" badge. The
  author's edit of a blocked note is refused (`wiki_note_resubmission_blocked`, English and German) and re-queues
  nothing. Site admins who are not the superadmin cannot block. Both actions are audited
  (`wiki.note.block_resubmission`, `wiki.note.unblock_resubmission`).
- **Start-up checklist in the round manager.** Standalone tournaments and league phases show what is still missing
  before Generate can work (participants, ruleset, best-of, league groups, seeding, the previous round, the rounds a
  round robin still has to generate). Generate is disabled while an item is blocking and says why; manual round
  creation is not affected.
- **Pending rounds are no longer silent.** A generated round stays pending (players cannot report) until it is
  started. The round manager now shows a notice with a one-click Start for the next pending round.
- **"Start the new round right away".** An option next to Generate, off by default. The API accepts an optional
  `start_round` in the JSON body of `POST /api/generate-round/[tid]`, `POST /api/tournaments/[id]/generate-all-rounds`
  (starts only the first new round) and `POST /api/tournaments/[id]/generate-bracket` (starts the first round and
  returns `started_round_id`). Without the body nothing changes. If the start itself fails, the rounds are still
  created and stay pending.
- **"All N rounds generated" for round robin.** Once every round exists the round manager hides Generate and says so.
- **Audit events** `round.generate`, `bracket.generate` and `tournament.seeds.update`, with English and German labels.
- **Completion confirmation with a series check.** Completing or disputing a match on the admin match page asks first.
  The page shows the recorded series (`2 – 1 from 3 games`, with the best-of from the round; if that read fails the
  page still opens without it) and tags the player the games favour. Completing warns when the result contradicts the recorded games (no games, games without a winner,
  fewer wins than the best-of needs, a different winner) and then needs a ticked acknowledgement. The reset dialog
  for downstream matches shows how many matches it resets.
- **Dismissible roster errors.** A failed action on the admin Players page shows a dismissible alert, scrolled into view, and keeps
  the table; a failed first load shows the error with **Retry**.
- **Role-change and delete confirmations** on the Players page name the player: make or remove admin, make or remove
  creator, delete and reinstate.
- **Ban reason** under the status of a banned player.
- **Roster URL state.** The Players page keeps its search, sort, page and page size in the URL.
- **Schedule and reschedule from the admin match page.** A site admin or the resource admin of the match's league or
  tournament can set, move or clear a match's time (`PATCH /api/admin/matches/[id]/schedule`). A completed match
  cannot be rescheduled. A change cancels the match's open time proposals, so a stale proposal cannot move the match
  later, and is audited (`match.schedule`).
- **Reopen without a reset.** A completed, pending-confirmation or disputed match can be sent back to in progress
  with its games kept (`POST /api/admin/matches/[id]/reopen`, reason required). For a completed match the round
  status, ratings and rating history, streaks, signatures and Evolution Point Buy progress are rebuilt and empty
  bracket slots the result had filled are removed. Achievements and an announcement already sent stay. It is refused
  when a later bracket match was already played. Audited as `match.reopen`.
- **Dispute reason and dispute panel.** A player can give an optional reason (up to 500 characters) when disputing a
  result. The admin match page shows who disputed, when, why, and the reported winner. Disputes made before this
  release have no recorded details. A dispute keeps the player who reported the result as the match's reporter (it no
  longer replaces the reporter with the disputer). Player disputes are now audited (`match.dispute`); an admin dispute through the
  Admin Override form is audited as `match.dispute` instead of `match.override`.
- **Per-match History.** The admin match page lists the audit events of the match and its games, newest first, in
  pages (`GET /api/admin/matches/[id]/history`). League and tournament admins read the history of their own matches.
- **Match context header.** The admin match page opens with the league, phase, round and its deadline (with an
  overdue badge), best of, scheduled time, who reported the result, the auto-confirm time, and links to the public
  match page and back to the matches list. The notes keep their line breaks.
- **Reasons and impact on reset and delete.** The match reset and delete-game dialogs ask for a reason (stored in the
  audit event) and show what will happen first: games removed, ratings rebuilt, and the played later bracket matches
  a cascading reset also resets (`GET /api/admin/matches/[id]/reset-preview`). The reason is optional on the API.
- **Sidebar Overview item.** The admin sidebar (and the mobile chips) starts with an Overview item that opens the
  dashboard.
- **Dashboard attention list.** Each match shows its league, phase and how long it has been waiting, with the dispute
  note for a disputed match, oldest first. Per-status "See all" links open the Matches list filtered to disputed or
  awaiting-confirmation matches.
- **Dashboard counters link to their lists.** The players, tournaments, active matches and leagues cards open the
  matching admin list.
- **Matches filters, part 2.** `/admin/matches` gains a Round select (per phase), a date filter (scheduled, played,
  created or updated, with from/to and the presets today, next 7 days, last 7 days and no date set), format filters
  (league format, bracket type, best-of, ruleset), a player filter with an optional head-to-head opponent, content
  filters (has replay, no replay, hand-edited stats, admin notes, no games recorded), quick filters (awaiting
  confirmation, auto-confirms within 24 hours, stale in progress for 3 days, overdue) and a sort (newest first by
  default, needs attention first, scheduled time, round deadline, last updated). Active filters show as removable
  chips with a Clear all button, the less common ones sit behind a collapsed "More filters" disclosure, everything
  lives in the URL, and league and tournament admins only ever filter within their own competitions.
- `GET /api/admin/matches/filter-options/rounds?tournament_id=` lists the rounds of one phase (scoped like the other
  matches routes). `GET /api/admin/matches/filter-options` now also lists the rulesets in scope, and the list
  response carries `players` with the names of the player filter.
- **Matches list bulk actions.** Rows on `/admin/matches` have checkboxes and a sticky bar appears once a row is
  selected, with three actions for up to 100 matches of the page: confirm as reported (matches awaiting confirmation
  with a reported winner, run through the same completion as a single confirm), set the scheduled time (completed
  matches are skipped, pending time proposals are cancelled) and add an admin note (appended as a stamped line). Each
  dialog previews what applies, and a report lists every match that was skipped, changed meanwhile or failed; those
  stay selected for a retry. The selection is cleared when the filters, the sort or the page change. A confirm
  finalizes the winner the dialog showed: the request carries it per match, and a match whose reported winner changed
  since is reported as changed meanwhile and left untouched.
- **CSV export of the filtered set.** An Export CSV button on `/admin/matches` downloads every match the current
  filters select (not only the page), within the viewer's scope and in the list's sort order, up to 5,000 matches; a
  larger set is cut and reported as "N of M" (only when more matches than the limit exist). Formula-looking cells are
  neutralised. The download link is kept alive for a few seconds so slower browsers do not cancel the file.
- `POST /api/admin/matches/batch` and `GET /api/admin/matches/export` (any admin, scoped to the caller's leagues and
  tournaments; rate limited). New audit actions: `match.bulk_confirm`, `match.bulk_schedule`, `match.bulk_note` (one
  per changed match) and `match.bulk_action` (one summary per request).

### Changed

- Colour contrast meets WCAG AA in every site palette and theme: the Plaza text, accent and status tokens are darker in
  light mode and lighter in dark mode, the dark warning ink is readable, and a test checks every documented text and
  background pair. Text on an accent fill in the draft room uses the site accent.
- Component tests can render in a DOM: `jsdom` and Testing Library are dev dependencies, and a test file opts in with
  `/** @vitest-environment jsdom */` (the suite stays on `node`). Props that existed only so markup tests could reach a
  state are gone.
- The NatDex LC Draft tour overlay also bans Razor Claw, as its tournament thread lists (preset data version
  2026-10-27.2).
- **A league delete is a move to the trash.** `DELETE /api/seasons/[id]` is never blocked by phases, draft pools, teams or
  storylines (`SEASON_HAS_DEPENDENTS` is gone), answers `data.trash { id, purge_after }` and, when the rebuild of derived
  data failed, `data.rebuild_warning` next to the successful delete. The Danger tab and the delete confirmation say what
  the trash keeps, what is recalculated and that a superadmin can restore the league for 90 days.
  `player_streaks.last_match_id` is `ON DELETE SET NULL`, so deleting a phase or league that held a player's latest match
  no longer fails.
- **The enforced ruleset is the pinned version.** `seasons.ruleset_id` and `tournaments.ruleset_id` hold the id of an
  immutable version; the old read-time guess (a phase's own "custom" ruleset, else the league's, else a ruleset named like
  the league) is gone, replaced once by the migration. Team validation enforces the four lists in block or allowlist mode,
  the Species Clause, the Item Clause, the shared-type share and the team constraints from the version's frozen rules;
  every other clause is informational and marked so. The league Settings ruleset select is read-only once the league has
  started and has a ruleset (the server refuses with `ruleset_pin_started`); the pin card is the way to a newer version.
- **The site's rulesets are seeded as gallery rulesets** (`POST /api/seed-rulesets`: one shared ruleset per standard
  Smogon format of a frozen list of 88 ids, published as version 1); the draft formats and the rest of the National Dex
  family are starting points, not seeded.
- **Format ids are parsed with one rule**: `gen`, exactly one generation digit and the tier key. `gen91v1` was read as
  generation 91 before.
- **National Dex bans were corrected** and each family's explicit bans now come from tables pinned to a Showdown commit
  (`PRESET_RULES_VERSION`). The older tier families keep their previous tables; `docs/ruleset-presets.md` lists the known
  differences.
- **Draft room.** Filter chips wrap onto as many lines as they need (nothing scrolls sideways); the stage mode, the sort
  stage and the filter sheet's switches are one shared radio-group control; the stage card is capped above the DRAFT dock
  from 1024 px, so the line picture shrinks to fit instead of ending under the button; the line-up picture's final stage
  is 46 % of the picture width (was 53 %) and neighbouring sprites overlap by at most 20 %; the line-up picture always
  uses the site default sprite style at full size (pixel and animated sprites would be scaled up blurred); the
  fixed-height desktop box measures the DRAFT dock as well as the nav and clock row.
- **Rulesets are open to every admin tier**; league admins see their own rulesets and the ones shared with all admins.
- A point-buy league's shared battle ruleset is published through the Ruleset Studio; clearing bans found on it publishes
  a new version, and leagues keep the version they pin.
- The shared studio code moved: key, JSON hashing, patch, bilingual text and identity helpers are in
  `src/lib/studio-core`, the editor frame, dialogs and library cards in `src/components/studio-shell`, and
  `RulesetPresetSelect` in `src/components/ruleset`. The format-kit barrel no longer exports `ltextSchema`,
  `boundedString` or `textString`.
- The ruleset library pages, the Danger tab and the league trash page are translated into English and German; the
  German copy has not been read by a native speaker.
- **Evolution Point Buy tables rank by the stored tiebreaker order and use the configured match points.** The
  tiebreaker order saved on the league's Rules tab now decides every Evolution Point Buy table: the league's season
  table, the group and phase tables, the tournament page, the home and dashboard standings, Insights, profiles, phase
  enrollment and advancement, the broadcast standings and the AI and Kale texts. An order the standings cannot use
  (empty, an unknown or repeated step, a decision match that is not last, or only a decision match) falls back to the
  format pack's chain. The league page and its phases score the format pack's match points in round robin and Swiss
  alike, instead of a fixed 3 and 0 in the round robin tables. Saving the rules expires the cached reads of the league
  and of each phase. Other league types are unchanged. The tables of completed Evolution Point Buy leagues may
  re-order. The Format Rules hint and the started-league confirmation say so. Cache entries of the home
  standings preview, the league page payload, the league schedule and the player profile are renamed, so entries
  written by the previous release are not served.
- **Best-of is an odd number from 1 to 15** in every form and in the API (tournament, phase, round, manual round and
  override values). Even values are refused with `400 validation_failed`. A stored even value stays listed in the
  picker, so editing an old record does not change it, and saving a phase that holds an even value still works as long
  as that value is left as it is.
- **Group count is 2 to 26** in the phase groups panel, matching the API cap.
- **League type is locked once the league has started** (active or completed, a phase that left upcoming, or any
  round) and across the point-buy boundary: `PATCH /api/seasons/[id]` answers `409 SEASON_FORMAT_LOCKED` or
  `409 SEASON_FORMAT_POINT_BUY_LOCKED`. Sending the stored type again is still fine.
- **An end date before the start date** is refused with `400 SEASON_DATES_INVALID` when creating or editing a league.
- **Phase names are unique per league** (case and spacing ignored): creating or renaming a phase onto another phase's
  name answers `409 PHASE_NAME_TAKEN`. The rule is enforced in the API only; leagues that already hold duplicates
  stay editable.
- **Standalone tournaments lock bracket type, ruleset and doubles after the start:** `PATCH /api/tournaments/[id]`
  answers `400 tournament_bracket_locked`, `tournament_ruleset_locked` or `tournament_doubles_locked` for a changed value.
- **Confirm before a group re-draw.** Drawing groups again over existing ones asks first, since it deletes the phase's
  groups and recreates them from the seeds.
- `PATCH /api/seasons/[id]` answers `404 SEASON_NOT_FOUND` for an unknown league.
- The Format Rules section subtitle on the league admin Rules tab now describes the editor.
- `POST /api/seasons` accepts an optional `clone_from` (`season_id`, `copy_roster`, `copy_admins`). Without it the
  request behaves as before. New error codes: `SEASON_CLONE_FORBIDDEN`, `SEASON_CLONE_ADMINS_FORBIDDEN`,
  `SEASON_CLONE_FAILED`, `SEASON_CLONE_CLEANUP_FAILED` and `SEASON_CLONE_CUSTOM_FORMAT` (409, a custom-type source).
- **Dialogs fit short screens.** The shared dialog is capped to the screen height: its header stays in place and its
  body scrolls, so a tall form or list no longer pushes the title or the buttons out of reach.
- **League types gain a fifth value, `custom`.** `PATCH /api/seasons/[id]` refuses a switch of the league type to or
  from `custom` (409 `season_format_type_locked`) while a format is attached or after the league has started. A
  change between the four classic league types takes no extra read and follows the league type lock above.
- **Save in the seeding table persists the visible order.** Dragging, moving and shuffling renumber every row, and
  typing a seed number re-sorts the list when the input is committed, so the list and the saved seeds always agree.
- The participants section opens by default while a tournament or phase has fewer than 2 participants.
- The dashboard counts and the attention list leave out test leagues and archived competitions; the players total also leaves out test accounts.
- "Seasons" is now "Leagues" on the dashboard.
- The sidebar highlights only the most specific item, for example Archived leagues and not Leagues as well.
- `/admin/matches` hides the matches of test leagues and of archived leagues and tournaments by default. Two toggles
  show them, and picking a league or phase, or pasting a match id, shows its matches anyway.
- The whole match row opens the admin match page; the public page is a secondary link and the "Override" button is
  gone. The admin match page's back link returns to the Matches list with its filters, also after a replay import or a game edit.
- `GET /api/admin/matches` accepts the new filter and sort parameters (unknown parameters are still refused with a
  400), and its rows carry the round name, round number, best-of, round deadline and test/archived flags.
- Dialogs (`Modal`) never grow past the viewport: a dialog taller than a short window or a zoomed page keeps its
  title bar and scrolls its body, so the buttons at the bottom stay reachable.
- The outcome of a bulk action and the CSV export status are announced to screen readers: the bulk dialog and the
  export status line each have a status region that is present before its text, and the report takes focus when it
  appears.

### Removed

- **The five-step ruleset builder** (`RulesetBuilder`, `ClauseToggleGrid`, `BanlistEditor`, `FormatChangeDialog`) and its
  messages; the Ruleset Studio replaces it. `GET /api/pkmn/format-defaults` is removed (the editor reads
  `GET /api/pkmn/presets/[id]/rules`).
- The "custom league ruleset" heuristic and the name match that chose a phase's ruleset at read time.
- The unused advancement helper (`src/lib/tournament/advancement.ts`). Internal only: league phases advance through
  the enrollment sync, which is unchanged, and its behaviour is now covered by the enrollment sync tests.
- Test Players: Reset Data, Reset Login (Mint Login for a player who already has a login), Clear Login, Remove from Season and Delete Test-Only Matches now ask first in a confirmation dialog that names the player and the season, in English and German. Create / Repair, Refresh and the first Mint Login stay one click.
- The webhook endpoints (`/api/discord-webhooks`) answer with `webhook_url_hint` instead of `webhook_url`.
- The export endpoint adds `X-Export-Count` and `X-Export-Total` response headers.

### Fixed

- **League restore.** A restore whose answer is lost to a request timeout is settled by its rebuild tombstone and
  reported as a success (the trash page says its details are unknown) instead of a plain failure. The rebuild after a
  restore stays pending while aggregate jobs of the league failed for good; running it again re-queues them.
- **League restore notice.** "N running drafts came back paused" now counts only the drafts the delete paused, not
  one an admin had paused before. A restore no longer fails when a later update removed a reference the recycle bin
  re-links; those rows stay unlinked and the notice says so.
- **Ruleset Studio chips.** An unban of an entry the preset does not rule out no longer shows the "you unbanned" chip
  with a Reset button; the entry shows as legal, and the editor warns about the redundant unban, also for allowlist
  presets.
- **Studio documents.** A text with a lone UTF-16 surrogate half is refused by every check before the database (it used
  to fail the jsonb write with a 500), and the Ruleset Studio reads a document's name with the ruleset kit's own text rule,
  so an imported file the editor accepts is no longer refused by the API.
- **Ruleset picker.** Entries no longer overlap in the grid (row heights follow the 18 px root size), the list uses the
  columns the pane has (the width was never measured, so it always showed one column), items sorted by name no longer
  repeat group headers or produce duplicate keys, compact rows keep the entry name visible, and toolbar buttons and
  toggles are 44 px touch targets on phones.
- **League trash page on phones**: each row is a card with labelled fields, so Restore is no longer behind horizontal
  scroll.
- **Draft room.** The phone timer no longer overflows the page at 375 px; the team weakness table fits the 1280 and
  1440 px panes (the Fairy column was half outside the pane); the draft preview's fixture prices follow the active
  pack's price tabs, so no line falls outside every tab.
- The format attach cleanup (`format_delete_unused_preset_rulesets`) no longer fails with 23503 on a ruleset a league
  in the trash still holds; it keeps it.
- **Discord sign-in works again.** Discord now sends an RFC 9207 `iss` parameter on the OAuth callback, and every
  Discord sign-in failed with a server Configuration error because the provider had no issuer to compare it with.
  The Discord provider now expects `https://discord.com`.
- **Completed-match reads past 1,000 rows.** The completed-match reads behind standings, pairing history, head-to-head
  and insights inputs, profile standings, and the set of players with completed matches now page through the full
  result in 1,000-row steps instead of stopping at the first 1,000 rows. The participants batch used by profiles and the point-buy list entries page the same way. A
  read that reaches its hard bound (20,000 rows) logs a warning. Results of 1,000 rows or fewer are unchanged. A new
  test rejects query reads that ask for more than 1,000 rows with `.limit`.
- A phase save error is shown once, not twice.
- Clearing every best-of override of a phase now saves; before, the empty list was never sent.
- Adding a phase after a middle phase was deleted no longer reuses another phase's stage order. New phases are placed
  after the highest stage order.
- The Format Rules section no longer offers **Initialize** after a failed load. A failed read used to look like "no
  rules yet" and let one click overwrite the stored rules with defaults.
- Wiki: an author's edit to an approved note no longer goes live unreviewed. The edit puts the note back in the
  moderation queue (and re-runs the automated scan); only edits by site admins keep the note's status.
- Wiki moderation: a reported, approved note can be unpublished from the report card ("Unpublish note", audited); the
  report is closed as reviewed in the same step, and the full note text is shown.
- Admin exports return the full number of rows asked for (up to 10,000) instead of silently stopping at 1,000, in a
  stable order, and the page says "Exported N of M rows" and when the limit was reached.
- Discord webhooks: the Test button now sends from the server, with a rate limit and an audit entry. The full webhook
  URL is no longer sent to the browser after it is saved; the list shows only the last four characters. Creating a
  global webhook is now recorded in the audit log (the entry was silently dropped before).
- Test Players: "Remove from season" acts on the player in its row instead of always the first one.
- Audit log: filtering by a resource id that is not a UUID answers with a clear validation error (and an inline
  message) instead of a server error.
- The site header fits every screen width: the menu button now replaces the link row below 1280 px, the display name is shortened with an ellipsis (full name on hover), Sign Out stays on one line, and the dark-mode toggle no longer sits outside the viewport at 1280 px.
- Page header buttons (for example New League, or Mark Completed, Archive and Delete on a phase) now wrap below the title on phones instead of widening the page, so no button is cut off.
- The admin Test Players page is translated: headings, buttons, table headers and status messages follow the site language.
- Generating a bracket with fewer than 2 participants, or a second time, now answers a translated **400**
  `tournament_participants_too_few` or **409** `bracket_already_generated` instead of a generic 500.
- Generate Next Round on a round robin that is past its last round answers **400** `rounds_all_generated` instead of a
  generic 500, and writes nothing.
- A participant list that fails to load is no longer shown to the start-up checklist as an empty roster, which
  blocked Generate with "0 participants". The participant manager now announces only a roster it actually read;
  the checklist keeps its last list, or shows its own error, until the next successful read.
- **Complete/Dispute race.** The confirm-match route reported success when the match had changed state in the
  meantime (for example a dispute landing just before a completion). It now answers `409 match_state_changed` and
  writes nothing, and the page reloads. Admin and participant confirms no longer overwrite the original submitter.
- **Admin disputes are audited.** Marking a match disputed as an admin now writes a `match.dispute` audit event
  (shown as "Match disputed"); before, it left an event only when the request carried notes.
- **Failed loads can no longer overwrite stored data.** The draft tier limits editor and the point-buy list manager
  disable saving and binding after a failed read until a read succeeds, so pack defaults cannot be saved over the
  stored limits or list binding.
- **Empty team constraints are no longer stored.** A new ruleset with an empty team-constraints block stores none
  instead of an empty object. A stored empty object that the author did not touch stays as it is.
- The Admin Override form no longer reports success when the match changed state in the meantime. It answers 409
  `match_state_changed` and the page reloads, so the admin reviews the current state.
- Submit Result and View Prep in the matches list no longer send an admin to the player dashboard. They show only to
  people who can use them (a player in the match, or a site admin for Submit Result).
- Abort draft is no longer offered before the draft has started. A hint explains there is nothing to abort yet.

### Security

- **A ruleset version id is a read capability.** The public ruleset routes, the free team validator, the team importer
  and the AI tools serve a version of a private ruleset only while a league or phase pins it; a guessed id of an
  unpinned private version is a 404. Usage names are shown only to site admins and the admins of a league-owned ruleset.
- **Superadmin-only restore.** `requireSuperadmin` (live player, superadmin identity) guards the league trash routes and
  `SuperadminGuard` the page. Two league-trash helpers run with owner rights, with an empty `search_path` and execute
  granted to `service_role` only; every new function and table of this release is service-role only.
- **A `?lang=` value no longer chooses which translator gets called.** `createTranslator` caches each language's
  translator under the matching `LOCALES` entry instead of the string it was handed, so a request value (such as the
  broadcast recap's `?lang=`) never keys the lookup whose result the caller invokes. Any string that is not a
  supported locale gets the default (English) translator. Supported locales behave as before. This closes the
  CodeQL `js/unvalidated-dynamic-method-call` alerts on the recap engine.

## [0.3.0] - 2026-10-23

### Upgrade notes

- **Apply migration `20261023145151_rounds_bye_player_ids.sql` BEFORE deploying the code.** It adds
  `rounds.bye_player_ids` (`uuid[] not null default '{}'`). The new code writes that column whenever it generates a
  round, so a round with a bye fails to insert until the column exists. Old code keeps working after the migration.
- **New cron `/api/cron/expire-suspensions`.** It is declared in `vercel.json`, so Vercel needs nothing more. On
  another host, call it every 15 minutes with `Authorization: Bearer <CRON_SECRET>`, like the other cron routes. There
  is no new environment variable.

### Added

- **Resource-admin scoping.** League and tournament admins now see only their own competitions in the admin area. The
  dashboard and the matches list are scoped to their leagues and tournaments (no site-wide counts and no activity
  feed for them), the pages of one league, phase or tournament refuse another league's admin with a "no access"
  notice, the site-admin-only pages are closed to them, and the archived lists show only their own competitions.
- **Matches filters.** `/admin/matches` filters by status, league (with phase), tournament and a text search on the
  server, pages through the full result (up to page 1,000) with an exact total, and keeps the filters in the URL. Rows
  show their league and phase. The filter choices come from the new `GET /api/admin/matches/filter-options`.
- **Player search in the pickers.** The roster, substitute, link, enrolment and league-admin player pickers search the
  server as you type (`GET /api/admin/player-search`, public fields only), so they no longer cut off at the first
  page of players. League and tournament admins find the accounts the public player list shows (active, not test
  accounts); site admins find every account. Players the picker cannot take (a player already on the roster, for
  example) are shown greyed out with the reason and cannot be picked. The admin Players page searches, sorts
  (name, Discord ID, Showdown username, status) and pages on the server too.
- **Round deadlines.** The round manager can set, change and clear a round's deadline; the change is audited, and an
  overdue round shows a badge, also when the deadline passes while the page is open.
- **Swiss byes are stored and scored.** A round remembers who had a bye, a later round never gives a second bye while
  another player has none, and a Swiss bye counts as a win from the moment its round is generated: in the
  tournament's table, the league's season standings, the standings preview and Insights. Round-robin byes score
  nothing, and an Evolution Point Buy league scores no bye on any surface, whatever its stages are (tables, previews,
  Insights in any scope, AI text). AI recaps, forecasts and Kale reports say when a record includes a bye win.
- **Timed suspensions end on time.** A cron lifts a suspension once its end has passed and writes one audit event per
  player.
- **Doubles phases.** The phase form has a doubles checkbox.

### Changed

- **`GET /api/admin/matches` answers a page, not a list.** The response is now `{ rows, total, page, pageSize,
  searchTruncated }` instead of an array capped at 200 rows, and unknown query parameters or a bad `status` are
  refused with a 400. A script reading the old array must read `rows` and page through the result.
- The player ban and suspend actions share one Ban dialog, and a suspension's end is sent as an exact time (an ISO
  date-time with offset; a value without one is refused).
- The admin link in the decision-match (tie-break) panel opens the tournament's rounds page instead of a page
  that does not exist.

### Removed

- **Private-project references are scrubbed from the public tree.** Comments, docs and test fixtures no longer cite
  internal audit or review ids, private design-spec sections, the maintainer's deferred-work register or capture-board
  cards, and fixtures use neutral league names. The raw 2026-10-20 audit batch is no longer published; the
  fixes it led to are listed under 0.2.2 and 0.2.3. A docs-and-source guard in `scripts/__tests__/public-docs.test.mjs`
  keeps the id patterns out. No runtime change.

### Fixed

- Player pickers no longer miss players beyond the first page of results.
- A Swiss round could give the same player a bye twice while others had none, because byes were not remembered.
- A suspension past its end stayed active until an admin lifted it by hand.
- Adding or removing a league or tournament admin failed silently; the admin manager now shows the error.

### Security

- **Dependencies (dev only):**
  - The `vite` override is raised to `^8.3.5` (taken from the Dependabot bump), which fixes three `launch-editor` advisories.
  - `vitest` and `@vitest/coverage-v8` move to `^4.1.12`, which fixes two `@vitest/mocker` advisories.
- **Dependencies:**
  - `next` moves to `^16.4.2`, which fixes a critical remote-code-execution advisory in the image optimizer when SVG files are used ([GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw)) and a Server Actions denial of service ([GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)). `sharp` follows to `^0.35.5`, the minimum `next` 16.4.2 declares.
  - `postcss` moves to `^8.5.30`, the minimum `vite` 8.3.5 declares. The root override applies it to `next` and `tailwindcss` too.
  - `zod` moves to `^4.6.7`, which fixes memory exhaustion while validating oversized constrained collections ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)).
  - The lockfile takes the patched transitive releases `undici` 6.29.1 ([GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c)), `body-parser` 2.4.0 ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)) and `fast-uri` 3.1.9 ([GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) and three related advisories).
- **Code scanning:** the open CodeQL findings are worked through:
  - The replay link check in the submit form matches the anchored `https://replay.pokemonshowdown.com/` prefix the server strips, instead of a substring.
  - Overlay URLs encode entity ids (a lone surrogate becomes U+FFFD).
  - The Smogon import decodes each HTML entity once.
  - Markdown table cells escape backslashes.
  - Test-account passwords draw characters uniformly (`crypto.randomInt`).
  - The weekly recap pins its locale to a known value before picking a translator.
  - The avatar randomiser draws from Web Crypto instead of `Math.random()`.
  - Maintainer scripts create temp files with `mkdtemp` and avoid check-then-use file races.

## [0.2.3] - 2026-10-20

Follow-ups to the 2026-10-20 security audit: replays are bound to one game by hash, duplicate stats rows are refused by the database, and EvoLiga evolution progress waits for the confirmed result. **Three migrations; see each entry for the deploy order.**

### Security

- **One Showdown battle can be recorded for one game only, and a replay result comes from that replay.** Every
  game recorded from a replay stores the SHA-256 of the replay's canonical battle log
  in the new `games.replay_hash` (unique where set) in the same insert, and its winner and stats are parsed from that
  same fetched log, never taken from the client. Submitting a battle already recorded for any game, in any match and
  through any URL form, answers 409 `replay_already_recorded` (race-safe through the unique index). The admin replay
  import now sends only the side assignment and the preview's hash (409 `replay_changed_since_preview` when the replay
  changed); its form shows the replay's winner and stats read-only, and corrections go through the game editor.
  **Upgrade:** apply `supabase/migrations/20261020100000_games_replay_hash.sql` before deploying, then run
  `npx --no-install tsx --env-file=.env.local scripts/backfill-replay-hashes.ts` (dry run; add `--write` to fill older games).
- **`battle_stats` holds one row per Pokémon per player per game**: a unique index on
  `(game_id, player_id, lower(btrim(pokemon_name)))` (`20261020100100_battle_stats_unique_pokemon.sql`) backs the
  request schemas, a violation answers 409 `battle_stats_duplicate_pokemon`, and the admin game edit refuses a repeated
  Pokémon with 400 `validation_failed` before it replaces any row. Both replay sides on one player is now 400
  `replay_sides_not_distinct`.
- **EvoLiga evolution progress waits for the confirmed result.** A game's real
  kills are no longer credited at submission: the new finalize step `epb_real_kills` credits them when the match
  reaches `completed` (opponent confirm, auto-confirm, admin dispute resolution), so a pending or disputed result moves
  no tracker. Each game is credited exactly once through the new `games.evolution_applied_at` marker
  (`epb_credit_game_kills`, one transaction per game), so the finalize heal and a re-confirm never count it twice. An
  admin game edit debits a credited game (`epb_uncredit_game_kills`, fenced on the marker), then re-reads the match and
  credits the edited stats when a concurrent confirm completed it meanwhile (a confirm landing between the edit's
  status change and its debit no longer leaves the completed match without the game's kills); game delete, match reset
  and the season reconcile re-sync the markers with the rebuilt trackers (`epb_sync_game_kill_credit`). Aggregates are
  still counted at submission. Every game that exists when the migration runs is marked as credited (it was, at
  submission), so nothing is counted twice or reversed. **Upgrade:** apply
  `supabase/migrations/20261020100200_games_evolution_credit.sql`, deploy right after, then mark the games submitted
  between the two (`UPDATE games SET evolution_applied_at = created_at WHERE evolution_applied_at IS NULL AND
  created_at < '<deploy time>'`, see the migration header).
- **The reserved superadmin address can no longer be signed up**: `POST /api/auth/signup` never
  creates an account for `SUPERADMIN_EMAIL` and answers with the same generic success as any signup, after the same
  rate limit and delay. The operator creates that email login by linking it from the `SUPERADMIN_DISCORD_ID` account.
- **EvoLiga kill credits are recorded per game and fenced per season** (review of this release): `games.evolution_credits`
  records which trackers got how many kills, and an admin edit debits exactly that, so a redraft or trade in between can
  no longer double-count. Every credit, debit and season-rebuild sync bumps a per-season counter
  (`epb_kill_credit_epochs`); a rebuild whose season moved underneath it retries instead of overwriting a concurrent
  confirm. A failed matchday-hook rollback no longer deletes the stage transitions the credit step just wrote.
  **Upgrade:** apply `supabase/migrations/20261021100100_epb_game_kill_credit_ledger.sql` with the code (it replaces
  the sync function's signature), then run the season reconcile once per EvoLiga season so older credited games get
  their ledger.
- **The `battle_stats` duplicate key now trims exactly what the request schemas trim** (all Unicode whitespace, not
  only spaces): `supabase/migrations/20261021100200_battle_stats_pokemon_key_js_trim.sql` rebuilds the unique index.
- **A replay result whose stats insert fails no longer blocks that battle**: the just-created game is removed again,
  so a retry can record it.

### Fixed

- The admin replay import can no longer submit, or show, a preview that a re-parse is replacing.
- Team import from pokepast.es logs each fetch failure cause server-side.

## [0.2.2] - 2026-10-20

Security fixes from the 2026-10-20 dual-harness audit.

### Security

- **Audit batch 2026-10-20 dispositioned.** All 24 leads now carry a disposition; the fixes below close every valid
  one. Three needed a design decision (replay-to-match binding, the reserved superadmin address in public signup, an
  optional `battle_stats` unique index); 0.2.3 settles them.
- **Discord linking is bound to the signed-in session.** A pending link intent links only when the live session
  belongs to the player that started it, and the cookie is `__Host-` prefixed in production.
- **Linking `SUPERADMIN_EMAIL` as an email login** is refused unless the caller is the `SUPERADMIN_DISCORD_ID` account.
- **Manual and replay-import game stats are bounded:** at most two player blocks, one per player, and no Pokémon twice
  in one block, so one request can no longer multiply evolution progress or aggregates.
- **League and phase admin pages** admit only site admins and admins of that league.
- **The broadcast recap overlay** is rate-limited per IP, edge-cached for 30 s, and 404s when the tournament or
  round does not belong to the league in the path.
- **The image proxy** refuses redirects and non-default ports and narrows the accepted image types.
- **Cron routes** compare `CRON_SECRET` with the length-independent `secretsEqual`.
- **Team import from pokepast.es** has a fetch timeout and the same 50 000-character cap as pasted text.
- **The admin CSV export** neutralises formula-leading cells.
- **The XLSX importer** caps sheet rows, columns and dense cells, the zip entry count, and the total inflated size
  per archive, and inflates entries lazily.
- **The bootstrap secret's per-IP attempt cap now fails closed.** `POST /api/bootstrap` and the bootstrap-secret path
  of `POST /api/seed-rulesets` answer 503 `rate_limit_unavailable` while the limiter store is unavailable, instead of
  comparing the secret with no attempt cap. A rejected bootstrap secret is now logged server-side (a `console.warn`
  line without the submitted or the expected value).
- **The public share-link read is rate-limited per client IP.** `GET /api/teams/shared/[token]` now allows 60
  requests per minute per IP (failing open, like the other public routes) and answers 429 `rate_limited` with
  `Retry-After` beyond that, before the token is validated or looked up.

## [0.2.1] - 2026-10-19

Test leagues now stay out of player ratings and all-time statistics: their games no longer move ratings.

### Upgrade notes

- **Apply migration `20261019130000_ratings_skip_test_seasons` right before deploying the code.** In the gap, the
  0.2.0 code's rating writes that involve a test-league match are refused with nothing written (its finalize rating
  step fails for such a match and the heal settles it after the deploy; a rebuild of a player with test-league matches
  is refused), so keep the gap short.
- **Test leagues that already moved ratings** need a Record Reconciliation repair over every league after deploying
  (`{ "scope": "all", "repair": true }`), repeated until a scope-all dry run lists no rating mismatch. A refused league
  stops the scope-all run; repeat it after resolving the refusal (`docs/rating.md`, "Test leagues", one-time step).

### Changed

- **Test-league games no longer move player ratings.** The live rating update and every rebuild leave matches of a
  test league out (enforced in SQL by migration `20261019130000`), by the CURRENT flag. Every request that sends the
  test-league flag rebuilds the ratings of the players of the league's completed matches and repeats the pass until
  one changes nobody (at most 8 passes that still change something, plus the one that confirms it; a rebuild still
  changing then answers the warning `test_flag_rating_rebuild_unsettled`). Sending the same value again finishes a
  cut-off rebuild; in the admin UI that means switching the flag off and on again, or running the repair. A failed
  rebuild keeps the flag saved and shows its warning under the checkbox; a save without an answer refreshes the
  checkbox to the stored flag. Opponents outside the league keep their curves until a later rebuild reaches them.
- A league's Record Reconciliation repair also covers every player of the league's completed matches, including
  players who left its roster. One repair run is a single rebuild pass, so the warnings say to repeat it until its dry
  run lists no rating mismatch.
- The test-league label, hint and season-page subtitle say that test leagues stay out of ratings as well as the
  all-time stats.

## [0.2.0] - 2026-10-19

A security and data-integrity pass over the whole code base (an external code review, every finding re-verified
before it was fixed), the first round of live-user feedback on the draft room and the league admin, league groups,
and selectable sprite styles.

### Upgrade notes

- **Apply the new migrations before deploying the code.** They are forward-only and run in timestamp order:
  `20261018130000` through `20261019120000` in `supabase/migrations/` (match finalize integrity, atomic aggregate
  and rating writes, rate limits, first-admin bootstrap, item usage, point-buy ban lists and comeback rules, draft
  quiet hours, pool completability, retired point-buy trades, guest identity, league groups, sprite style, game
  edit lease, completed-match team lock). Several functions change signature, and the new code calls them.
- Regenerate `src/types/database.ts` from a local stack with `npm run db:types` (`npm run db:types:check` fails when
  the committed file differs from the local schema).
- New optional environment variables (see `.env.example`): `RATE_LIMIT_STORE` (`postgres` | `memory`; unset picks
  `postgres` on Vercel and `memory` everywhere else; any other value stops the server at boot) and
  `NEXT_PUBLIC_SPRITES_URL` (the public `sprites` bucket for the broadcast sprite style; blank falls back to the
  HOME renders).

### Added

- **League groups.** A league can be split into groups (seeded snake order or by hand). Each group drafts its own
  pool from the shared list, so the same line can be drafted once per group, and every group's draft must stay
  completable on its own. Phases mirror the league groups. A deterministic scheduler gives every group its own
  round robin inside shared weeks, adds cross-group matches (trainers without an in-group match meet across groups;
  the last week of each half pairs the same-placed trainers of the groups by the tables after the previous week),
  and never writes a half-generated schedule for uneven groups. Group tables count all of a trainer's matches; a
  combined table ranks by points per match when match counts differ. Membership is locked once a group's pool is
  live or any phase has rounds.
- **Draft room.** The line wall scrolls inside its pane, the price tabs stay visible on every screen size, and
  every line card has the same size and layout (a reserved branch row). Filters moved into a side sheet with
  collapsible groups, active counts, per-group reset and a live "Show N lines" button. Pool admins get an admin
  sheet in the room (live controls, picks, settings, redraft, penalties), loaded only for them and fed by the room's
  own snapshot.
- **League admin tabs.** The league admin page is split into URL tabs (overview, participants, draft, phases, rules,
  settings, danger zone); each tab reads only its own data. The danger zone lists exactly what a delete removes or
  blocks, derived from the schema's foreign keys.
- **Sprite styles.** Viewers pick broadcast renders, HOME renders, animated or pixel sprites (account setting and
  cookie, with a site default). The broadcast renders are self-hosted: `scripts/sprites/` mirrors and uploads them
  (dry run by default; the repository ships no art).
- **Draft rules from the format pack.** Quiet hours (the pick clock pauses in a nightly window while picking stays
  allowed), a pool completability check on every pick, void and redraft publish, comeback-token earn windows and
  per-line rates, and price groups shown as point ranges.
- **Point-buy leagues** get their battle ruleset (singles) assigned automatically at creation.
- **Test leagues** are listed publicly with a test badge and stay out of all-time statistics (their games still
  count toward player ratings).
- **Neutral extension seams** for format packs (supplementary records, admin navigation, audit labels).
- Tooling: `npm run typecheck:example` (type-checks the public example pack), `npm run db:types`, ESLint over the
  tracked `scripts/`, coverage thresholds, a guarded overlay mirror (`npm run mirror:overlay`, `--check`), and a
  `dev-localdb` launch configuration that runs the dev server against the local Supabase stack.

### Changed

- **Team visibility follows the spec.** A planned roster stays hidden until the match it was registered for is
  completed (unless the phase is set to always public); the submit page, team pages, AI match context and broadcast
  surfaces apply the same rule.
- **Point-buy trades are retired.** Redraft trade requests were removed; the old endpoints answer 410.
- Malformed path ids answer 404 with an `INVALID_*_ID` code on every dynamic API route; a Supabase request that
  exceeds its deadline answers 504.
- Admin game edits use optimistic concurrency and a short edit lease: a second, overlapping edit gets a 409 with a
  reload hint instead of overwriting.
- `next` is declared as `^16.3.8`.
- A Vercel preview without `PRIVATE_ASSETS_REF` fetches the private assets from the branch named like the public
  branch being built, falling back to `main` only when that branch does not exist; production is unchanged.

### Fixed

- Creating a guest player failed ("Failed to create player"); claiming a guest is now one atomic step.
- The test-league switch and other league settings lost their value after collapsing a section.
- Match finalization could run twice for the same match; aggregate apply and rollback, and rating history writes,
  were not atomic and could double-count or lose updates under concurrent edits.
- Teams linked to a completed match could be edited or deleted by their owner; they are now locked (admins can still
  correct them).
- Several readers swallowed errors and returned empty results; they now log and rethrow.
- The item-usage statistic scanned every team row; it now uses an indexed SQL function.
- Deleting or editing a game of a completed match left ratings, streaks and signatures counting the match; both
  players are now rebuilt from their remaining completed matches.
- Resetting a match could leave a second planned team row (team pages then failed); the released roster now moves to
  the player's personal teams and is never deleted.
- A scope rebuild could count a game whose aggregate job was still queued, so the queue then counted it again.
- Retrying round generation after an interrupted write skipped the empty round; it is now refilled.
- The league standings preview cached an empty table when its phase read failed; the error now propagates.
- Claiming a guest refuses a banned or suspended source account, and a source whose deletion would destroy its own
  data (presets, cast sessions, AI generations and similar).
- Admins could not pick for the active player in a Redraft; a league group's draft refuses to start when its seats no
  longer match the group, substitutions wait while the group's Redraft takes submissions, and a group pool's seat
  order is checked against the group's members.

### Security

- Team responses no longer include share tokens or other private columns (explicit column lists and a typed public
  mapper); forking a team requires it to be published or a valid share token.
- Durable, database-backed rate limiting for sign-in, sign-up, verification e-mails, calculators and image proxies;
  the first-admin bootstrap is single-use under concurrency.
- PostgREST filter values are escaped and quoted; request bodies are size-capped and validated with zod.

### Removed

- The redraft trade-request routes, UI and messages (see **Changed**).
- Unused point-buy list components.

## [0.1.0] - 2026-10-16

- First public release.

[Unreleased]: https://github.com/nattiini45/poketools/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/nattiini45/poketools/compare/v0.3.0...v0.4.0
