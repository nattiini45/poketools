# AI Module

## Overview
The AI module handles server-side LLM workflows for PokéTools, including match analysis, match prep analysis, and tournament reports.

Kale Cabbage remains available only as a soft-deprecated legacy tournament-report path. It is disabled by default through `NEXT_PUBLIC_ENABLE_KALE_CABBAGE=false`; new report work should use the standard AI module paths unless a task explicitly opts into Kale validation.

## File Structure
```
src/lib/ai/
├── client.ts  # Anthropic client wrapper and completion helpers
├── kale/  # Soft-deprecated legacy report pipeline, retained for testing
├── context-builder.ts  # Match analysis and prep prompt builders
├── tournament-report-context.ts  # Round recap/forecast prompt builders
├── tournament-report-generator.ts  # Async report generation + parsing
├── trigger.ts  # Fire-and-forget trigger helpers
├── api-key.ts  # The Anthropic API key every AI feature uses (ANTHROPIC_API_KEY, deprecated CLAUDE_API_KEY), blank-trimmed
├── model-capabilities.ts  # What a Claude model id accepts on the raw Messages API
├── constants.ts  # Shared AI constants (stale-analysis age)
├── artifact-state.ts  # Lifecycle machine of the stored analyses and reports (aiArtifactMachine)
├── errors.ts  # Plain English error catalog of the AI routes
├── failure.ts  # How a failed generation is reported by the streamed generators
├── sse.ts  # Transport helpers of the streamed generators
├── usage-log.ts  # One counts-only usage record per model generation
├── rate-limit.ts  # AI endpoint rate limiting (daily generation slots)
├── language.ts  # Output language of generated AI text
├── format.ts  # The generation of a Showdown-style format string
├── league-context.ts  # Shared league-context formatters for prompts
├── coach-prompts.ts  # Prompt builders of the two teambuilder coaches
├── recap-prompt.ts  # Prompt of the weekly recap narrative
├── parse-analysis.ts  # Resilient parser of the structured match-analysis JSON
└── parse-scouting.ts  # Resilient parser of the structured scouting JSON
```

## Core Functions/Classes

### AI Client
- **File**: `client.ts`
- **Purpose**: Server-side completion wrapper with fallback + streaming
- **Key Methods**: `complete()`, `completeStreaming()`

### Context Builder
- **File**: `context-builder.ts`
- **Purpose**: Builds full prompts for match analysis and scouting
- **Key Methods**: `buildMatchAnalysisPrompt()`, `buildMatchPrepPrompt()`

### Tournament Report Context
- **File**: `tournament-report-context.ts`
- **Purpose**: Builds round recap/forecast prompts with server context
- **Key Methods**: `buildRoundRecapPrompt()`, `buildRoundForecastPrompt()`

### Tournament Report Generator
- **File**: `tournament-report-generator.ts`
- **Purpose**: Asynchronous report generation and JSON parsing/merging
- **Key Methods**: `generateTournamentReportAsync()`, `parseReportResponse()`, `mergeRecapWithServerData()`

### Trigger Helpers
- **File**: `trigger.ts`
- **Purpose**: Fire-and-forget orchestration from write paths
- **Key Methods**: `triggerTournamentReport()`, `triggerMatchAnalysis()`

## Data Flows
- **Input**: Match/tournament IDs and server-side context
- **Processing**:
  1. Build prompt from Supabase-backed context
  2. Call model via `complete()` / `completeStreaming()`
  3. Parse/merge response and persist in report/analysis tables
- **Output**: Stored AI analyses/reports + downstream notifications/revalidation

### Stored artifact lifecycle
`match_analyses`, `match_prep_analyses` and `tournament_reports` share one state machine, `aiArtifactMachine` (`src/lib/ai/artifact-state.ts`, section "AI artifact" in `docs/state-machines.md`): absent → pending → completed | failed. A generation inserts a pending row and settles it through `updateMatchAnalysis` / `updateMatchPrepAnalysis` / `updateTournamentReport`, which all go through `settleAiArtifact` (`src/lib/supabase/queries/ai-artifacts.ts`): `UPDATE … WHERE id = ? AND status = 'pending'` with a row-count check. A settle that matches no row (a forced regenerate or a match reset deleted the row while the generation ran) writes nothing, logs `ai/artifact` at warn level and returns false; the routes' responses do not change. Regenerating is delete-then-insert, never an UPDATE back to pending. A new writer goes through the same helper.

### Dormant native phase contracts

Native callers pass `phaseId` plus the real phase match or round id. `phase-context.ts` checks both owners before loading the phase's immutable ruleset pin. It reads native games, battle stats and teams, public league participants, and phase aggregates (league-wide projections for scouting); no tournament row is synthesized. Scouting with fewer than three phase history rows adds completed native sibling-phase history, never old phase tournaments. Shared prompt, replay-frame, type-analysis and parsing helpers retain the existing algorithms. Stored analyses follow the league's content language. The existing tournament entry points do not dispatch into these native readers.

`generatePhaseAnalysis` in `phase-analysis.ts` performs a live auth guard before serving a cached artifact. Post-match generation requires a participant or a live phase admin and a pending-confirmation/completed match. Scouting requires a scheduled match and the authenticated participant's own perspective; only the live superadmin may choose another participant's perspective. A creator or regular admin receives no scouting exception. The prep context never reads another player's prep team, and never includes the opponent's registered sheet before that match completes. Anonymous post-match sheets and published forecasts use the existing match-roster visibility policy.

`queries/phase-ai-artifacts.ts` stores results only in `phase_match_analyses` and `phase_match_prep_analyses`, checks the requested match's phase, and narrows prep reads by player. Inserts assert absent → pending; settlement uses `settleAiArtifact`; discard compares the observed row id and status. Cached completed and recent pending results are returned before context building or charging a daily generation slot. A unique pending artifact is claimed before charging, so a competing insert does not spend a slot. These functions return domain results, not HTTP responses; no native route is activated here.

`kale/phase-fact-pack.ts` loads native phase matches and reuses the deterministic fact builders. `runPhasePipeline` reuses the existing prompt tasks, validators, assemblers and model executor without invoking a tournament fact-pack loader. The shared fact pack's historical `tournamentName` field is only a prose label containing the phase name; it is never a database owner or a fabricated tournament id.

`generatePhaseReportAsync` binds `queries/phase-reports.ts` and distinguishes generated, cached, pending, disabled and superseded outcomes; downstream publication may act only on a successful generated result. `bindPhaseReportTrigger(standings)` supplies the system trigger; neither sends notifications nor changes event activation. The required `PhaseReportStandings` callback receives the real phase, round, pinned ruleset, league, native matches and report type. The assembly must supply current/previous standings, their scoring byes and the scoring description from native format services: recap through the requested round, forecast before it. There is deliberately no legacy standings-loader fallback. This preserves the caller's frozen scoring/tiebreaker contract without reading old phase tournaments. System report triggers, like their legacy counterpart, do not charge a player's daily slot.

Kale stays disabled unless `NEXT_PUBLIC_ENABLE_KALE_CABBAGE` is explicitly `true` and its existing server-side provider is configured. Disabled native triggers perform no phase reads. Route bindings, native format/standings assembly, cache expiry and publication effects remain separate activation work. Unit tests mock queries and providers; they are not migration, database-race or model-runtime proof.

## Dependencies
- **External Libraries**: `@anthropic-ai/sdk`
- **Internal Modules**:
  - [Supabase Module](./supabase.md) - context + persistence
  - [Match Module](./match.md) - match analysis inputs
  - [Tournament Module](./tournament.md) - round/tournament report inputs
  - [Discord Module](./discord.md) - report publication events

## API Routes
- `/api/ai/match-analysis`
- `/api/ai/match-prep-analysis`
- `/api/ai/tournament-report`

## Deprecation Notes
- `/admin/kale` is marked as soft-deprecated and superadmin-only.
- Kale environment variables remain documented in `.env.example` for legacy testing.
- Do not remove Kale dependencies or code until the deprecation entry in `docs/deprecations.md` is resolved by a hard-removal task.

## Usage Examples

```typescript
import { triggerMatchAnalysis } from '@/lib/ai/trigger';

void triggerMatchAnalysis(matchId);
```

## Testing
- **Test Files**: `src/lib/ai/__tests__/` (15 test files): `client.test.ts` and `client.contract.test.ts` (the SDK wrapper and its request contract), `package-pins.test.ts` (the pinned SDK versions), `api-key.test.ts`, `format.test.ts`, `language.test.ts`, `league-context.test.ts`, `rate-limit.test.ts`, `context-builder.test.ts`, `parse-scouting.test.ts`, `tournament-report-context.test.ts`, `tournament-report-generator.test.ts`, `trigger.test.ts`, `ai-helpers.test.ts` and `artifact-state.test.ts`. The agent, the Admin Assistant and the Kale pipeline have their own `__tests__` under `src/lib/ai/agent/`, `src/lib/ai/admin-agent/` and `src/lib/ai/kale/`.
- **Testing Approach**: Unit tests of the pure helpers (parsers, prompt builders, rate limit, key and language resolution) and the SDK wrapper with a mocked client; the AI routes are covered by their own route tests under `src/app/api/ai/`.

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
