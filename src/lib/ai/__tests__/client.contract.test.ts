import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract test for the raw-SDK client: the real `@anthropic-ai/sdk` runs against a recorded
 * `fetch`, so what is asserted is the request that would reach the Messages API (body, headers,
 * path) and how the real SDK's responses and errors drive the client. No network, no model call.
 *
 * Request shapes per model id live here so a model change has a test that names the contract:
 * the defaults are the 5.5 family, which gets `output_config.effort` (default `medium`), no
 * `temperature` and no `thinking` field; an older model that still accepts a temperature keeps
 * `temperature: 0.2`, and Haiku 4.5 gets no effort.
 */

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.CLAUDE_API_KEY;
});

vi.mock('braintrust', () => ({
  initLogger: vi.fn(),
  wrapAnthropic: vi.fn((client: unknown) => client),
}));

// ─── Recorded fetch ────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const recorded: RecordedRequest[] = [];
let respond: (request: RecordedRequest, call: number) => Response;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const request: RecordedRequest = {
    url: String(input),
    headers,
    body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
  };
  recorded.push(request);
  return respond(request, recorded.length);
});

const NO_RETRY = { 'x-should-retry': 'false' };

function messageJson(model: string, text: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 34 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } },
  );
}

function errorJson(status: number, type: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: 'provider detail' } }), {
    status,
    headers: { 'content-type': 'application/json', ...NO_RETRY },
  });
}

function sse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}

/**
 * An SSE response whose connection dies after `keep` events: the body stream errors the way
 * undici does when the peer drops the socket (`TypeError('terminated')` with a socket cause).
 */
function cutSse(events: Array<{ event: string; data: unknown }>, keep: number): Response {
  const encoder = new TextEncoder();
  const chunks = events
    .slice(0, keep)
    .map((e) => encoder.encode(`event: ${e.event}
data: ${JSON.stringify(e.data)}

`));
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      controller.error(
        Object.assign(new TypeError('terminated'), {
          cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
        }),
      );
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}

function streamEvents(
  model: string,
  text: string,
  stopReason = 'end_turn',
  stopDetails: Record<string, unknown> | null = null,
) {
  return [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 1 },
        },
      },
    },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null, ...(stopDetails ? { stop_details: stopDetails } : {}) },
        usage: { output_tokens: 34 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];
}

// ─── Fresh client per test ─────────────────────────────────────────

type ClientModule = typeof import('../client');
let client: ClientModule;

beforeEach(async () => {
  recorded.length = 0;
  // The defaults under test must not depend on the machine that runs them (a shell can export
  // CLAUDE_API_EFFORT or CLAUDE_MODEL). An empty value means unset.
  vi.stubEnv('CLAUDE_MODEL', '');
  vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
  vi.stubEnv('CLAUDE_API_EFFORT', '');
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // The client is a module singleton that captures `fetch` when it is built.
  vi.resetModules();
  client = await import('../client');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Contract ──────────────────────────────────────────────────────

describe('ai/client request contract (recorded fetch)', () => {
  it('posts a non-streaming Messages request with the expected headers and body', async () => {
    respond = (request) => messageJson(String(request.body.model), 'hello');

    const result = await client.complete('the system prompt', 'the user prompt');

    expect(recorded).toHaveLength(1);
    const request = recorded[0];
    expect(new URL(request.url).pathname).toBe('/v1/messages');
    expect(request.headers['x-api-key']).toBe('test-key');
    expect(request.headers['anthropic-version']).toBeTruthy();
    // Pinned whole: no temperature, no thinking field (the 5.5 models think adaptively by default
    // and reject `thinking: { type: 'disabled' }`), effort at its default.
    expect(request.body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 4096,
      system: 'the system prompt',
      messages: [{ role: 'user', content: 'the user prompt' }],
      output_config: { effort: 'medium' },
    });
    expect(result).toMatchObject({ content: 'hello', model: 'claude-sonnet-5-5', prompt_tokens: 12, completion_tokens: 34 });
  });

  it('posts a streaming request with stream:true and parses the real SSE stream', async () => {
    respond = (request) => sse(streamEvents(String(request.body.model), 'streamed answer'));

    const onChunk = vi.fn();
    const result = await client.completeStreaming('sys', 'user', onChunk, 2048);

    expect(recorded).toHaveLength(1);
    expect(recorded[0].body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 2048,
      stream: true,
      system: 'sys',
      messages: [{ role: 'user', content: 'user' }],
      output_config: { effort: 'medium' },
    });
    expect(result).toMatchObject({
      content: 'streamed answer',
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      prompt_tokens: 12,
      completion_tokens: 34,
    });
    expect(onChunk).toHaveBeenCalled();
  });

  it.each([
    // The caps the routes ask for (`AI_MAX_TOKENS`): analysis and scouting stream, the rest do not.
    ['match analysis', 16_000, true],
    ['match prep scouting', 16_000, true],
    ['slot and team coach', 8_000, false],
    ['recap', 4_096, false],
  ])('sends the %s output cap (%i) with effort and no thinking field', async (_surface, maxTokens, streaming) => {
    if (streaming) {
      respond = (request) => sse(streamEvents(String(request.body.model), 'ok'));
      await client.completeStreaming('sys', 'user', undefined, undefined, { maxTokens });
    } else {
      respond = (request) => messageJson(String(request.body.model), 'ok');
      await client.complete('sys', 'user', { maxTokens });
    }

    const body = recorded[0].body;
    expect(body.max_tokens).toBe(maxTokens);
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
  });

  describe.each([
    // model id, whether the request carries temperature, whether it carries output_config.effort
    ['claude-sonnet-4-6', true, true],
    ['claude-haiku-4-5-20251001', true, false],
    ['claude-opus-4-6', true, true],
    ['claude-opus-4-7', false, true],
    ['claude-sonnet-5-5', false, true],
    // The AI SDK treats `claude-haiku-5-5` as an unknown model; this raw path does not care.
    // The case documents the shape that reaches the API.
    ['claude-haiku-5-5', false, true],
    ['claude-opus-5-5', false, true],
  ])('model %s', (model, sendsTemperature, sendsEffort) => {
    it(`${sendsTemperature ? 'sends' : 'omits'} temperature and ${sendsEffort ? 'sends' : 'omits'} effort (blocking)`, async () => {
      respond = (request) => messageJson(String(request.body.model), 'ok');

      await client.complete('sys', 'user', { model });

      const body = recorded[0].body;
      expect(body.model).toBe(model);
      if (sendsTemperature) expect(body.temperature).toBe(0.2);
      else expect(body).not.toHaveProperty('temperature');
      if (sendsEffort) expect(body.output_config).toEqual({ effort: 'medium' });
      else expect(body).not.toHaveProperty('output_config');
      expect(body).not.toHaveProperty('thinking');
    });

    it(`${sendsTemperature ? 'sends' : 'omits'} temperature (streaming)`, async () => {
      respond = (request) => sse(streamEvents(String(request.body.model), 'ok'));

      await client.completeStreaming('sys', 'user', undefined, undefined, { model });

      const body = recorded[0].body;
      expect(body.stream).toBe(true);
      if (sendsTemperature) expect(body.temperature).toBe(0.2);
      else expect(body).not.toHaveProperty('temperature');
      if (sendsEffort) expect(body.output_config).toEqual({ effort: 'medium' });
      else expect(body).not.toHaveProperty('output_config');
      expect(body).not.toHaveProperty('thinking');
    });
  });

  describe('CLAUDE_API_EFFORT', () => {
    it.each(['low', 'medium', 'high', 'xhigh', 'max'])('sends %s to a model that supports effort', async (effort) => {
      vi.stubEnv('CLAUDE_API_EFFORT', effort);
      respond = (request) => messageJson(String(request.body.model), 'ok');

      await client.complete('sys', 'user');

      expect(recorded[0].body.output_config).toEqual({ effort });
    });

    it('falls back to medium and warns for an invalid value', async () => {
      vi.stubEnv('CLAUDE_API_EFFORT', 'ludicrous');
      respond = (request) => messageJson(String(request.body.model), 'ok');

      await client.complete('sys', 'user');

      expect(recorded[0].body.output_config).toEqual({ effort: 'medium' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('CLAUDE_API_EFFORT'));
    });

    it('does not send effort to Haiku 4.5, whatever the setting', async () => {
      vi.stubEnv('CLAUDE_API_EFFORT', 'max');
      respond = (request) => messageJson(String(request.body.model), 'ok');

      await client.complete('sys', 'user', { model: 'claude-haiku-4-5-20251001' });

      expect(recorded[0].body).not.toHaveProperty('output_config');
    });

    it('lets one call override the setting', async () => {
      vi.stubEnv('CLAUDE_API_EFFORT', 'high');
      respond = (request) => messageJson(String(request.body.model), 'ok');

      await client.complete('sys', 'user', { effort: 'low' });

      expect(recorded[0].body.output_config).toEqual({ effort: 'low' });
    });

    it('sends the same effort to the fallback model (Haiku 5.5 supports it)', async () => {
      vi.stubEnv('CLAUDE_API_EFFORT', 'high');
      respond = (request, call) =>
        call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'fallback');

      await client.complete('sys', 'user');

      expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
      expect(recorded[1].body).toEqual({
        model: 'claude-haiku-5-5',
        max_tokens: 4096,
        system: 'sys',
        messages: [{ role: 'user', content: 'user' }],
        output_config: { effort: 'high' },
      });
    });
  });

  it('reads CLAUDE_MODEL and CLAUDE_FALLBACK_MODEL with || (an empty value means the default)', async () => {
    vi.stubEnv('CLAUDE_MODEL', 'claude-opus-5-5');
    vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
    respond = (request, call) =>
      call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'fallback');

    const result = await client.complete('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(result.fallback_used).toBe(true);
  });

  it('sums the cache fields of a real usage object into prompt_tokens', async () => {
    respond = (request) =>
      messageJson(String(request.body.model), 'ok', {
        usage: { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 40, cache_read_input_tokens: 600 },
      });

    const result = await client.complete('sys', 'user');

    expect(result.prompt_tokens).toBe(645);
    expect(result.cache_read_input_tokens).toBe(600);
  });
});

describe('ai/client against the real SDK error handling', () => {
  it('asks the fallback model after a 529, and the call goes to the fallback model id', async () => {
    respond = (request, call) =>
      call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'from fallback');

    const result = await client.complete('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result).toMatchObject({ content: 'from fallback', fallback_used: true });
  });

  it('surfaces a 400 loudly: one request, a typed error, no provider text in the message', async () => {
    respond = () => errorJson(400, 'invalid_request_error');

    const failure = await client.complete('sys', 'user').catch((e: unknown) => e);

    const { ModelRejectedError } = await import('../errors');
    expect(failure).toBeInstanceOf(ModelRejectedError);
    expect((failure as { upstreamStatus: number }).upstreamStatus).toBe(400);
    expect((failure as Error).message).not.toContain('provider detail');
    expect(recorded).toHaveLength(1);
  });

  it('falls back after a mid-stream SSE error event', async () => {
    respond = (request, call) =>
      call === 1
        ? sse([
            ...streamEvents(String(request.body.model), 'part').slice(0, 3),
            { event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
          ])
        : sse(streamEvents(String(request.body.model), 'complete answer'));

    const result = await client.completeStreaming('sys', 'user');

    expect(recorded).toHaveLength(2);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });

  it('does not fall back after a mid-stream invalid-request event', async () => {
    respond = (request) =>
      sse([
        ...streamEvents(String(request.body.model), 'part').slice(0, 3),
        { event: 'error', data: { type: 'error', error: { type: 'invalid_request_error', message: 'nope' } } },
      ]);

    const { ModelRejectedError } = await import('../errors');
    await expect(client.completeStreaming('sys', 'user')).rejects.toBeInstanceOf(ModelRejectedError);
    expect(recorded).toHaveLength(1);
  });

  it('throws OutputCapError for a streamed JSON answer that stopped at max_tokens', async () => {
    respond = (request) => sse(streamEvents(String(request.body.model), '{"summary":"cut', 'max_tokens'));

    const { OutputCapError } = await import('../errors');
    await expect(
      client.completeStreaming('sys', 'user', undefined, 1000, { jsonOutput: true }),
    ).rejects.toBeInstanceOf(OutputCapError);
    expect(recorded).toHaveLength(1);
  });

  it('falls back after the connection drops mid-stream (the SDK wraps it as a plain AnthropicError)', async () => {
    respond = (request, call) =>
      call === 1
        ? cutSse(streamEvents(String(request.body.model), 'part'), 3)
        : sse(streamEvents(String(request.body.model), 'complete answer'));

    const result = await client.completeStreaming('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });

  it('fails when the connection drops mid-stream on both models, with no further attempt', async () => {
    respond = (request) => cutSse(streamEvents(String(request.body.model), 'part'), 3);

    await expect(client.completeStreaming('sys', 'user')).rejects.toThrow();
    expect(recorded).toHaveLength(2);
  });

  it('reads the refusal category from the streamed message_delta, which the SDK snapshot drops', async () => {
    respond = (request) =>
      sse(
        streamEvents(String(request.body.model), '', 'refusal', { type: 'refusal', category: 'cyber', explanation: null }),
      );

    const { RefusalError } = await import('../errors');
    const failure = await client.completeStreaming('sys', 'user').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RefusalError);
    expect((failure as { category: string | null }).category).toBe('cyber');
    expect(recorded).toHaveLength(1);
  });

  it('sends the request with no SDK retry: a 529 with a long retry-after goes straight to the fallback', async () => {
    respond = (request, call) =>
      call === 1
        ? new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'x' } }), {
            status: 529,
            // Without maxRetries: 0 the SDK would sleep this long before retrying, ignoring the deadline.
            headers: { 'content-type': 'application/json', 'retry-after': '55', 'x-should-retry': 'true' },
          })
        : messageJson(String(request.body.model), 'fallback');

    const started = Date.now();
    const result = await client.complete('sys', 'user');

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result.fallback_used).toBe(true);
  });
});
