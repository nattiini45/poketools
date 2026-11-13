'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import { useT } from '@/i18n/client';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

/** The reason's length limit of a forced roster change (`reasonSchema` on the server). */
export const ROSTER_REASON_MAX_LENGTH = 500;

/**
 * Whether a failed roster request was refused because the phase belongs to the league's format and has started
 * (409 `format_phase_owned`). Only this refusal offers the forced change; every other failure is shown as it is.
 */
export function isFormatPhaseOwnedRefusal(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { success?: unknown }).success === false && (result as { code?: unknown }).code === 'format_phase_owned';
}

/** `body` plus the override the server reads: `force: true` and the reason (trimmed). */
export function withRosterForce<T extends object>(body: T, reason: string | undefined): T | (T & { force: true; reason: string }) {
  return reason === undefined ? body : { ...body, force: true, reason: reason.trim() };
}

interface RosterForceDialogProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/** The reason prompt of a forced roster change, the way a round with open matches is completed anyway. */
export function RosterForceDialog({ open, busy, onCancel, onConfirm }: RosterForceDialogProps) {
  const t = useT(tournamentsAdminMessages);
  const fieldId = useId();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={t('rosterForce.title')}
      size="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim()) onConfirm(reason.trim());
        }}
      >
        <p className="text-sm text-fg-muted">{t('rosterForce.message')}</p>
        <Textarea
          id={`${fieldId}-reason`}
          label={t('rosterForce.reasonLabel')}
          hint={t('rosterForce.reasonHint')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={ROSTER_REASON_MAX_LENGTH}
          required
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('rosterForce.cancel')}
          </Button>
          <Button type="submit" variant="danger" size="sm" loading={busy} disabled={!reason.trim()}>
            {t('rosterForce.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The prompt a roster screen opens after the server refused a change with `format_phase_owned`: `ask(run)` shows the dialog,
 * and `run(reason)` repeats the request with the reason once the admin confirmed. Nothing is sent without that
 * confirmation (no silent retry); cancelling drops the pending change. Render `dialog` once.
 */
export function useRosterForcePrompt(): { ask: (run: (reason: string) => Promise<void>) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<((reason: string) => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((run: (reason: string) => Promise<void>) => setPending(() => run), []);
  const dialog = (
    <RosterForceDialog
      key={pending === null ? 'closed' : 'open'}
      open={pending !== null}
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={(reason) => {
        if (pending === null) return;
        setBusy(true);
        // A failure of the repeated request shows in the screen's own error alert, which the open dialog would cover.
        void pending(reason).finally(() => {
          setBusy(false);
          setPending(null);
        });
      }}
    />
  );
  return { ask, dialog };
}
