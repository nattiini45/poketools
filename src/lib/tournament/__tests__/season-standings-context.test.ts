/**
 * D36 fix 11: the season standings context. `computeStandingsForSeason` keeps
 * its behaviour (one season read, plus evolution points for EPB), and the
 * batched `loadSeasonStandingsContexts` resolves many seasons with one
 * seasons read plus one evolution-points read per distinct EPB season.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonFormatTypes: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonEvolutionPoints: vi.fn(),
}));

import {
  computeStandingsForSeason,
  computeStandingsFromContext,
  loadSeasonStandingsContext,
  loadSeasonStandingsContexts,
  NO_SEASON_CONTEXT,
  sumEvolutionPoints,
} from '../season-standings';
import { computeStandingsForFormat } from '../standings';
import { getSeasonById, getSeasonFormatTypes } from '@/lib/supabase/queries/seasons';
import { getSeasonEvolutionPoints } from '@/lib/supabase/queries/evolutions';
import type { Season } from '@/types/season';
import type { MatchRecord } from '../types';

function season(id: string, format: Season['format_type']): Season {
  return {
    id,
    name: id,
    description: '',
    format_type: format,
    ruleset_id: null,
    start_date: null,
    end_date: null,
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    language: 'de',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const IDS = ['a', 'b', 'c'];
const NAMES = { a: 'A', b: 'B', c: 'C' };
const MATCHES: MatchRecord[] = [
  { player_1_id: 'a', player_2_id: 'b', winner_id: 'b', round_number: 1 },
  { player_1_id: 'b', player_2_id: 'c', winner_id: 'c', round_number: 1 },
  { player_1_id: 'c', player_2_id: 'a', winner_id: 'a', round_number: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sumEvolutionPoints', () => {
  it('sums evolution_points_awarded per player (the getSeasonEvolutionPoints reduction)', () => {
    expect(
      sumEvolutionPoints([
        { player_id: 'a', evolution_points_awarded: 2 },
        { player_id: 'b', evolution_points_awarded: 0 },
        { player_id: 'a', evolution_points_awarded: 1 },
      ]),
    ).toEqual({ a: 3, b: 0 });
    expect(sumEvolutionPoints([])).toEqual({});
  });
});

describe('computeStandingsForSeason (unchanged behaviour)', () => {
  it('EPB: reads the season and its evolution points, and ranks with them', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season('s', 'evolution_point_buy'));
    vi.mocked(getSeasonEvolutionPoints).mockResolvedValue({ c: 5 });

    const standings = await computeStandingsForSeason('s', IDS, NAMES, MATCHES);

    expect(getSeasonById).toHaveBeenCalledWith('s');
    expect(getSeasonEvolutionPoints).toHaveBeenCalledWith('s');
    expect(standings).toEqual(
      computeStandingsForFormat('evolution_point_buy', IDS, NAMES, MATCHES, {}, {}, {}, { evolutionPoints: { c: 5 } }),
    );
    // Three-way tie on match points; evolution points break it.
    expect(standings[0].player_id).toBe('c');
  });

  it('non-EPB: one season read, no evolution points', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season('s', 'singles'));

    const standings = await computeStandingsForSeason('s', IDS, NAMES, MATCHES);

    expect(getSeasonEvolutionPoints).not.toHaveBeenCalled();
    expect(standings).toEqual(computeStandingsForFormat('singles', IDS, NAMES, MATCHES));
  });

  it('no season id / missing season: generic standings, no reads beyond the lookup', async () => {
    expect(await loadSeasonStandingsContext(null)).toEqual(NO_SEASON_CONTEXT);
    expect(getSeasonById).not.toHaveBeenCalled();

    vi.mocked(getSeasonById).mockResolvedValue(null);
    expect(await loadSeasonStandingsContext('gone')).toEqual(NO_SEASON_CONTEXT);
  });
});

describe('loadSeasonStandingsContexts', () => {
  it('one formats read for all seasons, one evolution-points read per distinct EPB season', async () => {
    vi.mocked(getSeasonFormatTypes).mockResolvedValue(
      new Map([
        ['epb-1', 'evolution_point_buy'],
        ['single-1', 'singles'],
      ]),
    );
    vi.mocked(getSeasonEvolutionPoints).mockResolvedValue({ a: 2 });

    const contexts = await loadSeasonStandingsContexts(['epb-1', 'single-1', null, 'epb-1', undefined, 'gone']);

    expect(getSeasonFormatTypes).toHaveBeenCalledTimes(1);
    expect(getSeasonFormatTypes).toHaveBeenCalledWith(['epb-1', 'single-1', 'gone']);
    expect(getSeasonEvolutionPoints).toHaveBeenCalledTimes(1);
    expect(getSeasonEvolutionPoints).toHaveBeenCalledWith('epb-1');
    expect(Object.fromEntries(contexts)).toEqual({
      'epb-1': { formatType: 'evolution_point_buy', evolutionPoints: { a: 2 } },
      'single-1': { formatType: 'singles' },
    });
  });

  it('no season ids: no reads', async () => {
    expect((await loadSeasonStandingsContexts([null, undefined])).size).toBe(0);
    expect(getSeasonFormatTypes).not.toHaveBeenCalled();
  });

  it('a context computes the same table computeStandingsForSeason does', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season('s', 'evolution_point_buy'));
    vi.mocked(getSeasonEvolutionPoints).mockResolvedValue({ a: 1, c: 1 });
    const viaSeason = await computeStandingsForSeason('s', IDS, NAMES, MATCHES);

    const viaContext = computeStandingsFromContext(
      { formatType: 'evolution_point_buy', evolutionPoints: { a: 1, c: 1 } },
      IDS,
      NAMES,
      MATCHES,
    );

    expect(viaContext).toEqual(viaSeason);
  });
});
