# AI Agent System

> Multi-persona, tool-using competitive Pokémon assistant. Replaces the legacy single-shot AI on most surfaces.

## Overview

**Docs:** `docs/ai-agent.md`, `docs/ai.md`, `docs/teambuilder-editor.md` (the teambuilder AI panel)

The AI Agent is PokéTools' tool-using competitive assistant. One transport-agnostic core — `runAgent()` — backs every surface: the homepage chat widget, the teambuilder Assistant panel, match analysis cards, and admin tournament reports.

It runs a multi-step tool loop over a registry of deterministic tools (dex lookups, damage calc, usage stats, league data) and streams a final answer. Server-side only (Anthropic SDK + OpenAI-compatible providers).

## File Structure

```
src/lib/ai/agent/
├── orchestrator.ts        # runAgent: memory → context pack → tools → stream → persist
├── personas.ts            # buildSystemPrompt(persona, contextPackMd)
├── model-router.ts        # selectModels + streamWithFallback (live-verified escalation)
├── provider.ts            # AGENT_MODELS registry, env-keyed provider config
├── context-pack.ts        # Per-player context block
├── memory.ts              # Profile + conversation + suggestion CRUD
├── client-stream.ts       # Browser SSE → text adapter
├── eval/                  # Eval harness + golden set
├── prompts/
│   ├── base.ts            # Shared tool-usage policy
│   ├── linden.ts          # Teambuilding + match-prep prompts
│   └── kale.ts            # Tournament recap/forecast prompt
└── tools/
    ├── registry.ts        # AGENT_TOOLS, LLM_TOOL_NAMES
    ├── execute.ts         # executeTool: validation + 5-min LRU result cache
    ├── pkmn.ts            # Pokémon data lookups
    ├── calc.ts            # Damage calculator
    ├── validate.ts        # Team validation
    ├── smogon.ts          # Smogon usage/set data
    ├── supabase.ts        # League data queries
    ├── team-builder.ts    # Deterministic team builder
    ├── match-context.ts   # Match context injection
    └── pokepaste.ts       # Pokepaste import/export
```

## Personas

| Persona | Surfaces | Tools |
|---|---|---|
| `linden_teambuilding` | Homepage widget, teambuilder Assistant panel | 10 LLM tools + `buildTeam` + `createPokepaste` |
| `linden_match_prep` | Match analysis cards (`analyze-match`) | 10 LLM tools |
| `kale` | Admin tournament reports | 10 LLM tools |

### The 10 LLM tools
`lookupPokemon`, `getTypeChart`, `getLearnset`, `calculateDamage`, `validateTeam`, `getUsageStats`, `queryLeagueData`, `getMatchHistory`, `getUpcomingMatches`, `searchStrategyKnowledge`

## Model Routing

Default escalation order:
```
mimo-v2.6-pro (T0) → deepseek-v4-pro (T0) → minimax-m3 (T0-V vision) → claude-haiku-4-5 (T2) → claude-sonnet-4-6 (T2)
```

- Player's stored `model_priority` reorders this
- `AGENT_DEFAULT_MODEL` floats one ID to the front
- Only configured providers (API key present) remain in the chain
- Max 2 escalation hops; triggers: `rate_limit`, `tool_schema`, `empty_truncated`, `timeout`, `provider-auth`, `provider-error`

## Core Flow: `runAgent()`

```
Input (AgentRequest)
  ↓
Memory load (getOrCreateProfile → getRecentConversation)
  ↓
Context pack build (profile, matches, H2H, team, league ruleset + assigned core, scouting)
  ↓
System prompt assembly (base policy + persona prompt + context pack markdown)
  ↓
Tool loop (streamText with stepCountIs) → execute tools with 5-min LRU cache
  ↓
Fallback streaming (model escalation on failure)
  ↓
Forced final text turn if loop ends tool-only
  ↓
Persist conversation turn + optional agent_suggestions row
  ↓
Output: streamed UI-message response + X-Agent-Conversation-Id header
```

## League Awareness

When `context.upcoming_match_id` is present, `buildContextPack` resolves the match → tournament → season scope once and reuses it to:

1. Render the binding `## League ruleset` section (effective custom ruleset, bans, team constraints, assigned core)
2. Scope `recent_results` to the season's tournaments
3. Attach opponent scouting data (`getOpponentBattleStatsInTournament`)

The orchestrator then **forces** the resolved `ruleset_id` + `player_core` onto `buildTeam`/`validateTeam` and defaults player IDs on query tools — so builds are always validated against the real league rules.

## Conversation Continuity

- Routes echo the persisted conversation ID as `X-Agent-Conversation-Id` header
- Clients resend it as `conversation_id`
- Orchestrator only appends when `conversationBelongsTo(id, player, persona)` holds — otherwise forks a fresh row
- **Per-match isolation** is a client concern: `AiChatPanel` mounts under `key={matchId}` — navigating between match preps starts fresh

## Memory System

`src/lib/ai/agent/memory.ts` — Three tables:
- **Profile** — Player preferences, model priority, default persona
- **Conversations** — Message history per player-persona pair
- **Suggestions** — Agent-proposed team suggestions

`eval-` prefix on conversation IDs short-circuits all persistence to in-memory rows (for the eval harness).

## API Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ai/agent/chat` | POST | `requirePlayer()` + rate limit | Streamed chat (all personas) |
| `/api/ai/agent/analyze-match` | POST | Match-scoped | Match analysis (post_match / opponent_scout / threat_assessment) |
| `/api/ai/agent/tournament-report` | POST | `requireAdmin()` | Kale recap/forecast |
| `/api/ai/agent/team` | POST | — | Deterministic `buildTeam` (no LLM, structured JSON) |
| `/api/ai/agent/config` | GET/POST | `requirePlayer()` | Read/update `model_priority` + `default_persona` |

## Feature Flags

| Flag | Default | Controls |
|---|---|---|
| `NEXT_PUBLIC_AGENT_POST_MATCH` | `false` | Routes post-match analysis card through agent (`post_match`) |
| `NEXT_PUBLIC_AGENT_MATCH_ANALYSIS` | `false` | Routes scouting card (`opponent_scout`) through agent |

When flags are `false`, the legacy single-shot routes (`/api/ai/match-analysis`, `/api/ai/match-prep-analysis`) serve as rollback paths. The homepage widget and teambuilder Assistant are always on the agent path.

## Legacy AI (Single-Shot)

**Docs:** `docs/ai.md`, `docs/deprecations.md`

The legacy AI module (`src/lib/ai/`) provides single-shot match analysis, scouting, and tournament reports. It remains active as a rollback path:

- `/api/ai/match-analysis` — Post-match recap (legacy)
- `/api/ai/match-prep-analysis` — Pre-match scouting (legacy)
- `/api/ai/tournament-report` — Kale 2.0 pipeline

**Status:** Active but each has an agent counterpart. Do not remove until flag defaults flip and hard-removal is approved. `parseAnalysisResponse` (`src/lib/ai/parse-analysis.ts`) is shared by both paths.

## Rate Limiting

`src/lib/ai/rate-limit.ts` — Atomic Supabase RPC with `FOR UPDATE` locks. Per-player daily limit on agent chat. Match analysis has its own limits tied to match scope.

## Eval Harness

`src/lib/ai/agent/eval/` — Golden set evaluation for agent quality. Uses `eval-` prefix conversations to avoid persisting test data.
