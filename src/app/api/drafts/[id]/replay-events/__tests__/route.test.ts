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
  getNextSequenceNumber: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
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
import { getReplayEventsByPool, createReplayEvent, getNextSequenceNumber } from '@/lib/supabase/queries/draft-replay-events';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { safeErrorResponse } from '@/lib/api/error-response';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const POOL = '55555555-5555-4555-8555-555555555555';
const routeContext = { params: Promise.resolve({ id: POOL }) };

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]/replay-events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns replay events with the line id of each pick (public)', async () => {
    const events = [
      { id: 'ev-1', event_type: 'pick', draft_pool_id: '55555555-5555-4555-8555-555555555555', pick_id: 'pk-1' },
      { id: 'ev-2', event_type: 'commentary', draft_pool_id: '55555555-5555-4555-8555-555555555555', pick_id: null },
      { id: 'ev-3', event_type: 'pick', draft_pool_id: '55555555-5555-4555-8555-555555555555', pick_id: 'pk-legacy' },
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
    expect(getReplayEventsByPool).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
    expect(pickRead.from).toHaveBeenCalledWith('draft_picks');
    expect(pickRead.select).toHaveBeenCalledWith('id, line_id');
    expect(pickRead.eq).toHaveBeenCalledWith('draft_pool_id', '55555555-5555-4555-8555-555555555555');
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

  it('refuses a malformed pool id with POOL_NOT_FOUND before reading the body or writing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    const json = vi.fn(() => Promise.resolve({ event_type: 'commentary' }));

    await POST({ json } as unknown as NextRequest, { params: Promise.resolve({ id: 'not-a-uuid' }) });

    expect(json).not.toHaveBeenCalled();
    expect(createReplayEvent).not.toHaveBeenCalled();
    const [err] = vi.mocked(safeErrorResponse).mock.calls[0];
    expect(err).toMatchObject({ code: 'POOL_NOT_FOUND', statusCode: 404 });
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

  it('writes only the parsed body: data becomes event_data, the server assigns the sequence', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL } as never);
    vi.mocked(getNextSequenceNumber).mockResolvedValue(7);
    const created = { id: 'ev-3', event_type: 'commentary', draft_pool_id: POOL };
    vi.mocked(createReplayEvent).mockResolvedValue(created as never);

    const res = await POST(
      makeRequest({ event_type: 'commentary', data: { text: 'Great pick!', author: 'Caster' }, display_duration_ms: 4000 }),
      routeContext,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, data: created });
    expect(getNextSequenceNumber).toHaveBeenCalledWith(POOL);
    // Exactly this shape: no client sequence_number, pick_id or wall_clock_time reaches the insert.
    expect(createReplayEvent).toHaveBeenCalledWith({
      draft_pool_id: POOL,
      event_type: 'commentary',
      event_data: { text: 'Great pick!', author: 'Caster' },
      sequence_number: 7,
      display_duration_ms: 4000,
    });
  });

  it('creates a pause event with its typed data', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL } as never);
    vi.mocked(getNextSequenceNumber).mockResolvedValue(1);
    vi.mocked(createReplayEvent).mockResolvedValue({ id: 'ev-4', event_type: 'pause', draft_pool_id: POOL } as never);

    const res = await POST(
      makeRequest({ event_type: 'pause', data: { reason: 'Break', original_duration_hours: null } }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(createReplayEvent).toHaveBeenCalledWith({
      draft_pool_id: POOL,
      event_type: 'pause',
      event_data: { reason: 'Break', original_duration_hours: null },
      sequence_number: 1,
      display_duration_ms: undefined,
    });
  });

  it.each([
    ['client-controlled columns', { event_type: 'commentary', data: { text: 'x', author: 'y' }, sequence_number: 1, pick_id: POOL, wall_clock_time: '2020-01-01T00:00:00Z' }],
    ['a kind without data', { event_type: 'pause' }],
    ['data of another kind', { event_type: 'trade', data: { text: 'x', author: 'y' } }],
    ['an unknown kind', { event_type: 'resume', data: {} }],
  ])('rejects %s with 400 validation_failed and writes nothing', async (_label, body) => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);

    const res = await POST(makeRequest(body), routeContext);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(createReplayEvent).not.toHaveBeenCalled();
  });

  it('answers 404 POOL_NOT_FOUND for a well-formed id that names no pool, without writing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(null);

    await POST(makeRequest({ event_type: 'commentary', data: { text: 'x', author: 'y' } }), routeContext);

    const [err] = vi.mocked(safeErrorResponse).mock.calls[0];
    expect(err).toMatchObject({ code: 'POOL_NOT_FOUND', statusCode: 404 });
    expect(getNextSequenceNumber).not.toHaveBeenCalled();
    expect(createReplayEvent).not.toHaveBeenCalled();
  });
});
