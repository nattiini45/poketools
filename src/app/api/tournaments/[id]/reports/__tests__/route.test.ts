import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/supabase/queries/tournament-reports', () => ({
  getTournamentReports: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

import { GET } from '../route';
import { getTournamentReports } from '@/lib/supabase/queries/tournament-reports';
import { safeErrorResponse } from '@/lib/api/error-response';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const mockGetReports = getTournamentReports as ReturnType<typeof vi.fn>;

describe('GET /api/tournaments/[id]/reports', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns reports for a tournament', async () => {
    const reports = [
      { id: 'r-1', tournament_id: 't-1', title: 'Week 1 Report' },
      { id: 'r-2', tournament_id: 't-1', title: 'Week 2 Report' },
    ];
    mockGetReports.mockResolvedValue(reports);

    const res = await GET(makeRequest(), { params: makeParams({ id: 't-1' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(reports);
    expect(mockGetReports).toHaveBeenCalledWith('t-1');
  });

  it('returns 500 on error via safeErrorResponse', async () => {
    mockGetReports.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest(), { params: makeParams({ id: 't-1' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to list tournament reports');
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
