import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getTrackerById: vi.fn(),
  applyTrackerProgressWithLog: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/progress-log', () => ({
  getLatestProgressEntry: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/match/evolution-match-evaluator', () => ({
  recheckEpbStages: vi.fn(),
}));

import { POST } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { applyTrackerProgressWithLog, getTrackerById } from '@/lib/supabase/queries/evolutions';
import { getLatestProgressEntry } from '@/lib/supabase/queries/progress-log';
import { getSeasonById } from '@/lib/supabase/queries/seasons';

const seasonId = '00000000-0000-4000-8000-000000000001';
const trackerId = '00000000-0000-4000-8000-000000000002';

const correction = { tracker_id: trackerId, source: 'real_kill', amount: 1 };

async function post(body: Record<string, unknown>) {
  const res = await POST(makeRequest(body), { params: makeParams({ id: seasonId }) });
  return { res, json: await res.json() };
}

describe('POST /api/seasons/[id]/progress error codes (errors/draft-legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: 'admin-1', isAdmin: true }));
    vi.mocked(getSeasonById).mockResolvedValue({ id: seasonId, format_type: 'evolution_point_buy' } as never);
    vi.mocked(getTrackerById).mockResolvedValue({ id: trackerId, season_id: seasonId, player_id: 'p1' } as never);
    vi.mocked(applyTrackerProgressWithLog).mockResolvedValue(undefined as never);
  });

  it('validation_failed keeps the English text and sends the issues as its param', async () => {
    const { res, json } = await post({ ...correction, amount: 1000 });

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(applyTrackerProgressWithLog).not.toHaveBeenCalled();
  });

  it('progress_tracker_not_in_season for a tracker of another season', async () => {
    vi.mocked(getTrackerById).mockResolvedValue({ id: trackerId, season_id: 'other', player_id: 'p1' } as never);

    const { res, json } = await post(correction);

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tracker not found in this season');
    expect(json.code).toBe('progress_tracker_not_in_season');
    expect(applyTrackerProgressWithLog).not.toHaveBeenCalled();
  });

  it('progress_audit_unreadable when the log entry cannot be read back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getLatestProgressEntry).mockResolvedValue(null as never);

    const { res, json } = await post(correction);

    expect(res.status).toBe(500);
    expect(json.error).toBe('Correction applied but audit entry could not be read back');
    expect(json.code).toBe('progress_audit_unreadable');
  });
});
