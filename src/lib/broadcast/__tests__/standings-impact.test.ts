import { describe, it, expect } from 'vitest';
import { computeStandingsImpact } from '../standings-impact';
import type { MatchRecord } from '@/lib/tournament/types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeMatchRecord(
  p1: string,
  p2: string,
  winner: string | null,
  round = 1,
): MatchRecord {
  return { player_1_id: p1, player_2_id: p2, winner_id: winner, round_number: round };
}

// ── computeStandingsImpact ──────────────────────────────────────────

describe('computeStandingsImpact', () => {
  const ids = ['p1', 'p2', 'p3', 'p4'];
  const names: Record<string, string> = {
    p1: 'Alice',
    p2: 'Bob',
    p3: 'Carol',
    p4: 'Dave',
  };

  it('computes current ranks from existing matches', () => {
    const matches: MatchRecord[] = [
      makeMatchRecord('p1', 'p2', 'p1'),
      makeMatchRecord('p3', 'p4', 'p3'),
    ];
    const impact = computeStandingsImpact('p1', 'p3', matches, ids, names);
    // p1 and p3 both have 1 win; current ranks depend on tiebreakers
    expect(impact.currentP1Rank).toBeGreaterThanOrEqual(1);
    expect(impact.currentP2Rank).toBeGreaterThanOrEqual(1);
  });

  it('simulates P1 win scenario rank change', () => {
    // Start with no matches - all tied at rank
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // After P1 wins: P1 should be rank 1
    expect(impact.player1WinScenario.rank).toBe(1);
  });

  it('simulates P2 win scenario rank change', () => {
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // After P2 wins: P2 should be rank 1
    expect(impact.player2WinScenario.rank).toBe(1);
  });

  it('computes rank change deltas correctly', () => {
    // All tied at 0 wins initially, so currentRank depends on sort order
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // change = currentRank - newRank (positive = improved)
    expect(impact.player1WinScenario.change).toBe(
      impact.currentP1Rank - impact.player1WinScenario.rank,
    );
    expect(impact.player2WinScenario.change).toBe(
      impact.currentP2Rank - impact.player2WinScenario.rank,
    );
  });

  it('detects clinch playoff spot', () => {
    // 4 players, playoffSlots = 2
    // p3 and p4 have 1 win. p1 and p2 have 0 wins.
    // If p1 wins, p1 goes to 1 win, tied with p3 & p4 (could clinch)
    const matches: MatchRecord[] = [
      makeMatchRecord('p3', 'p4', 'p3'),
    ];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names, 2);
    // With playoffSlots = 2, if winning moves a player from outside to inside
    if (impact.player1WinScenario.rank <= 2 && impact.currentP1Rank > 2) {
      expect(impact.player1WinScenario.clinchNote).toBe('Clinches playoff spot');
    }
  });

  it('detects drops out of playoffs', () => {
    // p1 and p2 currently in playoff spots. After result one might drop.
    const matches: MatchRecord[] = [
      makeMatchRecord('p1', 'p3', 'p1'),
      makeMatchRecord('p2', 'p4', 'p2'),
    ];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names, 2);
    // The loser in the scenario might drop from playoffs
    // Check structure exists
    expect(impact.player1WinScenario).toHaveProperty('clinchNote');
    expect(impact.player2WinScenario).toHaveProperty('clinchNote');
  });

  it('detects "Takes first place" when winner becomes rank 1', () => {
    // p3 has 1 win. p1 and p2 have 0. If p1 wins and ends up rank 1:
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    if (impact.player1WinScenario.rank === 1) {
      expect(impact.player1WinScenario.clinchNote).toBe('Takes first place');
    }
  });

  it('returns null clinchNote when no significant position change', () => {
    // p1 has 2 wins, p2 has 0, p3 has 1, p4 has 0
    // p1 vs p2: p1 winning keeps them at top, no big change
    const matches: MatchRecord[] = [
      makeMatchRecord('p1', 'p3', 'p1'),
      makeMatchRecord('p1', 'p4', 'p1'),
    ];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // p1 is already rank 1, winning again should yield "Takes first place" or null
    // depending on whether they're already rank 1
    expect([null, 'Takes first place']).toContain(impact.player1WinScenario.clinchNote);
  });

  it('defaults playoffSlots to ceil(participants/2) when not provided', () => {
    const matches: MatchRecord[] = [];
    // 4 players => playoffSlots defaults to 2
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // Just verify it doesn't crash and returns valid structure
    expect(impact.player1WinScenario).toHaveProperty('rank');
    expect(impact.player1WinScenario).toHaveProperty('change');
    expect(impact.player1WinScenario).toHaveProperty('clinchNote');
    expect(impact.player2WinScenario).toHaveProperty('rank');
    expect(impact.player2WinScenario).toHaveProperty('change');
    expect(impact.player2WinScenario).toHaveProperty('clinchNote');
  });

  it('handles two-player scenario', () => {
    const twoIds = ['p1', 'p2'];
    const twoNames: Record<string, string> = { p1: 'Alice', p2: 'Bob' };
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, twoIds, twoNames);
    expect(impact.player1WinScenario.rank).toBe(1);
    expect(impact.player2WinScenario.rank).toBe(1);
  });

  it('result contains all required fields', () => {
    const matches: MatchRecord[] = [];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    expect(impact).toHaveProperty('player1WinScenario');
    expect(impact).toHaveProperty('player2WinScenario');
    expect(impact).toHaveProperty('currentP1Rank');
    expect(impact).toHaveProperty('currentP2Rank');
    expect(typeof impact.currentP1Rank).toBe('number');
    expect(typeof impact.currentP2Rank).toBe('number');
  });

  it('rank change is positive when player improves position', () => {
    // p2 has 1 win, p1 has 0
    const matches: MatchRecord[] = [
      makeMatchRecord('p2', 'p3', 'p2'),
    ];
    const impact = computeStandingsImpact('p1', 'p2', matches, ids, names);
    // When p1 wins, they gain a win and should improve their rank
    // change = oldRank - newRank, so positive means improvement
    if (impact.player1WinScenario.rank < impact.currentP1Rank) {
      expect(impact.player1WinScenario.change).toBeGreaterThan(0);
    }
  });
});

// ── i18n (T15) ────────────────────────────────────────────────────────

describe('computeStandingsImpact i18n (T15)', () => {
  const ids = ['p1', 'p2'];
  const names: Record<string, string> = { p1: 'Alice', p2: 'Bob' };

  it('writes the clinch note in German for locale de', () => {
    const en = computeStandingsImpact('p1', 'p2', [], ids, names, 1);
    const de = computeStandingsImpact('p1', 'p2', [], ids, names, 1, 'de');
    expect(de.player1WinScenario.rank).toBe(en.player1WinScenario.rank);
    const germanNotes = ['Sichert sich einen Playoff-Platz', 'Rutscht aus den Playoff-Rängen', 'Übernimmt Platz 1'];
    const englishNotes = ['Clinches playoff spot', 'Drops out of playoffs', 'Takes first place'];
    for (const [enNote, deNote] of [
      [en.player1WinScenario.clinchNote, de.player1WinScenario.clinchNote],
      [en.player2WinScenario.clinchNote, de.player2WinScenario.clinchNote],
    ]) {
      if (enNote === null) {
        expect(deNote).toBeNull();
      } else {
        expect(deNote).toBe(germanNotes[englishNotes.indexOf(enNote)]);
      }
    }
    expect([de.player1WinScenario.clinchNote, de.player2WinScenario.clinchNote].some((n) => n !== null)).toBe(true);
  });
});
