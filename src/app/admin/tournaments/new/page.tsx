import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import TournamentCreator from './TournamentCreator';
import { getT } from '@/i18n/server';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage() {
  // Live roles, and no data read before we know the viewer is an admin: the ruleset select lists the viewer's own private
  // rulesets next to the shared ones.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [rulesets, t] = await Promise.all([
    listRulesetOptionsFor({ actor: { playerId: access.player.playerId, isAdmin: access.isSiteAdmin }, seasonId: null }),
    getT(tournamentsAdminMessages),
  ]);

  return (
    <AdminGuard>
      <PageContainer title={t('create.title')} maxWidth="md">
        <TournamentCreator rulesets={rulesets} />
      </PageContainer>
    </AdminGuard>
  );
}
