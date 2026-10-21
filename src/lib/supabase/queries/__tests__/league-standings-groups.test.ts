import { describe, expect, it } from 'vitest';
import { assembleLeagueSchedule, toLeagueScheduleGroups } from '../league-standings';
import type { MatchWithPlayers } from '@/types/match';

/**
 * League groups in the season schedule (`assembleLeagueSchedule`): group tables count cross-group matches, the
 * combined table ranks by points per match while match counts differ, and a league without groups gets the
 * exact schedule it always had.
 */

let seq = 0;
function match(
  stage: string,
  round: string,
  p1: string,
  p2: string,
  winner: string | null,
  kickoff: string,
  status: MatchWithPlayers['status'] = 'completed',
): MatchWithPlayers {
  seq += 1;
  return {
    id: `m${seq}`,
    round_id: round,
    tournament_id: stage,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status,
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

const stages = [{ id: 'stage-1', name: 'Regular season' }];
const participants = ['a1', 'a2', 'a3', 'b1', 'b2'].map((id) => ({ id, name: id, avatar_url: null }));
const groups = toLeagueScheduleGroups([
  { id: 'sg-a', name: 'Gold', sort_order: 1, player_ids: ['a1', 'a2', 'a3'] },
  { id: 'sg-b', name: 'Silver', sort_order: 2, player_ids: ['b1', 'b2'] },
]);

// Week 1: a1 beats a2 (Gold), a3 beats b1 (cross), b2 rests. Week 2: a1 beats a3 (Gold), b2 beats b1 (Silver),
// a2 rests. Gold trainers have played 2, 1 and 2 matches; Silver 2 and 1: counts differ.
const matches = [
  match('stage-1', 'w1', 'a1', 'a2', 'a1', '2026-09-01T18:00:00Z'),
  match('stage-1', 'w1', 'a3', 'b1', 'a3', '2026-09-01T19:00:00Z'),
  match('stage-1', 'w2', 'a1', 'a3', 'a1', '2026-09-08T18:00:00Z'),
  match('stage-1', 'w2', 'b2', 'b1', 'b2', '2026-09-08T19:00:00Z'),
];

function schedule(withGroups: boolean) {
  return assembleLeagueSchedule({
    stages,
    participants,
    matchesByStage: new Map([['stage-1', matches]]),
    context: { formatType: 'singles' },
    ...(withGroups ? { groups } : {}),
  });
}

describe('assembleLeagueSchedule with league groups', () => {
  it('a league without groups: no group fields, the season table as before', () => {
    const plain = schedule(false);
    expect(plain).not.toHaveProperty('groupStandings');
    expect(plain).not.toHaveProperty('standingsRanking');
    expect(assembleLeagueSchedule({
      stages,
      participants,
      matchesByStage: new Map([['stage-1', matches]]),
      context: { formatType: 'singles' },
      groups: [],
    })).toEqual(plain);
    // Points order (generic 1 per win): a1 2, then a3 / b2 with 1 each.
    expect(plain.standings[0].player_id).toBe('a1');
  });

  it('one table per group, in group order, counting the cross-group match', () => {
    const grouped = schedule(true);
    expect(grouped.groupStandings!.map((g) => [g.groupId, g.name])).toEqual([
      ['sg-a', 'Gold'],
      ['sg-b', 'Silver'],
    ]);
    const gold = grouped.groupStandings![0].standings;
    expect(gold.map((r) => r.player_id)).toEqual(['a1', 'a3', 'a2']);
    // a3's only win is the cross match against b1.
    expect(gold.find((r) => r.player_id === 'a3')!.wins).toBe(1);
    const silver = grouped.groupStandings![1].standings;
    expect(silver.map((r) => r.player_id)).toEqual(['b2', 'b1']);
    expect(silver.find((r) => r.player_id === 'b1')!.losses).toBe(2);
  });

  it('the combined table ranks by points per match while match counts differ', () => {
    const grouped = schedule(true);
    expect(grouped.standingsRanking).toBe('points_per_match');
    // a1 2/2 = 1.0, b2 1/1 = 1.0 (a1 first: more points in the full table), a3 1/2, a2 0/1, b1 0/2.
    expect(grouped.standings.map((r) => r.player_id)).toEqual(['a1', 'b2', 'a3', 'a2', 'b1']);
  });

  it('every table moves against itself one matchday earlier', () => {
    const grouped = schedule(true);
    const gold = grouped.groupStandings![0].standings;
    // After week 1 Gold read a1, a3, a2 (a1 and a3 one win each, a1 first by participant order); unchanged now.
    expect(gold.map((r) => r.rank_change)).toEqual([0, 0, 0]);
    const silver = grouped.groupStandings![1].standings;
    // After week 1 Silver read b2 (no match), b1 (one loss) by participant order: b1, b2. b2 climbed one place.
    expect(silver.map((r) => [r.player_id, r.rank_change])).toEqual([
      ['b2', 1],
      ['b1', -1],
    ]);
  });

  it('equal match counts keep the points ranking', () => {
    const even = assembleLeagueSchedule({
      stages,
      participants: participants.filter((p) => p.id !== 'a2'),
      matchesByStage: new Map([
        [
          'stage-1',
          [
            match('stage-1', 'w1', 'a1', 'b1', 'a1', '2026-09-01T18:00:00Z'),
            match('stage-1', 'w1', 'a3', 'b2', 'b2', '2026-09-01T19:00:00Z'),
          ],
        ],
      ]),
      context: { formatType: 'singles' },
      groups: toLeagueScheduleGroups([
        { id: 'sg-a', name: 'Gold', sort_order: 1, player_ids: ['a1', 'a3'] },
        { id: 'sg-b', name: 'Silver', sort_order: 2, player_ids: ['b1', 'b2'] },
      ]),
    });
    expect(even.standingsRanking).toBe('points');
  });
});
