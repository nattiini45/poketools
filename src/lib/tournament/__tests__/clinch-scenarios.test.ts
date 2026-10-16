import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchRecord } from '../types';

// ── Mock standings ─────────────────────────��───────────────────────

vi.mock('../standings', () => ({
  computeStandings: vi.fn(),
}));

import { computeStandings } from '../standings';
import { computeClinchScenarios } from '../clinch-scenarios';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────

function makeStanding(id: string, name: string, wins: number, losses: number = 0) {
  return {
    player_id: id,
    player_name: name,
    player_avatar_url: null,
    gym_type: null,
    wins,
    losses,
    draws: 0,
    points: wins,
    buchholz: 0,
    games_played: wins + losses,
    kill_differential: 0,
    eliminated: false,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('computeClinchScenarios', () => {
  it('returns all players as alive when too many remaining matches (>20)', () => {
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie' };
    const completed: MatchRecord[] = [];

    // 21 remaining matches — should skip brute force
    const remaining = Array.from({ length: 21 }, (_v, _i) => ({
      player_1_id: 'p1',
      player_2_id: 'p2',
    }));

    vi.mocked(computeStandings).mockReturnValue([
      makeStanding('p1', 'Alice', 0),
      makeStanding('p2', 'Bob', 0),
      makeStanding('p3', 'Charlie', 0),
    ]);

    const result = computeClinchScenarios(ids, names, completed, remaining, 2);

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.status === 'alive')).toBe(true);
    expect(result.every((r) => r.magicNumber === null)).toBe(true);
  });

  it('marks player as clinched when they make playoffs in all outcomes', () => {
    // 3 players, 2 playoff slots, 1 remaining match (between p2 and p3)
    // p1 already has 2 wins — regardless of p2/p3 outcome, p1 is top 2
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'Alice', p2: 'Bob', p3: 'Charlie' };
    const completed: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', round_number: 2 },
    ];
    const remaining = [{ player_1_id: 'p2', player_2_id: 'p3' }];

    // Current standings
    vi.mocked(computeStandings).mockImplementation((_pIds) => {
      // Return in order based on wins count in the simulated matches
      return [
        makeStanding('p1', 'Alice', 2),
        makeStanding('p2', 'Bob', 0),
        makeStanding('p3', 'Charlie', 0),
      ];
    });

    const result = computeClinchScenarios(ids, names, completed, remaining, 2);

    const p1 = result.find((r) => r.playerId === 'p1')!;
    expect(p1.status).toBe('clinched');
    expect(p1.magicNumber).toBeNull();
  });

  it('marks player as eliminated when they cannot reach playoffs in any outcome', () => {
    // 4 players, 1 playoff slot, 1 remaining match
    // p4 has 0 wins and remaining match is between p2 and p3
    // Even if p4 benefits from that result, the top 3 all have more wins
    const ids = ['p1', 'p2', 'p3', 'p4'];
    const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C', p4: 'D' };
    const completed: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p4', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p2', player_2_id: 'p4', winner_id: 'p2', round_number: 1 },
      { player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p3', round_number: 1 },
    ];
    const remaining = [{ player_1_id: 'p2', player_2_id: 'p3' }];

    // Mock standings to be deterministic: always order by wins
    vi.mocked(computeStandings).mockImplementation((_pIds, _names, matches) => {
      const winsMap = new Map<string, number>();
      for (const id of ['p1', 'p2', 'p3', 'p4']) winsMap.set(id, 0);
      for (const m of matches) {
        if (m.winner_id) winsMap.set(m.winner_id, (winsMap.get(m.winner_id) ?? 0) + 1);
      }
      return Array.from(winsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, wins]) => makeStanding(id, names[id], wins));
    });

    const result = computeClinchScenarios(ids, names, completed, remaining, 1);

    const p4 = result.find((r) => r.playerId === 'p4')!;
    expect(p4.status).toBe('eliminated');
    expect(p4.magicNumber).toBeNull();
  });

  it('marks players as alive when outcome is undetermined', () => {
    // 3 players, 1 playoff slot, 2 remaining matches
    // All players at 0 wins — anyone could win
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };
    const completed: MatchRecord[] = [];
    const remaining = [
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p1', player_2_id: 'p3' },
    ];

    vi.mocked(computeStandings).mockImplementation((_pIds, _names, matches) => {
      const winsMap = new Map<string, number>();
      for (const id of ids) winsMap.set(id, 0);
      for (const m of matches) {
        if (m.winner_id) winsMap.set(m.winner_id, (winsMap.get(m.winner_id) ?? 0) + 1);
      }
      return Array.from(winsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, wins]) => makeStanding(id, names[id], wins));
    });

    const result = computeClinchScenarios(ids, names, completed, remaining, 1);

    // At least some should be alive since outcomes are open
    const aliveCount = result.filter((r) => r.status === 'alive').length;
    expect(aliveCount).toBeGreaterThan(0);
  });

  it('returns correct currentRank based on current standings', () => {
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };
    const completed: MatchRecord[] = [];
    const remaining = [{ player_1_id: 'p1', player_2_id: 'p2' }];

    vi.mocked(computeStandings).mockImplementation(() => [
      makeStanding('p3', 'C', 2),
      makeStanding('p1', 'A', 1),
      makeStanding('p2', 'B', 0),
    ]);

    const result = computeClinchScenarios(ids, names, completed, remaining, 2);

    expect(result[0].currentRank).toBe(1);
    expect(result[0].playerName).toBe('C');
    expect(result[1].currentRank).toBe(2);
    expect(result[2].currentRank).toBe(3);
  });

  it('handles no remaining matches (all outcomes known)', () => {
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };
    const completed: MatchRecord[] = [
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', round_number: 1 },
      { player_1_id: 'p2', player_2_id: 'p3', winner_id: 'p2', round_number: 1 },
    ];

    vi.mocked(computeStandings).mockReturnValue([
      makeStanding('p1', 'A', 2),
      makeStanding('p2', 'B', 1),
      makeStanding('p3', 'C', 0),
    ]);

    const result = computeClinchScenarios(ids, names, completed, [], 2);

    // With 0 remaining matches, only 1 outcome (the current one)
    // p1 and p2 are in top 2 => clinched
    // p3 is out => eliminated
    const p1 = result.find((r) => r.playerId === 'p1')!;
    const p2 = result.find((r) => r.playerId === 'p2')!;
    const p3 = result.find((r) => r.playerId === 'p3')!;

    expect(p1.status).toBe('clinched');
    expect(p2.status).toBe('clinched');
    expect(p3.status).toBe('eliminated');
  });

  it('magic number is calculated for alive players', () => {
    const ids = ['p1', 'p2', 'p3'];
    const names: Record<string, string> = { p1: 'A', p2: 'B', p3: 'C' };
    const completed: MatchRecord[] = [];
    const remaining = [
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p2', player_2_id: 'p3' },
    ];

    vi.mocked(computeStandings).mockImplementation((_pIds, _names, matches) => {
      const winsMap = new Map<string, number>();
      for (const id of ids) winsMap.set(id, 0);
      for (const m of matches) {
        if (m.winner_id) winsMap.set(m.winner_id, (winsMap.get(m.winner_id) ?? 0) + 1);
      }
      return Array.from(winsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id, wins]) => makeStanding(id, names[id], wins));
    });

    const result = computeClinchScenarios(ids, names, completed, remaining, 1);

    // Alive players should have a numeric magicNumber
    for (const r of result) {
      if (r.status === 'alive') {
        expect(r.magicNumber).toBeTypeOf('number');
      } else {
        expect(r.magicNumber).toBeNull();
      }
    }
  });

  it('enumerates all 2^n outcomes for n remaining matches', () => {
    const ids = ['p1', 'p2'];
    const names: Record<string, string> = { p1: 'A', p2: 'B' };
    const completed: MatchRecord[] = [];
    const remaining = [
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p1', player_2_id: 'p2' },
    ];

    vi.mocked(computeStandings).mockReturnValue([
      makeStanding('p1', 'A', 0),
      makeStanding('p2', 'B', 0),
    ]);

    computeClinchScenarios(ids, names, completed, remaining, 1);

    // Initial standings call + 2^3 = 8 simulation calls = 9 total
    expect(computeStandings).toHaveBeenCalledTimes(9);
  });
});
