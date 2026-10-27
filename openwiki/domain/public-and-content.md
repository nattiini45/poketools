# Public Site & Content Surfaces

> Public-facing pages, the Insights stats hub, Wiki encyclopedia, Replay library, Broadcast overlays, Cast Studio, Teambuilder, and Creator Hub.

## Public Site

**Docs:** `docs/public-site.md`

The `(public)` route group is the unauthenticated face of PokéTools. Every route is viewable without login, though some pages gate parts of content behind auth.

### Homepage (`/`)
- Hero with Discord sign-in CTA
- AI Agent chat widget (always agent path, no legacy equivalent)
- Featured active event (league preferred over tournament) with top-3 standings
- Links to Insights, Wiki, recent tournaments/leagues
- Rendering: `dynamic = 'force-dynamic'` with `revalidate = 60` ISR fallback

### Key public routes
| Route | Content |
|---|---|
| `/tournaments` | Tournament list → bracket view → match detail |
| `/leagues` | League list → hub → teams, stats, draft |
| `/insights` | Unified stats/ratings hub (see below) |
| `/replays` | Spoiler-free replay library (see below) |
| `/wiki/*` | Pokémon encyclopedia (see below) |
| `/pokemon/[name]` | Canonical species page |
| `/players` | Player directory → public profile |
| `/leaderboard` | 308 redirect to `/insights?tab=ratings` |

## Insights

**Docs:** `docs/insights.md`

Single public surface for cross-cutting stats. Replaces older standalone leaderboard and per-entity stats pages.

### Scope model (`src/lib/insights/scope.ts`)
```typescript
type InsightsScope =
  | { type: 'global' }
  | { type: 'league'; id: string }
  | { type: 'tournament'; id: string };

type InsightsTab = 'ratings' | 'usage' | 'moves' | 'kills' | 'h2h' | 'streaks';
```

### Key functions
- `parseScopeFromSearchParams(input)` — URL → typed scope
- `scopeAggregateKey(scope)` — Maps to aggregate query parameters
- `parseInsightsTab(value)` — Validates tab against whitelist

## Wiki / Encyclopedia

**Docs:** `docs/wiki.md`

Public, SEO-friendly Pokémon reference pages. Community notes layer for player-contributed content.

### Structure
- `/wiki` — Browse/search
- `/wiki/[slug]` — Entry detail
- Entry builders: `src/lib/wiki/entries.ts`
- Notes: `src/lib/supabase/queries/wiki-notes.ts`

## Replays

**Docs:** `docs/replays.md`

Spoiler-free public replay library at `/replays`. Lists recorded Pokémon Showdown replays without revealing winners or team compositions.

### Key files
- `src/lib/supabase/queries/replay-library.ts` — `listReplayLibraryRows()` query
- `src/app/(public)/replays/replay-library-utils.ts` — Param parsing, filtering, sort
- Filter/sort is in-memory (dataset bounded by recorded matches)

## Broadcast & Overlays

**Docs:** `docs/broadcast.md`

Real-time overlay state for streamers. Overlay types: match (preview/live/results/teams/h2h/moments), league (standings/attract/recap/usage), draft, player, wiki, solo.

### Key components
| File | Purpose |
|---|---|
| `src/lib/broadcast/tracker-reducer.ts` | Live battle tracker state transitions |
| `src/lib/broadcast/draft-replay.ts` | Draft replay playback (step/jump/advance) |
| `src/lib/broadcast/recap-engine.ts` | Weekly recap composition |
| `src/lib/broadcast/overlay-config.ts` | Overlay configuration |
| `src/lib/broadcast/animations.ts` | Animation presets |
| `src/app/(broadcast)/` | Public overlay pages |

### BroadcastChannel
- `src/lib/broadcast/channel.ts` — BroadcastChannel sync between Cast Studio and overlays
- Uses browser Supabase Realtime (the one allowed exception)

### API routes
- `/api/broadcast/moments` — Highlight moments CRUD
- `/api/broadcast/state/[mid]` — Live match state
- `/api/broadcast/preview/[mid]` — Match preview
- `/api/broadcast/recap/[sid]` — Season recap
- `/api/broadcast/standings/[sid]` — Standings overlay
- `/api/broadcast/presets` — Preset management

## Cast Studio

**Docs:** `docs/cast-studio.md`

Second-screen tool for streamers. Manages cast sessions, inline team editing, and overlay control.

### Key aspects
- Per-session Realtime channel with unguessable `realtime_key`
- Solo streamer mode (no second screen needed)
- Inline team editing via `CastSetEditor` (uses legacy `SetEditor` component)
- Protected by `requireCreator()` auth

## Teambuilder

**Docs:** `docs/teambuilder-editor.md`, `docs/teambuilder-reference.md`

Unified team editor with three modes: **teambuilder** (build from scratch), **plan** (AI-assisted match prep), **library** (saved teams).

### Architecture (v3)
- `src/components/teambuilder/v3/editor/TeamsEditor.tsx` — Root editor component
- `src/components/teambuilder/v3/editor/state.ts` — 14-action reducer (replaced 584-line legacy context)
- Two-column layout: the center workspace (team grid ↔ inline set editor) and the right Intel panel
- FAB (floating action button) for quick actions

### AI panel

**Docs:** `docs/teambuilder-editor.md`

The editor's AI panel has two tabs:
1. **Assistant** — the tool-using agent (`POST /api/ai/agent/chat`); see [AI Agent System](../ai/agent-system.md).
2. **Coach** — single-shot, on-demand suggestions for one slot (`POST /api/teams/ai/slot-coach`) or the whole team (`POST /api/teams/ai/team-coach`), rate-limited per player and endpoint (`AI_DAILY_LIMIT`, default 10 per 24 hours).

There is no monotype tier (never built; `docs/deprecations.md`).

### Team validation
- `POST /api/validate-team` — Validates against ruleset constraints
- `src/lib/pkmn/validation.ts` — Set legality checking
- Validates against the ruleset the tournament pins (an immutable version, `getRulesetById`); the validator reads only that version's frozen resolved rules (block and allow lists, Species and Item Clause, team constraints)

## Creator Hub

**Docs:** `docs/creator-hub.md`

Dedicated dashboard for league organizers and casters at `/creator`.

- Quick actions for common tasks
- Studio access and overlay management
- Protected by `requireCreator()` auth

## Design System

**Docs:** `docs/design.md`

Warm "Pokémon Center" palette (cream backgrounds, soft shadows, rounded corners).

### Tokens (`src/app/globals.css` → `tailwind.config.ts`)
- `poke-base` — App background (`#FAF7F2`)
- `poke-surface` — Card fill (`#FFFFFF`)
- `poke-elevated` — Raised surfaces (`#F5F0E8`)
- `poke-muted` — Subtle backgrounds (`#EDE8DD`)
- `poke-text-primary` / `-secondary` / `-muted` — Text hierarchy
- `poke-red` (`#E3350D` franchise red), `blue`, `green`, `yellow` — Accent colors
- `poke-moment-*` — Broadcast highlight palette

### Typography
- `font-heading` → Nunito via `next/font/google`
- Body: default sans stack

### UI Primitives (`src/components/ui/`)
`PageContainer`, `Card`, `Button`, `Badge`, `Input`, `Select`, `Textarea`, `Table`, `Tooltip`, `Popover`, `Modal`, `ConfirmDialog`, `Alert`, `Section`, `CollapsibleSection`, `Combobox`, `Skeleton`

All server-component-safe unless they need interactivity.

## Player Profiles

**Docs:** `docs/profile.md`

Player profile composition combining ratings, achievements, match history, and social links.

## Avatar System

**Docs:** `docs/avatar.md`

Canvas-based avatar compositing with asset layers and Supabase Storage.

- `src/lib/avatar/` — Rendering, generation, gallery, rate limiting
- `/api/avatar/transform` — Avatar generation endpoint
- Rate-limited via atomic Supabase RPC with `FOR UPDATE` locks
