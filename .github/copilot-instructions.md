# plc-toolkit — Copilot instructions

> See [`AGENTS.md`](../AGENTS.md) for the full guide. This is the short version
> that steers Copilot chat, review, and the coding agent.

## What this is
Next.js + TypeScript app (Supabase backend, NextAuth, Discord integration).

## Commands
- Dev: `npm run dev`
- Lint: `npm run lint` (eslint src/)
- Typecheck: `npm run typecheck` (tsc --noEmit)
- Test: `npm test` (vitest run) · coverage: `npm run test:coverage`
- Build: `npm run build` (next build)

## Conventions
- TypeScript strict; keep `tsc --noEmit` and eslint clean.
- Conventional Commits for PR titles (enforced by CI).
- Server secrets via env, never committed — gitleaks runs in CI and fails the PR.
- No real user data, Supabase project refs, deployment domains or local machine paths in code, fixtures or docs; use placeholders such as `<project-ref>`.

## Review focus
Correctness, type safety, no secret leakage, Supabase/NextAuth auth flows, and error transparency — no generalized, suppressed, or masked errors: distinct failure causes stay distinguishable, originals are always logged server-side.
