import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import CompetitionList from '@/components/admin/competitions/CompetitionList';
import PageContainer from '@/components/ui/PageContainer';
import Button from '@/components/ui/Button';
import { getLiveAccess } from '@/lib/auth/helpers';
import { toTournamentRow } from '@/lib/admin/competition-list';
import { listTournaments, listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getAdminTournamentIds } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminCompetitionsMessages } from '@/i18n/messages/admin-competitions';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

export default async function AdminTournamentsPage() {
  // Live roles (not the session copy), and no data read before we know the viewer is an admin.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  // Site admin: every active standalone tournament. Resource admin: only their own, standalone
  // like the site admin list (league stages open from their league), and not the archived ones.
  const tournaments = access.isSiteAdmin
    ? await listTournaments()
    : await listTournamentsByIds(await getAdminTournamentIds(access.player.playerId), {
        archived: false,
        standaloneOnly: true,
      });
  const [t, tCommon, te, tList] = await Promise.all([
    getT(tournamentsAdminMessages),
    getT(commonMessages),
    getT(enumMessages),
    getT(adminCompetitionsMessages),
  ]);

  const rows = tournaments.map((tournament) =>
    toTournamentRow(tournament, {
      formatLabel: enumLabel(te, 'bracketType', tournament.bracket_type),
      statusLabel: enumLabel(te, 'tournamentStatus', tournament.status),
      detail: [tCommon('bestOf', { count: tournament.best_of_default }), tournament.is_doubles ? t('list.doubles') : null]
        .filter(Boolean)
        .join(' · '),
    }),
  );

  return (
    <AdminGuard>
      <PageContainer
        title={t('list.title')}
        maxWidth="xl"
        action={
          <Button asChild variant="primary" size="sm" className="min-h-11 sm:min-h-0">
            <Link href="/admin/tournaments/new">{tList('new.tournament')}</Link>
          </Button>
        }
      >
        <CompetitionList kind="tournament" view="active" rows={rows} />
      </PageContainer>
    </AdminGuard>
  );
}
