/**
 * League hub view builders: match scores, the matches tab's round grouping,
 * the open round, and the group-stage tables (round robin 3/0 with kill
 * difference, Swiss 1/½ with Buchholz, one table per group for both, tables
 * of enrolled players only (a departed player and their matches count
 * nowhere), an enrolled substitute without a group row placed with their
 * opponents' group, EPB through the format dispatch).
 *
 * Pure module: every input is a hand-built row; nothing reads.
 */
import { describe, expect, it } from 'vitest';
import {
  bracketStages,
  buildTableStage,
  gameScore,
  groupStageMatches,
  openRoundId,
  roundRobinStages,
  stageMatches,
  tableStages,
  type HubGroupTable,
  type HubRoundMatches,
  type HubStage,
  type TableStageInput,
} from '../views';
import { NO_SEASON_CONTEXT } from '@/lib/tournament/season-standings';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';
import type { Standing } from '@/lib/tournament/types';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { AdvancementRule, TournamentGroupWithMembers } from '@/types/season';
import type { GameSummary, MatchStatus, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = '2026-03-01T00:00:00.000Z';

const NAMES: Record<string, string> = {
  ash: 'Ash',
  misty: 'Misty',
  brock: 'Brock',
  dawn: 'Dawn',
  gary: 'Gary',
  iris: 'Iris',
  sub: 'Late Sub',
  tracey: 'Tracey',
  departed: 'Departed',
};

function game(winnerId: string | null, gameNumber: number, matchId: string): GameSummary {
  return {
    id: `${matchId}-g${gameNumber}`,
    game_number: gameNumber,
    winner_id: winnerId,
    replay_url: '',
    source: 'manual',
    stats_locked: false,
  };
}

/** A match row with the minimum real shape; everything else defaults to an unplayed fixture. */
function match(
  id: string,
  player1: string,
  player2: string,
  overrides: Partial<Omit<MatchWithPlayers, 'games'>> & { games?: (string | null)[] } = {},
): MatchWithPlayers {
  const { games = [], ...rest } = overrides;
  const winner = rest.winner_id ?? null;
  return {
    id,
    round_id: 'round-1',
    tournament_id: 'stage-1',
    player_1_id: player1,
    player_2_id: player2,
    winner_id: null,
    status: 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: T0,
    updated_at: T0,
    player_1_name: NAMES[player1] ?? player1,
    player_2_name: NAMES[player2] ?? player2,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: winner ? (NAMES[winner] ?? winner) : null,
    round_status: 'active',
    ...rest,
    games: games.map((winnerId, index) => game(winnerId, index + 1, id)),
  };
}

/** A completed match; `games` defaults to a 2-0 for the winner (none for a draw). */
function played(
  id: string,
  player1: string,
  player2: string,
  winner: string | null,
  games?: (string | null)[],
  overrides: Partial<Omit<MatchWithPlayers, 'games'>> = {},
): MatchWithPlayers {
  return match(id, player1, player2, {
    status: 'completed',
    winner_id: winner,
    date_played: T0,
    games: games ?? (winner ? [winner, winner] : []),
    ...overrides,
  });
}

function stage(id: string, overrides: Partial<HubStage> = {}): HubStage {
  return {
    id,
    name: `Phase ${id}`,
    bracket_type: 'round_robin',
    status: 'active',
    best_of_default: 3,
    participant_count: 0,
    advancement_rule: null,
    current_round: 1,
    stage_order: 1,
    ...overrides,
  };
}

function round(id: string, roundNumber: number, overrides: Partial<Round> = {}): Round {
  return {
    id,
    tournament_id: 'stage-1',
    name: `Round ${roundNumber}`,
    round_number: roundNumber,
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

function fixture(stageId: string, m: MatchWithPlayers): LeagueFixture {
  return { stageId, stageName: `Phase ${stageId}`, match: { ...m, tournament_id: stageId } };
}

function group(id: string, groupNumber: number, memberIds: string[]): TournamentGroupWithMembers {
  return {
    id,
    tournament_id: 'stage-rr',
    name: `Group ${String.fromCharCode(64 + groupNumber)}`,
    group_number: groupNumber,
    created_at: T0,
    updated_at: T0,
    members: memberIds.map((player_id, index) => ({
      player_id,
      player_name: `group:${player_id}`,
      seed: index + 1,
      gym_type: null,
    })),
  };
}

function participant(id: string): { id: string; name: string; avatar_url: string | null } {
  return { id, name: NAMES[id] ?? id, avatar_url: `https://img.example/${id}.png` };
}

let statSeq = 0;
/** A battle-stats row; `gameId` ties it to a match's game (`<matchId>-g<n>`), else a game no match holds. */
function stat(playerId: string, kosDealt: number, wasKoed: boolean, gameId?: string): TournamentBattleStat {
  statSeq += 1;
  return {
    game_id: gameId ?? `game-${statSeq}`,
    player_id: playerId,
    pokemon_name: `mon-${statSeq}`,
    was_brought: true,
    was_lead: false,
    kos_dealt: kosDealt,
    was_koed: wasKoed,
    round_number: 1,
  };
}

const TOP_TWO_PER_GROUP: AdvancementRule = { type: 'top_n', count: 2, per_group: true };
const TOP_THREE_OVERALL: AdvancementRule = { type: 'top_n', count: 3, per_group: false };

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

function row(table: HubGroupTable, playerId: string): Standing {
  const found = table.standings.find((standing) => standing.player_id === playerId);
  if (!found) throw new Error(`no standings row for ${playerId} in table ${table.key}`);
  return found;
}

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);

// ---------------------------------------------------------------------------
// gameScore
// ---------------------------------------------------------------------------

describe('gameScore', () => {
  it('is null for a match without games', () => {
    expect(gameScore(match('m', 'ash', 'misty'))).toBeNull();
  });

  it('is null while no game has a winner', () => {
    expect(gameScore(match('m', 'ash', 'misty', { games: [null, null] }))).toBeNull();
  });

  it('counts the games each player won', () => {
    expect(gameScore(match('m', 'ash', 'misty', { games: ['ash', 'misty', 'ash'] }))).toEqual({
      player1: 2,
      player2: 1,
    });
    expect(gameScore(match('m', 'ash', 'misty', { games: ['misty', 'misty'] }))).toEqual({
      player1: 0,
      player2: 2,
    });
  });

  it('counts a partial score once one game is decided', () => {
    expect(gameScore(match('m', 'ash', 'misty', { games: ['misty', null] }))).toEqual({
      player1: 0,
      player2: 1,
    });
  });

  it('ignores games with a null or foreign winner', () => {
    expect(
      gameScore(match('m', 'ash', 'misty', { games: ['ash', null, 'brock', 'misty', 'ash'] })),
    ).toEqual({ player1: 2, player2: 1 });
  });

  it('is null when only foreign winners are recorded', () => {
    expect(gameScore(match('m', 'ash', 'misty', { games: ['brock', 'dawn'] }))).toBeNull();
  });

  it('reads game winners, not the match winner', () => {
    expect(
      gameScore(match('m', 'ash', 'misty', { winner_id: 'ash', status: 'completed', games: [] })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// groupStageMatches
// ---------------------------------------------------------------------------

describe('groupStageMatches', () => {
  const elim = stage('stage-elim', { bracket_type: 'double_elim', stage_order: 2, name: 'Playoffs' });
  const league = stage('stage-rr', { bracket_type: 'round_robin', stage_order: 1, name: 'Regular season' });
  const empty = stage('stage-empty', { bracket_type: 'swiss', stage_order: 3, name: 'Swiss cup' });

  const wb1 = round('wb1', 1, { name: 'WB Round 1', status: 'completed', bracket_side: 'winners' });
  const lb1 = round('lb1', 1, { name: 'LB Round 1', status: 'active', bracket_side: 'losers' });
  const wb2 = round('wb2', 2, { name: 'WB Final', status: 'pending', bracket_side: 'winners' });
  const lb2 = round('lb2', 2, { name: 'LB Final', status: 'pending', bracket_side: 'losers' });
  const gf = round('gf', 2, { name: 'Grand Final', status: 'pending', bracket_side: 'grand_finals' });

  const elimFixtures = [
    fixture(elim.id, match('m-gf', 'ash', 'gary', { round_id: 'gf' })),
    fixture(elim.id, match('m-lb2', 'misty', 'brock', { round_id: 'lb2' })),
    fixture(elim.id, match('m-wb2', 'ash', 'gary', { round_id: 'wb2' })),
    fixture(elim.id, played('m-lb1', 'dawn', 'iris', 'dawn', undefined, { round_id: 'lb1' })),
    fixture(elim.id, played('m-wb1-b', 'ash', 'misty', 'ash', undefined, { round_id: 'wb1', bracket_pos: 2 })),
    fixture(elim.id, played('m-wb1-a', 'gary', 'brock', 'gary', undefined, { round_id: 'wb1', bracket_pos: 1 })),
    // No round row for these: they trail the known rounds, in kickoff order.
    fixture(elim.id, match('m-ghost-1', 'ash', 'iris', { round_id: 'ghost-1', scheduled_at: '2026-03-10T18:00:00Z' })),
    fixture(elim.id, match('m-ghost-2', 'dawn', 'iris', { round_id: 'ghost-2', date_played: '2026-03-02T18:00:00Z' })),
    fixture(elim.id, match('m-ghost-3', 'gary', 'iris', { round_id: 'ghost-3', created_at: '2026-03-05T18:00:00Z' })),
  ];
  const leagueFixtures = [
    fixture(league.id, played('m-rr-1', 'ash', 'misty', 'ash', undefined, { round_id: 'rr1' })),
    fixture(league.id, match('m-rr-2', 'brock', 'dawn', { round_id: 'rr2' })),
  ];
  const rounds: Record<string, Round[]> = {
    [elim.id]: [gf, wb2, lb2, lb1, wb1],
    [league.id]: [round('rr2', 2, { status: 'active' }), round('rr1', 1, { status: 'completed' })],
    [empty.id]: [round('sw1', 1)],
  };
  // Interleave the phases' fixtures, as the season fixture read returns them.
  const allFixtures = [...elimFixtures.slice(0, 3), ...leagueFixtures, ...elimFixtures.slice(3)];

  const result = groupStageMatches([league, elim, empty], allFixtures, rounds);

  it('keeps the phases in the order they are given', () => {
    expect(result.map((entry) => entry.stage.id)).toEqual(['stage-rr', 'stage-elim', 'stage-empty']);
    expect(result[0].stage).toBe(league);
    expect(result[1].stage).toBe(elim);
  });

  it('keeps a phase without matches, with no rounds', () => {
    expect(result[2].stage).toBe(empty);
    expect(result[2].rounds).toEqual([]);
  });

  it('keeps each phase to its own fixtures', () => {
    expect(result[0].rounds.flatMap((r) => ids(r.matches))).toEqual(['m-rr-1', 'm-rr-2']);
    const elimIds = result[1].rounds.flatMap((r) => ids(r.matches));
    expect(elimIds).toHaveLength(elimFixtures.length);
    expect(elimIds).not.toContain('m-rr-1');
  });

  it('orders known rounds by round number, then bracket side (winners, losers, grand final)', () => {
    expect(result[1].rounds.slice(0, 5).map((r) => r.roundId)).toEqual(['wb1', 'lb1', 'wb2', 'lb2', 'gf']);
    expect(result[0].rounds.map((r) => r.roundId)).toEqual(['rr1', 'rr2']);
  });

  it('puts rounds without a round row last, in kickoff order', () => {
    // ghost-2 played 03-02, ghost-3 created 03-05, ghost-1 scheduled 03-10.
    expect(result[1].rounds.slice(5).map((r) => r.roundId)).toEqual(['ghost-2', 'ghost-3', 'ghost-1']);
  });

  it('carries the round name, status and bracket side, and a 1-based position', () => {
    const elimRounds = result[1].rounds;
    expect(elimRounds.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(elimRounds[0]).toMatchObject({
      roundId: 'wb1',
      name: 'WB Round 1',
      position: 1,
      status: 'completed',
      bracketSide: 'winners',
    });
    expect(elimRounds[1]).toMatchObject({ name: 'LB Round 1', status: 'active', bracketSide: 'losers' });
    expect(elimRounds[4]).toMatchObject({ name: 'Grand Final', status: 'pending', bracketSide: 'grand_finals' });
  });

  it('leaves name, status and bracket side null on a round without a row', () => {
    for (const unknown of result[1].rounds.slice(5)) {
      expect(unknown.name).toBeNull();
      expect(unknown.status).toBeNull();
      expect(unknown.bracketSide).toBeNull();
    }
    expect(result[1].rounds[5].position).toBe(6);
  });

  it('sorts a round’s matches by bracket position', () => {
    expect(ids(result[1].rounds[0].matches)).toEqual(['m-wb1-a', 'm-wb1-b']);
  });

  it('sorts matches by bracket position, then kickoff, then id', () => {
    const r = 'r1';
    const matches = [
      match('m-v2', 'a', 'b', { round_id: r, scheduled_at: '2026-03-03T12:00:00Z' }),
      match('m-x', 'a', 'b', { round_id: r, scheduled_at: '2026-03-02T12:00:00Z' }),
      match('m-z', 'a', 'b', { round_id: r, bracket_pos: 2, scheduled_at: '2026-01-01T00:00:00Z' }),
      match('m-v1', 'a', 'b', { round_id: r, scheduled_at: '2026-03-03T12:00:00Z' }),
      match('m-w', 'a', 'b', { round_id: r, date_played: '2026-03-01T12:00:00Z' }),
      match('m-y', 'a', 'b', { round_id: r, bracket_pos: 1, scheduled_at: '2026-09-01T00:00:00Z' }),
      match('m-u', 'a', 'b', { round_id: r, bracket_pos: 0 }),
    ];
    const [single] = groupStageMatches(
      [stage('s')],
      matches.map((m) => fixture('s', m)),
      { s: [round(r, 1)] },
    );
    expect(single.rounds).toHaveLength(1);
    // Positioned first (0, 1, 2), then unpositioned by kickoff (scheduled, else
    // played, else created), then id.
    expect(ids(single.rounds[0].matches)).toEqual(['m-u', 'm-y', 'm-z', 'm-w', 'm-x', 'm-v1', 'm-v2']);
  });

  it('kickoff prefers scheduled_at over date_played over created_at', () => {
    const matches = [
      // scheduled 03-05 though played 03-01: sorts by the schedule.
      match('m-a', 'a', 'b', { scheduled_at: '2026-03-05T00:00:00Z', date_played: '2026-03-01T00:00:00Z' }),
      // played 03-03 though created 03-09.
      match('m-b', 'a', 'b', { date_played: '2026-03-03T00:00:00Z', created_at: '2026-03-09T00:00:00Z' }),
      match('m-c', 'a', 'b', { created_at: '2026-03-04T00:00:00Z' }),
    ];
    const [single] = groupStageMatches([stage('s')], matches.map((m) => fixture('s', m)), {
      s: [round('round-1', 1)],
    });
    expect(ids(single.rounds[0].matches)).toEqual(['m-b', 'm-c', 'm-a']);
  });

  it('treats a round without a bracket side as the winners side', () => {
    const matches = [
      match('m-l', 'a', 'b', { round_id: 'side-l' }),
      match('m-n', 'a', 'b', { round_id: 'side-null' }),
    ];
    const [single] = groupStageMatches([stage('s')], matches.map((m) => fixture('s', m)), {
      s: [round('side-l', 1, { bracket_side: 'losers' }), round('side-null', 1, { bracket_side: null })],
    });
    expect(single.rounds.map((r) => r.roundId)).toEqual(['side-null', 'side-l']);
  });

  it('reads every round as unknown when the phase has no round rows', () => {
    const matches = [
      match('m-late', 'a', 'b', { round_id: 'x', scheduled_at: '2026-05-01T00:00:00Z' }),
      match('m-early', 'a', 'b', { round_id: 'y', scheduled_at: '2026-04-01T00:00:00Z' }),
    ];
    const [single] = groupStageMatches([stage('s')], matches.map((m) => fixture('s', m)), {});
    expect(single.rounds.map((r) => [r.roundId, r.name, r.status, r.position])).toEqual([
      ['y', null, null, 1],
      ['x', null, null, 2],
    ]);
  });

  it('orders unknown rounds by their earliest kickoff, not by their first bracket slot', () => {
    const matches = [
      match('x-pos1', 'a', 'b', { round_id: 'x', bracket_pos: 1, scheduled_at: '2026-05-01T10:00:00Z' }),
      match('x-pos2', 'c', 'd', { round_id: 'x', bracket_pos: 2, scheduled_at: '2026-05-01T08:00:00Z' }),
      match('y-only', 'a', 'c', { round_id: 'y', scheduled_at: '2026-05-01T09:00:00Z' }),
    ];
    const [single] = groupStageMatches([stage('s')], matches.map((m) => fixture('s', m)), {});
    expect(single.rounds.map((r) => r.roundId)).toEqual(['x', 'y']);
  });

  it('handles no phases and no fixtures', () => {
    expect(groupStageMatches([], allFixtures, rounds)).toEqual([]);
    expect(groupStageMatches([league], [], rounds)).toEqual([{ stage: league, rounds: [] }]);
  });

  it('does not reorder the fixtures or round rows it is given', () => {
    const fixtureIds = allFixtures.map((f) => f.match.id);
    const roundIds = rounds[elim.id].map((r) => r.id);
    groupStageMatches([league, elim, empty], allFixtures, rounds);
    expect(allFixtures.map((f) => f.match.id)).toEqual(fixtureIds);
    expect(rounds[elim.id].map((r) => r.id)).toEqual(roundIds);
  });
});

// ---------------------------------------------------------------------------
// openRoundId
// ---------------------------------------------------------------------------

function hubRound(
  roundId: string,
  status: HubRoundMatches['status'],
  matchStatuses: MatchStatus[],
): HubRoundMatches {
  return {
    roundId,
    name: null,
    position: 1,
    status,
    bracketSide: null,
    matches: matchStatuses.map((matchStatus, index) =>
      match(`${roundId}-m${index}`, 'ash', 'misty', { status: matchStatus, round_id: roundId }),
    ),
  };
}

describe('openRoundId', () => {
  it('opens the active round, even after an unfinished earlier round', () => {
    expect(
      openRoundId([
        hubRound('r1', 'completed', ['scheduled']),
        hubRound('r2', 'active', ['completed', 'in_progress']),
        hubRound('r3', 'pending', ['scheduled']),
      ]),
    ).toBe('r2');
  });

  it('opens the active round even when all its matches are done', () => {
    expect(
      openRoundId([hubRound('r1', 'completed', ['completed']), hubRound('r2', 'active', ['completed'])]),
    ).toBe('r2');
  });

  it('without an active round, opens the first round with an unfinished match', () => {
    expect(
      openRoundId([
        hubRound('r1', 'completed', ['completed', 'completed']),
        hubRound('r2', 'completed', ['completed', 'pending_confirmation']),
        hubRound('r3', 'pending', ['scheduled']),
      ]),
    ).toBe('r2');
  });

  it('counts every non-completed match status as unfinished', () => {
    for (const status of ['scheduled', 'in_progress', 'pending_confirmation', 'disputed'] as const) {
      expect(
        openRoundId([hubRound('done', 'completed', ['completed']), hubRound('open', null, ['completed', status])]),
      ).toBe('open');
    }
  });

  it('opens a round without a row (null status) when it is the first unfinished one', () => {
    expect(openRoundId([hubRound('r1', null, ['completed']), hubRound('r2', null, ['scheduled'])])).toBe('r2');
  });

  it('opens the last round of a finished phase', () => {
    expect(
      openRoundId([
        hubRound('r1', 'completed', ['completed']),
        hubRound('r2', 'completed', ['completed']),
        hubRound('r3', 'completed', ['completed', 'completed']),
      ]),
    ).toBe('r3');
    expect(openRoundId([hubRound('only', 'completed', ['completed'])])).toBe('only');
  });

  it('is null without rounds', () => {
    expect(openRoundId([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildTableStage
// ---------------------------------------------------------------------------

describe('buildTableStage — grouped round robin', () => {
  const rr = stage('stage-rr', { bracket_type: 'round_robin', advancement_rule: TOP_TWO_PER_GROUP });
  // Given out of order: tables follow group_number.
  const groups = [group('g-b', 2, ['brock', 'dawn']), group('g-a', 1, ['ash', 'misty'])];
  const participants = ['ash', 'misty', 'brock', 'dawn'].map(participant);
  const matches = [
    played('m-1', 'ash', 'misty', 'ash', ['ash', 'misty', 'ash']),
    match('m-2', 'misty', 'ash'), // intra-group, still to play
    played('m-3', 'brock', 'dawn', null, ['brock', 'dawn']), // a draw
    played('m-x', 'ash', 'brock', 'ash', ['ash', 'ash']), // cross-group: never counted
    match('m-pend', 'dawn', 'brock', { status: 'pending_confirmation', winner_id: 'dawn', games: ['dawn', 'dawn'] }),
  ];
  const battleStats = [
    stat('ash', 2, false, 'm-1-g1'),
    stat('ash', 1, true, 'm-1-g3'),
    stat('misty', 1, true, 'm-1-g2'),
    stat('misty', 0, true, 'm-1-g3'),
    stat('brock', 1, false, 'm-3-g1'),
    // Games of matches no table counts: the cross-group win and the match
    // still awaiting confirmation. W/L skips them, so kill difference must too.
    stat('ash', 5, false, 'm-x-g1'),
    stat('brock', 0, true, 'm-x-g2'),
    stat('dawn', 4, false, 'm-pend-g1'),
    // A game no match on the page holds (another phase's stats, say).
    stat('misty', 6, false),
  ];
  const result = buildTableStage(
    tableInput({
      stage: rr,
      matches,
      participants,
      groups,
      battleStats,
      gymTypes: { ash: 'Fire', misty: 'Water', brock: 'Rock' },
    }),
  );
  const [tableA, tableB] = result.tables;

  it('scores as round robin and keeps the stage', () => {
    expect(result.scoring).toBe('round_robin');
    expect(result.stage).toBe(rr);
  });

  it('builds one table per group, by group number', () => {
    expect(result.tables.map((table) => [table.key, table.name])).toEqual([
      ['g-a', 'Group A'],
      ['g-b', 'Group B'],
    ]);
  });

  it('counts only matches between two members of the group', () => {
    expect(ids(tableA.matches)).toEqual(['m-1', 'm-2']);
    expect(ids(tableB.matches)).toEqual(['m-3', 'm-pend']);
    // The cross-group win does not reach Ash's or Brock's rows.
    expect(row(tableA, 'ash')).toMatchObject({ wins: 1, losses: 0, draws: 0 });
    expect(row(tableB, 'brock')).toMatchObject({ wins: 0, losses: 0, draws: 1 });
  });

  it('awards 3 points per win and 0 per draw', () => {
    expect(row(tableA, 'ash').points).toBe(3);
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 1, points: 0 });
    expect(row(tableB, 'brock').points).toBe(0);
    expect(row(tableB, 'dawn')).toMatchObject({ draws: 1, points: 0 });
  });

  it('counts only completed matches (a match awaiting confirmation is not a result)', () => {
    expect(row(tableB, 'dawn').wins).toBe(0);
    expect(row(tableB, 'dawn').draws).toBe(1);
  });

  it('takes kill difference from the battle stats of the games the table counts', () => {
    expect(row(tableA, 'ash').kill_differential).toBe(2); // 2 + 1 - 1
    expect(row(tableA, 'misty').kill_differential).toBe(-1); // 1 - 1 + 0 - 1
    expect(row(tableB, 'brock').kill_differential).toBe(1);
    expect(row(tableB, 'dawn').kill_differential).toBe(0);
  });

  it('takes games played from the completed matches’ games', () => {
    expect(row(tableA, 'ash').games_played).toBe(3);
    expect(row(tableA, 'misty').games_played).toBe(3);
    expect(row(tableB, 'brock').games_played).toBe(2);
    expect(row(tableB, 'dawn').games_played).toBe(2);
  });

  it('ranks each table and lists its members in standings order', () => {
    expect(tableA.standings.map((s) => s.player_id)).toEqual(['ash', 'misty']);
    // Level on points: Brock's kill difference puts him first.
    expect(tableB.standings.map((s) => s.player_id)).toEqual(['brock', 'dawn']);
    expect(tableA.members).toEqual([
      { id: 'ash', name: 'Ash' },
      { id: 'misty', name: 'Misty' },
    ]);
  });

  it('names, avatars and gym types come from the enrollment and season rows', () => {
    expect(row(tableA, 'ash')).toMatchObject({
      player_name: 'Ash',
      player_avatar_url: 'https://img.example/ash.png',
      gym_type: 'Fire',
    });
    expect(row(tableB, 'dawn').gym_type).toBeNull();
  });

  it('drops a group member who is not enrolled, and the matches against them', () => {
    // Gary still holds a group row but no enrollment row (departed).
    const solo = buildTableStage(
      tableInput({
        stage: rr,
        groups: [group('g', 1, ['ash', 'gary', 'misty'])],
        participants: [participant('ash'), participant('misty')],
        matches: [played('m-g', 'gary', 'ash', 'gary'), played('m-am', 'ash', 'misty', 'ash')],
      }),
    );
    expect(solo.tables[0].members).toEqual([
      { id: 'ash', name: 'Ash' },
      { id: 'misty', name: 'Misty' },
    ]);
    expect(ids(solo.tables[0].matches)).toEqual(['m-am']);
    expect(row(solo.tables[0], 'ash')).toMatchObject({ wins: 1, losses: 0, points: 3 });
  });

  it('keeps every group member, under the group member name, when the phase has no enrollment rows', () => {
    const legacy = buildTableStage(tableInput({ stage: rr, groups: [group('g', 1, ['ash', 'gary'])] }));
    expect(legacy.tables[0].members).toHaveLength(2);
    expect(legacy.tables[0].members).toEqual(
      expect.arrayContaining([
        { id: 'ash', name: 'group:ash' },
        { id: 'gary', name: 'group:gary' },
      ]),
    );
    expect(row(legacy.tables[0], 'gary').player_avatar_url).toBeNull();
  });

  it('marks the per-group advancement count on every table', () => {
    expect(result.tables.map((table) => table.advanceCount)).toEqual([2, 2]);
  });

  it('shows no advancement zone for an overall cut across several groups', () => {
    const overall = buildTableStage(
      tableInput({ stage: { ...rr, advancement_rule: TOP_THREE_OVERALL }, matches, participants, groups }),
    );
    expect(overall.tables.map((table) => table.advanceCount)).toEqual([null, null]);
  });

  it('shows the overall count when there is a single group', () => {
    const one = buildTableStage(
      tableInput({
        stage: { ...rr, advancement_rule: TOP_THREE_OVERALL },
        participants,
        groups: [group('g-only', 1, ['ash', 'misty', 'brock', 'dawn'])],
      }),
    );
    expect(one.tables.map((table) => table.advanceCount)).toEqual([3]);
  });

  it('shows no advancement zone without a rule', () => {
    const none = buildTableStage(
      tableInput({ stage: { ...rr, advancement_rule: null }, matches, participants, groups }),
    );
    expect(none.tables.map((table) => table.advanceCount)).toEqual([null, null]);
  });

  it('does not mutate the groups or battle stats it is given', () => {
    expect(groups.map((g) => g.id)).toEqual(['g-b', 'g-a']);
    expect(battleStats).toHaveLength(9);
  });
});

describe('buildTableStage — groups that mirror league groups', () => {
  // Same matches as the phase-only case above, but the groups mirror league groups: the cross-group win and its
  // kill difference count in both group tables (one table over the phase, split per group).
  const rr = stage('stage-rr', { bracket_type: 'round_robin', advancement_rule: TOP_TWO_PER_GROUP });
  const mirror = (g: TournamentGroupWithMembers, seasonGroupId: string) => ({ ...g, season_group_id: seasonGroupId });
  const groups = [mirror(group('g-b', 2, ['brock', 'dawn']), 'sg-b'), mirror(group('g-a', 1, ['ash', 'misty']), 'sg-a')];
  const participants = ['ash', 'misty', 'brock', 'dawn'].map(participant);
  const matches = [
    played('m-1', 'ash', 'misty', 'ash', ['ash', 'misty', 'ash']),
    played('m-3', 'brock', 'dawn', null, ['brock', 'dawn']),
    played('m-x', 'ash', 'brock', 'ash', ['ash', 'ash']), // cross-group: counts now
  ];
  const battleStats = [stat('ash', 5, false, 'm-x-g1'), stat('brock', 0, true, 'm-x-g2')];
  const result = buildTableStage(tableInput({ stage: rr, matches, participants, groups, battleStats }));

  it('keeps one table per group, in group order', () => {
    expect(result.tables.map((t) => [t.key, t.name])).toEqual([
      ['g-a', 'Group A'],
      ['g-b', 'Group B'],
    ]);
  });

  it('counts the cross-group match and its games in both tables', () => {
    const [a, b] = result.tables;
    expect(row(a, 'ash').wins).toBe(2);
    expect(row(a, 'ash').kill_differential).toBe(5);
    expect(row(b, 'brock').losses).toBe(1);
    expect(row(b, 'brock').kill_differential).toBe(-1);
    expect(ids(b.members)).toEqual(['dawn', 'brock']);
  });

  it('the results grid keeps the in-group matches only', () => {
    expect(result.tables[0].matches.map((m) => m.id)).toEqual(['m-1']);
    expect(result.tables[1].matches.map((m) => m.id)).toEqual(['m-3']);
  });

  it('shows the per-group advancement zone', () => {
    expect(result.tables.map((t) => t.advanceCount)).toEqual([2, 2]);
  });
});

describe('buildTableStage — ungrouped round robin', () => {
  const rr = stage('stage-rr', { bracket_type: 'round_robin', advancement_rule: TOP_THREE_OVERALL });
  const participants = ['ash', 'misty', 'brock'].map(participant);
  const matches = [
    played('m-1', 'ash', 'misty', 'ash'),
    played('m-2', 'brock', 'ash', 'brock', ['brock', 'ash', 'brock']),
    // A departed player (substituted out, enrollment row gone) who played here.
    played('m-3', 'departed', 'misty', 'departed'),
    match('m-4', 'misty', 'brock'),
  ];
  const result = buildTableStage(tableInput({ stage: rr, matches, participants }));

  it('builds a single unnamed table keyed by the stage', () => {
    expect(result.scoring).toBe('round_robin');
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].key).toBe('stage-rr');
    expect(result.tables[0].name).toBeNull();
  });

  it('holds the enrollment only: a departed player who played here, and their matches, count nowhere', () => {
    const table = result.tables[0];
    expect(table.standings.map((s) => s.player_id).sort()).toEqual(['ash', 'brock', 'misty']);
    expect(ids(table.members)).not.toContain('departed');
    // Misty's loss to the departed player is not a result.
    expect(row(table, 'misty')).toMatchObject({ wins: 0, losses: 1, points: 0 });
  });

  it('lists an enrolled substitute who played here, with their results', () => {
    const withSub = buildTableStage(
      tableInput({
        stage: rr,
        participants: [...participants, participant('sub')],
        matches: [...matches, played('m-5', 'sub', 'misty', 'sub'), played('m-6', 'ash', 'sub', 'ash')],
      }),
    );
    const table = withSub.tables[0];
    expect(table.standings.map((s) => s.player_id).sort()).toEqual(['ash', 'brock', 'misty', 'sub']);
    expect(row(table, 'sub')).toMatchObject({
      player_name: 'Late Sub',
      player_avatar_url: 'https://img.example/sub.png',
      wins: 1,
      losses: 1,
      points: 3,
    });
    expect(row(table, 'misty')).toMatchObject({ wins: 0, losses: 2, points: 0 });
    expect(ids(table.matches)).toEqual(['m-1', 'm-2', 'm-4', 'm-5', 'm-6']);
  });

  it('with no enrollment rows, adds a player named by matches only once, whichever side they played on', () => {
    const twice = buildTableStage(
      tableInput({
        stage: rr,
        matches: [played('m-a', 'sub', 'ash', 'sub'), played('m-b', 'misty', 'sub', 'misty')],
      }),
    );
    expect(ids(twice.tables[0].members).sort()).toEqual(['ash', 'misty', 'sub']);
    const subRows = twice.tables[0].standings.filter((s) => s.player_id === 'sub');
    expect(subRows).toHaveLength(1);
    expect(subRows[0]).toMatchObject({ player_name: 'Late Sub', wins: 1, losses: 1, points: 3 });
  });

  it('keeps every phase match between two enrolled players in the table', () => {
    expect(ids(result.tables[0].matches)).toEqual(['m-1', 'm-2', 'm-4']);
  });

  it('scores 3 points a win with games played from the games', () => {
    const table = result.tables[0];
    expect(row(table, 'ash')).toMatchObject({ wins: 1, losses: 1, points: 3, games_played: 5 });
    expect(row(table, 'brock')).toMatchObject({ wins: 1, losses: 0, points: 3, games_played: 3 });
  });

  it('marks the overall advancement count', () => {
    expect(result.tables[0].advanceCount).toBe(3);
  });

  it('marks a per-group rule’s count on the single table', () => {
    const perGroup = buildTableStage(
      tableInput({ stage: { ...rr, advancement_rule: TOP_TWO_PER_GROUP }, matches, participants }),
    );
    expect(perGroup.tables[0].advanceCount).toBe(2);
  });

  it('shows no advancement zone without a rule', () => {
    const none = buildTableStage(tableInput({ stage: { ...rr, advancement_rule: null }, matches, participants }));
    expect(none.tables[0].advanceCount).toBeNull();
  });

  it('lists enrolled players without a match', () => {
    const quiet = buildTableStage(tableInput({ stage: rr, participants }));
    expect(quiet.tables).toHaveLength(1);
    expect(quiet.tables[0].standings.map((s) => s.player_id).sort()).toEqual(['ash', 'brock', 'misty']);
    expect(quiet.tables[0].standings.every((s) => s.points === 0 && s.wins === 0)).toBe(true);
  });

  it('falls back to the players the matches name only when the phase has no enrollment rows', () => {
    const fromMatches = buildTableStage(tableInput({ stage: rr, matches: [played('m', 'ash', 'misty', 'misty')] }));
    expect(fromMatches.tables).toHaveLength(1);
    expect(fromMatches.tables[0].members).toEqual([
      { id: 'misty', name: 'Misty' },
      { id: 'ash', name: 'Ash' },
    ]);
  });

  it('has no tables with no participants and no matches', () => {
    expect(buildTableStage(tableInput({ stage: rr })).tables).toEqual([]);
    expect(
      buildTableStage(tableInput({ stage: stage('sw', { bracket_type: 'swiss' }) })).tables,
    ).toEqual([]);
  });
});

describe('buildTableStage — ungrouped Swiss', () => {
  const swiss = stage('stage-swiss', { bracket_type: 'swiss', advancement_rule: TOP_TWO_PER_GROUP });
  const participants = ['ash', 'misty', 'brock', 'dawn'].map(participant);
  const matches = [
    played('s-1', 'ash', 'misty', 'ash', ['ash', 'ash'], { round_id: 'sw1' }),
    played('s-2', 'brock', 'dawn', null, ['brock', 'dawn'], { round_id: 'sw1' }),
    played('s-3', 'ash', 'brock', 'ash', ['ash', 'brock', 'ash'], { round_id: 'sw2' }),
    played('s-4', 'misty', 'dawn', 'misty', ['misty', 'misty'], { round_id: 'sw2' }),
  ];
  // Battle stats handed in anyway: Swiss scores no kill difference.
  const result = buildTableStage(
    tableInput({
      stage: swiss,
      matches,
      participants,
      battleStats: [stat('ash', 5, false), stat('dawn', 3, false)],
      roundNumbers: { sw1: 1, sw2: 2 },
    }),
  );
  const table = result.tables[0];

  it('scores as Swiss in a single unnamed table keyed by the stage', () => {
    expect(result.scoring).toBe('swiss');
    expect(result.tables).toHaveLength(1);
    expect(table.key).toBe('stage-swiss');
    expect(table.name).toBeNull();
    expect(ids(table.matches)).toEqual(['s-1', 's-2', 's-3', 's-4']);
  });

  it('awards 1 point per win and ½ per draw', () => {
    expect(row(table, 'ash').points).toBe(2);
    expect(row(table, 'misty').points).toBe(1);
    expect(row(table, 'brock').points).toBe(0.5);
    expect(row(table, 'dawn').points).toBe(0.5);
  });

  it('fills Buchholz with the opponents’ points', () => {
    expect(row(table, 'ash').buchholz).toBe(1.5); // misty 1 + brock 0.5
    expect(row(table, 'misty').buchholz).toBe(2.5); // ash 2 + dawn 0.5
    expect(row(table, 'brock').buchholz).toBe(2.5); // dawn 0.5 + ash 2
    expect(row(table, 'dawn').buchholz).toBe(1.5); // brock 0.5 + misty 1
  });

  it('uses no kill difference and no games played', () => {
    for (const standing of table.standings) {
      expect(standing.kill_differential).toBe(0);
      expect(standing.games_played).toBe(0);
    }
  });

  it('breaks the points tie on Buchholz', () => {
    expect(table.standings.map((s) => s.player_id)).toEqual(['ash', 'misty', 'brock', 'dawn']);
  });

  it('still marks the advancement count of a single table', () => {
    expect(table.advanceCount).toBe(2);
  });
});

describe('buildTableStage — grouped Swiss', () => {
  const swiss = stage('stage-swiss', { bracket_type: 'swiss', advancement_rule: TOP_TWO_PER_GROUP });
  // Given out of order: tables follow group_number.
  const groups = [group('g-b', 2, ['dawn', 'gary', 'iris']), group('g-a', 1, ['ash', 'misty', 'brock'])];
  const participants = ['ash', 'misty', 'brock', 'dawn', 'gary', 'iris'].map(participant);
  const matches = [
    played('s-a1', 'ash', 'brock', 'ash', undefined, { round_id: 'sw1' }),
    played('s-b1', 'dawn', 'gary', 'dawn', undefined, { round_id: 'sw1' }),
    played('s-a2', 'misty', 'brock', null, ['misty', 'brock'], { round_id: 'sw2' }), // a draw
    // Cross-group: never counted (it would lift Misty to 1½ points and Gary's Buchholz).
    played('s-x', 'misty', 'gary', 'misty', undefined, { round_id: 'sw2' }),
    match('s-b2', 'iris', 'dawn', { round_id: 'sw3' }), // still to play
  ];
  const input = tableInput({
    stage: swiss,
    matches,
    participants,
    groups,
    // Handed in anyway: Swiss scores no kill difference.
    battleStats: [stat('ash', 4, false), stat('gary', 3, false)],
    roundNumbers: { sw1: 1, sw2: 2, sw3: 3 },
  });
  const result = buildTableStage(input);
  const [tableA, tableB] = result.tables;

  it('scores as Swiss with one table per group, by group number', () => {
    expect(result.scoring).toBe('swiss');
    expect(result.stage).toBe(swiss);
    expect(result.tables.map((table) => [table.key, table.name])).toEqual([
      ['g-a', 'Group A'],
      ['g-b', 'Group B'],
    ]);
  });

  it('counts only matches between two members of the group', () => {
    expect(ids(tableA.matches)).toEqual(['s-a1', 's-a2']);
    expect(ids(tableB.matches)).toEqual(['s-b1', 's-b2']);
    // The cross-group win reaches neither Misty's nor Gary's row.
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 0, draws: 1 });
    expect(row(tableB, 'gary')).toMatchObject({ wins: 0, losses: 1, draws: 0 });
  });

  it('awards 1 point per win and ½ per draw, never 3 / 0', () => {
    expect(row(tableA, 'ash').points).toBe(1);
    expect(row(tableA, 'brock').points).toBe(0.5);
    expect(row(tableA, 'misty').points).toBe(0.5);
    expect(row(tableB, 'dawn').points).toBe(1);
    expect(row(tableB, 'gary').points).toBe(0);
    expect(row(tableB, 'iris').points).toBe(0);
  });

  it('computes Buchholz from the opponents within the group', () => {
    expect(row(tableA, 'ash').buchholz).toBe(0.5); // brock 0.5
    expect(row(tableA, 'brock').buchholz).toBe(1.5); // ash 1 + misty 0.5
    expect(row(tableA, 'misty').buchholz).toBe(0.5); // brock 0.5 (not gary)
    expect(row(tableB, 'dawn').buchholz).toBe(0); // gary 0
    expect(row(tableB, 'gary').buchholz).toBe(1); // dawn 1 (not misty)
    expect(row(tableB, 'iris').buchholz).toBe(0); // nothing completed yet
  });

  it('breaks points ties on Buchholz within each table and lists members in standings order', () => {
    expect(tableA.standings.map((s) => s.player_id)).toEqual(['ash', 'brock', 'misty']);
    expect(tableB.standings.map((s) => s.player_id)).toEqual(['dawn', 'gary', 'iris']);
    expect(tableA.members).toEqual([
      { id: 'ash', name: 'Ash' },
      { id: 'brock', name: 'Brock' },
      { id: 'misty', name: 'Misty' },
    ]);
  });

  it('uses no kill difference and no games played, though battle stats were handed in', () => {
    for (const standing of [...tableA.standings, ...tableB.standings]) {
      expect(standing.kill_differential).toBe(0);
      expect(standing.games_played).toBe(0);
    }
  });

  it('marks the per-group advancement count on every table', () => {
    expect(result.tables.map((table) => table.advanceCount)).toEqual([2, 2]);
  });

  it('shows no advancement zone for an overall cut across several groups, the count for a single group', () => {
    const overall = buildTableStage({ ...input, stage: { ...swiss, advancement_rule: TOP_THREE_OVERALL } });
    expect(overall.tables.map((table) => table.advanceCount)).toEqual([null, null]);
    const one = buildTableStage({
      ...input,
      stage: { ...swiss, advancement_rule: TOP_THREE_OVERALL },
      groups: [group('g-only', 1, ['ash', 'misty', 'brock', 'dawn', 'gary', 'iris'])],
    });
    expect(one.tables.map((table) => table.advanceCount)).toEqual([3]);
    // One group holding everyone: the cross-group match counts again.
    expect(row(one.tables[0], 'misty').points).toBe(1.5);
  });

  it('places an enrolled substitute without a group row (pre-fix data) in their opponents’ group, scored as Swiss', () => {
    const withSub = buildTableStage({
      ...input,
      participants: [...participants, participant('sub')],
      matches: [
        ...matches,
        played('s-sub1', 'sub', 'ash', 'sub', undefined, { round_id: 'sw3' }),
        played('s-sub2', 'misty', 'sub', 'sub', undefined, { round_id: 'sw3' }),
      ],
    });
    const [a, b] = withSub.tables;
    expect(a.members.map((m) => m.id).sort()).toEqual(['ash', 'brock', 'misty', 'sub']);
    expect(b.members.map((m) => m.id).sort()).toEqual(['dawn', 'gary', 'iris']);
    expect(row(a, 'sub')).toMatchObject({ wins: 2, losses: 0, points: 2, buchholz: 1.5 }); // ash 1 + misty 0.5
    expect(row(a, 'ash')).toMatchObject({ wins: 1, losses: 1, points: 1, buchholz: 2.5 }); // brock 0.5 + sub 2
    expect(a.standings[0].player_id).toBe('sub');
  });

  it('does not mutate the groups it is given', () => {
    expect(groups.map((g) => [g.id, g.members.map((m) => m.player_id)])).toEqual([
      ['g-b', ['dawn', 'gary', 'iris']],
      ['g-a', ['ash', 'misty', 'brock']],
    ]);
  });
});

describe('buildTableStage — an enrolled player without a group row in a grouped phase', () => {
  const rr = stage('stage-rr', { bracket_type: 'round_robin', advancement_rule: TOP_TWO_PER_GROUP });
  // Given out of order (Group B first): placement ties go to the earlier
  // group by group_number, not to the first group in the list.
  const groups = [group('g-b', 2, ['dawn', 'gary', 'iris']), group('g-a', 1, ['ash', 'misty', 'brock'])];
  const enrolled = ['ash', 'misty', 'brock', 'dawn', 'gary', 'iris'].map(participant);
  // A substitution from before the fix swapped the enrollment but not the
  // group row: the substitute is enrolled, just not grouped.
  const withSub = [...enrolled, participant('sub')];
  const build = (
    matches: MatchWithPlayers[],
    participants = withSub,
    battleStats: TournamentBattleStat[] = [],
  ) => buildTableStage(tableInput({ stage: rr, matches, participants, groups, battleStats }));
  const memberIds = (table: HubGroupTable) => ids(table.members).sort();
  const GROUP_A = ['ash', 'brock', 'misty'];
  const GROUP_B = ['dawn', 'gary', 'iris'];

  it('joins the group most of their opponents belong to, with every result counted on both sides', () => {
    const result = build(
      [
        played('m-1', 'sub', 'ash', 'sub'),
        played('m-2', 'misty', 'sub', 'sub'),
        played('m-3', 'sub', 'brock', 'sub', ['sub', 'brock', 'sub']),
        // One Group B opponent: outvoted, and cross-table once the sub sits in Group A.
        played('m-4', 'dawn', 'sub', 'dawn'),
        played('m-5', 'ash', 'misty', 'ash'),
      ],
      withSub,
      [stat('sub', 3, false, 'm-1-g1'), stat('ash', 1, true, 'm-1-g1')],
    );
    const [tableA, tableB] = result.tables;

    expect(result.tables.map((table) => table.key)).toEqual(['g-a', 'g-b']);
    expect(memberIds(tableA)).toEqual([...GROUP_A, 'sub'].sort());
    expect(memberIds(tableB)).toEqual(GROUP_B);
    expect(ids(tableA.matches)).toEqual(['m-1', 'm-2', 'm-3', 'm-5']);
    expect(ids(tableB.matches)).toEqual([]);

    expect(row(tableA, 'sub')).toMatchObject({
      player_name: 'Late Sub',
      player_avatar_url: 'https://img.example/sub.png',
      wins: 3,
      losses: 0,
      points: 9,
      games_played: 7,
      kill_differential: 3,
    });
    // The group members' losses to the substitute count.
    expect(row(tableA, 'ash')).toMatchObject({ wins: 1, losses: 1, points: 3 });
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 2, points: 0 });
    expect(row(tableA, 'brock')).toMatchObject({ wins: 0, losses: 1, games_played: 3 });
    expect(tableA.standings[0].player_id).toBe('sub');
    // The cross-table win reaches no row in Group B.
    expect(row(tableB, 'dawn')).toMatchObject({ wins: 0, losses: 0, points: 0 });
  });

  it('a majority in a later group beats an earlier group', () => {
    const result = build([
      played('m-1', 'sub', 'ash', 'ash'),
      played('m-2', 'sub', 'dawn', 'sub'),
      played('m-3', 'gary', 'sub', 'gary'),
    ]);
    const [tableA, tableB] = result.tables;
    expect(memberIds(tableA)).toEqual(GROUP_A);
    expect(memberIds(tableB)).toEqual([...GROUP_B, 'sub'].sort());
    expect(row(tableB, 'sub')).toMatchObject({ wins: 1, losses: 1, points: 3 });
    expect(row(tableA, 'ash')).toMatchObject({ wins: 0, points: 0 });
  });

  it('a tie between opponent groups goes to the earlier group by group number', () => {
    const result = build([
      // The Group B opponent comes first, and Group B is first in the list.
      played('m-1', 'dawn', 'sub', 'sub'),
      played('m-2', 'sub', 'ash', 'ash'),
    ]);
    const [tableA, tableB] = result.tables;
    expect(tableA.key).toBe('g-a');
    expect(memberIds(tableA)).toEqual([...GROUP_A, 'sub'].sort());
    expect(memberIds(tableB)).toEqual(GROUP_B);
    expect(row(tableA, 'sub')).toMatchObject({ wins: 0, losses: 1, points: 0 });
    expect(row(tableA, 'ash')).toMatchObject({ wins: 1, points: 3 });
    expect(row(tableB, 'dawn')).toMatchObject({ wins: 0, losses: 0 });
  });

  it('leaves out a player whose only opponents have no group row either', () => {
    // Tracey (enrolled, no group row) also beat Ash, so she joins Group A; the
    // substitute's only opponent is Tracey, who has no group ROW, so the
    // substitute and their match drop out.
    const withTracey = [...withSub, participant('tracey')];
    const result = build(
      [played('m-1', 'sub', 'tracey', 'sub'), played('m-2', 'tracey', 'ash', 'tracey')],
      withTracey,
    );
    const [tableA, tableB] = result.tables;
    expect(memberIds(tableA)).toEqual([...GROUP_A, 'tracey'].sort());
    expect(memberIds(tableB)).toEqual(GROUP_B);
    expect(ids(tableA.matches)).toEqual(['m-2']);
    expect(row(tableA, 'tracey')).toMatchObject({
      player_name: 'Tracey',
      player_avatar_url: 'https://img.example/tracey.png',
      wins: 1,
      losses: 0,
      points: 3,
    });
    for (const table of result.tables) expect(memberIds(table)).not.toContain('sub');

    // Two ungrouped players who only met each other: neither is placed.
    const alone = build([played('m-1', 'sub', 'tracey', 'sub')], withTracey);
    expect(alone.tables.map(memberIds)).toEqual([GROUP_A, GROUP_B]);
    expect(alone.tables.flatMap((table) => ids(table.matches))).toEqual([]);
  });

  it('never places a departed player (named by matches, not enrolled), nor counts their matches', () => {
    // Tracey left the phase: her enrollment row is gone, her matches remain.
    const result = build([
      played('m-1', 'tracey', 'ash', 'tracey'),
      played('m-2', 'misty', 'tracey', 'tracey'),
      played('m-3', 'ash', 'misty', 'ash'),
    ]);
    const [tableA, tableB] = result.tables;
    expect(result.tables.map(memberIds)).toEqual([GROUP_A, GROUP_B]);
    expect(ids(tableA.matches)).toEqual(['m-3']);
    expect(ids(tableB.matches)).toEqual([]);
    expect(row(tableA, 'ash')).toMatchObject({ wins: 1, losses: 0, points: 3 });
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 1, points: 0 });
  });

  it('with no enrollment rows, keeps every group member and places nobody extra', () => {
    const result = build(
      [
        played('m-1', 'sub', 'ash', 'sub'),
        played('m-2', 'misty', 'sub', 'sub'),
        played('m-3', 'ash', 'misty', 'ash'),
      ],
      [],
    );
    const [tableA, tableB] = result.tables;
    expect(result.tables.map(memberIds)).toEqual([GROUP_A, GROUP_B]);
    expect(ids(tableA.matches)).toEqual(['m-3']);
    expect(row(tableA, 'ash')).toMatchObject({ player_name: 'group:ash', wins: 1, losses: 0, points: 3 });
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 1 });
    expect(row(tableB, 'dawn')).toMatchObject({ player_name: 'group:dawn', wins: 0, losses: 0 });
  });

  it('an unplayed inherited fixture is enough to place the substitute', () => {
    const result = build([match('m-1', 'sub', 'ash')]);
    const [tableA] = result.tables;
    expect(memberIds(tableA)).toEqual([...GROUP_A, 'sub'].sort());
    expect(ids(tableA.matches)).toEqual(['m-1']);
    expect(row(tableA, 'sub')).toMatchObject({ wins: 0, losses: 0, points: 0 });
  });

  it('does not add an enrolled player without a group row or a match', () => {
    const result = build([played('m-1', 'ash', 'misty', 'ash')], withSub);
    expect(result.tables.map(memberIds)).toEqual([GROUP_A, GROUP_B]);
  });

  it('does not add the substitute to the group rows it is given', () => {
    build([played('m-1', 'sub', 'ash', 'sub')]);
    expect(groups.map((g) => [g.id, g.members.map((m) => m.player_id)])).toEqual([
      ['g-b', ['dawn', 'gary', 'iris']],
      ['g-a', ['ash', 'misty', 'brock']],
    ]);
  });
});

describe('buildTableStage — a departed group member replaced by a substitute', () => {
  const rr = stage('stage-rr', { bracket_type: 'round_robin', advancement_rule: TOP_TWO_PER_GROUP });
  // Old data: the substitution swapped the enrollment (Departed out, Late Sub
  // in) but left Departed's group row in place and gave the substitute none.
  const groups = [
    group('g-a', 1, ['ash', 'misty', 'brock', 'departed']),
    group('g-b', 2, ['dawn', 'gary', 'iris']),
  ];
  const participants = ['ash', 'misty', 'brock', 'sub', 'dawn', 'gary', 'iris'].map(participant);
  const matches = [
    // Completed before the substitution: they stay Departed's and count nowhere.
    played('m-d1', 'departed', 'ash', 'departed', ['departed', 'ash', 'departed']),
    played('m-d2', 'misty', 'departed', 'misty'),
    // Departed's remaining fixture, handed to the substitute.
    played('m-e1', 'sub', 'brock', 'sub'),
    played('m-a', 'ash', 'misty', 'ash'),
    match('m-b', 'brock', 'misty'),
  ];
  const result = buildTableStage(tableInput({ stage: rr, matches, participants, groups }));
  const [tableA, tableB] = result.tables;
  const memberIds = (table: HubGroupTable) => ids(table.members).sort();

  it('drops the departed member from every table', () => {
    expect(result.tables.map((table) => table.key)).toEqual(['g-a', 'g-b']);
    for (const table of result.tables) {
      expect(memberIds(table)).not.toContain('departed');
      expect(table.standings.map((s) => s.player_id)).not.toContain('departed');
    }
  });

  it('places the substitute into the departed member’s group with their results', () => {
    expect(memberIds(tableA)).toEqual(['ash', 'brock', 'misty', 'sub']);
    expect(memberIds(tableB)).toEqual(['dawn', 'gary', 'iris']);
    expect(row(tableA, 'sub')).toMatchObject({
      player_name: 'Late Sub',
      player_avatar_url: 'https://img.example/sub.png',
      wins: 1,
      losses: 0,
      points: 3,
      games_played: 2,
    });
    expect(row(tableA, 'brock')).toMatchObject({ wins: 0, losses: 1, points: 0 });
  });

  it('does not count the departed member’s completed matches for either side', () => {
    expect(ids(tableA.matches)).toEqual(['m-e1', 'm-a', 'm-b']);
    expect(ids(tableB.matches)).toEqual([]);
    // Ash's loss to Departed and its three games are gone; only the win over Misty counts.
    expect(row(tableA, 'ash')).toMatchObject({ wins: 1, losses: 0, points: 3, games_played: 2 });
    // Misty's win over Departed is gone too.
    expect(row(tableA, 'misty')).toMatchObject({ wins: 0, losses: 1, points: 0, games_played: 2 });
  });

  it('keeps the per-group advancement count', () => {
    expect(result.tables.map((table) => table.advanceCount)).toEqual([2, 2]);
  });
});

describe('buildTableStage — Evolution Point Buy', () => {
  const epbContext = { formatType: 'evolution_point_buy', evolutionPoints: { ash: 4, misty: 9, brock: 1 } };
  const rr = stage('stage-epb', { bracket_type: 'round_robin' });
  const participants = ['ash', 'misty', 'brock'].map(participant);

  it('ungrouped: rows carry evolution points and rank by them on equal points', () => {
    const result = buildTableStage(
      tableInput({
        stage: rr,
        participants,
        matches: [played('m-1', 'ash', 'brock', 'ash'), played('m-2', 'misty', 'brock', 'misty')],
        context: epbContext,
      }),
    );
    const standings = result.tables[0].standings as EvolutionStanding[];
    for (const standing of standings) {
      expect(standing).toHaveProperty('evolution_points');
      expect(standing).toHaveProperty('needs_decision_match');
    }
    expect(standings.map((s) => [s.player_id, s.points, s.evolution_points])).toEqual([
      ['misty', 3, 9],
      ['ash', 3, 4],
      ['brock', 0, 1],
    ]);
  });

  it('grouped: every group table carries evolution points', () => {
    const result = buildTableStage(
      tableInput({
        stage: rr,
        participants: [...participants, participant('dawn')],
        groups: [group('g-a', 1, ['ash', 'misty']), group('g-b', 2, ['brock', 'dawn'])],
        matches: [played('m-1', 'ash', 'misty', 'ash')],
        context: epbContext,
      }),
    );
    expect(result.tables).toHaveLength(2);
    const [a, b] = result.tables.map((table) => table.standings as EvolutionStanding[]);
    expect(a.map((s) => [s.player_id, s.points, s.evolution_points])).toEqual([
      ['ash', 3, 4],
      ['misty', 0, 9],
    ]);
    // Dawn has no evolution tracker rows: 0.
    expect(b.map((s) => [s.player_id, s.evolution_points])).toEqual([
      ['brock', 1],
      ['dawn', 0],
    ]);
  });

  it('a non-EPB season keeps the generic rows', () => {
    const result = buildTableStage(
      tableInput({ stage: rr, participants, context: { formatType: 'singles' } }),
    );
    for (const standing of result.tables[0].standings) {
      expect(standing).not.toHaveProperty('evolution_points');
    }
  });
});

// ---------------------------------------------------------------------------
// Stage filters
// ---------------------------------------------------------------------------

describe('stage filters', () => {
  const all = [
    stage('rr-1', { bracket_type: 'round_robin', stage_order: 1 }),
    stage('se-1', { bracket_type: 'single_elim', stage_order: 2 }),
    stage('sw-1', { bracket_type: 'swiss', stage_order: 3 }),
    stage('de-1', { bracket_type: 'double_elim', stage_order: 4 }),
    stage('rr-2', { bracket_type: 'round_robin', stage_order: 5 }),
  ];

  it('tableStages keeps round robin and Swiss phases in order', () => {
    expect(ids(tableStages(all))).toEqual(['rr-1', 'sw-1', 'rr-2']);
  });

  it('bracketStages keeps elimination phases in order', () => {
    expect(ids(bracketStages(all))).toEqual(['se-1', 'de-1']);
  });

  it('roundRobinStages keeps only round robin phases (the ones scored with kill difference)', () => {
    expect(ids(roundRobinStages(all))).toEqual(['rr-1', 'rr-2']);
  });

  it('returns the same row objects, extra fields included', () => {
    const rich = [{ ...all[0], extra: 'kept' }];
    expect(tableStages(rich)[0]).toBe(rich[0]);
    expect(tableStages(rich)[0].extra).toBe('kept');
  });

  it('empty in, empty out', () => {
    expect(tableStages([])).toEqual([]);
    expect(bracketStages([])).toEqual([]);
    expect(roundRobinStages([])).toEqual([]);
  });
});

describe('stageMatches', () => {
  it('returns one phase’s matches in fixture order', () => {
    const fixtures = [
      fixture('a', match('m-3', 'ash', 'misty')),
      fixture('b', match('m-1', 'ash', 'misty')),
      fixture('a', match('m-2', 'ash', 'misty')),
    ];
    expect(ids(stageMatches(fixtures, 'a'))).toEqual(['m-3', 'm-2']);
    expect(ids(stageMatches(fixtures, 'b'))).toEqual(['m-1']);
    expect(stageMatches(fixtures, 'missing')).toEqual([]);
  });
});
