import Section from '@/components/ui/Section';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import { SEASON_DELETE_GROUPS } from '@/lib/league-admin/season-delete';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import type { SeasonWithDetails } from '@/types/season';
import type { LeagueAdminPanelContext } from './context';

/** What the tab reads of the page's context: the id, the live site-admin flag, the translator and two fields of the league row. */
export type DangerPanelContext = Pick<LeagueAdminPanelContext, 'id' | 'isSiteAdmin' | 't'> & { league: Pick<SeasonWithDetails, 'name' | 'archived'> };

/**
 * Danger zone tab: archive / unarchive (any league admin) and delete (site
 * admins only, decided from the live access check). No read of its own. Both
 * buttons confirm before they act.
 *
 * The delete hint says that the league moves to the trash (the superadmin
 * can restore it for `LEAGUE_TRASH_RETENTION_DAYS`), what the trash keeps a
 * copy of, what is recalculated and what stays; a delete is never refused for
 * what the league holds. The lists follow the trash inventory
 * (`src/lib/league-admin/season-delete.ts`, checked against the migrations).
 */
export async function dangerPanel({ id, league, isSiteAdmin, t }: DangerPanelContext) {
  return (
    <Section title={t('danger.title')}>
      <div className="divide-y divide-poke-border">
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{t('danger.archiveTitle')}</h3>
            <p className="text-sm text-poke-text-muted">{t('danger.archiveHint')}</p>
          </div>
          <div className="shrink-0">
            <ArchiveButton resourceType="season" resourceId={id} isArchived={league.archived} />
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2 text-sm text-poke-text-muted" data-season-delete-hint>
            <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{t('danger.deleteTitle')}</h3>
            {isSiteAdmin ? (
              <>
                <p>{t('danger.deleteIntro', { days: LEAGUE_TRASH_RETENTION_DAYS })}</p>
                <details className="rounded-poke-md border border-poke-border bg-poke-base">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium text-poke-text-secondary sm:min-h-9">
                    {t('danger.deletesSummary', { count: SEASON_DELETE_GROUPS.length })}
                  </summary>
                  <ul className="list-disc space-y-0.5 border-t border-poke-border py-3 pl-8 pr-3">
                    {SEASON_DELETE_GROUPS.map((group) => (
                      <li key={group}>{t(`danger.deletes.${group}`)}</li>
                    ))}
                  </ul>
                </details>
                <p>{t('danger.deleteDerived')}</p>
                <p>{t('danger.deleteUnlinked')}</p>
                <p>{t('danger.deleteKept')}</p>
                <p className="font-medium text-poke-text-secondary">{t('danger.deleteFinal')}</p>
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
    </Section>
  );
}
