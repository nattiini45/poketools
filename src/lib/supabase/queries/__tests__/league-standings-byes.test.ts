import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchWithPlayers } from '@/types/match';
import type { ByeRound } from '../rounds';

const h = vi.hoisted(() => ({
  getMatchesByTournamentIds: vi.fn(),
  loadSeasonSwissByeRounds: vi.fn(),
}));

vi.mock('../tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('../seasons', () => ({ getPublicSeasonParticipants: vi.fn() }));
vi.mock('../season-groups', () => ({ getSeasonGroups: vi.fn() }));
vi.mock('../matches', () => ({ getMatchesByTournamentIds: h.getMatchesByTournamentIds }));
vi.mock('@/lib/tournament/scoring-byes', () => ({ loadSeasonSwissByeRounds: h.loadSeasonSwissByeRounds }));

import { assembleLeagueSchedule, getLeagueSchedule, type LeagueScheduleStage } from '../league-standings';

/**
 * Swiss stage byes in the season-wide table (`assembleLeagueSchedule`): scored like the stage's own table,
 * never for another bracket type or an Evolution Point Buy league, and absent for rounds that store none.
 */

let seq = 0;
function match(round: string, p1: string, p2: string, winner: string | null, kickoff: string): MatchWithPlayers {
  seq += 1;
  return {
    id: `m${seq}`,
    round_id: round,
    tournament_id: 'swiss-1',
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status: 'completed',
    date_played: null,
    scheduled_at: kickoff,
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: kickoff,
    updated_at: kickoff,
    player_1_name: p1,
    player_2_name: p2,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner,
    round_status: 'completed',
    games: [],
  } as unknown as MatchWithPlayers;
}

const swissStage: LeagueScheduleStage = { id: 'swiss-1', name: 'Swiss', bracket_type: 'swiss' };
const participants = ['a', 'b', 'e'].map((id) => ({ id, name: id, avatar_url: null }));
const context = { formatType: 'standard' };

const round1Matches = [match('r1', 'a', 'b', 'a', '2026-09-01T18:00:00Z')];
const round2Matches = [match('r2', 'a', 'b', 'a', '2026-09-08T18:00:00Z')];

function byeRound(id: string, round_number: number, byePlayers: string[], tournament_id = 'swiss-1'): ByeRound {
  return { id, tournament_id, round_number, bye_player_ids: byePlayers };
}

function row(schedule: ReturnType<typeof assembleLeagueSchedule>, id: string) {
  return schedule.standings.find((s) => s.player_id === id)!;
}

describe('assembleLeagueSchedule with Swiss stage byes', () => {
  const matchesByStage = new Map([['swiss-1', round1Matches]]);

  it('scores a Swiss stage bye as a win, like the stage table does', () => {
    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage,
      context,
      byeRoundsByStage: new Map([['swiss-1', [byeRound('r1', 1, ['e'])]]]),
    });

    const eve = row(schedule, 'e');
    expect(eve.wins).toBe(1);
    expect(eve.points).toBe(1);
    expect(eve.losses).toBe(0);
    expect(eve.games_played).toBe(0);
    // The bye player ranks with the other winner on points, ahead of the loser.
    expect(schedule.standings.map((s) => s.player_id)).toEqual(['a', 'e', 'b']);
  });

  it('scores no bye of a round robin or elimination stage', () => {
    for (const bracket_type of ['round_robin', 'single_elim', 'double_elim'] as const) {
      const schedule = assembleLeagueSchedule({
        stages: [{ ...swissStage, bracket_type }],
        participants,
        matchesByStage,
        context,
        byeRoundsByStage: new Map([['swiss-1', [byeRound('r1', 1, ['e'])]]]),
      });
      expect(row(schedule, 'e').wins).toBe(0);
    }
  });

  it('scores each bye by the stage it belongs to when a season mixes stage types', () => {
    const schedule = assembleLeagueSchedule({
      stages: [swissStage, { id: 'rr-1', name: 'Round robin', bracket_type: 'round_robin' }],
      participants,
      matchesByStage,
      context,
      byeRoundsByStage: new Map([
        ['swiss-1', [byeRound('r1', 1, ['e'])]],
        ['rr-1', [byeRound('rr-r1', 1, ['b'], 'rr-1')]],
      ]),
    });
    expect(row(schedule, 'e').wins).toBe(1);
    expect(row(schedule, 'b').wins).toBe(0);
  });

  it('leaves historic standings unchanged: rounds with empty bye_player_ids give the table it always was', () => {
    const baseline = assembleLeagueSchedule({ stages: [swissStage], participants, matchesByStage, context });
    const legacy = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage,
      context,
      byeRoundsByStage: new Map([['swiss-1', [byeRound('r1', 1, [])]]]),
    });
    expect(legacy).toEqual(baseline);
  });

  it('leaves Evolution Point Buy standings exactly as they are', () => {
    const epbContext = { formatType: 'evolution_point_buy', evolutionPoints: { a: 1, b: 0, e: 0 } };
    const baseline = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage,
      context: epbContext,
    });
    const withByes = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage,
      context: epbContext,
      byeRoundsByStage: new Map([['swiss-1', [byeRound('r1', 1, ['e'])]]]),
    });
    expect(withByes).toEqual(baseline);
  });

  it('holds the latest matchday bye out of the previous table, so the movement column shows it', () => {
    const twoMatchdays = new Map([['swiss-1', [...round1Matches, ...round2Matches]]]);
    const byeRounds = new Map([['swiss-1', [byeRound('r1', 1, []), byeRound('r2', 2, ['e'])]]]);

    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage: twoMatchdays,
      context,
      byeRoundsByStage: byeRounds,
    });

    expect(schedule.standings.map((s) => s.player_id)).toEqual(['a', 'e', 'b']);
    // Before round 2 Eve had no points and sat last; her round 2 bye lifts her one place.
    expect(row(schedule, 'e').rank_change).toBe(1);
    expect(row(schedule, 'b').rank_change).toBe(-1);
  });

  it('keeps the bye of an earlier round in the previous table', () => {
    const twoMatchdays = new Map([['swiss-1', [...round1Matches, ...round2Matches]]]);
    const byeRounds = new Map([['swiss-1', [byeRound('r1', 1, ['e']), byeRound('r2', 2, [])]]]);

    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage: twoMatchdays,
      context,
      byeRoundsByStage: byeRounds,
    });

    expect(row(schedule, 'e').wins).toBe(1);
    expect(row(schedule, 'e').rank_change).toBe(0);
  });
});

describe('the previous table follows the matchday order, not the round number', () => {
  it('keeps the bye of a higher-numbered round that was played before a delayed lower-numbered one', () => {
    // Round 3 was played on 09-08; the delayed round 2 is played last (09-15), so it is the latest matchday.
    const matches = new Map([
      [
        'swiss-1',
        [
          match('r1', 'a', 'b', 'a', '2026-09-01T18:00:00Z'),
          match('r3', 'a', 'b', 'a', '2026-09-08T18:00:00Z'),
          match('r2', 'a', 'b', 'a', '2026-09-15T18:00:00Z'),
        ],
      ],
    ]);
    const byeRounds = new Map([['swiss-1', [byeRound('r1', 1, []), byeRound('r2', 2, []), byeRound('r3', 3, ['e'])]]]);

    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage: matches,
      context,
      byeRoundsByStage: byeRounds,
    });

    expect(schedule.standings.map((s) => s.player_id)).toEqual(['a', 'e', 'b']);
    // Round 3's bye already stood before the latest matchday (round 2), so Eve did not move.
    expect(row(schedule, 'e').rank_change).toBe(0);
    expect(row(schedule, 'b').rank_change).toBe(0);
  });

  it('still holds back the bye of a generated round nobody has played yet when it comes after the latest one', () => {
    const matches = new Map([['swiss-1', [...round1Matches, ...round2Matches]]]);
    const byeRounds = new Map([['swiss-1', [byeRound('r1', 1, []), byeRound('r2', 2, []), byeRound('r3', 3, ['e'])]]]);

    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage: matches,
      context,
      byeRoundsByStage: byeRounds,
    });

    // Round 3 is generated (its bye scores now) but not played: it is after the latest matchday, so it moves Eve.
    expect(row(schedule, 'e').rank_change).toBe(1);
  });
});

describe('the previous table with several stages', () => {
  const roundRobinStage: LeagueScheduleStage = { id: 'rr-1', name: 'RR', bracket_type: 'round_robin' };

  it('holds out the bye of a Swiss round generated after a round robin matchday', () => {
    const schedule = assembleLeagueSchedule({
      stages: [roundRobinStage, swissStage],
      participants,
      matchesByStage: new Map([
        [
          'rr-1',
          [
            match('rr-r1', 'a', 'b', 'a', '2026-09-01T18:00:00Z'),
            match('rr-r2', 'a', 'b', 'a', '2026-09-08T18:00:00Z'),
          ],
        ],
      ]),
      context,
      byeRoundsByStage: new Map([['swiss-1', [byeRound('s1', 1, ['e'])]]]),
    });

    expect(schedule.standings.map((s) => s.player_id)).toEqual(['a', 'e', 'b']);
    expect(row(schedule, 'e').rank_change).toBe(1);
    expect(row(schedule, 'b').rank_change).toBe(-1);
  });

  it('holds out the bye of a later Swiss stage whose round nobody has played yet', () => {
    const schedule = assembleLeagueSchedule({
      stages: [swissStage, { id: 'swiss-2', name: 'Swiss 2', bracket_type: 'swiss' }],
      participants,
      matchesByStage: new Map([['swiss-1', [...round1Matches, ...round2Matches]]]),
      context,
      byeRoundsByStage: new Map([
        ['swiss-1', [byeRound('r1', 1, []), byeRound('r2', 2, [])]],
        ['swiss-2', [byeRound('s2r1', 1, ['e'], 'swiss-2')]],
      ]),
    });

    expect(row(schedule, 'e').rank_change).toBe(1);
  });

  it('keeps the bye of an unplayed Swiss round of an earlier stage in the previous table', () => {
    const schedule = assembleLeagueSchedule({
      stages: [swissStage, roundRobinStage],
      participants,
      matchesByStage: new Map([
        [
          'rr-1',
          [
            match('rr-r1', 'a', 'b', 'a', '2026-09-01T18:00:00Z'),
            match('rr-r2', 'a', 'b', 'a', '2026-09-08T18:00:00Z'),
          ],
        ],
      ]),
      context,
      byeRoundsByStage: new Map([['swiss-1', [byeRound('s1', 1, ['e'])]]]),
    });

    expect(row(schedule, 'e').rank_change).toBe(0);
  });
});

describe('getLeagueSchedule', () => {
  beforeEach(() => {
    h.getMatchesByTournamentIds.mockReset().mockResolvedValue(new Map([['swiss-1', round1Matches]]));
    h.loadSeasonSwissByeRounds
      .mockReset()
      .mockResolvedValue(new Map([['swiss-1', [byeRound('r1', 1, ['e'])]]]));
  });

  const preloaded = { stages: [swissStage], participants, groups: [] };

  it('reads the rounds of all Swiss stages in one batched call and scores their byes', async () => {
    const schedule = await getLeagueSchedule('season-1', { ...preloaded, context });

    expect(h.loadSeasonSwissByeRounds).toHaveBeenCalledTimes(1);
    expect(h.loadSeasonSwissByeRounds).toHaveBeenCalledWith('season-1');
    expect(row(schedule, 'e').wins).toBe(1);
  });

  it('reads no rounds for a league without a Swiss stage', async () => {
    await getLeagueSchedule('season-1', {
      ...preloaded,
      stages: [{ id: 'rr-1', name: 'Round robin', bracket_type: 'round_robin' }],
      context,
    });

    expect(h.loadSeasonSwissByeRounds).not.toHaveBeenCalled();
  });

  it('reads no rounds for an Evolution Point Buy league', async () => {
    await getLeagueSchedule('season-1', {
      ...preloaded,
      context: { formatType: 'evolution_point_buy', evolutionPoints: {} },
    });

    expect(h.loadSeasonSwissByeRounds).not.toHaveBeenCalled();
  });
});

describe('assembleLeagueSchedule ranking of an Evolution Point Buy league', () => {
  // a beat b in both matchdays; e has played nobody but holds the most evolution points.
  const matchesByStage = new Map([['swiss-1', [...round1Matches, ...round2Matches]]]);
  const order = (context: Parameters<typeof assembleLeagueSchedule>[0]['context']) =>
    assembleLeagueSchedule({ stages: [swissStage], participants, matchesByStage, context }).standings.map(
      (s) => s.player_id,
    );
  const epb = { formatType: 'evolution_point_buy', evolutionPoints: { a: 0, b: 1, e: 10 } };

  it('the season table ranks by the stored tiebreaker order, the pack chain without one', () => {
    expect(order(epb)).toEqual(['a', 'e', 'b']);
    expect(order({ ...epb, tiebreakerOrder: ['evolution_points', 'match_points'] })).toEqual(['e', 'b', 'a']);
  });

  it('the previous matchday snapshot uses the same order, so the rank movement agrees with the table', () => {
    const schedule = assembleLeagueSchedule({
      stages: [swissStage],
      participants,
      matchesByStage,
      context: { ...epb, tiebreakerOrder: ['evolution_points', 'match_points'] },
    });
    // Both tables rank e first and a last: nobody moved.
    expect(schedule.standings.map((s) => [s.player_id, s.rank_change])).toEqual([
      ['e', 0],
      ['b', 0],
      ['a', 0],
    ]);
  });

  it('a stored order has no effect on any other league format', () => {
    const singles = { formatType: 'singles', tiebreakerOrder: ['evolution_points'] as const };
    expect(order(singles)).toEqual(order({ formatType: 'singles' }));
  });
});

