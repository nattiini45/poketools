import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  readPushConfig: vi.fn(),
  sendPushToPlayer: vi.fn(),
  sendPushToPlayers: vi.fn(),
  listPoolParticipantIds: vi.fn(),
}));

vi.mock('@/lib/push/config', () => ({ readPushConfig: hoisted.readPushConfig }));
vi.mock('@/lib/push/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push/send')>()),
  sendPushToPlayer: hoisted.sendPushToPlayer,
  sendPushToPlayers: hoisted.sendPushToPlayers,
}));
vi.mock('@/lib/supabase/queries/drafts-redraft', () => ({ listPoolParticipantIds: hoisted.listPoolParticipantIds }));

import { pushDraftClaims } from '../draft-alerts';
import type { NotificationClaim } from '@/lib/draft/notify';

const turn = {
  pool_id: 'pool-1',
  season_id: 'season-1',
  slot_id: 'slot-1',
  player_id: 'p1',
  deadline_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
  timer_seconds: 7200,
  round: 1,
  pick_number: 1,
  kind: 'normal' as const,
  mode: 'slow' as const,
};

const names = (id: string) => (id === 'season-1' ? 'EvoLiga' : '');

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readPushConfig.mockReturnValue({ publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.co' });
  hoisted.sendPushToPlayer.mockResolvedValue({ attempted: 1, delivered: 1, removed: 0, failed: 0 });
  hoisted.sendPushToPlayers.mockResolvedValue({ attempted: 2, delivered: 2, removed: 0, failed: 0 });
  hoisted.listPoolParticipantIds.mockResolvedValue(['p1', 'p2']);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('pushDraftClaims', () => {
  it('turn_started: one push to the slot player, high urgency, until the deadline, in each device language', async () => {
    const claims: NotificationClaim[] = [{ type: 'turn_started', ...turn }];
    expect(await pushDraftClaims(claims, names)).toBe(1);

    expect(hoisted.sendPushToPlayer).toHaveBeenCalledTimes(1);
    const [playerId, spec] = hoisted.sendPushToPlayer.mock.calls[0];
    expect(playerId).toBe('p1');
    expect(spec).toMatchObject({ urgency: 'high', topicKey: 'draft-pool-1' });
    expect(spec.ttlSeconds).toBeGreaterThan(2 * 3600 - 60);
    expect(spec.ttlSeconds).toBeLessThanOrEqual(2 * 3600);
    expect(spec.payloadFor('en')).toMatchObject({
      kind: 'turn_started',
      title: 'Your pick in EvoLiga',
      body: 'You are on the clock – 2 h left.',
      url: '/leagues/season-1/draft-room?pool=pool-1',
      tag: 'draft-pool-1',
    });
    expect(spec.payloadFor('de')).toMatchObject({ title: 'Dein Pick in EvoLiga', body: 'Du bist am Zug – noch 2 h.' });
  });

  it.each(['8h', '4h', '1h'] as const)('turn_reminder %s: one push to the slot player naming the threshold', async (threshold) => {
    await pushDraftClaims([{ type: 'turn_reminder', ...turn, threshold }], names);
    expect(hoisted.sendPushToPlayer).toHaveBeenCalledTimes(1);
    const [playerId, spec] = hoisted.sendPushToPlayer.mock.calls[0];
    expect(playerId).toBe('p1');
    expect(spec.urgency).toBe('high');
    expect(spec.payloadFor('en')).toMatchObject({
      kind: 'turn_reminder',
      body: `${threshold.replace('h', '')} h left for your pick.`,
    });
  });

  it('redraft_published: one push to every pool participant, normal urgency, 24 h', async () => {
    await pushDraftClaims([{ type: 'redraft_published', pool_id: 'pool-1', season_id: 'season-1' }], names);
    expect(hoisted.listPoolParticipantIds).toHaveBeenCalledWith('pool-1');
    expect(hoisted.sendPushToPlayers).toHaveBeenCalledTimes(1);
    const [ids, spec] = hoisted.sendPushToPlayers.mock.calls[0];
    expect(ids).toEqual(['p1', 'p2']);
    expect(spec).toMatchObject({ urgency: 'normal', ttlSeconds: 86_400 });
    expect(spec.payloadFor('en')).toMatchObject({ kind: 'redraft_published', title: 'Redraft published in EvoLiga' });
    expect(hoisted.sendPushToPlayer).not.toHaveBeenCalled();
  });

  it('admin_alert: no push (admins have Discord)', async () => {
    const claims: NotificationClaim[] = [
      { type: 'admin_alert', alert_kind: 'blocked', pool_id: 'pool-1', season_id: 'season-1', slot_id: 'slot-1', player_id: 'p1' },
    ];
    expect(await pushDraftClaims(claims, names)).toBe(0);
    expect(hoisted.sendPushToPlayer).not.toHaveBeenCalled();
    expect(hoisted.sendPushToPlayers).not.toHaveBeenCalled();
    expect(hoisted.listPoolParticipantIds).not.toHaveBeenCalled();
  });

  it('with push disabled does nothing at all, not even a read', async () => {
    hoisted.readPushConfig.mockReturnValue(null);
    const claims: NotificationClaim[] = [
      { type: 'turn_started', ...turn },
      { type: 'redraft_published', pool_id: 'pool-1', season_id: 'season-1' },
    ];
    expect(await pushDraftClaims(claims, names)).toBe(0);
    expect(hoisted.sendPushToPlayer).not.toHaveBeenCalled();
    expect(hoisted.listPoolParticipantIds).not.toHaveBeenCalled();
  });

  it('handles a mixed batch, one push per turn claim', async () => {
    const claims: NotificationClaim[] = [
      { type: 'turn_started', ...turn },
      { type: 'turn_started', ...turn, player_id: 'p2', slot_id: 'slot-2' },
      { type: 'admin_alert', alert_kind: 'inplace_timeout', pool_id: 'pool-1', season_id: 'season-1', slot_id: 'slot-1', player_id: 'p1' },
    ];
    expect(await pushDraftClaims(claims, names)).toBe(2);
    expect(hoisted.sendPushToPlayer.mock.calls.map((call) => call[0])).toEqual(['p1', 'p2']);
  });

  it('never throws: a failing participant read is logged and the other pushes still go out', async () => {
    hoisted.listPoolParticipantIds.mockRejectedValue(new Error('db down'));
    const claims: NotificationClaim[] = [
      { type: 'redraft_published', pool_id: 'pool-1', season_id: 'season-1' },
      { type: 'turn_started', ...turn },
    ];
    await expect(pushDraftClaims(claims, names)).resolves.toBe(2);
    expect(hoisted.sendPushToPlayer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
});
