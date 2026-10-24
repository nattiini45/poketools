import { Suspense } from 'react';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Skeleton from '@/components/ui/Skeleton';
import PlayerRoster from './PlayerRoster';
import { getSession, isSuperadmin } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage() {
  const [session, t] = await Promise.all([getSession(), getT(adminCoreMessages)]);
  const canManageCreators = isSuperadmin(session);

  return (
    <SiteAdminGuard>
      <PageContainer title={t('players.title')}>
        {/* The roster keeps its search, sort and page in the query string (useSearchParams). */}
        <Suspense fallback={<Skeleton height="72px" rounded="lg" />}>
          <PlayerRoster canManageCreators={canManageCreators} />
        </Suspense>
      </PageContainer>
    </SiteAdminGuard>
  );
}
