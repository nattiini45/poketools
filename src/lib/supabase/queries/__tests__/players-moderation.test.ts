import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'update', 'eq', 'lte', 'not', 'or', 'order', 'range', 'single']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { banPlayer, clearExpiredSuspensions, playerSearchFilter, suspendPlayer, unsuspendPlayer } from '../players';

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

describe('moderation and the session epoch', () => {
  const NOW = new Date('2026-11-02T12:00:00.000Z');
  const row = {
    id: 'p-1',
    name: 'Ash',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: '2026-01-01',
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const m of Object.keys(mockBuilder)) mockBuilder[m].mockReturnValue(mockBuilder);
    mockBuilder.single.mockResolvedValue({ data: row, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a ban ends the sessions the player holds', async () => {
    await banPlayer('p-1', 'cheating');
    expect(mockBuilder.update).toHaveBeenCalledWith({
      status: 'banned',
      ban_reason: 'cheating',
      suspended_until: null,
      sessions_valid_after: NOW.toISOString(),
    });
  });

  it('a suspension ends the sessions the player holds', async () => {
    await suspendPlayer('p-1', '2026-12-01T00:00:00.000Z');
    expect(mockBuilder.update).toHaveBeenCalledWith({
      status: 'suspended',
      suspended_until: '2026-12-01T00:00:00.000Z',
      ban_reason: null,
      sessions_valid_after: NOW.toISOString(),
    });
  });

  it('lifting a sanction leaves the epoch alone, so an old token stays dead', async () => {
    await unsuspendPlayer('p-1');
    expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'active', suspended_until: null, ban_reason: null });
  });

  it('the automatic end of a suspension leaves the epoch alone too', async () => {
    mockBuilder.select.mockResolvedValue({ data: [], error: null });
    await clearExpiredSuspensions('2026-10-23T12:00:00.000Z');
    expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'active', suspended_until: null });
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
