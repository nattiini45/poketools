import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn(), deleteMatchOutcome: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { createOutcomeTakeback } from '../outcome-takeback';
import { logger } from '@/lib/logger';

describe('fenced outcome takeback', () => {
  it('keeps a replacement row staged after the mark was read', async () => {
    let row: { set_at: string } | null = { set_at: 'before' };
    const remove = vi.fn(async (_id: string, options: { onlyIfSetAt: string }) => {
      if (row?.set_at !== options.onlyIfSetAt) return 0;
      row = null;
      return 1;
    });
    const outcome = createOutcomeTakeback({ getMatchOutcome: async () => row, deleteMatchOutcome: remove });
    const mark = await outcome.readOutcomeMark('match');
    row = { set_at: 'after' };
    expect(await outcome.takeBackMarkedOutcome('match', mark)).toBe(true);
    expect(remove).toHaveBeenCalledWith('match', { onlyIfSetAt: 'before' });
    expect(row).toEqual({ set_at: 'after' });
  });

  it('does not issue a delete when no row existed', async () => {
    const remove = vi.fn(async () => 0);
    const outcome = createOutcomeTakeback({ getMatchOutcome: async () => null, deleteMatchOutcome: remove });
    const mark = await outcome.readOutcomeMark('match');
    await outcome.deleteMarkedOutcome('match', mark);
    expect(remove).not.toHaveBeenCalled();
  });

  it('propagates reads and strict deletes but logs best-effort failures', async () => {
    const error = new Error('storage unavailable');
    const outcome = createOutcomeTakeback({
      getMatchOutcome: vi.fn().mockRejectedValue(error),
      deleteMatchOutcome: vi.fn().mockRejectedValue(error),
    });
    await expect(outcome.readOutcomeMark('match')).rejects.toBe(error);
    await expect(outcome.deleteMarkedOutcome('match', 'before')).rejects.toBe(error);
    expect(await outcome.takeBackMarkedOutcome('match', 'before')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('match/outcome', expect.any(String), { matchId: 'match', error });
  });
});
