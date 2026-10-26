import type { Metadata } from 'next';
import AdminGuard from '@/components/shared/AdminGuard';
import LibraryCard from '@/components/studio-shell/library/LibraryCard';
import FormatLibraryList from '@/components/format-studio/starts/FormatLibraryList';
import type { LibraryEntry } from '@/components/studio-shell/library/LibraryList';
import NewFormatDialog from '@/components/format-studio/starts/NewFormatDialog';
import Badge from '@/components/ui/Badge';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { formatReads } from '@/lib/cache/format-reads';
import { describeCoverage, describeDefinition } from '@/lib/format-kit/client';
import { resolveLText } from '@/lib/studio-core/ltext';
import type { Locale } from '@/i18n/config';
import type { FormatActor } from '@/lib/format-studio/access';
import type { FormatDefinitionSummary } from '@/lib/format-studio/library-types';
import { loadLeagueFormatSummaries, presetViews } from '@/lib/format-studio/loader';
import { listFormatDefinitions } from '@/lib/supabase/queries/format-definitions';
import { getAdminSeasonIds } from '@/lib/supabase/queries/resource-admins';
import { listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getLocale, getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import type { Translator } from '@/i18n/core';
import { enumMessages } from '@/i18n/messages/enums';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(formatStudioAdminMessages);
  return { title: t('meta.galleryTitle') };
}

/** The most leagues the list shows (`listSeasons` caps at the same number). */
const LEAGUE_LIMIT = 100;
/** The most stored formats each list shows. */
const FORMAT_LIMIT = 50;

type EditorT = Translator<typeof formatStudioEditorMessages.en>;

/** One card of a list of stored formats: its name, state badges and where it leads. */
function libraryEntry(item: FormatDefinitionSummary, locale: Locale, t: EditorT, own: boolean): LibraryEntry {
  const description = item.description === null ? '' : (resolveLText(item.description, { viewer: locale })?.value ?? '');
  const badges: LibraryEntry['badges'][number][] = [
    item.current_version === null
      ? { label: t('list.state.draft'), variant: 'gray' }
      : { label: t('list.state.published', { n: item.current_version.version_no }), variant: 'green' },
  ];
  if (item.visibility === 'league') badges.push({ label: t('list.state.shared'), variant: 'blue' });
  if (item.visibility === 'gallery') badges.push({ label: t('list.state.gallery'), variant: 'accent' });
  return {
    id: item.id,
    href: own ? `/admin/formats/${item.id}/edit` : `/admin/formats/${item.id}`,
    title: resolveLText(item.name, { viewer: locale })?.value ?? item.slug,
    lines: [description, !own && item.owner !== null ? t('list.by', { name: item.owner.name }) : ''].filter((line) => line !== ''),
    badges,
    openLabel: own ? t('list.edit') : t('list.open'),
  };
}

/**
 * `/admin/formats`: the Format Studio home. The "New format" action, the three example formats, the viewer's own
 * stored formats ("Your formats"), the ones other admins shared ("Shared with you") and "Your leagues" with the
 * format each league's phases and settings add up to. Any admin may open it; a site admin sees every active
 * league, a resource admin only their own (tournament-only admins see the examples, their formats and an empty
 * league list). Standalone tournaments are not listed. Nothing is read before the live gate. The dialog gets
 * names and ids only: no draft, no owner id, no player row.
 */
export default async function FormatsGalleryPage() {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, tEnum, tEditor, locale] = await Promise.all([
    getT(formatStudioAdminMessages),
    getT(enumMessages),
    getT(formatStudioEditorMessages),
    getLocale(),
  ]);
  const actor: FormatActor = { playerId: access.player.playerId, isAdmin: access.isSiteAdmin };

  const found = access.isSiteAdmin
    ? await listSeasons({ includeTestSeasons: true })
    : await listSeasonsByIds(await getAdminSeasonIds(access.player.playerId), { archived: false });
  // `listSeasons` stops at the limit itself, so reaching it means there may be more.
  const capped = found.length >= LEAGUE_LIMIT;
  const [summaries, mine, shared, gallery] = await Promise.all([
    loadLeagueFormatSummaries(found.slice(0, LEAGUE_LIMIT)),
    listFormatDefinitions({ actor, scope: 'mine', limit: FORMAT_LIMIT, offset: 0 }),
    listFormatDefinitions({ actor, scope: 'shared', limit: FORMAT_LIMIT, offset: 0 }),
    formatReads.gallery(),
  ]);

  const examples = presetViews().flatMap(({ id, view }) => {
    if (view.definition === null) return [];
    const doc = describeDefinition(view.definition, locale, {
      plan: view.plan ?? undefined,
      order: view.order,
      rulesets: view.rulesets,
    });
    return [{ id, doc }];
  });

  const dialogData = {
    examples: examples.map(({ id, doc }) => ({ id, name: doc.title })),
    gallery: gallery.map((item) => ({
      id: item.id,
      name: resolveLText(item.name, { viewer: locale })?.value ?? item.slug,
      version: item.version_no,
    })),
    leagues: summaries.filter((league) => league.stageCount > 0).map((league) => ({ id: league.id, name: league.name })),
  };

  return (
    <AdminGuard>
      <PageContainer title={t('title')} subtitle={t('subtitle')} maxWidth="lg" action={<NewFormatDialog data={dialogData} />}>
        <section className="space-y-3" aria-labelledby="formats-examples">
          <h2 id="formats-examples" className="font-heading text-lg font-bold text-poke-text-primary">
            {t('gallery.heading')}
          </h2>
          <p className="text-sm text-poke-text-secondary">{t('gallery.intro')}</p>
          <p className="text-sm text-poke-text-muted">{t('gallery.readOnlyNote')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {examples.map(({ id, doc }) => (
              <LibraryCard
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

        <section className="space-y-3" aria-labelledby="formats-yours">
          <h2 id="formats-yours" className="font-heading text-lg font-bold text-poke-text-primary">
            {tEditor('list.yours')}
          </h2>
          <p className="text-sm text-poke-text-secondary">{tEditor('list.yoursIntro')}</p>
          <FormatLibraryList
            entries={mine.items.map((item) => libraryEntry(item, locale, tEditor, true))}
            empty={<p className="text-poke-text-muted">{tEditor('list.emptyYours')}</p>}
          />
          {mine.total > mine.items.length && <p className="text-sm text-poke-text-muted">{tEditor('list.capNote', { count: FORMAT_LIMIT })}</p>}
        </section>

        <section className="space-y-3" aria-labelledby="formats-shared">
          <h2 id="formats-shared" className="font-heading text-lg font-bold text-poke-text-primary">
            {tEditor('list.shared')}
          </h2>
          <p className="text-sm text-poke-text-secondary">{tEditor('list.sharedIntro')}</p>
          <FormatLibraryList
            fork
            entries={shared.items.map((item) => libraryEntry(item, locale, tEditor, false))}
            empty={<p className="text-poke-text-muted">{tEditor('list.emptyShared')}</p>}
          />
          {shared.total > shared.items.length && (
            <p className="text-sm text-poke-text-muted">{tEditor('list.capNote', { count: FORMAT_LIMIT })}</p>
          )}
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
                  <LibraryCard
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
