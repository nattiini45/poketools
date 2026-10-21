# Contributing to PokéTools

Thanks for your interest in contributing! This guide covers the essentials. Please read and follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Getting Started

1. Fork the repo and clone locally
2. `npm install` (Node.js 22+, see `.nvmrc`)
3. Copy `.env.example` to `.env.local` and fill in the required values (see the README's Self-hosting section)
4. Set up your own Supabase project, local (`npx supabase start`, then `npx supabase db reset`) or hosted (`npx supabase link --project-ref <your-project-ref>`, then `npx supabase db push`); see [docs/supabase-environments.md](docs/supabase-environments.md)
5. `npm run dev` to start the dev server

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
4. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for any user-facing change (Added, Changed, Fixed, Security, Removed), and an upgrade note for every new migration or environment variable.
5. Open a PR against `main`. PR titles follow [Conventional Commits](https://www.conventionalcommits.org) (`feat: …`, `fix: …`, `docs: …`); CI checks this.

Never commit secrets, real user data, or values from your own deployment (Supabase project refs, domains, Discord IDs). Use placeholders such as `<project-ref>` in docs and examples. CI runs gitleaks on every PR.

## Code Standards

- **TypeScript strict, no `any`** — row types in `src/types/database.ts`, domain types in per-entity files
- **Server components by default** — only add `'use client'` when interactivity is required
- **Supabase queries go through `src/lib/supabase/queries/`** — never import the Supabase client directly in pages or API routes
- **Auth guards on all protected routes** — `requireAuth()`, `requireAdmin()`, `requireCreator()`
- **All API errors use `safeErrorResponse()`** — and never generalize or mask distinct failure causes
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
