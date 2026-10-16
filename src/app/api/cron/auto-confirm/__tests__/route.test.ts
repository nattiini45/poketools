import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/match/finalize', () => ({
  finalizeMatchCompletion: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  listMatchesReadyForAutoConfirm: vi.fn(),
  updateMatchStatus: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/cron/auto-confirm/route';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { listMatchesReadyForAutoConfirm, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { logAuditEvent } from '@/lib/audit/log';

const originalCronSecret = process.env.CRON_SECRET;
const match = {
  id: 'match-1',
  round_id: 'round-1',
  tournament_id: 'tournament-1',
  player_1_id: 'player-1',
  player_2_id: 'player-2',
  winner_id: 'player-1',
  status: 'pending_confirmation',
  submitter_id: 'player-2',
  date_played: null,
  scheduled_at: null,
  auto_confirm_at: '2026-05-21T00:00:00Z',
  confirmed_at: null,
  notes: '',
  social_image_url: null,
  created_at: '2026-05-20T00:00:00Z',
  updated_at: '2026-05-20T00:00:00Z',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_name: 'Alice',
  round_status: 'active',
  games: [],
};

function request(secret = 'secret') {
  return new Request('http://localhost/api/cron/auto-confirm?limit=5', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('POST /api/cron/auto-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValue([match] as never);
    vi.mocked(updateMatchStatus).mockResolvedValue({ ...match, status: 'completed' } as never);
    vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });

  it('returns cron_not_configured and logs when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('cron_not_configured');
    expect(errorSpy).toHaveBeenCalledWith('[cron/auto-confirm] CRON_SECRET not configured');
    expect(listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rejects unauthorized cron calls', async () => {
    const res = await POST(request('wrong'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('cron_unauthorized');
    expect(listMatchesReadyForAutoConfirm).not.toHaveBeenCalled();
  });

  it('completes ready pending confirmations through the shared finalizer', async () => {
    const res = await POST(request());
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.completed).toBe(1);
    expect(listMatchesReadyForAutoConfirm).toHaveBeenCalledWith(expect.any(String), 5);
    expect(updateMatchStatus).toHaveBeenCalledWith(
      'match-1',
      'completed',
      'player-1',
      undefined,
      'Auto-confirmed after timeout.'
    );
    expect(finalizeMatchCompletion).toHaveBeenCalledWith({
      match,
      winnerId: 'player-1',
      previousStatus: 'pending_confirmation',
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.auto_confirm' }));
  });

  it('skips ready matches without a winner', async () => {
    vi.mocked(listMatchesReadyForAutoConfirm).mockResolvedValueOnce([{ ...match, winner_id: null }] as never);

    const res = await POST(request());
    const body = await res.json();

    expect(body.data.completed).toBe(0);
    expect(body.data.skipped_no_winner).toBe(1);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });
});