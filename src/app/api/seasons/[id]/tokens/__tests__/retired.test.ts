/**
 * Retired endpoints (draft-backend §8.1 #29, #30): `draft-tokens` and `kill-tokens` answer
 * `410 ENDPOINT_REPLACED` for every caller and touch no data.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import { POST as postDraftTokens } from '../../draft-tokens/route';
import { GET as getKillTokens, POST as postKillTokens } from '../../kill-tokens/route';
import { supabase } from '@/lib/supabase/client';

describe('retired token endpoints', () => {
  it.each([
    ['POST draft-tokens', postDraftTokens],
    ['GET kill-tokens', getKillTokens],
    ['POST kill-tokens', postKillTokens],
  ])('%s → 410 ENDPOINT_REPLACED', async (_name, handler) => {
    const res = await handler();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      success: false,
      error: 'This endpoint was replaced.',
      code: 'ENDPOINT_REPLACED',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
