import { describe, expect, it, vi } from 'vitest';
import { createSafeSseSender } from '../sse';
import { modelAcceptsTemperature, modelSupportsEffort } from '../model-capabilities';
import { describeAiFailure } from '../failure';
import { ModelRejectedError, OutputCapError, RefusalError } from '../errors';
import { normalizeAiSdkUsage, normalizeAnthropicUsage } from '../usage-log';
import { CLAUDE_DEFAULT_FALLBACK_MODEL, CLAUDE_DEFAULT_MODEL, getClaudeFallbackModelId, getClaudeModelId, getKaleModelId } from '../constants';

describe('createSafeSseSender', () => {
  async function open() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    return { stream, sender: createSafeSseSender(controller), reader: stream.getReader() };
  }

  it('writes data frames, from a string or an object', async () => {
    const { sender, reader } = await open();
    expect(sender.send({ status: 'thinking' })).toBe(true);
    expect(sender.send('{"status":"done"}')).toBe(true);
    sender.close();

    const decoder = new TextDecoder();
    let text = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      text += decoder.decode(chunk.value);
    }
    expect(text).toBe('data: {"status":"thinking"}\n\ndata: {"status":"done"}\n\n');
  });

  it('reports a stream the client cancelled as false instead of throwing, and closes safely', async () => {
    const { sender, reader } = await open();
    await reader.cancel();

    expect(() => sender.send({ status: 'done' })).not.toThrow();
    expect(sender.send({ status: 'done' })).toBe(false);
    expect(() => sender.close()).not.toThrow();
    expect(() => sender.close()).not.toThrow();
  });

  it('treats a second close as a no-op', async () => {
    const { sender } = await open();
    sender.close();
    expect(() => sender.close()).not.toThrow();
    expect(sender.send('x')).toBe(false);
  });
});

describe('model capabilities', () => {
  it.each([
    ['claude-sonnet-4-6', true],
    ['claude-haiku-4-5-20251001', true],
    ['claude-haiku-4-5', true],
    ['claude-opus-4-6', true],
    ['claude-opus-4-5', true],
    ['claude-3-5-sonnet-20241022', true],
    ['claude-opus-4-7', false],
    ['claude-opus-4-8', false],
    ['claude-opus-5-5', false],
    ['claude-sonnet-5-5', false],
    ['claude-haiku-5-5', false],
    ['claude-sonnet-5-5-20261001', false],
    ['claude-fable-5-1', false],
    ['some-other-model', false],
    ['', false],
  ])('modelAcceptsTemperature(%s) = %s', (model, expected) => {
    expect(modelAcceptsTemperature(model)).toBe(expected);
  });

  it.each([
    ['claude-sonnet-4-6', true],
    ['claude-opus-4-6', true],
    ['claude-opus-4-5', true],
    ['claude-sonnet-5-5', true],
    ['claude-haiku-5-5', true],
    ['claude-haiku-4-5-20251001', false],
    ['claude-sonnet-4-5', false],
    ['claude-3-5-sonnet-20241022', false],
    ['unknown', false],
  ])('modelSupportsEffort(%s) = %s', (model, expected) => {
    expect(modelSupportsEffort(model)).toBe(expected);
  });
});

describe('model configuration', () => {
  it('uses the code defaults and treats empty values as unset', () => {
    vi.stubEnv('CLAUDE_MODEL', '');
    vi.stubEnv('CLAUDE_FALLBACK_MODEL', '');
    vi.stubEnv('KALE_MODEL', '');
    expect(getClaudeModelId()).toBe(CLAUDE_DEFAULT_MODEL);
    expect(getClaudeFallbackModelId()).toBe(CLAUDE_DEFAULT_FALLBACK_MODEL);
    expect(getKaleModelId()).toBe(CLAUDE_DEFAULT_MODEL);
    vi.unstubAllEnvs();
  });

  it('resolves KALE_MODEL ahead of CLAUDE_MODEL', () => {
    vi.stubEnv('CLAUDE_MODEL', 'claude-sonnet-5-5');
    expect(getKaleModelId()).toBe('claude-sonnet-5-5');
    vi.stubEnv('KALE_MODEL', 'claude-haiku-5-5');
    expect(getKaleModelId()).toBe('claude-haiku-5-5');
    vi.unstubAllEnvs();
  });
});

describe('describeAiFailure', () => {
  const fallback = { code: 'ai_analysis_failed', message: 'Analysis failed — please try again later.' } as const;

  it('describes the typed model failures with their own codes and stable stored text', () => {
    expect(describeAiFailure(new OutputCapError('m', 4096), fallback)).toMatchObject({
      code: 'ai_output_truncated',
      stored: 'ai_output_truncated: max_tokens 4096 on m',
    });
    expect(describeAiFailure(new RefusalError('m', 'bio'), fallback)).toMatchObject({
      code: 'ai_output_refused',
      stored: 'ai_output_refused: bio on m',
    });
    expect(describeAiFailure(new ModelRejectedError('m', 401, 'authentication_error'), fallback)).toMatchObject({
      code: 'ai_service_unavailable',
      stored: 'ai_service_unavailable: HTTP 401 authentication_error on m',
    });
  });

  it('uses the route fallback for anything else, with a bounded one-line cause', () => {
    const long = new Error(`first line\n${'x'.repeat(500)}`);
    const described = describeAiFailure(long, fallback);
    expect(described.code).toBe('ai_analysis_failed');
    expect(described.message).toBe(fallback.message);
    expect(described.stored).not.toContain('\n');
    expect(described.stored.length).toBeLessThan(220);
  });

  it('records only the status of an upstream error, not its message', () => {
    const upstream = Object.assign(new Error('private provider text'), { status: 529 });
    expect(describeAiFailure(upstream, fallback).stored).toBe('ai_analysis_failed: upstream HTTP 529');
  });
});

describe('usage normalisation', () => {
  it('adds the cache fields to the Anthropic prompt total and treats null as zero', () => {
    expect(
      normalizeAnthropicUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
      }),
    ).toEqual({ promptTokens: 1110, completionTokens: 5, cacheWriteTokens: 100, cacheReadTokens: 1000 });

    const plain = normalizeAnthropicUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });
    expect(plain.promptTokens).toBe(10);
    expect(Number.isNaN(plain.promptTokens)).toBe(false);
  });

  it('keeps the AI SDK input total as is and defaults missing parts to zero', () => {
    expect(
      normalizeAiSdkUsage({ inputTokens: 900, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 40 } }),
    ).toEqual({ promptTokens: 900, completionTokens: 20, cacheWriteTokens: 40, cacheReadTokens: 800 });
    expect(normalizeAiSdkUsage(undefined)).toEqual({ promptTokens: 0, completionTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });
  });
});
