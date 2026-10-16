import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/helpers';
import PageContainer from '@/components/ui/PageContainer';
import AgentSettingsForm from '@/components/player/AgentSettingsForm';
import AccountSecuritySection from '@/components/player/AccountSecuritySection';
import WorldExperienceSection from '@/components/player/WorldExperienceSection';
import { LanguageSettingsSection } from '@/components/shared/LanguagePicker';
import { getT } from '@/i18n/server';
import { commonMessages } from '@/i18n/messages/common';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session?.player) redirect('/auth/signin');
  const t = await getT(commonMessages);

  return (
    <PageContainer
      title={t('settingsPage.title')}
      subtitle={t('settingsPage.subtitle')}
      maxWidth="md"
    >
      <AccountSecuritySection />
      <WorldExperienceSection />
      <LanguageSettingsSection />
      <AgentSettingsForm />
    </PageContainer>
  );
}
