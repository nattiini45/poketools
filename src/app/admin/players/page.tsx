import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import PlayerRoster from './PlayerRoster';
import { getSession, isSuperadmin } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

export default async function AdminPlayersPage() {
  const [session, t] = await Promise.all([getSession(), getT(adminCoreMessages)]);
  const canManageCreators = isSuperadmin(session);

  return (
    <AdminGuard>
      <PageContainer title={t('players.title')}>
        <PlayerRoster canManageCreators={canManageCreators} />
      </PageContainer>
    </AdminGuard>
  );
}
