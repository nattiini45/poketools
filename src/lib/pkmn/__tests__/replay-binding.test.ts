import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(),
  parseReplayLog: vi.fn(),
}));

import { fetchReplay, parseReplayLog } from '@/lib/pkmn/replay';
import { bindReplay, fetchBoundReplay, resultFromBoundReplay } from '../replay-binding';
import { computeReplayHash } from '../replay-identity';
import type { ParsedBattleStats } from '@/types/game';

const LOG = ['|player|p1|alice_ps', '|player|p2|bob_ps', '|turn|1', '|win|bob_ps'].join('\n');

const PARSED: ParsedBattleStats = {
  winner_ps_username: 'bob_ps',
  players: [
    { ps_username: 'alice_ps', pokemon: [{ pokemon_name: 'Pikachu', was_brought: true, was_lead: true, kos_dealt: 0, was_koed: true, moves_used: ['Thunderbolt'], turns_active: 1 }] },
    { ps_username: 'bob_ps', pokemon: [{ pokemon_name: 'Garchomp', was_brought: true, was_lead: true, kos_dealt: 1, was_koed: false, moves_used: ['Earthquake'], turns_active: 1 }] },
  ],
};

describe('bindReplay / fetchBoundReplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseReplayLog).mockReturnValue(PARSED);
  });

  it('hashes and parses the same log', () => {
    const bound = bindReplay('gen9ou-1', LOG);
    expect(bound.url).toBe('gen9ou-1');
    expect(bound.hash).toBe(computeReplayHash(LOG));
    expect(vi.mocked(parseReplayLog)).toHaveBeenCalledWith(LOG);
    expect(bound.parsed).toBe(PARSED);
  });

  it('fetches the replay once and binds its log', async () => {
    vi.mocked(fetchReplay).mockResolvedValue({ id: 'gen9ou-1', format: 'gen9ou', players: ['alice_ps', 'bob_ps'], winner: 'bob_ps', log: LOG });
    const bound = await fetchBoundReplay('https://replay.pokemonshowdown.com/gen9ou-1');
    expect(vi.mocked(fetchReplay)).toHaveBeenCalledTimes(1);
    expect(bound.hash).toBe(computeReplayHash(LOG));
    expect(bound.url).toBe('https://replay.pokemonshowdown.com/gen9ou-1');
  });
});

describe('resultFromBoundReplay', () => {
  beforeEach(() => {
    vi.mocked(parseReplayLog).mockReturnValue(PARSED);
  });

  it('takes the winner from the |win| side and the stats per side, unchanged', () => {
    const result = resultFromBoundReplay(bindReplay('gen9ou-1', LOG), ['u1', 'u2'], ['u1', 'u2']);
    expect(result.winner_id).toBe('u2');
    expect(result.battle_stats).toEqual([
      { game_id: '', player_id: 'u1', ...PARSED.players[0].pokemon[0] },
      { game_id: '', player_id: 'u2', ...PARSED.players[1].pokemon[0] },
    ]);
  });

  it('refuses a side outside the participants, one player on both sides, and a log without a winner', () => {
    const bound = bindReplay('gen9ou-1', LOG);
    expect(() => resultFromBoundReplay(bound, ['u1', 'u3'], ['u1', 'u2'])).toThrow(
      expect.objectContaining({ code: 'match_player_not_participant', params: { playerId: 'u3' } }),
    );
    expect(() => resultFromBoundReplay(bound, ['u1', 'u1'], ['u1', 'u2'])).toThrow(
      expect.objectContaining({ code: 'replay_sides_not_distinct' }),
    );
    vi.mocked(parseReplayLog).mockReturnValue({ ...PARSED, winner_ps_username: 'someone_else' });
    expect(() => resultFromBoundReplay(bindReplay('gen9ou-1', LOG), ['u1', 'u2'], ['u1', 'u2'])).toThrow(
      expect.objectContaining({ code: 'replay_winner_unknown', statusCode: 400 }),
    );
  });
});
