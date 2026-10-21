'use client';

/**
 * The Redraft's submission phase and reveal (draft-frontend §7.1):
 * - deadline editor (BE #21; moving it is how the phase is paused);
 * - per-player submission status, contents visible to admins (BE #20);
 * - **Publish** (atomic, BE #22), disabled before the deadline unless
 *   "Force publish" with a reason;
 * - after publish a read-only drop list with **Restore drop** per redraft
 *   slot (BE #23, reason; `RESTORE_WOULD_OVERDRAW` shown inline);
 * - "Automatic publish refused at <time>" (amber) while the Redraft is still
 *   unpublished and the deadline tick refused to publish it
 *   (`draft_pools.publish_refused_at`, admin data only: the admin submissions
 *   response carries it, and the control page also reads it on the server for
 *   its first render; a player's snapshot never carries it).
 */
import { useId, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { LocalTime } from '@/i18n/LocalTime';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { AdminSubmissionDTO } from '@/types/draft-queue';
import { useLineText } from '@/components/draft-tokens/use-line-text';
import { FIELD, HINT, InlineError, InlineNotice, LABEL, ReasonField, TABLE, TD, TH, usePrimaryButton } from './admin-ui';
import {
  isoToLocalInput,
  localInputToIso,
  publishAllowed,
  reasonValid,
  restorableSlotFor,
  type AdminRedraftSlot,
} from './admin-view';
import { useAdminCall, type AdminResult } from './use-admin-call';

const noopSubscribe = () => () => {};

export interface RedraftPhaseManagerProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  /** null while loading or when not loaded (after publish). */
  submissions: AdminSubmissionDTO[] | null;
  submissionsError: ApiErrorLike | null;
  /** Published slots with their ids (`adminRedraftSlots`); null before the publish. */
  slots: AdminRedraftSlot[] | null;
  /** Element id of the deadline field (linked from the live controls). */
  deadlineFieldId: string;
  /** The current time on the server clock (ms). */
  nowMs: number;
  onPatchDeadline(deadlineIso: string): AdminResult;
  onPublish(input: { force: boolean; reason?: string }): Promise<{ error: ApiErrorLike | null; drops: number }>;
  onRestore(redraftSlotId: string, reason: string): AdminResult;
  /**
   * `draft_pools.publish_refused_at`: the last refused automatic publish (REDRAFT_NOT_COMPLETABLE or
   * POOL_CHECK_LIMIT at the deadline tick). Shown only before the reveal. Null or absent: never refused, or
   * not read yet.
   */
  publishRefusedAt?: string | null;
}

export default function RedraftPhaseManager({
  vm,
  catalog,
  submissions,
  submissionsError,
  slots,
  deadlineFieldId,
  nowMs,
  onPatchDeadline,
  onPublish,
  onRestore,
  publishRefusedAt = null,
}: RedraftPhaseManagerProps) {
  const t = useT(draftAdminMessages);
  const primary = usePrimaryButton();
  const f = useFormatter();
  const errorText = useApiErrorText(errorsDraft);
  const text = useLineText(catalog);
  const forceId = useId();
  const redraft = vm.redraft;
  const phase = redraft?.phase ?? null;
  const deadlineAt = redraft?.deadline_at ?? null;
  const preReveal = phase === 'submissions' || phase === 'locked';

  const deadlineCall = useAdminCall();
  // The field shows the viewer's local zone. The server render has no such
  // zone, so it renders the field empty and the client fills it after
  // hydration (no SSR/CSR mismatch, no shifted start value).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [editedDeadline, setDeadline] = useState<string | null>(null);
  const deadline = editedDeadline ?? (hydrated ? isoToLocalInput(deadlineAt) : '');
  const [deadlineSaved, setDeadlineSaved] = useState(false);

  const publishCall = useAdminCall();
  const [publishOpen, setPublishOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  const restoreCall = useAdminCall();
  const [restoreSlot, setRestoreSlot] = useState<AdminRedraftSlot | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restored, setRestored] = useState(false);

  const nameOf = (playerId: string) => vm.participants.find((p) => p.player_id === playerId)?.name ?? '';
  const canPublish = publishAllowed({ phase, deadlineAt, nowMs, force, reason: publishReason });
  const deadlineIso = localInputToIso(deadline);

  const saveDeadline = async () => {
    if (!deadlineIso) return;
    setDeadlineSaved(false);
    const ok = await deadlineCall.run(() => onPatchDeadline(deadlineIso));
    if (ok) setDeadlineSaved(true);
  };

  const publish = async () => {
    let drops = 0;
    const ok = await publishCall.run(async () => {
      const res = await onPublish(force ? { force: true, reason: publishReason.trim() } : { force: false });
      drops = res.drops;
      return res.error;
    });
    if (ok) {
      setPublishOpen(false);
      setPublishedCount(drops);
    }
  };

  const restore = async () => {
    if (!restoreSlot) return;
    setRestored(false);
    const ok = await restoreCall.run(() => onRestore(restoreSlot.redraftSlotId, restoreReason.trim()));
    if (ok) {
      setRestoreSlot(null);
      setRestored(true);
    }
  };

  const restoreParams = restoreSlot
    ? { line: text.label(restoreSlot.lineId), name: nameOf(restoreSlot.playerId) }
    : { line: '', name: '' };

  return (
    <div className="space-y-4">
      {phase ? <p className="text-sm text-poke-text-secondary">{t(`redraft.phase.${phase}`)}</p> : null}

      {preReveal && publishRefusedAt ? (
        <div
          role="status"
          data-publish-refused
          className="space-y-1 rounded-poke-md border border-[var(--draft-warn-ink,var(--poke-amber-ink))] p-3 text-sm text-poke-text-primary"
        >
          <p className="font-semibold text-[var(--draft-warn-ink,var(--poke-amber-ink))]">
            {t('redraft.publishRefusedAt')} <LocalTime value={publishRefusedAt} preset="weekdayDateTime" zone="both" />
          </p>
          <p className="text-poke-text-secondary">{t('redraft.publishRefusedHint')}</p>
        </div>
      ) : null}

      {phase === 'submissions' ? (
        <div className="space-y-1">
          <label htmlFor={deadlineFieldId} className={LABEL}>
            {t('redraft.deadline')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={deadlineFieldId}
              type="datetime-local"
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
                setDeadlineSaved(false);
              }}
              className={`${FIELD} max-w-xs`}
            />
            <Button
              size="sm"
              variant={primary.variant}
              className={primary.className}
              disabled={!deadlineIso || deadlineIso === deadlineAt || deadlineCall.busy}
              onClick={saveDeadline}
            >
              {t('redraft.saveDeadline')}
            </Button>
          </div>
          {deadlineAt ? (
            <p className={HINT}>
              <LocalTime value={deadlineAt} preset="weekdayDateTime" zone="both" />
            </p>
          ) : null}
          <p className={HINT}>{t('redraft.deadlineHint')}</p>
          <InlineError text={deadlineCall.error ? errorText(deadlineCall.error) : null} />
          <InlineNotice text={deadlineSaved ? t('redraft.deadlineSaved') : null} />
        </div>
      ) : null}

      {preReveal ? (
        <div className="space-y-2">
          <h3 className="font-heading font-semibold text-poke-text-primary">{t('redraft.submissions')}</h3>
          {submissionsError ? (
            <InlineError text={t('redraft.submissionsFailed')} />
          ) : submissions === null ? (
            <p className={HINT}>{t('redraft.loadingSubmissions')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>{t('redraft.col.player')}</th>
                    <th className={TH}>{t('redraft.col.lines')}</th>
                    <th className={TH}>{t('redraft.col.updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...vm.participants]
                    .sort((a, b) => a.seat - b.seat)
                    .map((p) => {
                      const sub = submissions.find((s) => s.player_id === p.player_id);
                      return (
                        <tr key={p.player_id} className="border-t border-poke-border">
                          <td className={TD}>{p.name}</td>
                          <td className={TD}>
                            {!sub
                              ? t('redraft.notSubmitted')
                              : sub.line_ids.length === 0
                                ? t('redraft.noDrop')
                                : f.list(sub.line_ids.map((id) => text.label(id)))}
                          </td>
                          <td className={TD}>
                            {sub ? <LocalTime value={sub.updated_at} preset="dateTime" /> : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2 rounded-poke-md border border-poke-border p-3">
            <label htmlFor={forceId} className="flex items-center gap-2 text-sm text-poke-text-primary">
              <input id={forceId} type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t('redraft.forcePublish')}
            </label>
            {force ? <ReasonField value={publishReason} onChange={setPublishReason} /> : null}
            {!canPublish ? <p className={HINT}>{t('redraft.publishNeedsForce')}</p> : null}
            <Button variant={primary.variant} className={primary.className} disabled={!canPublish} onClick={() => setPublishOpen(true)}>
              {t('redraft.publish')}
            </Button>
          </div>
        </div>
      ) : null}
      <InlineNotice text={publishedCount !== null ? t('redraft.published', { count: publishedCount }) : null} />

      {redraft?.drops ? (
        <div className="space-y-2">
          <h3 className="font-heading font-semibold text-poke-text-primary">{t('redraft.drops')}</h3>
          {redraft.drops.length === 0 ? (
            <p className={HINT}>{t('redraft.noDrops')}</p>
          ) : (
            <ul className="space-y-1">
              {redraft.drops.map((drop) => {
                const slot = restorableSlotFor(slots, drop);
                return (
                  <li
                    key={`${drop.player_id}:${drop.line_id}`}
                    className="flex flex-wrap items-center gap-2 border-t border-poke-border pt-1 text-sm"
                  >
                    <span className="font-semibold">{nameOf(drop.player_id)}</span>
                    <span>{text.label(drop.line_id)}</span>
                    <span className={HINT}>{t('redraft.transferred', { n: drop.transferred_real_kills })}</span>
                    {slot ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRestoreSlot(slot);
                          setRestoreReason('');
                          restoreCall.clearError();
                        }}
                      >
                        {t('redraft.restore')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <InlineNotice text={restored ? t('redraft.restored') : null} />
        </div>
      ) : null}

      <ArmedConfirmDialog
        open={publishOpen}
        title={t('redraft.publishTitle')}
        body={t('redraft.publishBody')}
        confirmLabel={t('redraft.publish')}
        confirmVariant={primary.variant}
        confirmClassName={primary.className}
        submitting={publishCall.busy}
        error={publishCall.error ? errorText(publishCall.error) : null}
        onConfirm={publish}
        onCancel={() => {
          setPublishOpen(false);
          publishCall.clearError();
        }}
      />

      <ArmedConfirmDialog
        open={restoreSlot !== null}
        title={t('redraft.restoreTitle', restoreParams)}
        body={t('redraft.restoreBody', restoreParams)}
        confirmLabel={t('redraft.restore')}
        confirmVariant={primary.variant}
        confirmClassName={primary.className}
        confirmDisabled={!reasonValid(restoreReason)}
        submitting={restoreCall.busy}
        error={restoreCall.error ? errorText(restoreCall.error) : null}
        onConfirm={restore}
        onCancel={() => {
          setRestoreSlot(null);
          restoreCall.clearError();
        }}
      >
        <ReasonField value={restoreReason} onChange={setRestoreReason} />
      </ArmedConfirmDialog>
    </div>
  );
}
