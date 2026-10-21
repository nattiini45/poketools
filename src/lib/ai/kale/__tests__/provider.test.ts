import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Set env before module loads ───────────────────────────────────

vi.hoisted(() => {
  process.env.KALE_API_KEY = 'test-kale-key';
  process.env.KALE_PROVIDER = 'anthropic';
  process.env.KALE_DISABLE_FALLBACK = 'true';
});

// ─── Mocks ─────────────────────────────────────────────────────────

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn().mockReturnValue('anthropic-model')),
}));

vi.mock('@ai-sdk/openai', () => {
  const mockModel = vi.fn().mockReturnValue('openai-model');
  (mockModel as unknown as Record<string, unknown>).chat = vi.fn().mockReturnValue('openai-chat-model');
  return { createOpenAI: vi.fn().mockReturnValue(mockModel) };
});

// ─── Import after mocks ────────────────────────────────────────────

import { isKaleConfigured, kaleGenerateText, kaleStreamText } from '../provider';

// ─── Helpers ───────────────────────────────────────────────────────

function makeGenerateResult(text: string, modelId = 'test-model') {
  return {
    text,
    response: { modelId },
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
    reasoningText: undefined,
  };
}

function makeStreamResult(text: string, modelId = 'test-model') {
  return {
    text: Promise.resolve(text),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    response: Promise.resolve({ modelId }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('kale/provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isKaleConfigured', () => {
    it('returns true when KALE_API_KEY is set', () => {
      expect(isKaleConfigured()).toBe(true);
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
    });

    it('falls back to fallback model when primary fails', async () => {
      vi.stubEnv('KALE_FALLBACK_MODEL', 'fallback-model');
      mockGenerateText
        .mockRejectedValueOnce(new Error('Primary fail'))
        .mockResolvedValueOnce(makeGenerateResult('Fallback text', 'fallback-model'));

      const result = await kaleGenerateText('sys', 'user');
      expect(result.content).toBe('Fallback text');
    });

    it('throws when all attempts fail', async () => {
      mockGenerateText.mockRejectedValue(new Error('All fail'));

      await expect(kaleGenerateText('sys', 'user')).rejects.toThrow('All Kale model attempts failed');
    });

    it('uses reasoningText when text is empty', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: '',
        response: { modelId: 'reasoning-model' },
        usage: { inputTokens: 5, outputTokens: 15 },
        finishReason: 'stop',
        reasoningText: 'Reasoning output content',
      });

      const result = await kaleGenerateText('sys', 'user');
      expect(result.content).toBe('Reasoning output content');
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

    it('passes custom maxTokens and temperature', async () => {
      mockGenerateText.mockResolvedValueOnce(makeGenerateResult('ok'));

      await kaleGenerateText('sys', 'user', { maxTokens: 1024, temperature: 0.5 });

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: 1024,
          temperature: 0.5,
        })
      );
    });
  });

  describe('kaleStreamText', () => {
    it('returns streamed content from primary model', async () => {
      mockStreamText.mockReturnValueOnce(makeStreamResult('Streamed text'));

      const result = await kaleStreamText('sys', 'user');

      expect(result.content).toBe('Streamed text');
      expect(result.prompt_tokens).toBe(10);
    });

    it('falls back to fallback model streaming on primary failure', async () => {
      vi.stubEnv('KALE_FALLBACK_MODEL', 'fallback-model');
      mockStreamText
        .mockReturnValueOnce({ text: Promise.reject(new Error('Stream fail')) })
        .mockReturnValueOnce(makeStreamResult('Fallback stream'));

      const result = await kaleStreamText('sys', 'user');
      expect(result.content).toBe('Fallback stream');
    });

    it('falls back to blocking kaleGenerateText when all streaming fails', async () => {
      mockStreamText.mockReturnValue({
        text: Promise.reject(new Error('All streams fail')),
      });

      mockGenerateText.mockResolvedValueOnce(makeGenerateResult('Blocking fallback'));

      const result = await kaleStreamText('sys', 'user');
      expect(result.content).toBe('Blocking fallback');
    });

    it('calls onChunk callback via streamText options', async () => {
      mockStreamText.mockImplementationOnce((opts: Record<string, unknown>) => {
        const onChunk = opts.onChunk as (() => void) | undefined;
        onChunk?.();
        return makeStreamResult('text');
      });

      const onChunk = vi.fn();
      await kaleStreamText('sys', 'user', onChunk);
      expect(mockStreamText).toHaveBeenCalled();
    });
  });
});
