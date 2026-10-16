import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import DiscordWebhookManager from '@/components/discord/DiscordWebhookManager';
import SocialIntegrationManager from '@/components/social/SocialIntegrationManager';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminSocialPage() {
  const t = await getT(adminToolsMessages);
  return (
    <AdminGuard>
      <PageContainer title={t('social.title')} maxWidth="lg">
        <p className="text-sm text-poke-text-secondary mb-6">
          {t('social.intro')}
        </p>

        <div className="space-y-10">
          <section className="space-y-4">
            <div>
              <h2 className="font-heading font-semibold text-lg text-poke-text-primary">
                {t('social.discordTitle')}
              </h2>
              <p className="text-sm text-poke-text-secondary">
                {t('social.discordIntro')}
              </p>
            </div>
            <DiscordWebhookManager />
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="font-heading font-semibold text-lg text-poke-text-primary">
                {t('social.othersTitle')}
              </h2>
              <p className="text-sm text-poke-text-secondary">
                {t('social.othersIntro')}
              </p>
            </div>
            <SocialIntegrationManager />
          </section>
        </div>
      </PageContainer>
    </AdminGuard>
  );
}
