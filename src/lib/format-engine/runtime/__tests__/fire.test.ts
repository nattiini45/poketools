import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, stateFor, wichtelDef } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/effects', () => ({ eventNeedsRows: vi.fn(() => false), planEffects: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageRows: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  fireFormatEvent: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { expireSeasonReads } from '@/lib/revalidation';
import { logger } from '@/lib/logger';
import { fireFormatEvent, FormatRuntimeError } from '@/lib/supabase/queries/format-runtime';
import { eventNeedsRows, planEffects } from '../effects';
import { fireEvent, fireLockedActionEvents, pendingLockEvents } from '../fire';
import { loadFreshKitContext, type KitContext } from '../load';
import { loadStageRows } from '../stage-table';
import type { KitRuntimeState } from '../types';

const SEASON = 's-1';

function context(patch: Partial<KitRuntimeState> = {}): KitContext {
  const def = wichtelDef();
  return {
    seasonId: SEASON,
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def, patch),
    tunableIssues: [],
    phases: [{ id: 't-1', stage: def.stages[0], members: PLAYERS }],
  };
}

const plan = (ops: unknown[] = []) => ({ ops, notifications: [], issues: [] });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(planEffects).mockReturnValue(plan() as never);
  vi.mocked(fireFormatEvent).mockResolvedValue(true);
});

describe('the rows of an event', () => {
  it('loads every group of the stage through loadStageRows when a target reads them', async () => {
    vi.mocked(eventNeedsRows).mockReturnValue(true);
    const rows = { a: { points: 3 } };
    vi.mocked(loadStageRows).mockResolvedValue(rows as never);
    await fireEvent(SEASON, { event: 'stage_end', stage: 'swiss' }, null, { context: context() });
    expect(loadStageRows).toHaveBeenCalledWith(expect.objectContaining({ seasonId: SEASON }), 'swiss');
    expect(vi.mocked(planEffects).mock.calls[0][5]).toEqual({ rows });
  });

  it('loads no rows when no target reads them', async () => {
    vi.mocked(eventNeedsRows).mockReturnValue(false);
    await fireEvent(SEASON, { event: 'stage_end', stage: 'swiss' }, null, { context: context() });
    expect(loadStageRows).not.toHaveBeenCalled();
    expect(vi.mocked(planEffects).mock.calls[0][5]).toEqual({ rows: undefined });
  });
});

describe('the notices of an event', () => {
  const notice = { message: { base: 'en', en: { v: 'Hi', s: 'human' } }, players: ['p1'], rule: 'r', effect: 0 };

  it('go to the database with the event, in one call', async () => {
    vi.mocked(planEffects).mockReturnValueOnce({ ...plan(), notifications: [notice] } as never);
    await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: context() });
    expect(fireFormatEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fireFormatEvent).mock.calls[0][0].notifications).toEqual([notice]);
  });

  it('are not planned or sent for an event that already fired (a retry or a heal)', async () => {
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, {
      context: context({ firedEventKeys: ['stage_start:swiss'] }),
    });
    expect(result?.fired).toBe(false);
    expect(planEffects).not.toHaveBeenCalled();
    expect(fireFormatEvent).not.toHaveBeenCalled();
  });
});

describe('the revision of the format', () => {
  it('hands the revision of the context the ops were planned from to the database, for the event and for its cascade', async () => {
    vi.mocked(planEffects).mockReturnValueOnce(plan([{ op: 'lock_action', action: 'give_gifts' }]) as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...context({ flags: { 'action:give_gifts': 'locked' } }), revision: 12 });
    await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: { ...context(), revision: 11 } });
    // The cascade plans from a context it loads itself, so it carries that one.
    expect(vi.mocked(fireFormatEvent).mock.calls.map((call) => [call[0].eventKey, call[0].revision])).toEqual([
      ['stage_start:swiss', 11],
      ['action_locked:give_gifts', 12],
    ]);
  });

  it('lets format_context_stale leave as it is: nothing is cascaded, reloaded or expired, and the caller retries later', async () => {
    const stale = new FormatRuntimeError('format_context_stale');
    vi.mocked(fireFormatEvent).mockRejectedValue(stale);
    vi.mocked(planEffects).mockReturnValue(plan([{ op: 'lock_action', action: 'give_gifts' }]) as never);
    await expect(fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: context() })).rejects.toBe(stale);
    expect(fireFormatEvent).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('pendingLockEvents', () => {
  it('lists the locked actions whose action_locked event has not fired', () => {
    expect(pendingLockEvents(context({ flags: { 'action:give_gifts': 'locked' } }))).toEqual(['give_gifts']);
    expect(pendingLockEvents(context({ flags: { 'action:give_gifts': 'locked' }, firedEventKeys: ['action_locked:give_gifts'] }))).toEqual([]);
    expect(pendingLockEvents(context({ flags: { 'action:give_gifts': 'open' } }))).toEqual([]);
    expect(pendingLockEvents(context())).toEqual([]);
  });
});

describe('the lock cascade', () => {
  it('fires action_locked right after an event whose ops locked the action', async () => {
    vi.mocked(planEffects).mockReturnValueOnce(plan([{ op: 'lock_action', action: 'give_gifts' }]) as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ flags: { 'action:give_gifts': 'locked' } }));
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: context() });
    expect(result?.cascaded).toEqual(['action_locked:give_gifts']);
    expect(vi.mocked(fireFormatEvent).mock.calls.map((call) => call[0].eventKey)).toEqual(['stage_start:swiss', 'action_locked:give_gifts']);
  });

  it('fires no action_locked for a lock the format the cascade reads does not have (a format replaced meanwhile)', async () => {
    vi.mocked(planEffects).mockReturnValueOnce(plan([{ op: 'lock_action', action: 'give_gifts' }]) as never);
    // The league holds another format now: its flag for the action is not locked, so no key is burnt there.
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...context(), revision: 12 });
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: context() });
    expect(result).toMatchObject({ fired: true, cascaded: [] });
    expect(vi.mocked(fireFormatEvent).mock.calls.map((call) => call[0].eventKey)).toEqual(['stage_start:swiss']);
  });

  it('does not fail an event that committed when its cascade cannot run: it is logged and the cron pass fires it', async () => {
    vi.mocked(planEffects).mockReturnValueOnce(plan([{ op: 'lock_action', action: 'give_gifts' }]) as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ flags: { 'action:give_gifts': 'locked' } }));
    vi.mocked(fireFormatEvent).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('second transaction down'));
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: context() });
    expect(result).toMatchObject({ fired: true, cascaded: [] });
    expect(logger.error).toHaveBeenCalledWith('format-engine/fire', expect.stringContaining('lock cascade'), expect.objectContaining({ eventKey: 'stage_start:swiss' }));
    expect(expireSeasonReads).toHaveBeenCalled();
  });

  it('loses the cascade when the process stops after the first transaction, and a retry of the event repairs it', async () => {
    // The first transaction committed (the key is in the log, the flag is locked) but action_locked never fired.
    const committed = context({ firedEventKeys: ['stage_start:swiss'], flags: { 'action:give_gifts': 'locked' } });
    vi.mocked(loadFreshKitContext).mockResolvedValue(committed);
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: committed });
    expect(result).toMatchObject({ fired: false, cascaded: ['action_locked:give_gifts'] });
    expect(vi.mocked(fireFormatEvent).mock.calls.map((call) => call[0].eventKey)).toEqual(['action_locked:give_gifts']);
  });

  it('does nothing for an event that fired when no lock is pending', async () => {
    const committed = context({ firedEventKeys: ['stage_start:swiss'], flags: { 'action:give_gifts': 'locked' }, });
    committed.state.firedEventKeys.push('action_locked:give_gifts');
    const result = await fireEvent(SEASON, { event: 'stage_start', stage: 'swiss' }, null, { context: committed });
    expect(result).toMatchObject({ fired: false, cascaded: [] });
    expect(fireFormatEvent).not.toHaveBeenCalled();
  });

  it('fireLockedActionEvents fires the pending events of a manual lock', async () => {
    const locked = context({ flags: { 'action:give_gifts': 'locked' } });
    vi.mocked(loadFreshKitContext).mockResolvedValue(locked);
    await expect(fireLockedActionEvents(SEASON, 'admin-1')).resolves.toEqual(['action_locked:give_gifts']);
    expect(fireFormatEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'action_locked:give_gifts', firedBy: 'admin-1' }));
  });

  it('returns nothing for a league without a kit format', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(fireLockedActionEvents(SEASON, null)).resolves.toEqual([]);
  });

  it('fires through the context it decided from: the revision of the first fire is the one of the context passed in', async () => {
    // A format replaced after the context was loaded makes the database refuse the fire (stale), instead of a fresh load
    // quietly planning the event for the new format and burning its key there.
    const locked = { ...context({ flags: { 'action:give_gifts': 'locked' } }), revision: 4 };
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...locked, revision: 9 });
    await fireLockedActionEvents(SEASON, null, { context: locked });
    expect(fireFormatEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'action_locked:give_gifts', revision: 4 }));
  });
});
