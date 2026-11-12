import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import CompetitionList from '@/components/admin/competitions/CompetitionList';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import { getLiveAccess } from '@/lib/auth/helpers';
import { toLeagueRow } from '@/lib/admin/competition-list';
import { listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminCompetitionsMessages } from '@/i18n/messages/admin-competitions';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

export default async function AdminLeaguesPage() {
  // Live roles (not the session copy), and no data read before we know the viewer is an admin.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, tc, tEnum] = await Promise.all([getT(leagueAdminMessages), getT(adminCompetitionsMessages), getT(enumMessages)]);

  // Site admin: every active league. Resource admin: only their own, and not the archived ones.
  const leagues = access.isSiteAdmin
    ? await listSeasons({ includeTestSeasons: true })
    : await listSeasonsByIds(await getAdminSeasonIds(access.player.playerId), { archived: false });

  const rows = leagues.map((league) =>
    toLeagueRow(league, {
      formatLabel: enumLabel(tEnum, 'formatType', league.format_type),
      statusLabel: enumLabel(tEnum, 'seasonStatus', league.status),
      detail: t('list.stages', { count: league.tournament_count }),
    }),
  );

  return (
    <AdminGuard>
      <PageContainer
        title={t('list.title')}
        maxWidth="xl"
        action={
          <Button asChild variant="primary" size="sm" className="min-h-11 sm:min-h-0">
            <Link href="/admin/leagues/new">{tc('new.league')}</Link>
          </Button>
        }
      >
        <CompetitionList kind="league" view="active" rows={rows} canViewTrash={access.isSuperadmin} />
      </PageContainer>
    </AdminGuard>
  );
}
