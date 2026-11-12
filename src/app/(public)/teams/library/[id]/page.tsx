import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDataLocale, getFormatter, getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { metaMessages } from '@/i18n/messages/meta';
import { loadLibraryEntry } from '@/lib/team/page-loaders';
import { speciesList } from '@/lib/team/page-text';
import SkewChip from '@/components/ui/SkewChip';
import TeamSheet from '../../TeamSheet';
import ForkButton from './ForkButton';

/**
 * A published library entry: read-only, no sign-in; forking is the one client island. Server-rendered, so the roster
 * is in the first response. An unpublished or unknown id is a real 404 from the proxy (`src/lib/seo/page-gate.ts`);
 * `notFound()` here covers an entry unpublished in between.
 */

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const result = await loadLibraryEntry(id);
  if (result.status !== 'ok') return {};

  const [t, meta, dataLocale] = await Promise.all([getT(teamsLibraryMessages), getT(metaMessages), getDataLocale()]);
  const title = result.entry.library_title || t('library.untitled');
  const description = t('entry.metaDescription', { species: speciesList(result.entry.pokemon, dataLocale) });
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', siteName: meta('title') },
  };
}

export default async function LibraryEntryPage({ params }: Params) {
  const { id } = await params;
  const result = await loadLibraryEntry(id);
  if (result.status !== 'ok') notFound();

  const { entry } = result;
  const [t, formatter, dataLocale] = await Promise.all([getT(teamsLibraryMessages), getFormatter(), getDataLocale()]);

  return (
    <TeamSheet
      title={entry.library_title || t('library.untitled')}
      description={entry.library_description}
      action={<ForkButton teamId={entry.id} label={t('entry.fork')} busyLabel={t('entry.forking')} />}
      meta={
        <>
          {entry.library_tags?.map((tag) => <SkewChip key={tag}>{tag}</SkewChip>)}
          <span className="text-caption text-fg-muted">
            {t('library.published', { date: formatter.instant(entry.library_published_at, 'date') })}
          </span>
        </>
      }
      sets={entry.pokemon}
      t={t}
      dl={dataLocale}
    />
  );
}
