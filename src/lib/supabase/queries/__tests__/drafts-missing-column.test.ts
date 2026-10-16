/**
 * Deploy-before-migrate guard (review G2, finding 2): when the queue-engine
 * columns of `draft_pools` are missing, `getDraftPoolsBySeason` logs and
 * answers [] so the league pages do not 500. Other errors still throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq', 'order']) mb[m] = vi.fn().mockReturnValue(mb);
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { getDraftPoolsBySeason } from '../drafts';

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq', 'order']) mockBuilder[m]?.mockReturnValue(mockBuilder);
});

describe('getDraftPoolsBySeason before the migrations', () => {
  it.each(['42703', 'PGRST204'])('returns [] and logs on a missing-column error (%s)', async (code) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockBuilder.order?.mockResolvedValueOnce({
      data: null,
      error: { code, message: 'column draft_pools.engine does not exist', details: null, hint: null },
    });
    await expect(getDraftPoolsBySeason('s-1')).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('still throws on any other error', async () => {
    const err = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };
    mockBuilder.order?.mockResolvedValueOnce({ data: null, error: err });
    await expect(getDraftPoolsBySeason('s-1')).rejects.toBe(err);
  });
});
