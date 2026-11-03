import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDataLocale, getFormatter, getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { metaMessages } from '@/i18n/messages/meta';
import { loadLibraryEntry } from '@/lib/team/page-loaders';
import { speciesList } from '@/lib/team/page-text';
import TeamSetCard from '../../TeamSetCard';
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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-1">
          {entry.library_title || t('library.untitled')}
        </h1>
        {entry.library_description && (
          <p className="text-sm text-poke-text-muted mb-3">{entry.library_description}</p>
        )}
        <div className="flex items-center gap-3">
          {entry.library_tags?.map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 bg-poke-muted rounded text-poke-text-secondary">
              {tag}
            </span>
          ))}
          <span className="text-[10px] text-poke-text-muted ml-auto">
            {t('library.published', { date: formatter.instant(entry.library_published_at, 'date') })}
          </span>
        </div>
      </div>

      <div className="mb-6">
        <ForkButton teamId={entry.id} label={t('entry.fork')} busyLabel={t('entry.forking')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {entry.pokemon.map((set, i) => (
          <TeamSetCard key={i} set={set} index={i} t={t} dl={dataLocale} />
        ))}
      </div>
    </div>
  );
}