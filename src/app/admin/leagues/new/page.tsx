import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import LeagueCreator from '@/components/league/LeagueCreator';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
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

  const [t, sources] = await Promise.all([getT(leagueAdminMessages), listCloneSourceOptions(sourceScope)]);
  // A league started from another one takes over its ruleset pin, which may be an older version than the newest: the select
  // keeps those versions so the cloned choice is shown as what it is.
  const rulesets = await listRulesetOptionsFor({
    actor: { playerId: access.player.playerId, isAdmin: access.isSiteAdmin },
    seasonId: null,
    keep: sources.map((source) => source.ruleset_id),
  });

  return (
    <AdminGuard>
      <PageContainer title={t('create.title')} maxWidth="md">
        <LeagueCreator rulesets={rulesets} sources={sources} isSiteAdmin={access.isSiteAdmin} />
      </PageContainer>
    </AdminGuard>
  );
}
