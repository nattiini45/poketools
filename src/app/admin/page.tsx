import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import AdminDashboardContent from './AdminDashboardContent';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const t = await getT(adminCoreMessages);
  return (
    <AdminGuard>
      <PageContainer title={t('dashboard.title')} maxWidth="xl">
        {/* Live dashboard */}
        <AdminDashboardContent />

      </PageContainer>
    </AdminGuard>
  );
}