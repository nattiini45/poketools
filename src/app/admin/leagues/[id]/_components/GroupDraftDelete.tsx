'use client';

import { useRouter } from 'next/navigation';
import { createAdminDraftActions } from '@/components/draft-admin/admin-actions';
import DeleteDraftButton from '@/components/draft-admin/DeleteDraftButton';

interface GroupDraftDeleteProps {
  seasonId: string;
  poolId: string;
  /** The group whose Initial draft this is; the card shows the button only while that draft has not started. */
  seasonGroupId: string;
}

/**
 * "Delete draft" on a group's card in the league admin's Draft tab, for an Initial draft that has not started
 * (`draftDeletable`, decided by the server component that renders this). Deleting it frees the group, so the groups
 * can change again and the draft can be created anew; the server render then shows the create form in its place.
 */
export default function GroupDraftDelete({ seasonId, poolId, seasonGroupId }: GroupDraftDeleteProps) {
  const router = useRouter();

  async function onDelete() {
    const res = await createAdminDraftActions(poolId, seasonId, seasonGroupId).deletePool();
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  }

  return <DeleteDraftButton onDelete={onDelete} />;
}
