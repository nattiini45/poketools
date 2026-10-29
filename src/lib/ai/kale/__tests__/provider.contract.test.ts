import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract test for the Anthropic branch of the Kale provider: the real AI SDK
 * (`ai` + `@ai-sdk/anthropic`) runs against a recorded `fetch`, so what is asserted is the
 * request that would reach the Messages API for each model id, and how the real SDK's responses
 * and errors drive the provider. No network, no model call.
 *
 * Known risk, recorded on purpose: the Kale and agent paths send `KALE_TEMPERATURE` (default
 * 0.3) on every request. `@ai-sdk/anthropic` strips it for the 5.x family and Opus 4.7 or later,
 * but Sonnet 4.6 still receives it, and nothing here protects that path if the SDK later moves to
 * an API version that rejects sampling parameters for every model. The 4.6 cases below pin the
 * current request so such a change shows up as a failing test, not as a 400 in production.
 *
 * `claude-haiku-5-5` is an unknown model to `@ai-sdk/anthropic` 3.0.121 (it falls into the
 * generic `claude-` branch with `isKnownModel: false`): temperature is still stripped, but the SDK
 * emits compatibility warnings and applies its own profile. The case asserts the request body and
 * does not rely on that profile.
 */

vi.hoisted(() => {
  process.env.KALE_API_KEY = 'test-kale-key';
  process.env.KALE_PROVIDER = 'anthropic';
  process.env.KALE_DISABLE_FALLBACK = 'true';
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
    // model id, whether the request carries temperature
    ['claude-sonnet-4-6', true],
    ['claude-haiku-4-5-20251001', true],
    ['claude-sonnet-5-5', false],
    ['claude-haiku-5-5', false],
    ['claude-opus-5-5', false],
  ])('model %s', (model, sendsTemperature) => {
    beforeEach(() => {
      vi.stubEnv('KALE_MODEL', model);
    });

    it(`${sendsTemperature ? 'sends' : 'omits'} temperature (blocking)`, async () => {
      respond = (request) => messageJson(String(request.body.model), 'text');

      const result = await kaleGenerateText('the system prompt', 'the user prompt', { maxTokens: 150 });

      expect(recorded).toHaveLength(1);
      const { url, headers, body } = recorded[0];
      expect(new URL(url).pathname).toBe('/v1/messages');
      expect(headers['x-api-key']).toBe('test-kale-key');
      expect(body).toMatchObject({
        model,
        max_tokens: 150,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'the user prompt' }] }],
      });
      expect(JSON.stringify(body.system)).toContain('the system prompt');
      if (sendsTemperature) expect(body.temperature).toBe(0.3);
      else expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('stream');
      expect(result).toMatchObject({ content: 'text', model, prompt_tokens: 12, completion_tokens: 34, stop_reason: 'stop' });
    });

    it(`${sendsTemperature ? 'sends' : 'omits'} temperature (streaming)`, async () => {
      respond = (request) => sse(String(request.body.model), 'streamed');

      const result = await kaleStreamText('sys', 'user', undefined, { maxTokens: 150 });

      expect(recorded).toHaveLength(1);
      const body = recorded[0].body;
      expect(body.stream).toBe(true);
      expect(body.model).toBe(model);
      if (sendsTemperature) expect(body.temperature).toBe(0.3);
      else expect(body).not.toHaveProperty('temperature');
      expect(result).toMatchObject({ content: 'streamed', model });
    });
  });

  it('reads KALE_MODEL before CLAUDE_MODEL, and an empty KALE_MODEL means unset', async () => {
    vi.stubEnv('KALE_MODEL', '');
    vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-5');
    respond = (request) => messageJson(String(request.body.model), 'ok');

    await kaleGenerateText('sys', 'user');

    expect(recorded[0].body.model).toBe('claude-sonnet-5-5');
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

  it('surfaces a 400 with one request even when a fallback model is configured', async () => {
    vi.stubEnv('KALE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001');
    respond = () => errorJson(400, 'invalid_request_error');

    const failure = await kaleGenerateText('sys', 'user').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ModelRejectedError);
    expect((failure as ModelRejectedError).upstreamStatus).toBe(400);
    expect((failure as Error).message).not.toContain('provider detail');
    expect(recorded).toHaveLength(1);
  });

  it('asks the configured fallback model after a 529', async () => {
    vi.stubEnv('KALE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001');
    respond = (request, call) =>
      call === 1 ? errorJson(529, 'overloaded_error') : messageJson(String(request.body.model), 'from fallback');

    const result = await kaleGenerateText('sys', 'user');

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    expect(result).toMatchObject({ content: 'from fallback', fallback_used: true });
  });

  it('asks the fallback after a network failure', async () => {
    vi.stubEnv('KALE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001');
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

  it('abandons an attempt at its deadline and asks the fallback model', async () => {
    vi.useFakeTimers();
    vi.stubEnv('KALE_TIMEOUT_MS', '1000');
    vi.stubEnv('KALE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001');
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
    vi.stubEnv('KALE_FALLBACK_MODEL', 'claude-haiku-4-5-20251001');
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

    expect(recorded.map((r) => r.body.model)).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']);
    expect(recorded.every((r) => r.body.stream === true)).toBe(true);
    expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
  });
});
