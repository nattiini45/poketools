import { requireLivePlayerOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { packExtensions } from '@/lib/pack-extensions';
import PageContainer from '@/components/ui/PageContainer';
import AgentSettingsForm from '@/components/player/AgentSettingsForm';
import PushDevicesCard from '@/components/player/PushDevicesCard';
import AccountSecuritySection from '@/components/player/AccountSecuritySection';
import WorldExperienceSection from '@/components/player/WorldExperienceSection';
import { SettingsSaveProvider } from '@/components/player/settings-save';
import { LanguageSettingsSection } from '@/components/shared/LanguagePicker';
import SpriteStyleSettingsSection from './SpriteStyleSettingsSection';
import { getT } from '@/i18n/server';
import { discordOAuthEnabled } from '@/lib/env';
import { commonMessages } from '@/i18n/messages/common';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireLivePlayerOrSignIn();
  const t = await getT(commonMessages);
  // Pack extensions (docs/format-packs.md): absent in the example pack.
  const ExtensionSettingsSection = packExtensions.SettingsSection;

  return (
    <PageContainer
      title={t('settingsPage.title')}
      subtitle={t('settingsPage.subtitle')}
      maxWidth="sm"
    >
      {/* Each section keeps its own write path; the provider draws the page's one save bar over them. */}
      <SettingsSaveProvider>
        <div className="flex flex-col gap-5">
          <AccountSecuritySection discordEnabled={discordOAuthEnabled()} />
          <WorldExperienceSection />
          {ExtensionSettingsSection && <ExtensionSettingsSection />}
          <LanguageSettingsSection />
          <SpriteStyleSettingsSection />
          <PushDevicesCard />
          <AgentSettingsForm />
        </div>
      </SettingsSaveProvider>
    </PageContainer>
  );
}
