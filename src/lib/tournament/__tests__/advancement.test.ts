import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdvancementRule } from '@/types/season';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { MatchRecord } from '../types';

// ── Mock standings ─────────────────────────────────────────────────

vi.mock('../standings', () => ({
  computeStandings: vi.fn(),
}));

import { computeStandings } from '../standings';
import { computeAdvancement } from '../advancement';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────

function makeStanding(id: string, name: string, wins: number) {
  return {
    player_id: id,
    player_name: name,
    player_avatar_url: null,
    gym_type: null,
    wins,
    losses: 0,
    draws: 0,
    points: wins,
    buchholz: 0,
    games_played: wins,
    kill_differential: 0,
    eliminated: false,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('computeAdvancement', () => {
  describe('top_n overall', () => {
    it('advances top N players by standings', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 2, per_group: false };
      const ids = ['p1', 'p2', 'p3', 'p4'];
      const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie', p4: 'David' };
      const matches: MatchRecord[] = [];

      vi.mocked(computeStandings).mockReturnValue([
        makeStanding('p1', 'Alice', 3),
        makeStanding('p2', 'Bob', 2),
        makeStanding('p3', 'Charlie', 1),
        makeStanding('p4', 'David', 0),
      ]);

      const result = computeAdvancement(rule, ids, names, matches);

      expect(result.advancing_player_ids).toEqual(['p1', 'p2']);
      expect(result.summary).toContain('Top 2 overall');
      expect(result.summary).toContain('2 players');
    });

    it('advances all players when count equals total', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 3, per_group: false };
      const ids = ['p1', 'p2', 'p3'];
      const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie' };

      vi.mocked(computeStandings).mockReturnValue([
        makeStanding('p1', 'Alice', 2),
        makeStanding('p2', 'Bob', 1),
        makeStanding('p3', 'Charlie', 0),
      ]);

      const result = computeAdvancement(rule, ids, names, []);

      expect(result.advancing_player_ids).toEqual(['p1', 'p2', 'p3']);
    });

    it('advances 1 player (top_n with count=1)', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 1, per_group: false };
      const ids = ['p1', 'p2', 'p3'];
      const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie' };

      vi.mocked(computeStandings).mockReturnValue([
        makeStanding('p1', 'Alice', 3),
        makeStanding('p2', 'Bob', 2),
        makeStanding('p3', 'Charlie', 1),
      ]);

      const result = computeAdvancement(rule, ids, names, []);

      expect(result.advancing_player_ids).toEqual(['p1']);
    });
  });

  describe('top_n per_group', () => {
    it('advances top N from each group', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 1, per_group: true };
      const ids = ['p1', 'p2', 'p3', 'p4'];
      const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie', p4: 'David' };

      const groups: TournamentGroupWithMembers[] = [
        {
          id: 'g1', tournament_id: 't1', name: 'Group A', group_number: 1,
          created_at: '', updated_at: '',
          members: [
            { player_id: 'p1', player_name: 'Alice', seed: 1, gym_type: null },
            { player_id: 'p2', player_name: 'Bob', seed: 2, gym_type: null },
          ],
        },
        {
          id: 'g2', tournament_id: 't1', name: 'Group B', group_number: 2,
          created_at: '', updated_at: '',
          members: [
            { player_id: 'p3', player_name: 'Charlie', seed: 1, gym_type: null },
            { player_id: 'p4', player_name: 'David', seed: 2, gym_type: null },
          ],
        },
      ];

      // Standings for Group A
      vi.mocked(computeStandings).mockReturnValueOnce([
        makeStanding('p1', 'Alice', 2),
        makeStanding('p2', 'Bob', 0),
      ]);
      // Standings for Group B
      vi.mocked(computeStandings).mockReturnValueOnce([
        makeStanding('p4', 'David', 2),
        makeStanding('p3', 'Charlie', 0),
      ]);

      const result = computeAdvancement(rule, ids, names, [], groups);

      expect(result.advancing_player_ids).toEqual(['p1', 'p4']);
      expect(result.summary).toContain('Top 1 from each of 2 groups');
      expect(result.summary).toContain('2 players total');
    });

    it('filters matches to only those within each group', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 1, per_group: true };
      const ids = ['p1', 'p2', 'p3', 'p4'];
      const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C', p4: 'D' };
      const matches: MatchRecord[] = [
        { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
        { player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p3', round_number: 1 },
        // Cross-group match (should be excluded from group standings)
        { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', round_number: 2 },
      ];

      const groups: TournamentGroupWithMembers[] = [
        {
          id: 'g1', tournament_id: 't1', name: 'Group A', group_number: 1,
          created_at: '', updated_at: '',
          members: [
            { player_id: 'p1', player_name: 'A', seed: 1, gym_type: null },
            { player_id: 'p2', player_name: 'B', seed: 2, gym_type: null },
          ],
        },
        {
          id: 'g2', tournament_id: 't1', name: 'Group B', group_number: 2,
          created_at: '', updated_at: '',
          members: [
            { player_id: 'p3', player_name: 'C', seed: 1, gym_type: null },
            { player_id: 'p4', player_name: 'D', seed: 2, gym_type: null },
          ],
        },
      ];

      vi.mocked(computeStandings).mockReturnValueOnce([makeStanding('p1', 'A', 1), makeStanding('p2', 'B', 0)]);
      vi.mocked(computeStandings).mockReturnValueOnce([makeStanding('p3', 'C', 1), makeStanding('p4', 'D', 0)]);

      computeAdvancement(rule, ids, names, matches, groups);

      // First call (Group A) should only have the p1 vs p2 match
      const groupACall = vi.mocked(computeStandings).mock.calls[0];
      const groupAMatches = groupACall[2];
      expect(groupAMatches).toHaveLength(1);
      expect(groupAMatches[0].player_1_id).toBe('p1');
      expect(groupAMatches[0].player_2_id).toBe('p2');
    });

    it('falls back to overall when per_group=true but no groups provided', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 2, per_group: true };
      const ids = ['p1', 'p2', 'p3'];
      const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };

      vi.mocked(computeStandings).mockReturnValue([
        makeStanding('p1', 'A', 2),
        makeStanding('p2', 'B', 1),
        makeStanding('p3', 'C', 0),
      ]);

      const result = computeAdvancement(rule, ids, names, []);

      // Falls through to overall because groups is undefined
      expect(result.advancing_player_ids).toEqual(['p1', 'p2']);
      expect(result.summary).toContain('Top 2 overall');
    });

    it('falls back to overall when per_group=true but groups array is empty', () => {
      const rule: AdvancementRule = { type: 'top_n', count: 2, per_group: true };
      const ids = ['p1', 'p2', 'p3'];
      const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };

      vi.mocked(computeStandings).mockReturnValue([
        makeStanding('p1', 'A', 2),
        makeStanding('p2', 'B', 1),
        makeStanding('p3', 'C', 0),
      ]);

      const result = computeAdvancement(rule, ids, names, [], []);

      expect(result.advancing_player_ids).toEqual(['p1', 'p2']);
    });
  });
});
