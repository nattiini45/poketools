'use client';

/**
 * "Create Redraft" (BE #1, season-scoped): an armed confirm, and a "create
 * anyway" box once the server answers REDRAFT_NOT_YET_ALLOWED. Bound to the
 * season's Initial draft pool (the control page and the room's admin sheet
 * both pass that pool's `AdminDraftActions`). A success refreshes the route,
 * so the new Redraft pool appears (control page tab, room `?pool=` choice).
 *
 * League groups: the actions carry the pool's group (`createAdminDraftActions(…, seasonGroupId)`), so the
 * Redraft is that group's; `groupName` names the group on the button and in the confirm.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import ArmedConfirmDialog from '@/components/draft-tool/shared/ArmedConfirmDialog';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import type { AdminDraftActions } from './admin-actions';
import { HINT, InlineNotice, usePrimaryButton } from './admin-ui';
import { useAdminCall } from './use-admin-call';

export default function CreateRedraft({
  actions,
  groupName = null,
}: {
  actions: AdminDraftActions;
  /** League groups: the display name of the group whose Redraft this creates (null without groups). */
  groupName?: string | null;
}) {
  const t = useT(draftAdminMessages);
  const primary = usePrimaryButton();
  const errorText = useApiErrorText(errorsDraft);
  const router = useRouter();
  const forceId = useId();
  const call = useAdminCall();
  const [open, setOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [created, setCreated] = useState(false);
  const label = groupName ? t('panel.createRedraftForGroup', { group: groupName }) : t('panel.createRedraft');

  const confirm = async () => {
    const ok = await call.run(async () => {
      const res = await actions.createRedraft(force);
      if (res.ok) return null;
      if (res.error.code === 'REDRAFT_NOT_YET_ALLOWED') setNeedsForce(true);
      return res.error;
    });
    if (ok) {
      setOpen(false);
      setCreated(true);
      router.refresh();
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <InlineNotice text={created ? t('panel.redraftCreated') : null} />
      <ArmedConfirmDialog
        open={open}
        title={t('panel.createRedraftTitle')}
        body={groupName ? t('panel.createRedraftGroupBody', { group: groupName }) : t('panel.createRedraftBody')}
        confirmLabel={label}
        confirmVariant={primary.variant}
        confirmClassName={primary.className}
        submitting={call.busy}
        error={call.error ? errorText(call.error) : null}
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          call.clearError();
        }}
      >
        {needsForce ? (
          <div className="space-y-1">
            <p className={HINT}>{t('panel.createRedraftNotYet')}</p>
            <label htmlFor={forceId} className="flex min-h-[44px] items-center gap-2 text-sm text-poke-text-primary md:min-h-0">
              <input id={forceId} type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t('panel.createRedraftForce')}
            </label>
          </div>
        ) : null}
      </ArmedConfirmDialog>
    </div>
  );
}
