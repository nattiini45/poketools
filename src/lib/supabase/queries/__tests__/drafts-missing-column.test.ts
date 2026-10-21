/**
 * `getDraftPoolsBySeason` has no deploy-before-migrate fallback any more (lead ruling round 5, AGENTS.md rule 5):
 * a schema without the queue-engine columns of `draft_pools` answers 42703 / PGRST204, and that error propagates
 * like every other read error, so no league page or world payload reads "no draft" from a failed read. The
 * release order is migrate first (README "Release order").
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
  it.each(['42703', 'PGRST204'])('propagates a missing-column error (%s) instead of answering []', async (code) => {
    const err = { code, message: 'column draft_pools.engine does not exist', details: null, hint: null };
    mockBuilder.order?.mockResolvedValueOnce({ data: null, error: err });
    await expect(getDraftPoolsBySeason('s-1')).rejects.toBe(err);
  });

  it('throws on any other error too', async () => {
    const err = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };
    mockBuilder.order?.mockResolvedValueOnce({ data: null, error: err });
    await expect(getDraftPoolsBySeason('s-1')).rejects.toBe(err);
  });
});
