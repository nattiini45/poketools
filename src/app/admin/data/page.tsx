import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import AdminDataTools from './AdminDataTools';
import FormatDriftReport from './FormatDriftReport';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminDataPage() {
  const t = await getT(adminToolsMessages);
  return (
    <SiteAdminGuard>
      <PageContainer
        title={t('data.title')}
        subtitle={t('data.subtitle')}
        action={(
          <Link href="/admin">
            <Button variant="secondary" size="sm">{t('backToAdmin')}</Button>
          </Link>
        )}
        maxWidth="xl"
      >
        <div className="space-y-6">
          <AdminDataTools />
          <FormatDriftReport />
        </div>
      </PageContainer>
    </SiteAdminGuard>
  );
}