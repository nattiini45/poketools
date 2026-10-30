/**
 * Contract test of the default model port: it builds the request the plan prescribes (3.4) and reads the response back
 * into the persisted blocks. The provider's HTTP layer is replaced by a recording `fetch`; nothing reaches a network.
 * What this proves is the request this code builds and how it reads a well-formed answer. It cannot prove what the API
 * accepts (spikes S2 to S5 and S8 need a key).
 */
import { describe, expect, it, vi } from 'vitest';
import { classifyPortError, createAiSdkModelPort, normalizeStopReason, readStopInfo, usageMeters, type AiSdkPortOptions } from '../ai-sdk-port';
import { DEFAULT_ADAPTER } from '../ai-sdk-messages';
import { ModelPortError, type ModelStepInput, type ProviderAdapterConfig } from '../types';
import type { TranscriptEntry } from '../transcript';
import { fakeToolSet } from './fakes';
import { harnessEventText } from '../harness';

interface WireBlock {
  type?: string;
  text?: string;
  cache_control?: unknown;
  [key: string]: unknown;
}
interface WireMessage {
  role: string;
  content: WireBlock[];
}
interface WireTool {
  name: string;
  strict?: boolean;
  eager_input_streaming?: unknown;
  cache_control?: unknown;
  input_schema?: unknown;
}
/** The parts of the provider request this file asserts on. */
interface WireBody {
  model: string;
  stream: boolean;
  max_tokens: number;
  thinking?: unknown;
  output_config?: unknown;
  tool_choice?: unknown;
  system: WireBlock[];
  tools: WireTool[];
  messages: WireMessage[];
  [key: string]: unknown;
}
interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: WireBody;
}

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function messageStream(options: { stop: string; blocks: Array<Record<string, unknown>>; usage?: Record<string, unknown>; model?: string; stopDetails?: Record<string, unknown> }) {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: {
        id: 'msg_01',
        type: 'message',
        role: 'assistant',
        model: options.model ?? 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 400, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 }, ...options.usage },
      },
    },
  ];
  options.blocks.forEach((block, index) => {
    const type = block.type as string;
    if (type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else if (type === 'tool_use') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: options.stop, stop_sequence: null, ...(options.stopDetails ? { stop_details: options.stopDetails } : {}) }, usage: { output_tokens: 42 } });
  events.push({ type: 'message_stop' });
  return events;
}

function recorder(responder: () => Response) {
  const calls: Recorded[] = [];
  const fetch: AiSdkPortOptions['fetch'] = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) as WireBody });
    return responder();
  };
  return { calls, fetch };
}

const toolSet = fakeToolSet({ league_get: 'R', dex_lookup: 'P', plan_set: 'D', propose_build: 'B' });

function input(transcript: TranscriptEntry[], overrides: Partial<ModelStepInput> = {}): ModelStepInput {
  return {
    model: 'claude-opus-5-5',
    effort: 'medium',
    system: 'FROZEN SYSTEM PROMPT',
    tools: toolSet.tools,
    transcript,
    sentinel: 'S3NT1NEL',
    maxOutputTokens: 32_000,
    timeoutMs: 60_000,
    ...overrides,
  };
}

const user = (seq: number, text: string): TranscriptEntry => ({ role: 'user', kind: 'chat', seq, blocks: [{ type: 'text', text }] });
const event = (seq: number, name: string): TranscriptEntry => ({ role: 'event', kind: 'harness_event', seq, event: name, text: harnessEventText(name), data: {} });

function port(adapter: Partial<ProviderAdapterConfig>, responder: () => Response) {
  const rec = recorder(responder);
  return { ...rec, port: createAiSdkModelPort({ apiKey: 'test-key', fetch: rec.fetch, adapter }) };
}

const TOOL_TURN = messageStream({
  stop: 'tool_use',
  blocks: [
    { type: 'thinking', thinking: 'Let me think', signature: 'sig-xyz' },
    { type: 'text', text: 'Looking it up.' },
    { type: 'tool_use', id: 'toolu_01', name: 'league_get', input: { league_id: 'abc' } },
  ],
});

describe('the key the default port uses', () => {
  const respond = () => sseResponse(messageStream({ stop: 'end_turn', blocks: [{ type: 'text', text: 'hi' }] }));
  const keyOf = async (env: Record<string, string>) => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('CLAUDE_API_KEY', '');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const rec = recorder(respond);
    // No `apiKey` option: the port asks the single reader (`anthropicApiKey()`).
    await createAiSdkModelPort({ fetch: rec.fetch }).step(input([user(1, 'hi')]));
    vi.unstubAllEnvs();
    return rec.calls[0].headers['x-api-key'];
  };

  it('reads ANTHROPIC_API_KEY, falls back to the deprecated CLAUDE_API_KEY, and prefers the former', async () => {
    expect(await keyOf({ ANTHROPIC_API_KEY: 'sk-new' })).toBe('sk-new');
    expect(await keyOf({ CLAUDE_API_KEY: 'sk-old' })).toBe('sk-old');
    expect(await keyOf({ ANTHROPIC_API_KEY: 'sk-new', CLAUDE_API_KEY: 'sk-old' })).toBe('sk-new');
  });
});

describe('the request the default port builds', () => {
  it('matches the plan: one step, adaptive thinking, effort, strict tools, no forced choice, two 1 h breakpoints', async () => {
    const { calls, port: p } = port({}, () => sseResponse(TOOL_TURN));
    await p.step(input([user(1, 'Make a league'), event(2, 'state_refresh')]));

    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('test-key');

    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(32_000);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    // Tool choice is `auto` (the SDK default): never `any` or a named tool, which the 5.5 models answer with a 400. Thinking is
    // never disabled, there are no sampling parameters and no top-level automatic cache control.
    expect(body.tool_choice).toEqual({ type: 'auto' });
    for (const key of ['temperature', 'top_p', 'top_k', 'cache_control', 'context_management', 'metadata']) expect(body).not.toHaveProperty(key);

    // The frozen prefix: the last system block carries the 1 h breakpoint.
    expect(body.system).toEqual([{ type: 'text', text: 'FROZEN SYSTEM PROMPT', cache_control: { type: 'ephemeral', ttl: '1h' } }]);

    // Tools: in the registry's order, strict, buffered (no eager input streaming), the last one a breakpoint.
    expect(body.tools.map((t) => t.name)).toEqual(toolSet.names);
    for (const tool of body.tools) {
      expect(tool.strict).toBe(true);
      expect(tool).not.toHaveProperty('eager_input_streaming');
    }
    expect(body.tools.slice(0, -1).every((t) => t.cache_control === undefined)).toBe(true);
    expect(body.tools.at(-1)?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(body.tools[0].input_schema).toEqual(toolSet.tools[0].input_schema);
  });

  it('sends the tail breakpoint on the last persisted message and a mid-conversation system message for the event', async () => {
    const { calls, port: p } = port({}, () => sseResponse(TOOL_TURN));
    await p.step(input([user(1, 'Make a league'), event(2, 'state_refresh')]));
    const { body, headers } = calls[0];
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Make a league' }] },
      { role: 'system', content: [{ type: 'text', text: '[harness_event] state_refresh', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
    ]);
    expect(headers['anthropic-beta']).toContain('mid-conversation-system-2026-04-07');
  });

  it('puts the tail breakpoint on the last message whatever its role', async () => {
    const { calls, port: p } = port({}, () => sseResponse(TOOL_TURN));
    await p.step(input([user(1, 'hello')]));
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '1h' } }] }]);
  });

  it('adds a user anchor when a system message would follow an assistant message', async () => {
    const { calls, port: p } = port({}, () => sseResponse(TOOL_TURN));
    const assistant: TranscriptEntry = { role: 'assistant', kind: 'chat', seq: 2, blocks: [{ type: 'text', text: 'Staged.' }] };
    await p.step(input([user(1, 'build it'), assistant, event(3, 'proposal_approved')]));
    expect(calls[0].body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system']);
    expect(calls[0].body.messages[2].content[0]?.text).toBe('[harness_event] resume');
  });

  it('never sends a system message that is followed by a user message: a limit event waits behind the admin message that follows it', async () => {
    const { calls, port: p } = port({}, () => sseResponse(TOOL_TURN));
    const toolUse: TranscriptEntry = { role: 'assistant', kind: 'chat', seq: 2, blocks: [{ type: 'tool_use', id: 't1', name: 'league_get', input: {} }] };
    const results: TranscriptEntry = { role: 'user', kind: 'tool_results', seq: 3, blocks: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] };
    await p.step(input([user(1, 'build it'), toolUse, results, event(4, 'turn_limit'), user(5, 'make it top 8')]));
    const messages = calls[0].body.messages;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system']);
    expect(messages[2].content.at(-1)?.text).toBe('make it top 8');
    messages.forEach((m, i) => {
      if (m.role !== 'system') return;
      expect(messages[i - 1]?.role).toBe('user');
      expect(['assistant', undefined]).toContain(messages[i + 1]?.role);
    });
  });

  it('honours the adapter switches: sentinel channel, no strict, no reasoning replay, 5 m cache', async () => {
    const { calls, port: p } = port({ stateChannel: 'sentinel-user', strictTools: false, sendReasoning: false, cacheTtl: '5m' }, () => sseResponse(TOOL_TURN));
    const assistant: TranscriptEntry = {
      role: 'assistant',
      kind: 'chat',
      seq: 2,
      blocks: [{ type: 'thinking', thinking: 'secret', signature: 'sig-1' }, { type: 'text', text: 'Staged.' }],
    };
    await p.step(input([user(1, 'build it'), assistant, event(3, 'proposal_approved')]));
    const { body, headers } = calls[0];
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(body.messages)).toContain('[harness_event:S3NT1NEL] proposal_approved');
    expect(headers['anthropic-beta'] ?? '').not.toContain('mid-conversation-system');
    expect(body.tools.every((t) => t.strict === undefined)).toBe(true);
    // No thinking block is replayed.
    expect(JSON.stringify(body.messages)).not.toContain('sig-1');
    // 5 minute breakpoints carry no ttl.
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('uses the conversation effort and the Sonnet output budget for a Sonnet conversation', async () => {
    const { calls, port: p } = port({}, () => sseResponse(messageStream({ stop: 'end_turn', blocks: [{ type: 'text', text: 'hi' }], model: 'claude-sonnet-5-5' })));
    await p.step(input([user(1, 'hi')], { model: 'claude-sonnet-5-5', effort: 'high', maxOutputTokens: 16_000 }));
    expect(calls[0].body.model).toBe('claude-sonnet-5-5');
    expect(calls[0].body.max_tokens).toBe(16_000);
    expect(calls[0].body.output_config).toEqual({ effort: 'high' });
    expect(calls[0].body.tool_choice).toEqual({ type: 'auto' });
    expect(calls[0].body.thinking).toEqual({ type: 'adaptive' });
  });

  it('builds a plain request for a title: no tools, no cache control, low effort', async () => {
    const { calls, port: p } = port({}, () =>
      new Response(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'League setup' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 30, output_tokens: 5 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await p.complete({ model: 'claude-haiku-5-5', effort: 'low', system: 'Title it', prompt: 'hello', maxOutputTokens: 1024, timeoutMs: 30_000 });
    expect(result.text).toBe('League setup');
    const { body } = calls[0];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect((body as { tools?: unknown }).tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});

describe('reading a response', () => {
  it('turns a thinking, text and tool_use answer into the persisted blocks, with usage and stop reason', async () => {
    const { port: p } = port({}, () => sseResponse(TOOL_TURN));
    const deltas: string[] = [];
    const result = await p.step(input([user(1, 'go')], { onTextDelta: (d) => deltas.push(d) }));

    expect(deltas.join('')).toBe('Looking it up.');
    expect(result.blocks).toEqual([
      { type: 'thinking', thinking: 'Let me think', signature: 'sig-xyz' },
      { type: 'text', text: 'Looking it up.' },
      { type: 'tool_use', id: 'toolu_01', name: 'league_get', input: { league_id: 'abc' } },
    ]);
    expect(result.toolCalls).toEqual([{ id: 'toolu_01', name: 'league_get', input: { league_id: 'abc' } }]);
    expect(result.stopReason).toBe('tool_use');
    expect(result.rawStopReason).toBe('tool_use');
    expect(result.model).toBe('claude-opus-5-5');
    // Fresh, 1 h cache write (from the raw split), cache read, output.
    expect(result.usage).toEqual({ inputTokens: 100, cacheWrite5mTokens: 0, cacheWrite1hTokens: 50, cacheReadTokens: 400, outputTokens: 42 });
  });

  it('replays what it stored: the next request carries the same thinking signature, tool call and result string', async () => {
    const first = port({}, () => sseResponse(TOOL_TURN));
    const result = await first.port.step(input([user(1, 'go')]));
    const stored: TranscriptEntry[] = [
      user(1, 'go'),
      { role: 'assistant', kind: 'chat', seq: 2, blocks: result.blocks },
      {
        role: 'user',
        kind: 'tool_results',
        seq: 3,
        blocks: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"data":{"label":"x"},"ok":true}' }],
      },
    ];
    const second = port({}, () => sseResponse(messageStream({ stop: 'end_turn', blocks: [{ type: 'text', text: 'Found it.' }] })));
    await second.port.step(input(stored));

    const messages = second.calls[0].body.messages;
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me think', signature: 'sig-xyz' },
        { type: 'text', text: 'Looking it up.' },
        { type: 'tool_use', id: 'toolu_01', name: 'league_get', input: { league_id: 'abc' } },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"data":{"label":"x"},"ok":true}', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    });
  });

  it('marks a failed tool result as an error result', async () => {
    const { calls, port: p } = port({}, () => sseResponse(messageStream({ stop: 'end_turn', blocks: [{ type: 'text', text: 'ok' }] })));
    const assistant: TranscriptEntry = { role: 'assistant', kind: 'chat', seq: 2, blocks: [{ type: 'tool_use', id: 't1', name: 'plan_set', input: {} }] };
    const results: TranscriptEntry = { role: 'user', kind: 'tool_results', seq: 3, blocks: [{ type: 'tool_result', tool_use_id: 't1', content: '{"code":"plan_stale","ok":false}', is_error: true }] };
    await p.step(input([user(1, 'x'), assistant, results]));
    expect(calls[0].body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true, content: '{"code":"plan_stale","ok":false}' });
  });

  it('reads a refusal and a truncated answer as stop reasons, not as content to act on', async () => {
    const refusal = port({}, () => sseResponse(messageStream({ stop: 'refusal', blocks: [{ type: 'text', text: 'No.' }] })));
    expect((await refusal.port.step(input([user(1, 'x')]))).stopReason).toBe('refusal');
    const truncated = port({}, () => sseResponse(messageStream({ stop: 'max_tokens', blocks: [{ type: 'text', text: 'long' }] })));
    expect((await truncated.port.step(input([user(1, 'x')]))).stopReason).toBe('max_tokens');
  });

  it('reads the finish reasons and the refusal category from the provider metadata, once per step', async () => {
    const refused = port({}, () => sseResponse(messageStream({ stop: 'refusal', blocks: [{ type: 'text', text: 'No.' }], stopDetails: { type: 'refusal', category: 'cyber', explanation: 'a private sentence' } })));
    const result = await refused.port.step(input([user(1, 'x')]));
    expect(result).toMatchObject({ stopReason: 'refusal', rawStopReason: 'refusal', rawFinishReason: 'refusal', finishReason: 'content-filter', stopDetails: { category: 'cyber' } });
    // Only the category is kept: not the explanation, which is model prose.
    expect(JSON.stringify(result.stopDetails)).not.toContain('private');

    const plain = port({}, () => sseResponse(TOOL_TURN));
    const normal = await plain.port.step(input([user(1, 'x')]));
    expect(normal).toMatchObject({ rawFinishReason: 'tool_use', finishReason: 'tool-calls' });
    expect(normal).not.toHaveProperty('stopDetails');
    expect(normal).not.toHaveProperty('iterations');
  });

  it('reports how a small side call ended, so a cut-off or refused answer is not read as a complete one', async () => {
    const reply = (stop: string, extra: Record<string, unknown> = {}, text = 'League') =>
      new Response(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 5 }, ...extra }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const call = (response: () => Response) => port({}, response).port.complete({ model: 'claude-haiku-5-5', effort: 'low', system: 's', prompt: 'p', maxOutputTokens: 1024, timeoutMs: 30_000 });

    expect(await call(() => reply('end_turn'))).toMatchObject({ stopReason: 'end_turn', rawFinishReason: 'end_turn', finishReason: 'stop' });
    expect(await call(() => reply('max_tokens'))).toMatchObject({ stopReason: 'max_tokens', rawFinishReason: 'max_tokens', finishReason: 'length' });
    const withIterations = await call(() => reply('end_turn', { usage: { input_tokens: 30, output_tokens: 5, iterations: [{ type: 'message', input_tokens: 30, output_tokens: 5 }] } }));
    expect(withIterations.iterations).toEqual([{ type: 'message', inputTokens: 30, outputTokens: 5 }]);
    const refused = await call(() => reply('refusal', { stop_details: { type: 'refusal', category: 'bio' } }));
    expect(refused).toMatchObject({ stopReason: 'refusal', rawFinishReason: 'refusal', stopDetails: { category: 'bio' } });
  });

  it('classifies a rejected request (a 401 is not retried) without exposing the provider text', async () => {
    const { port: p } = port({}, () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-secret' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const error = await p.step(input([user(1, 'x')])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelPortError);
    expect((error as ModelPortError).kind).toBe('auth');
    expect((error as ModelPortError).message).not.toContain('sk-secret');
  });
});

describe('small mappings', () => {
  it('normalises stop reasons, raw first', () => {
    expect(normalizeStopReason('end_turn', 'stop')).toBe('end_turn');
    expect(normalizeStopReason('pause_turn', 'stop')).toBe('end_turn');
    expect(normalizeStopReason('tool_use', 'tool-calls')).toBe('tool_use');
    expect(normalizeStopReason('max_tokens', 'length')).toBe('max_tokens');
    expect(normalizeStopReason('refusal', 'content-filter')).toBe('refusal');
    expect(normalizeStopReason('model_context_window_exceeded', 'length')).toBe('context_exceeded');
    expect(normalizeStopReason('compaction', 'other')).toBe('other');
    expect(normalizeStopReason(undefined, 'stop')).toBe('end_turn');
    expect(normalizeStopReason(undefined, 'error')).toBe('other');
  });

  it('splits the cache writes by TTL, or books them at the configured TTL when the API did not say', () => {
    const base = { inputTokens: 1000, inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 600 }, outputTokens: 50 };
    expect(usageMeters(base, DEFAULT_ADAPTER)).toEqual({ inputTokens: 100, cacheWrite5mTokens: 0, cacheWrite1hTokens: 600, cacheReadTokens: 300, outputTokens: 50 });
    expect(usageMeters(base, { ...DEFAULT_ADAPTER, cacheTtl: '5m' })).toMatchObject({ cacheWrite5mTokens: 600, cacheWrite1hTokens: 0 });
    expect(usageMeters({ ...base, raw: { cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 400 } } }, DEFAULT_ADAPTER)).toMatchObject({ cacheWrite5mTokens: 200, cacheWrite1hTokens: 400 });
    expect(usageMeters({ inputTokens: undefined, outputTokens: undefined }, DEFAULT_ADAPTER)).toEqual({ inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
  });

  it('narrows the provider metadata: a string category, numeric iterations, nothing else', () => {
    expect(readStopInfo(undefined)).toEqual({});
    expect(readStopInfo({ anthropic: 'x' })).toEqual({});
    expect(readStopInfo({ anthropic: { stopDetails: { type: 'refusal', category: 'cyber', explanation: 'e' } } })).toEqual({ stopDetails: { category: 'cyber' } });
    // A refusal with details but no category, and a category of the wrong type.
    expect(readStopInfo({ anthropic: { stopDetails: { type: 'refusal' } } })).toEqual({});
    expect(readStopInfo({ anthropic: { stopDetails: { type: 'refusal', category: 7 } } })).toEqual({});
    expect(
      readStopInfo({
        anthropic: {
          iterations: [{ type: 'message', inputTokens: 10, outputTokens: 4 }, { type: 'fallback_message', model: 'claude-sonnet-5', inputTokens: 'bad', outputTokens: 2 }, { inputTokens: 1 }, 'junk'],
        },
      }),
    ).toEqual({
      iterations: [
        { type: 'message', inputTokens: 10, outputTokens: 4 },
        { type: 'fallback_message', model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 2 },
      ],
    });
    expect(readStopInfo({ anthropic: { iterations: null } })).toEqual({});
  });

  it('classifies transport errors', () => {
    const abort = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(classifyPortError(abort).kind).toBe('timeout');
    expect(classifyPortError(new TypeError('fetch failed')).kind).toBe('unavailable');
    expect(classifyPortError(new Error('?')).kind).toBe('unknown');
    const already = new ModelPortError('auth');
    expect(classifyPortError(already)).toBe(already);
  });
});
