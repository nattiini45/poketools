import { describe, it, expect } from 'vitest';
import { validateRecapOutput, validateForecastOutput } from '../validator';
import type { RecapFactPack, ForecastFactPack, MatchFact } from '../types';

// ─── Test Fixtures ──────────────────────────────────────────────────

function makeMatchFact(overrides: Partial<MatchFact> = {}): MatchFact {
  return {
    matchId: 'match-1',
    player1Name: 'Ash',
    player2Name: 'Misty',
    winnerName: 'Ash',
    loserName: 'Misty',
    winnerScore: 2,
    loserScore: 0,
    marginDescription: 'a comfortable win (2-0)',
    scoreString: '2-0',
    player1TotalKos: 5,
    player2TotalKos: 3,
    gamesPlayed: 2,
    mvpPokemon: 'Pikachu',
    mvpPlayerName: 'Ash',
    mvpKos: 3,
    winnerTeam: [
      { pokemonName: 'Pikachu', totalKos: 3, wasKoed: false, wasLead: true, isMvp: true, movesUsed: ['Thunderbolt'] },
    ],
    loserTeam: [
      { pokemonName: 'Starmie', totalKos: 2, wasKoed: true, wasLead: true, isMvp: false, movesUsed: ['Surf'] },
    ],
    preWrittenOneLiner: 'Ash defeated Misty 2-0 in a comfortable win, with Pikachu earning MVP honors (3 KOs).',
    keyPerformances: ['Pikachu earned MVP for Ash with 3 KOs'],
    ...overrides,
  };
}

function makeRecapFactPack(overrides: Partial<RecapFactPack> = {}): RecapFactPack {
  return {
    leagueName: 'Test League',
    tournamentName: 'Test Tournament',
    roundName: 'Round 1',
    roundNumber: 1,
    format: 'gen9ou',
    gen: 9,
    bestOf: 3,
    scoring: '3 points for a win',
    gymTypes: {},
    matches: [makeMatchFact()],
    currentStandings: [
      {
        rank: 1, playerName: 'Ash', playerId: 'p1', gymType: null,
        points: 3, recordString: '1W-0L', kdString: '+2', rankChange: '#1',
        wins: 1, losses: 0, draws: 0, killDifferential: 2,
      },
      {
        rank: 2, playerName: 'Misty', playerId: 'p2', gymType: 'Water',
        points: 0, recordString: '0W-1L', kdString: '-2', rankChange: '#2',
        wins: 0, losses: 1, draws: 0, killDifferential: -2,
      },
    ],
    previousStandings: null,
    standingsChanges: [],
    pokemonUsage: [
      { pokemonName: 'Pikachu', timesBrought: 2, totalKos: 3 },
      { pokemonName: 'Starmie', timesBrought: 2, totalKos: 2 },
    ],
    bestPerformer: { playerName: 'Ash', reason: 'won 2-0' },
    unusualPick: null,
    validPlayerNames: ['Ash', 'Misty'],
    validPokemonNames: ['Pikachu', 'Starmie'],
    matchData: [],
    pokemonTypes: { Pikachu: ['Electric'], Starmie: ['Water', 'Psychic'] },
    ...overrides,
  };
}

// ─── Score Validation ───────────────────────────────────────────────

describe('validateRecapOutput — score checks', () => {
  it('passes when the correct score is referenced', () => {
    const result = validateRecapOutput(
      'match_one_liner_0',
      'Ash took the series 2-0 behind a dominant Pikachu.',
      makeRecapFactPack()
    );
    expect(result.valid).toBe(true);
  });

  it('catches a wrong score in a match one-liner', () => {
    const result = validateRecapOutput(
      'match_one_liner_0',
      'Ash swept Misty 3-0 in a dominant display.',
      makeRecapFactPack()
    );
    const scoreErrors = result.errors.filter((e) => e.type === 'wrong_score');
    expect(scoreErrors.length).toBeGreaterThan(0);
    expect(scoreErrors[0].detail).toContain('3-0');
  });

  it('does not flag win-loss records as wrong scores', () => {
    const result = validateRecapOutput(
      'standings_story',
      'Ash now sits at 1W-0L with 3 points.',
      makeRecapFactPack()
    );
    const scoreErrors = result.errors.filter((e) => e.type === 'wrong_score');
    expect(scoreErrors).toHaveLength(0);
  });
});

// ─── Winner Attribution ─────────────────────────────────────────────

describe('validateRecapOutput — winner attribution', () => {
  it('catches when the loser is described as winning', () => {
    const result = validateRecapOutput(
      'match_one_liner_0',
      'Misty won a commanding 2-0 victory over Ash.',
      makeRecapFactPack()
    );
    const playerErrors = result.errors.filter((e) => e.type === 'wrong_player');
    expect(playerErrors.length).toBeGreaterThan(0);
    expect(playerErrors[0].detail).toContain('Misty');
    expect(playerErrors[0].severity).toBe('error');
  });

  it('passes when the winner is correctly attributed', () => {
    const result = validateRecapOutput(
      'match_one_liner_0',
      'Ash defeated Misty 2-0.',
      makeRecapFactPack()
    );
    const playerErrors = result.errors.filter((e) => e.type === 'wrong_player');
    expect(playerErrors).toHaveLength(0);
  });
});

// ─── Standings Number Checks ────────────────────────────────────────

describe('validateRecapOutput — standings numbers', () => {
  it('passes when point values match standings', () => {
    const result = validateRecapOutput(
      'standings_story',
      'Ash leads with 3 points while Misty has 0 points.',
      makeRecapFactPack()
    );
    const numErrors = result.errors.filter((e) => e.type === 'wrong_number');
    expect(numErrors).toHaveLength(0);
  });

  it('warns about point values not in standings', () => {
    const result = validateRecapOutput(
      'standings_story',
      'Ash has surged to 6 points this round.',
      makeRecapFactPack()
    );
    const numErrors = result.errors.filter((e) => e.type === 'wrong_number');
    expect(numErrors.length).toBeGreaterThan(0);
    expect(numErrors[0].detail).toContain('6');
  });
});

// ─── Pokemon Name Checks ────────────────────────────────────────────

describe('validateRecapOutput — pokemon names', () => {
  it('warns about Pokemon names not in match data when in Pokemon context', () => {
    const result = validateRecapOutput(
      'narrative',
      'Charizard scored the crucial KO to seal the deal for Ash.',
      makeRecapFactPack()
    );
    const pokemonErrors = result.errors.filter((e) => e.type === 'wrong_pokemon');
    expect(pokemonErrors.length).toBeGreaterThan(0);
    expect(pokemonErrors[0].detail).toContain('Charizard');
  });

  it('does not flag Pokemon names that ARE in match data', () => {
    const result = validateRecapOutput(
      'narrative',
      'Pikachu scored the crucial KO to seal the deal.',
      makeRecapFactPack()
    );
    const pokemonErrors = result.errors.filter((e) => e.type === 'wrong_pokemon');
    expect(pokemonErrors).toHaveLength(0);
  });
});

// ─── Forecast Validation ────────────────────────────────────────────

describe('validateForecastOutput', () => {
  const forecastFactPack: ForecastFactPack = {
    leagueName: 'Test League',
    tournamentName: 'Test Tournament',
    roundName: 'Round 2',
    roundNumber: 2,
    format: 'gen9ou',
    gen: 9,
    bestOf: 3,
    scoring: '3 points for a win',
    gymTypes: {},
    matchups: [{
      player1Name: 'Ash',
      player2Name: 'Brock',
      player1Rank: 1,
      player2Rank: 3,
      headToHead: 'First meeting',
      player1Team: ['Pikachu', 'Charizard'],
      player2Team: ['Onix', 'Geodude'],
      player1Record: '1W-0L',
      player2Record: '0W-1L',
    }],
    currentStandings: [
      {
        rank: 1, playerName: 'Ash', playerId: 'p1', gymType: null,
        points: 3, recordString: '1W-0L', kdString: '+2', rankChange: '#1',
        wins: 1, losses: 0, draws: 0, killDifferential: 2,
      },
    ],
    validPlayerNames: ['Ash', 'Brock'],
    validPokemonNames: ['Pikachu', 'Charizard', 'Onix', 'Geodude'],
  };

  it('passes clean forecast text', () => {
    const result = validateForecastOutput(
      'forecast_headline',
      'Ash looks to extend his lead as he faces Brock in a marquee matchup.',
      forecastFactPack
    );
    expect(result.valid).toBe(true);
  });

  it('warns about wrong point values in standings context', () => {
    const result = validateForecastOutput(
      'standings_context',
      'Ash has 9 points and is cruising to the title.',
      forecastFactPack
    );
    const numErrors = result.errors.filter((e) => e.type === 'wrong_number');
    expect(numErrors.length).toBeGreaterThan(0);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────

describe('validateRecapOutput — edge cases', () => {
  it('handles empty text gracefully', () => {
    const result = validateRecapOutput('headline', '', makeRecapFactPack());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('handles text with no scores or names', () => {
    const result = validateRecapOutput(
      'meta_trends',
      'An interesting round of battles with diverse team compositions.',
      makeRecapFactPack()
    );
    expect(result.valid).toBe(true);
  });

  it('handles single-mode task IDs', () => {
    // single_recap should check all matches
    const result = validateRecapOutput(
      'single_recap',
      '{"headline":"Ash wins","narrative":"Ash defeated Misty 2-0.","match_summaries":[]}',
      makeRecapFactPack()
    );
    expect(result.valid).toBe(true);
  });
});
