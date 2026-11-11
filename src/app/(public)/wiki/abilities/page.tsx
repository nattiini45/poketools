import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import AbilitiesIndexClient, { type AbilityRow } from './AbilitiesIndexClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('index.title.abilities') };
}

export default async function WikiAbilitiesIndexPage() {
  const [t, locale] = await Promise.all([getT(wikiMessages), getLocale()]);
  // Locale-neutral rows from the module memo; the German game text is swapped in after the lookup.
  const abilities: AbilityRow[] = getWikiIndexRows('abilities').map((row) => {
    const desc = localizeDesc('ability', row.name, row.desc, locale);
    return {
      name: row.name,
      desc: desc.text,
      descFallback: locale === 'de' && desc.lang === 'en' && row.desc !== '',
      rating: row.rating,
      earliestGen: row.earliestGen,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('index.title.abilities')}</h1>
      <Suspense fallback={null}>
        <AbilitiesIndexClient data={abilities} />
      </Suspense>
    </div>
  );
}
