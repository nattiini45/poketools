/**
 * Cache expiry of the format runtime's write orchestrators. The route walk of `src/lib/__tests__/write-route-tags.test.ts`
 * accepts a write handler that calls one of these orchestrators instead of an expiry helper, because each of them expires
 * the league's public reads itself. That is only sound while these tests hold: a write expires the reads once it
 * may have committed. A write the database refused (a refusal raised before it) or that failed without committing expires
 * nothing; a lock-time refusal (`FormatAdjustmentRefusedError`) still expires, because the state it read is stale.
 *
 * (`answerChallenge` is covered by `format-engine/__tests__/challenge-server.test.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, link, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn(), fireLockedActionEvents: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  saveFormatAction: vi.fn(),
  submitFormatAction: vi.fn(),
  applyFormatAdjustment: vi.fn(),
  resolveFormatCheck: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { expireSeasonReads } from '@/lib/revalidation';
import {
  applyFormatAdjustment,
  resolveFormatCheck,
  saveFormatAction,
  submitFormatAction,
  type FormatActionSubmissionRow,
} from '@/lib/supabase/queries/format-runtime';
import { saveAction, submitAction } from '../actions-server';
import { applyAdjustment } from '../adjust';
import { resolveCheck } from '../checks-server';
import { loadFreshKitContext, type KitContext } from '../load';
import type { ActionPick } from '../types';

const SEASON = 's-1';
const PHASE = 't-1';

function context(window: 'open' | 'locked' = 'open'): KitContext {
  const def = giftDef();
  return {
    seasonId: SEASON,
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def, { flags: { 'action:choose_gift': window, 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')] }),
    tunableIssues: [],
    phases: [{ id: PHASE, stage: def.stages[0], members: PLAYERS }],
  };
}

const picks: ActionPick[] = [
  { step: 0, item_id: 'garchomp' },
  { step: 0, item_id: 'blissey' },
];
const action = { seasonId: SEASON, actionId: 'choose_gift', actorId: 'p1', picks };
const row = { id: 'sub-1' } as FormatActionSubmissionRow;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(saveFormatAction).mockResolvedValue(row);
  vi.mocked(submitFormatAction).mockResolvedValue(row);
  vi.mocked(applyFormatAdjustment).mockResolvedValue('adj-1');
  vi.mocked(resolveFormatCheck).mockResolvedValue(true);
});

describe('saveAction', () => {
  it('expires the league and its phases after the draft is stored', async () => {
    await expect(saveAction(action)).resolves.toMatchObject({ ok: true });
    expect(saveFormatAction).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON, [PHASE]);
  });

  it('expires nothing when the save is refused before the database', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context('locked'));
    await expect(saveAction(action)).resolves.toMatchObject({ ok: false });
    expect(saveFormatAction).not.toHaveBeenCalled();
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('expires nothing when the database refuses', async () => {
    vi.mocked(saveFormatAction).mockRejectedValue(new Error('action_locked'));
    await expect(saveAction(action)).rejects.toThrow('action_locked');
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('submitAction', () => {
  it('expires the league and its phases after the submission is stored', async () => {
    await expect(submitAction(action)).resolves.toMatchObject({ ok: true });
    expect(submitFormatAction).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON, [PHASE]);
  });

  it('expires nothing when the submission has problems', async () => {
    await expect(submitAction({ ...action, picks: [{ step: 0, item_id: 'garchomp' }] })).resolves.toMatchObject({ ok: false });
    expect(submitFormatAction).not.toHaveBeenCalled();
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('expires nothing when the database refuses', async () => {
    vi.mocked(submitFormatAction).mockRejectedValue(new Error('resource_item_taken'));
    await expect(submitAction(action)).rejects.toThrow('resource_item_taken');
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('applyAdjustment', () => {
  const request = { seasonId: SEASON, adminId: 'admin-1', reason: 'fair', adjustment: { kind: 'points', stage: 'main', playerId: 'p1', points: 1 } } as const;

  it('expires the league and its phases once the adjustment is recorded', async () => {
    await expect(applyAdjustment(request)).resolves.toEqual({ ok: true, id: 'adj-1' });
    expect(expireSeasonReads).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON, [PHASE]);
  });

  it('expires nothing when the adjustment is refused', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(applyAdjustment(request)).resolves.toEqual({ ok: false, issue: 'format_not_running' });
    expect(applyFormatAdjustment).not.toHaveBeenCalled();
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('expires nothing when the database refuses', async () => {
    vi.mocked(applyFormatAdjustment).mockRejectedValue(new Error('boom'));
    await expect(applyAdjustment(request)).rejects.toThrow('boom');
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('resolveCheck', () => {
  const request = { seasonId: SEASON, checkId: 'c-1', status: 'confirmed', adminId: 'admin-1', note: null } as const;

  it('expires the league when a check was resolved', async () => {
    await expect(resolveCheck(request)).resolves.toBe(true);
    expect(expireSeasonReads).toHaveBeenCalledTimes(1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON);
  });

  it('expires nothing when the check was not open', async () => {
    vi.mocked(resolveFormatCheck).mockResolvedValue(false);
    await expect(resolveCheck(request)).resolves.toBe(false);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});
