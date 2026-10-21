# Comparison: security-swarm vs Cloudflare security-audit

- repo run A (swarm): `<hermes-data>/security-swarm/scans/poketools-20261020-1256-cfd1f25` (local run directory)
- repo run B (cloudflare): `<hermes-data>/security-swarm/compare/20261020-poketools/cf-audit` (local run directory)

## Run A — security-swarm

- [P1] (confirmed) F1 Replay submission is not bound to the match: any past battle between the two participants counts as a game
- [P1] (confirmed) C1 Username/account oracle + unbound replay submission = targeted fabricated match win
- [P2] (confirmed) F2 Anonymous recap overlay endpoint is uncached and query-amplifying (per-match fan-out, no rate limit)
- [P2] (confirmed) F3 parse-replay is an existence/identity oracle for PS usernames and, for non-participants, for match ids
- [P2] (confirmed) C2 Mismatched recap ids + uncached query fan-out = mislabelled broadcast under load
- [P3] (confirmed) F4 Discord link intent is an unbound bearer cookie (no session binding, no __Host- prefix)
- [P3] (confirmed) F5 Recap endpoint never checks that tournament_id and round_id belong to the season in the path
- [P3] (confirmed) F6 Public solo overlay serves any solo cast session by id, including unpublished draft sessions and the owner's p
- [P3] (confirmed) F7 League admin page admits any resource admin, not an admin of the requested league
- [P3] (confirmed) F8 Image proxy validates the requested URL but fetches with redirects followed and port ignored
- [P3] (confirmed) F9 Bootstrap secret is guarded by a fail-open limiter and failures are not audited
- [P3] (confirmed) F10 Cron routes use a length-short-circuiting compare for CRON_SECRET
- [P3] (confirmed) F11 Public share-link team endpoint has no rate limit
- [P3] (confirmed) F12 import-team buffers an unbounded third-party response with no timeout, unlike the replay fetcher

## Run B — Cloudflare audit

- [-] (needs_validation)  Email login is bound to a player without verifying mailbox ownership, and the configured superadmin identity i
- [-] (needs_validation)  CSV formula injection in admin export: player-controlled ps_username reaches the site admin's spreadsheet as a
- [-] (needs_validation)  Unbounded cell-reference row/column indices let a ~1 KB sheet part drive a 4.29e9-element dense array allocati
- [-] (needs_validation)  XLSX importer enforces only a 50 MB per-entry inflation cap, so a single <=8 MB upload can retain gigabytes by
- [-] (rejected)  Unauthenticated public-profile read fans out ~14 PostgREST queries per request, uncached and unthrottled, unli
- [-] (rejected)  Superadmin override persists is_admin on the player row, so removing SUPERADMIN_DISCORD_ID/SUPERADMIN_EMAIL ne
- [-] (needs_validation)  Public image proxy applies its host/path allowlist only to the first URL, then follows upstream redirects to a
- [medium] (confirmed)  Pending Discord link intent is not bound to the initiating session and survives sign-out, so a later first-tim
- [medium] (confirmed)  Unbounded duplicate battle-stat rows let one participant fabricate arbitrary evolution progress and KO aggrega
- [medium] (confirmed)  Manual game statistics award season evolution progress and aggregates before the opponent confirms, and a disp

## Overlap (same source ground)

- 0.40  A[P3] Discord link intent is an unbound bearer cookie (no session binding, no __Host- 
        B[medium] Pending Discord link intent is not bound to the initiating session and survives 

## Unique to A (swarm)

- [P1] F1 Replay submission is not bound to the match: any past battle between the two participants counts as a game
- [P2] F2 Anonymous recap overlay endpoint is uncached and query-amplifying (per-match fan-out, no rate limit)
- [P2] F3 parse-replay is an existence/identity oracle for PS usernames and, for non-participants, for match ids
- [P3] F5 Recap endpoint never checks that tournament_id and round_id belong to the season in the path
- [P3] F6 Public solo overlay serves any solo cast session by id, including unpublished draft sessions and the owner's p
- [P3] F7 League admin page admits any resource admin, not an admin of the requested league
- [P3] F8 Image proxy validates the requested URL but fetches with redirects followed and port ignored
- [P3] F9 Bootstrap secret is guarded by a fail-open limiter and failures are not audited
- [P3] F10 Cron routes use a length-short-circuiting compare for CRON_SECRET
- [P3] F11 Public share-link team endpoint has no rate limit
- [P3] F12 import-team buffers an unbounded third-party response with no timeout, unlike the replay fetcher
- [P1] C1 Username/account oracle + unbound replay submission = targeted fabricated match win
- [P2] C2 Mismatched recap ids + uncached query fan-out = mislabelled broadcast under load

## Unique to B (Cloudflare)

- [None] Email login is bound to a player without verifying mailbox ownership, and the configured superadmin identity i
- [None] CSV formula injection in admin export: player-controlled ps_username reaches the site admin's spreadsheet as a
- [None] Unbounded cell-reference row/column indices let a ~1 KB sheet part drive a 4.29e9-element dense array allocati
- [None] XLSX importer enforces only a 50 MB per-entry inflation cap, so a single <=8 MB upload can retain gigabytes by
- [medium] Unbounded duplicate battle-stat rows let one participant fabricate arbitrary evolution progress and KO aggrega
- [medium] Manual game statistics award season evolution progress and aggregates before the opponent confirms, and a disp
- [None] Unauthenticated public-profile read fans out ~14 PostgREST queries per request, uncached and unthrottled, unli
- [None] Superadmin override persists is_admin on the player row, so removing SUPERADMIN_DISCORD_ID/SUPERADMIN_EMAIL ne
- [None] Public image proxy applies its host/path allowlist only to the first URL, then follows upstream redirects to a

## Numbers

- A: 14 claims (2 chains), raw 13 -> after refute 13 (0 refuted before reduce), 3 dismissed by reducer
- A severity: {'P1': 2, 'P2': 3, 'P3': 9}
- A agent calls ≈ 18 on 15 files
- B: 10 verified claims, raw 10 candidates over 14 coverage units
- B severity: {'medium': 3, 'None': 7}
- B agent calls ≈ 29 on 57 starting paths
- overlap: 1 matched · unique to A: 13 · unique to B: 9
