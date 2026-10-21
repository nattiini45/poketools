import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolBySeasonGroup: vi.fn(),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn() }));

import { getInitialPoolForPlayer } from '../player-pool';
import {
  getDraftPoolBySeason,
  getDraftPoolBySeasonGroup,
  GroupedLeaguePoolLookupError,
} from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';

const SEASON = 's1';
const POOL = { id: 'pool-1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getInitialPoolForPlayer', () => {
  it('a league without groups reads exactly the season’s pool (one query, no group read)', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(POOL);
    await expect(getInitialPoolForPlayer(SEASON, 'p1')).resolves.toBe(POOL);
    expect(getDraftPoolBySeason).toHaveBeenCalledWith(SEASON);
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
    expect(getDraftPoolBySeasonGroup).not.toHaveBeenCalled();
  });

  it('a league with groups reads the trainer’s own group’s initial pool', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue({ id: 'g-b', season_id: SEASON, name: 'Group B', sort_order: 2 });
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValue(POOL);
    await expect(getInitialPoolForPlayer(SEASON, 'p1')).resolves.toBe(POOL);
    expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON, 'p1');
    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON, 'g-b', 'initial');
  });

  it('a pending viewer is read only in a league with groups', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);
    const read = vi.fn(async () => 'p2');
    await expect(getInitialPoolForPlayer(SEASON, read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON, 'p2');
  });

  it('a failing viewer read in a league with groups propagates (nothing swallowed)', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON));
    const boom = new Error('session read failed');
    await expect(getInitialPoolForPlayer(SEASON, () => Promise.reject(boom))).rejects.toBe(boom);
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
  });

  it('nobody in particular, or a trainer in no group: no pool in a league with groups', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(new GroupedLeaguePoolLookupError(SEASON));
    await expect(getInitialPoolForPlayer(SEASON, null)).resolves.toBeNull();
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);
    await expect(getInitialPoolForPlayer(SEASON, 'p3')).resolves.toBeNull();
    expect(getDraftPoolBySeasonGroup).not.toHaveBeenCalled();
  });

  it('every other error propagates unchanged', async () => {
    const boom = new Error('connection reset');
    vi.mocked(getDraftPoolBySeason).mockRejectedValue(boom);
    await expect(getInitialPoolForPlayer(SEASON, 'p1')).rejects.toBe(boom);
    expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
  });

  it('a league without groups never reads the pending viewer', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(POOL);
    const read = vi.fn(async () => 'p1');
    await expect(getInitialPoolForPlayer(SEASON, read)).resolves.toBe(POOL);
    expect(read).not.toHaveBeenCalled();
  });
});
