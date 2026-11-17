import { describe, expect, it, vi } from 'vitest';
import { checkPhaseAchievements } from '../achievement-streams';
import { checkAchievementsWithStats } from '@/lib/gamification/achievements';

const { readTables } = vi.hoisted(() => ({ readTables: [] as string[] }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    readTables.push(table);
    const rows: Record<string, object[]> = {
      phase_participants: [
        { player_id: 'p', seed: 4, phase_id: 'phase', league_phases: { id: 'phase', status: 'active', created_at: '2026-01-01', bracket_type: 'single_elimination' } },
        { player_id: 'other', seed: 1 },
      ],
      phase_rounds: [{ id: 'round', round_number: 2 }],
      tournament_participants: [],
    };
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query,
      range: (from: number) => Promise.resolve({ data: from === 0 ? rows[table] ?? [] : [], error: null }),
    };
    return query;
  },
} }));
vi.mock('@/lib/supabase/queries/aggregates', () => ({ getAllTimePlayerAggregates: vi.fn().mockResolvedValue([{ total_kos_dealt: 7, total_brought: 3 }]) }));
vi.mock('@/lib/supabase/queries/ratings', () => ({ getPlayerRating: vi.fn().mockResolvedValue({ wins: 8, losses: 2, draws: 1, rating: 1600, peak_rating: 1700 }) }));
vi.mock('@/lib/supabase/queries/signatures', () => ({ getPlayerSignatures: vi.fn().mockResolvedValue({ signatures: [{}] }) }));
vi.mock('@/lib/supabase/queries/streaks', () => ({ getPlayerStreaks: vi.fn().mockResolvedValue({ current_win_streak: 4 }) }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/queries/games', () => ({ getBattleStatsByMatch: vi.fn(() => { throw new Error('Native callback must not read legacy stats'); }) }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn(() => { throw new Error('Native callback must not read legacy matches'); }) }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({
  getPhaseMatchById: vi.fn().mockResolvedValue({ id: 'match', phase_id: 'phase', round_id: 'round', bracket_pos: 0, bracket_side: 'winners' }),
  getPhaseMatchesByRound: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/gamification/achievements', () => ({
  checkAchievementsWithStats: vi.fn(async (_player: string, _context: unknown, load: () => Promise<unknown>) => load()),
  computeMatchStats: vi.fn().mockReturnValue({ kos_dealt_total: 0 }),
  didPlayerWinTournamentFinal: vi.fn().mockResolvedValue(false),
}));

describe('native achievement stream context', () => {
  it('uses shared projections and native competition data without legacy match scans', async () => {
    await checkPhaseAchievements('p', { match_id: 'match', phase_id: 'phase', season_id: 'league', winner_id: 'p', loser_id: 'other', is_draw: false });
    expect(checkAchievementsWithStats).toHaveBeenCalledWith('p', { phase_match_id: 'match', phase_id: 'phase', season_id: 'league' }, expect.any(Function));
    const call = vi.mocked(checkAchievementsWithStats).mock.calls[0];
    const stats = await call[2]();
    expect(stats.cumulativeStats).toMatchObject({ total_wins: 8, total_games: 11, total_kos_dealt: 7 });
    expect(stats.seedDiff).toBe(3);
    expect(stats.custom.tournamentFinalWin).toBe(true);
    expect(readTables).not.toContain('matches');
    expect(readTables).not.toContain('battle_stats');
  });
});
