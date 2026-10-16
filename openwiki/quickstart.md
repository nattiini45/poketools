# PokéTools — OpenWiki

> These wiki pages are a hand-maintained, navigable summary of the repository. When they disagree with the code, `AGENTS.md` or `docs/poketools-spec.md`, those win; update the page in the same change.

> Competitive Pokémon league and tournament management platform.
> Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, Supabase (Postgres), and NextAuth v5 (Discord OAuth). Deployed on Vercel.

## What PokéTools Does

PokéTools is a full-featured platform for managing competitive Pokémon leagues and tournaments. It handles the complete lifecycle from league creation through match results, stats aggregation, and live broadcast overlays.

**Core capabilities:**
- **League & Tournament Management** — Swiss, round-robin, single/double elimination brackets with pairings, standings, and advancement
- **Draft Leagues** — Snake and linear draft engines with pick/ban, pool management, and evolution-league progression
- **Teambuilder** — Import/export Showdown paste, validate sets against rulesets, damage calculator, AI co-pilot
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
| Hosting | Vercel |
| Testing | Vitest |

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Discord OAuth credentials
npm run dev                   # http://localhost:3000
```

Minimum env vars for core flows: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. See `.env.example` for the full surface (AI keys, avatar generation, social integrations, etc.).

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

### Reference
- [Extensibility & Deprecations](extensibility.md) — Feature flags, deprecation registry, adding new modules

## Key Files Quick Reference

| Concept | File |
|---------|------|
| Canonical product spec | `docs/poketools-spec.md` |
| Module index / doc catalog | `docs/modules-index.md` |
| Hard rules & architecture | `CLAUDE.md` |
| Agent instructions | `AGENTS.md` |
| Auth helpers | `src/lib/auth/helpers.ts` |
| Supabase client (service role) | `src/lib/supabase/client.ts` |
| Supabase query modules | `src/lib/supabase/queries/*.ts` (~29 modules) |
| API error handler | `src/lib/api/error-response.ts` |
| Match state machine | `src/lib/tournament/match-state.ts` |
| AI agent orchestrator | `src/lib/ai/agent/orchestrator.ts` |
| Security headers | `next.config.mjs` |
| Format packs (league tuning; `@format-pack`, `FORMAT_PACK`) | `src/lib/format-pack/`, `src/format-packs/example/`, `docs/format-packs.md` |
| Env var template | `.env.example` |
| CI pipeline | `.github/workflows/ci.yml` |
| Database migrations | `supabase/migrations/` |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build (includes type-check) |
| `npm run lint` | ESLint `src/` |
| `npm test` | Vitest (single run) |
| `npm run test:watch` | Vitest (watch mode) |
| `npm run test:coverage` | Vitest with coverage report |
