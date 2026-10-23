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

// ── tournaments.ts imports ─────────────────────────────────────────
import {
  listAllTournaments,
  listTournaments,
  listArchivedTournaments,
  listTournamentsByIds,
  getTournamentById,
  getTournamentWithDetails,
  createTournament,
  getStagesBySeasonId,
  updateTournament,
  archiveTournamentsBySeason,
  deleteTournament,
  getTournamentsByPlayer,
  getParticipants,
  getParticipantsBatch,
  isPlayerTournamentParticipant,
  addParticipant,
  removeParticipant,
  swapTournamentParticipant,
} from '../tournaments';

// ── tournament-groups.ts imports ───────────────────────────────────
import { getGroupsByTournament } from '../tournament-groups';

// ── tournament-reports.ts imports ──────────────────────────────────
import {
  getTournamentReport,
  getTournamentReports,
  createTournamentReport,
  updateTournamentReport,
  deleteTournamentReport,
} from '../tournament-reports';

import type { TournamentFormData } from '@/types/tournament';

// ── Test fixtures ──────────────────────────────────────────────────
const TOURNAMENT_ROW = {
  id: 't1',
  name: 'Weekly #1',
  description: 'A tournament',
  season_id: null,
  bracket_type: 'swiss',
  ruleset_id: 'rs1',
  best_of_default: 3,
  bo_overrides: {},
  is_doubles: false,
  team_visibility: 'post_match',
  status: 'registration',
  current_round: 0,
  stage_order: 0,
  advancement_rule: null,
  archived: false,
  legacy: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const TOURNAMENT_WITH_DETAILS_ROW = {
  ...TOURNAMENT_ROW,
  rulesets: { name: 'Gen 9 OU' },
  seasons: null,
  // PostgREST count embed: `tournament_participants ( count )`.
  tournament_participants: [{ count: 2 }],
};

const GROUP_ROW = {
  id: 'g1',
  tournament_id: 't1',
  name: 'Group A',
  group_number: 1,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const REPORT_ROW = {
  id: 'rpt1',
  tournament_id: 't1',
  round_id: 'r1',
  report_type: 'round_recap',
  model_id: 'claude-3-5-sonnet',
  content: { summary: 'Round 1 complete' },
  prompt_tokens: 100,
  completion_tokens: 200,
  generation_time_ms: 1500,
  status: 'completed',
  error: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

beforeEach(() => {
  for (const m of [...chainMethods, 'single', 'maybeSingle']) {
    mockBuilder[m].mockClear();
  }
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockResolvedValue({ data: null, error: null });
  mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
});

// ════════════════════════════════════════════════════════════════════
// tournaments.ts
// ════════════════════════════════════════════════════════════════════

describe('listAllTournaments', () => {
  it('returns tournaments with details', async () => {
    mockBuilder.limit.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = await listAllTournaments();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Weekly #1');
    expect(result[0].ruleset_name).toBe('Gen 9 OU');
    expect(result[0].season_name).toBeNull();
    expect(result[0].participant_count).toBe(2);
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('all err') });
    await expect(listAllTournaments()).rejects.toThrow('all err');
  });
});

describe('tournament list queries count participants with an embed', () => {
  const listCalls: Array<[string, () => Promise<unknown>, 'limit' | 'order']> = [
    ['listAllTournaments', () => listAllTournaments(), 'limit'],
    ['listTournaments', () => listTournaments(), 'limit'],
    ['listArchivedTournaments', () => listArchivedTournaments(), 'order'],
    ['listTournamentsByIds', () => listTournamentsByIds(['t1']), 'order'],
    ['getStagesBySeasonId', () => getStagesBySeasonId('s1'), 'order'],
  ];

  it.each(listCalls)('%s selects tournament_participants ( count ), not every player_id', async (_name, call, terminal) => {
    mockBuilder[terminal].mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = (await call()) as Array<{ participant_count: number }>;

    const [select] = mockBuilder.select.mock.calls[0] as [string];
    expect(select).toContain('tournament_participants ( count )');
    expect(select).not.toContain('player_id');
    expect(result[0].participant_count).toBe(2);
  });

  it('getTournamentWithDetails uses the count embed too', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: TOURNAMENT_WITH_DETAILS_ROW, error: null });

    await getTournamentWithDetails('t1');

    const [select] = mockBuilder.select.mock.calls[0] as [string];
    expect(select).toContain('tournament_participants ( count )');
  });

  it('reads a missing or empty count embed as zero', async () => {
    mockBuilder.limit.mockReturnValue({
      data: [
        { ...TOURNAMENT_ROW, rulesets: null, seasons: null, tournament_participants: [] },
        { ...TOURNAMENT_ROW, id: 't2', rulesets: null, seasons: null, tournament_participants: null },
      ],
      error: null,
    });

    const result = await listTournaments();

    expect(result.map((t) => t.participant_count)).toEqual([0, 0]);
  });
});

describe('listTournaments', () => {
  it('filters by season_id IS NULL and archived=false', async () => {
    mockBuilder.limit.mockReturnValue({ data: [], error: null });

    await listTournaments();
    expect(mockBuilder.is).toHaveBeenCalledWith('season_id', null);
    expect(mockBuilder.eq).toHaveBeenCalledWith('archived', false);
  });

  it('maps details correctly', async () => {
    mockBuilder.limit.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = await listTournaments();
    expect(result[0].bracket_type).toBe('swiss');
    expect(result[0].participant_count).toBe(2);
  });

  it('throws on error', async () => {
    mockBuilder.limit.mockReturnValue({ data: null, error: new Error('list err') });
    await expect(listTournaments()).rejects.toThrow('list err');
  });
});

describe('listArchivedTournaments', () => {
  it('filters by archived=true', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await listArchivedTournaments();
    expect(mockBuilder.eq).toHaveBeenCalledWith('archived', true);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('arch err') });
    await expect(listArchivedTournaments()).rejects.toThrow('arch err');
  });
});

describe('listTournamentsByIds', () => {
  it('returns empty array for empty input', async () => {
    const result = await listTournamentsByIds([]);
    expect(result).toEqual([]);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('queries by IDs and returns details', async () => {
    mockBuilder.order.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = await listTournamentsByIds(['t1']);
    expect(mockBuilder.in).toHaveBeenCalledWith('id', ['t1']);
    expect(result).toHaveLength(1);
  });

  it('does not filter by archived or season unless asked', async () => {
    mockBuilder.order.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    await listTournamentsByIds(['t1']);

    expect(mockBuilder.eq).not.toHaveBeenCalledWith('archived', expect.anything());
    expect(mockBuilder.is).not.toHaveBeenCalled();
  });

  it('archived: false keeps archived tournaments out of the active admin list', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await listTournamentsByIds(['t1'], { archived: false });

    expect(mockBuilder.eq).toHaveBeenCalledWith('archived', false);
  });

  it('archived: true lists only archived tournaments of the given ids', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await listTournamentsByIds(['t1'], { archived: true });

    expect(mockBuilder.in).toHaveBeenCalledWith('id', ['t1']);
    expect(mockBuilder.eq).toHaveBeenCalledWith('archived', true);
  });

  it('standaloneOnly drops league stages like the site admin list', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await listTournamentsByIds(['t1'], { archived: false, standaloneOnly: true });

    expect(mockBuilder.is).toHaveBeenCalledWith('season_id', null);
  });

  it('returns empty for empty ids even with filters, without a read', async () => {
    expect(await listTournamentsByIds([], { archived: true, standaloneOnly: true })).toEqual([]);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('ids err') });
    await expect(listTournamentsByIds(['t1'])).rejects.toThrow('ids err');
  });
});

describe('getTournamentById', () => {
  it('returns tournament when found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: TOURNAMENT_ROW, error: null });

    const result = await getTournamentById('t1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('t1');
    expect(result!.bracket_type).toBe('swiss');
  });

  it('returns null when not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await getTournamentById('missing');
    expect(result).toBeNull();
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('get err') });
    await expect(getTournamentById('t1')).rejects.toThrow('get err');
  });
});

describe('getTournamentWithDetails', () => {
  it('returns tournament with joined details', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: TOURNAMENT_WITH_DETAILS_ROW,
      error: null,
    });

    const result = await getTournamentWithDetails('t1');
    expect(result).not.toBeNull();
    expect(result!.ruleset_name).toBe('Gen 9 OU');
    expect(result!.participant_count).toBe(2);
  });

  it('returns null when not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await getTournamentWithDetails('missing');
    expect(result).toBeNull();
  });

  it('handles null rulesets/seasons joins', async () => {
    const rowNulls = {
      ...TOURNAMENT_ROW,
      rulesets: null,
      seasons: null,
      tournament_participants: [],
    };
    mockBuilder.maybeSingle.mockResolvedValue({ data: rowNulls, error: null });

    const result = await getTournamentWithDetails('t1');
    expect(result!.ruleset_name).toBe('');
    expect(result!.season_name).toBeNull();
    expect(result!.participant_count).toBe(0);
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('detail err') });
    await expect(getTournamentWithDetails('t1')).rejects.toThrow('detail err');
  });
});

describe('createTournament', () => {
  it('inserts and returns mapped tournament', async () => {
    mockBuilder.single.mockResolvedValue({ data: TOURNAMENT_ROW, error: null });

    const input: TournamentFormData = {
      name: 'Weekly #1',
      bracket_type: 'swiss' as never,
      ruleset_id: 'rs1',
      best_of_default: 3,
      is_doubles: false,
      team_visibility: 'post_match' as never,
    };

    const result = await createTournament(input);
    expect(mockBuilder.insert).toHaveBeenCalled();
    expect(result.id).toBe('t1');
    expect(result.name).toBe('Weekly #1');
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('create err') });

    await expect(
      createTournament({
        name: 'T',
        bracket_type: 'swiss' as never,
        ruleset_id: 'rs1',
        best_of_default: 3,
        is_doubles: false,
        team_visibility: 'post_match' as never,
      }),
    ).rejects.toThrow('create err');
  });
});

describe('getStagesBySeasonId', () => {
  it('returns stages ordered by stage_order', async () => {
    mockBuilder.order.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = await getStagesBySeasonId('s1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 's1');
    expect(result).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('stage err') });
    await expect(getStagesBySeasonId('s1')).rejects.toThrow('stage err');
  });
});

describe('updateTournament', () => {
  it('updates specified fields only', async () => {
    mockBuilder.single.mockResolvedValue({
      data: { ...TOURNAMENT_ROW, name: 'Updated' },
      error: null,
    });

    const result = await updateTournament('t1', { name: 'Updated' });
    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.name).toBe('Updated');
    // Fields not in input should not appear
    expect(updateArg.bracket_type).toBeUndefined();
    expect(result.name).toBe('Updated');
  });

  it('handles status and current_round updates', async () => {
    mockBuilder.single.mockResolvedValue({ data: TOURNAMENT_ROW, error: null });

    await updateTournament('t1', { status: 'in_progress' as never, current_round: 2 });
    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.status).toBe('in_progress');
    expect(updateArg.current_round).toBe(2);
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('update err') });
    await expect(updateTournament('t1', { name: 'X' })).rejects.toThrow('update err');
  });
});

describe('archiveTournamentsBySeason', () => {
  it('sets archived for all tournaments in season', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await archiveTournamentsBySeason('s1', true);
    expect(mockBuilder.update).toHaveBeenCalledWith({ archived: true });
    expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 's1');
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ error: new Error('archive err') });
    await expect(archiveTournamentsBySeason('s1', true)).rejects.toThrow('archive err');
  });
});

describe('deleteTournament', () => {
  it('deletes by id', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await deleteTournament('t1');
    expect(mockBuilder.delete).toHaveBeenCalled();
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 't1');
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ error: new Error('del err') });
    await expect(deleteTournament('t1')).rejects.toThrow('del err');
  });
});

describe('getTournamentsByPlayer', () => {
  it('returns empty array when player has no participations', async () => {
    mockBuilder.eq.mockReturnValue({ data: [], error: null });

    const result = await getTournamentsByPlayer('p-none');
    expect(result).toEqual([]);
  });

  it('fetches tournaments by participant IDs', async () => {
    // First query: tournament_participants
    mockBuilder.eq.mockReturnValueOnce({ data: [{ tournament_id: 't1' }], error: null });
    // Second query: listTournamentsByIds chain ends at .order()
    mockBuilder.order.mockReturnValue({ data: [TOURNAMENT_WITH_DETAILS_ROW], error: null });

    const result = await getTournamentsByPlayer('p1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Weekly #1');
  });

  it('throws on participation query error', async () => {
    mockBuilder.eq.mockReturnValue({ data: null, error: new Error('part err') });
    await expect(getTournamentsByPlayer('p1')).rejects.toThrow('part err');
  });
});

// ── Participant management ─────────────────────────────────────────

describe('getParticipants', () => {
  it('maps player data and sorts seeded first', async () => {
    const playerRow = {
      id: 'p1',
      name: 'Alice',
      discord_id: 'disc1',
      ps_username: null,
      champions_username: null,
      is_admin: false,
      is_creator: false,
      joined_date: '2025-01-01',
      avatar_url: null,
      avatar_config: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    const row1 = { player_id: 'p1', seed: 2, players: playerRow };
    const row2 = {
      player_id: 'p2',
      seed: 1,
      players: { ...playerRow, id: 'p2', name: 'Bob' },
    };
    mockBuilder.eq.mockReturnValue({ data: [row1, row2], error: null });

    const result = await getParticipants('t1');
    // seed 1 should come first
    expect(result[0].name).toBe('Bob');
    expect(result[0].seed).toBe(1);
    expect(result[1].name).toBe('Alice');
    expect(result[1].seed).toBe(2);
  });

  it('sorts unseeded after seeded, alphabetically', async () => {
    const base = {
      id: 'p1',
      name: 'Charlie',
      discord_id: 'd',
      ps_username: null,
      champions_username: null,
      is_admin: false,
      is_creator: false,
      joined_date: '2025-01-01',
      avatar_url: null,
      avatar_config: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    const rows = [
      { player_id: 'p1', seed: null, players: { ...base, name: 'Charlie' } },
      { player_id: 'p2', seed: 1, players: { ...base, id: 'p2', name: 'Alice' } },
      { player_id: 'p3', seed: null, players: { ...base, id: 'p3', name: 'Bob' } },
    ];
    mockBuilder.eq.mockReturnValue({ data: rows, error: null });

    const result = await getParticipants('t1');
    expect(result.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ data: null, error: new Error('part err') });
    await expect(getParticipants('t1')).rejects.toThrow('part err');
  });
});

describe('getParticipantsBatch', () => {
  it('returns empty map for empty input', async () => {
    const result = await getParticipantsBatch([]);
    expect(result.size).toBe(0);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('groups participants by tournament_id', async () => {
    const playerBase = {
      id: 'p1',
      name: 'Alice',
      discord_id: 'd',
      ps_username: null,
      champions_username: null,
      is_admin: false,
      is_creator: false,
      joined_date: '2025-01-01',
      avatar_url: null,
      avatar_config: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    const rows = [
      { tournament_id: 't1', player_id: 'p1', seed: 1, players: playerBase },
      { tournament_id: 't2', player_id: 'p2', seed: null, players: { ...playerBase, id: 'p2', name: 'Bob' } },
    ];
    mockBuilder.in.mockReturnValue({ data: rows, error: null });

    const result = await getParticipantsBatch(['t1', 't2']);
    expect(result.get('t1')).toHaveLength(1);
    expect(result.get('t2')).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.in.mockReturnValue({ data: null, error: new Error('batch err') });
    await expect(getParticipantsBatch(['t1'])).rejects.toThrow('batch err');
  });
});

describe('isPlayerTournamentParticipant', () => {
  it('returns true when participant exists', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { player_id: 'p1' }, error: null });

    const result = await isPlayerTournamentParticipant('p1', 't1');
    expect(result).toBe(true);
  });

  it('returns false when participant does not exist', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await isPlayerTournamentParticipant('p-none', 't1');
    expect(result).toBe(false);
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('check err') });
    await expect(isPlayerTournamentParticipant('p1', 't1')).rejects.toThrow('check err');
  });
});

describe('addParticipant', () => {
  it('inserts participant row', async () => {
    mockBuilder.insert.mockReturnValue({ error: null });

    await addParticipant('t1', 'p1');
    expect(mockBuilder.insert).toHaveBeenCalledWith({
      tournament_id: 't1',
      player_id: 'p1',
    });
  });

  it('throws on error', async () => {
    mockBuilder.insert.mockReturnValue({ error: new Error('add err') });
    await expect(addParticipant('t1', 'p1')).rejects.toThrow('add err');
  });
});

describe('removeParticipant', () => {
  it('deletes participant row', async () => {
    mockBuilder.eq.mockImplementation((column: string) => {
      if (column === 'player_id') {
        return { error: null };
      }
      return mockBuilder;
    });

    await removeParticipant('t1', 'p1');
    expect(mockBuilder.delete).toHaveBeenCalled();
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockImplementation((column: string) => {
      if (column === 'player_id') {
        return { error: new Error('remove err') };
      }
      return mockBuilder;
    });
    await expect(removeParticipant('t1', 'p1')).rejects.toThrow('remove err');
  });
});

describe('swapTournamentParticipant', () => {
  type Call = [method: string, ...args: unknown[]];

  /** Every builder call in invocation order, one list per statement (each starts at `from`). */
  function statements(): Call[][] {
    const calls: Array<{ order: number; call: Call }> = [];
    for (const method of [...chainMethods, 'single', 'maybeSingle']) {
      const { calls: argLists, invocationCallOrder } = mockBuilder[method].mock;
      argLists.forEach((args, i) => {
        calls.push({ order: invocationCallOrder[i], call: [method, ...args] });
      });
    }
    calls.sort((a, b) => a.order - b.order);
    const result: Call[][] = [];
    for (const { call } of calls) {
      if (call[0] === 'from') result.push([call]);
      else result.at(-1)?.push(call);
    }
    return result;
  }

  /**
   * The outgoing row read ends at `.maybeSingle`, then freezeEnrollment reads
   * the tournament (`.maybeSingle`; `tournament` null means nothing to
   * freeze) and, for an open enrollment, updates it (ends at `.eq('id')`).
   * The swap UPDATE ends at `.select('seed')`.
   */
  function stubSwap(opts: {
    outRow: { seed: number | null } | null;
    fetchError?: Error;
    tournament?: Record<string, unknown> | null;
    swapped?: Array<{ seed: number | null }>;
    swapError?: Error;
  }) {
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: opts.fetchError ? null : opts.outRow,
      error: opts.fetchError ?? null,
    });
    // Queued only when the swap goes on to freeze: an unread value would leak
    // into the next test (mockClear keeps the once-queue).
    if (opts.outRow && !opts.fetchError) {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: opts.tournament ?? null, error: null });
    }
    let table = '';
    let updating = false;
    mockBuilder.from.mockImplementation((name: string) => {
      table = name;
      return mockBuilder;
    });
    mockBuilder.update.mockImplementation(() => {
      updating = true;
      return mockBuilder;
    });
    mockBuilder.eq.mockImplementation((column: string) => {
      if (updating && table === 'tournaments' && column === 'id') {
        updating = false;
        return { error: null };
      }
      return mockBuilder;
    });
    mockBuilder.select.mockImplementation(() => {
      if (updating && table === 'tournament_participants') {
        updating = false;
        return {
          data: opts.swapError ? null : (opts.swapped ?? [{ seed: opts.outRow?.seed ?? null }]),
          error: opts.swapError ?? null,
        };
      }
      return mockBuilder;
    });
  }

  const OUT_ROW_READ: Call[] = [
    ['from', 'tournament_participants'],
    ['select', 'seed'],
    ['eq', 'tournament_id', 't1'],
    ['eq', 'player_id', 'p-out'],
    ['maybeSingle'],
  ];

  const SWAP: Call[] = [
    ['from', 'tournament_participants'],
    ['update', { player_id: 'p-in' }],
    ['eq', 'tournament_id', 't1'],
    ['eq', 'player_id', 'p-out'],
    ['select', 'seed'],
  ];

  it('hands the enrollment row to the incoming player in one UPDATE (seed and starting bracket stay on the row)', async () => {
    stubSwap({ outRow: { seed: 4 } });

    const result = await swapTournamentParticipant('t1', 'p-out', 'p-in');

    const all = statements();
    expect(all[0]).toEqual(OUT_ROW_READ);
    expect(all.at(-1)).toEqual(SWAP);
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.insert).not.toHaveBeenCalled();
    expect(result).toEqual({ swapped: true, seed: 4 });
  });

  it('freezes an open enrollment before the swap', async () => {
    const source = { type: 'standings', source_phase_id: 'p0', synced_at: '2025-01-01T00:00:00Z', frozen: false };
    stubSwap({ outRow: { seed: 1 }, tournament: { ...TOURNAMENT_ROW, enrollment_source: source, seasons: null } });

    await swapTournamentParticipant('t1', 'p-out', 'p-in');

    const all = statements();
    expect(all.map((statement) => statement[0])).toEqual([
      ['from', 'tournament_participants'],
      ['from', 'tournaments'],
      ['from', 'tournaments'],
      ['from', 'tournament_participants'],
    ]);
    expect(all[2]).toContainEqual(['update', { enrollment_source: { ...source, frozen: true } }]);
    expect(all[3]).toEqual(SWAP);
  });

  it('reports an unseeded row as swapped, with a null seed', async () => {
    stubSwap({ outRow: { seed: null } });

    await expect(swapTournamentParticipant('t1', 'p-out', 'p-in')).resolves.toEqual({
      swapped: true,
      seed: null,
    });
    expect(statements().at(-1)).toEqual(SWAP);
  });

  it('reports nothing swapped when the row is gone by the UPDATE (a concurrent removal)', async () => {
    stubSwap({ outRow: { seed: 3 }, swapped: [] });

    await expect(swapTournamentParticipant('t1', 'p-out', 'p-in')).resolves.toEqual({
      swapped: false,
      seed: null,
    });
  });

  it('reports nothing swapped and writes nothing when the outgoing player is not enrolled', async () => {
    stubSwap({ outRow: null });

    const result = await swapTournamentParticipant('t1', 'p-out', 'p-in');

    expect(result).toEqual({ swapped: false, seed: null });
    expect(statements()).toEqual([OUT_ROW_READ]);
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.insert).not.toHaveBeenCalled();
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });

  it('throws a read error without writing', async () => {
    stubSwap({ outRow: null, fetchError: new Error('fetch err') });

    await expect(swapTournamentParticipant('t1', 'p-out', 'p-in')).rejects.toThrow('fetch err');
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });

  it('throws the UPDATE error (e.g. the incoming player is already enrolled) with no other write', async () => {
    stubSwap({ outRow: { seed: 1 }, swapError: new Error('duplicate key value violates unique constraint') });

    await expect(swapTournamentParticipant('t1', 'p-out', 'p-in')).rejects.toThrow('duplicate key');
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.insert).not.toHaveBeenCalled();
  });
});

// updateParticipantSeeds: covered against a stateful unique-index fake in
// participant-seeds.test.ts (seed swaps, conflicts, partial writes).

// ════════════════════════════════════════════════════════════════════
// tournament-groups.ts
// ════════════════════════════════════════════════════════════════════

describe('getGroupsByTournament', () => {
  it('returns groups with sorted members', async () => {
    const groupWithMembers = {
      ...GROUP_ROW,
      tournament_group_members: [
        { player_id: 'p2', seed: 2, players: { name: 'Bob' } },
        { player_id: 'p1', seed: 1, players: { name: 'Alice' } },
      ],
    };
    mockBuilder.order.mockReturnValue({ data: [groupWithMembers], error: null });

    const result = await getGroupsByTournament('t1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Group A');
    // Members sorted by seed
    expect(result[0].members[0].player_name).toBe('Alice');
    expect(result[0].members[0].seed).toBe(1);
    expect(result[0].members[1].player_name).toBe('Bob');
  });

  it('handles empty members array', async () => {
    const groupEmpty = { ...GROUP_ROW, tournament_group_members: [] };
    mockBuilder.order.mockReturnValue({ data: [groupEmpty], error: null });

    const result = await getGroupsByTournament('t1');
    expect(result[0].members).toEqual([]);
  });

  it('handles undefined members', async () => {
    const groupNoMembers = { ...GROUP_ROW, tournament_group_members: undefined };
    mockBuilder.order.mockReturnValue({ data: [groupNoMembers], error: null });

    const result = await getGroupsByTournament('t1');
    expect(result[0].members).toEqual([]);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('grp err') });
    await expect(getGroupsByTournament('t1')).rejects.toThrow('grp err');
  });
});

// ════════════════════════════════════════════════════════════════════
// tournament-reports.ts
// ════════════════════════════════════════════════════════════════════

describe('getTournamentReport', () => {
  it('returns report when found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: REPORT_ROW, error: null });

    const result = await getTournamentReport('t1', 'r1', 'round_recap' as never);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rpt1');
    expect(result!.report_type).toBe('round_recap');
    expect(result!.content).toEqual({ summary: 'Round 1 complete' });
  });

  it('returns null when not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getTournamentReport('t1', 'r1', 'round_recap' as never);
    expect(result).toBeNull();
  });

  it('logs and rethrows a query error instead of reporting "no report"', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbError = { message: 'db err' };
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: dbError });

    await expect(getTournamentReport('t1', 'r1', 'round_recap' as never)).rejects.toBe(dbError);
    expect(logSpy).toHaveBeenCalledWith('[tournament-reports] Query error:', 'db err');
    logSpy.mockRestore();
  });

  it('propagates a thrown exception', async () => {
    mockBuilder.maybeSingle.mockRejectedValue(new Error('network err'));

    await expect(getTournamentReport('t1', 'r1', 'round_recap' as never)).rejects.toThrow('network err');
  });
});

describe('getTournamentReports', () => {
  it('returns all reports for tournament', async () => {
    mockBuilder.order.mockReturnValue({ data: [REPORT_ROW], error: null });

    const result = await getTournamentReports('t1');
    expect(result).toHaveLength(1);
    expect(result[0].model_id).toBe('claude-3-5-sonnet');
  });

  it('logs and rethrows a query error instead of returning an empty list', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbError = { message: 'fail' };
    mockBuilder.order.mockReturnValue({ data: null, error: dbError });

    await expect(getTournamentReports('t1')).rejects.toBe(dbError);
    expect(logSpy).toHaveBeenCalledWith('[tournament-reports] Query error:', 'fail');
    logSpy.mockRestore();
  });

  it('handles null data gracefully', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: null });

    const result = await getTournamentReports('t1');
    expect(result).toEqual([]);
  });
});

describe('createTournamentReport', () => {
  it('creates pending report', async () => {
    mockBuilder.single.mockResolvedValue({ data: REPORT_ROW, error: null });

    const result = await createTournamentReport('t1', 'r1', 'round_recap' as never, 'claude-3-5-sonnet');
    expect(mockBuilder.insert).toHaveBeenCalledWith({
      tournament_id: 't1',
      round_id: 'r1',
      report_type: 'round_recap',
      model_id: 'claude-3-5-sonnet',
      status: 'pending',
    });
    expect(result.id).toBe('rpt1');
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('create err') });
    await expect(
      createTournamentReport('t1', 'r1', 'round_recap' as never, 'model'),
    ).rejects.toThrow('create err');
  });
});

describe('updateTournamentReport', () => {
  it('updates specified fields', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await updateTournamentReport('rpt1', {
      status: 'completed' as never,
      content: { summary: 'Done' } as never,
      prompt_tokens: 50,
    });

    expect(mockBuilder.update).toHaveBeenCalled();
    const updateArg = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.status).toBe('completed');
    expect(updateArg.content).toEqual({ summary: 'Done' });
    expect(updateArg.prompt_tokens).toBe(50);
    expect(updateArg.updated_at).toBeDefined();
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ error: new Error('upd err') });
    await expect(
      updateTournamentReport('rpt1', { status: 'failed' as never }),
    ).rejects.toThrow('upd err');
  });
});

describe('deleteTournamentReport', () => {
  it('deletes by tournament + round + type', async () => {
    // Chain: delete -> eq('tournament_id') -> eq('round_id') -> eq('report_type')
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValue({ error: null });

    await deleteTournamentReport('t1', 'r1', 'round_recap' as never);
    expect(mockBuilder.delete).toHaveBeenCalled();
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('round_id', 'r1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('report_type', 'round_recap');
  });

  it('throws on error', async () => {
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValueOnce(mockBuilder)
      .mockReturnValue({ error: new Error('del err') });
    await expect(
      deleteTournamentReport('t1', 'r1', 'round_recap' as never),
    ).rejects.toThrow('del err');
  });
});
