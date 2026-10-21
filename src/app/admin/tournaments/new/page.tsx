import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import TournamentCreator from './TournamentCreator';
import { getT } from '@/i18n/server';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage() {
  const [rulesets, t] = await Promise.all([listRulesets(), getT(tournamentsAdminMessages)]);

  return (
    <AdminGuard>
      <PageContainer title={t('create.title')} maxWidth="md">
        <TournamentCreator rulesets={rulesets} />
      </PageContainer>
    </AdminGuard>
  );
}
