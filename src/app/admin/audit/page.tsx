import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import AuditLogBrowser from './AuditLogBrowser';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { extensionAuditActionLabels } from '@/lib/pack-extensions';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const [t, extensionActionLabels] = await Promise.all([getT(adminToolsMessages), extensionAuditActionLabels()]);
  return (
    <SiteAdminGuard>
      <PageContainer
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        action={(
          <Link href="/admin">
            <Button variant="secondary" size="sm">{t('backToAdmin')}</Button>
          </Link>
        )}
        maxWidth="xl"
      >
        <AuditLogBrowser extensionActionLabels={extensionActionLabels} />
      </PageContainer>
    </SiteAdminGuard>
  );
}