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

## 7. Episode log

Record each completed remediation batch here: the date, the source (bot review, CI step or audit batch), the finding count, the dispositions, and the validation that closed it (local gates and CI runs, by commit).
