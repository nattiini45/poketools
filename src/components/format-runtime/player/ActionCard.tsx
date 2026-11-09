'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { saveActionRequest, submitActionRequest } from '@/lib/format-engine/runtime/client-api';
import type { ActionPick } from '@/lib/format-engine/runtime/types';
import type { ActionView, DomainEntriesView, EntryView, SubmissionState } from '@/lib/format-engine/runtime/view-types';
import ActionIssues from './ActionIssues';
import SpeciesLabel from './SpeciesLabel';
import StepPicker from './StepPicker';
import { useLText, usePlayerName } from './useLabels';
import { useRuntimeAction } from './useRuntimeAction';

const TOUCH = 'min-h-11 sm:min-h-0';
const NO_ENTRIES: readonly EntryView[] = [];

export type ActionStatus = 'saved' | 'submitted';

export interface ActionCardProps {
  seasonId: string;
  action: ActionView;
  /** The domains of the actionable steps, each once (`PlayerFormatView.domains`). */
  domains: readonly DomainEntriesView[];
  /** The league is completed or archived: the card only shows. */
  closed: boolean;
  /** The page's single reload path: resolves to whether the view was read again (`false`: the old view is still shown). */
  onReload: () => Promise<boolean>;
  onStatus: (status: ActionStatus) => void;
}

const picksOfStep = (picks: readonly ActionPick[], step: number): string[] =>
  picks.filter((pick) => pick.step === step).map((pick) => pick.item_id);

/**
 * One action of the format. Not actionable (window not open, locked, no access, closed league): a read-only summary.
 * Otherwise a draft or empty pick is edited with Save draft and Submit; a submitted pick is shown, and Change pick
 * turns the card editable with Submit again only (the server refuses a draft save over a submitted pick, and the old
 * pick stays in place until the new one is accepted). An `on_submit` action asks for a confirmation first.
 */
export default function ActionCard({ seasonId, action, domains, closed, onReload, onStatus }: ActionCardProps) {
  const t = useT(formatRuntimePlayerMessages);
  const labelOf = useLText();
  const nameOf = usePlayerName();
  const errorText = useApiErrorText(errorsSeasons, errorsCommon);
  const { run, pending, error, clearError } = useRuntimeAction(async () => {
    await onReload();
  });
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the card has switched between reading and editing: the button that had it is gone by then.
  const moveFocus = useRef<'editor' | 'change' | null>(null);

  const [draft, setDraft] = useState<ActionPick[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const submission = action.submission;
  const state: SubmissionState | 'none' = submission?.state ?? 'none';
  const picks = draft ?? submission?.picks ?? [];
  const canAct = !closed && action.actionable;
  const editable = canAct && (state !== 'submitted' || editing);
  const stepsReady = action.steps.every((step) => step.unlocked);
  const complete = action.steps.every((step) => picksOfStep(picks, step.index).length === step.count);

  // Entries the last answer said someone else took, per step: the picker marks those rows.
  const takenByStep = new Map<number, Set<string>>();
  for (const issue of error?.issues ?? []) {
    if (issue.code === 'resource_item_taken' && issue.step !== undefined && issue.item_id !== undefined) {
      const taken = takenByStep.get(issue.step) ?? new Set<string>();
      taken.add(issue.item_id);
      takenByStep.set(issue.step, taken);
    }
  }

  useEffect(() => {
    const target = moveFocus.current;
    if (target === null) return;
    moveFocus.current = null;
    // After a submit there is no Change button when the server locked the pick (an `on_submit` action): the whole
    // button row is gone, so focus lands on the card's heading rather than dropping to the page.
    const node =
      target === 'change'
        ? (changeRef.current ?? headingRef.current)
        : (editorRef.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? headingRef.current);
    node?.focus();
  }, [editable]);

  function setStepPicks(step: number, ids: string[]) {
    const others = picks.filter((pick) => pick.step !== step);
    setDraft([...others, ...ids.map((item_id) => ({ step, item_id }))].sort((a, b) => a.step - b.step));
  }

  async function save() {
    const outcome = await run(() => saveActionRequest(seasonId, action.id, picks));
    if (outcome?.ok) {
      await onReload();
      onStatus('saved');
    }
  }

  async function submit() {
    setConfirming(false);
    const outcome = await run(() => submitActionRequest(seasonId, action.id, picks));
    if (outcome?.ok) {
      // The picks stay on screen until the view was read again: if that read fails the old view is still shown, and
      // dropping the draft would show an empty or outdated pick although the submit went through (the page says that
      // it could not be updated). Nothing is announced as submitted then.
      moveFocus.current = 'change';
      if (!(await onReload())) {
        moveFocus.current = null;
        return;
      }
      setDraft(null);
      setEditing(false);
      onStatus('submitted');
    }
  }

  function askToSubmit() {
    if (action.lock === 'on_submit') setConfirming(true);
    else void submit();
  }

  function startEditing() {
    clearError();
    setDraft(submission?.picks ?? []);
    moveFocus.current = 'editor';
    setEditing(true);
  }

  function stopEditing() {
    moveFocus.current = 'change';
    setEditing(false);
    setDraft(null);
    clearError();
  }

  const windowBadge =
    action.window === 'open' ? (
      <Badge variant="green">{t('actions.windowOpen')}</Badge>
    ) : action.window === 'locked' ? (
      <Badge variant="yellow">{t('actions.windowLocked')}</Badge>
    ) : (
      <Badge variant="gray">{t('actions.windowNotYet')}</Badge>
    );
  const stateBadge = {
    none: <Badge variant="gray">{t('actions.statusNone')}</Badge>,
    draft: <Badge variant="yellow">{t('actions.statusDraft')}</Badge>,
    submitted: <Badge variant="green">{t('actions.statusSubmitted')}</Badge>,
    locked: <Badge variant="blue">{t('actions.statusLocked')}</Badge>,
  }[state];

  // Why the card is read-only, in one sentence (a closed league has its own notice at the top of the page).
  const readOnlyReason = closed
    ? null
    : !action.accessible
      ? t('actions.noAccess')
      : state === 'locked'
        ? t('actions.lockedPick')
        : action.window === 'locked'
          ? t('actions.lockedWindow')
          : action.window === 'not_open_yet'
            ? t('actions.notYet')
            : null;

  const pickLines = action.steps
    .map((step) => ({ step, ids: picksOfStep(submission?.picks ?? [], step.index) }))
    .filter((line) => line.ids.length > 0);

  return (
    <article aria-labelledby={headingId} className="space-y-3 rounded-poke-lg border border-poke-border bg-poke-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-heading text-base font-bold text-poke-text-primary focus:outline-none">
          {labelOf(action.label)}
        </h3>
        <div className="flex flex-wrap gap-2">
          {windowBadge}
          {stateBadge}
        </div>
      </header>

      {action.target !== null ? (
        <p className="text-sm text-poke-text-secondary">{t('actions.targetKnown', { name: nameOf(action.target) })}</p>
      ) : action.target_hidden ? (
        <p className="text-sm text-poke-text-secondary">{t('actions.targetHidden')}</p>
      ) : null}

      {readOnlyReason !== null && <p className="text-sm text-poke-text-secondary">{readOnlyReason}</p>}

      {!editable && (
        <div className="space-y-1">
          <p className="font-heading text-xs font-semibold text-poke-text-muted">{t('actions.yourPick')}</p>
          {pickLines.length === 0 ? (
            <p className="text-sm text-poke-text-secondary">{t('actions.noPick')}</p>
          ) : (
            <ul className="space-y-0.5 text-sm text-poke-text-primary">
              {pickLines.map(({ step, ids }) => (
                <li key={step.index}>
                  <span className="text-poke-text-secondary">
                    {t('step.heading', { number: step.index + 1, resource: labelOf(step.resource_label) })}:{' '}
                  </span>
                  {ids.map((id, index) => (
                    <span key={id}>
                      {index > 0 && ', '}
                      <SpeciesLabel id={id} />
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editable && (
        <div ref={editorRef} className="space-y-4">
          {action.steps.map((step) => (
            <StepPicker
              key={step.index}
              step={step}
              entries={domains.find((domain) => domain.key === step.domain)?.entries ?? NO_ENTRIES}
              selected={picksOfStep(picks, step.index)}
              onChange={(ids) => setStepPicks(step.index, ids)}
              takenIds={takenByStep.get(step.index)}
              disabled={pending}
            />
          ))}
          {state === 'submitted' && <p className="text-xs text-poke-text-secondary">{t('actions.resubmitHint')}</p>}
        </div>
      )}

      {error !== null &&
        (error.issues !== undefined && error.issues.length > 0 ? (
          <ActionIssues issues={error.issues} />
        ) : (
          <Alert variant="error">{errorText(error)}</Alert>
        ))}

      {canAct && (
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              {state !== 'submitted' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className={TOUCH}
                  onClick={() => void save()}
                  disabled={pending || !stepsReady || picks.length === 0}
                >
                  {t('buttons.saveDraft')}
                </Button>
              )}
              <Button size="sm" className={TOUCH} onClick={askToSubmit} disabled={pending || !stepsReady || !complete}>
                {state === 'submitted' ? t('buttons.submitAgain') : t('buttons.submit')}
              </Button>
              {state === 'submitted' && (
                <Button variant="ghost" size="sm" className={TOUCH} onClick={stopEditing} disabled={pending}>
                  {t('buttons.cancel')}
                </Button>
              )}
            </>
          ) : (
            <Button ref={changeRef} variant="secondary" size="sm" className={TOUCH} onClick={startEditing}>
              {t('buttons.change')}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void submit()}
        title={t('confirm.finalTitle')}
        message={t('confirm.finalBody')}
        confirmLabel={t('buttons.confirm')}
        confirmVariant="primary"
        loading={pending}
      />
    </article>
  );
}
