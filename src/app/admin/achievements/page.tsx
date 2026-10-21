import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import AchievementDefinitionsManager from './AchievementDefinitionsManager';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminAchievementsPage() {
  const t = await getT(adminToolsMessages);
  return (
    <AdminGuard>
      <PageContainer title={t('achievements.title')} maxWidth="xl">
        <p className="text-sm text-poke-text-secondary mb-6">
          {t('achievements.intro')}
        </p>
        <AchievementDefinitionsManager />
      </PageContainer>
    </AdminGuard>
  );
}
