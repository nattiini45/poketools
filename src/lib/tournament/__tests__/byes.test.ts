import { describe, it, expect } from 'vitest';
import { byeRecordsFromRounds, scoringByeRecords } from '../byes';
import { buildPairingHistory, computeStandings, havePlayed } from '../standings';
import { generateSwissRound } from '../swiss';
import { BYE_PLAYER_ID } from '../types';
import type { ByeRecord, MatchRecord } from '../types';

const names: Record<string, string> = {
  a: 'Alice',
  b: 'Bob',
  c: 'Charlie',
  d: 'Dana',
  e: 'Eve',
};

const rounds = [
  { round_number: 1, bye_player_ids: ['e'] },
  { round_number: 2, bye_player_ids: [] },
  { round_number: 3, bye_player_ids: ['d', 'c'] },
];

describe('byeRecordsFromRounds', () => {
  it('flattens every round into one record per bye player', () => {
    expect(byeRecordsFromRounds(rounds)).toEqual([
      { player_id: 'e', round_number: 1 },
      { player_id: 'd', round_number: 3 },
      { player_id: 'c', round_number: 3 },
    ]);
  });

  it('is empty for rounds without byes (legacy rounds hold {})', () => {
    expect(byeRecordsFromRounds([{ round_number: 1, bye_player_ids: [] }])).toEqual([]);
    expect(byeRecordsFromRounds([])).toEqual([]);
  });
});

describe('scoringByeRecords (only a Swiss stage scores its byes)', () => {
  it('returns the stored byes for swiss', () => {
    expect(scoringByeRecords('swiss', rounds)).toHaveLength(3);
  });

  it('returns nothing for round robin, elimination or an unknown stage', () => {
    for (const bracketType of ['round_robin', 'single_elim', 'double_elim', null, undefined] as const) {
      expect(scoringByeRecords(bracketType, rounds)).toEqual([]);
    }
  });
});

describe('computeStandings with stored byes', () => {
  const matches: MatchRecord[] = [
    { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
    { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
  ];
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('counts a bye as a win worth the stage win points', () => {
    const byes: ByeRecord[] = [{ player_id: 'e', round_number: 1 }];
    const standings = computeStandings(ids, names, matches, {}, { byes });
    const eve = standings.find((s) => s.player_id === 'e')!;
    expect(eve.wins).toBe(1);
    expect(eve.points).toBe(1);
    expect(eve.losses).toBe(0);
    expect(eve.draws).toBe(0);
  });

  it('uses the caller points per win (3 for a league stage)', () => {
    const standings = computeStandings(
      ids,
      names,
      matches,
      {},
      { byes: [{ player_id: 'e', round_number: 1 }], pointsPerWin: 3 },
    );
    expect(standings.find((s) => s.player_id === 'e')!.points).toBe(3);
  });

  it('has no games, no kills and no opponent: Buchholz and kill differential stay untouched', () => {
    const withBye = computeStandings(ids, names, matches, {}, { byes: [{ player_id: 'e', round_number: 1 }] });
    const without = computeStandings(ids, names, matches);
    const field = (rows: typeof withBye, id: string) => rows.find((s) => s.player_id === id)!;
    for (const id of ids) {
      expect(field(withBye, id).buchholz).toBe(field(without, id).buchholz);
      expect(field(withBye, id).kill_differential).toBe(0);
      expect(field(withBye, id).games_played).toBe(0);
    }
    // Eve has no opponent: nothing is summed for her.
    expect(field(withBye, 'e').buchholz).toBe(0);
  });

  it('ranks the bye player above a player without a result', () => {
    const standings = computeStandings(['a', 'e'], names, [], {}, { byes: [{ player_id: 'e', round_number: 1 }] });
    expect(standings.map((s) => s.player_id)).toEqual(['e', 'a']);
  });

  it('respects maxRound and ignores players outside the stage', () => {
    const byes: ByeRecord[] = [
      { player_id: 'e', round_number: 1 },
      { player_id: 'e', round_number: 3 },
      { player_id: 'zz', round_number: 1 },
    ];
    const upToRound1 = computeStandings(ids, names, matches, {}, { byes, maxRound: 1 });
    expect(upToRound1.find((s) => s.player_id === 'e')!.wins).toBe(1);
    const all = computeStandings(ids, names, matches, {}, { byes });
    expect(all.find((s) => s.player_id === 'e')!.wins).toBe(2);
    expect(all.some((s) => s.player_id === 'zz')).toBe(false);
  });

  it('leaves a completed season unchanged: legacy rounds hold {} and give no bye records', () => {
    // A finished Swiss season, recorded before byes were stored.
    const legacyMatches: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: null, round_number: 1 },
      { player_1_id: 'a', player_2_id: 'c', winner_id: 'c', round_number: 2 },
      { player_1_id: 'b', player_2_id: 'e', winner_id: 'b', round_number: 2 },
      { player_1_id: 'a', player_2_id: 'd', winner_id: 'a', round_number: 3 },
    ];
    const legacyRounds = [1, 2, 3].map((round_number) => ({ round_number, bye_player_ids: [] as string[] }));
    const baseline = computeStandings(ids, names, legacyMatches);
    const byes = scoringByeRecords('swiss', legacyRounds);
    expect(byes).toEqual([]);
    expect(computeStandings(ids, names, legacyMatches, {}, { byes })).toEqual(baseline);
    expect(computeStandings(ids, names, legacyMatches, {}, { byes, pointsPerWin: 3, pointsPerDraw: 1 })).toEqual(
      computeStandings(ids, names, legacyMatches, {}, { pointsPerWin: 3, pointsPerDraw: 1 }),
    );
  });
});

describe('buildPairingHistory with stored byes', () => {
  it('records a bye as a pairing against the BYE id', () => {
    const history = buildPairingHistory([], [{ player_id: 'e', round_number: 1 }]);
    expect(havePlayed(history, 'e', BYE_PLAYER_ID)).toBe(true);
    expect(havePlayed(history, 'a', BYE_PLAYER_ID)).toBe(false);
  });

  it('keeps the match-only behaviour when no byes are passed', () => {
    const matches: MatchRecord[] = [{ player_1_id: 'b', player_2_id: 'a', winner_id: 'a', round_number: 1 }];
    expect([...buildPairingHistory(matches)]).toEqual([...buildPairingHistory(matches, [])]);
    expect([...buildPairingHistory(matches)]).toEqual(['a::b']);
  });
});

describe('generateSwissRound with stored byes (no second bye)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('skips a player whose bye is stored, even though no match records it', () => {
    // After round 1 (a-b, c-d, e had the bye) nobody has lost yet but e: e is
    // not last. Make e the lowest ranked so the old code would hand e the bye again.
    const history: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
    ];
    // Without the stored bye: e (0 points, last) draws the bye again.
    const without = generateSwissRound(ids, names, history, 2);
    expect(without.bye_player_ids).toEqual(['e']);

    // e's bye is stored: e counts as a winner and must not get a second bye.
    const withBye = generateSwissRound(ids, names, history, 2, [{ player_id: 'e', round_number: 1 }]);
    expect(withBye.bye_player_ids).toHaveLength(1);
    expect(withBye.bye_player_ids[0]).not.toBe('e');
  });

  it('gives a different player the bye every round until all have had one', () => {
    const roster = ['a', 'b', 'c', 'd', 'e'];
    const matches: MatchRecord[] = [];
    const byes: ByeRecord[] = [];
    const received: string[] = [];

    for (let roundNumber = 1; roundNumber <= 5; roundNumber++) {
      const round = generateSwissRound(roster, names, matches, roundNumber, byes);
      expect(round.bye_player_ids).toHaveLength(1);
      received.push(round.bye_player_ids[0]);
      byes.push({ player_id: round.bye_player_ids[0], round_number: roundNumber });
      // The higher seed (earlier in the roster) wins every game.
      for (const pairing of round.pairings) {
        const winner = roster.indexOf(pairing.player_1_id) < roster.indexOf(pairing.player_2_id)
          ? pairing.player_1_id
          : pairing.player_2_id;
        matches.push({ ...pairing, winner_id: winner, round_number: roundNumber });
      }
    }

    expect(new Set(received).size).toBe(5);
  });

  it('is unchanged without a bye history (pairings of existing tournaments)', () => {
    const history: MatchRecord[] = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
    ];
    expect(generateSwissRound(ids, names, history, 2, [])).toEqual(generateSwissRound(ids, names, history, 2));
  });
});
