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

interface ConflictDialogBodyProps {
  /** The revision the server holds. */
  serverRev: number;
  /** The editor has unsaved changes: reloading discards them, and the dialog asks once more. */
  dirty: boolean;
  /** `confirmReload`: the second step that says unsaved changes are discarded. */
  step: 'choose' | 'confirmReload';
  busy: boolean;
  error: ApiErrorLike | null;
  onReload: () => void;
  onConfirmReload: () => void;
  onKeepMine: () => void;
  onCancel: () => void;
}

/**
 * The choice after a save found a newer revision on the server: reload the server's version (discarding unsaved
 * edits after a second confirmation), keep mine and save over it, or cancel and decide later. The first button
 * takes focus.
 */
export function ConflictDialogBody({ serverRev, dirty, step, busy, error, onReload, onConfirmReload, onKeepMine, onCancel }: ConflictDialogBodyProps) {
  const t = useT(formatStudioEditorMessages);
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);
  const confirming = step === 'confirmReload' && dirty;

  return (
    <div className="space-y-4">
      <p className="text-sm text-poke-text-secondary">{t('save.conflictBody', { rev: serverRev })}</p>
      {confirming && <p className="text-sm font-semibold text-poke-text-primary">{t('save.reloadConfirm')}</p>}
      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t('save.cancel')}
        </Button>
        {confirming ? (
          <Button type="button" variant="danger" size="sm" autoFocus loading={busy} onClick={onConfirmReload}>
            {t('save.reloadDiscard')}
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" size="sm" autoFocus loading={busy} onClick={onReload}>
              {t('save.reload')}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={onKeepMine}>
              {t('save.keepMine')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface ConflictDialogProps {
  open: boolean;
  serverRev: number;
  dirty: boolean;
  /** Loads the server's draft; resolves with the error when that fails. */
  onReload: () => Promise<ApiErrorLike | null>;
  onKeepMine: () => void;
  /** Closes the dialog and leaves the conflict standing: Save reopens it. */
  onClose: () => void;
}

/**
 * The "changed elsewhere" dialog. Reload fetches the server's draft; with unsaved changes it asks once more
 * before throwing them away. Keep mine adopts the server's revision and saves again. Cancel closes the dialog
 * and leaves the conflict in place.
 */
export default function ConflictDialog({ open, serverRev, dirty, onReload, onKeepMine, onClose }: ConflictDialogProps) {
  const t = useT(formatStudioEditorMessages);
  const [step, setStep] = useState<'choose' | 'confirmReload'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const close = () => {
    setStep('choose');
    setError(null);
    onClose();
  };
  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      const failure = await onReload();
      if (failure === null) {
        setStep('choose');
        onClose();
      } else {
        setError(failure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} size="sm" title={t('save.conflictTitle')}>
      <ConflictDialogBody
        serverRev={serverRev}
        dirty={dirty}
        step={step}
        busy={busy}
        error={error}
        onReload={() => (dirty ? setStep('confirmReload') : void reload())}
        onConfirmReload={() => void reload()}
        onKeepMine={() => {
          setStep('choose');
          setError(null);
          onKeepMine();
        }}
        onCancel={close}
      />
    </Modal>
  );
}
