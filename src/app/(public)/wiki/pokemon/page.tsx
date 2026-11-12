import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import PokemonIndexClient from './PokemonIndexClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('index.title.pokemon') };
}

export default async function WikiPokemonIndexPage() {
  const t = await getT(wikiMessages);
  // Locale-neutral rows, built once per server instance; the client localizes names and sorts by them.
  const data = getWikiIndexRows('species');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('index.title.pokemon')}</h1>
      <Suspense fallback={null}>
        <PokemonIndexClient data={data} />
      </Suspense>
    </div>
  );
}
