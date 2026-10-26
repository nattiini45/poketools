# Changelog

All notable changes to PokéTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor version may
contain breaking changes; they are listed under **Changed** or **Removed** with the upgrade steps.

## [Unreleased]

### Upgrade notes

- No migration and no new environment variable. API clients that send an even best-of value, or change the league type
  of a started league, now receive `400` / `409`.
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
- API clients that send an even best-of value, or change the league type of a started league, now receive `400` /
  `409`.

### Added

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
- **Format-change confirmation in the ruleset builder.** Switching the base format keeps the form until the new
  defaults are loaded and asks before replacing lists you changed, naming what would be lost. **Keep my lists** only
  changes the format label. A new ruleset starts from its format's defaults.
- **Empty-ruleset notice.** A ruleset with a real base format but no clause, ban or addition says that it enforces
  nothing beyond the generation, with a button to load the format's defaults. An empty team-constraints block says it
  is saved as no constraints.
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

- The unused advancement helper (`src/lib/tournament/advancement.ts`). Internal only: league phases advance through
  the enrollment sync, which is unchanged, and its behaviour is now covered by the enrollment sync tests.


- Test Players: Reset Data, Reset Login (Mint Login for a player who already has a login), Clear Login, Remove from Season and Delete Test-Only Matches now ask first in a confirmation dialog that names the player and the season, in English and German. Create / Repair, Refresh and the first Mint Login stay one click.
- The webhook endpoints (`/api/discord-webhooks`) answer with `webhook_url_hint` instead of `webhook_url`.
- The export endpoint adds `X-Export-Count` and `X-Export-Total` response headers.

### Fixed

- **Completed-match reads past 1,000 rows.** The completed-match reads behind standings, pairing history, head-to-head
  and insights inputs, profile standings, and the set of players with completed matches now page through the full
  result in 1,000-row steps instead of stopping at the first 1,000 rows. The participants batch used by profiles and the point-buy list entries page the same way. A
  read that reaches its hard bound (20,000 rows) logs a warning. Results of 1,000 rows or fewer are unchanged. A new
  test rejects query reads that ask for more than 1,000 rows with `.limit`.

- A phase save error is shown once, not twice.
- Clearing every best-of override of a phase now saves; before, the empty list was never sent.
- Adding a phase after a middle phase was deleted no longer reuses another phase's stage order. New phases are placed
  after the highest stage order.
- **Apply migration `20261025090000_wiki_note_resubmission_block.sql` BEFORE deploying the code.** It adds
  `wiki_notes.resubmission_blocked_at` and `resubmission_blocked_by` (both nullable) with a CHECK and an index. The
  new code selects the columns on every note read, so those reads fail until they exist. Old code keeps working after
  the migration.
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

No migration.

- **Complete/Dispute race.** The confirm-match route reported success when the match had changed state in the
  meantime (for example a dispute landing just before a completion). It now answers `409 match_state_changed` and
  writes nothing, and the page reloads. Admin and participant confirms no longer overwrite the original submitter.
- **Admin disputes are audited.** Marking a match disputed as an admin now writes a `match.dispute` audit event
  (shown as "Match disputed by an admin"); before, it left an event only when the request carried notes.
- **Failed loads can no longer overwrite stored data.** The draft tier limits editor and the point-buy list manager
  disable saving and binding after a failed read until a read succeeds, so pack defaults cannot be saved over the
  stored limits or list binding.
- **Empty team constraints are no longer stored.** A new ruleset with an empty team-constraints block stores none
  instead of an empty object (which made it count as a custom league ruleset). Rulesets already stored with an empty
  object resolve as before.

- The Admin Override form no longer reports success when the match changed state in the meantime. It answers 409
  `match_state_changed` and the page reloads, so the admin reviews the current state.

- Submit Result and View Prep in the matches list no longer send an admin to the player dashboard. They show only to
  people who can use them (a player in the match, or a site admin for Submit Result); Override stays for every admin.
- Abort draft is no longer offered before the draft has started. A hint explains there is nothing to abort yet.

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
  `npx tsx --env-file=.env.local scripts/backfill-replay-hashes.ts` (dry run; add `--write` to fill older games).
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

[Unreleased]: https://github.com/nattiini45/poketools/compare/v0.2.1...HEAD
