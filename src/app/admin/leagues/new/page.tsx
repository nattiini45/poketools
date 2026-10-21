import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import LeagueCreator from '@/components/league/LeagueCreator';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { getT } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

export default async function NewLeaguePage() {
  const [rulesets, t] = await Promise.all([listRulesets(), getT(leagueAdminMessages)]);

  return (
    <AdminGuard>
      <PageContainer title={t('create.title')} maxWidth="md">
        <LeagueCreator rulesets={rulesets} />
      </PageContainer>
    </AdminGuard>
  );
}
