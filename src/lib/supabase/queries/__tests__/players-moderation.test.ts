import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'update', 'eq', 'lte', 'not', 'or', 'order', 'range']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { clearExpiredSuspensions, playerSearchFilter } from '../players';

describe('playerSearchFilter', () => {
  it('searches name and ps_username with a contains pattern', () => {
    expect(playerSearchFilter('ash')).toBe('name.ilike."%ash%",ps_username.ilike."%ash%"');
  });

  it('escapes LIKE wildcards so they match literally', () => {
    // LIKE escape (`\%`), then the backslash is doubled inside the quoted PostgREST value.
    expect(playerSearchFilter('50%_x')).toBe(
      String.raw`name.ilike."%50\\%\\_x%",ps_username.ilike."%50\\%\\_x%"`,
    );
  });

  it('keeps commas, parentheses and quotes inside the quoted pattern', () => {
    const filter = playerSearchFilter('a,b)"c');
    expect(filter).toBe('name.ilike."%a,b)\\"c%",ps_username.ilike."%a,b)\\"c%"');
  });
});

describe('clearExpiredSuspensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of Object.keys(mockBuilder)) mockBuilder[m].mockReturnValue(mockBuilder);
  });

  it('reinstates only suspended players whose suspension has run out', async () => {
    mockBuilder.select.mockResolvedValue({ data: [{ id: 'p-1', name: 'Ash' }], error: null });

    const lifted = await clearExpiredSuspensions('2026-10-23T12:00:00.000Z');

    expect(lifted).toEqual([{ id: 'p-1', name: 'Ash' }]);
    expect(mockBuilder.from).toHaveBeenCalledWith('players');
    expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'active', suspended_until: null });
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'suspended');
    expect(mockBuilder.not).toHaveBeenCalledWith('suspended_until', 'is', null);
    expect(mockBuilder.lte).toHaveBeenCalledWith('suspended_until', '2026-10-23T12:00:00.000Z');
  });

  it('returns an empty list when nothing expired', async () => {
    mockBuilder.select.mockResolvedValue({ data: [], error: null });

    await expect(clearExpiredSuspensions('2026-10-23T12:00:00.000Z')).resolves.toEqual([]);
  });

  it('throws the database error', async () => {
    const failure = new Error('fail');
    mockBuilder.select.mockResolvedValue({ data: null, error: failure });

    await expect(clearExpiredSuspensions('2026-10-23T12:00:00.000Z')).rejects.toBe(failure);
  });
});
