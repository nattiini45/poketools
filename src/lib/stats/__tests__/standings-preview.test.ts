import { describe, expect, it, vi } from 'vitest';
import { getNativeLeagueStandingsPreview, playerStandingFromRows, type StandingsPreviewRow } from '../standings-preview';

const native = vi.hoisted(() => ({ parts: vi.fn(), stages: vi.fn(), context: vi.fn(), records: vi.fn(), byes: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getPublicSeasonParticipants: native.parts }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseRankingStages: native.stages }));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: native.context }));
vi.mock('@/lib/supabase/queries/phase-format-runtime', () => ({ getCompletedPhaseMatchRecordsBatch: native.records }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getByeRoundsByPhaseIds: native.byes }));

const rows: StandingsPreviewRow[] = [
  { rank: 1, player_id: 'a', player_name: 'Ash', wins: 9, losses: 1 },
  { rank: 2, player_id: 'b', player_name: 'Misty', wins: 4, losses: 6 },
  { rank: 3, player_id: 'c', player_name: 'Brock', wins: 2, losses: 8 },
];

describe('playerStandingFromRows', () => {
  it("returns the player's rank, the table size and the record", () => {
    expect(playerStandingFromRows(rows, 'b')).toEqual({ rank: 2, total: 3, wins: 4, losses: 6 });
  });

  it('matches by player id, not by name', () => {
    expect(playerStandingFromRows(rows, 'Misty')).toBeNull();
  });

  it('returns null for a player outside the table', () => {
    expect(playerStandingFromRows(rows, 'z')).toBeNull();
    expect(playerStandingFromRows([], 'a')).toBeNull();
  });
});

it('the native preview ranks two Swiss byes by their own stages', async () => {
  native.parts.mockResolvedValue([
    { id: 'a', name: 'Aster', avatar_url: null, gym_type: null },
    { id: 'b', name: 'Bramble', avatar_url: null, gym_type: null },
  ]);
  native.stages.mockResolvedValue([{ id: 'small', bracket_type: 'swiss' }, { id: 'large', bracket_type: 'swiss' }]);
  native.records.mockResolvedValue(new Map());
  native.byes.mockResolvedValue(new Map([
    ['small', [{ round_number: 1, bye_player_ids: ['a'] }]],
    ['large', [{ round_number: 1, bye_player_ids: ['b'] }]],
  ]));
  const stage = (key: string, bye: number) => ({
    key, scoring: { win: 3, loss: 0, bye }, rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
  });
  native.context.mockResolvedValue({ formatType: 'custom', kit: {
    engine: 'kit', stages: { small: stage('small', 1), large: stage('large', 5) }, stageOfMatch: {}, outcomes: {}, coinFlips: {},
  } });

  const preview = await getNativeLeagueStandingsPreview('fixture-league', 2);
  expect(preview.map(({ player_id, wins }) => [player_id, wins])).toEqual([['b', 1], ['a', 1]]);
});
