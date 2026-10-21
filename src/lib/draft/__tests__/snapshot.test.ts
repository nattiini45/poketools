/**
 * `getDraftSnapshot` / `toDraftSnapshotDTO` / `toMyTurnDTO` (draft-backend §7.9,
 * §10.1, §14.1; B-SNAP). No DB: `callDraftRpc` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/draft/rpc-errors', () => ({ callDraftRpc: vi.fn() }));

import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { getDraftSnapshot, toDraftSnapshotDTO, toMyTurnDTO } from '@/lib/draft/snapshot';
import { LEAGUE_TIME_ZONE } from '@/i18n/config';

type Raw = Record<string, unknown>;

/** A raw `draft_snapshot` payload as M5's `draft__build_snapshot` shapes it (initial pool, live, p1 on the clock). */
function rawSnapshot(overrides: Raw = {}): Raw {
  return {
    state_version: 7,
    server_now: '2026-10-11T12:00:00Z',
    pool: {
      id: 'pool-1',
      season_id: 'season-1',
      kind: 'initial',
      mode: 'live',
      status: 'in_progress',
      paused: false,
      paused_at: null,
      roster_size: 3,
      budget: 30,
      started_at: '2026-10-11T11:00:00Z',
      ended_at: null,
      phase: 'drafting',
      pause_reason: null,
      list_version_id: 'list-1',
      engine: 'queue',
    },
    config: {
      pick_seconds: 300,
      makeup_seconds: 150,
      slow_ladder_seconds: [43200, 21600],
      extension_seconds: [120, 60],
      redraft_max_lines: 3,
      extensions_enabled: true,
      redraft_lock_no_redraft_lines: true,
      submission_deadline_at: null,
      token_purchase_closes_at: null,
    },
    participants: [
      {
        player_id: 'p1', name: 'Ash', avatar_url: null, seat: 1, standing_rank: null, slots_total: 3,
        picks_made: 0, open_slots: 3, budget_start: 50, budget_remaining: 50, penalty_stage: 0, timeout_count: 0,
        extensions: { plus120_used: false, plus60_used: true }, done: false,
        discord_id: 'discord-SECRET-111',
      },
      {
        player_id: 'p2', name: 'Misty', avatar_url: 'https://x/a.webp', seat: 2, standing_rank: 4, slots_total: 3,
        picks_made: 1, open_slots: 2, budget_start: 69, budget_remaining: 49, penalty_stage: 1, timeout_count: 1,
        extensions: { plus120_used: true, plus60_used: false }, done: false,
      },
    ],
    active_slot: {
      slot_id: 'slot-2', player_id: 'p1', round: 1, pick_number: 2, kind: 'normal', status: 'active',
      duration_ms: 300000, extensions_applied_ms: 0, started_at: '2026-10-11T11:59:00Z',
      deadline_at: '2026-10-11T12:04:00Z', remaining_ms_at_pause: null, sort_key: 2,
    },
    upcoming: [{ slot_id: 'slot-3', player_id: 'p2', pick_number: 3, round: 2, kind: 'makeup', duration_ms: 150000, sort_key: 3 }],
    picks: [
      {
        pick_id: 'pick-1', slot_id: 'slot-1', pick_number: 1, round: 1, player_id: 'p2', line_id: 'cc--dd',
        entry_id: 'e-cc', price: 20, made_at: '2026-10-11T11:58:00Z', admin_override: false, redraft_slot_id: null,
      },
    ],
    taken: { 'cc--dd': 'p2' },
    prices: { 'aa--bb': 10, 'cc--dd': 20, 'ee--ff': 12, 'gg--hh': 40, 'ii--jj': 9, 'kk--ll': 8 },
    restrictions: [
      { player_id: 'p1', line_id: 'ii--jj', reason: 'admin' },
      { player_id: 'p2', line_id: 'ee--ff', reason: 'admin' },
    ],
    no_redraft_line_ids: [],
    redraft: null,
    recent_events: [
      { at: '2026-10-11T11:58:00Z', action: 'pick_confirmed', actor_role: 'player', player_id: 'p2', line_id: 'cc--dd', slot_id: 'slot-1' },
      { at: '2026-10-11T11:57:00Z', action: 'submission_changed', actor_role: 'player', player_id: 'p2', line_id: null, slot_id: null },
    ],
    published_now: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(callDraftRpc).mockReset();
});

describe('getDraftSnapshot', () => {
  it('{ tick: false } passes p_tick: false and never reports a publish', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue(rawSnapshot({ published_now: true }));
    const result = await getDraftSnapshot('pool-1', null, { tick: false });

    expect(callDraftRpc).toHaveBeenCalledWith('draft_snapshot', { p_pool_id: 'pool-1', p_since: null, p_tick: false });
    expect(result.publishedNow).toBe(false);
    expect(result.seasonId).toBe('season-1');
  });

  it('ticks by default and surfaces published_now beside the DTO', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue(rawSnapshot({ published_now: true }));
    const result = await getDraftSnapshot('pool-1', { playerId: 'p1', isPoolAdmin: false }, { since: 3 });

    expect(callDraftRpc).toHaveBeenCalledWith('draft_snapshot', { p_pool_id: 'pool-1', p_since: 3, p_tick: true });
    expect(result.publishedNow).toBe(true);
    expect(result.dto).not.toHaveProperty('published_now');
  });

  it('passes an unchanged answer through', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({
      unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z', published_now: false,
    });
    const result = await getDraftSnapshot('pool-1', null, { since: 7 });
    expect(result).toEqual({
      dto: { unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z' },
      publishedNow: false,
      timeoutsResolved: 0,
      seasonId: null,
    });
  });

  it('surfaces timeouts_resolved beside the DTO, never inside', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue(rawSnapshot({ published_now: false, timeouts_resolved: 2 }));
    const result = await getDraftSnapshot('pool-1', { playerId: 'p1', isPoolAdmin: false });
    expect(result.timeoutsResolved).toBe(2);
    expect(result.dto).not.toHaveProperty('timeouts_resolved');
    expect(JSON.stringify(result.dto)).not.toContain('timeouts_resolved');

    vi.mocked(callDraftRpc).mockResolvedValue({
      unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z', published_now: false, timeouts_resolved: 1,
    });
    const unchanged = await getDraftSnapshot('pool-1', null, { since: 7 });
    expect(unchanged.timeoutsResolved).toBe(1);
    expect(unchanged.dto).toEqual({ unchanged: true, state_version: 7, server_now: '2026-10-11T12:00:00Z' });
  });

  it('{ tick: false } never reports resolved timeouts; junk counts read as 0', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue(rawSnapshot({ timeouts_resolved: 3 }));
    expect((await getDraftSnapshot('pool-1', null, { tick: false })).timeoutsResolved).toBe(0);
    vi.mocked(callDraftRpc).mockResolvedValue(rawSnapshot({ timeouts_resolved: '3' }));
    expect((await getDraftSnapshot('pool-1', null)).timeoutsResolved).toBe(0);
  });
});

describe('toDraftSnapshotDTO', () => {
  it('copies allowlisted fields only and drops raw-only keys', () => {
    const dto = toDraftSnapshotDTO(rawSnapshot({ secret_column: 'x' }), { playerId: 'p1', isPoolAdmin: false });
    const json = JSON.stringify(dto);

    for (const key of ['secret_column', 'prices', 'restrictions', 'no_redraft_line_ids', 'sort_key', 'engine',
      'extensions_enabled', 'redraft_lock_no_redraft_lines', 'submission_deadline_at', 'token_purchase_closes_at',
      'published_now', 'discord_id']) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(json).not.toContain('discord-SECRET-111');
    expect(Object.keys(dto.participants[0]).sort()).toEqual([
      'avatar_url', 'budget_remaining', 'budget_start', 'done', 'extensions', 'name', 'open_slots', 'penalty_stage',
      'picks_made', 'player_id', 'seat', 'slots_total', 'standing_rank', 'timeout_count',
    ]);
    expect(dto.pool.league_time_zone).toBe(LEAGUE_TIME_ZONE);
    expect(dto.config).toEqual({
      pick_seconds: 300, makeup_seconds: 150, slow_ladder_seconds: [43200, 21600], extension_seconds: [120, 60],
      redraft_max_lines: 3, quiet_hours: null,
    });
    expect(dto.upcoming).toEqual([{ slot_id: 'slot-3', player_id: 'p2', pick_number: 3, round: 2, kind: 'makeup', duration_ms: 150000 }]);
    expect(dto.recent_events.map((e) => e.action)).toEqual(['pick_confirmed']);
  });

  it('builds the viewer block with the draftability evaluator', () => {
    const dto = toDraftSnapshotDTO(rawSnapshot(), { playerId: 'p1', isPoolAdmin: false });

    expect(dto.viewer).toMatchObject({ player_id: 'p1', is_participant: true, is_pool_admin: false, pick_block: null });
    expect(dto.viewer.restricted_line_ids).toEqual(['ii--jj']);
    expect(dto.viewer.line_status['cc--dd']).toEqual({ code: 'LINE_TAKEN', params: { player_id: 'p2' } });
    expect(dto.viewer.line_status['ii--jj']).toEqual({ code: 'LINE_RESTRICTED' });
    // 50 left, 3 open slots: 40 leaves 10 for two more lines (cheapest other legal 8 + 10) → 8 short.
    expect(dto.viewer.line_status['gg--hh']).toEqual({ code: 'BUDGET_INFEASIBLE', params: { shortfall: 8, slots: 2 } });
    expect(dto.viewer.line_status['aa--bb']).toBeUndefined();
    expect(dto.viewer).not.toHaveProperty('active_player_line_status');
  });

  it('greys lines through the pool gate with every participant’s open slots and budget', () => {
    // Misty (2 open slots, 12 left) needs two lines; the cheapest she may take are 8 + 9 = 17 > 12 (ee--ff is
    // restricted for her), so the pool cannot complete whatever Ash takes.
    const raw = rawSnapshot();
    const participants = (raw.participants as Raw[]).map((p) =>
      p.player_id === 'p2' ? { ...p, budget_start: 32, budget_remaining: 12 } : p,
    );
    const dto = toDraftSnapshotDTO({ ...raw, participants }, { playerId: 'p1', isPoolAdmin: false });
    expect(dto.viewer.line_status['aa--bb']).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
    expect(dto.viewer.line_status['kk--ll']).toEqual({ code: 'POOL_NOT_COMPLETABLE' });
    // Picker-level reasons still come first.
    expect(dto.viewer.line_status['gg--hh']).toEqual({ code: 'BUDGET_INFEASIBLE', params: { shortfall: 8, slots: 2 } });
  });

  it('gives a pool admin the active player line status', () => {
    const asAdmin = toDraftSnapshotDTO(rawSnapshot(), { playerId: 'admin-1', isPoolAdmin: true });
    expect(asAdmin.viewer.is_participant).toBe(false);
    expect(asAdmin.viewer.pick_block).toEqual({ code: 'NOT_PARTICIPANT' });
    expect(asAdmin.viewer.active_player_line_status?.['ii--jj']).toEqual({ code: 'LINE_RESTRICTED' });
    expect(asAdmin.viewer.restricted_line_ids).toEqual([]);
  });

  it('a signed-out or waiting viewer gets the viewer-level block', () => {
    expect(toDraftSnapshotDTO(rawSnapshot(), null).viewer).toMatchObject({
      player_id: null, is_participant: false, pick_block: { code: 'SIGNED_OUT' }, restricted_line_ids: [],
    });
    expect(toDraftSnapshotDTO(rawSnapshot(), { playerId: 'p2', isPoolAdmin: false }).viewer.pick_block).toEqual({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('keeps redraft drops and slots secret before publish', () => {
    const dto = toDraftSnapshotDTO(
      rawSnapshot({
        pool: { ...(rawSnapshot().pool as Raw), kind: 'redraft', phase: 'submissions' },
        redraft: {
          phase: 'submissions', deadline_at: '2026-10-18T21:59:59Z', published_at: null,
          // A raw payload that (wrongly) carries pre-publish data must not leak it.
          drops: [{ player_id: 'p2', line_id: 'cc--dd', transferred_real_kills: 3 }],
          all_slots: [{ redraft_slot_id: 'rs-1', player_id: 'p1', label: 'A', dropped_line_id: 'aa--bb', transferred_real_kills: 1, filled_by_pick_id: null }],
          submissions: [{ player_id: 'p2', line_ids: ['cc--dd'] }],
        },
      }),
      { playerId: 'p1', isPoolAdmin: false },
    );
    expect(dto.redraft).toEqual({ phase: 'submissions', deadline_at: '2026-10-18T21:59:59Z', published_at: null, drops: null, viewer_slots: [] });
    const json = JSON.stringify(dto);
    expect(json).not.toContain('"submissions":');
    expect(json).not.toContain('"line_ids"');
    expect(json).not.toContain('rs-1');
  });

  it('after publish lists every drop but only the viewer\'s own slots', () => {
    const dto = toDraftSnapshotDTO(
      rawSnapshot({
        pool: { ...(rawSnapshot().pool as Raw), kind: 'redraft' },
        redraft: {
          phase: 'drafting', deadline_at: '2026-10-18T21:59:59Z', published_at: '2026-10-18T22:00:00Z',
          drops: [
            { player_id: 'p1', line_id: 'aa--bb', transferred_real_kills: 1 },
            { player_id: 'p2', line_id: 'gg--hh', transferred_real_kills: 0 },
          ],
          all_slots: [
            { redraft_slot_id: 'rs-1', player_id: 'p1', label: 'A', dropped_line_id: 'aa--bb', transferred_real_kills: 1, filled_by_pick_id: null },
            { redraft_slot_id: 'rs-2', player_id: 'p2', label: 'A', dropped_line_id: 'gg--hh', transferred_real_kills: 0, filled_by_pick_id: null },
          ],
        },
      }),
      { playerId: 'p1', isPoolAdmin: false },
    );
    expect(dto.redraft?.drops).toHaveLength(2);
    expect(dto.redraft?.viewer_slots).toEqual([
      { redraft_slot_id: 'rs-1', label: 'A', dropped_line_id: 'aa--bb', transferred_real_kills: 1, filled_by_pick_id: null },
    ]);
    expect(JSON.stringify(dto)).not.toContain('rs-2');
    // p1 has an open redraft slot, so the redraft does not block the pick.
    expect(dto.viewer.pick_block).toBeNull();
  });

  describe('admin_slots (pool admins only, after publish)', () => {
    const slots = [
      { redraft_slot_id: 'rs-1', player_id: 'p1', label: 'A', dropped_line_id: 'aa--bb', transferred_real_kills: 1, filled_by_pick_id: null },
      { redraft_slot_id: 'rs-2', player_id: 'p2', label: 'A', dropped_line_id: 'gg--hh', transferred_real_kills: 0, filled_by_pick_id: 'pk-9' },
    ];
    const redraftRaw = (publishedAt: string | null): Raw =>
      rawSnapshot({
        pool: { ...(rawSnapshot().pool as Raw), kind: 'redraft', phase: publishedAt ? 'drafting' : 'submissions' },
        redraft: {
          phase: publishedAt ? 'drafting' : 'submissions',
          deadline_at: '2026-10-18T21:59:59Z',
          published_at: publishedAt,
          drops: [],
          all_slots: slots,
        },
      });

    it('an admin after publish gets every slot with its ids', () => {
      const dto = toDraftSnapshotDTO(redraftRaw('2026-10-18T22:00:00Z'), { playerId: 'admin-1', isPoolAdmin: true });
      expect(dto.redraft?.admin_slots).toEqual(slots);
      expect(dto.redraft?.viewer_slots).toEqual([]);
    });

    it('a non-admin viewer after publish gets no admin_slots', () => {
      const dto = toDraftSnapshotDTO(redraftRaw('2026-10-18T22:00:00Z'), { playerId: 'p1', isPoolAdmin: false });
      expect(dto.redraft).not.toHaveProperty('admin_slots');
      expect(JSON.stringify(dto)).not.toContain('rs-2');
    });

    it('an admin before publish gets no admin_slots', () => {
      const dto = toDraftSnapshotDTO(redraftRaw(null), { playerId: 'admin-1', isPoolAdmin: true });
      expect(dto.redraft).not.toHaveProperty('admin_slots');
      const json = JSON.stringify(dto);
      expect(json).not.toContain('rs-1');
      expect(json).not.toContain('rs-2');
    });

    it('an anonymous viewer after publish gets no admin_slots', () => {
      const dto = toDraftSnapshotDTO(redraftRaw('2026-10-18T22:00:00Z'), null);
      expect(dto.redraft).not.toHaveProperty('admin_slots');
      expect(dto.redraft?.viewer_slots).toEqual([]);
      const json = JSON.stringify(dto);
      expect(json).not.toContain('rs-1');
      expect(json).not.toContain('rs-2');
    });
  });

  describe('publish_refused_at (never mapped; admins read it through draft-publish-refusals.ts)', () => {
    const refusedRaw = (refusedAt: string | null): Raw =>
      rawSnapshot({
        pool: { ...(rawSnapshot().pool as Raw), kind: 'redraft', phase: 'submissions' },
        redraft: {
          phase: 'locked',
          deadline_at: '2026-10-18T21:59:59Z',
          published_at: null,
          publish_refused_at: refusedAt,
          drops: null,
          all_slots: [],
        },
      });

    it('no viewer gets the refusal instant from the snapshot, not even a pool admin', () => {
      for (const viewer of [{ playerId: 'admin-1', isPoolAdmin: true }, { playerId: 'p1', isPoolAdmin: false }, null]) {
        const dto = toDraftSnapshotDTO(refusedRaw('2026-10-18T22:00:05Z'), viewer);
        expect(dto.redraft).not.toHaveProperty('admin_publish_refused_at');
        expect(dto.redraft).not.toHaveProperty('publish_refused_at');
        expect(JSON.stringify(dto)).not.toContain('2026-10-18T22:00:05Z');
      }
    });
  });

  it('rejects a payload without pool or state_version', () => {
    expect(() => toDraftSnapshotDTO({ state_version: 1 }, null)).toThrow();
    expect(() => toDraftSnapshotDTO(null, null)).toThrow();
  });
});

describe('toMyTurnDTO', () => {
  it('strips published_now into its own field and drops unknown keys', () => {
    const { dto, publishedNow, timeoutsResolved } = toMyTurnDTO({
      state_version: 4, server_now: '2026-10-11T12:00:00Z', status: 'in_progress', mode: 'slow', paused: false,
      on_clock: true, up_next: false, slot_id: 'slot-1', deadline_at: '2026-10-11T20:00:00Z',
      remaining_ms_at_pause: null, league_name: 'EvoLiga', published_now: true, timeouts_resolved: 1, extra: 'x',
    });
    expect(publishedNow).toBe(true);
    expect(timeoutsResolved).toBe(1);
    expect(dto).toEqual({
      state_version: 4, server_now: '2026-10-11T12:00:00Z', status: 'in_progress', mode: 'slow', paused: false,
      on_clock: true, up_next: false, slot_id: 'slot-1', deadline_at: '2026-10-11T20:00:00Z',
      remaining_ms_at_pause: null, league_name: 'EvoLiga', quiet_hours: null,
    });
  });

  it('maps quiet_hours to the shared QuietHours shape', () => {
    const { dto } = toMyTurnDTO({
      state_version: 4, server_now: '2026-10-11T12:00:00Z', status: 'in_progress', mode: 'slow', paused: false,
      on_clock: true, up_next: false, slot_id: 'slot-1', deadline_at: '2026-10-11T20:00:00Z',
      remaining_ms_at_pause: null, league_name: 'EvoLiga',
      quiet_hours: { start_hour: 0, end_hour: 6, time_zone: 'Europe/Berlin' },
    });
    expect(dto.quiet_hours).toEqual({ startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' });
  });
});

describe('quiet_hours mapping', () => {
  const quiet = { start_hour: 0, end_hour: 6, time_zone: 'Europe/Berlin', extra: 'dropped' };

  it('copies the pool window into config, allowlisted', () => {
    const raw = rawSnapshot();
    const dto = toDraftSnapshotDTO({ ...raw, config: { ...(raw.config as Raw), quiet_hours: quiet } }, null);
    expect(dto.config.quiet_hours).toEqual({ startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' });
  });

  it('maps JSON null (no quiet hours) to null', () => {
    const raw = rawSnapshot();
    const dto = toDraftSnapshotDTO({ ...raw, config: { ...(raw.config as Raw), quiet_hours: null } }, null);
    expect(dto.config.quiet_hours).toBeNull();
  });

  it.each([
    ['a string', 'nightly'],
    ['missing time zone', { start_hour: 0, end_hour: 6 }],
    ['string hours', { start_hour: '0', end_hour: 6, time_zone: 'UTC' }],
    ['an empty window', { start_hour: 6, end_hour: 6, time_zone: 'UTC' }],
    ['a whole-day window', { start_hour: 0, end_hour: 24, time_zone: 'UTC' }],
  ])('refuses a malformed window (%s) instead of showing a wall clock', (_name, bad) => {
    const raw = rawSnapshot();
    expect(() => toDraftSnapshotDTO({ ...raw, config: { ...(raw.config as Raw), quiet_hours: bad } }, null)).toThrow(
      /malformed quiet_hours/,
    );
  });
});
