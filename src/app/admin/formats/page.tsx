import type { Metadata } from 'next';
import AdminGuard from '@/components/shared/AdminGuard';
import LibraryCard from '@/components/studio-shell/library/LibraryCard';
import FormatLibraryList from '@/components/format-studio/starts/FormatLibraryList';
import type { LibraryEntry } from '@/components/studio-shell/library/LibraryList';
import NewFormatDialog from '@/components/format-studio/starts/NewFormatDialog';
import Link from 'next/link';
import AdminEmpty from '@/components/admin/AdminEmpty';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import GalleryTabs, { GalleryPanel } from '@/components/studio-shell/library/GalleryTabs';
import ForkPresetButton from '@/components/format-studio/starts/ForkPresetButton';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { wizardHref } from '@/lib/league-admin/wizard';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
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
 * `/admin/formats`: the Format Studio home. The "New format" action, then three gallery tabs (Yours: the viewer's own stored formats; Shared:
 * the ones other admins shared; Examples: the shipped examples, each with "Create a league from this" and "Copy to edit")
 * and "Your leagues" with the
 * format each league's phases and settings add up to. Any admin may open it; a site admin sees every active
 * league, a resource admin only their own (tournament-only admins see the examples, their formats and an empty
 * league list). Standalone tournaments are not listed. Nothing is read before the live gate. The dialog gets
 * names and ids only: no draft, no owner id, no player row.
 */
export default async function FormatsGalleryPage() {
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin || !access.player) return <AdminGuard>{null}</AdminGuard>;

  const [t, tLeague, tEnum, tEditor, locale] = await Promise.all([
    getT(formatStudioAdminMessages),
    getT(leagueAdminMessages),
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

  const newFormat = <NewFormatDialog data={dialogData} />;
  const heading = (id: string, text: string) => (
    <h2 id={id} className="font-heading text-title text-fg">
      {text}
    </h2>
  );

  const yours = (
    <section className="space-y-3" aria-labelledby="formats-yours">
      {heading('formats-yours', tEditor('list.yours'))}
      <p className="text-body text-fg-muted">{tEditor('list.yoursIntro')}</p>
      <FormatLibraryList
        entries={mine.items.map((item) => libraryEntry(item, locale, tEditor, true))}
        empty={
          <AdminEmpty title={tEditor('list.emptyTitle')} hint={tEditor('list.emptyYours')} data-formats-empty="yours">
            {newFormat}
          </AdminEmpty>
        }
      />
      {mine.total > mine.items.length && <p className="text-caption text-fg-muted">{tEditor('list.capNote', { count: FORMAT_LIMIT })}</p>}
    </section>
  );

  const sharedTab = (
    <section className="space-y-3" aria-labelledby="formats-shared">
      {heading('formats-shared', tEditor('list.shared'))}
      <p className="text-body text-fg-muted">{tEditor('list.sharedIntro')}</p>
      <FormatLibraryList
        fork
        entries={shared.items.map((item) => libraryEntry(item, locale, tEditor, false))}
        empty={<AdminEmpty title={tEditor('list.emptyShared')} icon="poke-doll" data-formats-empty="shared" />}
      />
      {shared.total > shared.items.length && <p className="text-caption text-fg-muted">{tEditor('list.capNote', { count: FORMAT_LIMIT })}</p>}
    </section>
  );

  const examplesTab = (
    <section className="space-y-3" aria-labelledby="formats-examples">
      {heading('formats-examples', t('gallery.heading'))}
      <p className="text-body text-fg-muted">{t('gallery.intro')}</p>
      <p className="text-caption text-fg-muted">{t('gallery.readOnlyNote')}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {examples.map(({ id, doc }) => (
          <li key={id} className="flex min-w-0 flex-col gap-2">
            <div className="min-w-0 flex-1">
              <LibraryCard
                href={`/admin/formats/example/${id}`}
                title={doc.title}
                lines={[doc.summary ?? '', doc.overview, doc.coverageLine].filter((line) => line !== '')}
                badges={<Badge variant="accent">{t('gallery.exampleBadge')}</Badge>}
                openLabel={t('gallery.open')}
              />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Button asChild variant="primary" size="sm" className="min-h-11 sm:min-h-0">
                <Link href={wizardHref({ preset: id })} aria-label={tLeague('wizard.fromExampleNamed', { name: doc.title })}>
                  {tLeague('wizard.fromExample')}
                </Link>
              </Button>
              <ForkPresetButton presetId={id} hint={false} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <AdminGuard>
      <PageContainer title={t('title')} subtitle={t('subtitle')} maxWidth="lg" action={newFormat}>
        <GalleryTabs label={t('tabs.label')} glideId="format-gallery">
          <GalleryPanel id="yours" label={t('tabs.yours')} count={mine.total}>
            {yours}
          </GalleryPanel>
          <GalleryPanel id="shared" label={t('tabs.shared')} count={shared.total}>
            {sharedTab}
          </GalleryPanel>
          <GalleryPanel id="examples" label={t('tabs.examples')} count={examples.length}>
            {examplesTab}
          </GalleryPanel>
        </GalleryTabs>

        <section className="space-y-3" aria-labelledby="formats-leagues">
          <AdminSectionHeading id="formats-leagues" icon="poke-ball" title={t('leagues.heading')} />
          <p className="text-body text-fg-muted">{t('leagues.intro')}</p>
          {summaries.length === 0 ? (
            <AdminEmpty title={t('leagues.empty')} data-formats-empty="leagues" />
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
          {capped && <p className="text-caption text-fg-muted">{t('leagues.capNote', { count: LEAGUE_LIMIT })}</p>}
        </section>
      </PageContainer>
    </AdminGuard>
  );
}
