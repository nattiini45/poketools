import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import AdminDataTools from './AdminDataTools';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminDataPage() {
  const t = await getT(adminToolsMessages);
  return (
    <AdminGuard>
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
        <AdminDataTools />
      </PageContainer>
    </AdminGuard>
  );
}