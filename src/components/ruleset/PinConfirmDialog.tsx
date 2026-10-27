'use client';

import type { ReactNode } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import PinImpactNotice from './PinImpactNotice';
import type { PinImpactState } from './use-pin-impact';

interface PinConfirmDialogProps {
  open: boolean;
  title: string;
  /** The sentences that say what is about to happen (already translated). */
  children: ReactNode;
  /** The version the move goes to. */
  version: number;
  /** The count of teams the move would invalidate; the confirm button waits while it is being counted. */
  impact: PinImpactState;
  /** The move is under way: both buttons rest. */
  busy: boolean;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation of a pin move for a league or phase that has already started, shared by the pin card and the usage panel.
 * It shows the caller's sentences, then how many already-submitted teams would stop being valid under the new version
 * (`PinImpactNotice`), and only then the choice. Confirm is held back while the count is being made, so the number is on
 * screen before the decision; a count that failed does not block the move (the server's confirmation still guards it).
 */
export default function PinConfirmDialog({
  open,
  title,
  children,
  version,
  impact,
  busy,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: PinConfirmDialogProps) {
  return (
    <Modal open={open} onClose={() => !busy && onCancel()} title={title} size="sm">
      <div className="space-y-4">
        {children}
        <PinImpactNotice state={impact} version={version} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" className="min-h-11 sm:min-h-0" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="min-h-11 sm:min-h-0"
            disabled={busy || impact.status === 'loading'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
