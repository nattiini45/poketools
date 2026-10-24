/**
 * The Format Rules editor's state machine, driven with mocked requests (no React, no DOM): the
 * confirmation before a write to a started league, what Initialize and Save send, a failed load or
 * save, input typed during a save, and Retry.
 */
import { describe, expect, it, vi } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import type { FormatRules, FormatRulesFormData } from '@/types/format-rules';
import {
  buildFormatRulesPayload,
  defaultFormatRulesPayload,
  formatRulesToForm,
} from '@/lib/league-admin/format-rules-form';
import {
  createFormatRulesController,
  type FormatRulesController,
  type FormatRulesViewState,
} from '../format-rules-controller';
import type { FormatRulesLoadResult, FormatRulesSaveResult } from '../format-rules-requests';

const RULES: FormatRules = {
  id: 'fr-1',
  season_id: 's1',
  banned_moves: ['Baton Pass'],
  banned_items: ['Soul Dew'],
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: ['match_points', 'evolution_points', 'head_to_head', 'decision_match'],
  draft_budget: 180,
  draft_picks: 9,
  draft_token_ratio: 3,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
  redraft_phase_open: false,
  created_at: '2026-01-01T00:00:00Z',
};

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { started?: boolean; load?: FormatRulesLoadResult } = {}) {
  const load = vi.fn(async (_seasonId: string): Promise<FormatRulesLoadResult> => options.load ?? { kind: 'loaded', rules: RULES });
  const save = vi.fn(
    async (_seasonId: string, payload: FormatRulesFormData): Promise<FormatRulesSaveResult> => ({
      ok: true,
      rules: { ...RULES, ...payload },
    }),
  );
  const refresh = vi.fn();
  const controller = createFormatRulesController({ seasonId: 's1', load, save, refresh });
  controller.setSeasonStarted(options.started ?? false);
  return { controller, load, save, refresh };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(options);
  ctx.controller.load();
  await settle();
  return ctx;
}

function ready(controller: FormatRulesController): Extract<FormatRulesViewState, { kind: 'ready' }> {
  const { state } = controller.getModel();
  if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`);
  return state;
}

/** Edits the budget so the form is dirty and valid. */
function editBudget(controller: FormatRulesController, budget: string) {
  controller.change({ ...ready(controller).values, draft_budget: budget });
}

describe('format rules controller: loading', () => {
  it('starts loading, then holds the loaded row as form and baseline', async () => {
    const { controller, load } = setup();
    expect(controller.getModel().state).toEqual({ kind: 'loading' });
    controller.load();
    await settle();
    expect(load).toHaveBeenCalledWith('s1');
    const state = ready(controller);
    expect(state.baseline).toEqual(formatRulesToForm(RULES));
    expect(state.values).toEqual(state.baseline);
  });

  it('an empty answer is the empty state', async () => {
    const { controller } = await loaded({ load: { kind: 'empty' } });
    expect(controller.getModel().state).toEqual({ kind: 'empty' });
  });

  it('a failed load keeps the error and never writes: Submit, Confirm and Initialize reach no save', async () => {
    const error = { error: 'Failed to fetch format rules', code: 'internal_error' };
    const { controller, save } = await loaded({ load: { kind: 'failed', error } });
    expect(controller.getModel().state).toEqual({ kind: 'failed', error });

    controller.submit();
    controller.confirm();
    controller.initialize();
    controller.confirm();
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it('Retry goes back to loading and shows the answer of the new request', async () => {
    const { controller, load } = setup();
    load.mockResolvedValueOnce({ kind: 'failed', error: null });
    controller.load();
    await settle();
    expect(controller.getModel().state.kind).toBe('failed');

    const second = deferred<FormatRulesLoadResult>();
    load.mockReturnValueOnce(second.promise);
    controller.retry();
    expect(controller.getModel().state).toEqual({ kind: 'loading' });
    second.resolve({ kind: 'loaded', rules: RULES });
    await settle();
    expect(controller.getModel().state.kind).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('the answer of a superseded request is dropped', async () => {
    const { controller, load } = setup();
    const first = deferred<FormatRulesLoadResult>();
    const second = deferred<FormatRulesLoadResult>();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    controller.load();
    controller.retry();

    second.resolve({ kind: 'empty' });
    await settle();
    first.resolve({ kind: 'loaded', rules: RULES });
    await settle();
    expect(controller.getModel().state).toEqual({ kind: 'empty' });
  });

  it('the answer after dispose is dropped', async () => {
    const { controller, load } = setup();
    const pending = deferred<FormatRulesLoadResult>();
    load.mockReturnValueOnce(pending.promise);
    controller.load();
    controller.dispose();
    pending.resolve({ kind: 'loaded', rules: RULES });
    await settle();
    expect(controller.getModel().state).toEqual({ kind: 'loading' });
  });

  it('notifies subscribers on a change and stops after unsubscribe', async () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.load();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.initialize();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('format rules controller: submitting', () => {
  it('a not-started league saves directly, with the full payload', async () => {
    const { controller, save, refresh } = await loaded({ started: false });
    editBudget(controller, '200');
    controller.submit();
    await settle();

    expect(controller.getModel().confirm).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe('s1');
    expect(save.mock.calls[0][1]).toEqual(buildFormatRulesPayload({ ...formatRulesToForm(RULES), draft_budget: '200' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a started league asks first and saves only after the confirmation', async () => {
    const { controller, save } = await loaded({ started: true });
    editBudget(controller, '200');
    controller.submit();
    await settle();

    expect(controller.getModel().confirm).toBe('save');
    expect(save).not.toHaveBeenCalled();

    controller.confirm();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.getModel().confirm).toBeNull();
  });

  it('cancelling the confirmation saves nothing and keeps the edit', async () => {
    const { controller, save } = await loaded({ started: true });
    editBudget(controller, '200');
    controller.submit();
    controller.cancelConfirm();
    await settle();

    expect(controller.getModel().confirm).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(ready(controller).values.draft_budget).toBe('200');
  });

  it('a clean form is a no-op', async () => {
    const { controller, save } = await loaded({ started: true });
    controller.submit();
    await settle();
    expect(controller.getModel().confirm).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('an invalid form is a no-op', async () => {
    const { controller, save } = await loaded({ started: false });
    editBudget(controller, '');
    controller.submit();
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(controller.getModel().busy).toBe(false);
  });

  it('a second Submit while a save runs does not send again', async () => {
    const { controller, save } = await loaded({ started: false });
    const pending = deferred<FormatRulesSaveResult>();
    save.mockReturnValueOnce(pending.promise);
    editBudget(controller, '200');
    controller.submit();
    expect(controller.getModel().busy).toBe(true);
    controller.submit();
    expect(save).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, rules: { ...RULES, draft_budget: 200 } });
    await settle();
  });
});

describe('format rules controller: after the request', () => {
  it('a saved row becomes the baseline and the form, and flags saved', async () => {
    const { controller } = await loaded({ started: false });
    editBudget(controller, '200');
    controller.submit();
    await settle();

    const model = controller.getModel();
    expect(model.busy).toBe(false);
    expect(model.saved).toBe(true);
    expect(model.error).toBeNull();
    const state = ready(controller);
    expect(state.baseline.draft_budget).toBe('200');
    expect(state.values).toEqual(state.baseline);
  });

  it('a failed save sets the error, keeps the typed values and the old baseline, and does not refresh', async () => {
    const { controller, save, refresh } = await loaded({ started: false });
    save.mockResolvedValueOnce({ ok: false, error: { error: 'Forbidden', code: 'forbidden' } });
    editBudget(controller, '200');
    controller.submit();
    await settle();

    const model = controller.getModel();
    expect(model.error).toEqual({ error: 'Forbidden', code: 'forbidden' });
    expect(model.busy).toBe(false);
    expect(model.saved).toBe(false);
    const state = ready(controller);
    expect(state.values.draft_budget).toBe('200');
    expect(state.baseline.draft_budget).toBe('180');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('input typed while the save runs survives; the stored row is the new baseline', async () => {
    const { controller, save } = await loaded({ started: false });
    const pending = deferred<FormatRulesSaveResult>();
    save.mockReturnValueOnce(pending.promise);
    editBudget(controller, '200');
    controller.submit();

    controller.change({ ...ready(controller).values, draft_picks: '7' });
    pending.resolve({ ok: true, rules: { ...RULES, draft_budget: 200 } });
    await settle();

    const state = ready(controller);
    expect(state.baseline.draft_budget).toBe('200');
    expect(state.baseline.draft_picks).toBe('9');
    expect(state.values.draft_picks).toBe('7');
    expect(controller.getModel().saved).toBe(true);
  });

  it('an edit clears the saved flag and Reset restores the baseline and clears the error', async () => {
    const { controller, save } = await loaded({ started: false });
    save.mockResolvedValueOnce({ ok: false, error: { code: 'unknown_error' } });
    editBudget(controller, '200');
    controller.submit();
    await settle();
    expect(controller.getModel().error).not.toBeNull();

    controller.reset();
    expect(controller.getModel().error).toBeNull();
    expect(ready(controller).values).toEqual(ready(controller).baseline);

    editBudget(controller, '210');
    controller.submit();
    await settle();
    expect(controller.getModel().saved).toBe(true);
    editBudget(controller, '220');
    expect(controller.getModel().saved).toBe(false);
  });

  it('a save answered after dispose changes nothing', async () => {
    const { controller, save, refresh } = await loaded({ started: false });
    const pending = deferred<FormatRulesSaveResult>();
    save.mockReturnValueOnce(pending.promise);
    editBudget(controller, '200');
    controller.submit();
    controller.dispose();
    pending.resolve({ ok: true, rules: { ...RULES, draft_budget: 200 } });
    await settle();
    expect(controller.getModel().saved).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('format rules controller: initialize', () => {
  it('asks first, writes the default rules on Confirm and shows the stored row', async () => {
    const { controller, save, refresh } = await loaded({ load: { kind: 'empty' } });
    controller.initialize();
    expect(controller.getModel().confirm).toBe('initialize');
    expect(save).not.toHaveBeenCalled();

    controller.confirm();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toEqual(defaultFormatRulesPayload());
    expect(controller.getModel().state.kind).toBe('ready');
    expect(controller.getModel().saved).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a failed initialize keeps the empty state and shows the error', async () => {
    const { controller, save } = await loaded({ load: { kind: 'empty' } });
    save.mockResolvedValueOnce({ ok: false, error: { error: 'Boom', code: 'internal_error' } });
    controller.initialize();
    controller.confirm();
    await settle();
    expect(controller.getModel().state).toEqual({ kind: 'empty' });
    expect(controller.getModel().error).toEqual({ error: 'Boom', code: 'internal_error' });
  });

  it('cancelling Initialize writes nothing', async () => {
    const { controller, save } = await loaded({ load: { kind: 'empty' } });
    controller.initialize();
    controller.cancelConfirm();
    controller.confirm();
    await settle();
    expect(save).not.toHaveBeenCalled();
  });
});
