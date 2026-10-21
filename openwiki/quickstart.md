# PokéTools — OpenWiki

> These wiki pages are a hand-maintained, navigable summary of the repository. When they disagree with the code, `AGENTS.md` or `docs/poketools-spec.md`, those win; update the page in the same change.

> Competitive Pokémon league and tournament management platform.
> Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, Supabase (Postgres), and NextAuth v5 (Discord OAuth). Targets Vercel; any Next.js 16 host works.

## What PokéTools Does

PokéTools is a full-featured platform for managing competitive Pokémon leagues and tournaments. It handles the complete lifecycle from league creation through match results, stats aggregation, and live broadcast overlays.

**Core capabilities:**
- **League & Tournament Management** — Swiss, round-robin, single/double elimination brackets with pairings, standings, and advancement
- **Draft Leagues** — Snake and linear draft engines with pick/ban, pool management, and evolution-league progression
- **Teambuilder** — Import/export Showdown paste, validate sets against rulesets, damage calculator, AI Assistant and Coach tabs
- **Replay Pipeline** — Parse Pokémon Showdown replays, extract battle stats, compute aggregates and standings
- **Broadcast & Cast Studio** — Real-time overlays for streamers, BroadcastChannel sync, second-screen tools
- **AI Agent** — Multi-persona, tool-using competitive assistant (match analysis, team building, scouting reports)
- **Wiki / Encyclopedia** — Public Pokémon reference pages with community notes
- **Gamification** — Achievements, streaks, player signatures, Glicko-2 ratings with Pokéball tier badges

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS 3 |
| Language | TypeScript (strict, no `any`) |
| Database | Supabase (Postgres) via `@supabase/supabase-js` |
| Auth | NextAuth v5 — Discord OAuth + email/password |
| AI | Anthropic SDK + Vercel AI SDK v6, OpenAI-compatible providers |
| Pokémon Data | `@pkmn/data`, `@pkmn/dex`, `@pkmn/protocol`, `@pkmn/client`, `@smogon/calc` |
| Hosting | Vercel (or any Next.js host) |
| Testing | Vitest |

## Quick Start

The repository [README](../README.md) is the authoritative setup guide (prerequisites, environment variables, first admin, scheduled jobs). The short form for local development, which needs Node.js 22 (`.nvmrc`), Docker for the local Supabase stack and your own Discord application:

```bash
npm install
cp .env.example .env.local      # then fill in the values (README, "Environment variables")
npx supabase start              # local Postgres, Auth, Storage and REST API
npx supabase db reset           # apply supabase/migrations/ to the local stack
npm run dev                     # http://localhost:3000
```

- `npx supabase status -o env` prints the local values: `API_URL` goes into `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY` into `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY` into `SUPABASE_SERVICE_ROLE_KEY` (see `docs/supabase-environments.md`).
- Add `http://localhost:3000/api/auth/callback/discord` as an OAuth2 redirect URL of your Discord application.
- The README's "Required" table lists every variable the core flows need; `.env.example` holds the full surface. An empty value counts as missing: the server env schema (`src/lib/env.ts`) names every missing or invalid key of a group at once. The six variables the build itself needs are the CI set: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
- First admin and the default rulesets: README, "First run".
- A fresh clone runs the neutral example format pack, whose numbers are placeholders: README, "Format packs", and `docs/format-packs.md`.

## Documentation Map

### Architecture & Rules
- [Architecture Overview](architecture/overview.md) — File structure, hard rules, key patterns, Supabase access model

### Domain Modules
- [Core Modules](domain/core-modules.md) — Auth, database, rating (Glicko-2), gamification, social, Discord
- [Tournaments & Drafts](domain/tournaments-and-drafts.md) — Tournament engines, match state, draft system, replay parsing
- [Public Site & Content](domain/public-and-content.md) — Public pages, Insights, Wiki, Replays, Broadcast, Cast Studio, Teambuilder, Creator Hub

### AI System
- [AI Agent System](ai/agent-system.md) — Multi-persona agent, tool registry, model routing, memory, feature flags

### Operations
- [Testing & CI](operations/testing-and-ci.md) — Test structure, CI pipeline, coverage, safe-error-response guard
- [Security](operations/security.md) — OWASP-mapped security rules, auth hierarchy, error handling patterns
- Backups, restore drill and migration lock safety: `docs/operations-backup.md`

### Reference
- [Extensibility & Deprecations](extensibility.md) — Feature flags, deprecation registry, adding new modules

## Key Files Quick Reference

| Concept | File |
|---------|------|
| Canonical product spec | `docs/poketools-spec.md` |
| Module index / doc catalog | `docs/modules-index.md` |
| Hard rules, architecture, agent instructions | `AGENTS.md` (`CLAUDE.md` is a thin wrapper) |
| Auth helpers | `src/lib/auth/helpers.ts` |
| Supabase client (service role) | `src/lib/supabase/client.ts` |
| Supabase query modules | `src/lib/supabase/queries/*.ts` (one per table or domain) |
| API error handler | `src/lib/api/error-response.ts` |
| Match state machine | `src/lib/tournament/match-state.ts` |
| AI agent orchestrator | `src/lib/ai/agent/orchestrator.ts` |
| Security headers | `next.config.mjs` |
| Format packs (league tuning; `@format-pack`, `FORMAT_PACK`) | `src/lib/format-pack/`, `src/format-packs/example/`, `docs/format-packs.md` |
| Pack extensions (optional seam a format pack may fill) | `src/lib/pack-extensions/`, `docs/format-packs.md` ("Pack extensions") |
| Env var template | `.env.example` |
| CI pipeline | `.github/workflows/ci.yml` |
| Database migrations | `supabase/migrations/` |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build (includes type-check) |
| `npm run lint` | ESLint `src/` and `scripts/` |
| `npm test` | Vitest (single run) |
| `npm run test:watch` | Vitest (watch mode) |
| `npm run test:coverage` | Vitest with coverage report |
