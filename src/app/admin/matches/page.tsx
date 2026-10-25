import { Suspense } from 'react';
import AdminGuard from '@/components/shared/AdminGuard';
import AdminMatchList from '@/components/admin/AdminMatchList';
import { getLiveAccess, getSession, isSuperadmin } from '@/lib/auth/helpers';
import PageContainer from '@/components/ui/PageContainer';
import Skeleton from '@/components/ui/Skeleton';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminMatchesPage() {
  const t = await getT(adminCoreMessages);
  // Submit Result and View Prep open player-dashboard pages that admit only some viewers, so the
  // list needs to know who is looking (src/lib/admin/match-row-actions.ts).
  const [access, session] = await Promise.all([getLiveAccess(), getSession()]);
  const viewer = access
    ? {
        playerId: access.player?.playerId ?? null,
        isSiteAdmin: access.isSiteAdmin,
        isSuperadmin: isSuperadmin(session),
      }
    : null;
  return (
    <AdminGuard>
      <PageContainer title={t('matches.listTitle')}>
        {/* The list keeps its filters in the query string (useSearchParams). */}
        <Suspense fallback={<Skeleton height="72px" rounded="lg" />}>
          <AdminMatchList viewer={viewer} />
        </Suspense>
      </PageContainer>
    </AdminGuard>
  );
}
