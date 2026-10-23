import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import AchievementDefinitionsManager from './AchievementDefinitionsManager';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminAchievementsPage() {
  const t = await getT(adminToolsMessages);
  return (
    <SiteAdminGuard>
      <PageContainer title={t('achievements.title')} maxWidth="xl">
        <p className="text-sm text-poke-text-secondary mb-6">
          {t('achievements.intro')}
        </p>
        <AchievementDefinitionsManager />
      </PageContainer>
    </SiteAdminGuard>
  );
}
