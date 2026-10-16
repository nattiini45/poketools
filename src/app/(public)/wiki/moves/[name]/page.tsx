import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth/helpers';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { getWikiMoveDetail } from '@/lib/wiki/index-rows.server';
import { localizeWikiEntry } from '@/lib/wiki/localize-entry.server';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import WikiMoveContent from '@/components/wiki/WikiMoveContent';
import WikiMoveUsageStats from '@/components/wiki/WikiMoveUsageStats';
import WikiNotesSection from '@/components/wiki/WikiNotesSection';

export default async function WikiMovePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  // Locale-neutral entry from the bounded module memo; translated below, after the lookup.
  const move = getWikiMoveDetail(decodedName);

  if (!move) {
    notFound();
  }

  const [t, locale, dataLocale, session] = await Promise.all([
    getT(wikiMessages),
    getLocale(),
    getDataLocale(),
    getSession(),
  ]);
  const { entry, descFallback } = localizeWikiEntry('move', move, locale);
  const notes = session
    ? await getApprovedNotes('move', move.name).catch(() => [])
    : [];

  return (
    <div className="space-y-8">
      <Link
        href="/wiki/moves"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.moves')}
      </Link>

      <WikiMoveContent move={entry} locale={locale} dataLocale={dataLocale} descFallback={descFallback} />

      {/* Battle Usage Stats */}
      <WikiMoveUsageStats moveName={move.name} />

      <hr className="border-poke-border" />

      <WikiNotesSection
        entityType="move"
        entityName={move.name}
        notes={notes}
        unauthenticated={!session}
      />
    </div>
  );
}
