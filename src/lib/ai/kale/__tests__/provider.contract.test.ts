import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract test for the Anthropic branch of the Kale provider: the real AI SDK
 * (`ai` + `@ai-sdk/anthropic`) runs against a recorded `fetch`, so what is asserted is the
 * request that would reach the Messages API for each model id, and how the real SDK's responses
 * and errors drive the provider. No network, no model call.
 *
 * The defaults are the 5.5 pair. Their requests carry `output_config.effort` (default `medium`),
 * the caller's `max_tokens`, no sampling parameters and no `thinking` field (the models think
 * adaptively by default, and Sonnet 5.5 rejects `thinking: { type: 'disabled' }`).
 *
 * Known risk, recorded on purpose: a Kale call sends a temperature (0.3) only to a model that
 * accepts one, which is a 4.x id someone set through `CLAUDE_MODEL`. Nothing here protects that
 * path if the SDK later moves to an API version that rejects sampling parameters for every
 * model. The 4.x cases below pin the current request so such a change shows up as a failing
 * test, not as a 400 in production.
 *
 * `claude-haiku-5-5` is an unknown model to `@ai-sdk/anthropic` 3.0.121 (it falls into the
 * generic `claude-` branch with `isKnownModel: false`), so the SDK applies its own profile and
 * may emit compatibility warnings. The cases assert the request body and do not rely on that
 * profile; `maxOutputTokens` is always passed explicitly because the SDK's unknown-model default
 * is not ours.
 */

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-claude-key';
  delete process.env.CLAUDE_API_KEY;
});

import { kaleGenerateText, kaleStreamText } from '../provider';
import { ModelRejectedError, OutputCapError, RefusalError } from '../../errors';

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
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorJson(status: number, type: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: 'provider detail' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sse(model: string, text: string, stopReason = 'end_turn'): Response {
  const events = [
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
      data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 34 } },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];
  const body = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── Contract ──────────────────────────────────────────────────────

describe('kale/provider Anthropic request contract (recorded fetch)', () => {
  describe.each([
    // model id, whether the request carries temperature, whether it carries output_config.effort
    ['claude-sonnet-4-6', true, true],
    ['claude-haiku-4-5-20251001', true, false],
    ['claude-sonnet-5-5', false, true],
    ['claude-haiku-5-5', false, true],
    ['claude-opus-5-5', false, true],
  ])('model %s', (model, sendsTemperature, sendsEffort) => {
    beforeEach(() => {
      vi.stubEnv('CLAUDE_MODEL', model);
    });

    it('builds the expected request (blocking)', async () => {
      respond = (request) => messageJson(String(request.body.model), 'text');

      const result = await kaleGenerateText('the system prompt', 'the user prompt', { maxTokens: 4096 });

      expect(recorded).toHaveLength(1);
      const { url, headers, body } = recorded[0];
      expect(new URL(url).pathname).toBe('/v1/messages');
      expect(headers['x-api-key']).toBe('test-claude-key');
      expect(body).toMatchObject({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'the user prompt' }] }],
      });
      expect(JSON.stringify(body.system)).toContain('the system prompt');
      if (sendsTemperature) expect(body.temperature).toBe(0.3);
      else expect(body).not.toHaveProperty('temperature');
      if (sendsEffort) expect(body.output_config).toEqual({ effort: 'medium' });
      else expect(body).not.toHaveProperty('output_config');
      expect(body).not.toHaveProperty('thinking');
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('top_k');
      expect(body).not.toHaveProperty('stream');
      expect(result).toMatchObject({ content: 'text', model, prompt_tokens: 12, completion_tokens: 34, stop_reason: 'stop' });
    });

    it('builds the expected request (streaming)', async () => {
      respond = (request) => sse(String(request.body.model), 'streamed');

      const result = await kaleStreamText('sys', 'user', undefined, { maxTokens: 4096 });

      expect(recorded).toHaveLength(1);
      const body = recorded[0].body;
      expect(body.stream).toBe(true);
      expect(body.model).toBe(model);
      expect(body.max_tokens).toBe(4096);
      if (sendsTemperature) expect(body.temperature).toBe(0.3);
      else expect(body).not.toHaveProperty('temperature');
      if (sendsEffort) expect(body.output_config).toEqual({ effort: 'medium' });
      else expect(body).not.toHaveProperty('output_config');
      expect(body).not.toHaveProperty('thinking');
      expect(result).toMatchObject({ content: 'streamed', model });
    });
  });

  it('uses the 5.5 pair, effort medium and the task cap when nothing is configured', async () => {
    vi.stubEnv('CLAUDE_MODEL', '');
    respond = (request) => messageJson(String(request.body.model), 'ok');

    await kaleGenerateText('sys', 'user', { maxTokens: 4096 });

    expect(recorded[0].body).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 4096,
      system: expect.anything(),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'user' }] }],
      output_config: { effort: 'medium' },
    });
  });

  it('sends CLAUDE_API_EFFORT as the effort, and medium when the value is invalid', async () => {
    vi.stubEnv('CLAUDE_API_EFFORT', 'high');
    respond = (request) => messageJson(String(request.body.model), 'ok');
    await kaleGenerateText('sys', 'user');
    expect(recorded[0].body.output_config).toEqual({ effort: 'high' });

    vi.stubEnv('CLAUDE_API_EFFORT', 'bogus-level');
    await kaleGenerateText('sys', 'user');
    expect(recorded[1].body.output_config).toEqual({ effort: 'medium' });
  });

  it('asks the fallback model with the same effort and no sampling parameters', async () => {
    vi.stubEnv('CLAUDE_API_EFFORT', 'low');
    respond = (request, call) =>
      call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'from fallback');

    await kaleGenerateText('sys', 'user', { maxTokens: 4096 });

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(recorded[1].body).toMatchObject({ max_tokens: 4096, output_config: { effort: 'low' } });
    expect(recorded[1].body).not.toHaveProperty('temperature');
    expect(recorded[1].body).not.toHaveProperty('thinking');
  });
});

describe('kale/provider against the real AI SDK error and stop-reason handling', () => {
  it('throws OutputCapError for a blocking answer that stopped at max_tokens', async () => {
    respond = (request) => messageJson(String(request.body.model), 'Half a sente', { stop_reason: 'max_tokens' });

    await expect(kaleGenerateText('sys', 'user', { maxTokens: 120 })).rejects.toBeInstanceOf(OutputCapError);
    expect(recorded).toHaveLength(1);
  });

  it('throws OutputCapError for a streamed answer that stopped at max_tokens', async () => {
    respond = (request) => sse(String(request.body.model), 'Half a sente', 'max_tokens');

    await expect(kaleStreamText('sys', 'user', undefined, { maxTokens: 120 })).rejects.toBeInstanceOf(OutputCapError);
    expect(recorded).toHaveLength(1);
  });

  it('throws RefusalError for an Anthropic refusal, with the category when the API names one', async () => {
    respond = (request) =>
      messageJson(String(request.body.model), '', {
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      });

    const failure = await kaleGenerateText('sys', 'user').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RefusalError);
    expect((failure as RefusalError).category).toBe('cyber');
    expect(recorded).toHaveLength(1);
  });

  it('surfaces a 400 with one request, without asking the fallback model', async () => {
    respond = () => errorJson(400, 'invalid_request_error');

    const failure = await kaleGenerateText('sys', 'user').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ModelRejectedError);
    expect((failure as ModelRejectedError).upstreamStatus).toBe(400);
    expect((failure as Error).message).not.toContain('provider detail');
    expect(recorded).toHaveLength(1);
  });

  it('asks the fallback model after a 529', async () => {
    respond = (request, call) =>
      call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'from fallback');

    const result = await kaleGenerateText('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result).toMatchObject({ content: 'from fallback', fallback_used: true });
  });

  it('asks the fallback after a network failure', async () => {
    respond = (request, call) => {
      if (call === 1) {
        throw Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') });
      }
      return messageJson(String(request.body.model), 'after reconnect');
    };

    const result = await kaleGenerateText('sys', 'user');

    expect(recorded).toHaveLength(2);
    expect(result).toMatchObject({ content: 'after reconnect', fallback_used: true });
  });

  it('streaming: asks the fallback after the connection drops mid-stream', async () => {
    respond = (request, call) => {
      if (call !== 1) return sse(String(request.body.model), 'complete answer');
      // The first response: headers, the start of the message, then the socket dies.
      const encoder = new TextEncoder();
      const start = {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: request.body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 1 },
        },
      };
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(start)}\n\n`));
            return;
          }
          controller.error(
            Object.assign(new TypeError('terminated'), {
              cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
            }),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const result = await kaleStreamText('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });

  it('blocking: asks the fallback after the response body dies while being read', async () => {
    respond = (request, call) => {
      if (call !== 1) return messageJson(String(request.body.model), 'complete answer');
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(
            Object.assign(new TypeError('terminated'), {
              cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
            }),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const result = await kaleGenerateText('sys', 'user');

    expect(recorded).toHaveLength(2);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });

  it('abandons an attempt at its deadline and asks the fallback model', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KALE_TIMEOUT_MS', '1000');
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
          );
        }),
    );
    respond = (request) => messageJson(String(request.body.model), 'fallback in time');

    const pending = kaleGenerateText('sys', 'user');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toMatchObject({ content: 'fallback in time', fallback_used: true });
    expect(recorded).toHaveLength(1); // only the fallback request got as far as the recorded fetch
  });

  it('streaming: asks the fallback after a mid-stream overloaded error event, with no blocking replay', async () => {
    respond = (request, call) => {
      if (call !== 1) return sse(String(request.body.model), 'complete answer');
      // The first stream starts, then the provider sends an `error` event.
      const start = {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: request.body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 1 },
        },
      };
      const error = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
      const body = `event: message_start
data: ${JSON.stringify(start)}

event: error
data: ${JSON.stringify(error)}

`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const result = await kaleStreamText('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(recorded.every((r) => r.body.stream === true)).toBe(true);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });
});
