/**
 * `saveAction` / `submitAction` against a mocked database: what is refused before it, and the audience a caller names.
 * (The cache expiry of both is in `expiry.test.ts`.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, link, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  saveFormatAction: vi.fn(),
  submitFormatAction: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { FormatRuntimeError, saveFormatAction, submitFormatAction, type FormatActionSubmissionRow } from '@/lib/supabase/queries/format-runtime';
import { saveAction, submitAction } from '../actions-server';
import { loadFreshKitContext, type KitContext } from '../load';
import type { ActionPick, RuntimeSubmission } from '../types';

const SEASON = 's-1';
const row = { id: 'sub-1' } as FormatActionSubmissionRow;
const picks: ActionPick[] = [
  { step: 0, item_id: 'garchomp' },
  { step: 0, item_id: 'blissey' },
];
const action = { seasonId: SEASON, actionId: 'choose_gift', actorId: 'p1', picks };

function context(opts: { submission?: RuntimeSubmission['status']; visibility?: 'admins' } = {}): KitContext {
  const base = giftDef();
  const def =
    opts.visibility === 'admins'
      ? { ...base, domains: (base.domains ?? []).map((d) => (d.key === 'pool' ? { ...d, visibility: 'admins' as const } : d)) }
      : base;
  const submissions: RuntimeSubmission[] =
    opts.submission === undefined ? [] : [{ id: 'sub-1', action: 'choose_gift', actor: 'p1', target: 'p2', status: opts.submission, picks }];
  return {
    seasonId: SEASON,
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def, { flags: { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' }, links: [link('p1', 'p2')], submissions }),
    tunableIssues: [],
    phases: [{ id: 't-1', stage: def.stages[0], members: PLAYERS }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(saveFormatAction).mockResolvedValue(row);
  vi.mocked(submitFormatAction).mockResolvedValue(row);
});

describe('saveAction over an earlier submission', () => {
  it('saves a draft when there is no row yet', async () => {
    await expect(saveAction(action)).resolves.toMatchObject({ ok: true });
    expect(saveFormatAction).toHaveBeenCalledWith(expect.objectContaining({ actionKey: 'choose_gift', actorId: 'p1', targetId: 'p2' }));
  });

  it('saves over a draft', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ submission: 'draft' }));
    await expect(saveAction(action)).resolves.toMatchObject({ ok: true });
    expect(saveFormatAction).toHaveBeenCalledTimes(1);
  });

  it('refuses to demote a submitted pick, without calling the database', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ submission: 'submitted' }));
    await expect(saveAction(action)).rejects.toMatchObject({ code: 'format_action_already_submitted', statusCode: 409 });
    expect(saveFormatAction).not.toHaveBeenCalled();
  });

  it('leaves a locked row to the database (action_locked)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ submission: 'locked' }));
    await expect(saveAction(action)).resolves.toMatchObject({ ok: true });
    expect(saveFormatAction).toHaveBeenCalledTimes(1);
  });

  it('answers the problems of the request before the already-submitted refusal', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ submission: 'submitted' }));
    await expect(saveAction({ ...action, actorId: 'p3' })).resolves.toMatchObject({ ok: false, issues: [{ code: 'actor_without_link' }] });
    expect(saveFormatAction).not.toHaveBeenCalled();
  });

  it('does not refuse for another player’s submitted pick', async () => {
    const ctx = context({ submission: 'submitted' });
    ctx.state.links.push(link('p3', 'p4'));
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(saveAction({ ...action, actorId: 'p3' })).resolves.toMatchObject({ ok: true });
  });

  it('refuses nothing by exception for a league without a kit format or an unknown action', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(saveAction(action)).resolves.toEqual({ ok: false, issues: [{ code: 'format_not_running' }] });
    vi.mocked(loadFreshKitContext).mockResolvedValue(context());
    await expect(saveAction({ ...action, actionId: 'nope' })).resolves.toEqual({ ok: false, issues: [{ code: 'action_unknown' }] });
    expect(saveFormatAction).not.toHaveBeenCalled();
  });
});

describe('the revision of the format a write was validated against', () => {
  it('hands the revision of the loaded context to the database on a save and on a submit', async () => {
    const ctx = { ...context(), revision: 4242 };
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await saveAction(action);
    await submitAction(action);
    expect(vi.mocked(saveFormatAction).mock.calls[0][0]).toMatchObject({ revision: 4242 });
    expect(vi.mocked(submitFormatAction).mock.calls[0][0]).toMatchObject({ revision: 4242 });
  });

  it('hands it over on the deadline pick too (the system audience, onlyIfUnsubmitted)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...context(), revision: 77 });
    await submitAction({ ...action, audience: 'system', onlyIfUnsubmitted: true });
    expect(vi.mocked(submitFormatAction).mock.calls[0][0]).toMatchObject({ revision: 77, onlyIfUnsubmitted: true });
  });

  it('lets format_context_stale and resource_capacity_reached of the database leave as they are', async () => {
    vi.mocked(submitFormatAction).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    await expect(submitAction(action)).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
    vi.mocked(saveFormatAction).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    await expect(saveAction(action)).rejects.toMatchObject({ code: 'format_context_stale', statusCode: 409 });
    vi.mocked(submitFormatAction).mockRejectedValue(new FormatRuntimeError('resource_capacity_reached'));
    await expect(submitAction(action)).rejects.toMatchObject({ code: 'resource_capacity_reached', statusCode: 409 });
  });
});

describe('submitAction', () => {
  it('is idempotent over a submitted pick: it replaces it', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ submission: 'submitted' }));
    await expect(submitAction(action)).resolves.toMatchObject({ ok: true });
    expect(submitFormatAction).toHaveBeenCalledTimes(1);
  });

  it('refuses a player a domain only admins see, and does not call the database', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ visibility: 'admins' }));
    const result = await submitAction(action);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues.map((i) => i.code)).toEqual(['domain_locked']);
    expect(submitFormatAction).not.toHaveBeenCalled();
  });

  it('lets the system (a deadline pick) submit from that domain', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ visibility: 'admins' }));
    await expect(submitAction({ ...action, audience: 'system' })).resolves.toMatchObject({ ok: true });
    expect(submitFormatAction).toHaveBeenCalledTimes(1);
  });

  it('passes onlyIfUnsubmitted to the database only when asked (a player own submit replaces a submitted pick)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context());
    await submitAction(action);
    await submitAction({ ...action, audience: 'system', onlyIfUnsubmitted: true });
    expect(vi.mocked(submitFormatAction).mock.calls.map((call) => call[0].onlyIfUnsubmitted)).toEqual([undefined, true]);
  });
});
