import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import PageContainer from '@/components/ui/PageContainer';
import DiscordWebhookManager from '@/components/discord/DiscordWebhookManager';
import SocialIntegrationManager from '@/components/social/SocialIntegrationManager';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function AdminSocialPage() {
  const t = await getT(adminToolsMessages);
  return (
    <SiteAdminGuard>
      <PageContainer title={t('social.title')} maxWidth="lg">
        <p className="mb-6 text-body text-fg-muted">
          {t('social.intro')}
        </p>

        <div className="space-y-10">
          <section aria-labelledby="social-discord-title" className="space-y-4">
            <div>
              <AdminSectionHeading id="social-discord-title" icon="old-amber" title={t('social.discordTitle')} />
              <p className="text-body text-fg-muted">
                {t('social.discordIntro')}
              </p>
            </div>
            <DiscordWebhookManager />
          </section>

          <section aria-labelledby="social-others-title" className="space-y-4">
            <div>
              <AdminSectionHeading id="social-others-title" icon="scope-lens" title={t('social.othersTitle')} />
              <p className="text-body text-fg-muted">
                {t('social.othersIntro')}
              </p>
            </div>
            <SocialIntegrationManager />
          </section>
        </div>
      </PageContainer>
    </SiteAdminGuard>
  );
}
