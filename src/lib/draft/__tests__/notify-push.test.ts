/**
 * `dispatchDraftNotifications` and Web Push (docs/push.md): the claims that go to Discord also go to
 * `pushDraftClaims`, once, with the season names the dispatch already read; the Discord path is unchanged, a
 * failing push never breaks it, and a dispatch with no claims pushes nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  pushDraftClaims: vi.fn(),
  emitDiscordEvent: vi.fn(),
  getPlayersByIds: vi.fn(),
  getSeasonById: vi.fn(),
  getPublishedDrops: vi.fn(),
}));

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/draft/rpc-errors', () => ({ callDraftRpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/push/draft-alerts', () => ({ pushDraftClaims: hoisted.pushDraftClaims }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: hoisted.emitDiscordEvent }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayersByIds: hoisted.getPlayersByIds }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: hoisted.getSeasonById }));
vi.mock('@/lib/supabase/queries/drafts-queue', () => ({ listTickablePools: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts-redraft', () => ({ getPublishedDrops: hoisted.getPublishedDrops }));

import { dispatchDraftNotifications } from '../notify';

const turn = {
  pool_id: 'pool-1',
  season_id: 'season-1',
  slot_id: 'slot-1',
  player_id: 'p1',
  deadline_at: '2026-10-12T12:02:00+00:00',
  timer_seconds: 120,
  round: 1,
  pick_number: 1,
  kind: 'normal',
  mode: 'live',
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.pushDraftClaims.mockResolvedValue(1);
  hoisted.getSeasonById.mockResolvedValue({ id: 'season-1', name: 'EvoLiga S1' });
  hoisted.getPlayersByIds.mockResolvedValue(new Map([['p1', { id: 'p1', name: 'Misty', discord_id: 'disc-misty' }]]));
  hoisted.getPublishedDrops.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('dispatchDraftNotifications → Web Push', () => {
  it('turn_started: one Discord event and one push call with the same claim and the season name', async () => {
    const sent = await dispatchDraftNotifications([{ type: 'turn_started', ...turn }]);

    expect(sent).toBe(1);
    expect(hoisted.emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.emitDiscordEvent.mock.calls[0][0]).toMatchObject({
      event_type: 'draft_turn_started',
      data: { kind: 'draft_turn', player_name: 'Misty', player_discord_id: 'disc-misty' },
    });

    expect(hoisted.pushDraftClaims).toHaveBeenCalledTimes(1);
    const [claims, seasonName] = hoisted.pushDraftClaims.mock.calls[0];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ type: 'turn_started', pool_id: 'pool-1', player_id: 'p1' });
    expect(seasonName('season-1')).toBe('EvoLiga S1');
    expect(seasonName('unknown-season')).toBe('');
  });

  it('turn_reminder and redraft_published go to the push hook too', async () => {
    hoisted.getPublishedDrops.mockResolvedValue([]);
    await dispatchDraftNotifications([
      { type: 'turn_reminder', ...turn, threshold: '4h', mode: 'slow' },
      { type: 'redraft_published', pool_id: 'pool-1', season_id: 'season-1' },
    ]);
    expect(hoisted.emitDiscordEvent).toHaveBeenCalledTimes(2);
    const claims = hoisted.pushDraftClaims.mock.calls[0][0];
    expect(claims.map((c: { type: string }) => c.type)).toEqual(['turn_reminder', 'redraft_published']);
  });

  it('is awaited, so the sends finish inside after() before the function is frozen', async () => {
    let finished = false;
    hoisted.pushDraftClaims.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
      return 1;
    });
    await dispatchDraftNotifications([{ type: 'turn_started', ...turn }]);
    expect(finished).toBe(true);
  });

  it('a push failure never breaks the dispatch: it is caught and logged, the Discord event already went out', async () => {
    hoisted.pushDraftClaims.mockRejectedValue(new Error('push exploded'));
    const sent = await dispatchDraftNotifications([{ type: 'turn_started', ...turn }]);
    expect(sent).toBe(1);
    expect(hoisted.emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('no claims: nothing to Discord, nothing to push', async () => {
    expect(await dispatchDraftNotifications([])).toBe(0);
    expect(hoisted.emitDiscordEvent).not.toHaveBeenCalled();
    expect(hoisted.pushDraftClaims).not.toHaveBeenCalled();
  });

  it('a malformed claim is skipped for both channels', async () => {
    await dispatchDraftNotifications([{ type: 'turn_started', pool_id: 'pool-1' }, { type: 'turn_started', ...turn }]);
    expect(hoisted.emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(hoisted.pushDraftClaims.mock.calls[0][0]).toHaveLength(1);
  });
});
