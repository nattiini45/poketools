import AdminGuard from '@/components/shared/AdminGuard';
import FormatCard from '@/components/format-studio/FormatCard';
import Badge from '@/components/ui/Badge';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { describeCoverage, describeDefinition } from '@/lib/format-kit/client';
import { loadLeagueFormatSummaries, presetViews } from '@/lib/format-studio/loader';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getLocale, getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';

export const dynamic = 'force-dynamic';

/** The most leagues the list shows (`listSeasons` caps at the same number). */
const LEAGUE_LIMIT = 100;

/**
 * `/admin/formats`: the read-only Format Studio gallery. The three example formats, then "Your leagues" with the
 * format each league's phases and settings add up to. Any admin may open it; a site admin sees every active
 * league, a resource admin only their own (tournament-only admins see the examples and an empty league list).
 * Standalone tournaments are not listed. Nothing is read before the live gate, and nothing here writes.
 */
export default async function FormatsGalleryPage() {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, tEnum, locale] = await Promise.all([getT(formatStudioAdminMessages), getT(enumMessages), getLocale()]);

  const found = access.isSiteAdmin
    ? await listSeasons({ includeTestSeasons: true })
    : await listSeasonsByIds(await getAdminSeasonIds(access.player.playerId), { archived: false });
  // `listSeasons` stops at the limit itself, so reaching it means there may be more.
  const capped = found.length >= LEAGUE_LIMIT;
  const summaries = await loadLeagueFormatSummaries(found.slice(0, LEAGUE_LIMIT));

  const examples = presetViews().flatMap(({ id, view }) => {
    if (view.definition === null) return [];
    const doc = describeDefinition(view.definition, locale, {
      plan: view.plan ?? undefined,
      order: view.order,
      rulesets: view.rulesets,
    });
    return [{ id, doc }];
  });

  return (
    <AdminGuard>
      <PageContainer title={t('title')} subtitle={t('subtitle')} maxWidth="lg">
        <section className="space-y-3" aria-labelledby="formats-examples">
          <h2 id="formats-examples" className="font-heading text-lg font-bold text-poke-text-primary">
            {t('gallery.heading')}
          </h2>
          <p className="text-sm text-poke-text-secondary">{t('gallery.intro')}</p>
          <p className="text-sm text-poke-text-muted">{t('gallery.readOnlyNote')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {examples.map(({ id, doc }) => (
              <FormatCard
                key={id}
                href={`/admin/formats/example/${id}`}
                title={doc.title}
                lines={[doc.summary ?? '', doc.overview, doc.coverageLine].filter((line) => line !== '')}
                badges={<Badge variant="accent">{t('gallery.exampleBadge')}</Badge>}
                openLabel={t('gallery.open')}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="formats-leagues">
          <h2 id="formats-leagues" className="font-heading text-lg font-bold text-poke-text-primary">
            {t('leagues.heading')}
          </h2>
          <p className="text-sm text-poke-text-secondary">{t('leagues.intro')}</p>
          {summaries.length === 0 ? (
            <p className="text-poke-text-muted">{t('leagues.empty')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {summaries.map((league) => {
                const chain = league.pairings.map((kind) => enumLabel(tEnum, 'bracketType', kind)).join(' → ');
                return (
                  <FormatCard
                    key={league.id}
                    href={`/admin/formats/league/${league.id}`}
                    title={league.name}
                    lines={[chain, league.coverage ? describeCoverage(league.coverage, locale) : ''].filter((line) => line !== '')}
                    badges={
                      <>
                        <Badge>{enumLabel(tEnum, 'formatType', league.formatType)}</Badge>
                        {league.isTest && <Badge variant="yellow">{t('leagues.testBadge')}</Badge>}
                        {league.stageCount === 0 ? (
                          <Badge variant="gray">{t('leagues.noPhases')}</Badge>
                        ) : (
                          <Badge variant="gray">{t('leagues.stages', { count: league.stageCount })}</Badge>
                        )}
                        {league.errors > 0 && <Badge variant="red">{t('leagues.errors', { count: league.errors })}</Badge>}
                        {league.warnings > 0 && (
                          <Badge variant="yellow">{t('leagues.warnings', { count: league.warnings })}</Badge>
                        )}
                        {league.stageCount > 0 && league.errors === 0 && league.warnings === 0 && (
                          <Badge variant="green">{t('leagues.noProblems')}</Badge>
                        )}
                      </>
                    }
                    openLabel={t('gallery.open')}
                  />
                );
              })}
            </div>
          )}
          {capped && <p className="text-sm text-poke-text-muted">{t('leagues.capNote', { count: LEAGUE_LIMIT })}</p>}
        </section>
      </PageContainer>
    </AdminGuard>
  );
}
