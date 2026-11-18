import { beforeEach, expect, it, vi } from 'vitest';
import { emitPhaseResultEffects } from '@/lib/league-phase/result-effects';

const h = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(), key: vi.fn(), ai: vi.fn(), revalidate: vi.fn(),
  queue: vi.fn(), phase: vi.fn(), match: vi.fn(), round: vi.fn(), stats: vi.fn(),
  discord: vi.fn(), social: vi.fn(), warn: vi.fn(),
}));
vi.mock('next/server', () => ({ after: h.after }));
vi.mock('@/lib/ai/api-key', () => ({ anthropicApiKey: h.key }));
vi.mock('@/lib/ai/phase-analysis', () => ({ generatePhaseAnalysis: h.ai }));
vi.mock('@/lib/revalidation', () => ({ revalidatePhaseMatchPages: h.revalidate }));
vi.mock('@/lib/league-phase/phase-aggregate-storage', () => ({ processPhaseAggregateJobs: h.queue }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.match }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: h.round }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: h.stats }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: h.discord }));
vi.mock('@/lib/social/notify', () => ({ emitPhaseSocialEvent: h.social }));
vi.mock('@/lib/logger', () => ({ logger: { warn: h.warn } }));

const owner = { kind: 'phase', phase_id: 'phase', season_id: 'league' } as const;
const match = {
  phase_id: 'phase', round_id: 'round',
  player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Firefly', player_2_name: 'Pebble',
  games: [{ id: 'game', game_number: 1, winner_id: 'p2' }],
};
const result = { game_id: 'game', game_winner_id: 'p2', match_winner_id: null, bo_reached: false };
const play = () => h.after.mock.calls[0][0]();

beforeEach(() => {
  vi.resetAllMocks();
  h.phase.mockResolvedValue({ season_id: 'league', name: 'Opening phase' });
  h.round.mockResolvedValue({ name: 'Round 1' });
  h.match.mockResolvedValue(match);
  h.queue.mockResolvedValue({ processed: 1, failed: 0, reclaimed: 0 });
  h.ai.mockResolvedValue({ kind: 'generated' });
  h.stats.mockResolvedValue({ game: [
    { player_id: 'p1', pokemon_name: 'Bulbasaur', kos_dealt: 0, was_koed: true },
    { player_id: 'p2', pokemon_name: 'Pikachu', kos_dealt: 1, was_koed: false },
  ] });
});

it('expires native caches, emits a league-owned phase payload, and defers bounded native queue work', async () => {
  await emitPhaseResultEffects(owner, 'match', result);
  expect(h.revalidate).toHaveBeenCalledExactlyOnceWith('phase', 'match', 'league');
  expect(h.round).toHaveBeenCalledExactlyOnceWith('round', 'phase');
  const payload = {
    owner, version: 1, event_type: 'match_result_submitted',
    data: { kind: 'match_result', player_1_name: 'Firefly', player_2_name: 'Pebble',
      winner_name: 'Pebble', game_score: '0-1', phase_name: 'Opening phase', round_name: 'Round 1',
      game_stats: [{ game_number: 1, winner_id: 'p2', players: [
        { player_id: 'p1', player_name: 'Firefly', pokemon: [{ pokemon_name: 'Bulbasaur', kos_dealt: 0, was_koed: true }] },
        { player_id: 'p2', player_name: 'Pebble', pokemon: [{ pokemon_name: 'Pikachu', kos_dealt: 1, was_koed: false }] },
      ] }],
    },
  };
  expect(h.discord).toHaveBeenCalledExactlyOnceWith(payload);
  expect(h.social).toHaveBeenCalledExactlyOnceWith(payload);
  expect(h.queue).not.toHaveBeenCalled();
  await play();
  expect(h.queue).toHaveBeenCalledExactlyOnceWith(5, expect.any(Function));
  await h.queue.mock.calls[0][1]({ kind: 'phase', phase_id: 'other-phase', season_id: 'other-league' });
  expect(h.revalidate).toHaveBeenLastCalledWith('other-phase', undefined, 'other-league');
  expect(h.key).not.toHaveBeenCalled();
  expect(h.ai).not.toHaveBeenCalled();
});

it.each(['', 'configured'])('only invokes in-process analysis after the threshold when configured (%s)', async key => {
  h.key.mockReturnValue(key);
  await emitPhaseResultEffects(owner, 'match', { ...result, match_winner_id: 'p1', bo_reached: true });
  expect(h.discord).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ winner_name: 'Firefly' }) }));
  expect(h.ai).not.toHaveBeenCalled();
  await play();
  if (key) {
    expect(h.ai).toHaveBeenCalledExactlyOnceWith({ phaseId: 'phase', matchId: 'match', kind: 'post_match' });
    expect(h.revalidate).toHaveBeenCalledTimes(2);
  } else {
    expect(h.ai).not.toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalledTimes(1);
  }
});

it('does not announce if the committed game is no longer in the scoped match', async () => {
  h.match.mockResolvedValue({ ...match, games: [] });
  await emitPhaseResultEffects(owner, 'match', result);
  expect(h.discord).not.toHaveBeenCalled();
  expect(h.social).not.toHaveBeenCalled();
  expect(h.stats).not.toHaveBeenCalled();
  expect(h.warn).toHaveBeenCalledWith('phase/result-effects', 'Could not announce the recorded phase result', expect.any(Object));
  await play();
  expect(h.queue).toHaveBeenCalledOnce();
});

it('logs independent post-commit failures without rejecting or starving other effects', async () => {
  h.revalidate.mockRejectedValueOnce(new Error('cache failure'));
  h.stats.mockRejectedValueOnce(new Error('stats failure'));
  h.queue.mockRejectedValueOnce(new Error('queue failure'));
  h.key.mockReturnValue('configured');
  h.ai.mockRejectedValueOnce(new Error('analysis failure'));
  await emitPhaseResultEffects(owner, 'match', { ...result, bo_reached: true });
  await play();
  expect(h.warn.mock.calls.map(([, message]) => message)).toEqual(expect.arrayContaining([
    'Could not revalidate the recorded result', 'Could not announce the recorded phase result',
    'Could not process phase aggregate jobs', 'Could not generate native match analysis',
  ]));
  expect(h.queue).toHaveBeenCalledOnce();
  expect(h.ai).toHaveBeenCalledOnce();
});
