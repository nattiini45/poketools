import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import AdminDashboardContent from './AdminDashboardContent';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { extensionAuditActionLabels } from '@/lib/pack-extensions';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [t, extensionActionLabels] = await Promise.all([getT(adminCoreMessages), extensionAuditActionLabels()]);
  return (
    <AdminGuard>
      <PageContainer title={t('dashboard.title')} maxWidth="xl">
        {/* Live dashboard */}
        <AdminDashboardContent extensionActionLabels={extensionActionLabels} />

      </PageContainer>
    </AdminGuard>
  );
}