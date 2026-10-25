import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import { getT } from '@/i18n/server';
import { adminTestPlayersMessages } from '@/i18n/messages/admin-test-players';
import TestPlayersConsole from './TestPlayersConsole';

export const dynamic = 'force-dynamic';

export default async function AdminTestPlayersPage() {
  const t = await getT(adminTestPlayersMessages);
  return (
    <SiteAdminGuard>
      <PageContainer
        title={t('page.title')}
        subtitle={t('page.subtitle')}
        action={(
          <Link href="/admin">
            <Button variant="secondary" size="sm">{t('page.back')}</Button>
          </Link>
        )}
        maxWidth="xl"
      >
        <TestPlayersConsole />
      </PageContainer>
    </SiteAdminGuard>
  );
}
