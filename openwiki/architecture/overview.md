# Architecture Overview

> How PokéTools is organized, the non-negotiable rules, and the key patterns every contributor and agent must follow.

## Source Tree

```
src/
  app/                  Next.js App Router (pages + 130+ API routes)
    (public)/           Unauthenticated browse: homepage, tournaments, leagues, insights, wiki, replays, players
    (player)/           Authenticated: dashboard, submit results, teambuilder, match prep
    (broadcast)/        Public overlay pages (match, league, draft, player, wiki, solo)
    admin/              Admin dashboard (tournaments, matches, players, achievements, rulesets, league trash)
    creator/            Creator Hub: studio, wiki, overlays
    api/                All API routes (see Domain Modules below)
    auth/               NextAuth pages
  components/           React components by domain
    shared/             Cross-cutting: NavBar, PlayerAvatar, TypeBadge, etc.
    ui/                 Design system primitives: Button, Card, Modal, Input, etc.
    broadcast/          Overlay components, tracker components
    creator/            Creator Hub components
  lib/                  Business logic, DB queries, Pokémon wrappers (see below)
  types/                TypeScript types — domain types + database row types (src/types/database.ts)
supabase/
  migrations/           SQL migration files (8+ migrations)
docs/                   Per-module documentation (see docs/modules-index.md)
scripts/                CI guard scripts (safe-error-response enforcement)
```

## App Router Route Groups

| Route Group | Auth | Purpose |
|---|---|---|
| `(public)` | None required | Homepage, browse tournaments/leagues, Insights, Wiki, Replays, player directory |
| `(player)` | `requirePlayer()` | Dashboard, result submission, teambuilder, match prep |
| `(broadcast)` | None (public overlays) | Stream overlays for match, league, draft, player, wiki, solo |
| `admin/` | `requireAdmin()` (scoped dashboard, matches and player search: `requireAnyAdmin()` + `getAdminScope()`) | Tournament/player/achievement management, audit logs |
| `creator/` | `requireCreator()` | Cast Studio, overlay management, wiki editing |
| `api/` | Varies per route | 130+ API routes — see module docs |

## Domain Library (`src/lib/`)

| Directory | Purpose |
|---|---|
| `api/` | Error response helper (`safeErrorResponse`), pagination, user-facing errors |
| `auth/` | NextAuth v5 helpers: `requireAuth`, `requireAdmin`, `requireCreator`, `requirePlayer` |
| `supabase/` | Typed service-role client + query modules in `queries/` (one per table or domain) |
| `ai/` | AI client, context builder, rate limiter, agent orchestrator, tools, prompts |
| `tournament/` | Pairing engines (Swiss/RR/SE/DE), match-state machine, standings, advancement |
| `draft/` | Legacy draft engine (snake/linear/free), the queue engine's TypeScript side (snapshot, contracts, pick clock and quiet hours in `time.ts`, pool completability in `completability.ts`), evolution-league progression |
| `match/` | Match aggregation, result effects, completion workflows (guarded finalize steps and the `finalized_at` marker in `finalize.ts`) |
| `rating/` | Glicko-2 engine, rating updater/rollback, tier classifier |
| `pkmn/` | Pokémon data access (`@pkmn/data`), legality validation, replay parsing, speed calc |
| `broadcast/` | Tracker reducer, overlay config, recap engine, BroadcastChannel |
| `gamification/` | Achievements, streaks, player signatures |
| `social/` | X/Threads/Bluesky publishing, credential encryption |
| `discord/` | Webhook and embed notification system |
| `avatar/` | Avatar rendering, generation, gallery, rate limiting |
| `team/` | Team visibility/redaction logic |
| `insights/` | Scope model for unified stats hub |
| `wiki/` | Encyclopedia entry builders |
| `smogon/` | Stats/set import pipelines from Smogon |
| `stats/` | Usage row computation |
| `season/` | Core assignment logic |
| `format-pack/` | Format-pack contract and accessors: a league's tuning (EPB numbers and rulings, workbook layout, rule prose) read from the active pack; the public example pack is `src/format-packs/example/` (`docs/format-packs.md`) |
| `validation/` | Input validation schemas and helpers |
| `pack-extensions/` | The optional, server-only seam a format pack may fill (supplementary records, extra profile and settings sections, extra links); the example pack fills nothing (`docs/format-packs.md`, "Pack extensions") |
| `utils/` | Shared utilities (date formatting, LRU cache, the request rate limiter `rate-limit.ts`: Postgres-backed on Vercel, in-process elsewhere) |

## Hard Rules (Non-Negotiable)

These rules are absolute. Violations are blocking. See `AGENTS.md` for the full rules (`CLAUDE.md` is a thin wrapper around it).

### Data Access
1. **Supabase is the sole writer** — all writes go through API routes, never the dashboard. Client: `src/lib/supabase/client.ts`. Queries: `src/lib/supabase/queries/*.ts`.
2. **Service role key stays server-side** — `SUPABASE_SERVICE_ROLE_KEY` must never reach the client. Client components fetch from API routes only.
3. **Browser Supabase is Realtime-only** — in the browser, `NEXT_PUBLIC_SUPABASE_ANON_KEY` is allowed only through `src/lib/supabase/realtime-client.ts` for Cast Studio broadcast channels. No browser table reads or writes. On the server, only the GoTrue client `src/lib/supabase/auth-client.ts` (email/password sign-in) reads it.
4. **RLS is defense-in-depth** — all tables have RLS enabled, and the `anon` and `authenticated` API roles hold no privilege in schema `public`; only `service_role` is granted. Auth guards in API routes remain the primary authorization layer.
5. **Pre-compute aggregates** — stats pages read `aggregates` by default. Never scan `battle_stats` at read time. Every write to `games`/`battle_stats` enqueues an aggregate job applied by `apply_aggregate_job`; admin rollbacks go through `rollback_game_aggregates`.

### Code Quality
6. **TypeScript strict, no `any`** — row types in `src/types/database.ts`, domain types in per-entity files.
7. **Server components by default** — `'use client'` only when interactivity is required.
8. **Explicit match state transitions** — validated through `src/lib/tournament/match-state.ts`. No direct status overwrites.
9. **Schema changes require type regen** — update `src/types/database.ts` after any Supabase schema change (`npm run db:types` generates it from the local stack).

### Error Handling
10. **All API errors use `safeErrorResponse()`** — from `src/lib/api/error-response.ts`. Never use bare `console.error` + manual `NextResponse.json()`.
11. **No error generalization, suppression, or masking** — distinct failure causes must remain distinguishable. User-facing domain errors (e.g., `UserFacingError` subclasses) pass through intact.
12. **AI stays server-side** — Anthropic SDK wrapper at `src/lib/ai/client.ts`.

## Supabase Access Model

```
Browser ──── API Route ──── Supabase (service role key)
                │
                ├── requireAuth() / requireAdmin() / requirePlayer()
                ├── safeErrorResponse() in catch
                └── Query modules in src/lib/supabase/queries/

Browser ──── realtime-client.ts ──── Supabase Realtime (anon key, Cast Studio only)
```

- **Service role client**: `src/lib/supabase/client.ts` — used by all API routes and server modules
- **Realtime client**: `src/lib/supabase/realtime-client.ts` — browser-only, Cast Studio broadcasts
- **Query modules**: `src/lib/supabase/queries/*.ts` — table/domain-specific modules
- **Migrations**: `supabase/migrations/` — SQL migration files

## Key Architectural Patterns

### Auth Hierarchy
```
requireAuth() → requirePlayer() → requireAdmin()
                                → requireAnyAdmin()  (site admin or resource admin; scope with getAdminScope())
                                → requireCreator()
                                → requireResourceAdmin(type, id)
                                → requireDraftAdmin(poolId)
```
All from `src/lib/auth/helpers.ts`. Public routes document with `// Public: no auth required`.

### Error Handling Flow
```typescript
import { safeErrorResponse } from '@/lib/api/error-response';

try {
  // business logic
} catch (err) {
  return safeErrorResponse(err, 'Failed to do X');
}
```
`safeErrorResponse` passes `UserFacingError` subclasses through (specific message + code + status), passes `AuthError` messages through, and logs everything else server-side while returning a static fallback.

### Pokémon Data Access
- Use `new Generations(Dex)` from `@pkmn/data` + `@pkmn/dex` — not `Dex.forFormat()`
- Replay parsing: `@pkmn/protocol` + `@pkmn/client` — not `@pkmn/logs`
- Never hardcode Pokémon names, type charts, or move lists (league configuration ids live in the format pack and are validated against `@pkmn/dex` by `src/lib/format-pack/__tests__/pack-pkmn.server.test.ts`)
- `@pkmn/dex` is large — server-side only via API routes

### Design System
- Warm "Pokémon Center" palette defined as CSS custom properties in `src/app/globals.css`
- Tailwind tokens under `poke-*` namespace (defined in `tailwind.config.ts`)
- UI primitives in `src/components/ui/` — see [Design](../domain/public-and-content.md#design-system)
- See `docs/design.md` for full token reference

## Where to Start

| Task | Start Here |
|------|------------|
| Understand the product | `docs/poketools-spec.md` |
| Find a module's docs | `docs/modules-index.md` |
| Write an API route | Read an existing one (e.g., `src/app/api/players/route.ts`) |
| Write a query module | Read an existing one (e.g., `src/lib/supabase/queries/players.ts`) |
| Add a database change | `supabase/migrations/`, then regenerate `src/types/database.ts`; lock safety and backups: `docs/operations-backup.md` |
| Change AI behavior | `src/lib/ai/agent/` — see [AI Agent System](../ai/agent-system.md) |
| Add a broadcast overlay | `src/lib/broadcast/` + `src/app/(broadcast)/` — see `docs/broadcast.md` |
| Understand security rules | `AGENTS.md` Security Requirements — see [Security](../operations/security.md) |
