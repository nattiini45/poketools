import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndRecordAiGeneration: vi.fn(),
}));

vi.mock('@/lib/ai/agent/orchestrator', () => ({
  runAgent: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/ai/agent/chat/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { checkAndRecordAiGeneration } from '@/lib/ai/rate-limit';
import { runAgent } from '@/lib/ai/agent/orchestrator';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: unknown, cookie?: string) =>
  ({
    json: () => Promise.resolve(body),
    headers: new Headers(cookie ? { cookie } : {}),
  }) as unknown as NextRequest;

const mockPlayer = { playerId: 'player-1', name: 'Ash', isAdmin: false };

const validBody = { messages: [{ role: 'user', content: 'hi' }], persona: 'linden_teambuilding' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: true, limit: 20, remaining: 19, used: 1 });
});

describe('POST /api/ai/agent/chat', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });

    const res = await POST(makeRequest(validBody));
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(json.error).toContain('limit reached');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const res = await POST(makeRequest({ messages: [] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('streams the agent response on the happy path', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { toUIMessageStreamResponse: () => new Response('streamed') },
      getMetadata: () => ({}),
    } as never);

    const res = await POST(makeRequest(validBody));
    expect(await res.text()).toBe('streamed');
    expect(runAgent).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runAgent).mock.calls[0][0];
    expect(arg.userId).toBe('player-1');
    expect(arg.persona).toBe('linden_teambuilding');
  });

  it('exposes the persisted conversation id as the X-Agent-Conversation-Id header', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(runAgent).mockResolvedValue({
      // Honour the headers option the route passes to the AI SDK helper.
      result: { toUIMessageStreamResponse: (opts?: ResponseInit) => new Response('streamed', opts) },
      getMetadata: () => ({ conversation_id: 'conv-42' }),
    } as never);

    const res = await POST(makeRequest(validBody));
    expect(res.headers.get('X-Agent-Conversation-Id')).toBe('conv-42');
  });

  it('forwards a client-supplied conversation_id to runAgent', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { toUIMessageStreamResponse: () => new Response('streamed') },
      getMetadata: () => ({}),
    } as never);

    const convId = '11111111-1111-4111-8111-111111111111';
    await POST(makeRequest({ ...validBody, conversation_id: convId }));
    expect(vi.mocked(runAgent).mock.calls[0][0].conversationId).toBe(convId);
  });

  it('answers in the viewer’s UI language (English without the cookie)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(runAgent).mockResolvedValue({
      result: { toUIMessageStreamResponse: () => new Response('streamed') },
      getMetadata: () => ({}),
    } as never);

    await POST(makeRequest(validBody, 'plc_locale=de'));
    expect(vi.mocked(runAgent).mock.calls[0][0].outputLocale).toBe('de');

    await POST(makeRequest(validBody));
    expect(vi.mocked(runAgent).mock.calls[1][0].outputLocale).toBe('en');
  });

  it('sends a code (and params) next to the unchanged English error', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);

    const invalid = await (await POST(makeRequest({ messages: [] }))).json();
    expect(invalid).toMatchObject({ code: 'validation_failed', params: { issues: invalid.error } });

    vi.mocked(checkAndRecordAiGeneration).mockResolvedValue({ allowed: false, limit: 20, remaining: 0, used: 20 });
    expect(await (await POST(makeRequest(validBody))).json()).toMatchObject({
      error: 'AI agent limit reached (20 per day). Try again later.',
      code: 'daily_limit_reached',
      params: { limit: 20 },
    });
  });
});
