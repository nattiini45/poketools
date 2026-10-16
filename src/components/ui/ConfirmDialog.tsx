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
}: ConfirmDialogProps) {
  const t = useT(uiMessages);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
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
