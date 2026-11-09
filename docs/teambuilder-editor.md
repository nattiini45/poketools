# Teambuilder Editor Module

### Overview

The unified team editor for PokéTools. A single `TeamsEditor` component supports three modes: **teambuilder** (saved rosters), **plan** (match prep fork), and **library** (read-only). The editor is a 2-column layout — the center workspace (team grid ↔ inline Showdown-style set editor) and the right Intel panel — with all picking surfaces (species, moves, items, abilities, tera) enriched by Smogon usage data for the active format.

### File Structure

The authoritative component tree lives in `docs/poketools-spec.md` Section 12 (`teambuilder/v3/`). Highlights:

- **Entry point**: `src/components/teambuilder/v3/editor/TeamsEditor.tsx` (mounted by `src/components/teambuilder/TeambuilderClient.tsx`)
- **State**: `src/components/teambuilder/v3/editor/state.ts` — reducer + `createInitialState`; `EditorContext.tsx` carries `{ state, dispatch }`
- **Workspace** (`v3/workspace/`): `SetWorkspace` switches grid ↔ inline set editor; `SpeciesPicker` (usage list with Pick% before any input, type filters, sortable stats, draft-pool constraints), `MovePicker` (learnset + usage%), `ItemPicker` (full panel, Name/Use% sortable), `AbilityPicker`/`TeraTypePicker` (usage-sorted dropdowns), `StatEditor` + `SpreadPresets` (meta spreads with usage share)
- **Intel** (`v3/intel/`): `IntelPanel` with Overview (type coverage + common teammates), Sets (SampleSetPicker), Calc (matchup matrix vs meta threats or the scouted opponent), Speed (merged team+meta tiers + outspeed solver via `POST /api/pkmn/speed-calc`); `IntelSubjectStrip` picks the analysed mon
- **Save badges** (`v3/editor/SaveStatusChips.tsx`): the top-bar chips for `saveStatus` (`idle | saving | saved | warned | unchecked | error`) plus locked and unsaved. `saveStatus` moves only as the machine `teambuilder.save` allows ([State machines](./state-machines.md), `src/lib/team/editor-save-state.ts`): a save never starts while another is in flight, and an edit made while a save is in flight keeps the editor dirty after the save lands (`inFlightSave`). `warned` ("saved, rules not met") and `unchecked` ("saved, rules not checked") are the player's only signal about the league's advisory team check (see Data Flows); they show only while the editor holds nothing newer than the saved team. A screen reader hears them through one always-mounted, visually hidden `role="status"` region whose text changes (a live region inserted together with its text is announced unreliably); the visible chips carry no role.
- **Validation** (`v3/validation/`): `ValidationPanel` (issue list with jump-to-field; takes `seasonId`) and `PoolsCard`, which in a running kit league shows "your pools this week" (own gifts, pool open/locked) from one read of the viewer's format view (`useKitLeagueView`, nothing shown for a plain league or a failed read) next to an audit note that the live check is advisory and the played team is checked again after the match.
- **Hooks** (`v3/hooks/`): `useTeamSave`, `useTeamValidation` (sends `match_id` only together with its tournament; both the teambuilder and plan mode supply the tournament and season, plan mode also the match), `useDraftContext`, `useSpeciesData`, `useUsageDetail`, `useIntelSubject`, `useOpponentSummary`, `useEditorCommands`
- **AI panel** (`v3/ai/`): `AiPanel` has two tabs and instantiates the typed `EditorCommandApi` (`commands.ts`) the agent uses to edit the team.
  - **Assistant** (default tab): `AiChatPanel`, the tool-using agent (`POST /api/ai/agent/chat`, `linden_teambuilding` persona); see [AI Agent](./ai-agent.md).
  - **Coach**: `SlotCoachPanel` and `TeamCoachPanel`, single-shot suggestions on demand (an Analyze button; nothing fires on save). `POST /api/teams/ai/slot-coach` (body `{ set, team, format, generation }`) and `POST /api/teams/ai/team-coach` (body `{ team, format, generation }`, validated by `teamCoachSchema`) call `complete()` from `src/lib/ai/client.ts` in the request's UI language and answer `{ success, content }` with free text (no structured patch, no one-click apply). Both need a signed-in player and are limited per player and per endpoint by `src/lib/ai/rate-limit.ts` (keys `slot-coach` and `team-coach`, each `AI_DAILY_LIMIT`, default 10 per rolling 24 hours; 429 `daily_limit_reached`). Tests: `src/app/api/teams/ai/*/__tests__/route.test.ts`.
  - There is no monotype tier: the "AI co-pilot" design with a monotype core builder was never built (see [Deprecations](./deprecations.md)).

### Data Flows

**Teambuilder mode:**
1. Page load → server fetches tournament + ruleset + existing team → `<TeamsEditor mode="teambuilder">`.
2. Save (FAB) → `POST /api/teams` (new) or `PATCH /api/teams/[id]` (existing) with pokemon, import_source, and optional `name`. Server validates with `teamCreateSchema`/`teamUpdateSchema`. A team row linked to a `completed` match is final (spec §7): its owner's `PATCH` or `DELETE` answers **409** `team_match_completed` and writes nothing, and the database trigger `teams_completed_match_lock` refuses any other path; a site admin's edit or delete goes through the correction functions `team_correct_update` / `team_correct_delete`. Deploy order: `supabase/migrations/20261019120000_teams_completed_match_lock.sql` before the code that calls those functions. The editor shows it: `/dashboard/team/[tid]` opens such a team locked for its owner (`lockReason="completed_match"`, its own banner), and a save refused with that 409 (or `match_prep_match_completed` in plan mode) locks the editor (`useTeamSave`).
   **Advisory league check:** a save is never refused for a kit league's team rules. The success body may carry `team_check` (`{ status: 'unmet', verdict }` or `{ status: 'unavailable' }`; absent when the rules are met or there are none; see [Team](./team.md)). `useTeamSave` marks the team saved either way: for `unmet` it puts the verdict into the validation panel and sets `saveStatus: 'warned'`, for `unavailable` it sets `'unchecked'`; a missing or malformed `team_check` is ignored (a save never fails because of its advisory). Plan mode (`POST /api/match-prep`) behaves the same. Do not add a blocking gate or a second chip component; `SaveStatusChips` is the one place.
3. Validation auto-runs (debounced) whenever `validationStatus` goes stale — every team mutation and format switch.

**Plan mode:**
1. Entry from match prep → `MatchPrepClient` mounts `<TeamsEditor mode="plan" matchId=... tournamentId=... seasonId=...>`; the page passes the match's tournament and that tournament's season. Plan mode therefore shows the same live verdict as the teambuilder, checked by the rules of the round of this match (`match_id` + `tournament_id` to `/api/validate-team`, so a week-3 match opened in week 4 is checked as round 3), and the validation panel's pools card for a running kit league. Saving is unaffected: plan mode with a `matchId` always posts to `/api/match-prep`, and the "New team" button exists only in teambuilder mode.
2. Save → `POST /api/match-prep`. Once the match is `completed` its registered rosters are public (spec §7) and count for EPB participation, so a participant's save answers **409** `match_prep_match_completed` and writes nothing; a site admin can still correct them.
3. Extra surfaces: the "Scout" right-panel tab (`OpponentPanel`) and the Calc tab's "Opponent's Pokémon" defender source, both backed by `GET /api/match-prep/opponent-summary` (calc-ready sets built from observed replay moves + usage data).

**Draft mode** (`isDraftLeague`): `useDraftContext` loads the pool, entries, taken list, and the signed-in player's roster (`/api/players/me` + draft state); `SpeciesPicker` constrains to the pool, shows costs, marks "your pick" vs "taken", and renders the `BudgetMeter`.

**Usage data:** all pickers read per-species usage via `useUsageDetail` (module-cached, `/api/usage-stats/[pokemon]?format=`). Formats map through `resolveStatsFormat` at the `meta-usage` query chokepoint. Coverage is maintained by the monthly `/api/cron/refresh-usage-stats` cron and the `/admin/meta-data` page (manual imports).

### Keyboard

- `1–6` select slots (opens the workspace; empty slots show the SpeciesPicker)
- `Esc` returns to the grid

### Dependencies

- **External**: `@pkmn/data`, `@pkmn/sets`, `@smogon/calc`, `motion`
- **Internal**: `src/lib/pkmn/` (validation, teams, format-mapping, speed/threat libs), `src/lib/supabase/queries/` (teams, match-prep-teams, meta-usage, sample-sets), `src/lib/smogon/` (import jobs)

### API Routes

`/api/teams`, `/api/teams/[id]`, `/api/teams/[id]/share|library|fork`, `/api/match-prep`, `/api/match-prep/opponent-summary`, `/api/validate-team`, `/api/import-team`, `/api/sample-sets`, `/api/usage-stats`, `/api/usage-stats/[pokemon]`, `/api/calc/threats`, `/api/calc/batch`, `/api/pkmn/{search,items,moves/[species],species-info,speed-tiers,speed-calc,type-analysis}`, `/api/admin/import-usage-stats`, `/api/admin/import-sample-sets`, `/api/cron/refresh-usage-stats`.

### Testing

- **Reducer**: `v3/editor/__tests__/state.test.ts` — full action matrix incl. `SET_SPEED_TARGET` (object target), `SET_TEAM_NAME`, `CLEAR_JUMP_TARGET`, format-switch staleness.
- **Commands**: `v3/hooks/__tests__/useEditorCommands.test.ts` — every command kind + lock/bounds rejections.
- **Save flow**: `v3/hooks/__tests__/useTeamSave.test.ts` — locked/409 handling and the advisory `team_check` (`warned`, `unchecked`, malformed body ignored); `v3/editor/__tests__/save-state.test.ts` — the save sequences through the reducer, refused moves, edits during a save.
- **Validation request**: `v3/hooks/__tests__/useTeamValidation.test.tsx` — `match_id` is sent with its tournament only, and a plan-mode state sends season, tournament and match; `src/components/match/__tests__/MatchPrepClient.test.tsx` — the plan editor receives the tournament and season.
- **Chips and pools**: `v3/editor/__tests__/SaveStatusChips.test.tsx` (warned/unchecked/dirty/i18n), `v3/validation/__tests__/pools-card.test.tsx` (PoolsCard and audit note in a kit league, plain league, unreadable view, DE).
- **API routes**: `src/app/api/teams/__tests__/`, `src/app/api/sample-sets/__tests__/` (slug→tier mapping), `src/lib/smogon/__tests__/format-registry.test.ts` (pattern discovery + fallback).

### Related Modules

- Team Module (`src/lib/team/`) — visibility/redaction, share, library
- PKMN Module (`src/lib/pkmn/`) — validation, parsing, format mapping, speed/threat builders
- Smogon Module (`src/lib/smogon/`) — usage/sets import pipeline from data.pkmn.cc
- AI Module (`src/lib/ai/`) — coach endpoints, rate limiting
- Broadcast Module — `BroadcastTeam` family (see `docs/teambuilder-broadcast.md`)

### Notes

- V1/V2 and the first v3 iteration's modal/browser components are deleted — see `docs/deprecations.md` for the list and replacements.
- eslint enforces `react-hooks/set-state-in-effect`; data hooks use module caches + render-time tracked-key resets instead of setState in effect bodies.
- Tailwind: only real tokens (`poke-base/surface/elevated/muted`, `poke-border/-strong`) — `poke-bg` and `poke-surface-hover` do not exist.
- The `teams.name` column requires migration `20260610190000_add_team_name.sql`; writes omit the column until a name is set, so the editor works pre-migration.
