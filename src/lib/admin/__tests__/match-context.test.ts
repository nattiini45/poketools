import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentWithDetails: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  resolvePlayerNames: vi.fn(),
}));

import { loadAdminMatchContext } from '../match-context';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import type { MatchWithPlayers } from '@/types/match';

const round = {
  id: 'round-1',
  name: 'Quarterfinals',
  round_number: 2,
  best_of: 3,
  status: 'active',
  deadline: '2026-10-30T20:00:00Z',
};
const tournament = {
  id: 'tourn-1',
  name: 'Group Stage',
  season_id: 'season-1',
  season_name: 'Autumn League',
};

function match(overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: 'match-1',
    round_id: 'round-1',
    tournament_id: 'tourn-1',
    submitter_id: 'p1',
    ...overrides,
  } as MatchWithPlayers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRoundById).mockResolvedValue(round as never);
  vi.mocked(getTournamentWithDetails).mockResolvedValue(tournament as never);
  vi.mocked(resolvePlayerNames).mockResolvedValue({ p1: 'Alice' });
});

describe('loadAdminMatchContext', () => {
  it('assembles league, phase, round and submitter', async () => {
    await expect(loadAdminMatchContext(match())).resolves.toEqual({
      league_id: 'season-1',
      league_name: 'Autumn League',
      phase_id: 'tourn-1',
      phase_name: 'Group Stage',
      round_id: 'round-1',
      round_name: 'Quarterfinals',
      round_number: 2,
      round_status: 'active',
      best_of: 3,
      round_deadline: '2026-10-30T20:00:00Z',
      submitter_name: 'Alice',
    });
    expect(getRoundById).toHaveBeenCalledWith('round-1');
    expect(getTournamentWithDetails).toHaveBeenCalledWith('tourn-1');
    expect(resolvePlayerNames).toHaveBeenCalledWith(['p1']);
  });

  it('has no league for a standalone tournament', async () => {
    vi.mocked(getTournamentWithDetails).mockResolvedValue({
      ...tournament,
      season_id: null,
      season_name: null,
    } as never);

    const context = await loadAdminMatchContext(match());

    expect(context.league_id).toBeNull();
    expect(context.league_name).toBeNull();
  });

  it('skips the name lookup and returns null when nobody reported the match', async () => {
    const context = await loadAdminMatchContext(match({ submitter_id: null }));

    expect(context.submitter_name).toBeNull();
    expect(resolvePlayerNames).not.toHaveBeenCalled();
  });

  it('returns a null submitter name when the player row is gone', async () => {
    vi.mocked(resolvePlayerNames).mockResolvedValue({});

    expect((await loadAdminMatchContext(match())).submitter_name).toBeNull();
  });

  it('keeps a round without a deadline', async () => {
    vi.mocked(getRoundById).mockResolvedValue({ ...round, deadline: null } as never);

    expect((await loadAdminMatchContext(match())).round_deadline).toBeNull();
  });

  it('throws when the round or the tournament is missing', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null);
    await expect(loadAdminMatchContext(match())).rejects.toThrow(/Round round-1 not found/);

    vi.mocked(getRoundById).mockResolvedValue(round as never);
    vi.mocked(getTournamentWithDetails).mockResolvedValue(null);
    await expect(loadAdminMatchContext(match())).rejects.toThrow(/Tournament tourn-1 not found/);
  });
});
