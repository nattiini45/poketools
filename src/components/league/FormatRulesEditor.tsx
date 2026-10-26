'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { TeraRules, TiebreakerStep } from '@/types/format-rules';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NameListEditor from '@/components/ruleset-studio/NameListEditor';
import { loadFormatRules, saveFormatRules } from '@/components/league/format-rules-requests';
import {
  createFormatRulesController,
  type FormatRulesConfirm,
  type FormatRulesViewState,
} from '@/components/league/format-rules-controller';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import {
  FORMAT_RULES_LIMITS,
  FORMAT_RULES_NUMBER_FIELDS,
  addTiebreakerStep,
  defaultFormatRulesPayload,
  formatRulesFormDirty,
  moveTiebreakerStep,
  removeTiebreakerStep,
  unusedTiebreakerSteps,
  validateFormatRulesForm,
  type FormatRulesFieldError,
  type FormatRulesFieldKey,
  type FormatRulesFormValues,
  type FormatRulesNumberField,
} from '@/lib/league-admin/format-rules-form';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { cn } from '@/lib/utils/cn';

interface FormatRulesEditorProps {
  seasonId: string;
  /** The league has started: saving asks first, because the new rules apply to a running league. */
  seasonStarted: boolean;
}

export type { FormatRulesConfirm, FormatRulesViewState };

export interface FormatRulesEditorHandlers {
  onRetry: () => void;
  /** "Initialize default rules" was pressed: the editor asks before it writes. */
  onInitialize: () => void;
  onChange: (values: FormatRulesFormValues) => void;
  onSubmit: () => void;
  onReset: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
}

export interface FormatRulesEditorViewProps {
  state: FormatRulesViewState;
  seasonStarted: boolean;
  /** A save or initialize request is running. */
  busy?: boolean;
  /** The last save or initialize succeeded and nothing was edited since. */
  saved?: boolean;
  /** The failure of the last save or initialize; an error without text shows the fallback message. */
  error?: ApiErrorLike | null;
  /** The open confirmation, if any. */
  confirm?: FormatRulesConfirm | null;
  handlers?: Partial<FormatRulesEditorHandlers>;
}

/** Tera rule per stage; stage names come from `glossary.roster` (stage 1 is the base). */
const TERA_STAGES: readonly {
  key: keyof TeraRules;
  stage: 'roster.base' | 'roster.stage2' | 'roster.stage3';
  variant: 'green' | 'yellow' | 'red';
}[] = [
  { key: 'stage1', stage: 'roster.base', variant: 'green' },
  { key: 'stage2', stage: 'roster.stage2', variant: 'yellow' },
  { key: 'stage3', stage: 'roster.stage3', variant: 'red' },
];

const NOOP = () => {};

/** The props-driven editor: renders every state from its props, with no fetching and no effects. */
export function FormatRulesEditorView({
  state,
  seasonStarted,
  busy = false,
  saved = false,
  error = null,
  confirm = null,
  handlers = {},
}: FormatRulesEditorViewProps) {
  const t = useT(leagueAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const tEnum = useT(enumMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const {
    onRetry = NOOP,
    onInitialize = NOOP,
    onChange = NOOP,
    onSubmit = NOOP,
    onReset = NOOP,
    onConfirm = NOOP,
    onCancelConfirm = NOOP,
  } = handlers;

  const token = tGlossary('token.draftKill');
  const hasErrorText = error !== null && Boolean(error.error || error.code);

  if (state.kind === 'loading') {
    return <p className="text-sm text-poke-text-secondary">{t('formatRules.loading')}</p>;
  }

  if (state.kind === 'failed') {
    // A failed read offers a retry and nothing that writes: Initialize stays disabled, so it can never overwrite rules that exist.
    const detail = state.error && (state.error.error || state.error.code) ? errorText(state.error) : null;
    return (
      <div className="space-y-3">
        <Alert variant="error">
          <p>{t('formatRules.loadFailed')}</p>
          {detail && <p className="mt-1">{detail}</p>}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t('formatRules.retry')}
          </Button>
          <Button type="button" disabled>
            {t('formatRules.initialize')}
          </Button>
        </div>
      </div>
    );
  }

  if (state.kind === 'empty') {
    const defaults = defaultFormatRulesPayload();
    return (
      <div className="space-y-3">
        {error && (
          <Alert variant="error">{hasErrorText ? errorText(error) : t('formatRules.initializeFailed')}</Alert>
        )}
        <p className="text-sm text-poke-text-secondary">{t('formatRules.empty')}</p>
        <Button type="button" onClick={onInitialize} disabled={busy}>
          {busy ? t('formatRules.initializing') : t('formatRules.initialize')}
        </Button>
        <ConfirmDialog
          open={confirm === 'initialize'}
          onClose={onCancelConfirm}
          onConfirm={onConfirm}
          title={t('formatRules.initializeConfirm.title')}
          message={t('formatRules.initializeConfirm.message', {
            budget: defaults.draft_budget ?? 0,
            picks: defaults.draft_picks ?? 0,
            token,
            ratio: defaults.draft_token_ratio ?? 0,
            tokenMax: defaults.draft_token_max ?? 0,
            perLine: defaults.draft_token_max_per_line ?? 0,
            bans: (defaults.banned_moves?.length ?? 0) + (defaults.banned_items?.length ?? 0),
          })}
          confirmLabel={t('formatRules.initializeConfirm.confirm')}
          confirmVariant="primary"
          loading={busy}
        />
      </div>
    );
  }

  const { baseline, values, teraRules, redraftPhaseOpen } = state;
  const errors = validateFormatRulesForm(values);
  const dirty = formatRulesFormDirty(baseline, values);
  const canSave = dirty && errors.length === 0 && !busy;
  const unusedSteps = unusedTiebreakerSteps(values.tiebreaker_order);

  const stepLabel = (step: TiebreakerStep) => t(`formatRules.tiebreaker.${step}`);
  const errorFor = (field: FormatRulesFieldKey): FormatRulesFieldError | undefined =>
    errors.find((e) => e.field === field);
  const fieldErrorText = (e: FormatRulesFieldError): string => {
    switch (e.code) {
      case 'required':
        return t('formatRules.error.required');
      case 'not_integer':
        return t('formatRules.error.notInteger');
      case 'too_small':
        return t('formatRules.error.tooSmall', { min: e.limit ?? 0 });
      case 'too_big':
        return t('formatRules.error.tooBig', { max: e.limit ?? 0 });
      case 'empty':
        return t('formatRules.error.empty');
      case 'duplicate':
        return t('formatRules.error.duplicate');
      case 'too_long':
        return t('formatRules.error.tooLong', { max: e.limit ?? 0 });
      case 'decision_last':
        return t('formatRules.error.decisionLast');
    }
  };

  const numberLabels: Record<FormatRulesNumberField, string> = {
    draft_budget: tGlossary('price.budget'),
    draft_picks: t('formatRules.picks'),
    draft_token_ratio: t('formatRules.tokenRatio', { token }),
    draft_token_max: t('formatRules.tokenMax', { token }),
    draft_token_max_per_line: t('formatRules.perLineLimit', { token }),
  };

  const listError = (field: 'banned_moves' | 'banned_items') => {
    const e = errorFor(field);
    return e ? (
      <p id={`format-rules-${field}-error`} className="mt-1 text-sm text-poke-danger">
        {fieldErrorText(e)}
      </p>
    ) : null;
  };
  const tiebreakerError = errorFor('tiebreaker_order');

  const statusText = saved ? t('formatRules.saved') : dirty && !busy ? t('formatRules.unsavedHint') : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5"
      {...unsavedMarker(dirty)}
    >
      {error && <Alert variant="error">{hasErrorText ? errorText(error) : t('formatRules.saveFailed')}</Alert>}

      {/* Draft configuration */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_RULES_NUMBER_FIELDS.map((field) => {
            const id = `format-rules-${field}`;
            const limits = FORMAT_RULES_LIMITS[field];
            const fieldError = errorFor(field);
            const describedBy = [`${id}-hint`, fieldError ? `${id}-error` : null].filter(Boolean).join(' ');
            return (
              <div key={field} className="space-y-1.5">
                <label htmlFor={id} className="block text-sm font-heading font-semibold text-poke-text-primary">
                  {numberLabels[field]}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={limits.min}
                  max={limits.max}
                  step={1}
                  value={values[field]}
                  onChange={(e) => onChange({ ...values, [field]: e.target.value })}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={describedBy}
                  className={cn(
                    'flex h-10 w-full rounded-poke-md border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    fieldError ? 'border-poke-danger' : 'border-poke-border',
                  )}
                />
                <p id={`${id}-hint`} className="text-xs text-poke-text-muted">
                  {t('formatRules.range', limits)}
                </p>
                {fieldError && (
                  <p id={`${id}-error`} className="text-sm text-poke-danger">
                    {fieldErrorText(fieldError)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-poke-text-muted">{t('formatRules.poolHint')}</p>
      </div>

      {/* Banned moves and items (canonical English names, shown in the viewer's data locale) */}
      <div>
        <NameListEditor
          category="moves"
          label={t('formatRules.bannedMoves')}
          value={values.banned_moves}
          onChange={(banned_moves) => onChange({ ...values, banned_moves })}
        />
        {listError('banned_moves')}
      </div>
      <div>
        <NameListEditor
          category="items"
          label={t('formatRules.bannedItems')}
          value={values.banned_items}
          onChange={(banned_items) => onChange({ ...values, banned_items })}
        />
        {listError('banned_items')}
      </div>

      {/* Tera rules: pinned to the format pack */}
      <div className="space-y-1.5">
        <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('formatRules.teraRules')}</h3>
        <div className="flex flex-wrap gap-2">
          {TERA_STAGES.map(({ key, stage, variant }) => (
            <Badge key={key} variant={variant} size="md">
              {t('formatRules.teraRule', {
                stage: tGlossary(stage),
                rule: enumLabel(tEnum, 'teraRule', teraRules[key]),
              })}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-poke-text-muted">{t('formatRules.teraPinned')}</p>
      </div>

      {/* Redraft phase: a status line, the dedicated toggle changes it */}
      <div className="space-y-1">
        <p className="text-sm text-poke-text-primary">
          <span className="font-heading font-semibold">{t('formatRules.redraftPhase.label')}</span>
          {': '}
          {redraftPhaseOpen ? t('formatRules.redraftPhase.open') : t('formatRules.redraftPhase.closed')}
        </p>
        <p className="text-xs text-poke-text-muted">{t('formatRules.redraftPhase.hint')}</p>
      </div>

      {/* Tiebreaker order */}
      <div className="space-y-2">
        <h3 id="format-rules-tiebreaker-heading" className="text-sm font-heading font-semibold text-poke-text-primary">
          {t('formatRules.tiebreakerOrder')}
        </h3>
        <ol aria-labelledby="format-rules-tiebreaker-heading" className="space-y-1.5">
          {values.tiebreaker_order.map((step, index) => {
            const name = stepLabel(step);
            const last = index === values.tiebreaker_order.length - 1;
            return (
              <li
                key={step}
                className="flex items-center gap-2 rounded-poke-md border border-poke-border bg-poke-surface px-3 py-1.5 text-sm"
              >
                <span className="w-5 shrink-0 tabular-nums text-poke-text-muted">{index + 1}.</span>
                <span className="flex-1 text-poke-text-primary">{name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  aria-label={t('formatRules.tiebreakerMoveUp', { step: name })}
                  onClick={() =>
                    onChange({ ...values, tiebreaker_order: moveTiebreakerStep(values.tiebreaker_order, index, -1) })
                  }
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={last}
                  aria-label={t('formatRules.tiebreakerMoveDown', { step: name })}
                  onClick={() =>
                    onChange({ ...values, tiebreaker_order: moveTiebreakerStep(values.tiebreaker_order, index, 1) })
                  }
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('formatRules.tiebreakerRemove', { step: name })}
                  onClick={() =>
                    onChange({ ...values, tiebreaker_order: removeTiebreakerStep(values.tiebreaker_order, index) })
                  }
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ol>
        {tiebreakerError && (
          <p id="format-rules-tiebreaker-error" className="text-sm text-poke-danger">
            {fieldErrorText(tiebreakerError)}
          </p>
        )}
        {unusedSteps.length > 0 ? (
          <select
            id="format-rules-add-step"
            aria-label={t('formatRules.addStep')}
            value=""
            onChange={(e) => {
              const step = unusedSteps.find((candidate) => candidate === e.target.value);
              if (step) onChange({ ...values, tiebreaker_order: addTiebreakerStep(values.tiebreaker_order, step) });
            }}
            className="h-10 rounded-poke-md border border-poke-border bg-poke-surface px-3 text-sm text-poke-text-primary"
          >
            <option value="" disabled>
              {t('formatRules.addStep')}
            </option>
            {unusedSteps.map((step) => (
              <option key={step} value={step}>
                {stepLabel(step)}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-poke-text-muted">{t('formatRules.addStepNone')}</p>
        )}
        <p className="text-xs text-poke-text-muted">{t('formatRules.tiebreakerHint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={!canSave}>
          {busy ? t('formatRules.saving') : t('formatRules.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onReset} disabled={!dirty || busy}>
          {t('formatRules.reset')}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className={cn('text-sm', saved ? 'text-poke-green' : 'text-poke-text-muted')}
        >
          {statusText}
        </p>
      </div>

      <ConfirmDialog
        open={confirm === 'save' && seasonStarted}
        onClose={onCancelConfirm}
        onConfirm={onConfirm}
        title={t('formatRules.confirmStarted.title')}
        message={t('formatRules.confirmStarted.message')}
        confirmLabel={t('formatRules.confirmStarted.confirm')}
        confirmVariant="primary"
        loading={busy}
      />
    </form>
  );
}

/**
 * The Format Rules section of a point-buy league's Rules tab: loads the rules, edits them with the
 * same limits the route enforces and saves the full object through PUT /api/seasons/[id]/format-rules.
 * A failed load offers Retry and never the default rules; a started league asks before it saves. After
 * a save the response row is the new baseline and the route refreshes, so server tabs that show the
 * rules follow.
 */
export default function FormatRulesEditor({ seasonId, seasonStarted }: FormatRulesEditorProps) {
  const router = useRouter();
  const controller = useMemo(
    () =>
      createFormatRulesController({
        seasonId,
        load: loadFormatRules,
        save: saveFormatRules,
        refresh: () => router.refresh(),
      }),
    [seasonId, router],
  );
  const { state, busy, saved, error, confirm } = useSyncExternalStore(
    controller.subscribe,
    controller.getModel,
    controller.getModel,
  );

  useEffect(() => {
    controller.setSeasonStarted(seasonStarted);
  }, [controller, seasonStarted]);

  // The controller drops the answer of a request the editor no longer waits for (unmount, or a retry that superseded it).
  useEffect(() => {
    controller.load();
    return controller.dispose;
  }, [controller]);

  const handlers: FormatRulesEditorHandlers = {
    onRetry: controller.retry,
    onInitialize: controller.initialize,
    onChange: controller.change,
    onSubmit: controller.submit,
    onReset: controller.reset,
    onConfirm: controller.confirm,
    onCancelConfirm: controller.cancelConfirm,
  };

  return (
    <FormatRulesEditorView
      state={state}
      seasonStarted={seasonStarted}
      busy={busy}
      saved={saved}
      error={error}
      confirm={confirm}
      handlers={handlers}
    />
  );
}
