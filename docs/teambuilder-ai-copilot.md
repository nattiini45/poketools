# Teambuilder AI Co-Pilot Module

### Overview

Three-tier AI assistant integrated into the Teambuilder editor. Provides slot-level suggestions inside the SetEditorModal, team-level commentary in the AiCoPilotPanel, and monotype team generation when the active ruleset requires it. All tiers are rate-limited per player per day via the existing `src/lib/ai/rate-limit.ts` infrastructure.

### File Structure

- **Main Entry Point**: `src/lib/ai/co-pilot.ts`
- **Prompts**: `src/lib/ai/prompts/`
- **API Routes**: `src/app/api/teams/co-pilot/`
- **UI**: `src/components/teambuilder/v3/editor/AiCoPilotPanel.tsx`

```
src/lib/ai/
├── co-pilot.ts                     Co-pilot orchestrator (prompt builder + response parser)
├── prompts/
│   ├── slot-coach.ts               System prompt + Zod schema for slot-level suggestions
│   ├── team-coach.ts               System prompt + Zod schema for team-level commentary
│   └── monotype-builder.ts         System prompt + Zod schema for monotype core generation
├── client.ts                       Anthropic SDK wrapper (existing)
└── rate-limit.ts                   Rate limiting (extended with 3 new endpoint keys)

src/app/api/teams/co-pilot/
├── slot/route.ts                   POST — slot-level suggestions
├── team/route.ts                   POST — team-level commentary
└── monotype/route.ts               POST — monotype core generation
```

### Core Functions/Classes

- **`buildSlotCoachPrompt(set, ruleset?, format?)`**: Builds the system + user prompt for slot-level coaching. Includes the current `PokemonSet`, legal moves/items/abilities from the ruleset, and format usage stats.
- **`parseSlotCoachResponse(raw)`**: Zod-validates the LLM response into `{ suggestions: { kind: 'move' | 'item' | 'ability' | 'spread' | 'note', text: string, patch?: Partial<PokemonSet> }[] }`.
- **`buildTeamCoachPrompt(team, ruleset?, format?, opponentTeam?)`**: Builds the prompt for team-level commentary. Includes all 6 sets, the ruleset, and optionally the opponent's roster.
- **`parseTeamCoachResponse(raw)`**: Zod-validates into `{ headline: string, comments: { kind: 'strength' | 'weakness' | 'coverage' | 'speed' | 'synergy', text: string, slot_index?: number }[] }`.
- **`buildMonotypePrompt(ruleset?, format?, existingTeam?)`**: Builds the prompt for monotype core generation.
- **`parseMonotypeResponse(raw)`**: Zod-validates into `{ suggestions: { type: string, core: PokemonSet[], reasoning: string }[] }`.

### Data Flows

**Tier 1 — Slot-level** (`POST /api/teams/co-pilot/slot`):
1. User clicks "Suggest improvements" inside `SetEditorModal`.
2. Frontend sends `{ set: PokemonSet, ruleset_id?, format: string }`.
3. Server calls `buildSlotCoachPrompt` → Anthropic SDK → `parseSlotCoachResponse`.
4. Returns structured suggestions. Each has optional `patch` for one-click apply.

**Tier 2 — Team-level** (`POST /api/teams/co-pilot/team`):
1. Auto fire-and-forget on Plan Team save, or manual "Refresh" button in `AiCoPilotPanel`.
2. Frontend sends `{ team: PokemonSet[], ruleset_id?, format: string, opponent_team?: PokemonSet[] }`.
3. Server calls `buildTeamCoachPrompt` → Anthropic SDK → `parseTeamCoachResponse`.
4. Returns headline + per-slot comments (strengths/weaknesses/coverage/speed/synergy).

**Tier 3 — Match-level**:
- Uses existing `POST /api/ai/match-prep-analysis`. No new endpoint. Surfaced as a "View scouting report" link in the AI panel.

**Monotype** (`POST /api/teams/co-pilot/monotype`):
1. Only triggered when ruleset is monotype (detection rule: `ruleset.team_constraints?.type_quotas?.source === 'fixed'` or `ruleset.min_shared_type_pct > 0`).
2. Returns up to 3 suggested monotype cores with reasoning.
3. One-click "Build team" applies the core to the editor.

### Dependencies

- **External**: `@anthropic-ai/sdk` (via `src/lib/ai/client.ts`), `zod`
- **Internal**: `src/lib/ai/client.ts`, `src/lib/ai/rate-limit.ts`, `src/lib/ai/context-builder.ts`, `src/lib/pkmn/validation.ts`, `src/lib/pkmn/formats.ts`

### API Routes

| Endpoint | Method | Auth | Rate Limit | Purpose |
|----------|--------|------|------------|---------|
| `/api/teams/co-pilot/slot` | POST | `requirePlayer()` | `team-slot-coach` (30/day) | Slot-level suggestions |
| `/api/teams/co-pilot/team` | POST | `requirePlayer()` | `team-coach` (10/day) | Team-level commentary |
| `/api/teams/co-pilot/monotype` | POST | `requirePlayer()` | `monotype-builder` (5/day) | Monotype core generation |

All endpoints use `safeErrorResponse()` for error handling. Responses are not streamed (short, sub-2s latency target).

### Usage Examples

```typescript
// Inside SetEditorModal — slot coach
const suggestions = await fetch('/api/teams/co-pilot/slot', {
  method: 'POST',
  body: JSON.stringify({ set: currentSet, ruleset_id: rulesetId, format: 'gen9ou' }),
});

// AiCoPilotPanel — team coach (auto on Plan Team save)
void fetch('/api/teams/co-pilot/team', {
  method: 'POST',
  body: JSON.stringify({ team: teamPokemon, ruleset_id: rulesetId, format: 'gen9ou' }),
});

// Monotype builder
const cores = await fetch('/api/teams/co-pilot/monotype', {
  method: 'POST',
  body: JSON.stringify({ ruleset_id: rulesetId, format: 'gen9monotype' }),
});
```

### Testing

- **Slot coach endpoint**: `src/app/api/teams/co-pilot/slot/__tests__/slot.test.ts` — auth, rate limit, Zod-parsed output, malformed LLM response handling.
- **Team coach endpoint**: `src/app/api/teams/co-pilot/team/__tests__/team.test.ts` — auth, rate limit, with/without opponent team.
- **Monotype endpoint**: `src/app/api/teams/co-pilot/monotype/__tests__/monotype.test.ts` — non-monotype ruleset rejection, valid response, rate limit.
- **Prompt parsers**: Unit tests for `parseSlotCoachResponse`, `parseTeamCoachResponse`, `parseMonotypeResponse` — valid input, invalid input, edge cases.

### Related Modules

- AI Module (`src/lib/ai/`) - client, rate-limit, context-builder
- Teambuilder Editor Module - `AiCoPilotPanel`, `SetEditorModal`
- PKMN Module - format mapping, validation

### Notes

- The `AiEndpoint` union in `src/lib/ai/rate-limit.ts` is extended with `'team-slot-coach' | 'team-coach' | 'monotype-builder'`.
- `AI_SLOT_COACH_DAILY_LIMIT` env var (default 30) controls the slot coach daily cap. Added to `.env.example`.
- Slot coach responses are intentionally not streamed — they are short (sub-2s target). Match-prep-analysis (Tier 3) retains streaming for longer reports.
- Monotype detection rule: `ruleset.team_constraints?.type_quotas?.source === 'fixed' || ruleset.min_shared_type_pct > 0`. This may need adjustment as new ruleset types are added.
