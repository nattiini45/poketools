import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Set env before module loads ───────────────────────────────────

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-claude-key';
  delete process.env.CLAUDE_API_KEY;
});

// ─── Mocks ─────────────────────────────────────────────────────────

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();
const mockAnthropicModel = vi.fn().mockReturnValue('anthropic-model');

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => mockAnthropicModel),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { isKaleConfigured, kaleGenerateText, kaleStreamText } from '../provider';
import { OutputCapError, RefusalError, ModelRejectedError } from '../../errors';

// ─── Helpers ───────────────────────────────────────────────────────

function makeGenerateResult(text: string, modelId = 'test-model', extra: Record<string, unknown> = {}) {
  return {
    text,
    response: { modelId },
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
    reasoningText: undefined,
    ...extra,
  };
}

function makeStreamResult(text: string, modelId = 'test-model', extra: Record<string, unknown> = {}) {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    response: Promise.resolve({ modelId }),
    finishReason: Promise.resolve('stop'),
    providerMetadata: Promise.resolve(undefined),
    ...extra,
  };
}

/** An AI SDK `APICallError` look-alike: the provider classifies by fields, not by class. */
function apiCallError(statusCode: number | undefined, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${statusCode} secret provider text`), {
    name: 'AI_APICallError',
    statusCode,
    ...extra,
  });
}

/** `streamText` result whose `text` rejects and whose `onError` reported `error`, as the SDK does. */
function failingStream(error: unknown) {
  return (opts: Record<string, unknown>) => {
    (opts.onError as ((event: { error: unknown }) => void) | undefined)?.({ error });
    return { text: Promise.reject(new Error('No output generated.')) };
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

// ─── Tests ─────────────────────────────────────────────────────────

describe('kale/provider', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockStreamText.mockReset();
    mockAnthropicModel.mockClear();
    vi.unstubAllEnvs();
    // The defaults under test must not depend on the machine that runs them (a shell can export
    // CLAUDE_API_EFFORT or CLAUDE_MODEL). An empty value means unset.
    vi.stubEnv('CLAUDE_MODEL', '');
    vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
    vi.stubEnv('CLAUDE_API_EFFORT', '');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isKaleConfigured', () => {
    it('returns true when ANTHROPIC_API_KEY is set', () => {
      expect(isKaleConfigured()).toBe(true);
    });

    it('returns false when no Anthropic key is set', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('CLAUDE_API_KEY', '');
      expect(isKaleConfigured()).toBe(false);
    });
  });

  describe('kaleGenerateText', () => {
    it('returns completion result from primary model', async () => {
      mockGenerateText.mockResolvedValueOnce(makeGenerateResult('Generated text'));

      const result = await kaleGenerateText('system', 'user');

      expect(result.content).toBe('Generated text');
      expect(result.model).toBe('test-model');
      expect(result.prompt_tokens).toBe(10);
      expect(result.completion_tokens).toBe(20);
      expect(result.stop_reason).toBe('stop');
    });

    it('reads cache tokens from the usage details and logs one counts-only line', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateResult('private model output', 'test-model', {
          usage: { inputTokens: 1000, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 50 } },
        }),
      );

      const result = await kaleGenerateText('secret system prompt', 'secret user prompt');

      expect(result.prompt_tokens).toBe(1000);
      expect(result.cache_read_input_tokens).toBe(900);
      expect(result.cache_creation_input_tokens).toBe(50);

      const lines = infoSpy.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes('"tag":"ai/usage"'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        surface: 'kale',
        input_tokens: 1000,
        cache_read_tokens: 900,
        cache_write_tokens: 50,
        output_tokens: 20,
        stop_reason: 'stop',
        fallback_used: false,
      });
      expect(lines[0]).not.toContain('secret');
      expect(lines[0]).not.toContain('private');
    });

    it('reports which rung answered in the result and in the usage line', async () => {
      mockGenerateText
        .mockResolvedValueOnce(makeGenerateResult('primary answer'))
        .mockRejectedValueOnce(apiCallError(529))
        .mockResolvedValueOnce(makeGenerateResult('fallback answer', 'fallback-model'));

      const primary = await kaleGenerateText('sys', 'user');
      const fallback = await kaleGenerateText('sys', 'user');

      expect(primary.fallback_used).toBe(false);
      expect(fallback.fallback_used).toBe(true);
      const usage = infoSpy.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .filter((line: string) => line.includes('"tag":"ai/usage"'))
        .map((line: string) => JSON.parse(line));
      expect(usage.map((entry: { fallback_used: boolean }) => entry.fallback_used)).toEqual([false, true]);
      expect(usage[1]).toMatchObject({ requested_model: 'claude-haiku-5-5' });
    });

    it('never publishes the model thinking as the answer: an empty text asks the fallback, then fails', async () => {
      mockGenerateText.mockResolvedValue({
        text: '',
        response: { modelId: 'reasoning-model' },
        usage: { inputTokens: 5, outputTokens: 15 },
        finishReason: 'stop',
        reasoningText: 'Reasoning output content',
      });

      await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('All Kale model attempts failed');
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it('throws when text and reasoningText are both empty', async () => {
      mockGenerateText.mockResolvedValue({
        text: '',
        response: { modelId: 'test' },
        usage: { inputTokens: 5, outputTokens: 0 },
        finishReason: 'stop',
        reasoningText: undefined,
      });

      await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('All Kale model attempts failed');
    });

    it('passes a custom maxTokens', async () => {
      mockGenerateText.mockResolvedValueOnce(makeGenerateResult('ok'));

      await kaleGenerateText('sys', 'user', { maxTokens: 1024 });

      expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 1024 }));
    });

    describe('request settings per model', () => {
      it.each([
        // model id, whether the call carries a temperature, whether it carries an effort
        ['claude-sonnet-5-5', false, true],
        ['claude-haiku-5-5', false, true],
        ['claude-opus-5-5', false, true],
        ['claude-sonnet-4-6', true, true],
        ['claude-haiku-4-5-20251001', true, false],
      ])('%s', async (model, sendsTemperature, sendsEffort) => {
        vi.stubEnv('CLAUDE_MODEL', model);
        mockGenerateText.mockResolvedValueOnce(makeGenerateResult('ok'));

        await kaleGenerateText('sys', 'user', { maxTokens: 4096 });

        const call = mockGenerateText.mock.calls[0][0];
        expect(mockAnthropicModel).toHaveBeenCalledWith(model);
        expect(call.maxOutputTokens).toBe(4096);
        if (sendsTemperature) expect(call.temperature).toBe(0.3);
        else expect(call).not.toHaveProperty('temperature');
        if (sendsEffort) expect(call.providerOptions).toEqual({ anthropic: { effort: 'medium' } });
        else expect(call).not.toHaveProperty('providerOptions');
        // Thinking is never configured: the 5.x models think adaptively by default.
        expect(JSON.stringify(call.providerOptions ?? {})).not.toContain('thinking');
      });

      it('sends CLAUDE_API_EFFORT as the effort, and medium when it is invalid', async () => {
        vi.stubEnv('CLAUDE_API_EFFORT', 'xhigh');
        mockGenerateText.mockResolvedValueOnce(makeGenerateResult('ok'));
        await kaleGenerateText('sys', 'user');
        expect(mockGenerateText.mock.calls[0][0].providerOptions).toEqual({ anthropic: { effort: 'xhigh' } });

        vi.stubEnv('CLAUDE_API_EFFORT', 'not-a-level');
        mockGenerateText.mockResolvedValueOnce(makeGenerateResult('ok'));
        await kaleGenerateText('sys', 'user');
        expect(mockGenerateText.mock.calls[1][0].providerOptions).toEqual({ anthropic: { effort: 'medium' } });
      });

      it('sends the same effort to the fallback model', async () => {
        vi.stubEnv('CLAUDE_API_EFFORT', 'high');
        mockGenerateText
          .mockRejectedValueOnce(apiCallError(529))
          .mockResolvedValueOnce(makeGenerateResult('fallback answer', 'claude-haiku-5-5'));

        await kaleGenerateText('sys', 'user');

        expect(mockAnthropicModel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
        expect(mockGenerateText.mock.calls[1][0].providerOptions).toEqual({ anthropic: { effort: 'high' } });
      });
    });

    describe('fallback ladder', () => {
      it.each([
        ['a 529', () => apiCallError(529)],
        ['a 429', () => apiCallError(429)],
        ['a 500', () => apiCallError(500)],
        ['a network failure the SDK marks retryable', () => apiCallError(undefined, { isRetryable: true })],
        ['an aborted attempt (our deadline)', () => Object.assign(new Error('aborted'), { name: 'AbortError' })],
      ])('falls back to the fallback model after %s', async (_label, makeError) => {
        mockGenerateText
          .mockRejectedValueOnce(makeError())
          .mockResolvedValueOnce(makeGenerateResult('Fallback text', 'fallback-model'));

        const result = await kaleGenerateText('sys', 'user');

        expect(result.content).toBe('Fallback text');
        expect(result.fallback_used).toBe(true);
        expect(mockGenerateText).toHaveBeenCalledTimes(2);
        expect(mockAnthropicModel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
      });

      it('falls back after a failed body read the AI SDK wrapped as a retryable status-200 APICallError', async () => {
        mockGenerateText
          .mockRejectedValueOnce(apiCallError(200, { isRetryable: true, cause: new TypeError('terminated') }))
          .mockResolvedValueOnce(makeGenerateResult('Fallback text', 'fallback-model'));

        const result = await kaleGenerateText('sys', 'user');
        expect(result.fallback_used).toBe(true);
      });

      it('does not fall back for a status-200 processing failure that is not a network error', async () => {
        mockGenerateText.mockRejectedValueOnce(apiCallError(200, { isRetryable: false, cause: new SyntaxError('bad json') }));

        await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('HTTP 200');
        expect(mockGenerateText).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['400', () => apiCallError(400)],
        ['401', () => apiCallError(401)],
        ['404', () => apiCallError(404)],
      ])('surfaces a %s with one call, no fallback and no provider text', async (_label, makeError) => {
        mockGenerateText.mockRejectedValueOnce(makeError());

        const failure = await kaleGenerateText('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(ModelRejectedError);
        expect((failure as Error).message).not.toContain('secret provider text');
        expect(mockGenerateText).toHaveBeenCalledTimes(1);
      });

      it('surfaces a non-transient failure of the fallback model too', async () => {
        mockGenerateText
          .mockRejectedValueOnce(apiCallError(529))
          .mockRejectedValueOnce(apiCallError(400));

        await expect(kaleGenerateText('sys', 'user')).rejects.toBeInstanceOf(ModelRejectedError);
        expect(mockGenerateText).toHaveBeenCalledTimes(2);
      });

      it('throws when every rung fails transiently', async () => {
        mockGenerateText.mockRejectedValue(apiCallError(529));

        await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('All Kale model attempts failed');
        // Primary + fallback, nothing more: no blocking replay.
        expect(mockGenerateText).toHaveBeenCalledTimes(2);
      });

      it('surfaces an unclassified error instead of walking the ladder', async () => {
        mockGenerateText.mockRejectedValueOnce(new TypeError('boom'));

        await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('boom');
        expect(mockGenerateText).toHaveBeenCalledTimes(1);
      });
    });

    describe('stop reasons', () => {
      it('throws OutputCapError when the answer stopped at the output cap, without a retry call', async () => {
        mockGenerateText.mockResolvedValueOnce(makeGenerateResult('Half a sente', 'test-model', { finishReason: 'length' }));

        const failure = await kaleGenerateText('sys', 'user', { maxTokens: 150 }).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(OutputCapError);
        expect((failure as OutputCapError).maxTokens).toBe(150);
        expect(mockGenerateText).toHaveBeenCalledTimes(1);
      });

      it('throws RefusalError on an Anthropic content-filter finish, reading the category when present', async () => {
        mockGenerateText.mockResolvedValueOnce(
          makeGenerateResult('', 'test-model', {
            finishReason: 'content-filter',
            providerMetadata: { anthropic: { stopDetails: { type: 'refusal', category: 'cyber' } } },
          }),
        );

        const failure = await kaleGenerateText('sys', 'user').catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RefusalError);
        expect((failure as RefusalError).category).toBe('cyber');
        expect(mockGenerateText).toHaveBeenCalledTimes(1);
      });

      it('branches on the finish reason when the refusal carries no stop details', async () => {
        mockGenerateText.mockResolvedValueOnce(
          makeGenerateResult('', 'test-model', { finishReason: 'content-filter', providerMetadata: {} }),
        );

        await expect(kaleGenerateText('sys', 'user')).rejects.toBeInstanceOf(RefusalError);
      });

    });

    describe('model resolution', () => {
      it('uses CLAUDE_MODEL and CLAUDE_FALLBACK_MODEL, with an empty value meaning the default', async () => {
        vi.stubEnv('CLAUDE_MODEL', 'claude-opus-5-5');
        vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
        mockGenerateText
          .mockRejectedValueOnce(apiCallError(529))
          .mockResolvedValueOnce(makeGenerateResult('ok'));

        await kaleGenerateText('sys', 'user');

        expect(mockAnthropicModel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
      });

      it('has no Kale-specific model setting: KALE_MODEL and KALE_FALLBACK_MODEL are ignored', async () => {
        vi.stubEnv('KALE_MODEL', 'some-other-model');
        vi.stubEnv('KALE_FALLBACK_MODEL', 'some-other-fallback');
        mockGenerateText
          .mockRejectedValueOnce(apiCallError(529))
          .mockResolvedValueOnce(makeGenerateResult('ok'));

        await kaleGenerateText('sys', 'user');

        expect(mockAnthropicModel.mock.calls.map((c: unknown[]) => c[0])).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
      });

      it('fails without a call when no Anthropic key is set', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', '');
        vi.stubEnv('CLAUDE_API_KEY', '');

        await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('ANTHROPIC_API_KEY');
        expect(mockGenerateText).not.toHaveBeenCalled();
      });
    });
  });

  describe('kaleStreamText', () => {
    it('returns streamed content from primary model', async () => {
      mockStreamText.mockReturnValueOnce(makeStreamResult('Streamed text'));

      const result = await kaleStreamText('sys', 'user');

      expect(result.content).toBe('Streamed text');
      expect(result.prompt_tokens).toBe(10);
      expect(result.stop_reason).toBe('stop');
    });

    it('falls back to fallback model streaming on a transient primary failure', async () => {
      mockStreamText
        .mockImplementationOnce(failingStream(apiCallError(529)))
        .mockReturnValueOnce(makeStreamResult('Fallback stream'));

      const result = await kaleStreamText('sys', 'user');
      expect(result.content).toBe('Fallback stream');
      expect(result.fallback_used).toBe(true);
    });

    it('falls back on a mid-stream provider error event of a transient type', async () => {
      mockStreamText
        .mockImplementationOnce(failingStream({ type: 'overloaded_error', message: 'Overloaded' }))
        .mockReturnValueOnce(makeStreamResult('Fallback stream'));

      const result = await kaleStreamText('sys', 'user');
      expect(result.content).toBe('Fallback stream');
    });

    it('surfaces a mid-stream invalid-request event and a 400 without a fallback', async () => {
      mockStreamText.mockImplementationOnce(failingStream(apiCallError(400)));

      await expect(kaleStreamText('sys', 'user')).rejects.toBeInstanceOf(ModelRejectedError);
      expect(mockStreamText).toHaveBeenCalledTimes(1);

      mockStreamText.mockImplementationOnce(failingStream({ type: 'invalid_request_error', message: 'no' }));
      await expect(kaleStreamText('sys', 'user')).rejects.toThrow();
      expect(mockStreamText).toHaveBeenCalledTimes(2);
    });

    it('falls back after undici drops the response body mid-stream (bare TypeError terminated)', async () => {
      const terminated = Object.assign(new TypeError('terminated'), {
        cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
      });
      mockStreamText
        .mockImplementationOnce(failingStream(terminated))
        .mockReturnValueOnce(makeStreamResult('Fallback stream'));

      const result = await kaleStreamText('sys', 'user');
      expect(result).toMatchObject({ content: 'Fallback stream', fallback_used: true });
    });

    it('does not fall back for a plain programming TypeError in the stream', async () => {
      mockStreamText.mockImplementationOnce(failingStream(new TypeError('boom')));

      await expect(kaleStreamText('sys', 'user')).rejects.toThrow('boom');
      expect(mockStreamText).toHaveBeenCalledTimes(1);
    });

    it('has no blocking replay when every stream fails', async () => {
      mockStreamText.mockImplementation(failingStream(apiCallError(529)));

      await expect(kaleStreamText('sys', 'user')).rejects.toThrow('All Kale model attempts failed');
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('throws OutputCapError and RefusalError from the finish reason', async () => {
      mockStreamText.mockReturnValueOnce(makeStreamResult('Half a sente', 'test-model', { finishReason: Promise.resolve('length') }));
      await expect(kaleStreamText('sys', 'user', undefined, { maxTokens: 120 })).rejects.toBeInstanceOf(OutputCapError);

      mockStreamText.mockReturnValueOnce(
        makeStreamResult('', 'test-model', {
          finishReason: Promise.resolve('content-filter'),
          providerMetadata: Promise.resolve({ anthropic: { stopDetails: { type: 'refusal', category: 'bio' } } }),
        }),
      );
      const failure = await kaleStreamText('sys', 'user').catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(RefusalError);
      expect((failure as RefusalError).category).toBe('bio');
    });

    it('calls onChunk callback via streamText options', async () => {
      mockStreamText.mockImplementationOnce((opts: Record<string, unknown>) => {
        const onChunk = opts.onChunk as (() => void) | undefined;
        onChunk?.();
        return makeStreamResult('text');
      });

      const onChunk = vi.fn();
      await kaleStreamText('sys', 'user', onChunk);
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
