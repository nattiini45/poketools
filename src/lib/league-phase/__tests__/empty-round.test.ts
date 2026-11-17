import { expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc } }));

import { createPhaseRound } from '@/lib/supabase/queries/phase-rounds';

it('keeps empty-round creation separate from starting a phase', async () => {
  rpc.mockResolvedValue({ data: { round: { id: 'round', phase_id: 'phase', status: 'pending' } }, error: null });
  await createPhaseRound({ phase_id: 'phase', name: 'Finals', round_number: 1, best_of: 3 });
  expect(rpc).toHaveBeenCalledWith('phase_round_write', expect.objectContaining({
    p_start_phase: false, p_matches: [], p_round_id: null,
  }));
});
