import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import ItemsIndexClient, { type ItemRow } from './ItemsIndexClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('index.title.items') };
}

export default async function WikiItemsIndexPage() {
  const [t, locale] = await Promise.all([getT(wikiMessages), getLocale()]);
  // Locale-neutral rows from the module memo; the German game text is swapped in after the lookup.
  const items: ItemRow[] = getWikiIndexRows('items').map((row) => {
    const desc = localizeDesc('item', row.name, row.desc, locale);
    return {
      name: row.name,
      desc: desc.text,
      descFallback: locale === 'de' && desc.lang === 'en' && row.desc !== '',
      earliestGen: row.earliestGen,
      category: row.category,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('index.title.items')}</h1>
      <Suspense fallback={null}>
        <ItemsIndexClient data={items} />
      </Suspense>
    </div>
  );
}
