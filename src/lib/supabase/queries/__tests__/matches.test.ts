import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chainable Supabase mock ────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

vi.mock('@/lib/utils/uuid', () => ({
  assertValidUuid: vi.fn(),
}));

import {
  listAllMatches,
  getMatchesByRound,
  getMatchesByTournament,
  getH2HBetweenPlayers,
  getCompletedMatchesByTournament,
  getMatchById,
  getMatchesByPlayer,
  getMatchesByPlayerWithTournament,
  createMatch,
  createMatchBatch,
  updateMatchStatus,
  transitionMatchStatus,
  updateOpenMatchSchedule,
  listMatchesNeedingFinalize,
  markMatchFinalized,
  updateMatchPlayers,
  resetMatchFields,
  hasDownstreamMatches,
  getCompletedMatchRecords,
  getCompletedMatchRecordsBatch,
  updateMatchSocialImageUrl,
  getPlayerIdsWithCompletedMatches,
} from '../matches';

// ── Test fixtures ──────────────────────────────────────────────────
const MATCH_ROW = {
  id: 'm1',
  round_id: 'r1',
  tournament_id: 't1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  winner_id: 'p1',
  status: 'completed',
  submitter_id: 'p1',
  date_played: '2025-01-01',
  scheduled_at: null,
  auto_confirm_at: null,
  confirmed_at: null,
  notes: '',
  social_image_url: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const MATCH_WITH_PLAYERS_ROW = {
  ...MATCH_ROW,
  player_1: { name: 'Alice', avatar_url: 'https://a.png' },
  player_2: { name: 'Bob', avatar_url: null },
  winner: { name: 'Alice' },
  round: { status: 'completed' },
  games: [
    { id: 'g2', game_number: 2, winner_id: 'p1', replay_url: 'https://r2', source: 'manual' },
    { id: 'g1', game_number: 1, winner_id: 'p2', replay_url: 'https://r1', source: 'replay' },
  ],
};

const MATCH_WITH_TOURNAMENT_ROW = {
  ...MATCH_WITH_PLAYERS_ROW,
  tournaments: { name: 'Weekly #1' },
};

beforeEach(() => {
  for (const m of [...chainMethods, 'single', 'maybeSingle']) {
    mockBuilder[m].mockClear();
  }
  // Re-apply chain defaults
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

// ── toMatch / toMatchWithPlayers transformer ───────────────────────
describe('listAllMatches (exercises toMatch + toMatchWithPlayers)', () => {
  it('returns mapped matches and sorts games by game_number', async () => {
    // listAllMatches chain: from -> select -> order -> limit -> (optional eq) -> await
    // The last method before await with no filters is limit (or eq if filters present).
    // Since filters are optional and the query is `await query`, mock the terminal.
    // With filters off: the chain ends at limit, then awaited.
    mockBuilder.limit.mockReturnValue({ data: [MATCH_WITH_PLAYERS_ROW], error: null });

    const result = await listAllMatches();

    expect(result).toHaveLength(1);
    const m = result[0];
    expect(m.id).toBe('m1');
    expect(m.player_1_name).toBe('Alice');
    expect(m.player_2_name).toBe('Bob');
    expect(m.player_1_avatar_url).toBe('https://a.png');
    expect(m.player_2_avatar_url).toBeNull();
    expect(m.winner_name).toBe('Alice');
    expect(m.round_status).toBe('completed');
    // Games should be sorted ascending by game_number
    expect(m.games[0].game_number).toBe(1);
    expect(m.games[1].game_number).toBe(2);
    expect(m.games[0].source).toBe('replay');
  });

  it('applies tournament_id filter', async () => {
    // With a filter: chain becomes limit -> eq -> await
    mockBuilder.eq.mockReturnValue({ data: [], error: null });

    await listAllMatches({ tournament_id: 't1' });
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
  });

  it('applies status filter', async () => {
    mockBuilder.eq.mockReturnValue({ data: [], error: null });

    await listAllMatches({ status: 'completed' as never });
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('applies both filters', async () => {
    // Two sequential .eq() calls: first returns builder, second is terminal
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValue({ data: [], error: null });

    await listAllMatches({ tournament_id: 't1', status: 'scheduled' as never });
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'scheduled');
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('db error') });

    await expect(listAllMatches()).rejects.toThrow('db error');
  });
});

describe('getMatchesByRound', () => {
  it('returns matches filtered by round_id', async () => {
    mockBuilder.eq.mockReturnValue({ data: [MATCH_WITH_PLAYERS_ROW], error: null });

    const result = await getMatchesByRound('r1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('round_id', 'r1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ data: null, error: new Error('round err') });
    await expect(getMatchesByRound('r1')).rejects.toThrow('round err');
  });
});

describe('getMatchesByTournament', () => {
  // Paging past max_rows is covered against the in-memory PostgREST in
  // matches-by-tournament.test.ts.
  it('reads the tournament oldest first in one max_rows window, with no row cap', async () => {
    mockBuilder.range.mockReturnValue({ data: [MATCH_WITH_PLAYERS_ROW], error: null });

    const result = await getMatchesByTournament('t1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: true });
    expect(mockBuilder.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(mockBuilder.range).toHaveBeenCalledTimes(1);
    expect(mockBuilder.range).toHaveBeenCalledWith(0, 999);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.range.mockReturnValue({ data: null, error: new Error('fail') });
    await expect(getMatchesByTournament('t1')).rejects.toThrow('fail');
  });
});

describe('getH2HBetweenPlayers', () => {
  it('applies tournament, status, and or filters', async () => {
    mockBuilder.or.mockReturnValue({ data: [], error: null });

    await getH2HBetweenPlayers('p1', 'p2', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'completed');
    expect(mockBuilder.or).toHaveBeenCalled();
  });

  it('throws on error', async () => {
    mockBuilder.or.mockReturnValue({ data: null, error: new Error('h2h err') });
    await expect(getH2HBetweenPlayers('p1', 'p2', 't1')).rejects.toThrow('h2h err');
  });
});

describe('getCompletedMatchesByTournament', () => {
  it('filters by tournament_id and status=completed', async () => {
    mockBuilder.limit.mockReturnValue({ data: [], error: null });

    await getCompletedMatchesByTournament('t1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'completed');
    expect(mockBuilder.limit).toHaveBeenCalledWith(500);
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('fail') });
    await expect(getCompletedMatchesByTournament('t1')).rejects.toThrow('fail');
  });
});

describe('getMatchById', () => {
  it('returns a match when found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: MATCH_WITH_PLAYERS_ROW,
      error: null,
    });

    const result = await getMatchById('m1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('m1');
    expect(result!.player_1_name).toBe('Alice');
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
  });

  it('returns null when not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getMatchById('missing');
    expect(result).toBeNull();
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('db error'),
    });
    await expect(getMatchById('m1')).rejects.toThrow('db error');
  });
});

describe('getMatchesByPlayer', () => {
  it('returns matches where player is p1 or p2', async () => {
    // Chain ends at .limit()
    mockBuilder.limit.mockReturnValue({ data: [MATCH_WITH_PLAYERS_ROW], error: null });

    const result = await getMatchesByPlayer('p1');
    expect(mockBuilder.or).toHaveBeenCalled();
    expect(mockBuilder.order).toHaveBeenCalledWith('date_played', { ascending: false, nullsFirst: false });
    expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toHaveLength(1);
  });

  it('adds tournament filter when provided', async () => {
    mockBuilder.limit.mockReturnValue({ data: [], error: null });

    await getMatchesByPlayer('p1', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('player err') });
    await expect(getMatchesByPlayer('p1')).rejects.toThrow('player err');
  });
});

describe('getMatchesByPlayerWithTournament', () => {
  it('returns matches with tournament_name', async () => {
    mockBuilder.limit.mockReturnValue({ data: [MATCH_WITH_TOURNAMENT_ROW], error: null });

    const result = await getMatchesByPlayerWithTournament('p1');
    expect(result).toHaveLength(1);
    expect(result[0].tournament_name).toBe('Weekly #1');
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('fail') });
    await expect(getMatchesByPlayerWithTournament('p1')).rejects.toThrow('fail');
  });
});

describe('createMatch', () => {
  it('inserts and returns mapped match', async () => {
    mockBuilder.single.mockResolvedValue({ data: MATCH_ROW, error: null });

    const result = await createMatch({
      round_id: 'r1',
      tournament_id: 't1',
      player_1_id: 'p1',
      player_2_id: 'p2',
    });

    expect(mockBuilder.insert).toHaveBeenCalledWith({
      round_id: 'r1',
      tournament_id: 't1',
      player_1_id: 'p1',
      player_2_id: 'p2',
    });
    expect(result.id).toBe('m1');
    expect(result.status).toBe('completed');
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('insert err') });
    await expect(
      createMatch({ round_id: 'r1', tournament_id: 't1', player_1_id: 'p1', player_2_id: 'p2' }),
    ).rejects.toThrow('insert err');
  });
});

describe('createMatchBatch', () => {
  it('inserts multiple matches', async () => {
    mockBuilder.select.mockReturnValue({ data: [MATCH_ROW], error: null });

    const input = [{ round_id: 'r1', tournament_id: 't1', player_1_id: 'p1', player_2_id: 'p2' }];
    const result = await createMatchBatch(input);
    expect(mockBuilder.insert).toHaveBeenCalledWith(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('throws on error', async () => {
    mockBuilder.select.mockReturnValue({ data: null, error: new Error('batch err') });
    await expect(createMatchBatch([])).rejects.toThrow('batch err');
  });

  it('recovers from unique violation by refetching the existing slot', async () => {
    const existing = { ...MATCH_ROW, bracket_side: 'winners', bracket_pos: 0 };
    mockBuilder.select.mockReturnValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    mockBuilder.maybeSingle.mockResolvedValue({ data: existing, error: null });

    const result = await createMatchBatch([
      {
        round_id: 'r1',
        tournament_id: 't1',
        player_1_id: 'p1',
        player_2_id: 'p2',
        bracket_side: 'winners',
        bracket_pos: 0,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('round_id', 'r1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('bracket_side', 'winners');
    expect(mockBuilder.eq).toHaveBeenCalledWith('bracket_pos', 0);
  });
});

describe('updateMatchStatus', () => {
  it('sets status and winnerId when provided', async () => {
    mockBuilder.single.mockResolvedValue({
      data: { ...MATCH_ROW, status: 'completed', winner_id: 'p1' },
      error: null,
    });

    const result = await updateMatchStatus('m1', 'completed' as never, 'p1', 'p1');
    expect(mockBuilder.update).toHaveBeenCalled();
    expect(result.winner_id).toBe('p1');
  });

  it('sets date_played when status is completed', async () => {
    mockBuilder.single.mockResolvedValue({ data: MATCH_ROW, error: null });

    await updateMatchStatus('m1', 'completed' as never);
    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.date_played).toBeDefined();
    expect(updateArg.confirmed_at).toBeDefined();
    expect(updateArg.auto_confirm_at).toBeNull();
    expect(updateArg.status).toBe('completed');
  });

  it('does not set date_played for non-completed status', async () => {
    mockBuilder.single.mockResolvedValue({
      data: { ...MATCH_ROW, status: 'in_progress' },
      error: null,
    });

    await updateMatchStatus('m1', 'in_progress' as never);
    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.date_played).toBeUndefined();
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('update err') });
    await expect(updateMatchStatus('m1', 'completed' as never)).rejects.toThrow('update err');
  });

  it('returns null when compare-and-set expectedStatus misses', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await updateMatchStatus(
      'm1',
      'completed' as never,
      'p1',
      'p1',
      null,
      'pending_confirmation' as never
    );

    expect(result).toBeNull();
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending_confirmation');
  });

  it('returns the row when compare-and-set matches', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { ...MATCH_ROW, status: 'completed' },
      error: null,
    });

    const result = await updateMatchStatus(
      'm1',
      'completed' as never,
      'p1',
      'p1',
      null,
      'pending_confirmation' as never
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
  });

  it('clears the finalize marker with every status write (C2)', async () => {
    mockBuilder.single.mockResolvedValue({ data: MATCH_ROW, error: null });

    await updateMatchStatus('m1', 'completed' as never, 'p1');
    expect((mockBuilder.update.mock.calls[0][0] as Record<string, unknown>).finalized_at).toBeNull();

    mockBuilder.single.mockResolvedValue({ data: { ...MATCH_ROW, status: 'in_progress' }, error: null });
    await updateMatchStatus('m1', 'in_progress' as never);
    expect((mockBuilder.update.mock.calls[1][0] as Record<string, unknown>).finalized_at).toBeNull();
  });
});

describe('transitionMatchStatus (M3: one row update)', () => {
  it('writes status, winner, submitter and timer in ONE conditional update', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { ...MATCH_ROW, status: 'pending_confirmation', auto_confirm_at: '2026-05-22T00:00:00.000Z' },
      error: null,
    });

    const result = await transitionMatchStatus('m1', {
      expectedStatus: 'in_progress',
      status: 'pending_confirmation',
      winnerId: 'p1',
      submitterId: 'p2',
      autoConfirmAt: '2026-05-22T00:00:00.000Z',
      confirmedAt: null,
    });

    expect(mockBuilder.update).toHaveBeenCalledTimes(1);
    expect(mockBuilder.update).toHaveBeenCalledWith({
      status: 'pending_confirmation',
      finalized_at: null,
      winner_id: 'p1',
      submitter_id: 'p2',
      auto_confirm_at: '2026-05-22T00:00:00.000Z',
      confirmed_at: null,
    });
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'in_progress');
    expect(result?.status).toBe('pending_confirmation');
  });

  it('leaves fields it is not given untouched (undefined keeps the stored timer)', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...MATCH_ROW, status: 'pending_confirmation' }, error: null });

    await transitionMatchStatus('m1', {
      expectedStatus: 'pending_confirmation',
      status: 'pending_confirmation',
      winnerId: 'p2',
    });

    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).toEqual({ status: 'pending_confirmation', finalized_at: null, winner_id: 'p2' });
    expect('auto_confirm_at' in updateArg).toBe(false);
  });

  it('writes date_played only when datePlayed is given (null clears it)', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...MATCH_ROW, status: 'in_progress' }, error: null });

    await transitionMatchStatus('m1', { expectedStatus: 'completed', status: 'in_progress', datePlayed: null });
    expect(mockBuilder.update.mock.calls[0][0]).toEqual({
      status: 'in_progress',
      finalized_at: null,
      date_played: null,
    });

    mockBuilder.update.mockClear();
    await transitionMatchStatus('m1', { expectedStatus: 'completed', status: 'in_progress' });
    const arg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect('date_played' in arg).toBe(false);
  });

  it('returns null and writes nothing else when the compare-and-set misses', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await transitionMatchStatus('m1', {
      expectedStatus: 'in_progress',
      status: 'pending_confirmation',
      autoConfirmAt: null,
    });

    expect(result).toBeNull();
  });

  it('throws on a write error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('transition err') });

    await expect(
      transitionMatchStatus('m1', { expectedStatus: 'in_progress', status: 'pending_confirmation' })
    ).rejects.toThrow('transition err');
  });

  it('validates the match id before writing', async () => {
    const { assertValidUuid } = await import('@/lib/utils/uuid');
    vi.mocked(assertValidUuid).mockImplementationOnce(() => {
      throw new Error('Invalid match id');
    });

    await expect(
      transitionMatchStatus('nope', { expectedStatus: 'in_progress', status: 'pending_confirmation' })
    ).rejects.toThrow('Invalid match id');
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });
});

describe('updateOpenMatchSchedule', () => {
  it('updates scheduled_at only for a match that is not completed', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { ...MATCH_WITH_PLAYERS_ROW, status: 'scheduled', scheduled_at: '2026-10-24T10:00:00+02:00' },
      error: null,
    });

    const result = await updateOpenMatchSchedule('m1', '2026-10-24T10:00:00+02:00');

    expect(mockBuilder.update).toHaveBeenCalledWith({ scheduled_at: '2026-10-24T10:00:00+02:00' });
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
    expect(mockBuilder.neq).toHaveBeenCalledWith('status', 'completed');
    expect(result?.player_1_name).toBe('Alice');
  });

  it('clears the time with null', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...MATCH_WITH_PLAYERS_ROW, status: 'scheduled' }, error: null });
    await updateOpenMatchSchedule('m1', null);
    expect(mockBuilder.update).toHaveBeenCalledWith({ scheduled_at: null });
  });

  it('returns null when no row matched (completed or gone)', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(updateOpenMatchSchedule('m1', null)).resolves.toBeNull();
  });

  it('throws on a write error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('schedule err') });
    await expect(updateOpenMatchSchedule('m1', null)).rejects.toThrow('schedule err');
  });
});

describe('listMatchesNeedingFinalize (C2 heal worklist)', () => {
  it('selects completed matches without a finalize marker, older than the cutoff, oldest first', async () => {
    mockBuilder.limit.mockResolvedValueOnce({ data: [MATCH_WITH_PLAYERS_ROW], error: null });

    const result = await listMatchesNeedingFinalize('2026-05-21T00:00:00.000Z', 10);

    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'completed');
    expect(mockBuilder.is).toHaveBeenCalledWith('finalized_at', null);
    expect(mockBuilder.lte).toHaveBeenCalledWith('updated_at', '2026-05-21T00:00:00.000Z');
    expect(mockBuilder.order).toHaveBeenCalledWith('updated_at', { ascending: true });
    expect(mockBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(mockBuilder.limit).toHaveBeenCalledWith(10);
    expect(mockBuilder.or).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].player_1_name).toBe('Alice');
  });

  it('continues behind a keyset cursor with quoted values', async () => {
    mockBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

    await listMatchesNeedingFinalize('2026-05-21T00:00:00.000Z', 100, {
      updated_at: '2026-05-20T10:00:00.123456+00:00',
      id: '11111111-1111-4111-8111-111111111111',
    });

    expect(mockBuilder.or).toHaveBeenCalledWith(
      'updated_at.gt."2026-05-20T10:00:00.123456+00:00",' +
        'and(updated_at.eq."2026-05-20T10:00:00.123456+00:00",id.gt."11111111-1111-4111-8111-111111111111")'
    );
  });

  it('validates the cursor id before reading', async () => {
    const { assertValidUuid } = await import('@/lib/utils/uuid');
    vi.mocked(assertValidUuid).mockImplementationOnce(() => {
      throw new Error('Invalid cursor match id');
    });

    await expect(
      listMatchesNeedingFinalize('2026-05-21T00:00:00.000Z', 100, { updated_at: 'x', id: 'nope' })
    ).rejects.toThrow('Invalid cursor match id');
    expect(mockBuilder.limit).not.toHaveBeenCalled();
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockResolvedValueOnce({ data: null, error: new Error('list err') });
    await expect(listMatchesNeedingFinalize('2026-05-21T00:00:00.000Z')).rejects.toThrow('list err');
  });
});

describe('markMatchFinalized', () => {
  it('stamps finalized_at only while the match is still completed', async () => {
    mockBuilder.select.mockResolvedValueOnce({ data: [{ id: 'm1' }], error: null });

    const marked = await markMatchFinalized('m1', '2026-05-21T00:00:00.000Z');

    expect(marked).toBe(true);
    expect(mockBuilder.update).toHaveBeenCalledWith({ finalized_at: '2026-05-21T00:00:00.000Z' });
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('returns false when the match is no longer completed', async () => {
    mockBuilder.select.mockResolvedValueOnce({ data: [], error: null });
    await expect(markMatchFinalized('m1')).resolves.toBe(false);
  });

  it('throws on error', async () => {
    mockBuilder.select.mockResolvedValueOnce({ data: null, error: new Error('mark err') });
    await expect(markMatchFinalized('m1')).rejects.toThrow('mark err');
  });
});

describe('resetMatchFields', () => {
  it('resets to scheduled with null fields', async () => {
    const resetRow = {
      ...MATCH_ROW,
      status: 'scheduled',
      winner_id: null,
      submitter_id: null,
      date_played: null,
      auto_confirm_at: null,
      confirmed_at: null,
    };
    mockBuilder.single.mockResolvedValue({ data: resetRow, error: null });

    const result = await resetMatchFields('m1');
    expect(mockBuilder.update).toHaveBeenCalledWith({
      status: 'scheduled',
      winner_id: null,
      submitter_id: null,
      date_played: null,
      auto_confirm_at: null,
      confirmed_at: null,
      finalized_at: null,
    });
    expect(result.status).toBe('scheduled');
    expect(result.winner_id).toBeNull();
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('reset err') });
    await expect(resetMatchFields('m1')).rejects.toThrow('reset err');
  });
});

describe('hasDownstreamMatches', () => {
  it('returns false when no winner exists', async () => {
    // First single() call: match lookup
    mockBuilder.single.mockResolvedValueOnce({
      data: { tournament_id: 't1', winner_id: null, round_id: 'r1' },
      error: null,
    });

    const result = await hasDownstreamMatches('m1');
    expect(result).toBe(false);
  });

  it('uses a pre-reset snapshot so a cleared winner_id still finds downstream', async () => {
    mockBuilder.single.mockResolvedValueOnce({
      data: { round_number: 1 },
      error: null,
    });
    mockBuilder.gt.mockReturnValue({ data: [{ id: 'r2' }], error: null });
    mockBuilder.limit.mockReturnValue({ data: [{ id: 'm2' }], error: null });

    const result = await hasDownstreamMatches('m1', {
      tournament_id: 't1',
      winner_id: 'p1',
      round_id: 'r1',
    });

    expect(result).toBe(true);
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('returns false when no later rounds exist', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({
        data: { tournament_id: 't1', winner_id: 'p1', round_id: 'r1' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { round_number: 1 },
        error: null,
      });
    mockBuilder.gt.mockReturnValue({ data: [], error: null });

    const result = await hasDownstreamMatches('m1');
    expect(result).toBe(false);
  });

  it('returns true when winner appears in later rounds', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({
        data: { tournament_id: 't1', winner_id: 'p1', round_id: 'r1' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { round_number: 1 },
        error: null,
      });
    mockBuilder.gt.mockReturnValue({ data: [{ id: 'r2' }], error: null });
    mockBuilder.limit.mockReturnValue({ data: [{ id: 'm2' }], error: null });

    const result = await hasDownstreamMatches('m1');
    expect(result).toBe(true);
  });

  it('returns false when winner does not appear downstream', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({
        data: { tournament_id: 't1', winner_id: 'p1', round_id: 'r1' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { round_number: 1 },
        error: null,
      });
    mockBuilder.gt.mockReturnValue({ data: [{ id: 'r2' }], error: null });
    mockBuilder.limit.mockReturnValue({ data: [], error: null });

    const result = await hasDownstreamMatches('m1');
    expect(result).toBe(false);
  });

  it('throws if match lookup fails', async () => {
    mockBuilder.single.mockResolvedValueOnce({
      data: null,
      error: new Error('match not found'),
    });
    await expect(hasDownstreamMatches('m1')).rejects.toThrow('match not found');
  });

  it('throws if round lookup fails', async () => {
    mockBuilder.single
      .mockResolvedValueOnce({
        data: { tournament_id: 't1', winner_id: 'p1', round_id: 'r1' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error('round err'),
      });
    await expect(hasDownstreamMatches('m1')).rejects.toThrow('round err');
  });
});

describe('getCompletedMatchRecords', () => {
  it('maps rows to MatchRecord with round_number', async () => {
    const row = {
      player_1_id: 'p1',
      player_2_id: 'p2',
      winner_id: 'p1',
      rounds: { round_number: 3 },
    };
    // Chain: .eq().eq().order().order().range() — range is terminal; a short page ends the read
    mockBuilder.range.mockResolvedValueOnce({ data: [row], error: null });

    const result = await getCompletedMatchRecords('t1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      player_1_id: 'p1',
      player_2_id: 'p2',
      winner_id: 'p1',
      round_number: 3,
    });
    expect(mockBuilder.range).toHaveBeenCalledTimes(1);
    expect(mockBuilder.range).toHaveBeenCalledWith(0, 999);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
  });

  it('returns empty array when no completed matches', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: [], error: null });
    const result = await getCompletedMatchRecords('t1');
    expect(result).toEqual([]);
  });

  it('throws on error', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: null, error: new Error('records err') });
    await expect(getCompletedMatchRecords('t1')).rejects.toThrow('records err');
  });
});

describe('getCompletedMatchRecordsBatch', () => {
  it('returns empty map for empty input', async () => {
    const result = await getCompletedMatchRecordsBatch([]);
    expect(result.size).toBe(0);
    // Should not call supabase at all
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('groups records by tournament_id', async () => {
    const rows = [
      { tournament_id: 't1', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', rounds: { round_number: 1 } },
      { tournament_id: 't2', player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p4', rounds: { round_number: 1 } },
      { tournament_id: 't1', player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', rounds: { round_number: 2 } },
    ];
    mockBuilder.range.mockResolvedValueOnce({ data: rows, error: null });

    const result = await getCompletedMatchRecordsBatch(['t1', 't2']);
    expect(result.get('t1')).toHaveLength(2);
    expect(result.get('t2')).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: null, error: new Error('batch err') });
    await expect(getCompletedMatchRecordsBatch(['t1'])).rejects.toThrow('batch err');
  });
});

describe('updateMatchSocialImageUrl', () => {
  it('updates social image url', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await updateMatchSocialImageUrl('550e8400-e29b-41d4-a716-446655440000', 'https://img.png');
    expect(mockBuilder.update).toHaveBeenCalledWith({ social_image_url: 'https://img.png' });
  });

  it('supports clearing the url to null', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await updateMatchSocialImageUrl('550e8400-e29b-41d4-a716-446655440000', null);
    expect(mockBuilder.update).toHaveBeenCalledWith({ social_image_url: null });
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ error: new Error('img err') });
    await expect(
      updateMatchSocialImageUrl('550e8400-e29b-41d4-a716-446655440000', 'x'),
    ).rejects.toThrow('img err');
  });
});

describe('getPlayerIdsWithCompletedMatches', () => {
  it('returns empty set for empty tournament list', async () => {
    const result = await getPlayerIdsWithCompletedMatches([]);
    expect(result.size).toBe(0);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('collects player_1_id and player_2_id into a set', async () => {
    const rows = [
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p1', player_2_id: 'p3' },
    ];
    mockBuilder.range.mockResolvedValueOnce({ data: rows, error: null });

    const result = await getPlayerIdsWithCompletedMatches(['t1']);
    expect(result.size).toBe(3);
    expect(result.has('p1')).toBe(true);
    expect(result.has('p2')).toBe(true);
    expect(result.has('p3')).toBe(true);
  });

  it('deduplicates player IDs', async () => {
    const rows = [
      { player_1_id: 'p1', player_2_id: 'p2' },
      { player_1_id: 'p2', player_2_id: 'p1' },
    ];
    mockBuilder.range.mockResolvedValueOnce({ data: rows, error: null });

    const result = await getPlayerIdsWithCompletedMatches(['t1']);
    expect(result.size).toBe(2);
  });

  it('throws on error', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: null, error: new Error('ids err') });
    await expect(getPlayerIdsWithCompletedMatches(['t1'])).rejects.toThrow('ids err');
  });
});

// ── Transformer edge cases ─────────────────────────────────────────
describe('toMatchWithPlayers edge cases (via listAllMatches)', () => {
  it('handles null winner gracefully', async () => {
    const row = {
      ...MATCH_WITH_PLAYERS_ROW,
      winner_id: null,
      winner: null,
    };
    mockBuilder.limit.mockReturnValue({ data: [row], error: null });

    const result = await listAllMatches();
    expect(result[0].winner_name).toBeNull();
  });

  it('handles missing games array', async () => {
    const row = {
      ...MATCH_WITH_PLAYERS_ROW,
      games: undefined,
    };
    mockBuilder.limit.mockReturnValue({ data: [row], error: null });

    const result = await listAllMatches();
    expect(result[0].games).toEqual([]);
  });

  it('handles null round gracefully', async () => {
    const row = {
      ...MATCH_WITH_PLAYERS_ROW,
      round: null,
    };
    mockBuilder.limit.mockReturnValue({ data: [row], error: null });

    const result = await listAllMatches();
    expect(result[0].round_status).toBe('pending');
  });
});

describe('updateMatchPlayers', () => {
  it('re-pairs the match as scheduled and clears the finalize marker with the status write', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: MATCH_ROW, error: null });

    await updateMatchPlayers('m1', 'p3', 'p4');

    expect(mockBuilder.update).toHaveBeenCalledWith({
      player_1_id: 'p3',
      player_2_id: 'p4',
      winner_id: null,
      status: 'scheduled',
      finalized_at: null,
    });
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'm1');
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('players err') });
    await expect(updateMatchPlayers('m1', 'p3', 'p4')).rejects.toThrow('players err');
  });
});
