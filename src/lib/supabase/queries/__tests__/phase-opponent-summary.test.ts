import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOpponentBattleStatsInPhase, getPhaseScoutingMatch } from '../phase-opponent-summary';

const db = vi.hoisted(() => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'select', 'eq', 'or', 'order']) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn();
  builder.range = vi.fn();
  return builder;
});
vi.mock('@/lib/supabase/client', () => ({ supabase: db }));

const matchId = '00000000-0000-4000-8000-000000000001';
const phaseId = '00000000-0000-4000-8000-000000000002';
const seasonId = '00000000-0000-4000-8000-000000000003';
const opponentId = '00000000-0000-4000-8000-000000000004';
const viewerId = '00000000-0000-4000-8000-000000000005';
const owner = { kind: 'phase', phase_id: phaseId, season_id: seasonId } as const;
const row = {
  id: matchId, phase_id: phaseId, player_1_id: viewerId, player_2_id: opponentId,
  player_1: { name: 'Scout' }, player_2: { name: 'Rival' },
  phase: { season_id: seasonId, ruleset_id: 'ruleset-pin' },
};

describe('native scouting query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only match seats/names and the verified owning phase pin', async () => {
    db.maybeSingle.mockResolvedValue({ data: { ...row, notes: 'hidden notes', pokemon: ['Hidden plan'] }, error: null });
    await expect(getPhaseScoutingMatch(matchId, owner)).resolves.toEqual({
      phase_id: phaseId, player_1_id: viewerId, player_2_id: opponentId,
      player_1_name: 'Scout', player_2_name: 'Rival', ruleset_id: 'ruleset-pin',
    });
    expect(db.from).toHaveBeenCalledExactlyOnceWith('phase_matches');
    expect(db.eq.mock.calls).toEqual([['id', matchId], ['phase_id', phaseId], ['phase.season_id', seasonId]]);
    expect(db.select.mock.calls[0][0]).toContain('phase:league_phases!phase_matches_phase_id_fkey!inner(season_id, ruleset_id)');
    expect(db.select.mock.calls[0][0]).not.toMatch(/\*|notes|submitter|confirmed|pokemon|replay|teams/);
  });

  it.each([
    null,
    { ...row, id: 'other-match' },
    { ...row, phase_id: 'other-phase' },
    { ...row, phase: { ...row.phase, season_id: 'other-league' } },
  ])('refuses a match outside the verified chain or missing: %j', async data => {
    db.maybeSingle.mockResolvedValue({ data, error: null });
    await expect(getPhaseScoutingMatch(matchId, owner)).resolves.toBeNull();
  });

  it('filters to completed phase matches with the selected opponent in either seat and drains all pages', async () => {
    const stat = {
      game_id: 'game-id', pokemon_name: 'Pikachu', was_brought: true, was_lead: false, kos_dealt: 1,
      match_won: true, moves_used: ['Thunderbolt'],
    };
    db.range.mockResolvedValueOnce({ data: [{ ...stat, phase_games: { phase_matches: { id: matchId } }, internal: 'redact' }], error: null })
      .mockResolvedValueOnce({ data: [{ ...stat, game_id: 'other-game', moves_used: ['Surf', null, { move: 'Private' }] }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(getOpponentBattleStatsInPhase(opponentId, phaseId)).resolves.toEqual([
      stat, { ...stat, game_id: 'other-game', moves_used: ['Surf'] },
    ]);
    expect(db.from.mock.calls).toEqual(Array.from({ length: 3 }, () => ['phase_battle_stats']));
    expect(db.eq.mock.calls.slice(0, 3)).toEqual([
      ['player_id', opponentId],
      ['phase_games.phase_matches.phase_id', phaseId],
      ['phase_games.phase_matches.status', 'completed'],
    ]);
    expect(db.or).toHaveBeenCalledWith(
      `player_1_id.eq.${opponentId},player_2_id.eq.${opponentId}`,
      { referencedTable: 'phase_games.phase_matches' },
    );
    expect(db.select.mock.calls[0][0]).toContain('phase_games!inner(phase_matches!inner(id))');
    expect(db.select.mock.calls[0][0]).not.toMatch(/\*|notes|submitter|confirmed|replay|teams/);
    expect(db.order.mock.calls).toEqual([['id'], ['id'], ['id']]);
    expect(db.range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
  });

  it('rejects malformed history identifiers before interpolating a filter', async () => {
    await expect(getOpponentBattleStatsInPhase('invalid', phaseId)).rejects.toThrow('Invalid opponentId');
    await expect(getOpponentBattleStatsInPhase(opponentId, 'invalid')).rejects.toThrow('Invalid phaseId');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('propagates match and history storage failures instead of returning no data', async () => {
    const error = new Error('read failed');
    db.maybeSingle.mockResolvedValue({ data: null, error });
    db.range.mockResolvedValue({ data: null, error });
    await expect(getPhaseScoutingMatch(matchId, owner)).rejects.toBe(error);
    await expect(getOpponentBattleStatsInPhase(opponentId, phaseId)).rejects.toBe(error);
  });
});
