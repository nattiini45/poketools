import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/helpers';
import { packExtensions } from '@/lib/pack-extensions';
import PageContainer from '@/components/ui/PageContainer';
import AgentSettingsForm from '@/components/player/AgentSettingsForm';
import PushDevicesCard from '@/components/player/PushDevicesCard';
import AccountSecuritySection from '@/components/player/AccountSecuritySection';
import WorldExperienceSection from '@/components/player/WorldExperienceSection';
import { LanguageSettingsSection } from '@/components/shared/LanguagePicker';
import SpriteStyleSettingsSection from './SpriteStyleSettingsSection';
import { getT } from '@/i18n/server';
import { commonMessages } from '@/i18n/messages/common';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session?.player) redirect('/auth/signin');
  const t = await getT(commonMessages);
  // Pack extensions (docs/format-packs.md): absent in the example pack.
  const ExtensionSettingsSection = packExtensions.SettingsSection;

  return (
    <PageContainer
      title={t('settingsPage.title')}
      subtitle={t('settingsPage.subtitle')}
      maxWidth="md"
    >
      <AccountSecuritySection />
      <WorldExperienceSection />
      {ExtensionSettingsSection && <ExtensionSettingsSection />}
      <LanguageSettingsSection />
      <SpriteStyleSettingsSection />
      <PushDevicesCard />
      <AgentSettingsForm />
    </PageContainer>
  );
}
