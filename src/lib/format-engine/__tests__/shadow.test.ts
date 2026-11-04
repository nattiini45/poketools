import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getSeasonKitHead: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournamentIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getPublicSeasonParticipants: vi.fn(), getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('@/lib/tournament/scoring-byes', () => ({ loadSeasonSwissByeRounds: vi.fn() }));
vi.mock('../load', () => ({ loadKitStandingsData: vi.fn() }));

import { getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import type { MatchWithPlayers } from '@/types/match';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PublicSeasonParticipant } from '@/lib/players/public-player';
import type { KitStandingsData } from '../context';
import { loadKitStandingsData } from '../load';
import { loadShadowDiff } from '../shadow';

const SEASON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHASE = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';

const match = (id: string, p1: string, p2: string, winner: string): MatchWithPlayers =>
  ({ id, player_1_id: p1, player_2_id: p2, winner_id: winner, status: 'completed', round_id: 'r1' }) as MatchWithPlayers;

function kit(overrides: Partial<KitStandingsData> = {}): KitStandingsData {
  return {
    engine: 'shadow',
    stages: {
      [PHASE]: {
        key: 'league',
        scoring: { win: 3, loss: 0, bye: 0 },
        rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
      },
    },
    stageOfMatch: { m1: PHASE, m2: PHASE, m3: PHASE },
    outcomes: { m3: { kind: 'forfeit', p1_faints: null, p2_faints: null } },
    coinFlips: { [PHASE]: {} },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'legacy', seed: 'secret-seed' });
  vi.mocked(loadKitStandingsData).mockResolvedValue(kit());
  vi.mocked(getStagesBySeasonId).mockResolvedValue([
    { id: PHASE, name: 'League', bracket_type: 'round_robin' } as TournamentWithDetails,
  ]);
  vi.mocked(getPublicSeasonParticipants).mockResolvedValue(
    ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }) as PublicSeasonParticipant),
  );
  vi.mocked(getMatchesByTournamentIds).mockResolvedValue(
    new Map([[PHASE, [match('m1', 'a', 'b', 'a'), match('m2', 'b', 'c', 'b'), match('m3', 'c', 'a', 'c')]]]),
  );
});

describe('loadShadowDiff', () => {
  it('returns null without an attached format', async () => {
    vi.mocked(getSeasonKitHead).mockResolvedValue(null);
    expect(await loadShadowDiff(SEASON)).toBeNull();
    expect(loadKitStandingsData).not.toHaveBeenCalled();
  });

  it('loads a legacy league too and reports the rows whose points differ, per phase and for the season', async () => {
    const report = await loadShadowDiff(SEASON);
    expect(loadKitStandingsData).toHaveBeenCalledWith(SEASON, { includeLegacy: true });
    expect(report?.engine).toBe('legacy');
    expect(report?.phases).toHaveLength(1);
    const [phase] = report!.phases;
    expect(phase).toMatchObject({ phase_id: PHASE, phase_name: 'League', stage_key: 'league', completed_matches: 3 });
    // Three points a win against one: every row differs on points.
    expect(phase.rows.map((row) => [row.player_id, row.legacy_points, row.kit_points]).sort()).toEqual([
      ['a', 1, 3],
      ['b', 1, 3],
      ['c', 1, 3],
    ]);
    expect(report!.season).toHaveLength(3);
    expect(loadSeasonSwissByeRounds).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('secret-seed');
  });

  it('reports no row when both engines agree', async () => {
    vi.mocked(loadKitStandingsData).mockResolvedValue(
      kit({
        stages: {
          [PHASE]: {
            key: 'league',
            scoring: { win: 1, loss: 0, bye: 0 },
            rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
          },
        },
        outcomes: {},
      }),
    );
    vi.mocked(getMatchesByTournamentIds).mockResolvedValue(new Map([[PHASE, [match('m1', 'a', 'b', 'a')]]]));
    const report = await loadShadowDiff(SEASON);
    expect(report!.phases[0].rows).toEqual([]);
  });
});
