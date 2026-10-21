# Deprecations

## Kale Cabbage
- Status: soft-deprecated.
- Default flag: `NEXT_PUBLIC_ENABLE_KALE_CABBAGE=false`.
- Kept for legacy report testing and backward compatibility with existing report code.
- New report work should use the standard AI module paths unless the flag is deliberately enabled for validation.
- Do not remove `@ai-sdk/openai` or `src/lib/ai/kale/*` until a hard-removal task is approved.

## Legacy AI paths (single-shot) — agent replacements flagged, cutover pending
- Status: **active**, but each now has a tool-driven AI Agent counterpart beside it (see `docs/ai-agent.md`).
- Replacements:
  - `/api/ai/match-analysis` (post-match recap) → `/api/ai/agent/analyze-match` `post_match` (`linden_match_prep`). Gated by `NEXT_PUBLIC_AGENT_POST_MATCH` (default `false`). The agent path persists the SAME structured `MatchAnalysisContent` and reuses the per-match cache, so the cards are unchanged; the deterministic, weather-aware match context is injected via `gatherMatchContext` (shared with the legacy builder). Legacy `/api/ai/match-analysis` stays as the rollback.
  - `/api/ai/match-prep-analysis` (scouting) → `/api/ai/agent/analyze-match` `opponent_scout`. Gated separately by `NEXT_PUBLIC_AGENT_MATCH_ANALYSIS` (default `false`). `opponent_scout` persists the SAME structured `MatchPrepAnalysisContent` and reuses the per-`(match, player)` cache, so the `ScoutingReportCard` is unchanged; the deterministic, perspective-scoped scouting context is injected via `gatherMatchPrepContext` (shared with the legacy builder) and `parseScoutingResponse` is shared (`src/lib/ai/parse-scouting.ts`). Legacy `/api/ai/match-prep-analysis` stays as the rollback. The `threat_assessment` flavour remains free-text (no structured card consumes it).
  - `/api/ai/tournament-report` (Kale 2.0 pipeline) → `/api/ai/agent/tournament-report` (`kale` persona). The legacy pipeline stays untouched.
- The homepage Professor Linden widget and the teambuilder Assistant panel are agent-only (no legacy equivalent).
- Do not remove the legacy routes or their `src/lib/ai/*` helpers until the flag defaults to the agent and a hard-removal task is approved. `parseAnalysisResponse` is now shared (`src/lib/ai/parse-analysis.ts`) by both the legacy route and the agent path.

## Teambuilder V1 + V2
- Status: **deleted** in the Teambuilder v3 ground-up rework.
- Replaced by `src/components/teambuilder/v3/editor/TeamsEditor.tsx` — a single editor with three modes (`teambuilder` | `plan` | `library`).
- Hard cutover; no fallback. V1 (`TeambuilderWorkspace.tsx`, `TeamGrid.tsx`, `SlotCard.tsx`, `InlineSetEditor.tsx`) and V2 (`TeambuilderWorkspaceV2.tsx`, legacy context compat shim) were deleted atomically.
- The `TeambuilderContext.tsx` 584-line reducer + `useTeambuilderContext` / `useOptionalTeambuilderContext` legacy bridge were replaced by `v3/editor/state.ts` (14-action reducer, no compat shim).
- See `docs/teambuilder-editor.md` for the new architecture. The V1/V2 → v3 migration summary was never committed; the rework's commits are the record.

## Teambuilder "AI co-pilot" design (never built)
- Status: **struck** (2026-10-18). The design described a three-tier co-pilot under `/api/teams/co-pilot/{slot,team,monotype}` with structured suggestions, one-click apply, an auto-run on Plan Team save and a monotype core builder. None of it shipped: no such route, prompt module or parser ever existed.
- What ships instead: the AI panel's **Coach** tab (`POST /api/teams/ai/slot-coach`, `POST /api/teams/ai/team-coach`, free-text suggestions on demand) beside the **Assistant** tab (the agent). See `docs/teambuilder-editor.md`.
- The design doc `docs/teambuilder-ai-copilot.md` and the spec's co-pilot routes, section and variables (`AI_SLOT_COACH_DAILY_LIMIT`, `TEAM_LIBRARY_ENABLED`, neither ever read by the code) were removed. A monotype tier would be a new feature with its own spec.

## Teambuilder v3 superseded components (picker rework)
- Status: **deleted** in the Showdown-style picker rework.
- `v3/browser/MonotypeBuilder.tsx` — replaced by `workspace/SpeciesPicker.tsx` (full-pane usage-list picker with type filters); the left browser column was removed entirely (2-column layout).
- `v3/browser/DraftPoolBrowser.tsx` — draft pool constraints folded into `SpeciesPicker` (pool filtering, costs, taken/your-pick states, BudgetMeter).
- `v3/workspace/MoveTable.tsx` — replaced by `workspace/MovePicker.tsx` (learnset with usage%, filters, sorting).
- `v3/editor/SetEditorModal.tsx` — replaced by the inline `workspace/SetWorkspace.tsx`.
- `src/components/teambuilder/SetEditor.tsx` — deleted. Cast Studio edits sets with its own `creator/studio/CastSetEditor.tsx`.

## Tournament groups write path
- Status: **revived** (2026-08-22, league phase revamp).
- Write APIs restored under `POST/PATCH/DELETE /api/seasons/[id]/phases/[phaseId]/groups` (+ `groups/members`).
- Query helpers `createGroup`, `deleteGroup`, `addGroupMember`, `removeGroupMember`, and serpentine auto-assign live in `src/lib/supabase/queries/tournament-groups.ts` again.
- UI: `PhaseGroupsPanel` on the phase admin page.

## StageManager (league stage creation)
- Status: **retired** (2026-08-22).
- Replaced by `PhaseTimeline` + `PhaseForm` on `/admin/leagues/[id]` and the dedicated phase page `/admin/leagues/[id]/phases/[phaseId]`.
- League phases are created via `POST /api/seasons/[id]/phases`; `POST /api/tournaments` no longer accepts `season_id`.
- `src/components/league/StageManager.tsx` deleted — recover from git history if needed.

## SeedingBoard (PR #54 drag-and-drop board)
- Status: **retired** (2026-08-22).
- Replaced by `SeedingTable` as the canonical seeding UI (drag reorder, manual seeds, shuffle, rating, standings re-import, and per-player losers-bracket start toggles for double-elim).
- Deleted: `SeedingBoard.tsx`, `SeedingSlot.tsx`, `PlayerChip.tsx`, `src/lib/tournament/seeding.ts`, `seeding-board.ts`, and their tests (`seeding.test.ts`, `seeding-board.test.ts`, `double-elim-lb-start.test.ts`).
- Kept: `tournament_participants.starting_bracket` column + migration — that is the data model for bracket engine v2 losers-bracket starts.
- Legacy `double-elim.ts` still serves pre-structure per-round generation and public `computeBracketState()` loss badges; it is not wired into new v2 generate/propagate paths.

## Tournament groups write path (legacy deletion note)
- The 2026-07-08 deletion of `POST /api/tournaments/[id]/groups` remains superseded by the phase-scoped routes above. The old tournament-level write path is not restored.

## Discord Bot
- Status: deferred.
- Current scope is webhook/event fan-out only.
- Future bot/DM work should add explicit env vars, slash-command routes, and permission review before implementation.