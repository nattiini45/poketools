# AI Module

## Overview
The AI module handles server-side LLM workflows for PokéTools, including match analysis, match prep analysis, and tournament reports.

Kale Cabbage remains available only as a soft-deprecated legacy tournament-report path. It is disabled by default through `NEXT_PUBLIC_ENABLE_KALE_CABBAGE=false`; new report work should use the standard AI module paths unless a task explicitly opts into Kale validation.

The dormant native round-report store is `src/lib/supabase/queries/phase-reports.ts`, with `PhaseReport` ownership (`phase_id`, never a tournament alias). It supports round recaps/forecasts, complete paged reads, pending creation, guarded AI-artifact settlement and compare-and-set discard for regeneration. The public mapper `toPublicPhaseReport` excludes model, token accounting and diagnostic error fields. `loadPhaseReportStandings` binds the native enrollment and round facts to shared standings algorithms: recaps include the requested round, forecasts exclude it, and kit tables narrow to the actual phase even before its first result. EPB retains its stored tiebreaker order and pack points; Swiss byes and playoff metadata follow the same scoring gates as public tables. Only non-kit standings read narrow phase battle stats for round-granular kills; kit tables use their existing completed-match facts. Existing routes and generators retain legacy storage until activation.

## File Structure

The dormant native service factory binds the report trigger to publication after a newly generated artifact settles successfully. Disabled, cached, pending and superseded outcomes never reannounce. Publication verifies the actual phase/round pair, expires the owning phase/league cache, copies only recap/forecast notification fields and uses the approved `/leagues/<league>/phases/<phase>` link. It retains the legacy Discord-only report fan-out; model names, accounting and diagnostics are excluded. No existing route selects this factory.
```
src/lib/ai/
├── client.ts  # Anthropic client wrapper and completion helpers
├── kale/  # Soft-deprecated legacy report pipeline, retained for testing
├── context-builder.ts  # Match analysis and prep prompt builders
├── tournament-report-context.ts  # Round recap/forecast prompt builders
├── tournament-report-generator.ts  # Async report generation + parsing
├── trigger.ts  # Fire-and-forget trigger helpers
├── phase-analysis.ts  # Native phase analysis authorization and generation
├── phase-context.ts  # Native match and scouting prompt context
├── phase-report-generator.ts  # Native round report generation and settlement
├── phase-trigger.ts  # Dormant native report trigger and publication binding
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

`generatePhaseAnalysis` in `phase-analysis.ts` performs a live auth guard before serving a cached artifact. Post-match generation requires a participant or a live phase admin and a pending-confirmation/completed match. The ID-only `/api/ai/match-prep-analysis` selects the native flow for a verified phase match. Native scouting requires a scheduled match and the live enrolled participant's own perspective; admin roles do not grant access to another player's report. The prep context never reads another player's prep team, and never includes the opponent's registered sheet before that match completes. Anonymous post-match sheets and published forecasts use the existing match-roster visibility policy.

`queries/phase-ai-artifacts.ts` stores results only in `phase_match_analyses` and `phase_match_prep_analyses`, checks the requested match's phase, and narrows prep reads by player. Inserts assert absent → pending; settlement uses `settleAiArtifact`; discard compares the observed row id and status. Cached completed and recent pending results are returned before context building or charging a daily generation slot. A unique pending artifact is claimed before charging, so a competing insert does not spend a slot. These functions return domain results, not HTTP responses; no native route is activated here.

`kale/phase-fact-pack.ts` loads native phase matches and reuses the deterministic fact builders. `runPhasePipeline` reuses the existing prompt tasks, validators, assemblers and model executor without invoking a tournament fact-pack loader. The shared fact pack's historical `tournamentName` field is only a prose label containing the phase name; it is never a database owner or a fabricated tournament id.

`generatePhaseReportAsync` binds `queries/phase-reports.ts` and distinguishes generated, cached, pending, disabled and superseded outcomes; downstream publication may act only on a successful generated result. `bindPhaseReportTrigger(standings)` supplies the system trigger; neither sends notifications nor changes event activation. The required `PhaseReportStandings` callback receives the real phase, round, pinned ruleset, league, native matches and report type. The assembly must supply current/previous standings, their scoring byes and the scoring description from native format services: recap through the requested round, forecast before it. There is deliberately no legacy standings-loader fallback. This preserves the caller's frozen scoring/tiebreaker contract without reading old phase tournaments. System report triggers, like their legacy counterpart, do not charge a player's daily slot.

Kale stays disabled unless `NEXT_PUBLIC_ENABLE_KALE_CABBAGE` is explicitly `true` and its existing server-side provider is configured. Disabled native triggers perform no phase reads. Route bindings, native format/standings assembly, cache expiry and publication effects remain separate activation work. Unit tests mock queries and providers; they are not migration, database-race or model-runtime proof.

### Agent ownership boundary

`agent/resource-ref.ts` defines strict competition, round, match and game references. A phase owner carries both `seasonId` and `phaseId`; a standalone owner carries only `tournamentId`. Native rows are never projected into `Tournament` or given a synthetic `tournament_id`. `validateAgentResourceRefs` validates at most 200 references before one injected batch read, then compares each authoritative result, including its league and storage kind. Missing results refuse; read errors propagate. This validation is not itself authentication or provenance.

`admin-agent/readers/ownership.ts` supplies the `createAdminAgentOwnershipReader()` server adapter. Each nonempty `resolve` reauthenticates with `requirePhaseAwareAdmin()` and derives the relevant native/legacy read scopes from that fresh player. A phase assignment or its actual league assignment allows native reads; only legacy tournament scope allows standalone reads. Roles and scopes are never retained between calls. These scopes authorize reads only: mutations must still run their own live resource guards and current-state checks.

`queries/agent-ownership.ts` reads only primary keys and parent foreign keys from the explicitly selected store. It reconstructs game → match → round/competition, checks match/round coherence, and verifies each native competition's league exists. Standalone competitions must have `season_id === null`; a legacy phase tournament is refused even for a site admin. Store-specific maps keep colliding UUIDs separate. No missing native row falls back to tournament storage, or vice versa. Authorized actual owners are returned in input order (including duplicates), so wrong requested parents fail the validator's comparison rather than becoming trusted labels. Missing, incomplete or inaccessible chains return null; auth, scope and database failures propagate without a partial success result.

Both the adapter and query entry validate the entire batch before any read. Empty batches read nothing; malformed or over-200 batches reject before authentication or persistence. Owner reads deduplicate primary keys into at most 50-key requests per table, with no fan-out child scans or private/player columns. Each request can return at most 50 rows, below PostgREST's row cap. The graph uses at most five dependency waves and a conservative ceiling of 32 owner queries for 200 refs, including incoherent parent chains; live guard/scope reads are separate. This is a bounded read-time check, not a transactional mutation lock. Outside open legacy mode, the proposal fence uses this adapter to verify standalone owners from the exact request selectors covered by the step hash. It never interprets a native phase id as a tournament ref or retargets a proposal through an alias.

`admin-agent/proposals/ownership-contract.ts` provides a separate, hash-bound native reference contract for a newly reviewed Plan. The original v1 document, revisions, transcripts, ledger and proposal JSON remain unchanged. Existing `phase.*` refs typed as tournaments are refused, not converted. New native refs must use `entity_type: 'phase'`, match the Plan's league and pass the ownership reader. Missing contracts require reconfirmation. The contract is dormant data, not a new persisted column or an activated Plan editor; P5 must arrange fresh staging/review and provenance recording before using it.

With `READ_PHASE_STORAGE_STATE=true`, conversation creation, turn validation, staging and approve/resume use `ownershipRegistryVersion(rawRegistryVersion, generation)`. `legacy` and `frozen_legacy` use the raw version; `phase` and `frozen_phase` use the native namespace. After activation, old approvals and resumptions fail as `proposal_stale` without dispatching, and reopened cards remain readable without a token or an eligible Resume. This deliberately invalidates standalone pending cards too; fresh standalone cards still work. Both frozen modes refuse phase-dependent proposals before staging a card, claiming an approval or resuming. Native phase operations remain unavailable even with a current registry stamp. Before sending each approved route call the executor checks for an intervening mode change; the P6 database fence still owns the atomic write boundary. With the flag off, the legacy protocol, version, payloads and hashes are unchanged.

Actual operation assembly remains legacy-bound: `_ops/g/phase-create.ts` verifies tournament-backed phases and may call its enrollment repair; `start-phase.ts` dispatches `/api/generate-round/[tid]`; bracket and pin bindings also use legacy ownership reads. Native assembly must replace those reads, fingerprints, result refs, ledger entity kinds, undo facts and route bindings together. Merely changing a route template or renaming a tool does not activate a safe native operation. Eval fixtures must gain native phase rows and explicit child owners instead of treating phase ids as tournament ids.

Owner-level broadcast presets retain historical config and opaque `extra` unchanged. The dormant `createBroadcastPresetResourceResolver(buildUrl)` accepts an optional versioned explicit match-ref envelope, uses the shared actual-owner reconstruction under a live creator/owner check, and leaves old standalone/default configs on the old path. P5 supplies the canonical OBS URL callback; unknown extras never become phase ids. Player-agent `upcoming_match_id`, conversation tool input/output blobs and suggestion `match_id` remain legacy by default. Native player-agent contracts require a separate explicit match-ref context and native tools with live participant visibility and exclusive `phase_match_id` suggestion writes; the admin reader is not player authorization. No route or default dispatch is activated here.

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
- **Test Files**: `src/lib/ai/__tests__/` (19 test files): `client.test.ts` and `client.contract.test.ts` (the SDK wrapper and its request contract), `package-pins.test.ts` (the pinned SDK versions), `api-key.test.ts`, `format.test.ts`, `language.test.ts`, `league-context.test.ts`, `rate-limit.test.ts`, `context-builder.test.ts`, `parse-scouting.test.ts`, `tournament-report-context.test.ts`, `tournament-report-generator.test.ts`, `trigger.test.ts`, `ai-helpers.test.ts` and `artifact-state.test.ts`. The agent, the Admin Assistant and the Kale pipeline have their own `__tests__` under `src/lib/ai/agent/`, `src/lib/ai/admin-agent/` and `src/lib/ai/kale/`. Native phase coverage: `phase-analysis.test.ts`, `phase-context.test.ts`, `phase-report-generator.test.ts` and `phase-trigger.test.ts`.
- **Testing Approach**: Unit tests of the pure helpers (parsers, prompt builders, rate limit, key and language resolution) and the SDK wrapper with a mocked client; the AI routes are covered by their own route tests under `src/app/api/ai/`.

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
