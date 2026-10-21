import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRequest } from '../types';

// ─── Mocks ───────────────────────────────────────────────────────────
// `personas` / `prompts` are left REAL so we can assert the system prompt is
// genuinely assembled from the base + persona + rendered context pack.

vi.mock('../context-pack', () => ({
  buildContextPack: vi.fn(async () => ({
    player_id: 'p1',
    format: 'gen9ou',
    profile: null,
    upcoming_matches: null,
    recent_results: null,
    head_to_head: null,
    active_team: null,
    league: null,
  })),
  renderContextPack: vi.fn(() => '## Player context\n- Profile — favourites: Garchomp'),
}));

vi.mock('../memory', () => ({
  getOrCreateProfile: vi.fn(async () => ({
    player_id: 'p1',
    model_priority: ['deepseek-v4-pro'],
    default_persona: 'linden_teambuilding',
  })),
  conversationBelongsTo: vi.fn(async () => true),
  createConversation: vi.fn(async () => ({ id: 'conv-1' })),
  appendMessages: vi.fn(async () => ({ id: 'conv-1' })),
  recordSuggestion: vi.fn(async () => ({ id: 'sug-1' })),
}));

// Keep the real exports (notably `AgentExhaustedError`) but stub the two
// functions the orchestrator drives.
vi.mock('../model-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model-router')>();
  return {
    ...actual,
    selectModels: vi.fn(),
    streamWithFallback: vi.fn(),
    streamFinalAnswer: vi.fn(),
  };
});

vi.mock('../tools/execute', () => ({
  executeTool: vi.fn(async () => ({ ok: true, data: { stub: true } })),
}));

import { runAgent, applyToolOverrides } from '../orchestrator';
import { outputLanguageInstruction } from '../../language';
import {
  selectModels,
  streamWithFallback,
  streamFinalAnswer,
  AgentExhaustedError,
} from '../model-router';
import {
  appendMessages,
  conversationBelongsTo,
  createConversation,
  getOrCreateProfile,
  recordSuggestion,
} from '../memory';

// ─── Fixtures ────────────────────────────────────────────────────────

const MODEL = { id: 'deepseek-v4-pro', tier: 'T0', provider: 'deepseek', modelName: 'deepseek-v4-pro' };

/** Captured `streamText` params handed to the (mocked) router. */
let capturedParams: Record<string, unknown> = {};

/** Async-iterable text stream that replays the buffered answer (as ai v6 does). */
function replayStream(text: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      yield text;
    },
  };
}

function fakeStreamResult(
  text: string,
  steps: unknown[] = [],
  responseMessages: unknown[] = [],
) {
  return {
    text: Promise.resolve(text),
    steps: Promise.resolve(steps),
    totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
    response: Promise.resolve({ messages: responseMessages }),
    textStream: replayStream(text),
    toUIMessageStreamResponse: () => new Response('stream'),
  };
}

function setReply(text: string, steps: unknown[] = []) {
  vi.mocked(streamWithFallback).mockImplementation((async (models: unknown[], params: unknown) => {
    capturedParams = params as Record<string, unknown>;
    return { result: fakeStreamResult(text, steps), model: models[0], escalations: [] };
  }) as never);
}

const baseRequest = (): AgentRequest => ({
  userId: 'p1',
  persona: 'linden_teambuilding',
  messages: [{ role: 'user', content: 'Build me a gen9ou team.' }],
  context: { format: 'gen9ou' },
});

beforeEach(() => {
  vi.clearAllMocks();
  capturedParams = {};
  vi.mocked(selectModels).mockReturnValue([MODEL] as never);
  setReply('Here is a solid balance team.');
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('runAgent', () => {
  it('assembles the system prompt from base + persona + context pack', async () => {
    await runAgent(baseRequest());

    const system = capturedParams.system as string;
    expect(system).toContain('Tool-usage policy'); // base
    expect(system).toContain('Mode: Teambuilding'); // persona
    expect(system).toContain('## Player context'); // rendered pack
    expect(system).toContain('favourites: Garchomp');
  });

  it('appends the output-language line last when an outputLocale is given (i18n-core §6.4)', async () => {
    await runAgent(baseRequest());
    const plain = capturedParams.system as string;

    await runAgent({ ...baseRequest(), outputLocale: 'de' });
    expect(capturedParams.system).toBe(`${plain}\n\n${outputLanguageInstruction('de')}`);

    await runAgent({ ...baseRequest(), outputLocale: 'en' });
    expect(capturedParams.system).toBe(`${plain}\n\n${outputLanguageInstruction('en')}`);
  });

  it('keeps the kale persona English whatever outputLocale says', async () => {
    await runAgent({ ...baseRequest(), persona: 'kale' });
    const plain = capturedParams.system as string;

    await runAgent({ ...baseRequest(), persona: 'kale', outputLocale: 'de' });
    expect(capturedParams.system).toBe(plain);
    expect(capturedParams.system).not.toContain('German');
  });

  it('registers the teambuilding tool set (10 LLM tools + buildTeam + createPokepaste) and bounds the step loop', async () => {
    await runAgent(baseRequest()); // persona: linden_teambuilding

    const tools = capturedParams.tools as Record<string, unknown>;
    expect(Object.keys(tools)).toHaveLength(12);
    expect(tools).toHaveProperty('lookupPokemon');
    expect(tools).toHaveProperty('calculateDamage');
    expect(tools).toHaveProperty('buildTeam'); // meta-tool: teambuilding only
    expect(tools).toHaveProperty('createPokepaste');
    expect(capturedParams.stopWhen).toBeDefined();
  });

  it('registers the 10 LLM tools + getMatchAnalysisContext for the match-prep persona', async () => {
    await runAgent({ ...baseRequest(), persona: 'linden_match_prep' });

    const tools = capturedParams.tools as Record<string, unknown>;
    expect(Object.keys(tools)).toHaveLength(11);
    expect(tools).toHaveProperty('lookupPokemon');
    expect(tools).toHaveProperty('getMatchAnalysisContext'); // match data, match-prep only
    expect(tools).not.toHaveProperty('buildTeam'); // meta-tool excluded
    expect(tools).not.toHaveProperty('createPokepaste');
  });

  it('registers exactly the 10 base LLM tools for other personas (kale)', async () => {
    await runAgent({ ...baseRequest(), persona: 'kale' });

    const tools = capturedParams.tools as Record<string, unknown>;
    expect(Object.keys(tools)).toHaveLength(10);
    expect(tools).toHaveProperty('lookupPokemon');
    expect(tools).not.toHaveProperty('getMatchAnalysisContext');
    expect(tools).not.toHaveProperty('buildTeam');
  });

  it('creates a conversation and persists the assistant reply on finish', async () => {
    const { getMetadata } = await runAgent(baseRequest());

    expect(getOrCreateProfile).toHaveBeenCalledWith('p1');
    expect(createConversation).toHaveBeenCalledTimes(1);
    // New conversation seeded with the user turn → only the reply is appended.
    expect(appendMessages).toHaveBeenCalledTimes(1);
    const [convId, appended] = vi.mocked(appendMessages).mock.calls[0];
    expect(convId).toBe('conv-1');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ role: 'assistant', content: 'Here is a solid balance team.' });

    const meta = getMetadata();
    expect(meta.model).toBe('deepseek-v4-pro');
    expect(meta.conversation_id).toBe('conv-1');
    expect(meta.tool_calls).toBe(0);
    expect(meta.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it('appends user + assistant when continuing an existing conversation it owns', async () => {
    vi.mocked(conversationBelongsTo).mockResolvedValueOnce(true);
    await runAgent({ ...baseRequest(), conversationId: 'conv-existing' });

    expect(conversationBelongsTo).toHaveBeenCalledWith('conv-existing', 'p1', 'linden_teambuilding');
    expect(createConversation).not.toHaveBeenCalled();
    const [convId, appended] = vi.mocked(appendMessages).mock.calls[0];
    expect(convId).toBe('conv-existing');
    expect(appended).toHaveLength(2);
    expect(appended[0].role).toBe('user');
    expect(appended[1].role).toBe('assistant');
  });

  it('forks a fresh conversation when the supplied id is not owned by this player+persona', async () => {
    vi.mocked(conversationBelongsTo).mockResolvedValueOnce(false);
    const { getMetadata } = await runAgent({ ...baseRequest(), conversationId: 'someone-elses' });

    // Did not append to the foreign id — created a new row and seeded it instead.
    expect(createConversation).toHaveBeenCalledTimes(1);
    const [convId, appended] = vi.mocked(appendMessages).mock.calls[0];
    expect(convId).toBe('conv-1');
    expect(appended).toHaveLength(1);
    expect(appended[0].role).toBe('assistant');
    expect(getMetadata().conversation_id).toBe('conv-1');
  });

  it('records a suggestion when the reply contains a Showdown paste', async () => {
    setReply(
      'Here you go:\n```\nGarchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 Def / 252 Spe\n- Earthquake\n```',
    );

    await runAgent(baseRequest());

    expect(recordSuggestion).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(recordSuggestion).mock.calls[0][0];
    expect(arg.conversationId).toBe('conv-1');
    expect(arg.contextFormat).toBe('gen9ou');
    expect(String(arg.proposedTeam)).toContain('Garchomp @ Choice Scarf');
  });

  it('records a suggestion from a buildTeam tool result in the steps', async () => {
    setReply('Built it.', [
      { toolCalls: [], toolResults: [{ toolCallId: 't1', toolName: 'buildTeam', output: { team: [] } }] },
    ]);

    await runAgent(baseRequest());

    expect(recordSuggestion).toHaveBeenCalledTimes(1);
  });

  it('does not record a suggestion for a plain text reply', async () => {
    setReply('Garchomp is weak to Ice, Dragon, and Fairy.');

    await runAgent(baseRequest());

    expect(recordSuggestion).not.toHaveBeenCalled();
  });

  it('counts tool calls across all steps in the metadata', async () => {
    setReply('Done.', [
      {
        toolCalls: [{ toolCallId: 'c1', toolName: 'lookupPokemon', input: { species: 'Garchomp' } }],
        toolResults: [{ toolCallId: 'c1', toolName: 'lookupPokemon', output: { ok: true } }],
      },
      {
        toolCalls: [{ toolCallId: 'c2', toolName: 'getTypeChart', input: { types: ['Dragon'] } }],
        toolResults: [{ toolCallId: 'c2', toolName: 'getTypeChart', output: {} }],
      },
    ]);

    const { getMetadata } = await runAgent(baseRequest());
    expect(getMetadata().tool_calls).toBe(2);
  });

  it('resolves a consumable textStream and a metadata() reader (transport contract)', async () => {
    setReply('Pikachu is an Electric-type.');

    const res = await runAgent(baseRequest());

    // The replayable stream is defined and yields the winning answer.
    expect(res.textStream).toBeDefined();
    let chars = 0;
    for await (const chunk of res.textStream) chars += chunk.length;
    expect(chars).toBe('Pikachu is an Electric-type.'.length);

    // `metadata()` mirrors `getMetadata()` for non-HTTP transports.
    expect(res.metadata()).toBe(res.getMetadata());
    expect(res.metadata().model).toBe('deepseek-v4-pro');
  });

  it('forces a final text turn when the tool loop exhausts steps without trailing text', async () => {
    // Winning model burned its whole step budget on tool calls and stopped with
    // NO trailing text — the bug. The orchestrator must re-ask the same model.
    const toolStep = {
      toolCalls: [{ toolCallId: 'c1', toolName: 'lookupPokemon', input: { species: 'Garchomp' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'lookupPokemon', output: { ok: true } }],
    };
    const responseMessages = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'lookupPokemon', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'lookupPokemon', output: { ok: true } }] },
    ];

    let exhaustedParams: Record<string, unknown> = {};
    vi.mocked(streamWithFallback).mockImplementation((async (models: unknown[], params: unknown) => {
      exhaustedParams = params as Record<string, unknown>;
      return {
        result: fakeStreamResult('', [toolStep], responseMessages),
        model: (models as unknown[])[0],
        escalations: [],
      };
    }) as never);

    let followupParams: Record<string, unknown> = {};
    vi.mocked(streamFinalAnswer).mockImplementation(((_model: unknown, params: unknown) => {
      followupParams = params as Record<string, unknown>;
      // A single text-only step (no tool calls under toolChoice:'none').
      return fakeStreamResult('Here is your final answer from the gathered data.', [
        { toolCalls: [], toolResults: [] },
      ]);
    }) as never);

    const res = await runAgent(baseRequest());

    // The follow-up ran ONCE on the winning model and saw the assistant/tool
    // messages plus the closing nudge appended to the original conversation.
    expect(streamFinalAnswer).toHaveBeenCalledTimes(1);
    const followupMessages = followupParams.messages as Array<{ role: string; content: unknown }>;
    expect(followupMessages.at(-1)).toMatchObject({ role: 'system' });
    expect(followupMessages.some((m) => m.role === 'tool')).toBe(true);

    // The consumer sees the final text through the run's textStream…
    let streamed = '';
    for await (const chunk of res.textStream) streamed += chunk;
    expect(streamed).toBe('Here is your final answer from the gathered data.');

    // …and the raw result the route adapts also carries it.
    expect(await res.result.text).toBe('Here is your final answer from the gathered data.');

    // Persisted EXACTLY once — the final text belongs to the same assistant
    // message, which still records the original tool activity.
    expect(appendMessages).toHaveBeenCalledTimes(1);
    const [, appended] = vi.mocked(appendMessages).mock.calls[0];
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      role: 'assistant',
      content: 'Here is your final answer from the gathered data.',
    });
    expect(appended[0].tool_calls).toHaveLength(1);

    // Original tool steps + combined usage survive on the exposed result.
    expect(await res.result.steps).toHaveLength(2); // tool step + follow-up step
    const meta = res.getMetadata();
    expect(meta.tool_calls).toBe(1);
    expect(meta.usage).toEqual({ input_tokens: 200, output_tokens: 100 });

    // The original loop was bounded by the teambuilding budget (12 steps).
    expect(exhaustedParams.stopWhen).toBeDefined();
  });

  it('rejects with AgentExhaustedError when every model fails (never resolves an undefined stream)', async () => {
    vi.mocked(streamWithFallback).mockRejectedValueOnce(
      new AgentExhaustedError([{ from: 'm0', to: '(exhausted)', reason: 'provider-auth' }]),
    );

    const promise = runAgent(baseRequest());
    await expect(promise).rejects.toBeInstanceOf(AgentExhaustedError);
    // The run aborted before persistence — no half-written assistant turn.
    expect(appendMessages).not.toHaveBeenCalled();
    expect(recordSuggestion).not.toHaveBeenCalled();
  });
});

describe('applyToolOverrides', () => {
  const overrides = { userId: 'me', rulesetId: 'rs-1', playerCore: ['Grass', 'Ground', 'Poison'] };

  it('forces the resolved ruleset id + core onto buildTeam (even if the model omitted/mangled them)', () => {
    const out = applyToolOverrides('buildTeam', { format: 'gen9ru', ruleset_id: 'gen9ru' }, overrides) as Record<string, unknown>;
    expect(out.ruleset_id).toBe('rs-1');
    expect(out.player_core).toEqual(['Grass', 'Ground', 'Poison']);
    expect(out.format).toBe('gen9ru');
  });

  it('forces the ruleset id onto validateTeam too', () => {
    const out = applyToolOverrides('validateTeam', { team: [], format: 'gen9ru' }, overrides) as Record<string, unknown>;
    expect(out.ruleset_id).toBe('rs-1');
  });

  it('does not invent a ruleset/core when none resolved (plain teambuilder)', () => {
    const bare = { userId: 'me', rulesetId: null, playerCore: null };
    const out = applyToolOverrides('buildTeam', { format: 'gen9ou', ruleset_id: 'keep-mine' }, bare) as Record<string, unknown>;
    // The model's own input is left untouched when there is nothing authoritative to inject.
    expect(out.ruleset_id).toBe('keep-mine');
    expect(out.player_core).toBeUndefined();
  });

  it('ignores a player core that is not a full triple', () => {
    const out = applyToolOverrides('buildTeam', {}, { userId: 'me', rulesetId: 'rs-1', playerCore: ['Grass'] }) as Record<string, unknown>;
    expect(out.ruleset_id).toBe('rs-1');
    expect(out.player_core).toBeUndefined();
  });

  it('defaults getMatchHistory playerId to the authenticated user when absent', () => {
    const out = applyToolOverrides('getMatchHistory', {}, overrides) as Record<string, unknown>;
    expect(out.playerId).toBe('me');
  });

  it('never overwrites a supplied playerId (opponent scouting)', () => {
    const out = applyToolOverrides('getMatchHistory', { playerId: 'opp' }, overrides) as Record<string, unknown>;
    expect(out.playerId).toBe('opp');
  });

  it('leaves unrelated tools untouched', () => {
    const input = { species: 'Garchomp' };
    expect(applyToolOverrides('lookupPokemon', input, overrides)).toBe(input);
  });
});
