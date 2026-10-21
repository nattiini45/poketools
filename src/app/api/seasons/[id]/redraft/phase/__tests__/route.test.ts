import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
  setRedraftPhaseOpen: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/season/epb-phase', () => ({
  getEpbPhaseStatus: vi.fn(),
}));

import { PATCH } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { setRedraftPhaseOpen } from '@/lib/supabase/queries/format-rules';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';

const seasonId = '00000000-0000-4000-8000-000000000001';

async function patch(body: Record<string, unknown>) {
  const res = await PATCH(makeRequest(body), { params: makeParams({ id: seasonId }) });
  return { res, json: await res.json() };
}

describe('PATCH /api/seasons/[id]/redraft/phase error codes (errors/draft-legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: 'admin-1', isAdmin: true }));
    vi.mocked(getSeasonById).mockResolvedValue({ id: seasonId, format_type: 'evolution_point_buy' } as never);
    vi.mocked(getEpbPhaseStatus).mockResolvedValue({ hinrunde_complete: false } as never);
  });

  it('validation_failed keeps the English text and sends the issues as its param', async () => {
    const { res, json } = await patch({ open: 'yes' });

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(setRedraftPhaseOpen).not.toHaveBeenCalled();
  });

  it('redraft_hinrunde_incomplete while the first half is still running', async () => {
    const { res, json } = await patch({ open: true });

    expect(res.status).toBe(400);
    expect(json.error).toBe('Cannot open redraft until the Hinrunde (first half) is complete');
    expect(json.code).toBe('redraft_hinrunde_incomplete');
    expect(setRedraftPhaseOpen).not.toHaveBeenCalled();
  });
});
