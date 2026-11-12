'use client';

import { useId, useState, type ReactNode } from 'react';
import AdminDialog from '@/components/admin/AdminDialog';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { MATCH_REASON_MAX_LENGTH } from '@/lib/admin/match-detail';

interface ReasonDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed reason. */
  onConfirm: (reason: string) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  loading?: boolean;
  /** Keeps the confirm button off for a reason other than a missing reason (e.g. an impact still loading). */
  confirmDisabled?: boolean;
  reasonLabel: string;
  reasonPlaceholder?: string;
  /** Text the field starts with each time the dialog opens. */
  initialReason?: string;
  /** What the action will change, shown above the reason field. */
  children?: ReactNode;
  /** A failure of the action, shown above the buttons. */
  error?: ReactNode;
  /** Confirm stays disabled until the trimmed reason is not empty. */
  reasonRequired?: boolean;
  maxLength?: number;
}

/** Whether the confirm button may fire for `reason`. */
export function canConfirmReason(reason: string, required: boolean): boolean {
  return !required || reason.trim().length > 0;
}

/**
 * A confirmation that asks for a short reason, for admin actions that leave an
 * audit trail (match reset, game delete, reopen). Not a `ConfirmDialog`
 * variant: that component serves many callers and has no input slot.
 */
export default function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmVariant = 'danger',
  loading = false,
  confirmDisabled = false,
  reasonLabel,
  reasonPlaceholder,
  initialReason = '',
  children,
  error,
  reasonRequired = true,
  maxLength = MATCH_REASON_MAX_LENGTH,
}: ReasonDialogProps) {
  const t = useT(uiMessages);
  const tMatch = useT(adminMatchMessages);
  const fieldId = useId();
  const requiredId = `${fieldId}-required`;
  const counterId = `${fieldId}-counter`;
  const [reason, setReason] = useState(initialReason);
  const [wasOpen, setWasOpen] = useState(open);

  // A fresh field every time the dialog opens: the last reason belongs to the last action.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason(initialReason);
  }

  function close() {
    if (!loading) onClose();
  }

  const missing = !canConfirmReason(reason, reasonRequired);
  const showRequired = reasonRequired && missing;

  return (
    <AdminDialog open={open} onClose={close} title={title} size="md">
      <p className="mb-4 text-body text-fg">{message}</p>
      {children && <div className="mb-4 flex flex-col gap-2 text-body text-fg-muted">{children}</div>}
      <Textarea
        id={fieldId}
        label={reasonLabel}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={maxLength}
        rows={3}
        disabled={loading}
        placeholder={reasonPlaceholder}
        aria-required={reasonRequired}
        aria-describedby={showRequired ? `${requiredId} ${counterId}` : counterId}
      />
      <div className="mb-4 mt-1 flex justify-between gap-3 text-caption tabular-nums text-fg-muted">
        <span id={requiredId}>{showRequired ? tMatch('reason.required') : ''}</span>
        <span id={counterId}>{tMatch('reason.counter', { count: reason.length, max: maxLength })}</span>
      </div>
      {error && <div className="mb-4">{error}</div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={close} disabled={loading} className="max-sm:min-h-11">
          {t('confirmDialog.cancel')}
        </Button>
        <Button
          variant={confirmVariant}
          size="sm"
          onClick={() => onConfirm(reason.trim())}
          loading={loading}
          disabled={missing || confirmDisabled}
          className="max-sm:min-h-11"
        >
          {confirmLabel ?? t('confirmDialog.confirm')}
        </Button>
      </div>
    </AdminDialog>
  );
}
