import { Suspense } from 'react';
import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Skeleton from '@/components/ui/Skeleton';
import PlayerRoster from './PlayerRoster';
import { isSuperadminNow } from '@/lib/auth/helpers';
import { resolveSuperadminPlayerId } from '@/lib/auth/superadmin';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage() {
  // Both controls follow the live decision the API routes make, not the up-to-5-minute-old token copy.
  // A failed read throws and the page errors instead of offering an action the API refuses.
  const [canManageCreators, t] = await Promise.all([isSuperadminNow(), getT(adminCoreMessages)]);
  const protectedPlayerId = canManageCreators ? null : await resolveSuperadminPlayerId();

  return (
    <SiteAdminGuard>
      <PageContainer title={t('players.title')}>
        {/* The roster keeps its search, sort and page in the query string (useSearchParams). */}
        <Suspense fallback={<Skeleton height="72px" rounded="lg" />}>
          <PlayerRoster canManageCreators={canManageCreators} protectedPlayerId={protectedPlayerId} />
        </Suspense>
      </PageContainer>
    </SiteAdminGuard>
  );
}
