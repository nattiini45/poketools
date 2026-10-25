import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import LeagueCreator from '@/components/league/LeagueCreator';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { listCloneSourceOptions } from '@/lib/supabase/queries/season-clone';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

export default async function NewLeaguePage() {
  // Live roles (not the session copy), and no data read before we know the viewer is an admin.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  // Site admin: any league may be a source. Resource admin: only their own.
  const sourceScope = access.isSiteAdmin ? null : await getAdminSeasonIds(access.player.playerId);

  const [rulesets, t, sources] = await Promise.all([
    listRulesets(),
    getT(leagueAdminMessages),
    listCloneSourceOptions(sourceScope),
  ]);

  return (
    <AdminGuard>
      <PageContainer title={t('create.title')} maxWidth="md">
        <LeagueCreator rulesets={rulesets} sources={sources} isSiteAdmin={access.isSiteAdmin} />
      </PageContainer>
    </AdminGuard>
  );
}
