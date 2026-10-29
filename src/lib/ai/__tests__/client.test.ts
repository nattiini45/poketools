import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicError, APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';

// ─── Set env before module loads ───────────────────────────────────

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

// ─── Mocks ─────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  // The real error classes stay real: the fallback ladder classifies failures with instanceof.
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  // Must use function() (not arrow) so it works with `new Anthropic()`
  const MockAnthropic = vi.fn(function (this: Record<string, unknown>) {
    this.messages = { create: mockCreate, stream: mockStream };
  });
  return { ...actual, default: MockAnthropic };
});

vi.mock('braintrust', () => ({
  initLogger: vi.fn(),
  wrapAnthropic: vi.fn((client: unknown) => client),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { complete, completeStreaming } from '../client';
import { OutputCapError, RefusalError, ModelRejectedError } from '../errors';

// ─── Helpers ───────────────────────────────────────────────────────

const PRIMARY = 'claude-sonnet-5-5';
const FALLBACK = 'claude-haiku-5-5';

function makeTextBlock(text: string) {
  return { type: 'text' as const, text };
}

function makeResponse(text: string, model = PRIMARY, extra: Record<string, unknown> = {}) {
  return {
    content: [makeTextBlock(text)],
    model,
    usage: { input_tokens: 10, output_tokens: 20 },
    ...extra,
  };
}

function textEvent(text: string) {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } };
}

function makeStream(
  events: unknown[],
  finalMessage: Record<string, unknown> = {},
) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    abort: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({
      model: PRIMARY,
      usage: { input_tokens: 15, output_tokens: 25 },
      ...finalMessage,
    }),
  };
}

/** A stream whose iterator throws, like the SDK iterator does for a mid-stream failure. */
function makeFailingStream(error: Error, eventsBefore: unknown[] = []) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of eventsBefore) yield e;
      throw error;
    },
    abort: vi.fn(),
    finalMessage: vi.fn().mockRejectedValue(error),
  };
}

function apiError(status: number | undefined, type: string | null = null) {
  return new APIError(status, { type: 'error', error: { type, message: 'secret provider text' } }, undefined, undefined, type as never);
}

/** What `MessageStream` throws when the body dies mid-stream: a plain AnthropicError wrapping the cause. */
function wrappedNetworkError() {
  const cause = Object.assign(new TypeError('terminated'), {
    cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }),
  });
  return Object.assign(new AnthropicError('terminated'), { cause });
}

/** Resolves when the signal aborts, like the SDK iterator does when the request is cancelled. */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener('abort', () => resolve());
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

// ─── Tests ─────────────────────────────────────────────────────────

describe('ai/client', () => {
  beforeEach(() => {
    // Not resetAllMocks: that would also empty the mocked Anthropic constructor.
    mockCreate.mockReset();
    mockStream.mockReset();
    vi.unstubAllEnvs();
    // The defaults under test must not depend on the machine that runs them (a shell can export
    // CLAUDE_API_EFFORT or CLAUDE_MODEL). An empty value means unset.
    vi.stubEnv('CLAUDE_MODEL', '');
    vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
    vi.stubEnv('CLAUDE_API_EFFORT', '');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe('complete', () => {
    it('returns content, usage and stop reason from the primary model', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('Hello world', PRIMARY, { stop_reason: 'end_turn' }));

      const result = await complete('system prompt', 'user prompt');

      expect(result.content).toBe('Hello world');
      expect(result.model).toBe(PRIMARY);
      expect(result.prompt_tokens).toBe(10);
      expect(result.completion_tokens).toBe(20);
      expect(result.stop_reason).toBe('end_turn');
      expect(result.fallback_used).toBe(false);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('sends effort medium, no temperature and no thinking to the default model, with a deadline signal and no SDK retries (the fallback model is the retry)', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('ok'));

      await complete('system prompt', 'user prompt');

      const [body, options] = mockCreate.mock.calls[0];
      expect(body).toEqual({
        model: PRIMARY,
        max_tokens: 4096,
        system: 'system prompt',
        messages: [{ role: 'user', content: 'user prompt' }],
        output_config: { effort: 'medium' },
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.maxRetries).toBe(0);
    });

    it('keeps temperature 0.2 for an older model that accepts it', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('ok', 'claude-sonnet-4-6'));

      await complete('sys', 'user', { model: 'claude-sonnet-4-6' });

      expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-4-6', temperature: 0.2 });
    });

    it('omits temperature for model ids that reject it', async () => {
      for (const model of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-7', 'claude-opus-5-5']) {
        mockCreate.mockResolvedValueOnce(makeResponse('ok', model));
        await complete('sys', 'user', { model });
        const body = mockCreate.mock.calls.at(-1)![0];
        expect(body).not.toHaveProperty('temperature');
        expect(body).not.toHaveProperty('thinking');
      }
    });

    it('reads CLAUDE_MODEL when the call names no model', async () => {
      vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-5');
      mockCreate.mockResolvedValueOnce(makeResponse('ok', 'claude-sonnet-5-5'));

      await complete('sys', 'user');

      const body = mockCreate.mock.calls[0][0];
      expect(body.model).toBe('claude-sonnet-5-5');
      expect(body).not.toHaveProperty('temperature');
    });

    it('honors maxTokens on the blocking path and sends effort only where supported', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('ok'));
      await complete('sys', 'user', { maxTokens: 2000, effort: 'low' });
      expect(mockCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 2000, output_config: { effort: 'low' } });

      // Haiku 5.5 supports effort; Haiku 4.5 does not.
      mockCreate.mockResolvedValueOnce(makeResponse('ok', FALLBACK));
      await complete('sys', 'user', { model: FALLBACK, effort: 'low' });
      expect(mockCreate.mock.calls[1][0]).toMatchObject({ output_config: { effort: 'low' } });

      mockCreate.mockResolvedValueOnce(makeResponse('ok', 'claude-haiku-4-5-20251001'));
      await complete('sys', 'user', { model: 'claude-haiku-4-5-20251001', effort: 'low' });
      expect(mockCreate.mock.calls[2][0]).not.toHaveProperty('output_config');
    });

    it('sums cache tokens into prompt_tokens and treats null cache counts as zero', async () => {
      mockCreate.mockResolvedValueOnce(
        makeResponse('ok', PRIMARY, {
          usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 },
        }),
      );
      const cached = await complete('sys', 'user');
      expect(cached.prompt_tokens).toBe(1110);
      expect(cached.cache_creation_input_tokens).toBe(100);
      expect(cached.cache_read_input_tokens).toBe(1000);

      mockCreate.mockResolvedValueOnce(
        makeResponse('ok', PRIMARY, {
          usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null },
        }),
      );
      const plain = await complete('sys', 'user');
      expect(plain.prompt_tokens).toBe(10);
      expect(Number.isNaN(plain.prompt_tokens)).toBe(false);
    });

    it('logs one counts-only usage line per generation', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('the model said something private', PRIMARY, { stop_reason: 'end_turn' }));

      await complete('secret system prompt', 'secret user prompt', { surface: 'slot-coach' });

      const lines = infoSpy.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes('"tag":"ai/usage"'));
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry).toMatchObject({
        surface: 'slot-coach',
        requested_model: PRIMARY,
        response_model: PRIMARY,
        input_tokens: 10,
        output_tokens: 20,
        stop_reason: 'end_turn',
        fallback_used: false,
      });
      expect(lines[0]).not.toContain('secret');
      expect(lines[0]).not.toContain('private');
    });

    describe('fallback ladder', () => {
      it.each([
        ['an overloaded response (529)', () => apiError(529, 'overloaded_error')],
        ['a rate limit (429)', () => apiError(429, 'rate_limit_error')],
        ['a server error (500)', () => apiError(500, 'api_error')],
        ['a connection error', () => new APIConnectionError({ message: 'socket hang up' })],
        ['our own deadline abort', () => new APIUserAbortError()],
        ['a mid-stream error event (no status)', () => apiError(undefined, 'overloaded_error')],
      ])('asks the fallback model after %s', async (_label, makeError) => {
        mockCreate
          .mockRejectedValueOnce(makeError())
          .mockResolvedValueOnce(makeResponse('Fallback response', FALLBACK));

        const result = await complete('sys', 'user');

        expect(result.content).toBe('Fallback response');
        expect(result.model).toBe(FALLBACK);
        expect(result.fallback_used).toBe(true);
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(mockCreate.mock.calls[1][0].model).toBe(FALLBACK);
      });

      it.each([
        ['400', () => apiError(400, 'invalid_request_error')],
        ['401', () => apiError(401, 'authentication_error')],
        ['403', () => apiError(403, 'permission_error')],
        ['404', () => apiError(404, 'not_found_error')],
        ['a mid-stream invalid-request event', () => apiError(undefined, 'invalid_request_error')],
      ])('surfaces %s without a second paid call', async (_label, makeError) => {
        mockCreate.mockRejectedValueOnce(makeError());

        const failure = await complete('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(ModelRejectedError);
        expect((failure as ModelRejectedError).message).not.toContain('secret provider text');
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('asks the fallback after the SDK wraps a mid-stream network failure (blocking)', async () => {
        mockCreate
          .mockRejectedValueOnce(wrappedNetworkError())
          .mockResolvedValueOnce(makeResponse('Recovered', FALLBACK));

        const result = await complete('sys', 'user');
        expect(result.fallback_used).toBe(true);
      });

      it('does not ask the fallback for the SDK preflight error', async () => {
        mockCreate.mockRejectedValueOnce(
          new AnthropicError('Streaming is required for operations that may take longer than 10 minutes.'),
        );

        await expect(complete('sys', 'user')).rejects.toThrow('Streaming is required');
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('surfaces an unclassified bug instead of asking the fallback', async () => {
        mockCreate.mockRejectedValueOnce(new TypeError('boom'));

        await expect(complete('sys', 'user')).rejects.toThrow('boom');
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('throws the fallback failure when both models fail transiently', async () => {
        mockCreate
          .mockRejectedValueOnce(apiError(529, 'overloaded_error'))
          .mockRejectedValueOnce(apiError(500, 'api_error'));

        const failure = await complete('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(APIError);
        expect((failure as APIError).status).toBe(500);
        expect(mockCreate).toHaveBeenCalledTimes(2);
      });

      it('falls back on an empty answer', async () => {
        mockCreate.mockResolvedValueOnce({
          content: [],
          model: PRIMARY,
          usage: { input_tokens: 5, output_tokens: 0 },
        });
        mockCreate.mockResolvedValueOnce(makeResponse('Recovered', FALLBACK));

        const result = await complete('sys', 'user');
        expect(result.content).toBe('Recovered');
      });

      it('ends a call that exceeds its deadline instead of waiting forever', async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        mockCreate.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
          signals.push(options.signal);
          if (signals.length === 1) {
            await untilAborted(options.signal);
            throw new APIUserAbortError();
          }
          return makeResponse('Fallback response', FALLBACK);
        });

        const pending = complete('sys', 'user');
        await vi.advanceTimersByTimeAsync(150_000);
        const result = await pending;

        expect(signals[0].aborted).toBe(true);
        expect(result.model).toBe(FALLBACK);
        expect(mockCreate).toHaveBeenCalledTimes(2);
      });
    });

    describe('stop reasons', () => {
      it('throws OutputCapError for a JSON caller whose answer hit the cap, without a fallback call', async () => {
        mockCreate.mockResolvedValueOnce(makeResponse('{"summary":"cut', PRIMARY, { stop_reason: 'max_tokens' }));

        const failure = await complete('sys', 'user', { jsonOutput: true, maxTokens: 1500 }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(OutputCapError);
        expect((failure as OutputCapError).maxTokens).toBe(1500);
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('returns the partial text with its stop reason to a free-text caller', async () => {
        mockCreate.mockResolvedValueOnce(makeResponse('A good start of', PRIMARY, { stop_reason: 'max_tokens' }));

        const result = await complete('sys', 'user');

        expect(result.content).toBe('A good start of');
        expect(result.stop_reason).toBe('max_tokens');
      });

      it('throws RefusalError on a refusal, even with text, without a fallback call', async () => {
        mockCreate.mockResolvedValueOnce(
          makeResponse('I cannot help with that.', PRIMARY, {
            stop_reason: 'refusal',
            stop_details: { type: 'refusal', category: 'cyber', explanation: null },
          }),
        );

        const failure = await complete('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RefusalError);
        expect((failure as RefusalError).category).toBe('cyber');
        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('does not require stop_reason to be present', async () => {
        mockCreate.mockResolvedValueOnce(makeResponse('fine'));
        const result = await complete('sys', 'user', { jsonOutput: true });
        expect(result.content).toBe('fine');
        expect(result.stop_reason).toBeNull();
      });
    });

    it('filters non-text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'tool_use', text: 'ignored' },
          makeTextBlock('real text'),
        ],
        model: PRIMARY,
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const result = await complete('sys', 'user');
      expect(result.content).toBe('real text');
    });

    it('joins multiple text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [makeTextBlock('part1'), makeTextBlock('part2')],
        model: PRIMARY,
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const result = await complete('sys', 'user');
      expect(result.content).toBe('part1part2');
    });
  });

  describe('completeStreaming', () => {
    it('returns content from the streaming primary model', async () => {
      mockStream.mockReturnValueOnce(
        makeStream([textEvent('streamed '), textEvent('text')], { stop_reason: 'end_turn' }),
      );

      const onChunk = vi.fn();
      const result = await completeStreaming('sys', 'user', onChunk);

      expect(result.content).toBe('streamed text');
      expect(result.prompt_tokens).toBe(15);
      expect(result.completion_tokens).toBe(25);
      expect(result.stop_reason).toBe('end_turn');
      expect(result.fallback_used).toBe(false);
      expect(onChunk).toHaveBeenCalled();
    });

    it('sends the request with a deadline signal, a retry budget, effort and gated temperature', async () => {
      mockStream.mockReturnValueOnce(makeStream([textEvent('a')]));
      await completeStreaming('sys', 'user');
      const [body, options] = mockStream.mock.calls[0];
      expect(body).toMatchObject({ model: PRIMARY, max_tokens: 4096, output_config: { effort: 'medium' } });
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('thinking');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.maxRetries).toBe(0);

      mockStream.mockReturnValueOnce(makeStream([textEvent('a')], { model: 'claude-sonnet-4-6' }));
      await completeStreaming('sys', 'user', undefined, undefined, { model: 'claude-sonnet-4-6' });
      expect(mockStream.mock.calls[1][0]).toMatchObject({ temperature: 0.2 });
    });

    it('takes the positional cap, and lets options.maxTokens override it', async () => {
      mockStream.mockReturnValueOnce(makeStream([textEvent('a')]));
      await completeStreaming('sys', 'user', undefined, 3000);
      expect(mockStream.mock.calls[0][0].max_tokens).toBe(3000);

      mockStream.mockReturnValueOnce(makeStream([textEvent('a')]));
      await completeStreaming('sys', 'user', undefined, 3000, { maxTokens: 8000 });
      expect(mockStream.mock.calls[1][0].max_tokens).toBe(8000);
    });

    it('calls onChunk for each event', async () => {
      mockStream.mockReturnValueOnce(
        makeStream([textEvent('a'), textEvent('b'), { type: 'message_start', delta: {} }], {
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      );

      const onChunk = vi.fn();
      await completeStreaming('sys', 'user', onChunk);
      expect(onChunk).toHaveBeenCalledTimes(3);
    });

    it('sums cache tokens into prompt_tokens', async () => {
      mockStream.mockReturnValueOnce(
        makeStream([textEvent('a')], {
          usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: null, cache_read_input_tokens: 300 },
        }),
      );
      const result = await completeStreaming('sys', 'user');
      expect(result.prompt_tokens).toBe(305);
      expect(result.cache_read_input_tokens).toBe(300);
    });

    describe('fallback ladder', () => {
      it('asks the fallback model when the primary stream fails with a transient error', async () => {
        mockStream
          .mockReturnValueOnce(makeFailingStream(apiError(529, 'overloaded_error')))
          .mockReturnValueOnce(makeStream([textEvent('fallback')], { model: FALLBACK }));

        const result = await completeStreaming('sys', 'user');

        expect(result.content).toBe('fallback');
        expect(result.fallback_used).toBe(true);
        expect(mockStream.mock.calls[1][0].model).toBe(FALLBACK);
      });

      it('falls back on a mid-stream SSE error event (no HTTP status)', async () => {
        mockStream
          .mockReturnValueOnce(makeFailingStream(apiError(undefined, 'overloaded_error'), [textEvent('part')]))
          .mockReturnValueOnce(makeStream([textEvent('complete answer')], { model: FALLBACK }));

        const result = await completeStreaming('sys', 'user');
        expect(result.content).toBe('complete answer');
      });

      it('falls back when the SDK wraps a dropped connection (TypeError terminated) as an AnthropicError', async () => {
        mockStream
          .mockReturnValueOnce(makeFailingStream(wrappedNetworkError(), [textEvent('part')]))
          .mockReturnValueOnce(makeStream([textEvent('complete answer')], { model: FALLBACK }));

        const result = await completeStreaming('sys', 'user');
        expect(result).toMatchObject({ content: 'complete answer', fallback_used: true });
      });

      it.each([
        'request ended without sending any chunks',
        'stream ended without producing a Message with role=assistant',
      ])('falls back on the stream-shape error "%s"', async (message) => {
        mockStream
          .mockReturnValueOnce(makeFailingStream(new AnthropicError(message)))
          .mockReturnValueOnce(makeStream([textEvent('complete answer')], { model: FALLBACK }));

        const result = await completeStreaming('sys', 'user');
        expect(result.content).toBe('complete answer');
      });

      it('does not fall back on a plain programming error thrown while streaming', async () => {
        mockStream.mockReturnValueOnce(makeFailingStream(new TypeError('boom')));

        await expect(completeStreaming('sys', 'user')).rejects.toThrow('boom');
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      it('surfaces a 400 without asking the fallback', async () => {
        mockStream.mockReturnValueOnce(makeFailingStream(apiError(400, 'invalid_request_error')));

        await expect(completeStreaming('sys', 'user')).rejects.toBeInstanceOf(ModelRejectedError);
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      it('has no third, blocking attempt when both streams fail', async () => {
        mockStream
          .mockReturnValueOnce(makeFailingStream(apiError(529, 'overloaded_error')))
          .mockReturnValueOnce(makeFailingStream(apiError(500, 'api_error')));

        const failure = await completeStreaming('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(APIError);
        expect(mockStream).toHaveBeenCalledTimes(2);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('throws on a deadline the SDK iterator swallowed, never returning the partial text', async () => {
        vi.useFakeTimers();
        let attempts = 0;
        mockStream.mockImplementation((_body: unknown, options: { signal: AbortSignal }) => {
          attempts += 1;
          return {
            // Like the SDK: when the signal aborts between events the iterator just ends.
            [Symbol.asyncIterator]: async function* () {
              yield textEvent('half a sentence');
              await untilAborted(options.signal);
            },
            abort: vi.fn(),
            finalMessage: vi.fn().mockResolvedValue({ model: PRIMARY, usage: { input_tokens: 1, output_tokens: 1 } }),
          };
        });

        const outcome = completeStreaming('sys', 'user').then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(150_000);
        await vi.advanceTimersByTimeAsync(90_000);
        const settled = await outcome;

        expect('value' in settled).toBe(false);
        expect((settled as { error: unknown }).error).toBeInstanceOf(APIUserAbortError);
        expect(attempts).toBe(2);
      });
    });

    describe('stop reasons', () => {
      it('throws OutputCapError for a JSON caller at max_tokens and skips the fallback', async () => {
        mockStream.mockReturnValueOnce(makeStream([textEvent('{"summary":"cut')], { stop_reason: 'max_tokens' }));

        const failure = await completeStreaming('sys', 'user', undefined, undefined, { jsonOutput: true }).catch(
          (e: unknown) => e,
        );

        expect(failure).toBeInstanceOf(OutputCapError);
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      it('returns partial text with stop_reason to a free-text caller', async () => {
        mockStream.mockReturnValueOnce(makeStream([textEvent('A good start of')], { stop_reason: 'max_tokens' }));

        const result = await completeStreaming('sys', 'user');

        expect(result.content).toBe('A good start of');
        expect(result.stop_reason).toBe('max_tokens');
      });

      it('judges a refusal before the empty-content check', async () => {
        mockStream.mockReturnValueOnce(
          makeStream([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } }),
        );

        await expect(completeStreaming('sys', 'user')).rejects.toBeInstanceOf(RefusalError);
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      it('takes the refusal category from the message_delta event, which the SDK snapshot drops', async () => {
        mockStream.mockReturnValueOnce(
          makeStream(
            [{ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } } }],
            { stop_reason: 'refusal', stop_details: null },
          ),
        );

        const failure = await completeStreaming('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RefusalError);
        expect((failure as RefusalError).category).toBe('cyber');
      });

      it('falls back on an empty streamed answer', async () => {
        mockStream
          .mockReturnValueOnce(makeStream([], { stop_reason: 'end_turn' }))
          .mockReturnValueOnce(makeStream([textEvent('second try')], { model: FALLBACK }));

        const result = await completeStreaming('sys', 'user');
        expect(result.content).toBe('second try');
        expect(errorSpy).toHaveBeenCalled();
      });
    });
  });
});
