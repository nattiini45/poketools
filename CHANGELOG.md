# Changelog

All notable changes to PokéTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, a minor version may
contain breaking changes; they are listed under **Changed** or **Removed** with the upgrade steps.

## [Unreleased]

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

Owner decisions on the 2026-10-20 audit: replays are bound to one game by hash, duplicate stats rows are refused by the database, and EvoLiga evolution progress waits for the confirmed result. **Three migrations; see each entry for the deploy order.**

### Security

- **One Showdown battle can be recorded for one game only, and a replay result comes from that replay.** Owner
  decision on audit lead F1: every game recorded from a replay stores the SHA-256 of the replay's canonical battle log
  in the new `games.replay_hash` (unique where set) in the same insert, and its winner and stats are parsed from that
  same fetched log, never taken from the client. Submitting a battle already recorded for any game, in any match and
  through any URL form, answers 409 `replay_already_recorded` (race-safe through the unique index). The admin replay
  import now sends only the side assignment and the preview's hash (409 `replay_changed_since_preview` when the replay
  changed); its form shows the replay's winner and stats read-only, and corrections go through the game editor.
  **Upgrade:** apply `supabase/migrations/20261020100000_games_replay_hash.sql` before deploying, then run
  `npx tsx --env-file=.env.local scripts/backfill-replay-hashes.ts` (dry run; add `--write` to fill older games).
- **`battle_stats` holds one row per Pokémon per player per game** (audit lead CF-06): a unique index on
  `(game_id, player_id, lower(btrim(pokemon_name)))` (`20261020100100_battle_stats_unique_pokemon.sql`) backs the
  request schemas, a violation answers 409 `battle_stats_duplicate_pokemon`, and the admin game edit refuses a repeated
  Pokémon with 400 `validation_failed` before it replaces any row. Both replay sides on one player is now 400
  `replay_sides_not_distinct`.
- **EvoLiga evolution progress waits for the confirmed result** (owner decision on audit lead CF-07). A game's real
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
- **The reserved superadmin address can no longer be signed up** (audit lead CF-02): `POST /api/auth/signup` never
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

- **Audit batch 2026-10-20 dispositioned.** All 24 leads in `docs/security/audit-2026-10-20/` now carry a disposition;
  the fixes below close every valid one. Owner decisions are listed in that README (replay-to-match binding, the
  reserved superadmin address in public signup, an optional `battle_stats` unique index).
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
