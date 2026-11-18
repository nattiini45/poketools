import { beforeEach, expect, it, vi } from 'vitest';

const { from, query } = vi.hoisted(() => ({
  from: vi.fn(),
  query: { select: vi.fn(), eq: vi.fn(), not: vi.fn(), is: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn() },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from } }));

import { listMatchesNeedingFinalize, listMatchesReadyForAutoConfirm } from '../matches';

const cutoff = '2026-11-18T01:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(query);
  for (const step of [query.select, query.eq, query.not, query.is, query.lte, query.order]) {
    step.mockReturnValue(query);
  }
  query.limit.mockResolvedValue({ data: [], error: null });
});

it.each([
  ['legacy confirm', () => listMatchesReadyForAutoConfirm(cutoff, 8), false],
  ['legacy heal', () => listMatchesNeedingFinalize(cutoff, 8), false],
  ['standalone confirm', () => listMatchesReadyForAutoConfirm(cutoff, 8, true), true],
  ['standalone heal', () => listMatchesNeedingFinalize(cutoff, 8, undefined, true), true],
] as const)('scopes %s before applying the batch limit', async (_label, read, standalone) => {
  await expect(read()).resolves.toEqual([]);
  expect(from).toHaveBeenCalledExactlyOnceWith('matches');
  expect(query.limit).toHaveBeenCalledExactlyOnceWith(8);
  if (standalone) {
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('tournament:tournaments!matches_tournament_id_fkey!inner(id)'));
    expect(query.is).toHaveBeenCalledWith('tournament.season_id', null);
    expect(query.is).toHaveBeenCalledBefore(query.limit);
  } else {
    expect(query.select).not.toHaveBeenCalledWith(expect.stringContaining('tournament:tournaments'));
    expect(query.is).not.toHaveBeenCalledWith('tournament.season_id', null);
  }
});
