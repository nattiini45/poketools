# Wiki Module

## Overview
The Wiki / Encyclopaedia system provides entry pages for every Pokémon move, item, ability, and tera type. Data comes from `@pkmn/dex` (hard facts) and `wiki_notes` table (community-sourced competitive analysis). All wiki pages are public for SEO. Each entry is also available as an OBS overlay.

## File Structure
```
src/types/wiki.ts                              # WikiEntityType, WikiNote, WikiMoveEntry, etc.
src/lib/supabase/queries/wiki-notes.ts         # CRUD/moderation for wiki_notes + reports
src/lib/wiki/moderation.ts                     # Simple automated note scan
src/lib/pkmn/dex.ts                            # Extended: getAllMoves(), getAllItems(), getAllAbilities()
src/app/api/wiki/
├── moves/[name]/route.ts                      # GET: move details + approved notes
├── items/[name]/route.ts                      # GET: item details + approved notes
├── abilities/[name]/route.ts                  # GET: ability details + approved notes
├── search/route.ts                            # GET: cross-entity search
├── notes/route.ts                             # POST: submit community note
├── notes/[id]/route.ts                        # PATCH/DELETE: edit/approve/reject/delete note
└── notes/[id]/report/route.ts                 # POST: report approved note
src/app/api/admin/wiki/
├── notes/route.ts                             # GET: moderation queue
└── reports/route.ts                           # GET/PATCH: note report queue
src/app/admin/wiki/page.tsx                    # Admin moderation queue UI
src/components/wiki/
├── WikiMoveContent.tsx                        # Move entry content (layout-agnostic)
├── WikiItemContent.tsx                        # Item entry content
├── WikiAbilityContent.tsx                     # Ability entry content
├── WikiNotesSection.tsx                       # Community notes display + submission form
└── WikiSearchBar.tsx                          # Search input with dropdown results
src/lib/wiki/entries.ts                        # Shared WikiMoveEntry / Item / Ability builders
src/app/(public)/wiki/
├── page.tsx                                   # Wiki browser: search + category cards
├── pokemon/page.tsx                           # Species index (detail at /pokemon/[name])
├── moves/[name]/page.tsx                      # Move entry
├── items/[name]/page.tsx                      # Item entry
├── abilities/[name]/page.tsx                  # Ability entry
└── tera/[type]/page.tsx                       # Tera type entry
src/app/creator/wiki/[...rest]/page.tsx        # Redirect → /wiki/*
src/app/broadcast/wiki/                        # OBS overlay versions (see broadcast.md)
├── pokemon/[name]/page.tsx
├── moves/[name]/page.tsx
├── items/[name]/page.tsx
├── abilities/[name]/page.tsx
└── tera/[type]/page.tsx
supabase/migrations/20260409000000_wiki_notes.sql
```

## Core Data Sources

### Hard Data (from @pkmn/dex — server-side only)
- `getMove(name, gen)` → name, type, category, basePower, accuracy, pp, priority, desc, flags
- `getItem(name, gen)` → name, desc, shortDesc, generation
- `getAbility(name, gen)` → name, desc, shortDesc, generation, rating
- `getSpecies(name, gen)` → name, types, baseStats, abilities

### Community Notes (from wiki_notes table)
- Scoped by `entity_type` + `entity_name`
- Filterable by `scope_type` (global/tournament/league) + `scope_id`
- Require approval (`approved: boolean`) before display
- Pending/rejected states are reviewed through `/admin/wiki`
- Reports are stored in `wiki_note_reports` and reviewed by admins
- AI-generated insights are optional and deprioritized

### Usage Stats
- Pokémon usage from `aggregates` table (pre-computed)
- Move/item/ability usage from `battle_stats.moves_used` (targeted server-side reads, allowed per hard rules)

## Wiki Notes Table
```sql
wiki_notes (
  id, entity_type, entity_name, author_id,
  content, scope_type, scope_id, approved,
  approved_by, approved_at, rejected_by, rejected_at,
  rejection_reason, moderation_flags,
  created_at, updated_at
)

wiki_note_reports (
  id, note_id, reporter_id, reason, details,
  status, created_at, updated_at
)
```

## Moderation Flow
1. Player submits note through `/api/wiki/notes`; note is created with `approved=false` and automated scan flags.
2. Admin reviews pending notes at `/admin/wiki`.
3. Approval sets `approved=true`, records moderator metadata, and makes the note visible through `getApprovedNotes()` and direct public RLS.
4. Rejection records moderator metadata and keeps the note non-public.
5. Approved notes can be reported through `/api/wiki/notes/[id]/report`; reports are reviewed from the admin queue.

## Content Architecture
Wiki content components are **layout-agnostic** — they accept data props and render content without any page-level wrapper. This allows the same component to be used in:
1. SSR wiki pages under `/creator/wiki/*` (wrapped in page container)
2. OBS overlay pages under `/broadcast/wiki/*` (wrapped in OverlayShell)

## Performance
- Wiki pages: `revalidate = 3600` (ISR, 1-hour cache)
- Static @pkmn/dex data doesn't change between deploys
- Community notes fetched on each request (not cached)

## Dependencies
- [PKMN Module](./pkmn.md) — `getMove()`, `getItem()`, `getAbility()`, `getSpecies()`, `getAllMoves()`, `getAllItems()`, `getAllAbilities()`
- [Supabase Module](./supabase.md) — wiki_notes queries
- [Auth Module](./auth.md) — `requirePlayer()` for note submission, `requireAdmin()` for approval
- [Broadcast Module](./broadcast.md) — OverlayShell for wiki overlays, url-builder registry

## Related Modules
- [Broadcast Module](./broadcast.md) — wiki overlay types in url-builder
- [Creator Hub Module](./creator-hub.md) — parent routing
- [Cast Studio Module](./cast-studio.md) — wiki entries accessible during cast prep
