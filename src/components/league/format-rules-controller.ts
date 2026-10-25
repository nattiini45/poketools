import type { FormatRules, FormatRulesFormData, TeraRules } from '@/types/format-rules';
import { DEFAULT_TERA_RULES } from '@/types/format-rules';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { FormatRulesLoadResult, FormatRulesSaveResult } from '@/components/league/format-rules-requests';
import {
  buildFormatRulesPayload,
  defaultFormatRulesPayload,
  formatRulesFormDirty,
  formatRulesToForm,
  validateFormatRulesForm,
  type FormatRulesFormValues,
} from '@/lib/league-admin/format-rules-form';

/**
 * The state machine behind the Format Rules editor, with its requests injected so it runs without
 * React: load, edit, the confirmation before a write, save and initialize. `FormatRulesEditor`
 * subscribes to it; the tests drive it with plain mocks.
 */

/** What the editor shows: the load state, and for a loaded row the form with its baseline. */
export type FormatRulesViewState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ApiErrorLike | null }
  | { kind: 'empty' }
  | {
      kind: 'ready';
      /** The values last loaded or saved: input that differs is unsaved. */
      baseline: FormatRulesFormValues;
      values: FormatRulesFormValues;
      /** Shown read-only: the format pack decides. */
      teraRules: TeraRules;
      /** Shown read-only: the dedicated Redraft toggle changes it. */
      redraftPhaseOpen: boolean;
    };

export type FormatRulesConfirm = 'initialize' | 'save';

/** Everything the view renders from. */
export interface FormatRulesModel {
  state: FormatRulesViewState;
  /** A save or initialize request is running. */
  busy: boolean;
  /** The last save or initialize succeeded and nothing was edited since. */
  saved: boolean;
  /** The failure of the last save or initialize. */
  error: ApiErrorLike | null;
  /** The open confirmation, if any. */
  confirm: FormatRulesConfirm | null;
}

export interface FormatRulesControllerDeps {
  seasonId: string;
  load: (seasonId: string) => Promise<FormatRulesLoadResult>;
  save: (seasonId: string, payload: FormatRulesFormData) => Promise<FormatRulesSaveResult>;
  /** Called after a save, so server tabs that show the rules follow. */
  refresh: () => void;
}

export interface FormatRulesController {
  getModel: () => FormatRulesModel;
  subscribe: (listener: () => void) => () => void;
  /** The league has started: saving asks first, because the new rules apply to a running league. */
  setSeasonStarted: (started: boolean) => void;
  /** Reads the rules (also the first thing the editor does). */
  load: () => void;
  retry: () => void;
  initialize: () => void;
  change: (values: FormatRulesFormValues) => void;
  submit: () => void;
  reset: () => void;
  confirm: () => void;
  cancelConfirm: () => void;
  /** Drops the answer of any request still running. */
  dispose: () => void;
}

export function readyState(rules: FormatRules): Extract<FormatRulesViewState, { kind: 'ready' }> {
  const form = formatRulesToForm(rules);
  return {
    kind: 'ready',
    baseline: form,
    values: form,
    teraRules: rules.tera_rules ?? DEFAULT_TERA_RULES,
    redraftPhaseOpen: rules.redraft_phase_open === true,
  };
}

export function createFormatRulesController(deps: FormatRulesControllerDeps): FormatRulesController {
  let model: FormatRulesModel = { state: { kind: 'loading' }, busy: false, saved: false, error: null, confirm: null };
  // Until told otherwise a save asks first: the safe side for a league that may be running.
  let seasonStarted = true;
  // A load answer counts only while its generation is current (a retry or dispose supersedes it).
  let generation = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  function update(patch: Partial<FormatRulesModel>) {
    model = { ...model, ...patch };
    listeners.forEach((listener) => listener());
  }

  function load() {
    disposed = false;
    const mine = ++generation;
    void deps.load(deps.seasonId).then((result) => {
      if (disposed || mine !== generation) return;
      if (result.kind === 'loaded') update({ state: readyState(result.rules) });
      else if (result.kind === 'empty') update({ state: { kind: 'empty' } });
      else update({ state: { kind: 'failed', error: result.error } });
    });
  }

  async function persist(payload: FormatRulesFormData, submitted: FormatRulesFormValues | null) {
    update({ busy: true, saved: false, error: null, confirm: null });
    const result = await deps.save(deps.seasonId, payload);
    if (disposed) return;
    if (!result.ok) {
      update({ busy: false, error: result.error });
      return;
    }
    const stored = readyState(result.rules);
    const prev = model.state;
    // Input typed while the request ran stays; otherwise the stored row is the form.
    const state =
      prev.kind === 'ready' && submitted && formatRulesFormDirty(submitted, prev.values)
        ? { ...stored, values: prev.values }
        : stored;
    update({ busy: false, state, saved: true });
    deps.refresh();
  }

  function save() {
    const { state } = model;
    if (state.kind !== 'ready') return;
    void persist(buildFormatRulesPayload(state.values), state.values);
  }

  return {
    getModel: () => model,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSeasonStarted: (started) => {
      seasonStarted = started;
    },
    load,
    retry: () => {
      update({ error: null, state: { kind: 'loading' } });
      load();
    },
    // Only an answered "no row" may be initialized: a failed read must never turn into an overwrite.
    initialize: () => {
      if (model.state.kind === 'empty') update({ confirm: 'initialize' });
    },
    change: (values) => {
      const { state } = model;
      update({ saved: false, state: state.kind === 'ready' ? { ...state, values } : state });
    },
    submit: () => {
      const { state, busy } = model;
      if (state.kind !== 'ready' || busy) return;
      if (!formatRulesFormDirty(state.baseline, state.values) || validateFormatRulesForm(state.values).length > 0) {
        return;
      }
      if (seasonStarted) update({ confirm: 'save' });
      else save();
    },
    reset: () => {
      const { state } = model;
      update({ saved: false, error: null, state: state.kind === 'ready' ? { ...state, values: state.baseline } : state });
    },
    confirm: () => {
      if (model.confirm === 'initialize' && model.state.kind === 'empty') void persist(defaultFormatRulesPayload(), null);
      else if (model.confirm === 'save') save();
    },
    cancelConfirm: () => update({ confirm: null }),
    dispose: () => {
      disposed = true;
      generation += 1;
    },
  };
}
