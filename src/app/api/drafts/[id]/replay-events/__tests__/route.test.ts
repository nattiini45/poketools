import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/draft-replay-events', () => ({
  getReplayEventsByPool: vi.fn(),
  createReplayEvent: vi.fn(),
}));

// The narrow pick read: `from('draft_picks').select('id, line_id').eq('draft_pool_id', id)`.
const pickRead = vi.hoisted(() => {
  const eq = vi.fn();
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: pickRead.from },
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/drafts/[id]/replay-events/route';
import { requireAdmin } from '@/lib/auth/helpers';
import { getReplayEventsByPool, createReplayEvent } from '@/lib/supabase/queries/draft-replay-events';
import { safeErrorResponse } from '@/lib/api/error-response';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeContext = { params: Promise.resolve({ id: 'pool-1' }) };

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]/replay-events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns replay events with the line id of each pick (public)', async () => {
    const events = [
      { id: 'ev-1', event_type: 'pick', draft_pool_id: 'pool-1', pick_id: 'pk-1' },
      { id: 'ev-2', event_type: 'commentary', draft_pool_id: 'pool-1', pick_id: null },
      { id: 'ev-3', event_type: 'pick', draft_pool_id: 'pool-1', pick_id: 'pk-legacy' },
    ];
    vi.mocked(getReplayEventsByPool).mockResolvedValue(events as never);
    pickRead.eq.mockResolvedValue({
      data: [
        { id: 'pk-1', line_id: 'oshawott--samurott' },
        { id: 'pk-legacy', line_id: null },
      ],
      error: null,
    });

    const res = await GET({} as NextRequest, routeContext);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      { ...events[0], line_id: 'oshawott--samurott' },
      { ...events[1], line_id: null },
      { ...events[2], line_id: null },
    ]);
    // Only the pick id and line id are read from the pick rows (no player join, no other column).
    expect(JSON.stringify(json.data)).not.toContain('player');
    expect(getReplayEventsByPool).toHaveBeenCalledWith('pool-1');
    expect(pickRead.from).toHaveBeenCalledWith('draft_picks');
    expect(pickRead.select).toHaveBeenCalledWith('id, line_id');
    expect(pickRead.eq).toHaveBeenCalledWith('draft_pool_id', 'pool-1');
  });

  it('delegates to safeErrorResponse when the pick read fails', async () => {
    vi.mocked(getReplayEventsByPool).mockResolvedValue([] as never);
    pickRead.eq.mockResolvedValue({ data: null, error: new Error('DB error') });

    await GET({} as NextRequest, routeContext);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on failure', async () => {
    vi.mocked(getReplayEventsByPool).mockRejectedValue(new Error('DB error'));
    pickRead.eq.mockResolvedValue({ data: [], error: null });

    await GET({} as NextRequest, routeContext);
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/replay-events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to safeErrorResponse on auth failure', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Not admin'));

    await POST(makeRequest({ event_type: 'commentary' }), routeContext);
    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('returns 400 when event_type missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);

    const res = await POST(makeRequest({}), routeContext);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('event_type');
  });

  it('returns 400 when event_type is pick', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);

    const res = await POST(makeRequest({ event_type: 'pick' }), routeContext);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('auto-generated');
    expect(json.code).toBe('REPLAY_PICK_EVENTS_AUTO');
  });

  it('creates commentary event successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    const created = {
      id: 'ev-3',
      event_type: 'commentary',
      draft_pool_id: 'pool-1',
      payload: { text: 'Great pick!' },
    };
    vi.mocked(createReplayEvent).mockResolvedValue(created as never);

    const res = await POST(
      makeRequest({ event_type: 'commentary', payload: { text: 'Great pick!' } }),
      routeContext,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.event_type).toBe('commentary');
    expect(createReplayEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'commentary',
        draft_pool_id: 'pool-1',
      }),
    );
  });

  it('creates pause event successfully', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    const created = { id: 'ev-4', event_type: 'pause', draft_pool_id: 'pool-1' };
    vi.mocked(createReplayEvent).mockResolvedValue(created as never);

    const res = await POST(makeRequest({ event_type: 'pause' }), routeContext);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.event_type).toBe('pause');
  });
});
