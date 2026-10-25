import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { getLiveAccess } from '@/lib/auth/helpers';
import { listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

export default async function AdminLeaguesPage() {
  // Live roles (not the session copy), and no data read before we know the viewer is an admin.
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, tEnum, tCommon] = await Promise.all([
    getT(leagueAdminMessages),
    getT(enumMessages),
    getT(commonMessages),
  ]);

  // Site admin: every active league. Resource admin: only their own, and not the archived ones.
  const leagues = access.isSiteAdmin
    ? await listSeasons({ includeTestSeasons: true })
    : await listSeasonsByIds(await getAdminSeasonIds(access.player.playerId), { archived: false });

  return (
    <AdminGuard>
      <PageContainer
        title={t('list.title')}
        maxWidth="md"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/leagues/archived" className={getButtonClasses('ghost', 'sm')}>
              {t('list.viewArchived')}
            </Link>
            <Link href="/admin/leagues/new" className={getButtonClasses('secondary', 'sm')}>
              {t('list.newLeague')}
            </Link>
          </div>
        }
      >
        {leagues.length === 0 ? (
          <p className="text-poke-text-muted">{t('list.empty')}</p>
        ) : (
          <div className="grid gap-3">
            {leagues.map((l) => (
              <Link key={l.id} href={`/admin/leagues/${l.id}`}>
                <Card hover>
                  <h2 className="font-heading font-semibold text-poke-text-primary">{l.name}</h2>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge>{enumLabel(tEnum, 'formatType', l.format_type)}</Badge>
                    {l.ruleset_name && <Badge variant="gray">{l.ruleset_name}</Badge>}
                    <Badge variant="gray">{t('list.stages', { count: l.tournament_count })}</Badge>
                    <Badge variant="gray">{tCommon('units.players', { count: l.participant_count })}</Badge>
                    <Badge variant="green">{enumLabel(tEnum, 'seasonStatus', l.status)}</Badge>
                    {l.is_test_season && <Badge variant="yellow">{t('list.testBadge')}</Badge>}
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
