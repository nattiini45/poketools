# Teambuilder & Plan Team — Agent Reference

> **Audience:** Claude Chat Agent working with the PokéTools codebase.
> This document maps the Teambuilder and Match Prep ("Plan Team") systems — where code lives, what data flows through, and how they relate.

---

## Quick Orientation

PokéTools has **two distinct team systems**:

| System | Purpose | Scope | Table | Mutable? |
|--------|---------|-------|-------|----------|
| **Teambuilder** | Build/save a tournament roster | Per tournament (or standalone) | `teams` | Locked after tournament starts |
| **Plan Team** (Match Prep) | Draft a strategy for a specific match | Per match + per player | `match_prep_teams` | Always editable |

Both share the same `PokemonSet` data shape and the v3 `TeamsEditor` component for editing.

## Sunset Policy

Teambuilder V1/V2 workspaces and the V1 context-workspace tree were removed in the v3 ground-up rework. Routes use `TeambuilderClient` → `TeamsEditor` with the inline `v3/workspace/SetWorkspace.tsx` for per-slot editing (the old modal `SetEditor.tsx` is deleted). See `docs/deprecations.md` and `docs/teambuilder-editor.md`.

---

## 1. Shared Data Model

### `PokemonSet` — The universal unit (`src/types/team.ts`)

```typescript
interface PokemonSet {
  species: string;        // e.g. "Garchomp"
  gender?: string;        // 'M' | 'F' | ''
  item?: string;          // e.g. "Choice Scarf"
  ability?: string;       // e.g. "Rough Skin"
  evs?: StatSpread;       // { hp, atk, def, spa, spd, spe } each 0-252, sum ≤ 510
  ivs?: StatSpread;       // each 0-31, defaults 31
  nature?: string;        // e.g. "Jolly"
  level?: number;         // defaults 100
  moves: string[];        // 1-4 move names
  shiny?: boolean;
  happiness?: number;
  tera_type?: string;     // Gen 9 Terastallization type
}
```

### `StatSpread`
```typescript
interface StatSpread {
  hp: number; atk: number; def: number;
  spa: number; spd: number; spe: number;
}
```

### Import Sources
```typescript
type TeamImportSource = 'ps_text' | 'pokepast_url' | 'manual';
```

---

## 2. Teambuilder System

### Database: `teams` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `player_id` | UUID | FK → players |
| `tournament_id` | UUID? | FK → tournaments (null = standalone) |
| `season_id` | UUID? | FK → seasons (draft context) |
| `pokemon` | JSONB | Array of `PokemonSet` |
| `import_source` | enum | `'ps_text' \| 'pokepast_url' \| 'manual'` |
| `locked` | boolean | Immutable after tournament begins |
| `is_draft_team` | boolean | Bound to draft pool ownership |
| `draft_pool_id` | UUID? | FK → draft_pools |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### Type: `Team` (`src/types/team.ts`)
```typescript
interface Team {
  id: string;
  player_id: string;
  tournament_id: string | null;
  season_id: string | null;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  locked: boolean;
  is_draft_team: boolean;
  draft_pool_id: string | null;
  created_at: string;
  updated_at: string;
}
```

### Visibility Rules
- **Owner** sees full team always.
- **Admin** sees full team always.
- **Other players** see `pokemon: ['hidden', ...]` until match completion (`canViewTeam()` in API route).

### API Routes

| Endpoint | Methods | File |
|----------|---------|------|
| `/api/teams` | GET, POST | `src/app/api/teams/route.ts` |
| `/api/teams/[id]` | GET, PATCH, DELETE | `src/app/api/teams/[id]/route.ts` |

**GET `/api/teams`** — List player's teams. Optional `?tournament_id=X` or `?player_id=X`.

**POST `/api/teams`** — Create team. Body: `{ tournament_id?, pokemon[], import_source }`. Validates player doesn't already have team for tournament.

**PATCH `/api/teams/[id]`** — Update `pokemon[]` and `import_source`. Owner-only, rejects if locked (admins bypass).

**DELETE `/api/teams/[id]`** — Owner or admin. Rejects if locked (admins bypass).

### Page Routes

| Route | Purpose | File |
|-------|---------|------|
| `/teambuilder` | Standalone builder (no tournament) | `src/app/teambuilder/page.tsx` |
| `/teambuilder/[tid]` | Build team for a tournament | `src/app/teambuilder/[tid]/page.tsx` |
| `/dashboard/team/[tid]` | Edit existing team | `src/app/dashboard/team/[tid]/page.tsx` |

---

## 3. Plan Team (Match Prep) System

### Database: `match_prep_teams` table

Created by migration: `supabase/migrations/20260317200000_create_match_prep_teams.sql`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `match_id` | UUID | FK → matches |
| `player_id` | UUID | FK → players |
| `pokemon` | JSONB | Array of `PokemonSet` |
| `import_source` | enum | Same as teams |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Constraint:** `UNIQUE(match_id, player_id)` — one prep team per player per match.

### Type: `MatchPrepTeam` (`src/types/match-prep.ts`)
```typescript
interface MatchPrepTeam {
  id: string;
  match_id: string;
  player_id: string;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  created_at: string;
  updated_at: string;
}
```

### Query Module (`src/lib/supabase/queries/match-prep-teams.ts`)

| Function | Purpose |
|----------|---------|
| `getMatchPrepTeam(matchId, playerId)` | Single player's prep team for a match |
| `getMatchPrepTeams(matchId)` | Both players' prep teams (admin) |
| `upsertMatchPrepTeam(matchId, playerId, pokemon, importSource)` | Create or replace |
| `listMatchPrepTeamsByPlayer(playerId)` | All prep teams for dashboard listing |
| `deleteMatchPrepTeam(id)` | Delete |

### API Route

| Endpoint | Methods | File |
|----------|---------|------|
| `/api/match-prep` | GET, POST | `src/app/api/match-prep/route.ts` |

**GET `/api/match-prep?match_id=X`** — Player's own prep team for the match.

**POST `/api/match-prep`** — Upsert prep team. Validates player is match participant (or admin). Body: `{ match_id, pokemon[], import_source }`. Admins may specify `player_id`.

### Page Routes

| Route | Purpose | File |
|-------|---------|------|
| `/dashboard/match-prep/[mid]` | Plan team for a specific match | `src/app/dashboard/match-prep/[mid]/page.tsx` |

### Entry Points (how users reach Plan Team)

1. **Dashboard** (`src/app/dashboard/DashboardContent.tsx`, ~line 193) — "Plan Team" button on active/upcoming matches.
2. **Tournament match page** (`src/app/tournaments/[id]/matches/[mid]/page.tsx`) — "Plan Team" button linking to `/dashboard/match-prep/{matchId}`.

### AI Integration (Scouting)

The match prep page integrates with the "Professor Linden" AI scouting system.

**Context builder:** `src/lib/ai/context-builder.ts`

- If the player **has** a planned team → AI provides matchup analysis (advantages, disadvantages, specific adjustments).
- If the player **hasn't** planned a team → AI suggests 3-5 Pokémon picks with recommended sets.
- The prep team takes priority over tournament teams when building AI context.

**UI:** `src/components/match/MatchPrepClient.tsx` renders the scouting report alongside the team editor.

---

## 4. Shared Components

Both systems use the same editing UI. Here's the component tree:

> **Stale (pre-v3):** `TeamEditorCore` and the modal `SetEditor` below no longer exist. Per-slot editing is the inline `v3/workspace/SetWorkspace.tsx` inside `v3/editor/TeamsEditor.tsx`; see `docs/teambuilder-editor.md` for the current tree.

```
TeambuilderClient (save wrapper)          MatchPrepClient (save wrapper)
        ↓                                         ↓
   TeamEditorCore  ←──────── shared ────────→  TeamEditorCore
        ↓
  ┌─────┼──────────────┬──────────────┐
  │     │              │              │
TeamImporter    TeamDisplay    SetEditor    TypeAnalysisPanel
(paste/URL)     (6-slot grid)  (modal)      (coverage sidebar)
                     │              │
               SetSlot cards   Combobox fields
               LegalityBadge  StatDisplay
                               PokemonPicker
```

### Component Details

| Component | File | Role |
|-----------|------|------|
| `TeambuilderClient` | `src/components/teambuilder/TeambuilderClient.tsx` | Wraps editor with save to `/api/teams`. Props: tournamentId, rulesetId, initialPokemon, teamId, locked. |
| `MatchPrepClient` | `src/components/match/MatchPrepClient.tsx` | Wraps editor with save to `/api/match-prep`. Shows opponent name + scouting report. |
| `TeamEditorCore` | `src/components/teambuilder/TeamEditorCore.tsx` | State machine: pokemon[], editingSlot, viewMode ('editor' / 'teamsheet-full' / 'teamsheet-open'). Handles import, slot editing, validation, view toggling. |
| `TeamImporter` | `src/components/teambuilder/TeamImporter.tsx` | Two tabs: "Paste Text" and "PokePaste URL". POSTs to `/api/import-team`. |
| `TeamDisplay` | `src/components/teambuilder/TeamDisplay.tsx` | 6-slot grid (3 cols). Each slot: sprite, species, type badges, item/ability/nature, moves with type badges, compact stat bars. |
| `SetWorkspace` | `src/components/teambuilder/v3/workspace/SetWorkspace.tsx` | Inline per-slot editor (replaced the deleted modal `SetEditor.tsx`): species header, item/ability/nature/tera pickers, move section, stat editor with spread presets. |
| `PokemonPicker` | `src/components/teambuilder/PokemonPicker.tsx` | Species search modal with debounce. Fetches `/api/pkmn/search?type=species`. |
| `StatDisplay` | `src/components/teambuilder/StatDisplay.tsx` | 6 stat bars. Calculates effective stats from base + IV + EV + nature + level. Color-coded nature boosts/reductions. |
| `LegalityBadge` | `src/components/teambuilder/LegalityBadge.tsx` | Green "Legal" or red/yellow with issue list. Shows team-level + per-set issues. |
| `TypeAnalysisPanel` | `src/components/teambuilder/TypeAnalysisPanel.tsx` | Sidebar (~320px). Per-Pokémon types, team weaknesses (2+ members weak), resistances. |
| `TeamsheetView` | `src/components/teambuilder/TeamsheetView.tsx` | Printable grid. Modes: 'full' (all details) or 'open' (items + ability + tera only). |
| `TeamExporter` | `src/components/teambuilder/TeamExporter.tsx` | html2canvas PNG export. Download or copy to clipboard. |
| `TeamPicker` | `src/components/teambuilder/TeamPicker.tsx` | Load existing team modal. Searches player's teams by tournament name or species. |

---

## 5. Pokémon Data Layer (`src/lib/pkmn/`)

All Pokémon data comes from `@pkmn/dex` + `@pkmn/data`, never hardcoded. These packages are large and server-side only.

### dex.ts — Core Wrapper (`src/lib/pkmn/dex.ts`)

| Function | Returns | Notes |
|----------|---------|-------|
| `getGeneration(num)` | Generation | Singleton `Generations(Dex)` instance |
| `getSpecies(name, gen?)` | Species \| null | |
| `getMove(name, gen?)` | Move \| null | |
| `getItem(name, gen?)` | Item \| null | |
| `getAbility(name, gen?)` | Ability \| null | |
| `searchSpecies(q, gen?)` | SearchResult[] | Name-prefix match |
| `searchMoves(q, gen?)` | SearchResult[] | |
| `searchItems(q, gen?)` | SearchResult[] | |
| `searchAbilities(q, gen?)` | SearchResult[] | |
| `searchSpeciesRich(q, gen?)` | RichResult[] | Includes types, baseStats |
| `searchMovesRich(q, gen?)` | RichResult[] | Includes type, power, category |
| `searchAbilitiesRich(q, gen?)` | RichResult[] | Includes description |
| `searchMovesForSpecies(species, q, gen?)` | RichResult[] | **Async** — walks pre-evos for learnsets |
| `searchAbilitiesForSpecies(species, q, gen?)` | RichResult[] | Only legal abilities |
| `getLegalAbilities(species, gen)` | {name, slot}[] | |
| `checkMoveLegality(species, moves[], gen)` | {move, legal}[] | **Async** |
| `validateSetLegality(species, ability, moves[], gen)` | SetLegalityResult | **Async** |
| `getSpeciesTypeInfo(name, gen)` | Weaknesses/resistances/immunities | |
| `getTeamTypeAnalysis(speciesList, gen)` | TeamTypeAnalysis | Aggregated team coverage |
| `getBaseStats(name, gen?)` | StatSpread | |
| `getSpeciesInfoBatch(names)` | {name, types, baseStats}[] | |
| `resolveEvoChain(name, gen)` | 3-stage array \| null | |

### teams.ts — Import/Export (`src/lib/pkmn/teams.ts`)

| Function | Purpose |
|----------|---------|
| `parseTeamText(text)` | Pokémon Showdown text → `PokemonSet[]` (uses `@pkmn/sets`) |
| `exportSetText(set)` | `PokemonSet` → PS text block |
| `exportTeamText(sets)` | Full team → PS text (newline-separated) |
| `normaliseSet(raw)` | Fill defaults: IVs=31, EVs=0, level=100, etc. |

### validation.ts — Team Validation (`src/lib/pkmn/validation.ts`)

| Function | Purpose |
|----------|---------|
| `validateTeam(pokemon, ruleset, draftedPokemon?)` | Full validation suite |
| `validateDraftOwnership(pokemon, draftedPokemon)` | Draft-only: all species in player's roster |

**Validation checks:**
- Structure: 1-6 Pokémon, no empty array.
- Per-set: species exists, moves exist, item exists, ability exists, EVs ≤ 252 each / ≤ 510 total, IVs ≤ 31.
- Clauses: Species Clause (no duplicates), Item Clause (no duplicate items).
- Ruleset: banned Pokémon, banned moves, banned items, banned abilities.
- `min_shared_type_pct`: Monotype-style rules.
- Draft ownership: if `draftedPokemon[]` provided.

Returns: `TeamValidationResult { issues: SetIssue[], team_issues: string[], valid: boolean }`.

### formats.ts — Format Metadata (`src/lib/pkmn/formats.ts`)

| Export | Purpose |
|--------|---------|
| `GENERATIONS[]` | Gen 1-9 with tier availability |
| `FORMAT_DEFAULTS{}` | Pre-built configs: gen9ou, gen9lc, monotype, 1v1, etc. |
| `clausesForTier(tier)` | Default clause set per format |
| `getBannedPokemonForTier(tier)` | Dynamic banlist from `@pkmn/dex` |
| `getFormatDefaults(format)` | Full config for a format string |

---

## 6. Supporting API Routes

| Endpoint | Method | File | Purpose |
|----------|--------|------|---------|
| `/api/import-team` | POST | `src/app/api/import-team/route.ts` | Parse PS text or pokepast.es URL → `PokemonSet[]` with optional validation |
| `/api/validate-team` | POST | `src/app/api/validate-team/route.ts` | Run `validateTeam()` against ruleset, optionally with draft ownership |
| `/api/pkmn/search` | GET | `src/app/api/pkmn/search/route.ts` | Autocomplete: `?type=species\|move\|item\|ability&q=gar&species=Garchomp&rich=1` |
| `/api/pkmn/stats` | GET | `src/app/api/pkmn/stats/route.ts` | `?species=Garchomp` → base stats + types |
| `/api/pkmn/species-info` | GET | `src/app/api/pkmn/species-info/route.ts` | `?names=Garchomp,Tyranitar` → batch info (max 12) |
| `/api/pkmn/type-analysis` | POST | `src/app/api/pkmn/type-analysis/route.ts` | Body: `{ species[], gen? }` → per-mon + team weaknesses/resistances |
| `/api/pkmn/validate-set` | POST | `src/app/api/pkmn/validate-set/route.ts` | Body: `{ species, ability?, moves? }` → ability + move legality |
| `/api/pkmn/format-defaults` | GET | `src/app/api/pkmn/format-defaults/route.ts` | `?format=gen9ou` → clauses, banlists |

---

## 7. Data Flow Diagrams

### Teambuilder Flow
```
User → /teambuilder or /teambuilder/[tid]
         ↓
   TeambuilderClient (loads existing team if editing)
         ↓
   TeamEditorCore
     ├─ Import: POST /api/import-team → pokemon[]
     ├─ Edit slot: SetWorkspace (inline; was the modal SetEditor)
     │    ├─ Species search: GET /api/pkmn/search?type=species
     │    ├─ Move search:    GET /api/pkmn/search?type=move&species=X (filtered)
     │    ├─ Item search:    GET /api/pkmn/search?type=item
     │    ├─ Ability search: GET /api/pkmn/search?type=ability&species=X (filtered)
     │    └─ Stats:          GET /api/pkmn/stats?species=X
     ├─ Type analysis: POST /api/pkmn/type-analysis
     ├─ Validate: POST /api/validate-team
     └─ View: Teamsheet (full/open) + PNG export
         ↓
   Save: POST /api/teams (create) or PATCH /api/teams/[id] (update)
         ↓
   Stored in `teams` table
```

### Plan Team Flow
```
User → Dashboard "Plan Team" button or Tournament match "Plan Team" link
         ↓
   /dashboard/match-prep/[mid]
         ↓
   Server: loads match, opponent, ruleset, existing prep team, scouting report
         ↓
   MatchPrepClient
     ├─ TeamEditorCore (same editing flow as Teambuilder)
     └─ ScoutingReportCard (AI analysis from Professor Linden)
         ↓
   Save: POST /api/match-prep (upsert)
         ↓
   Stored in `match_prep_teams` table
         ↓
   AI context-builder uses prep team for improved scouting analysis
```

---

## 8. Key Constraints to Remember

1. **`@pkmn/dex` is server-side only** — never import in client components. All access through `/api/pkmn/*` routes.
2. **Teams lock** after tournament starts — `locked: true` prevents PATCH/DELETE (admins bypass).
3. **Visibility** — non-owner/non-admin sees `pokemon: ['hidden']` until match completion.
4. **Draft ownership** — draft teams validate all species are in the player's draft roster.
5. **Prep teams are always mutable** — no lock mechanism, designed for iterative planning.
6. **Auth on every route** — `requireAuth()` or `requireAdmin()` guard all team endpoints.
7. **No RLS** — all access control is in API route logic, not Postgres policies.
8. **Prep team informs AI** — the scouting system reads `match_prep_teams` to tailor advice. If a prep team exists, AI gives matchup analysis; if not, AI suggests picks.
