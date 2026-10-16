'use client';

/**
 * Blocked pick (draft-frontend §7.1): shown while `active_slot.status ===
 * 'blocked'`. The admin assigns a line (a `client_request_id` is minted per
 * dialog open and reused for retries) or forfeits the slot; both need a
 * reason, both go through `ArmedConfirmDialog`, and "resume afterwards" is on
 * by default.
 *
 * In a Redraft pool every pick fills one of the player's Redraft slots, and
 * the resolve RPC refuses an assign without `redraft_slot_id`
 * (`REDRAFT_SLOT_REQUIRED`). The admin therefore picks one of the active
 * player's open slots (`redraftSlots`, from the snapshot's typed
 * `redraft.admin_slots`). Before the drops are published that list is absent
 * and Assign waits for the publish; when the player has no open slot left,
 * Assign is disabled with a hint. Forfeit is always offered.
 */
import { useId, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId } from '@/types/draft-queue';
import { useLineText } from '@/components/draft-tokens/use-line-text';
import { FIELD, HINT, LABEL, ReasonField } from './admin-ui';
import {
  assignableRedraftSlots,
  availableLineIds,
  blockedResolveInput,
  reasonValid,
  type AdminRedraftSlot,
} from './admin-view';
import type { ResolveSlotInput } from './admin-actions';
import LineSelect from './LineSelect';
import { useAdminCall, type AdminResult } from './use-admin-call';

export interface BlockedSlotResolverProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  /** The pool's kind; a Redraft assign needs a Redraft slot. */
  poolKind: 'initial' | 'redraft';
  /** Every published Redraft slot (`adminRedraftSlots`); null = not published yet. */
  redraftSlots: AdminRedraftSlot[] | null;
  onResolve(slotId: string, input: ResolveSlotInput): AdminResult;
}

type Mode = 'assign' | 'forfeit';

export default function BlockedSlotResolver({
  vm,
  catalog,
  poolKind,
  redraftSlots,
  onResolve,
}: BlockedSlotResolverProps) {
  const t = useT(draftAdminMessages);
  const errorText = useApiErrorText(errorsDraft);
  const text = useLineText(catalog);
  const call = useAdminCall();
  const resumeId = useId();
  const slotFieldId = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [lineId, setLineId] = useState<LineId | ''>('');
  const [redraftSlotId, setRedraftSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [resume, setResume] = useState(true);
  const [requestId, setRequestId] = useState('');

  const slot = vm.activeSlot;
  const lines = useMemo(() => availableLineIds(catalog, vm.takenBy), [catalog, vm.takenBy]);
  if (!slot || slot.status !== 'blocked') return null;

  const isRedraft = poolKind === 'redraft';
  const openSlots = isRedraft ? assignableRedraftSlots(redraftSlots, slot.player_id) : null;
  const canAssign = !isRedraft || (openSlots !== null && openSlots.length > 0);
  const slotChosen = !isRedraft || (openSlots ?? []).some((s) => s.redraftSlotId === redraftSlotId);

  const open = (next: Mode) => {
    setMode(next);
    setLineId('');
    setRedraftSlotId(next === 'assign' && openSlots?.length === 1 ? openSlots[0].redraftSlotId : '');
    setReason('');
    setResume(true);
    // One id per dialog open; retries of the same dialog reuse it (idempotent).
    setRequestId(crypto.randomUUID());
    call.clearError();
  };
  const close = () => {
    setMode(null);
    call.clearError();
  };

  const confirm = async () => {
    if (!mode) return;
    const input = blockedResolveInput({ mode, isRedraft, lineId, redraftSlotId, reason, requestId, resume });
    if (!input) return;
    const ok = await call.run(() => onResolve(slot.slot_id, input));
    if (ok) setMode(null);
  };

  const params = { name: slot.playerName, pick: slot.pick_number };
  const title =
    mode === 'assign'
      ? t('blocked.assignTitle', { ...params, line: lineId ? text.label(lineId) : '…' })
      : t('blocked.forfeitTitle', params);

  return (
    <div className="space-y-3">
      <p className="text-sm text-poke-text-primary">{t('blocked.explain', params)}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open('assign')} disabled={!canAssign}>
          {t('blocked.assign')}
        </Button>
        <Button variant="secondary" onClick={() => open('forfeit')}>
          {t('blocked.forfeit')}
        </Button>
      </div>
      {isRedraft && !canAssign ? (
        <p className={HINT}>
          {openSlots === null ? t('blocked.redraftSlotsPending') : t('blocked.noOpenRedraftSlot', params)}
        </p>
      ) : null}

      <ArmedConfirmDialog
        open={mode !== null}
        title={title}
        body={mode === 'assign' ? t('blocked.assignBody', params) : t('blocked.forfeitBody')}
        confirmLabel={mode === 'assign' ? t('blocked.assign') : t('blocked.forfeit')}
        confirmVariant={mode === 'forfeit' ? 'danger' : 'primary'}
        confirmDisabled={!reasonValid(reason) || (mode === 'assign' && (!lineId || !slotChosen))}
        submitting={call.busy}
        error={call.error ? errorText(call.error) : null}
        onConfirm={confirm}
        onCancel={close}
      >
        <div className="space-y-3">
          {mode === 'assign' && isRedraft && openSlots ? (
            <div className="space-y-1">
              <label htmlFor={slotFieldId} className={LABEL}>
                {t('blocked.redraftSlot')}
              </label>
              <select
                id={slotFieldId}
                value={redraftSlotId}
                onChange={(e) => setRedraftSlotId(e.target.value)}
                className={FIELD}
              >
                <option value="">{t('blocked.chooseRedraftSlot')}</option>
                {openSlots.map((s) => (
                  <option key={s.redraftSlotId} value={s.redraftSlotId}>
                    {t('blocked.redraftSlotOption', { label: s.label, line: text.label(s.lineId) })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {mode === 'assign' ? (
            <LineSelect catalog={catalog} lineIds={lines} value={lineId} onChange={setLineId} label={t('blocked.line')} />
          ) : null}
          <ReasonField value={reason} onChange={setReason} />
          <label htmlFor={resumeId} className="flex items-center gap-2 text-sm text-poke-text-primary">
            <input id={resumeId} type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
            {t('blocked.resume')}
          </label>
        </div>
      </ArmedConfirmDialog>
    </div>
  );
}
