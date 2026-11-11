import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import MovesIndexClient from './MovesIndexClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('index.title.moves') };
}

export default async function WikiMovesIndexPage() {
  const t = await getT(wikiMessages);
  // Locale-neutral rows, built once per server instance; the client localizes names, types and categories.
  const moves = getWikiIndexRows('moves');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('index.title.moves')}</h1>
      <Suspense fallback={null}>
        <MovesIndexClient data={moves} />
      </Suspense>
    </div>
  );
}
