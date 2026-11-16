import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ supabase: db }));
import { getComparisonRegisteredRoster } from '../team-comparison';

function query(data: unknown) {
  const value = { data, error: null };
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(value),
    then: (resolve: (result: typeof value) => unknown) => Promise.resolve(resolve(value)),
  };
  return builder;
}

beforeEach(() => vi.clearAllMocks());

it('fails closed for the newest hidden row, without parsing or leaking its raw Pokemon', async () => {
  const teams = query({ player_id: 'other', match_id: null, library_published_at: null, pokemon: 'private invalid data', tournaments: { team_visibility: 'hidden_until_match' }, matches: null });
  db.from.mockReturnValueOnce(query([{ id: 'phase' }])).mockReturnValueOnce(teams);
  expect(await getComparisonRegisteredRoster('league', 'other', 'mine')).toEqual({ hidden: true, species: [] });
  expect(teams.limit).toHaveBeenCalledWith(1);
  expect(teams.or).toHaveBeenCalledWith('season_id.eq.league,tournament_id.eq.phase');
  expect(db.from).toHaveBeenCalledTimes(2);
});

it('returns only species from a public registered row, not its sets', async () => {
  db.from.mockReturnValueOnce(query([])).mockReturnValueOnce(query({ player_id: 'other', match_id: 'match', library_published_at: null, pokemon: [{ species: 'Pikachu', item: 'private item' }], tournaments: { team_visibility: 'hidden_until_match' }, matches: { status: 'completed' } }));
  expect(await getComparisonRegisteredRoster('league', 'other', 'mine')).toEqual({ hidden: false, species: ['Pikachu'] });
});

it('keeps the viewer’s own current registered roster visible', async () => {
  db.from.mockReturnValueOnce(query([])).mockReturnValueOnce(query({ player_id: 'mine', match_id: null, library_published_at: null, pokemon: [{ species: 'Pikachu' }], tournaments: null, matches: null }));
  expect(await getComparisonRegisteredRoster('league', 'mine', 'mine')).toEqual({ hidden: false, species: ['Pikachu'] });
});
