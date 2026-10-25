import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listTournaments, listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getAdminTournamentIds } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
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
  const [t, tc, te] = await Promise.all([
    getT(tournamentsAdminMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);

  return (
    <AdminGuard>
      <PageContainer
        title={t('list.title')}
        maxWidth="md"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/tournaments/archived" className={getButtonClasses('ghost', 'sm')}>
              {t('list.viewArchived')}
            </Link>
            <Link href="/admin/tournaments/new" className={getButtonClasses('secondary', 'sm')}>
              {t('list.newTournament')}
            </Link>
          </div>
        }
      >
        {tournaments.length === 0 ? (
          <p className="text-poke-text-muted">{t('list.empty')}</p>
        ) : (
          <div className="grid gap-3">
            {tournaments.map((tournament) => (
              <Link key={tournament.id} href={`/admin/tournaments/${tournament.id}/rounds`}>
                <Card hover>
                  <h2 className="font-heading font-semibold text-poke-text-primary">{tournament.name}</h2>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge>{enumLabel(te, 'bracketType', tournament.bracket_type)}</Badge>
                    <Badge variant="blue">{tc('bestOf', { count: tournament.best_of_default })}</Badge>
                    {tournament.is_doubles && <Badge variant="purple">{t('list.doubles')}</Badge>}
                    <Badge variant="gray">{tournament.ruleset_name}</Badge>
                    <Badge variant="gray">{tc('units.players', { count: tournament.participant_count })}</Badge>
                    <Badge variant="green">{enumLabel(te, 'tournamentStatus', tournament.status)}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
