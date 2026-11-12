'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import { useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { BUTTON_TOUCH, TEXT_MAX, codePointLength } from './admin-shared';

/** Something the admin must type exactly before the confirm button works (an irreversible action). */
export interface TypedConfirmation {
  label: string;
  expected: string;
}

interface ReasonDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What the action does, in a sentence or two. */
  message: ReactNode;
  confirmLabel: string;
  /** The failed request's text, shown inside the dialog so the admin can retry or cancel. */
  error?: string | null;
  pending?: boolean;
  /** A typed confirmation next to the reason, for an action that cannot be undone. */
  typedConfirmation?: TypedConfirmation;
  onConfirm: (reason: string) => void;
  /** See `Modal`: where focus goes when the opener is gone or disabled by the time the dialog has closed. */
  onCloseAutoFocus?: (event: Event) => void;
}

/** The close handler while a request is in flight: nothing, so Escape, the X and a click outside cannot hide the outcome. */
function ignoreClose(): void {}

/**
 * A confirmation that asks for the reason an adjustment is recorded with. Every adjustment needs one (the server
 * refuses an empty reason), so the confirm button waits for it. The form is a child of the dialog content, so it is
 * mounted fresh on every open and neither the reason nor the typed confirmation carries over from an earlier use.
 *
 * The dialog cannot be closed while `pending`: the request's failure is shown inside it, so a dialog closed mid-flight
 * (Escape, the X, a click outside) would hide the failure of an irreversible action and the admin could not tell whether
 * it happened. Cancel is disabled for the same reason.
 */
export default function ReasonDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  error = null,
  pending = false,
  typedConfirmation,
  onConfirm,
  onCloseAutoFocus,
}: ReasonDialogProps) {
  return (
    <Modal open={open} onClose={pending ? ignoreClose : onClose} title={title} size="sm" onCloseAutoFocus={onCloseAutoFocus}>
      <ReasonForm
        message={message}
        confirmLabel={confirmLabel}
        error={error}
        pending={pending}
        typedConfirmation={typedConfirmation}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </Modal>
  );
}

interface ReasonFormProps {
  message: ReactNode;
  confirmLabel: string;
  error: string | null;
  pending: boolean;
  typedConfirmation: TypedConfirmation | undefined;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

function ReasonForm({ message, confirmLabel, error, pending, typedConfirmation, onClose, onConfirm }: ReasonFormProps) {
  const t = useT(formatRuntimeAdminMessages);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const counterId = useId();
  const trimmed = reason.trim();
  const length = codePointLength(trimmed);
  const tooLong = length > TEXT_MAX;
  const confirmed = typedConfirmation === undefined || typed.trim() === typedConfirmation.expected;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === '' || tooLong || !confirmed || pending) return;
    onConfirm(trimmed);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2 text-body text-fg-muted">{message}</div>
      {typedConfirmation !== undefined && (
        <Input
          label={typedConfirmation.label}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={pending}
          autoComplete="off"
        />
      )}
      <Textarea
        label={t('confirm.reasonLabel')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-describedby={counterId}
        disabled={pending}
        rows={3}
      />
      <p id={counterId} className={`text-caption ${tooLong ? 'text-loss' : 'text-fg-muted'}`}>
        {t('adjust.reason.counter', { used: length, max: TEXT_MAX })}
      </p>
      {error !== null && <Alert variant="error">{error}</Alert>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" className={BUTTON_TOUCH} onClick={onClose} disabled={pending}>
          {t('confirm.cancel')}
        </Button>
        <Button type="submit" variant="primary" size="sm" className={BUTTON_TOUCH} loading={pending} disabled={trimmed === '' || tooLong || !confirmed}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
