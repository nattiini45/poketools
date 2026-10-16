import { Suspense } from 'react';
import Link from 'next/link';
import { getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import ItemsIndexClient, { type ItemRow } from './ItemsIndexClient';

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
    <div className="space-y-6">
      <Link
        href="/wiki"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.wiki')}
      </Link>
      <h1 className="font-heading text-3xl font-bold text-poke-text-primary">
        {t('index.title.items')}
      </h1>
      <Suspense fallback={null}>
        <ItemsIndexClient data={items} />
      </Suspense>
    </div>
  );
}
