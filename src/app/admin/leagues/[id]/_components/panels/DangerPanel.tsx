import SettingsSection from '@/components/admin/SettingsSection';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import { SEASON_DELETE_GROUPS } from '@/lib/league-admin/season-delete';
import { LEAGUE_ADMIN_DANGER_SECTION } from '@/lib/league-admin/tabs';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import type { SeasonWithDetails } from '@/types/season';
import type { LeagueAdminPanelContext } from './context';

/** What the tab reads of the page's context: the id, the live site-admin flag, the translator and two fields of the league row. */
export type DangerPanelContext = Pick<LeagueAdminPanelContext, 'id' | 'isSiteAdmin' | 't'> & { league: Pick<SeasonWithDetails, 'name' | 'archived'> };

/**
 * Danger zone, the last section of the Settings sheet (`#danger-zone`; `?tab=danger` opens Settings there):
 * archive / unarchive (any league admin) and delete (site admins only, decided from the live access check).
 * No read of its own. Both buttons confirm before they act.
 *
 * The delete hint says that the league moves to the trash (the superadmin
 * can restore it for `LEAGUE_TRASH_RETENTION_DAYS`), what the trash keeps a
 * copy of, what is recalculated and what stays; a delete is never refused for
 * what the league holds. The lists follow the trash inventory
 * (`src/lib/league-admin/season-delete.ts`, checked against the migrations).
 */
export async function dangerPanel({ id, league, isSiteAdmin, t }: DangerPanelContext) {
  return (
    <SettingsSection id={LEAGUE_ADMIN_DANGER_SECTION} icon="rocky-helmet" title={t('danger.title')} tone="danger">
      <div className="divide-y divide-hairline">
        <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-subtitle font-[550] text-fg">{t('danger.archiveTitle')}</h3>
            <p className="max-w-[68ch] text-body text-fg-muted">{t('danger.archiveHint')}</p>
          </div>
          <div className="shrink-0">
            <ArchiveButton resourceType="season" resourceId={id} isArchived={league.archived} />
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-2 text-body text-fg-muted" data-season-delete-hint>
            <h3 className="text-subtitle font-[550] text-fg">{t('danger.deleteTitle')}</h3>
            {isSiteAdmin ? (
              <>
                <p>{t('danger.deleteIntro', { days: LEAGUE_TRASH_RETENTION_DAYS })}</p>
                <details className="rounded-poke-md border border-hairline bg-elevated">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 font-[550] text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:min-h-9">
                    {t('danger.deletesSummary', { count: SEASON_DELETE_GROUPS.length })}
                  </summary>
                  <ul className="flex list-disc flex-col gap-0.5 border-t border-hairline py-3 pl-8 pr-3">
                    {SEASON_DELETE_GROUPS.map((group) => (
                      <li key={group}>{t(`danger.deletes.${group}`)}</li>
                    ))}
                  </ul>
                </details>
                <p>{t('danger.deleteDerived')}</p>
                <p>{t('danger.deleteUnlinked')}</p>
                <p>{t('danger.deleteKept')}</p>
                <p className="font-[550] text-fg">{t('danger.deleteFinal')}</p>
              </>
            ) : (
              <p>{t('danger.deleteSiteAdminOnly')}</p>
            )}
          </div>
          {isSiteAdmin && (
            <div className="shrink-0">
              <DeleteResourceButton
                resourceType="season"
                resourceId={id}
                resourceName={league.name}
                redirectTo="/admin/leagues"
              />
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
