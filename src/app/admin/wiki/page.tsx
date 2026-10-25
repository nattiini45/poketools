import Link from 'next/link';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import WikiModerationPanel from './WikiModerationPanel';
import { getSession, isSuperadmin } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminWikiPage() {
  const [session, t] = await Promise.all([getSession(), getT(adminToolsMessages)]);
  // Display only: the PATCH route re-checks the superadmin before it blocks anything.
  const canBlockResubmission = isSuperadmin(session);
  return (
    <SiteAdminGuard>
      <PageContainer
        title={t('wiki.title')}
        subtitle={t('wiki.subtitle')}
        action={(
          <Link href="/admin">
            <Button variant="secondary" size="sm">{t('backToAdmin')}</Button>
          </Link>
        )}
        maxWidth="xl"
      >
        <WikiModerationPanel isSuperadmin={canBlockResubmission} />
      </PageContainer>
    </SiteAdminGuard>
  );
}