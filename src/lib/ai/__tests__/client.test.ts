import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Set env before module loads ───────────────────────────────────

vi.hoisted(() => {
  process.env.CLAUDE_API_KEY = 'test-key';
});

// ─── Mocks ─────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  // Must use function() (not arrow) so it works with `new Anthropic()`
  const MockAnthropic = vi.fn(function (this: Record<string, unknown>) {
    this.messages = { create: mockCreate, stream: mockStream };
  });
  return { default: MockAnthropic };
});

vi.mock('braintrust', () => ({
  initLogger: vi.fn(),
  wrapAnthropic: vi.fn((client: unknown) => client),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { complete, completeStreaming } from '../client';

// ─── Helpers ───────────────────────────────────────────────────────

function makeTextBlock(text: string) {
  return { type: 'text' as const, text };
}

function makeResponse(text: string, model = 'claude-sonnet-4-6') {
  return {
    content: [makeTextBlock(text)],
    model,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ai/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('complete', () => {
    it('returns content from primary model', async () => {
      mockCreate.mockResolvedValueOnce(makeResponse('Hello world'));

      const result = await complete('system prompt', 'user prompt');

      expect(result.content).toBe('Hello world');
      expect(result.model).toBe('claude-sonnet-4-6');
      expect(result.prompt_tokens).toBe(10);
      expect(result.completion_tokens).toBe(20);
    });

    it('falls back to secondary model when primary fails', async () => {
      mockCreate
        .mockRejectedValueOnce(new Error('Primary fail'))
        .mockResolvedValueOnce(makeResponse('Fallback response', 'claude-haiku-4-5-20251001'));

      const result = await complete('sys', 'user');

      expect(result.content).toBe('Fallback response');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('throws when both primary and fallback fail', async () => {
      mockCreate
        .mockRejectedValueOnce(new Error('Primary fail'))
        .mockRejectedValueOnce(new Error('Fallback fail'));

      await expect(complete('sys', 'user')).rejects.toThrow('Fallback fail');
    });

    it('throws on empty response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 5, output_tokens: 0 },
      });

      // Empty text from primary triggers fallback
      mockCreate.mockResolvedValueOnce(makeResponse('Recovered'));
      const result = await complete('sys', 'user');
      expect(result.content).toBe('Recovered');
    });

    it('filters non-text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'tool_use', text: 'ignored' },
          makeTextBlock('real text'),
        ],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const result = await complete('sys', 'user');
      expect(result.content).toBe('real text');
    });

    it('joins multiple text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [makeTextBlock('part1'), makeTextBlock('part2')],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const result = await complete('sys', 'user');
      expect(result.content).toBe('part1part2');
    });
  });

  describe('completeStreaming', () => {
    it('returns content from streaming primary model', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'text' } },
      ];

      mockStream.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
        abort: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue({
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 15, output_tokens: 25 },
        }),
      });

      const onChunk = vi.fn();
      const result = await completeStreaming('sys', 'user', onChunk);

      expect(result.content).toBe('streamed text');
      expect(result.prompt_tokens).toBe(15);
      expect(result.completion_tokens).toBe(25);
      expect(onChunk).toHaveBeenCalled();
    });

    it('falls back to secondary streaming on primary failure', async () => {
      mockStream.mockImplementationOnce(() => {
        throw new Error('Stream fail');
      });

      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fallback' } },
      ];
      mockStream.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
        abort: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue({
          model: 'claude-haiku-4-5-20251001',
          usage: { input_tokens: 5, output_tokens: 10 },
        }),
      });

      const result = await completeStreaming('sys', 'user');
      expect(result.content).toBe('fallback');
    });

    it('falls back to blocking complete when all streaming fails', async () => {
      mockStream
        .mockImplementationOnce(() => { throw new Error('Primary stream fail'); })
        .mockImplementationOnce(() => { throw new Error('Fallback stream fail'); });

      // Blocking complete fallback
      mockCreate.mockResolvedValueOnce(makeResponse('blocking result'));

      const result = await completeStreaming('sys', 'user');
      expect(result.content).toBe('blocking result');
    });

    it('calls onChunk for each event', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } },
        { type: 'message_start', delta: {} },
      ];

      mockStream.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
        abort: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue({
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
      });

      const onChunk = vi.fn();
      await completeStreaming('sys', 'user', onChunk);
      // onChunk called for every event (3 events)
      expect(onChunk).toHaveBeenCalledTimes(3);
    });
  });
});
