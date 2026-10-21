import Section from '@/components/ui/Section';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import { getFormatter } from '@/i18n/server';
import {
  SEASON_DELETE_BLOCKER_GROUPS,
  SEASON_DELETE_GROUPS,
} from '@/lib/league-admin/season-delete';
import type { LeagueAdminPanelContext } from './context';

/**
 * Danger zone tab: archive / unarchive (any league admin) and delete (site
 * admins only, decided from the live access check). No read of its own. Both
 * buttons confirm before they act.
 *
 * The delete hint says what the delete takes with it, what refuses it and
 * what it keeps, as the schema's foreign keys decide it
 * (`src/lib/league-admin/season-delete.ts`, checked against the migrations).
 */
export async function dangerPanel({ id, league, isSiteAdmin, t }: LeagueAdminPanelContext) {
  const f = await getFormatter();
  const blockers = f.list(SEASON_DELETE_BLOCKER_GROUPS.map((group) => t(`danger.blockers.${group}`)));
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
                <p>{t('danger.deleteIntro')}</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {SEASON_DELETE_GROUPS.map((group) => (
                    <li key={group}>{t(`danger.deletes.${group}`)}</li>
                  ))}
                </ul>
                <p>{t('danger.deleteBlocked', { list: blockers })}</p>
                <p>{t('danger.deleteUnlinked')}</p>
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
