'use client';

import { useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import { forkFormatRequest, type FetchLike } from '@/lib/format-studio/editor/api';

interface ForkDialogBodyProps {
  busy: boolean;
  error: ApiErrorLike | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** What a fork does, with its confirm and cancel buttons and the error of a failed fork. */
export function ForkDialogBody({ busy, error, onConfirm, onClose }: ForkDialogBodyProps) {
  const t = useT(formatStudioEditorMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{t('fork.body')}</p>
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t('save.cancel')}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} onClick={onConfirm}>
          {t('fork.confirm')}
        </Button>
      </div>
    </div>
  );
}

interface ForkDialogProps {
  open: boolean;
  onClose: () => void;
  definitionId: string;
  /** The fork exists: the editor opens it. */
  onForked: (newId: string) => void;
  fetchImpl?: FetchLike;
}

/** Forking from inside the editor: a private copy of the last published version, opened for editing. */
export default function ForkDialog({ open, onClose, definitionId, onForked, fetchImpl }: ForkDialogProps) {
  const t = useT(formatStudioEditorMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const fork = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await forkFormatRequest(definitionId, fetchImpl);
      if (outcome.ok) onForked(outcome.data.definition.id);
      else setError(outcome.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} size="sm" title={t('fork.title')}>
      <ForkDialogBody busy={busy} error={error} onConfirm={() => void fork()} onClose={onClose} />
    </Modal>
  );
}
