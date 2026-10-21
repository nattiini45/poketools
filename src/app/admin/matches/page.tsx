import AdminGuard from '@/components/shared/AdminGuard';
import AdminMatchList from '@/components/admin/AdminMatchList';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminMatchesPage() {
  const t = await getT(adminCoreMessages);
  return (
    <AdminGuard>
      <PageContainer title={t('matches.listTitle')}>
        <AdminMatchList />
      </PageContainer>
    </AdminGuard>
  );
}
