'use client';

import Modal from './Modal';
import Button from './Button';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  loading?: boolean;
  /** See `Modal`: where focus goes when the opener is gone or disabled by the time the dialog has closed. */
  onCloseAutoFocus?: (event: Event) => void;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmVariant = 'danger',
  loading = false,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const t = useT(uiMessages);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" onCloseAutoFocus={onCloseAutoFocus}>
      <p className="text-sm text-poke-text-secondary mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {t('confirmDialog.cancel')}
        </Button>
        <Button
          variant={confirmVariant}
          size="sm"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel ?? t('confirmDialog.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
