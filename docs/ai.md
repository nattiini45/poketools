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
- **Test Files**: `src/lib/ai/__tests__/` (14 test files): `client.test.ts` and `client.contract.test.ts` (the SDK wrapper and its request contract), `package-pins.test.ts` (the pinned SDK versions), `api-key.test.ts`, `format.test.ts`, `language.test.ts`, `league-context.test.ts`, `rate-limit.test.ts`, `context-builder.test.ts`, `parse-scouting.test.ts`, `tournament-report-context.test.ts`, `tournament-report-generator.test.ts`, `trigger.test.ts` and `ai-helpers.test.ts`. The agent, the Admin Assistant and the Kale pipeline have their own `__tests__` under `src/lib/ai/agent/`, `src/lib/ai/admin-agent/` and `src/lib/ai/kale/`.
- **Testing Approach**: Unit tests of the pure helpers (parsers, prompt builders, rate limit, key and language resolution) and the SDK wrapper with a mocked client; the AI routes are covered by their own route tests under `src/app/api/ai/`.

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
