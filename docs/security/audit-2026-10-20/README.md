# Security audit — 2026-10-20 (two independent harnesses)

> **Status: dispositioned 2026-10-20** (per-finding verify → fix → independent review). The audit fixes ship in 0.2.2; the owner decisions on F1, CF-02 (signup), CF-06 (DB index) and CF-07 ship in 0.2.3.
> Rows marked *escalated* need an owner decision. Per `AGENTS.md` Operating Rule 6 and
> `docs/review-remediation.md` §0, every row below is a *lead* until it is truth-grounded
> against the current revision. Do not implement a fix from this file alone.

Two automated review harnesses audited commit `cfd1f25` (branch `fix/test-leagues-out-of-ratings`)
independently on 2026-10-20, and their results were compared. Both are defensive, read-only runs:
nothing in this repository was modified, and no target code was executed (the host has no
OS-enforced sandbox, so every runtime-dependent claim carries no confirmed severity).

## What ran

| | harness | shape | model |
|---|---|---|---|
| A | Hermes **security-swarm** (`hermes/tools/security-swarm`) | map → refute (1 agent/report) → reduce → verify (1 fresh agent/claim) | `deepseek/deepseek-v4.1-flash` @ commandcode, reasoning high, all stages |
| B | Cloudflare **security-audit skill** (MIT, `github.com/cloudflare/security-audit-skill`), driven by `cf_audit.py` | recon (4 agents) → 14-unit coverage ledger → hunters → 1 fresh verifier/candidate | same model/provider |

Run A scanned 15 files in 3 batches (API routes + auth/RLS core, chosen for comparability).
Run B worked a 14-unit coverage ledger across the whole app surface.
The two runs agreed on exactly **one** finding (`F4` ≡ `CF-01`).

## Files

| file | contents |
|---|---|
| `swarm-report.md` | Run A report: findings, chains, per-claim verification verdicts |
| `swarm-findings.json` | Run A machine-readable findings (includes verifier reasoning) |
| `cloudflare-report.md` | Run B report: confirmed / needs_validation / rejected, with fixes |
| `raw/cloudflare-verified.json` | Run B per-candidate verifier verdicts and evidence |
| `raw/cloudflare-candidates.json` | Run B raw hunter candidates |
| `raw/cloudflare-coverage-ledger.json` | Run B coverage units (surface × boundary × attack class) |
| `raw/cloudflare-architecture.md` | Run B reconnaissance synthesis (trust boundaries, starting paths) |
| `comparison.md` | Side-by-side: overlap, unique findings, severity spread, agent counts |

## Findings and disposition

Fill the `disposition` column per `docs/review-remediation.md` §2: **valid** (reproduce in source,
cite `file:line`), **invalid** (cite the spec section, guard or intended pattern), or
**already fixed** (cite the commit). Record a reason for invalid rows too — unexplained dismissals
come back as repeat findings.

| id | sev | claim | evidence | disposition |
|---|---|---|---|---|
| `F1` | P1 | Replay submission is not bound to the match: any past battle between the two participants … | `src/app/api/parse-replay/route.ts:32-127`, `src/lib/pkmn/game-pipelin… | **partially valid, escalated**: replay evidence is not bound to the match by format/time/cross-match reuse (`parse-replay/route.ts:72-89`), but self-report + opponent dispute is the designed trust model and `manual-result` already lets a participant claim any winner; cross-match uniqueness contradicts `20261018130000_match_finalize_integrity.sql:15`. **Owner decision 2026-10-20, implemented in 0.2.3:** "tied by a unique hash bound when attaching the replay while using it to input the result" — `games.replay_hash` (unique where set, `20261020100000_games_replay_hash.sql`) is written in the insert that records a replay result, whose winner and stats come from the same hashed log (`src/lib/pkmn/replay-binding.ts`); reuse in any match is 409 `replay_already_recorded`, race-safe; older games via `scripts/backfill-replay-hashes.ts` (not yet run). Format/time binding is not part of the decision. |
| `F2` | P2 | Anonymous recap overlay endpoint is uncached and query-amplifying (per-match fan-out, no r… | `src/app/api/broadcast/recap/[sid]/route.ts:28-100`, `src/lib/broadcas… | **valid, fixed**: per-IP `checkPublicRateLimit` + `cacheHeaders(30,60)` on `broadcast/recap/[sid]/route.ts`. |
| `F3` | P2 | parse-replay is an existence/identity oracle for PS usernames and, for non-participants, f… | `src/app/api/parse-replay/route.ts:37-95` | **invalid**: `ps_username`/name binding is public by design (`PublicPlayer`, `src/types/player.ts:61-71`; `/players/[id]`), match ids are listed publicly; distinct codes feed the admin fallback; limited 20/h. |
| `F4` | P3 | Discord link intent is an unbound bearer cookie (no session binding, no __Host- prefix) | `src/app/api/account/link-discord/route.ts:38-48`, `src/lib/utils/cryp… | **partially valid, fixed with CF-01**: cookie-tossing path is speculative; root cause closed by session binding; cookie is `__Host-` prefixed in production. |
| `F5` | P3 | Recap endpoint never checks that tournament_id and round_id belong to the season in the pa… | `src/app/api/broadcast/recap/[sid]/route.ts:35-95`, `src/lib/broadcast… | **valid, fixed**: recap 404s unless `tournament.season_id === sid` and `round.tournament_id === tournament.id`. |
| `F6` | P3 | Public solo overlay serves any solo cast session by id, including unpublished draft sessio… | `src/app/api/broadcast/solo/[sessionId]/route.ts:36-48,82-105`, `src/l… | **invalid**: overlays are intentionally public (`docs/security-patterns.md:16`); the session UUID is the capability; nothing ever leaves `draft`, so a status gate would 404 every overlay. |
| `F7` | P3 | League admin page admits any resource admin, not an admin of the requested league | `src/app/admin/leagues/[id]/page.tsx:66-96`, `src/lib/auth/helpers.ts:… | **valid, fixed**: league and phase admin pages require site admin or `isResourceAdminFor(player, 'season', id)`. |
| `F8` | P3 | Image proxy validates the requested URL but fetches with redirects followed and port ignor… | `src/app/api/proxy-image/route.ts:13-16,36-63,71-90` | **partially valid, fixed**: proxy fetch uses `redirect: 'error'`, rejects non-default ports, narrows image types. |
| `F9` | P3 | Bootstrap secret is guarded by a fail-open limiter and failures are not audited | `src/app/api/bootstrap/route.ts:13-14,57-58,79-84,137-147`, `src/lib/u… | **partially valid, fixed**: bootstrap and seed-rulesets limiter is fail-closed; failed secret attempts are logged. |
| `F10` | P3 | Cron routes use a length-short-circuiting compare for CRON_SECRET | `src/app/api/cron/process-aggregates/route.ts:68`, `src/app/api/cron/a… | **valid, fixed**: the four cron routes use length-independent `secretsEqual`. |
| `F11` | P3 | Public share-link team endpoint has no rate limit | `src/app/api/teams/shared/[token]/route.ts:19-38`, `src/lib/supabase/q… | **valid, fixed**: `checkPublicRateLimit('team-shared', ...)` on the share-link route. |
| `F12` | P3 | import-team buffers an unbounded third-party response with no timeout, unlike the replay f… | `src/app/api/import-team/route.ts:34-54` | **valid, fixed**: pokepaste fetch has a timeout and a size cap (`IMPORT_TEAM_TEXT_MAX`). |
| `C1` | P1 | CHAIN: Username/account oracle + unbound replay submission = targeted fabricated match win | F3, F1 | **invalid**: composed of F3 (invalid) and F1 (by-design self-report); no privilege boundary crossed; residual tracked under F1. |
| `C2` | P2 | CHAIN: Mismatched recap ids + uncached query fan-out = mislabelled broadcast under load | F5, F2 | **partially valid, fixed via F2 + F5**: the chain adds no capability beyond its parts. |
| `CF-01` | confirmed/medi… | Pending Discord link intent is not bound to the initiating session and survives sign-out, … | `src/app/api/account/link-discord/route.ts:11 LINK_INTENT_TTL_MS = 10 … | **valid, fixed**: the `signIn` callback links Discord only when the live session belongs to the intent's player; the intent is cleared otherwise. |
| `CF-02` | needs_validati… | Email login is bound to a player without verifying mailbox ownership, and the configured s… | `src/app/api/account/link-email/route.ts:23-30 — requirePlayer + playe… | **partially valid, code part fixed, rest escalated**: link-email refuses `SUPERADMIN_EMAIL` unless the caller is the Discord superadmin; misleading "verified email" comments corrected. **Public-signup reservation fixed in 0.2.3:** `POST /api/auth/signup` never calls `signUp` for `SUPERADMIN_EMAIL` (`isReservedSuperadminEmail`) and answers with the same generic success after the same rate limit and constant delay; the operator creates that login by linking it from the `SUPERADMIN_DISCORD_ID` account (`docs/auth-email-password.md`). Still escalated: persisted `is_admin` write, generic GoTrue pre-hijack, deployment Confirm-email check, and a one-time check that no auth user already exists on the address. |
| `CF-03` | needs_validati… | CSV formula injection in admin export: player-controlled ps_username reaches the site admi… | `src/app/api/admin/export/route.ts:24 — requireAdmin() gate (the victi… | **valid, fixed**: `src/lib/utils/csv.ts` prefixes formula-leading cells (OWASP set). |
| `CF-04` | needs_validati… | Unbounded cell-reference row/column indices let a ~1 KB sheet part drive a 4.29e9-element … | `src/lib/import/xlsx.ts:156-162 — colLettersToIndex has no bound; 26*k… | **valid, fixed**: row/column/dense-cell caps in `src/lib/import/xlsx.ts`. |
| `CF-05` | needs_validati… | XLSX importer enforces only a 50 MB per-entry inflation cap, so a single <=8 MB upload can… | `src/lib/auth/helpers.ts:186-192 — requireAdmin checks player.isAdmin,… | **valid, fixed**: lazy, per-archive-budgeted inflation plus an entry-count cap in `src/lib/import/xlsx.ts`. |
| `CF-06` | confirmed/medi… | Unbounded duplicate battle-stat rows let one participant fabricate arbitrary evolution pro… | `src/lib/validation/schemas.ts:486 — pokemon_s… | **valid, fixed**: `pokemon_stats` capped at 2 blocks, no duplicate `player_id` blocks, no repeated Pokemon per block (manual result + replay import). Optional DB unique index: **owner decision 2026-10-20, implemented in 0.2.3**: `battle_stats (game_id, player_id, lower(btrim(pokemon_name)))` unique (`20261020100100_battle_stats_unique_pokemon.sql`), violation 409 `battle_stats_duplicate_pokemon`; the admin game edit schema refuses repeats too. |
| `CF-07` | confirmed/medi… | Manual game statistics award season evolution progress and aggregates before the opponent … | `src/app/api/manual-result/route.ts:16,18,79-87 — requirePlayer, 20/ho… | **invalid as of the audited revision `cfd1f25`**: submit-time kills/aggregates were the documented design then (`docs/evolution-point-buy.md:183` and spec 6.1/6.2 at `cfd1f25`; both now describe the 0.2.3 behaviour below); the amplification was CF-06. Moving progress to confirmation is an owner option. **Owner decision 2026-10-20, implemented in 0.2.3:** evolution progress waits for the confirmed result: real kills are credited by the finalize step `epb_real_kills` when the match reaches `completed`, once per game (`games.evolution_applied_at`, `20261020100200_games_evolution_credit.sql`; existing games backfilled as credited). Aggregates stay at submission. |
| `CF-08` | rejected/— | Unauthenticated public-profile read fans out ~14 PostgREST queries per request, uncached a… | `src/app/api/players/[id]/public-profile/route.ts:13-20 — '// Public: … | **invalid (rejection upheld)**: public read with a bounded, fixed query count; IP limits are prescribed only for expensive/outbound routes. |
| `CF-09` | rejected/— | Superadmin override persists is_admin on the player row, so removing SUPERADMIN_DISCORD_ID… | `src/auth.ts:93-104 — isSuperadminIdentity reads process.env.SUPERADMI… | **invalid (rejection upheld)**: `players.is_admin` is the durable role store; site admins can revoke via `PATCH /api/players/[id]`. |
| `CF-10` | needs_validati… | Public image proxy applies its host/path allowlist only to the first URL, then follows ups… | `src/app/api/proxy-image/route.ts:10 — '// Pub… | **partially valid, fixed with F8**: `redirect: 'error'` on the proxy fetch. |

### Notes on severity

- Run A assigns `P0`–`P3` to every finding plus a separate confidence field.
- Run B assigns severity only to `confirmed` findings; `needs_validation` rows have **no severity by
  policy** and name the single missing fact in `cloudflare-report.md`.
- `CF-08` and `CF-09` were **rejected** by Run B's verifier. They are kept here only so the same
  claims are not re-reported a second time; they need no fix.

## Suggested reading order

1. `comparison.md` — what the two harnesses each caught that the other missed.
2. `swarm-report.md` § Summary and § Attack chains — the competitive-integrity issue (`F1`/`C1`) is
   the highest-impact item in either run.
3. `cloudflare-report.md` § confirmed — includes a fuller account of `CF-01` than Run A's `F4`
   (the intent also survives sign-out and hijacks the next sign-in in the same browser profile).
4. The import/upload class (`CF-03`–`CF-05`) exists only in Run B — Run A's selectors *did* match
   those files, but the comparison run batched only 15 of 1166 matched files, so they were never read.
   See "How much was actually looked at" below.

## How much was actually looked at

PokéTools at `cfd1f25` has 2028 in-scope files (excluding vendored, generated, docs and private
format-pack paths). For Run A, measured after the fact by the coverage ledger:

- 1166 files matched at least one of the 30 selectors;
- **15** of those were batched for this comparison run — 1151 selector-matched files were not scanned;
- **862** files matched no selector at all and were therefore never eligible.

Neither of those sets was read by any worker. A "no findings" statement about them would be wrong.
Both numbers are reproducible: `swarm.py coverage poketools-20261020-1256-cfd1f25`.
