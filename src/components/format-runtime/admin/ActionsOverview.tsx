'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { actionWindowMachine } from '@/lib/format-engine/runtime/action-state';
import { applyAdjustmentRequest } from '@/lib/format-engine/runtime/client-api-admin';
import type { ActionWindow, AdminActionView } from '@/lib/format-engine/runtime/view-types';
import { BUTTON_TOUCH, labelText } from './admin-shared';
import ReasonDialog from './ReasonDialog';
import { useAdminRequest } from './useAdminRequest';
import { useStatusFocus } from './useStatusFocus';

const WINDOW_VARIANT: Record<ActionWindow, 'green' | 'gray' | 'yellow'> = {
  open: 'green',
  locked: 'gray',
  not_open_yet: 'yellow',
};

export interface ActionsOverviewProps {
  seasonId: string;
  actions: readonly AdminActionView[];
  /** The format allows `action` adjustments: Open and Lock are offered. */
  canAdjust: boolean;
}

interface Pending {
  action: AdminActionView;
  state: 'open' | 'locked';
}

/**
 * The player actions of the format: the window each is in, how many players can act and how many have not picked, have a
 * draft, have submitted or are locked. Open and Lock record an `action` adjustment, so they ask for a reason. Locking runs
 * the follow-up of the format (`action_locked`) at once, or on the next cron pass when it cannot complete now. What each
 * player picked stays behind the audited unmask of the relations section.
 */
export default function ActionsOverview({ seasonId, actions, canAdjust }: ActionsOverviewProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const { pending, errorMessage, run, refresh, clearError } = useAdminRequest();
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [done, setDone] = useState<Pending | null>(null);
  const { statusRef, focusOnClose, onCloseAutoFocus } = useStatusFocus();

  function close() {
    setDialog(null);
    clearError();
  }

  async function confirm(reason: string) {
    if (dialog === null) return;
    setDone(null);
    const out = await run(() =>
      applyAdjustmentRequest(seasonId, { reason, adjustment: { kind: 'action', action: dialog.action.id, state: dialog.state } }),
    );
    if (!out.ok) return;
    // The refreshed page disables the button that opened the dialog (Open or Lock): focus goes to the status line, not to <body>.
    focusOnClose();
    setDone(dialog);
    setDialog(null);
    refresh();
  }

  if (actions.length === 0) {
    return <p className="text-sm text-poke-text-muted">{t('actions.empty')}</p>;
  }

  const name = (action: AdminActionView): string => labelText(action.label, locale, action.id);

  return (
    <div className="space-y-4" data-live-actions>
      <p className="text-sm text-poke-text-secondary">{t('actions.intro')}</p>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-poke-green focus:outline-none">
        {done !== null ? t(done.state === 'open' ? 'actions.done.open' : 'actions.done.locked', { action: name(done.action) }) : ''}
      </div>
      <ul className="space-y-3">
        {actions.map((action) => (
          <li key={action.id} className="space-y-3 rounded-poke-md border border-poke-border bg-poke-surface p-4" data-action-id={action.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{name(action)}</h3>
              <Badge variant={WINDOW_VARIANT[action.window]}>{t(`actions.window.${action.window}`)}</Badge>
              <Badge variant="gray">{t(`actions.lockMode.${action.lock}`)}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
              <Count label={t('actions.counts.actors')} value={action.actors} />
              <Count label={t('actions.counts.missing')} value={action.counts.missing} />
              <Count label={t('actions.counts.draft')} value={action.counts.draft} />
              <Count label={t('actions.counts.submitted')} value={action.counts.submitted} />
              <Count label={t('actions.counts.locked')} value={action.counts.locked} />
            </dl>
            {canAdjust && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className={BUTTON_TOUCH}
                  disabled={pending || !actionWindowMachine.can(action.window, 'open', 'admin')}
                  aria-label={t('actions.openAria', { action: name(action) })}
                  onClick={() => setDialog({ action, state: 'open' })}
                >
                  {t('actions.open')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className={BUTTON_TOUCH}
                  disabled={pending || !actionWindowMachine.can(action.window, 'locked', 'admin')}
                  aria-label={t('actions.lockAria', { action: name(action) })}
                  onClick={() => setDialog({ action, state: 'locked' })}
                >
                  {t('actions.lock')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!canAdjust && <Alert variant="info">{t('actions.notAllowed')}</Alert>}

      <ReasonDialog
        open={dialog !== null}
        onClose={close}
        title={dialog === null ? '' : t(dialog.state === 'open' ? 'actions.openTitle' : 'actions.lockTitle', { action: name(dialog.action) })}
        message={
          dialog === null ? null : (
            <>
              <p>{t(dialog.state === 'open' ? 'actions.openBody' : 'actions.lockBody')}</p>
              {dialog.state === 'locked' && <p>{t('actions.lockFollowUp')}</p>}
            </>
          )
        }
        confirmLabel={dialog?.state === 'locked' ? t('actions.lock') : t('actions.open')}
        error={errorMessage}
        pending={pending}
        onConfirm={(reason) => void confirm(reason)}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-heading text-poke-text-muted">{label}</dt>
      <dd className="text-poke-text-primary">{value}</dd>
    </div>
  );
}
