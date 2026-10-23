import SiteAdminGuard from '@/components/shared/SiteAdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import RulesetBuilder from '@/components/ruleset/RulesetBuilder';
import { getT } from '@/i18n/server';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

export const dynamic = 'force-dynamic';

export default async function NewRulesetPage() {
  const t = await getT(adminToolsMessages);
  return (
    <SiteAdminGuard>
      <PageContainer title={t('rulesets.createTitle')} maxWidth="md">
        <RulesetBuilder />
      </PageContainer>
    </SiteAdminGuard>
  );
}
