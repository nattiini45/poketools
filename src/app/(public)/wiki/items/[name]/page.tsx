import type { Metadata } from 'next';
import { itemMetadata } from '@/lib/seo/wiki-metadata';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/helpers';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { getWikiItemDetail } from '@/lib/wiki/index-rows.server';
import { localizeWikiEntry } from '@/lib/wiki/localize-entry.server';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import WikiItemContent from '@/components/wiki/WikiItemContent';
import WikiNotesSection from '@/components/wiki/WikiNotesSection';
import { WikiBackLink } from '@/components/wiki/WikiParts';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  return itemMetadata(decodeURIComponent(name));
}

export default async function WikiItemPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  // Locale-neutral entry from the bounded module memo; translated below, after the lookup.
  const item = getWikiItemDetail(decodedName);

  if (!item) {
    notFound();
  }

  const [t, locale, dataLocale, session] = await Promise.all([
    getT(wikiMessages),
    getLocale(),
    getDataLocale(),
    getSession(),
  ]);
  const { entry, descFallback } = localizeWikiEntry('item', item, locale);
  const notes = session
    ? await getApprovedNotes('item', item.name).catch(() => [])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <WikiBackLink href="/wiki/items" label={t('back.items')} />

      <WikiItemContent item={entry} locale={locale} dataLocale={dataLocale} descFallback={descFallback} />

      <WikiNotesSection
        entityType="item"
        entityName={item.name}
        notes={notes}
        unauthenticated={!session}
      />
    </div>
  );
}
