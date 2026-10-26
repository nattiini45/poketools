'use client';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ShellText } from '../text';

interface DeleteDialogProps {
  text: ShellText;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

/** "Delete this draft?": a definition that was never published is deleted for good. */
export default function DeleteDialog({ text, open, onClose, onConfirm, loading }: DeleteDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={text('delete.title')}
      message={text('delete.body')}
      confirmLabel={text('delete.confirm')}
      loading={loading}
    />
  );
}
