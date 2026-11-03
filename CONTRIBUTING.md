# Contributing to PokéTools

Thanks for your interest in contributing! This guide covers the essentials. Please read and follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Getting Started

1. Fork the repo and clone locally
2. `npm install` (Node.js `^22.22.2 || ^24.15.0`; `.nvmrc` pins the version CI runs, and npm refuses an unsupported Node)
3. Copy `.env.example` to `.env.local` and fill in the required values (see the README's Self-hosting section)
4. Set up your own Supabase project, local (`npx supabase start`, then `npx supabase db reset`) or hosted (`npx supabase link --project-ref <your-project-ref>`, then `npx supabase db push`); see [docs/supabase-environments.md](docs/supabase-environments.md)
5. `npm run dev` to start the dev server

### Local development without Discord

Discord sign-in is optional. Leave `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` blank (set both or neither) and the sign-in page offers email and password only. With a local Supabase stack running (`npx supabase start`, `npx supabase migration up --local`):

```bash
npm run dev:seed   # a local admin, the standard rulesets and one 8-player league; safe to run again
npm run dev
```

Then sign in at `/auth/signin` as `local-admin@poketools.test` with the password the seed prints (`poketools-local-admin`). Those credentials open nothing but a local stack: the seed refuses any Supabase URL that is not the loopback interface and never reads `.env`. The local stack requires email confirmation for new sign-ups; read the confirmation link in Mailpit at http://127.0.0.1:54324.

The seeded account is the first admin. Without the seed, use `POST /api/bootstrap` with `BOOTSTRAP_SECRET` (README, "First run"). `SUPERADMIN_DISCORD_ID` is not needed for either, and `SUPERADMIN_EMAIL` alone never makes an email/password account superadmin.

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Run checks before submitting:
   ```bash
   npm run lint        # ESLint over src/ and the tracked scripts/ — must pass with zero errors and no new warnings
   npm run typecheck   # tsc --noEmit
   npm run build       # Production build (includes type-check)
   npm test            # Unit tests (Vitest)
   ```
   Changes that touch SQL, grants, RPCs or the shape of a Supabase query also run the local-stack suites against your own local stack (`npx supabase start`, `npx supabase migration up --local`, then `npm run test:db`). They refuse any host but the loopback interface and never read `.env`. CI runs the same suites in an **advisory** `database` job (not a required check): it replays every migration on an empty database, runs `npm run db:types:check` and `npm run test:db` with `LOCAL_STACK_CI=1` on an ephemeral stack. See [docs/supabase-environments.md](docs/supabase-environments.md#local-stack-suites-npm-run-testdb).
4. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for any user-facing change (Added, Changed, Fixed, Security, Removed), and an upgrade note for every new migration or environment variable.
5. Open a PR against `main`. PR titles follow [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`, `docs: …`); CI checks this.

Never commit secrets, real user data, or values from your own deployment (Supabase project refs, domains, Discord IDs). Use placeholders such as `<project-ref>` in docs and examples. CI runs gitleaks on every PR.

## End-to-end tests

`npm run test:e2e` runs a Playwright smoke suite in Chromium (`e2e/`): the public pages, email sign-up through the Mailpit confirmation mail and sign-in/out, a player reporting a result that the opponent confirms (standings move), the admin match page and its history, a broadcast overlay without the navigation bar, and the German language switch. Every page fails the test on an uncaught error, any console error (there is no allowlist: fix the cause) or a hydration warning, and the suite refuses any run that touches a host other than the loopback interface or any Supabase Storage bucket object.

Prerequisites, all local (nothing reaches a hosted Supabase project):

1. `npx supabase start`, then `npx supabase migration up --local` (or `npx supabase db reset --local`). The stack must be running; Mailpit is on http://127.0.0.1:54324.
2. `npm run build:e2e`: a production build against the local stack with the local asset mirrors and the example format pack. Rerun it after you change app code; the suite serves `.next` as it finds it.
3. `npm run test:e2e`. The suite starts its own server on port 3152 (`E2E_PORT` changes it; a server already there is never reused), runs `npm run dev:seed` once (idempotent) and uses the seeded league and the seeded logins (`seed-player-1@poketools.test` to `seed-player-8@poketools.test`, `local-admin@poketools.test`, all with the seed password). Discord is unset, so sign-in is email and password.

Run one spec, or keep a trace of a passing run, and open it in the trace viewer:

```bash
npx playwright test e2e/match-flow.spec.ts
npx playwright test e2e/public.spec.ts --trace on
npx playwright show-trace test-results/<test-folder>/trace.zip
```

A failing test keeps its trace and screenshot under `test-results/`; with `CI=1` the run also writes the HTML report to `playwright-report/` (`npx playwright show-report`). Use role and label locators (`getByRole`, `getByLabel`) and the fixtures in `e2e/support/fixtures.ts` (`test`, `newPage`) so the error and request guards apply. A spec that needs a match makes its own with `createScheduledMatch` in `e2e/support/seed.ts`, so reruns start clean. The sign-up test follows the stack's setting: with `enable_confirmations = true` (`supabase/config.toml`; a stack started before that setting needs `npx supabase stop` and `start`) it reads the confirmation link in Mailpit.

The suite runs on the Lite view of the league page (the semantic DOM page that signed-out visitors get by default; `?tier=lite` forces it, `docs/worlds.md`), so it needs no WebGL and no world assets. The 3D route world itself is not covered: check it by hand when you change it.

CI runs the suite in an **advisory** `e2e` job (not a required check, never in the main-protection ruleset): an ephemeral stack, `npm run build:e2e`, `npx playwright install --with-deps chromium`, then the suite. On failure it uploads the HTML report and the traces as the `playwright-report` artifact.

## Code Standards

- **TypeScript strict, no `any`** — row types in `src/types/database.ts`, domain types in per-entity files
- **Server components by default** — only add `'use client'` when interactivity is required
- **Supabase queries go through `src/lib/supabase/queries/`, Storage calls through `src/lib/supabase/storage/`** — route handlers, pages and components never import the service-role client (`@/lib/supabase/client`) or `@supabase/*`; only `src/lib` does, and ESLint fails on it (the allow-list in `eslint.config.mjs` is empty). The browser's only Supabase path is the Realtime-only exception in `AGENTS.md`
- **Auth guards on all protected routes** — `requireAuth()`, `requireAdmin()`, `requireCreator()`
- **All API errors use `safeErrorResponse()`** — and never generalize or mask distinct failure causes
- **Server logs go through `logger` (`src/lib/logger.ts`)** — `console.*` is a lint error in `src/app/api`; see `docs/operations-logging.md`
- **User-facing text goes through `src/i18n`** (English source, German translation)
- **No hardcoded Pokémon data** — always query `@pkmn/data` via `src/lib/pkmn/`

See [`AGENTS.md`](AGENTS.md) for the full list of architecture and security rules.

## Supabase Migration History

- **Never hand-rename a migration file that has already been applied to a
  shared Supabase project** — create a new migration instead. Renames leave
  an orphaned row in `supabase_migrations.schema_migrations` and cause
  re-apply/drift on the next `supabase db push`.
- **Never edit the SQL statements of an applied migration** — add a new one.
- One historical rename shipped in PR #47:
  `20260723100000_fix_claim_aggregate_jobs.sql` →
  `20260723205115_fix_claim_aggregate_jobs.sql` (reconciled with the remote
  history). If your local dev database recorded the old timestamp, run
  `supabase migration repair 20260723100000 --status reverted` before the
  next push — the file's content is an idempotent `CREATE OR REPLACE
  FUNCTION`, so there is no data risk.

## Project Documentation

- `AGENTS.md` — architecture, security and data rules (canonical for humans and coding agents)
- `docs/poketools-spec.md` — canonical specification
- `docs/modules-index.md` — module catalog with links to detailed docs

## License

By contributing, you agree that your contributions will be licensed under the MIT License. Third-party material keeps its own terms; see [NOTICE.md](NOTICE.md).
