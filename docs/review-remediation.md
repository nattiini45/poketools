# Review Remediation — Truth-Grounded Loop for Automated Findings

> The repeatable procedure for working automated code-review and CI findings against this repository: review-bot comments (e.g. Kilo), CI failures and security-audit hits. Linked from `AGENTS.md` Operating Rule 6.

This loop exists because findings arrive repeatedly and ad-hoc remediation is expensive. Follow it end-to-end; do not improvise a variant per finding batch.

## 0. Automated surfaces (inputs to this loop)

Review bots and any LLM-generated comment on a PR are **leads, never verified findings** — they see the diff, not the running system. The truth-grounding step below is mandatory even when a bot's diagnosis sounds confident. CI itself (`ci.yml`) runs: `npm audit --omit=dev --audit-level=high` (blocking) and `npm audit --audit-level=high` (report only), lint, `ENFORCE=1 node scripts/check-safe-error-response.mjs`, `ENFORCE=1 node scripts/check-mojibake.mjs`, build, tests, coverage — a red step tells you the failing gate; the logs tell you why.

## 1. Sync and ingest

```bash
git fetch origin && git status                  # know your starting state
gh pr view --json title,headRefName,url         # the PR under remediation
gh pr view --comments                            # review-bot comments
gh run list --branch "$(git branch --show-current)" --limit 5
gh run view <run-id> --log-failed                # failing CI step logs
npm audit --omit=dev --audit-level=high          # reproduce the blocking audit gate locally
```

Build the finding list: one row per finding — source (bot comment / CI step / audit), claim, and the file(s) it names.

## 2. Truth-ground every finding (mandatory)

Never fix an unverified claim. For each finding:

1. Open the named file and the surrounding call sites; confirm the condition actually holds on the current revision (bots frequently comment on stale diffs, already-fixed lines, or intended behavior).
2. Classify: **valid** (reproduce the condition in source, cite `file:line`), **invalid** (cite why — spec section, existing guard, or intended pattern), or **already fixed** (cite the fixing commit/line).
3. For valid security findings, check `docs/security-patterns.md` and `AGENTS.md` Security Requirements first — the fix shape is usually already specified there.

Record the disposition of every finding, including invalid ones (reply on the PR thread or note in the PR description) — unexplained dismissals come back as repeat findings.

## 3. Plan

- For each valid finding, check `docs/poketools-spec.md` for the touched surface before editing (route/IA/API contract changes update the spec first, per `AGENTS.md`).
- Fix at the smallest correct owner. If a finding implies a schema change, migration, or type regen — stop and escalate per `AGENTS.md` Escalate When.

## 4. Implement and validate

```bash
npm run lint
npm run build        # includes type-check; use CI placeholder env if .env.local is absent
npm test
ENFORCE=1 node scripts/check-safe-error-response.mjs
ENFORCE=1 node scripts/check-mojibake.mjs
```

All green before moving on — these are the same gates CI runs; finding a failure here instead of CI is the win.

## 5. Update the PR and monitor

Push, update the PR description with the finding dispositions, and watch one full CI run plus the next review-bot pass. New findings on the changed lines go back to step 1.

**Stop rule:** every ingested finding has a recorded disposition (fixed / invalid-with-citation / already-fixed) AND CI is green. Do not hand off with open, undispositioned findings.

## 6. Escalate immediately

- Schema/migration implications or type regeneration needed
- A finding that contradicts `docs/poketools-spec.md`
- Anything touching production secrets or credentials (never rotate secrets to debug; a maintainer handles credentials)
- npm audit critical/high that needs a dependency bump with breaking-change risk

## 7. Episode log (validation instances)

The loop is only proven when later findings route through it and the
remediation retains a validation result. One line per episode.

- **2026-09-11 — internal tooling review findings (no PR).** Ingest: 4 findings (unreviewed-last-change validation; NUL/scratch staging; truncated-portfolio ledger; missing AI-debug route). Dispositions: all fixed (`5a67d7b0` — checklist item 16 + `test:changed`, a .gitignore guard, a maintainer-notes entry, the AI-debug route section), with follow-up tooling hardening in `9a0015d4`. Validation retained (2026-09-11): gates green at the close commits (full suite 4,829 passed / 1 skipped). CI itself was not exercised (the branch was not pushed); the local gate battery is the recorded validation.

- **2026-09-24 — Kilo Code Review's 41 findings on PR #63 (worlds readiness + parity + per-viewer 3D opt-out), plus one semgrep finding from the `security` workflow after the first push.** Ingest: 41 bot findings (2 critical, 19 warning, 20 suggestion) from one comment + 1 CI finding. Dispositions: 36 fixed, 3 not-fixed with citation (`buildWorldRouteData` in `lib/worlds/route-data.ts` — split-world state impossible at the only production caller; `plaza/facade-kit.tsx:65` — conditional throw unreachable at runtime; the maintainers' deferred-work lint script — shell exec is the tool's contract and the register is tracked), 2 escalated (EPB `rank_change` needs an as-of-matchday evolution-points snapshot — schema decision; `useStationWindow` remeasure gap needs a conductor change-notification channel — new shared data flow), and the semgrep hit suppressed with a written justification at `scripts/verify-ci.mjs` (Windows `.cmd` shim only; literal cmd and args; never invoked by a workflow). All 41 dispositions are on the PR thread (comment 5809361726). Validation retained (2026-09-24): the remediation was then re-reviewed against itself, and two further rounds found 6 should-fix defects the bot had missed — a readiness settle that latched permanently after one refusal, an `InstancedMesh` instance-buffer leak per `revalidate` rebuild left behind by an earlier fix, a departing world presenting into the incoming one's pre-effect window (layout-phase unmount reset), a false claim in the remediation's own commit message, a switcher labelling a world that was not on screen, and the orphaned `routeThemeOverride` context field that the switcher fix stranded. Three round-1 nits were fixed alongside them: a focus-restoration loss on a docked↔modal flip that turned out worse than reported, an inline `[7, 7]` repeat literal defeating a texture memo, and a regression test that stayed green with the critical prototype-pollution fix reverted — now pinned at the call site and verified to fail on the reverted code. A third round caught three findings, corrected as four comment edits in `718fea1e`: three stale descriptions of the code round 2 deleted (one of them in a tracked spec) plus the doc for the surviving `setRouteThemeOverride` indirection. `npm run verify:ci` 8/8 green on a fresh clone at `39648e8d`, `94d9f2d8` and `8d63583d`; `a509efc2` adds only an inert `nosemgrep` annotation to that same script and was covered by `node --check`, eslint 0 on the file, and a green `build-and-test` on its parent. GitHub `build-and-test`, `semgrep`, `gitleaks`, `workflow-lint`, `pr-title` and the Vercel deploy pass at `a509efc2` and again at the docs commit `5ce05d4e`. Local suite 5130 passed / 1 skipped at `718fea1e`; at `5ce05d4e` — markdown only, so `npm run test:changed` reports no related tests — tsc 0 (recorded as `typecheck` in that commit's message) and eslint 0 (measured afterwards, on a tree whose `src/` is byte-identical to that SHA). An external L3 deep security review of the committed changes returned 0 findings; it leaves no in-repo artifact. **Round 4 (same day, Kilo review 5302083237):** 14 follow-up findings on the remediation code itself (3 warning, 11 suggestion) — all 14 truth-grounded valid (several latent/hardening, none needing a decision) and fixed in `71ac6462`: the readiness deadline now re-arms per scene generation (the store notifies on a mid-load generation bump; regression test verified to fail on the reverted code), the presentation trust latch moved into the provider as `routeSceneLive`, the instanced stamp and build gate compare the same `count*16` window, pointer capture is guarded against the spec'd `NotFoundError`, override validation reads the world registry the server resolves with, the proto-key test derives its list from `Object.getOwnPropertyNames`, verify-ci fails closed on `run: |` block scalars with a build-step-scoped env check plus a git() spawn guard and a 20-minute step timeout, and four doc/test-honesty corrections (the worlds.md store/label sentence, a maintainer-notes only-catch claim, the plaque test's disclosed limits, the EPB roster test's title). The Qoder post-commit review hook failed with exit 2, so its intent was substituted with a two-axis `code-review` run over `31fa1593..71ac6462`: spec axis clean (all 14 fixes faithful, no scope creep, the fail-on-revert claim empirically re-verified), standards axis found one real gap — worlds.md passages still describing the old handover condition — fixed in the docs commit that records this episode. `npm run verify:ci` 8/8 green on a fresh clone at `71ac6462` (install 28.6 s, audit 1.3 s, lint 58.3 s, safe-error 0.2 s, mojibake 1.4 s, build 71.8 s, test 28.6 s, coverage 33.8 s — the clone's mojibake pass also proving the local-run failures are only gitignored untracked artifacts). Local suite 5131 passed / 1 skipped, tsc 0, lint 0 at `71ac6462`. GitHub `build-and-test`, `semgrep`, `gitleaks`, `workflow-lint`, `pr-title` and the Vercel deploy pass at `59cfa91e`, and the next Kilo pass (review 5302849912) returned zero findings.
