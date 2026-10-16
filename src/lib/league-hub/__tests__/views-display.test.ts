/**
 * League hub view builders added after the PR #65 test pass:
 *
 *   - displayed round and phase statuses: the stored status, unless the
 *     matches prove the round or phase further along (a finished playoff
 *     read "Pending" / "In progress" next to every final result);
 *   - which phases show their advancement rule (never the final phase or an
 *     elimination phase);
 *   - group membership shared by the group tables and the phase cards;
 *   - Evolution Point Buy group tables keep the season gym bands.
 *
 * Pure module: every input is a hand-built row; nothing reads.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTableStage,
  displayRoundStatus,
  displayStageStatus,
  groupStageMatches,
  openRoundId,
  resolveGroupMembers,
  showsAdvancement,
  stageFinishedByMatches,
  withDisplayStatus,
  type HubStage,
  type TableStageInput,
} from '../views';
import { NO_SEASON_CONTEXT } from '@/lib/tournament/season-standings';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { PublicMatch } from '@/lib/match/public-match';
import type { AdvancementRule, TournamentGroupWithMembers } from '@/types/season';
import type { BracketSide, MatchStatus } from '@/types/match';
import type { Round } from '@/types/round';

const T0 = '2026-03-01T18:00:00Z';
const TOP_FOUR: AdvancementRule = { type: 'top_n', count: 4, per_group: false };

function stage(id: string, overrides: Partial<HubStage> = {}): HubStage {
  return {
    id,
    name: `Phase ${id}`,
    bracket_type: 'round_robin',
    status: 'active',
    best_of_default: 3,
    participant_count: 4,
    advancement_rule: null,
    current_round: 1,
    stage_order: 1,
    ...overrides,
  };
}

function match(
  id: string,
  p1: string,
  p2: string,
  status: MatchStatus,
  overrides: Partial<PublicMatch> = {},
): PublicMatch {
  const winner = status === 'completed' ? p1 : null;
  return {
    id,
    round_id: 'r1',
    tournament_id: 'stage',
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status,
    date_played: null,
    scheduled_at: null,
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: T0,
    updated_at: T0,
    player_1_name: p1,
    player_2_name: p2,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner,
    round_status: 'active',
    games: winner
      ? [
          { id: `${id}-g1`, game_number: 1, winner_id: winner, replay_url: '', source: 'manual', stats_locked: false },
        ]
      : [],
    ...overrides,
  };
}

function round(id: string, roundNumber: number, status: Round['status'], side: BracketSide | null = null): Round {
  return {
    id,
    tournament_id: 'stage',
    name: `Round ${roundNumber}`,
    round_number: roundNumber,
    best_of: 3,
    status,
    pairings_generated: true,
    deadline: null,
    bracket_side: side,
    created_at: T0,
    updated_at: T0,
  };
}

function fixture(stageId: string, m: PublicMatch): LeagueFixture {
  return { stageId, stageName: `Phase ${stageId}`, match: { ...m, tournament_id: stageId } };
}

function group(id: string, groupNumber: number, memberIds: string[]): TournamentGroupWithMembers {
  return {
    id,
    tournament_id: 'stage',
    name: `Group ${groupNumber}`,
    group_number: groupNumber,
    created_at: T0,
    updated_at: T0,
    members: memberIds.map((player_id, index) => ({ player_id, player_name: `row:${player_id}`, seed: index + 1, gym_type: null })),
  };
}

function tableInput(overrides: Partial<TableStageInput> & Pick<TableStageInput, 'stage'>): TableStageInput {
  return {
    matches: [],
    participants: [],
    groups: [],
    battleStats: [],
    roundNumbers: {},
    context: NO_SEASON_CONTEXT,
    gymTypes: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Displayed statuses
// ---------------------------------------------------------------------------

/**
 * Rounds `from`..`to` of a round robin among `ids` as the circle method pairs
 * them ("Generate next round" creates one such round per click), every match
 * with the given status. Match ids carry the prefix so groups stay distinct.
 */
function roundRobinMatches(
  ids: string[],
  to: number,
  status: MatchStatus = 'completed',
  prefix = 'm',
  from = 1,
): PublicMatch[] {
  const out: PublicMatch[] = [];
  for (let r = from; r <= to; r++) {
    generateRoundRobinRound(ids, r).pairings.forEach((pairing, index) => {
      out.push(match(`${prefix}-r${r}-${index}`, pairing.player_1_id, pairing.player_2_id, status, { round_id: `${prefix}-r${r}` }));
    });
  }
  return out;
}

const players = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

describe('stageFinishedByMatches', () => {
  it('a round robin is finished once every pairing has been played', () => {
    const rr = stage('rr', { participant_count: 4 });
    const full = roundRobinMatches(players('p', 4), getRoundRobinTotalRounds(4));
    expect(full).toHaveLength(6);
    expect(stageFinishedByMatches(rr, full)).toBe(true);
    expect(stageFinishedByMatches(rr, [...full.slice(0, 5), { ...full[5], status: 'scheduled' }])).toBe(false);
    expect(stageFinishedByMatches(rr, [])).toBe(false);
  });

  it('a round robin generated one round at a time is not finished while rounds are still to come', () => {
    // 8 players, "Generate next round" once a week: after week 1 (and week 3)
    // every match that exists is confirmed, but 6 (4) rounds are still to come.
    const ids = players('p', 8);
    const rr = stage('rr', { participant_count: 8 });
    expect(stageFinishedByMatches(rr, roundRobinMatches(ids, 1))).toBe(false);
    expect(stageFinishedByMatches(rr, roundRobinMatches(ids, 3))).toBe(false);
    expect(stageFinishedByMatches(rr, roundRobinMatches(ids, 6))).toBe(false);
    expect(stageFinishedByMatches(rr, roundRobinMatches(ids, 7))).toBe(true);
    // An odd field (byes): every round leaves someone out until the last.
    const odd = players('o', 5);
    const rr5 = stage('rr5', { participant_count: 5 });
    expect(stageFinishedByMatches(rr5, roundRobinMatches(odd, 1))).toBe(false);
    expect(stageFinishedByMatches(rr5, roundRobinMatches(odd, 4))).toBe(false);
    expect(stageFinishedByMatches(rr5, roundRobinMatches(odd, 5))).toBe(true);
  });

  it('every round robin field up to 16 players reads finished only on its last round', () => {
    for (let n = 2; n <= 16; n++) {
      const ids = players('p', n);
      const rr = stage(`rr${n}`, { participant_count: n });
      const total = getRoundRobinTotalRounds(n);
      for (let r = 1; r < total; r++) expect(stageFinishedByMatches(rr, roundRobinMatches(ids, r)), `${n} players, ${r}/${total}`).toBe(false);
      expect(stageFinishedByMatches(rr, roundRobinMatches(ids, total)), `${n} players, ${total}/${total}`).toBe(true);
    }
  });

  it('a grouped round robin is finished once every group has played every pairing', () => {
    const a = players('a', 4);
    const b = players('b', 4);
    const rr = stage('rr', { participant_count: 8 });
    // Round 1 of two groups of four: four pairs, each "complete" on its own.
    expect(stageFinishedByMatches(rr, [...roundRobinMatches(a, 1, 'completed', 'a'), ...roundRobinMatches(b, 1, 'completed', 'b')])).toBe(false);
    expect(stageFinishedByMatches(rr, [...roundRobinMatches(a, 2, 'completed', 'a'), ...roundRobinMatches(b, 2, 'completed', 'b')])).toBe(false);
    // One group done, the other a round short.
    expect(stageFinishedByMatches(rr, [...roundRobinMatches(a, 3, 'completed', 'a'), ...roundRobinMatches(b, 2, 'completed', 'b')])).toBe(false);
    expect(stageFinishedByMatches(rr, [...roundRobinMatches(a, 3, 'completed', 'a'), ...roundRobinMatches(b, 3, 'completed', 'b')])).toBe(true);
    // Groups of different sizes (3 and 4).
    const c = players('c', 3);
    const mixed = stage('mixed', { participant_count: 7 });
    expect(stageFinishedByMatches(mixed, [...roundRobinMatches(c, 3, 'completed', 'c'), ...roundRobinMatches(a, 3, 'completed', 'a')])).toBe(true);
    expect(stageFinishedByMatches(mixed, [...roundRobinMatches(c, 2, 'completed', 'c'), ...roundRobinMatches(a, 3, 'completed', 'a')])).toBe(false);
  });

  it('a round robin is not finished while an enrolled player has played no match', () => {
    const full = roundRobinMatches(players('p', 4), 3);
    expect(stageFinishedByMatches(stage('rr', { participant_count: 5 }), full)).toBe(false);
  });

  it('a second leg is finished only once every pairing has played it', () => {
    const ids = players('p', 4);
    const rr = stage('rr', { participant_count: 4 });
    const firstLeg = roundRobinMatches(ids, 3);
    const secondLeg = roundRobinMatches(ids, 3, 'completed', 'leg2');
    expect(stageFinishedByMatches(rr, [...firstLeg, ...secondLeg.slice(0, 2)])).toBe(false);
    expect(stageFinishedByMatches(rr, [...firstLeg, ...secondLeg])).toBe(true);
  });

  it('Swiss is never proved finished: the next round may not be paired yet', () => {
    expect(stageFinishedByMatches(stage('sw', { bracket_type: 'swiss' }), [match('a', 'p1', 'p2', 'completed')])).toBe(false);
  });

  it('a single elimination needs one match per eliminated player', () => {
    const se = stage('se', { bracket_type: 'single_elim', participant_count: 4 });
    const semis = [match('s1', 'p1', 'p4', 'completed'), match('s2', 'p2', 'p3', 'completed')];
    // Semifinals played, the final not created yet: not finished.
    expect(stageFinishedByMatches(se, semis)).toBe(false);
    expect(stageFinishedByMatches(se, [...semis, match('f', 'p1', 'p2', 'completed')])).toBe(true);
  });

  it('a double elimination is finished once a grand-final match is completed and nothing is open', () => {
    const de = stage('de', { bracket_type: 'double_elim' });
    const wb = match('wb', 'p1', 'p2', 'completed', { round_id: 'wb' });
    const gfByRow = match('gf', 'p1', 'p3', 'completed', { round_id: 'gf' });
    expect(stageFinishedByMatches(de, [wb])).toBe(false);
    // The grand-final side read from the match row, or from its round row.
    expect(stageFinishedByMatches(de, [wb, { ...gfByRow, bracket_side: 'grand_finals' }])).toBe(true);
    expect(stageFinishedByMatches(de, [wb, gfByRow], { gf: 'grand_finals' })).toBe(true);
    // The losers-side champion won the grand final: the reset is open.
    const reset = match('reset', 'p1', 'p3', 'scheduled', { round_id: 'gf' });
    expect(stageFinishedByMatches(de, [wb, gfByRow, reset], { gf: 'grand_finals' })).toBe(false);
  });
});

describe('displayStageStatus', () => {
  it('moves a stale stored status up to what the matches prove', () => {
    const done = roundRobinMatches(players('p', 4), 3);
    expect(displayStageStatus(stage('rr', { status: 'active' }), done)).toBe('completed');
    expect(displayStageStatus(stage('rr', { status: 'upcoming' }), done)).toBe('completed');
    expect(displayStageStatus(stage('rr', { status: 'upcoming' }), [match('a', 'p1', 'p2', 'in_progress')])).toBe('active');
  });

  it('keeps a round robin active while only the rounds generated so far are played', () => {
    const rr = stage('rr', { status: 'active', participant_count: 8 });
    expect(displayStageStatus(rr, roundRobinMatches(players('p', 8), 1))).toBe('active');
    // A stored "upcoming" still moves up to active: matches have been played.
    expect(displayStageStatus({ ...rr, status: 'upcoming' }, roundRobinMatches(players('p', 8), 1))).toBe('active');
  });

  it('never moves a status back', () => {
    expect(displayStageStatus(stage('rr', { status: 'completed' }), [match('a', 'p1', 'p2', 'scheduled')])).toBe('completed');
    expect(displayStageStatus(stage('rr', { status: 'active' }), [])).toBe('active');
    expect(displayStageStatus(stage('rr', { status: 'upcoming' }), [match('a', 'p1', 'p2', 'scheduled')])).toBe('upcoming');
  });

  it('withDisplayStatus copies the stage only when the status changes', () => {
    const active = stage('rr', { status: 'active' });
    expect(withDisplayStatus(active, [match('a', 'p1', 'p2', 'scheduled')])).toBe(active);
    const shown = withDisplayStatus(active, roundRobinMatches(players('p', 4), 3));
    expect(shown).not.toBe(active);
    expect(shown.status).toBe('completed');
    expect(active.status).toBe('active');
  });
});

describe('displayRoundStatus', () => {
  const table = { elimination: false, stageFinished: false };
  const done = [match('a', 'p1', 'p2', 'completed'), match('b', 'p3', 'p4', 'completed')];

  it('a table round whose matches are all completed reads completed', () => {
    expect(displayRoundStatus('pending', done, table)).toBe('completed');
    expect(displayRoundStatus('active', done, table)).toBe('completed');
  });

  it('a round with a started match reads at least active', () => {
    expect(displayRoundStatus('pending', [match('a', 'p1', 'p2', 'completed'), match('b', 'p3', 'p4', 'scheduled')], table)).toBe(
      'active',
    );
    expect(displayRoundStatus('pending', [match('a', 'p1', 'p2', 'pending_confirmation')], table)).toBe('active');
  });

  it('an elimination round reads completed only once its phase is finished', () => {
    expect(displayRoundStatus('pending', done, { elimination: true, stageFinished: false })).toBe('active');
    expect(displayRoundStatus('pending', done, { elimination: true, stageFinished: true })).toBe('completed');
  });

  it('keeps a more advanced stored status, and no status stays none', () => {
    expect(displayRoundStatus('completed', [match('a', 'p1', 'p2', 'scheduled')], table)).toBe('completed');
    expect(displayRoundStatus(null, done, table)).toBeNull();
  });
});

describe('groupStageMatches — displayed statuses', () => {
  it('a round robin with only its first round generated and played stays active on the matches and groups tabs', () => {
    const rr = stage('rr', { status: 'active', participant_count: 8 });
    const ids = players('p', 8);
    const weekOne = roundRobinMatches(ids, 1).map((m) => ({ ...m, round_id: 'r1' }));
    const [result] = groupStageMatches([rr], weekOne.map((m) => fixture('rr', m)), { rr: [round('r1', 1, 'active')] });
    expect(result.stage.status).toBe('active');
    // The round itself is over: a table round is paired in full.
    expect(result.rounds.map((r) => r.status)).toEqual(['completed']);
    const table = buildTableStage(
      tableInput({ stage: rr, matches: weekOne, participants: ids.map((id) => ({ id, name: id, avatar_url: null })) }),
    );
    expect(table.stage.status).toBe('active');
  });

  it('a finished double elimination reads completed on every round and on the phase', () => {
    const de = stage('de', { bracket_type: 'double_elim', status: 'active' });
    const rounds = [
      round('wb1', 1, 'completed', 'winners'),
      round('lb1', 2, 'active', 'losers'),
      round('gf', 3, 'pending', 'grand_finals'),
    ];
    const fixtures = [
      fixture('de', match('wb1-a', 'p1', 'p2', 'completed', { round_id: 'wb1' })),
      fixture('de', match('lb1-a', 'p3', 'p2', 'completed', { round_id: 'lb1' })),
      fixture('de', match('gf-a', 'p1', 'p3', 'completed', { round_id: 'gf' })),
    ];
    const [result] = groupStageMatches([de], fixtures, { de: rounds });
    expect(result.stage.status).toBe('completed');
    expect(result.rounds.map((r) => [r.roundId, r.status])).toEqual([
      ['wb1', 'completed'],
      ['lb1', 'completed'],
      ['gf', 'completed'],
    ]);
    // The cached stage row is not touched.
    expect(de.status).toBe('active');
  });

  it('a running double elimination shows played rounds as active, never completed', () => {
    const de = stage('de', { bracket_type: 'double_elim', status: 'active' });
    const rounds = [round('wb1', 1, 'pending', 'winners'), round('wb2', 2, 'pending', 'winners')];
    const fixtures = [
      fixture('de', match('wb1-a', 'p1', 'p2', 'completed', { round_id: 'wb1' })),
      fixture('de', match('wb2-a', 'p1', 'p3', 'scheduled', { round_id: 'wb2' })),
    ];
    const [result] = groupStageMatches([de], fixtures, { de: rounds });
    expect(result.stage.status).toBe('active');
    expect(result.rounds.map((r) => r.status)).toEqual(['active', 'pending']);
    // The played round reads active, but the round still to play opens.
    expect(openRoundId(result.rounds)).toBe('wb2');
  });
});

// ---------------------------------------------------------------------------
// Advancement
// ---------------------------------------------------------------------------

describe('showsAdvancement', () => {
  const groups = stage('groups', { advancement_rule: TOP_FOUR, stage_order: 1 });
  const playoffs = stage('playoffs', { bracket_type: 'single_elim', advancement_rule: TOP_FOUR, stage_order: 2 });

  it('shows the rule on a table phase a later phase follows', () => {
    expect(showsAdvancement([groups, playoffs], 'groups')).toBe(true);
  });

  it('never on the final phase or an elimination phase', () => {
    expect(showsAdvancement([groups, playoffs], 'playoffs')).toBe(false);
    const finalTable = stage('final-table', { advancement_rule: TOP_FOUR, stage_order: 2 });
    expect(showsAdvancement([groups, finalTable], 'final-table')).toBe(false);
    expect(showsAdvancement([playoffs, groups], 'playoffs')).toBe(false);
  });

  it('keeps the rule of a league whose only phase is a table (its playoffs come later)', () => {
    expect(showsAdvancement([groups], 'groups')).toBe(true);
  });

  it('nothing without a rule or for an unknown phase', () => {
    expect(showsAdvancement([stage('a'), playoffs], 'a')).toBe(false);
    expect(showsAdvancement([groups, playoffs], 'missing')).toBe(false);
  });

  it('buildTableStage drops the rule and the zone when the phase shows none', () => {
    const input = tableInput({
      stage: groups,
      participants: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, name: id, avatar_url: null })),
    });
    expect(buildTableStage(input).advancementRule).toEqual(TOP_FOUR);
    expect(buildTableStage(input).tables[0].advanceCount).toBe(4);
    const hidden = buildTableStage({ ...input, showAdvancement: false });
    expect(hidden.advancementRule).toBeNull();
    expect(hidden.tables[0].advanceCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group membership
// ---------------------------------------------------------------------------

describe('resolveGroupMembers', () => {
  // A substitution from before the handover fix: the group row still names
  // the departed player, the substitute is enrolled but holds no group row.
  const groups = [group('g-b', 2, ['p4', 'p5']), group('g-a', 1, ['p1', 'departed', 'p3'])];
  const matches = [
    match('m-1', 'sub', 'p1', 'completed'),
    match('m-2', 'p3', 'sub', 'completed'),
    match('m-3', 'departed', 'p1', 'completed'),
  ];
  const enrolled = new Set(['p1', 'p3', 'p4', 'p5', 'sub']);

  it('drops departed players and places the substitute with their opponents, groups by number', () => {
    const members = resolveGroupMembers(groups, matches, enrolled);
    expect([...members.keys()]).toEqual(['g-a', 'g-b']);
    expect(members.get('g-a')).toEqual([
      { id: 'p1', name: 'row:p1', seed: 1 },
      { id: 'p3', name: 'row:p3', seed: 3 },
      { id: 'sub', name: 'sub', seed: 0 },
    ]);
    expect(members.get('g-b')?.map((member) => member.id)).toEqual(['p4', 'p5']);
  });

  it('keeps every group row when the phase has no enrollment rows', () => {
    const members = resolveGroupMembers(groups, matches, new Set());
    expect(members.get('g-a')?.map((member) => member.id)).toEqual(['p1', 'departed', 'p3']);
  });

  it('the group tables list the same players', () => {
    const result = buildTableStage(
      tableInput({
        stage: stage('rr'),
        matches,
        groups,
        participants: [...enrolled].map((id) => ({ id, name: id, avatar_url: null })),
      }),
    );
    expect(result.tables.map((table) => table.members.map((member) => member.id).sort())).toEqual([
      ['p1', 'p3', 'sub'],
      ['p4', 'p5'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Gym bands
// ---------------------------------------------------------------------------

describe('buildTableStage — gym bands', () => {
  it('Evolution Point Buy group tables take the season gym bands (its standings compute none)', () => {
    const result = buildTableStage(
      tableInput({
        stage: stage('epb'),
        participants: ['p1', 'p2'].map((id) => ({ id, name: id, avatar_url: null })),
        groups: [group('g-a', 1, ['p1', 'p2'])],
        matches: [match('m-1', 'p1', 'p2', 'completed')],
        context: { formatType: 'evolution_point_buy', evolutionPoints: { p1: 3, p2: 1 } },
        gymTypes: { p1: 'Fire', p2: null },
      }),
    );
    expect(result.tables[0].standings.map((row) => [row.player_id, row.gym_type])).toEqual([
      ['p1', 'Fire'],
      ['p2', null],
    ]);
  });
});
