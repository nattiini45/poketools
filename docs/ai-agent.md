# AI Agent Module

### Overview

The AI Agent is PokéTools' multi-persona, tool-using competitive assistant. Unlike the legacy single-shot AI module (`docs/ai.md`), the agent runs a multi-step tool loop over a registry of deterministic tools (dex lookups, damage calc, usage stats, league data) and streams a final answer. One transport-agnostic core — `runAgent()` — backs every surface: the [homepage chat widget](./public-site.md#agent-chat-widget), the teambuilder Assistant panel, match analysis cards, and admin tournament reports.

It is server-side only (Anthropic SDK + OpenAI-compatible providers), per the AI hard rule in `CLAUDE.md`.

The **Admin Assistant** (`src/lib/ai/admin-agent/`, spec section 18 of [the PokéTools spec](./poketools-spec.md)) is a separate system with its own loop, registry and tables; it reuses nothing of this agent.

### File Structure

- **Main Entry Point**: `src/lib/ai/agent/orchestrator.ts` (`runAgent`)
- **Key Subdirectories**: `prompts/` (persona system prompts), `tools/` (tool registry + dispatch + per-domain tools), `__tests__/`

```
src/lib/ai/agent/
├── orchestrator.ts        # runAgent: memory → context pack → tools → stream → persist
├── personas.ts            # buildSystemPrompt(persona, contextPackMd)
├── model-router.ts        # selectModels + streamWithFallback (live-verified escalation)
├── provider.ts            # AGENT_MODELS registry, env-keyed provider config
├── context-pack.ts        # per-player context block (profile, matches, H2H, team, league ruleset + assigned core, league-scoped record, self/opponent scouting)
├── memory.ts              # profile + conversation + suggestion CRUD (3 tables)
├── client-stream.ts       # browser SSE → text adapter (surfaces conversation id)
├── eval/                  # §8.4 eval harness + golden set
├── prompts/
│   ├── base.ts            # shared tool-usage policy
│   ├── linden.ts          # teambuilding + match-prep prompts & message builders
│   └── kale.ts            # tournament recap/forecast prompt & message builder
└── tools/
    ├── registry.ts        # AGENT_TOOLS, LLM_TOOL_NAMES
    ├── execute.ts         # executeTool: validation + 5-min result cache (LruCache.getEntry so a cached `undefined` counts as a hit, not a miss)
    └── *.ts               # pkmn, calc, validate, smogon, supabase, team-builder, pokepaste
```

### Core Functions/Classes

- **`runAgent(request: AgentRequest): Promise<RunAgentResult>`** — the core loop. Loads/creates the player's memory, builds the context pack + system prompt, wires the persona's tools, streams with the fallback router, guarantees a final text turn, persists the turn, and records a team suggestion when one is proposed. Returns the settled `streamText` result, a replayable `textStream`, and a `getMetadata()` reader (model, tier, escalations, tool-call count, usage, `conversation_id`, persona). No HTTP/React types.
- **`selectModels(profile, needsVision)` / `streamWithFallback(models, params)`** — model ordering (stored priority → vision float → configured filter) and the §2 escalation chain (max 2 hops; triggers: rate_limit, tool_schema, empty_truncated, timeout, provider-auth, provider-error).
- **`buildSystemPrompt(persona, contextPackMd)`** — composes base policy + persona prompt + rendered context pack.
- **Memory CRUD** (`memory.ts`): `getOrCreateProfile`, `updateProfileConfig`, `getRecentConversation`, `createConversation`, `appendMessages`, `conversationBelongsTo`, `recordSuggestion`. An `eval-` id prefix short-circuits all persistence to in-memory rows (dry-run for the eval harness).

### Personas

| Persona | Used by | Tools |
|---------|---------|-------|
| `linden_teambuilding` | Homepage widget, teambuilder Assistant panel | 10 LLM tools + `buildTeam` + `createPokepaste` |
| `linden_match_prep` | Match analysis cards (`analyze-match`) | 10 LLM tools |
| `kale` | Admin tournament reports | 10 LLM tools |

The 10 LLM tools: `lookupPokemon`, `getTypeChart`, `getLearnset`, `calculateDamage`, `validateTeam`, `getUsageStats`, `queryLeagueData`, `getMatchHistory`, `getUpcomingMatches`, `searchStrategyKnowledge`.

### Models (default escalation order)

`mimo-v2.6-pro` (T0) → `deepseek-v4-pro` (T0) → `minimax-m3` (T0-V vision) → `claude-haiku-4-5` (T2) → `claude-sonnet-4-6` (T2). A player's stored `model_priority` reorders this; `AGENT_DEFAULT_MODEL` floats one id to the front of the built-in registry. Only configured providers (API key + base URL, or `ANTHROPIC_API_KEY` for Anthropic) remain in the chain.

### Data Flows

- **Input**: `AgentRequest` — `userId`, `persona`, `messages[]`, optional `context` (`upcoming_match_id` / `format` / `team_id` / `core_pokemon`), optional `conversationId`.
- **Processing**: memory load → context pack → system prompt → tool loop (`stepCountIs`) → fallback streaming → forced final answer if the loop ends tool-only.
- **Output**: streamed UI-message response; persisted assistant turn; optional `agent_suggestions` row; metadata via `getMetadata()`.

**Conversation continuity**: routes echo the persisted id as the `X-Agent-Conversation-Id` response header. `streamAgentText` surfaces it; clients resend it as `conversation_id`. The orchestrator only appends to a supplied id when `conversationBelongsTo(id, player, persona)` holds — otherwise it forks a fresh row. Per-match isolation is a **client** concern: the teambuilder mounts `AiChatPanel` under `key={matchId}` (and `MatchPrepClient` mounts `TeamsEditor` under `key={matchId}`), so navigating between match preps discards the prior thread + `conversation_id` and starts a fresh instance rather than continuing the previous match's chat.

**League awareness (plan mode)**: when `context.upcoming_match_id` (or `ruleset_id`) is present, `buildContextPack` resolves the match → tournament → season scope **once** (`resolveLeagueScope`) and reuses it to: (1) render the binding `## League ruleset` section incl. the ruleset the phase **pins** (its id, name and version number), clauses, bans (banned abilities too), allowlists (`renderAllowlists`: the legal entries of a roster or Little Cup category), unbans, team constraints and the player's assigned core; (2) scope `recent_results` to the season's tournaments (groups + playoffs) so the record reflects *this* league, not every league played; (3) attach the player's own and the opponent's recent Pokémon (`getOpponentBattleStatsInTournament`). The orchestrator then **forces** the resolved `ruleset_id` + `player_core` onto `buildTeam`/`validateTeam` and defaults `getMatchHistory`/`getUpcomingMatches` `playerId` to the authenticated user (`applyToolOverrides`) — so a build is always validated against the real league rules even if the model omits/mangles the id, and the assistant can scout without being told its own player id. `buildTeam` sets `ruleset_load_failed` (not a silent meta fallback) when a supplied ruleset can't load.

### Dormant native player contracts

`native-context.ts` accepts only `{generation:'native-phase-v1', match:{resource:'match', owner:{kind:'phase', seasonId, phaseId}, id}}`. The separate `buildNativePlayerContext` entry point does not widen `AgentContext.upcoming_match_id`, change `buildContextPack` or activate native generation. It authenticates with live `requirePlayer()` on every call, requires the actual match participant and current native phase enrollment, and checks match → round → phase → existing league ownership. Nonparticipant site admins, creators and resource admins receive no player-preparation access through this boundary; admin operation ownership is a separate contract. Missing owners and read failures throw, with no legacy-table fallback or synthetic tournament.

The pack projects explicit owners, league/phase/round names, the immutable phase ruleset pin, assigned core, the player's own preparation and native-only completed history. History and H2H are phase-scoped samples of at most 20 matches in stable date/id order with exact total and `truncated`; they are not all-time records or league-wide aggregate counts. The query selects no admin notes, confirmation identity or private player fields. Team projection always uses a non-admin viewer: own prep is read by both match and player, opponent prep is never read, and registered opponent rosters follow `decideMatchRosterVisibility`. Hidden planned rosters never reach the model. No replay, provider or model call is made by these helpers.

`tools/native-player.ts` exports a separate `createNativePlayerTools(context)` assembly for context, history, H2H and teams. The server binds the explicit reference; each tool has an empty strict model input, no identity override and no cache, and repeats live authorization when invoked. The existing registry, executor, orchestrator and their call arities remain unchanged. P5 must deliberately select these tools and the native pack together, bind identity at the authenticated transport, and enforce the resolved pin/core when adding any generation/build tools. Do not combine this assembly with legacy match/history tools.

`native-memory.ts` exposes `recordNativePlayerSuggestion` only for fresh explicit native inputs. It rechecks live match/enrollment access, conversation ownership/persona/archive state and the current pinned format, then inserts `phase_match_id` with `match_id:null` through `queries/agent-suggestions.ts`. It accepts no caller player id or legacy match id. The legacy `memory.recordSuggestion` contract and standalone pointer behavior are unchanged. Conversation messages, tool input/results, existing suggestions and opaque proposed-team JSON are never renamed or upgraded. This is not a pending-acceptance or team-write binding: P5 must require a fresh server-controlled native generation/ref at acceptance and revalidate it, or refuse/reconfirm old pending suggestions rather than infer their store from an id or JSON field. Existing conversation blobs must not be replayed as typed native tool authority.

No route, default registry, native-generation flag or pending-suggestion acceptance consumer selects these contracts. Parent integration/CI owns application-wide verification and later binding.

### Dependencies

- **External**: `ai` (Vercel AI SDK v6 — `streamText`, `tool`, `stepCountIs`), `@ai-sdk/openai` (OpenAI-compatible providers), `@anthropic-ai/*` via `@ai-sdk`, `@pkmn/*` (through the tool layer).
- **Internal**: `lib/ai/rate-limit`, `lib/supabase/*` (memory + context-pack queries), `lib/pkmn/*` and `lib/match/*` (tools), `components/agent/*` (chat UI).

### API Routes

- **POST `/api/ai/agent/chat`** — streamed chat. Auth: `requirePlayer()` + daily rate limit. Body: `agentChatSchema` (`messages`, `persona`, optional `conversation_id`, `context`). Response: UI-message SSE + `X-Agent-Conversation-Id` header.
- **POST `/api/ai/agent/analyze-match`** — `linden_match_prep` match analysis (post_match / opponent_scout / threat_assessment). Auth mirrors the legacy match-analysis/match-prep rules.
- **POST `/api/ai/agent/tournament-report`** — `kale` recap/forecast. Auth: `requireAdmin()`.
- **POST `/api/ai/agent/team`** — deterministic one-shot `buildTeam` (no LLM). Returns structured JSON.
- **GET / POST `/api/ai/agent/config`** — read/update the player's `model_priority` + `default_persona`. GET also returns `available_models` (id + tier). POST validates every model id against `AGENT_MODELS`.

### Usage Examples

```typescript
import { runAgent } from '@/lib/ai/agent/orchestrator';

const { result, getMetadata } = await runAgent({
  userId: player.playerId,
  persona: 'linden_teambuilding',
  messages: [{ role: 'user', content: 'Build me a gen9ou balance team.' }],
  context: { format: 'gen9ou' },
});
const conversationId = getMetadata().conversation_id;
return result.toUIMessageStreamResponse(
  conversationId ? { headers: { 'X-Agent-Conversation-Id': conversationId } } : undefined,
);
```

### Feature Flags

- `NEXT_PUBLIC_AGENT_POST_MATCH` — routes the **post-match analysis** card through the agent (`post_match`). The agent persists the SAME structured `MatchAnalysisContent` the cards render — deterministic match context (battle stats, team sheets, league rules, and an attributed turn-by-turn that names who set each weather/terrain) is injected via `gatherMatchContext`, and the agent may enrich with its tools (incl. `getMatchAnalysisContext`) — so the cards + per-match cache are unchanged. false = legacy `/api/ai/match-analysis` (the rollback path).
- `NEXT_PUBLIC_AGENT_MATCH_ANALYSIS` — routes the **scouting** card (`opponent_scout`) through the agent endpoint. Like post-match, the agent persists the SAME structured `MatchPrepAnalysisContent` the card renders — the deterministic, perspective-scoped scouting context (league rules, format, meta, opponent history/team/type analysis, the player's planned team) is injected via `gatherMatchPrepContext`, the agent may enrich with its tools (`getMatchHistory`, `getUsageStats`, `calculateDamage`, `searchStrategyKnowledge`), and the per-`(match, player)` cache is unchanged. The `hasUserTeam` flag selects the schema branch (`matchup_analysis` vs `suggested_picks`). false = legacy `/api/ai/match-prep-analysis` (the rollback path). Split from post-match so the two cards cut over independently. The `threat_assessment` flavour stays free-text (no structured card consumes it).
- The [homepage widget](./public-site.md) and the teambuilder Assistant panel are always on the agent path.

### Eval Harness

`scripts/agent-eval.ts` (scoring in `src/lib/ai/agent/eval-scoring.ts`, cases in `src/lib/ai/agent/__tests__/evals/golden-set.ts`) runs the agent end-to-end against a golden set using `eval-<modelId>` dry-run ids (no DB writes, no `players` FK). The id suffix becomes the sole `model_priority` entry so a chosen model leads while the real escalation chain still falls through (lets the harness measure escalation rate). Run it with the script above.

### Testing

- **Test Files**: `src/lib/ai/agent/__tests__/` (orchestrator, model-router, personas, context-pack, memory), `src/lib/ai/agent/tools/__tests__/`, route tests under `src/app/api/ai/agent/*/__tests__/`, and `src/components/agent/__tests__/`.
- **Key Test Cases**: append-vs-create + ownership guard, forced final-answer turn, suggestion detection, fallback escalation, tool schema validation, `X-Agent-Conversation-Id` header.
- **Running**: `npm run test`.

### Related Modules

- **AI** (`ai.md`) — legacy single-shot analysis the agent paths shadow (flagged cutover; see `deprecations.md`).
- **PKMN / Match / Supabase** — backing data for the tool layer and context pack.
- **Teambuilder Editor (v3)** — hosts the Assistant panel; the `EditorCommandApi` seam applies agent-proposed Showdown sets to slots.

### Notes

- AI stays server-side; `client-stream.ts` is the only browser-facing piece and pulls in no `ai` dependency.
- Rate limiting is shared across chat / analyze-match / tournament-report under the `agent-chat` key (`AGENT_DAILY_LIMIT`).
