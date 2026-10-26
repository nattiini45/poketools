'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiOutcome } from '@/lib/studio-core/request';
import type { ShellText } from '../text';

interface ForkDialogBodyProps {
  text: ShellText;
  busy: boolean;
  error: ApiErrorLike | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** What a fork does, with its confirm and cancel buttons and the error of a failed fork. */
export function ForkDialogBody({ text, busy, error, onConfirm, onClose }: ForkDialogBodyProps) {
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{text('fork.body')}</p>
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {text('save.cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} onClick={onConfirm}>
          {text('fork.confirm')}
        </Button>
      </div>
    </div>
  );
}

interface ForkDialogProps {
  text: ShellText;
  open: boolean;
  onClose: () => void;
  /** The studio's fork route; the answer names the new definition. */
  request: () => Promise<ApiOutcome<{ definition: { id: string } }>>;
  /** The fork exists: the editor opens it. */
  onForked: (newId: string) => void;
}

/** Forking from inside the editor: a private copy of the last published version, opened for editing. */
export default function ForkDialog({ text, open, onClose, request, onForked }: ForkDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const fork = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await request();
      if (outcome.ok) onForked(outcome.data.definition.id);
      else setError(outcome.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} size="sm" title={text('fork.title')}>
      <ForkDialogBody text={text} busy={busy} error={error} onConfirm={() => void fork()} onClose={onClose} />
    </Modal>
  );
}
