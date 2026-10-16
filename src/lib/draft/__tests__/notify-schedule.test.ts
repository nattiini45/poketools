/**
 * `scheduleDraftNotifications` (package PINGS): one claim RPC for the pool inside `after()`, dispatched
 * fire-and-forget; never throws, neither when scheduling nor when the claim fails. Live turn starts are
 * dispatched like slow ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  after: vi.fn(),
  callDraftRpc: vi.fn(),
}));

vi.mock('next/server', () => ({ after: hoisted.after }));
vi.mock('@/lib/draft/rpc-errors', () => ({ callDraftRpc: hoisted.callDraftRpc }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayersByIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts-queue', () => ({ listTickablePools: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts-redraft', () => ({ getPublishedDrops: vi.fn() }));

import { scheduleDraftNotifications } from '../notify';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getSeasonById } from '@/lib/supabase/queries/seasons';

const liveTurn = {
  type: 'turn_started', pool_id: 'pool-1', season_id: 'season-1', slot_id: 'slot-1', player_id: 'p1',
  deadline_at: '2026-10-12T12:02:00+00:00', timer_seconds: 120, round: 1, pick_number: 1, kind: 'normal', mode: 'live',
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.afterCallbacks = [];
  hoisted.after.mockImplementation((cb: () => Promise<void>) => {
    hoisted.afterCallbacks.push(cb);
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(getSeasonById).mockResolvedValue({ id: 'season-1', name: 'EvoLiga S1' } as never);
  vi.mocked(getPlayersByIds).mockResolvedValue(new Map([['p1', { id: 'p1', name: 'Misty', discord_id: 'disc-misty' }]]) as never);
});

describe('scheduleDraftNotifications', () => {
  it('claims the pool after the response and dispatches a live turn start with its mode and pick time', async () => {
    hoisted.callDraftRpc.mockResolvedValue([liveTurn]);
    scheduleDraftNotifications('pool-1');
    expect(hoisted.callDraftRpc).not.toHaveBeenCalled();
    expect(hoisted.afterCallbacks).toHaveLength(1);

    await hoisted.afterCallbacks[0]();
    expect(hoisted.callDraftRpc).toHaveBeenCalledWith('draft_claim_notifications', { p_pool_id: 'pool-1' });
    expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitDiscordEvent).mock.calls[0][0]).toMatchObject({
      event_type: 'draft_turn_started',
      data: { kind: 'draft_turn', mode: 'live', timer_seconds: 120, player_discord_id: 'disc-misty' },
    });
  });

  it('a failed claim is logged, never thrown', async () => {
    hoisted.callDraftRpc.mockRejectedValue(new Error('db down'));
    scheduleDraftNotifications('pool-1');
    await expect(hoisted.afterCallbacks[0]()).resolves.toBeUndefined();
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('after() outside a request scope is logged, never thrown', () => {
    hoisted.after.mockImplementation(() => {
      throw new Error('outside request scope');
    });
    expect(() => scheduleDraftNotifications('pool-1')).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
