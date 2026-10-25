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
├── notes/[id]/route.ts                        # PATCH/DELETE: edit (re-queues for authors)/approve/reject (also unpublishes)/delete note
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
  resubmission_blocked_at, resubmission_blocked_by,
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
6. An author's edit (`PATCH /api/wiki/notes/[id]` with `content`) puts the note back in the pending queue: `updateNote(id, content, 'author')` sets `approved=false`, clears the approval and rejection fields and re-runs the automated scan in one atomic UPDATE, so edited text is never public before a moderator has seen it. A site admin's edit (`'moderator'`) re-scans the text but keeps the note's status. The audit entry `wiki.note.update` records `requeued` and `was_approved`.
7. A reported note that is still approved can be unpublished from its report card in `/admin/wiki` ("Unpublish note"). It uses the existing admin reject action (`PATCH /api/wiki/notes/[id]` with `rejected: true` and an optional reason, audited as `wiki.note.reject` with `was_approved`) and then closes that report as reviewed. Other open reports on the same note stay open and show that the note is no longer public.
8. **Block from resubmitting (superadmin only).** Unlimited resubmission of a rejected note is not intended, so the superadmin (`isSuperadmin`, the configured superadmin identity; plain site admins are not enough) can close a rejected note for good. In `/admin/wiki` the "Rejected" view lists rejected notes; the superadmin sees a "Block from resubmitting" button on each (behind a confirmation that says it is final for the author), a "Blocked" badge marks blocked notes for every admin, and "Allow resubmitting" lifts the block again. The request is `PATCH /api/wiki/notes/[id]` with the strict body `{ "block_resubmission": boolean }` (no other field is accepted with it), audited as `wiki.note.block_resubmission` / `wiki.note.unblock_resubmission`.
   - Only a rejected note can be blocked (409 `wiki_note_block_not_rejected` otherwise); a non-superadmin gets 403 `wiki_note_block_superadmin_only`; repeating the current state is a no-op. Blocking writes only `resubmission_blocked_at` / `resubmission_blocked_by`, so the note stays rejected and non-public.
   - An author's edit of a blocked note is refused with 403 `wiki_note_resubmission_blocked` ("A moderator closed this note for resubmission", localized) and re-queues nothing. The author's UPDATE itself filters on `resubmission_blocked_at IS NULL`, so a block that lands between the route's check and the write still wins. A site admin's own edit (`'moderator'`) is not affected.
   - Approving a note clears the block in the same UPDATE; the table CHECK `wiki_notes_resubmission_block_rejected_check` allows a block only on a rejected, not-approved note. Deleting a blocked note stays possible for its author and for admins.
   - The block is not part of the public note shape: `toWikiNote` includes the two fields only on a blocked note, and public reads return approved notes only. Migration: `20261025090000_wiki_note_resubmission_block.sql`.

### Moderation guarantees
- Public reads only return `approved = true` rows (`getApprovedNotes()` filters on it), so a pending, rejected or re-queued note is never shown.
- The update path takes the editor mode as a required argument, so no caller can edit note text without choosing whether the edit re-queues the note.
- A rejected note edited by its author is re-queued as well; that is the resubmit path, unless the superadmin blocked it (step 8).
- Only the superadmin identity can block or unblock; the route checks `isSuperadmin(await getSession())` after the live `requireAdmin()`, and the admin page only uses the same check to decide which buttons to show.

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
