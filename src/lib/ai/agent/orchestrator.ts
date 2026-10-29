/**
 * Agent orchestrator (PRD §3, §7) — the transport-agnostic `runAgent()` core.
 *
 * Given an {@link AgentRequest} (identity + persona + messages + context) it:
 *   1. loads/creates the player's memory (profile + conversation row),
 *   2. builds the per-player context pack and assembles the system prompt,
 *   3. wires the §5 LLM tools into a Vercel AI SDK tool map (dispatch flows
 *      through `executeTool`, so validation + the 5-minute result cache apply),
 *   4. selects the model tier chain and streams with the §2 fallback router,
 *   5. emits Braintrust telemetry when configured, and
 *   6. on finish, persists the turn (user + assistant + tool summary) and
 *      records a suggestion when the reply proposes a team.
 *
 * It returns the raw `streamText` result so any transport (the Next.js route,
 * a future Discord bot, a CLI) can adapt the stream, plus a metadata getter.
 * NO Next.js / HTTP / React types are imported here (PRD §1 Principle 4).
 */
import { tool, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import type { StepResult, LanguageModelUsage } from 'ai';
import { buildContextPack, renderContextPack } from './context-pack';
import { buildSystemPrompt } from './personas';
import { withOutputLanguage } from '../language';
import {
  appendMessages,
  conversationBelongsTo,
  createConversation,
  getOrCreateProfile,
  recordSuggestion,
} from './memory';
import {
  selectModels,
  streamWithFallback,
  streamFinalAnswer,
  type StreamResult,
  type StreamWithFallbackParams,
} from './model-router';
import { AGENT_TOOLS, LLM_TOOL_NAMES } from './tools/registry';
import { executeTool } from './tools/execute';
import type {
  AgentMessage,
  AgentPersona,
  AgentRequest,
  AgentResponseMetadata,
  AgentToolCall,
  AgentToolResult,
} from './types';
import type { Json } from '@/types/database';

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Multi-step tool loop bound (PRD §5). ai v6 uses `stopWhen: stepCountIs()`.
 * Teambuilding fans out across many tool calls (per-mon lookups + calcs +
 * validation), so it gets a larger budget; everyone else uses the default.
 */
const DEFAULT_MAX_STEPS = 8;
const MAX_STEPS_BY_PERSONA: Partial<Record<AgentPersona, number>> = {
  linden_teambuilding: 12,
};
function maxStepsFor(persona: AgentPersona): number {
  return MAX_STEPS_BY_PERSONA[persona] ?? DEFAULT_MAX_STEPS;
}

/**
 * Nudge for the forced final-answer turn (see `streamFinalAnswer`): when the
 * tool loop exhausts its step budget without trailing text, we re-ask the model
 * with this appended so it answers from what it already gathered.
 */
const FINAL_ANSWER_NUDGE =
  'You have used all available research steps and gathered tool results above. ' +
  'Do not call any more tools. Write your final answer to the user now, using the ' +
  'information already collected.';
/** Telemetry is on only when a Braintrust key is configured (PRD §9). */
const BRAINTRUST_ENABLED = (process.env.BRAINTRUST_API_KEY ?? '').trim().length > 0;
/** Cap the reasoning blob we persist on a suggestion row. */
const MAX_REASONING_CHARS = 4000;
/** Showdown-paste fingerprint used to detect a proposed team in free text. */
const SHOWDOWN_MARKERS = /(Ability:|EVs:|Tera Type:|\s@\s)/;

// ─── Result shape ────────────────────────────────────────────────────

export interface RunAgentResult {
  /** Settled `streamText` result — the route adapts via `toUIMessageStreamResponse()`. */
  result: StreamResult;
  /**
   * The winning model's text stream, replayable after the router has settled it
   * (ai v6 buffers the stream, so iterating this yields the full answer). Any
   * non-HTTP transport (CLI, smoke scripts) consumes the reply through here.
   */
  textStream: StreamResult['textStream'];
  /** Final response metadata (model, tier, escalations, tool-call count, usage). */
  getMetadata: () => AgentResponseMetadata;
  /** Alias of {@link getMetadata} for transports that read `metadata()`. */
  metadata: () => AgentResponseMetadata;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Map stored agent messages to AI SDK model messages (system is sent separately). */
function toModelMessages(messages: AgentMessage[]): ModelMessage[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

/** The most recent user message, as a 0-or-1 element array (for persistence). */
function latestUserMessage(messages: AgentMessage[]): AgentMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return [messages[i]];
  }
  return [];
}

/**
 * True when any message carries an image part (multi-modal content array).
 * Stored content is a string today, so this defends the vision path for when
 * a transport sends structured parts; it forces the T0-V model to the front.
 */
function hasImageParts(messages: AgentMessage[]): boolean {
  return messages.some((m) => {
    const content = (m as { content: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'image',
      )
    );
  });
}

/**
 * Tool names to wire for a persona. Everyone gets the 10 §5 LLM tools;
 * `linden_teambuilding` additionally gets the `buildTeam` meta-tool and
 * `createPokepaste` (PRD §4 persona table: "All tools + buildTeam"). Free-form
 * 10-tool assembly proved too heavy for the T0 models on full-team requests, so
 * teambuilding leans on the deterministic one-shot assembler instead.
 */
function toolNamesFor(persona: AgentPersona): readonly string[] {
  switch (persona) {
    case 'linden_teambuilding':
      return [...LLM_TOOL_NAMES, 'buildTeam', 'createPokepaste'];
    case 'linden_match_prep':
      // Match prep / post-match needs the actual game data, not just aggregates.
      return [...LLM_TOOL_NAMES, 'getMatchAnalysisContext'];
    default:
      return LLM_TOOL_NAMES;
  }
}

/** Server-authoritative context merged into LLM tool inputs (see {@link applyToolOverrides}). */
export interface ToolOverrides {
  /** Authenticated player id — the default subject for self-scoped match tools. */
  userId: string;
  /** Resolved effective league ruleset id, forced onto buildTeam/validateTeam. */
  rulesetId?: string | null;
  /** The player's assigned core types, forced onto buildTeam/validateTeam. */
  playerCore?: string[] | null;
  /** The resolved league's id, forced onto validateTeam (roster, core and Evolution Point Buy scope). */
  seasonId?: string | null;
}

/**
 * Merge server-resolved context into a tool's LLM-supplied input, returning a NEW
 * object (never mutate — the original is persisted in `tool_calls`):
 *   - buildTeam / validateTeam: force the resolved league `ruleset_id` and assigned
 *     `player_core`, so the team is always built/validated against the REAL league
 *     rules even if the model omits or mangles the id it was shown. Applied only
 *     when a ruleset/core actually resolved (the plain teambuilder leaves input as-is).
 *   - getMatchHistory / getUpcomingMatches: default `playerId` to the authenticated
 *     user when absent (the model is never told its own id), but never overwrite a
 *     supplied id (these also scout the opponent by their id).
 */
export function applyToolOverrides(
  name: string,
  input: unknown,
  overrides: ToolOverrides,
): unknown {
  const base: Record<string, unknown> =
    typeof input === 'object' && input !== null ? { ...(input as Record<string, unknown>) } : {};

  if (name === 'buildTeam' || name === 'validateTeam') {
    if (overrides.rulesetId) base.ruleset_id = overrides.rulesetId;
    if (overrides.playerCore && overrides.playerCore.length === 3) {
      base.player_core = overrides.playerCore;
    }
    if (name === 'validateTeam') {
      // Server-authoritative league scope: the model never names whose roster or which league is checked.
      base.player_id = overrides.userId;
      if (overrides.seasonId) {
        base.season_id = overrides.seasonId;
        // In a resolved league the assigned core is the server's: a model-supplied one is never trusted. With no core
        // assigned the field is dropped, so `checkTeam` reads (and reports) it from `season_participants`.
        if (overrides.playerCore && overrides.playerCore.length === 3) base.player_core = overrides.playerCore;
        else delete base.player_core;
      } else {
        delete base.season_id;
      }
    }
    return base;
  }

  if (name === 'getMatchAnalysisContext') {
    // The tool answers only for a match the authenticated player may see; the model cannot name another requester.
    base.requesterId = overrides.userId;
    return base;
  }

  if (name === 'getMatchHistory' || name === 'getUpcomingMatches') {
    if (base.playerId == null || base.playerId === '') base.playerId = overrides.userId;
    return base;
  }

  return input;
}

/** Build the persona's LLM tool map; every call dispatches through `executeTool`. */
function buildAgentToolSet(persona: AgentPersona, overrides: ToolOverrides): ToolSet {
  const set: ToolSet = {};
  for (const name of toolNamesFor(persona)) {
    const def = AGENT_TOOLS[name];
    set[name] = tool({
      description: def.description,
      // The model sees (and is validated against) its own schema; the strict one runs in executeTool after the overrides.
      inputSchema: def.modelInputSchema ?? def.inputSchema,
      execute: async (input: unknown) => {
        // Merge server-authoritative context BEFORE validation/cache so the cache
        // key and persisted call reflect the input that actually ran.
        const res = await executeTool(name, applyToolOverrides(name, input, overrides));
        // Surface tool errors to the model rather than throwing the run.
        return res.ok ? res.data : { error: res.error };
      },
    });
  }
  return set;
}

interface ToolActivity {
  calls: AgentToolCall[];
  results: AgentToolResult[];
  count: number;
}

/** Flatten tool calls/results across all steps for the persisted summary. */
function summariseToolActivity(steps: ReadonlyArray<StepResult<ToolSet>>): ToolActivity {
  const calls: AgentToolCall[] = [];
  const results: AgentToolResult[] = [];
  for (const step of steps) {
    for (const c of step.toolCalls ?? []) {
      calls.push({ id: c.toolCallId, name: c.toolName, input: c.input });
    }
    for (const r of step.toolResults ?? []) {
      results.push({ call_id: r.toolCallId, name: r.toolName, output: r.output });
    }
  }
  return { calls, results, count: calls.length };
}

/**
 * Detect a proposed team in the reply: either a `buildTeam` tool result in the
 * step list (the teambuilding persona calls it directly; other personas never
 * see it), or a fenced code block whose body looks like a Showdown paste.
 */
function detectProposedTeam(
  text: string,
  steps: ReadonlyArray<StepResult<ToolSet>>,
): Json | null {
  for (const step of steps) {
    for (const r of step.toolResults ?? []) {
      if (r.toolName === 'buildTeam' && r.output != null) {
        return r.output as Json;
      }
    }
  }
  const fences = text.match(/```[\s\S]*?```/g);
  if (fences) {
    for (const block of fences) {
      const inner = block.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '');
      if (SHOWDOWN_MARKERS.test(inner)) return inner.trim();
    }
  }
  return null;
}

/** Sum two usage records (original tool loop + the forced final-answer turn). */
function combineUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  const inputTokens = (a.inputTokens ?? 0) + (b.inputTokens ?? 0);
  const outputTokens = (a.outputTokens ?? 0) + (b.outputTokens ?? 0);
  return {
    ...a,
    inputTokens,
    outputTokens,
    totalTokens: (a.totalTokens ?? inputTokens) + (b.totalTokens ?? b.outputTokens ?? 0),
  };
}

/**
 * Expose the forced final-answer stream as the run's `result` while keeping the
 * ORIGINAL tool steps and the COMBINED usage. Consumers read the final answer
 * off `.text` / `.textStream` / `.toUIMessageStreamResponse()` (which belong to
 * the follow-up), but `.steps` (tool-call analysis) and `.totalUsage` come from
 * the merge. A Proxy keeps every other method/getter bound to the real result.
 */
function mergeFinalTurn(
  followup: StreamResult,
  steps: ReadonlyArray<StepResult<ToolSet>>,
  usage: LanguageModelUsage,
): StreamResult {
  return new Proxy(followup, {
    get(target, prop) {
      if (prop === 'steps') return Promise.resolve(steps);
      if (prop === 'totalUsage') return Promise.resolve(usage);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ─── runAgent ────────────────────────────────────────────────────────

export async function runAgent(request: AgentRequest): Promise<RunAgentResult> {
  const { userId, persona, messages, context } = request;

  // 1. Memory — profile + the conversation row this turn belongs to.
  const profile = await getOrCreateProfile(userId);

  // Continue an existing conversation only when the supplied id genuinely
  // belongs to this player under this persona; otherwise fall through to a
  // fresh row (a client must never append to someone else's thread).
  let conversationId: string | null = null;
  if (request.conversationId) {
    const owned = await conversationBelongsTo(request.conversationId, userId, persona);
    if (owned) conversationId = request.conversationId;
  }
  // A freshly created conversation is seeded with the request messages (which
  // already include the new user turn), so on finish we append only the reply.
  let seededWithUserMessages = false;
  if (!conversationId) {
    const created = await createConversation(userId, persona, messages);
    conversationId = created.id;
    seededWithUserMessages = true;
  }

  // 2. Context pack → system prompt (§8.1, §4).
  const pack = await buildContextPack(userId, context);
  const personaPrompt = buildSystemPrompt(persona, renderContextPack(pack));
  // Language line last (i18n-core §6.4); Kale stays English.
  const systemPrompt =
    request.outputLocale && persona !== 'kale'
      ? withOutputLanguage(personaPrompt, request.outputLocale)
      : personaPrompt;

  // 3. Tools + 4. model selection. The resolved league ruleset id + assigned core
  // are forced onto buildTeam/validateTeam (so a missing/mangled id can't drop the
  // build to unconstrained meta), and the authenticated id backs the match tools.
  const tools = buildAgentToolSet(persona, {
    userId,
    rulesetId: pack.league?.ruleset_id ?? null,
    playerCore: pack.league?.player_core ?? null,
    seasonId: pack.league?.season_id ?? null,
  });
  const needsVision = hasImageParts(messages);
  const models = selectModels(profile, needsVision);

  const params: StreamWithFallbackParams = {
    system: systemPrompt,
    messages: toModelMessages(messages),
    tools,
    stopWhen: stepCountIs(maxStepsFor(persona)),
    ...(BRAINTRUST_ENABLED
      ? { experimental_telemetry: { isEnabled: true, functionId: `agent-${persona}` } }
      : {}),
  };

  const { result, model, escalations } = await streamWithFallback(models, params);

  // 5/6. Finalize. The router fully settles the winning completion before it
  // returns, so this runs exactly once for the answer that won — using
  // `streamText`'s own `onFinish` would also fire for discarded escalation
  // attempts and double-persist. We read the (already-resolved) promises.
  let [finalText, steps, usage] = await Promise.all([
    result.text,
    result.steps,
    result.totalUsage,
  ]);

  let activity = summariseToolActivity(steps);

  // Guarantee a final text turn (PRD §5). The tool loop can consume its entire
  // step budget on tool calls and stop with no trailing text — the user would
  // see an empty reply. When that happens (text empty but tools were called),
  // re-ask the SAME winning model once with `toolChoice: 'none'`, feeding back
  // the assistant/tool messages it produced, so it answers from the gathered
  // results. The exposed `result`/`textStream` then carry that final text while
  // the original tool `steps` and combined usage are preserved for telemetry.
  let exposedResult = result;
  if (finalText.trim().length === 0 && activity.count > 0) {
    const responseMessages = (await result.response).messages;
    const followupParams: StreamWithFallbackParams = {
      ...params,
      messages: [
        ...toModelMessages(messages),
        ...(responseMessages as ModelMessage[]),
        { role: 'system', content: FINAL_ANSWER_NUDGE },
      ],
      stopWhen: stepCountIs(1),
    };
    const followup = streamFinalAnswer(model, followupParams);
    const [followupText, followupSteps, followupUsage] = await Promise.all([
      followup.text,
      followup.steps,
      followup.totalUsage,
    ]);

    finalText = followupText;
    steps = [...steps, ...followupSteps];
    usage = combineUsage(usage, followupUsage);
    // Tool activity stays the original loop's (the follow-up makes no calls).
    activity = summariseToolActivity(steps);
    exposedResult = mergeFinalTurn(followup, steps, usage);
  }

  const assistantMessage: AgentMessage = {
    role: 'assistant',
    content: finalText,
    ...(activity.calls.length ? { tool_calls: activity.calls } : {}),
    ...(activity.results.length ? { tool_results: activity.results } : {}),
  };

  const turn: AgentMessage[] = seededWithUserMessages
    ? [assistantMessage]
    : [...latestUserMessage(messages), assistantMessage];
  await appendMessages(conversationId, turn);

  const proposedTeam = detectProposedTeam(finalText, steps);
  if (proposedTeam !== null) {
    await recordSuggestion({
      playerId: userId,
      conversationId,
      contextFormat: context?.format ?? pack.format ?? '',
      matchId: context?.upcoming_match_id ?? null,
      proposedTeam,
      reasoning: finalText.slice(0, MAX_REASONING_CHARS),
    });
  }

  const metadata: AgentResponseMetadata = {
    model: model.id,
    tier: model.tier,
    escalations,
    tool_calls: activity.count,
    usage: {
      input_tokens: usage.inputTokens ?? 0,
      output_tokens: usage.outputTokens ?? 0,
    },
    conversation_id: conversationId,
    persona,
  };

  const getMetadata = () => metadata;
  return {
    result: exposedResult,
    textStream: exposedResult.textStream,
    getMetadata,
    metadata: getMetadata,
  };
}
