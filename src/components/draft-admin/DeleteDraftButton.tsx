'use client';

/**
 * "Delete draft": a destructive button behind an armed confirm, for an Initial draft that has not started
 * (`draftDeletable`). Deleting it frees the group again, so the groups can change and the draft can be created
 * anew. Shared by the live controls (control page and room sheet) and the group cards of the league admin's Draft
 * tab, which pass their own `onDelete`: it resolves to the error to show, or null once the pool is gone (the
 * caller then navigates or refreshes, the dialog closes either way).
 */
import { useState } from 'react';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { useDestructiveButton } from './admin-ui';
import { useAdminCall, type AdminResult } from './use-admin-call';

export default function DeleteDraftButton({ onDelete }: { onDelete(): AdminResult }) {
  const t = useT(draftAdminMessages);
  const errorText = useApiErrorText(errorsDraft);
  const destructive = useDestructiveButton();
  const call = useAdminCall();
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    call.clearError();
  };

  const confirm = async () => {
    const ok = await call.run(onDelete);
    if (ok) close();
  };

  return (
    <>
      <Button variant={destructive.variant} className={destructive.className} onClick={() => setOpen(true)}>
        {t('live.delete')}
      </Button>
      <ArmedConfirmDialog
        open={open}
        title={t('live.deleteTitle')}
        body={t('live.deleteBody')}
        confirmLabel={t('live.delete')}
        confirmVariant={destructive.variant}
        confirmClassName={destructive.className}
        submitting={call.busy}
        error={call.error ? errorText(call.error) : null}
        onConfirm={confirm}
        onCancel={close}
      />
    </>
  );
}
