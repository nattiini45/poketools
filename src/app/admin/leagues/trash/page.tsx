import Link from 'next/link';
import SuperadminGuard from '@/components/shared/SuperadminGuard';
import LeagueTrashPanel from '@/components/league-trash/LeagueTrashPanel';
import PageContainer from '@/components/ui/PageContainer';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { getLiveAccess } from '@/lib/auth/helpers';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import {
  headlineCounts,
  isSchemaChanged,
  type LeagueTrashPendingView,
  type LeagueTrashRowView,
} from '@/lib/league-trash/client';
import {
  getLeagueTrashSchemaVersion,
  listLeagueTrash,
  listPendingLeagueRebuilds,
} from '@/lib/supabase/queries/league-trash';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

/**
 * `/admin/leagues/trash`: the league recycle bin (superadmin only). Deleted leagues wait here for
 * `LEAGUE_TRASH_RETENTION_DAYS`; the superadmin restores one (`POST /api/admin/league-trash/[id]/restore`) or runs the
 * derived-data rebuild a delete or restore left pending (`.../rebuild`). Gated by the live access read
 * (`getLiveAccess().isSuperadmin`, D37), and no trash data is read before the viewer is known to be the superadmin.
 * The rows never carry the captured league data, only its counts; "schema changed since delete" compares the version
 * stored at delete time with the current one.
 */
export default async function LeagueTrashPage() {
  const access = await getLiveAccess();
  if (!access?.isSuperadmin) return <SuperadminGuard>{null}</SuperadminGuard>;

  const [trash, pendingRebuilds, schemaVersion, t, tEnum] = await Promise.all([
    listLeagueTrash(),
    listPendingLeagueRebuilds(),
    getLeagueTrashSchemaVersion(),
    getT(leagueAdminMessages),
    getT(enumMessages),
  ]);

  const rows: LeagueTrashRowView[] = trash.map((entry) => ({
    id: entry.id,
    seasonId: entry.season_id,
    name: entry.season_name,
    formatLabel: enumLabel(tEnum, 'formatType', entry.format_type),
    deletedAt: entry.deleted_at,
    deletedByName: entry.deleted_by_name,
    purgeAfter: entry.purge_after,
    counts: headlineCounts(entry.counts),
    rebuildPending: entry.rebuild_pending,
    schemaChanged: isSchemaChanged(entry.schema_version, schemaVersion),
  }));
  const pending: LeagueTrashPendingView[] = pendingRebuilds.map((item) => ({
    kind: item.kind,
    trashId: item.trash_id,
    seasonId: item.season_id,
    name: item.season_name,
    at: item.at,
  }));

  return (
    <SuperadminGuard>
      <PageContainer
        title={t('trash.title')}
        subtitle={t('trash.subtitle', { days: LEAGUE_TRASH_RETENTION_DAYS })}
        maxWidth="xl"
        action={
          <Link href="/admin/leagues" className={`${getButtonClasses('ghost', 'sm')} min-h-11 sm:min-h-0`}>
            {t('trash.back')}
          </Link>
        }
      >
        <LeagueTrashPanel rows={rows} pending={pending} />
      </PageContainer>
    </SuperadminGuard>
  );
}
