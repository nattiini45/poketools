/**
 * Draft notification dispatch (B-CRON, draft-backend §6.7, §7.9, §11.3):
 * claims → language-neutral Discord payloads, each fired once with `void`.
 * The Supabase client is a chainable fake; no database is reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
const hoisted = vi.hoisted(() => ({
  tables: {} as Record<string, Result>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    const result = () => hoisted.tables[table] ?? { data: [], error: null };
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      b[method] = (...args: unknown[]) => {
        hoisted.calls.push({ table, method, args });
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result());
    b.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayersByIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));

import { dispatchDraftNotifications, listTickablePools, parseNotificationClaims } from '../notify';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getSeasonById } from '@/lib/supabase/queries/seasons';

const SEASON = 'season-1';
const POOL = 'pool-1';

const turnClaim = {
  type: 'turn_started', pool_id: POOL, season_id: SEASON, slot_id: 'slot-1', player_id: 'p1',
  deadline_at: '2026-10-11T21:59:59+00:00', timer_seconds: 43200, round: 2, pick_number: 9, kind: 'normal', mode: 'slow',
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.tables = {};
  hoisted.calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON, name: 'EvoLiga S1' } as never);
  vi.mocked(getPlayersByIds).mockResolvedValue(
    new Map([
      ['p1', { id: 'p1', name: 'Misty', discord_id: 'disc-misty' }],
      ['p2', { id: 'p2', name: 'Brock', discord_id: null }],
      ['p3', { id: 'p3', name: 'Ash', discord_id: 'disc-ash' }],
    ]) as never,
  );
});

describe('parseNotificationClaims', () => {
  it('keeps well-formed claims and skips malformed ones', () => {
    const claims = parseNotificationClaims([
      turnClaim,
      { ...turnClaim, type: 'turn_reminder', threshold: '1h' },
      { ...turnClaim, type: 'turn_reminder', threshold: '2h' },
      { type: 'admin_alert', alert_kind: 'blocked', pool_id: POOL, season_id: SEASON, slot_id: 's', player_id: 'p2' },
      { type: 'redraft_published', pool_id: POOL, season_id: SEASON },
      { type: 'something_else' },
      null,
    ]);
    expect(claims.map((c) => c.type)).toEqual(['turn_started', 'turn_reminder', 'admin_alert', 'redraft_published']);
    expect(parseNotificationClaims(null)).toEqual([]);
  });
});

describe('dispatchDraftNotifications', () => {
  it('turn start → draft_turn_started with the player ping, season-scoped, fired with void', async () => {
    await expect(dispatchDraftNotifications([turnClaim])).resolves.toBe(1);
    expect(emitDiscordEvent).toHaveBeenCalledTimes(1);
    expect(emitDiscordEvent).toHaveBeenCalledWith({
      event_type: 'draft_turn_started',
      tournament_id: '',
      season_id: SEASON,
      data: {
        kind: 'draft_turn', season_name: 'EvoLiga S1', player_name: 'Misty', player_discord_id: 'disc-misty',
        deadline_at: '2026-10-11T21:59:59+00:00', timer_seconds: 43200, mode: 'slow', round: 2, pick_number: 9,
        is_makeup: false,
      },
    });
    // Payloads are language-neutral (§11.3).
    expect(JSON.stringify(vi.mocked(emitDiscordEvent).mock.calls[0][0])).not.toMatch(/locale|lang/);
  });

  it('reminder and admin alert map to their events; the alert carries no Discord id', async () => {
    await dispatchDraftNotifications([
      { ...turnClaim, type: 'turn_reminder', threshold: '8h', kind: 'makeup' },
      { type: 'admin_alert', alert_kind: 'inplace_timeout', pool_id: POOL, season_id: SEASON, slot_id: 's', player_id: 'p2' },
    ]);
    const [reminder, alert] = vi.mocked(emitDiscordEvent).mock.calls.map(([p]) => p);
    expect(reminder.event_type).toBe('draft_turn_reminder');
    expect(reminder.data).toMatchObject({ kind: 'draft_turn_reminder', threshold: '8h', is_makeup: true });
    expect(alert).toEqual({
      event_type: 'draft_slot_blocked',
      tournament_id: '',
      season_id: SEASON,
      data: { kind: 'draft_admin_alert', season_name: 'EvoLiga S1', player_name: 'Brock', alert_kind: 'inplace_timeout' },
    });
    // One player read and one season read for the whole batch.
    expect(getPlayersByIds).toHaveBeenCalledTimes(1);
    expect(getSeasonById).toHaveBeenCalledTimes(1);
  });

  it('a player without a Discord id is not pinged', async () => {
    await dispatchDraftNotifications([{ ...turnClaim, player_id: 'p2' }]);
    expect(vi.mocked(emitDiscordEvent).mock.calls[0][0].data).toMatchObject({ player_name: 'Brock', player_discord_id: undefined });
  });

  it('redraft reveal reads the public drops with canonical English line names, sorted by player', async () => {
    hoisted.tables.redraft_slots = {
      data: [
        { player_id: 'p1', label: 'A', dropped_line_id: 'oshawott--samurotthisui', transferred_real_kills: 4 },
        { player_id: 'p3', label: 'A', dropped_line_id: 'teddiursa--ursalunabloodmoon', transferred_real_kills: 1 },
        { player_id: 'p3', label: 'B', dropped_line_id: 'gone--line', transferred_real_kills: 0 },
      ],
      error: null,
    };
    hoisted.tables.draft_pools = { data: { list_version_id: 'list-1' }, error: null };
    hoisted.tables.point_buy_list_entries = {
      data: [
        { line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott', stage3_pokemon: 'Samurott-Hisui' },
        { line_id: 'teddiursa--ursalunabloodmoon', base_pokemon: 'Teddiursa', stage3_pokemon: 'Ursaluna-Bloodmoon' },
      ],
      error: null,
    };

    await dispatchDraftNotifications([{ type: 'redraft_published', pool_id: POOL, season_id: SEASON }]);

    expect(emitDiscordEvent).toHaveBeenCalledWith({
      event_type: 'draft_redraft_published',
      tournament_id: '',
      season_id: SEASON,
      data: {
        kind: 'draft_redraft_published',
        season_name: 'EvoLiga S1',
        drops: [
          { player_name: 'Ash', base: 'Teddiursa', stage3: 'Ursaluna-Bloodmoon', transferred_real_kills: 1 },
          { player_name: 'Ash', base: 'gone', stage3: 'line', transferred_real_kills: 0 },
          { player_name: 'Misty', base: 'Oshawott', stage3: 'Samurott-Hisui', transferred_real_kills: 4 },
        ],
      },
    });
    expect(hoisted.calls).toContainEqual({ table: 'redraft_slots', method: 'eq', args: ['draft_pool_id', POOL] });
    expect(hoisted.calls).toContainEqual({ table: 'point_buy_list_entries', method: 'eq', args: ['list_version_id', 'list-1'] });
    // Never reads the secret submissions.
    expect(hoisted.calls.some((c) => c.table === 'redraft_submissions')).toBe(false);
  });

  it('no claims → no reads, nothing sent', async () => {
    await expect(dispatchDraftNotifications([])).resolves.toBe(0);
    expect(getPlayersByIds).not.toHaveBeenCalled();
    expect(emitDiscordEvent).not.toHaveBeenCalled();
  });

  it('never throws: a failed read is logged and nothing is sent', async () => {
    vi.mocked(getPlayersByIds).mockRejectedValue(new Error('down'));
    await expect(dispatchDraftNotifications([turnClaim])).resolves.toBe(0);
    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('listTickablePools', () => {
  it('selects open queue pools (submissions or drafting) up to the limit', async () => {
    hoisted.tables.draft_pools = { data: [{ id: POOL, season_id: SEASON }], error: null };
    await expect(listTickablePools(25)).resolves.toEqual([{ id: POOL, season_id: SEASON }]);
    expect(hoisted.calls).toContainEqual({ table: 'draft_pools', method: 'eq', args: ['engine', 'queue'] });
    expect(hoisted.calls).toContainEqual({ table: 'draft_pools', method: 'in', args: ['phase', ['submissions', 'drafting']] });
    expect(hoisted.calls).toContainEqual({ table: 'draft_pools', method: 'limit', args: [25] });
  });

  it('throws a read error', async () => {
    hoisted.tables.draft_pools = { data: null, error: new Error('boom') };
    await expect(listTickablePools(5)).rejects.toThrow('boom');
  });
});
