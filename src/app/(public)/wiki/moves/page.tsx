import { Suspense } from 'react';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { getWikiIndexRows } from '@/lib/wiki/index-rows.server';
import MovesIndexClient from './MovesIndexClient';

export default async function WikiMovesIndexPage() {
  const t = await getT(wikiMessages);
  // Locale-neutral rows, built once per server instance; the client localizes names, types and categories.
  const moves = getWikiIndexRows('moves');

  return (
    <div className="space-y-6">
      <Link
        href="/wiki"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.wiki')}
      </Link>
      <h1 className="font-heading text-3xl font-bold text-poke-text-primary">
        {t('index.title.moves')}
      </h1>
      <Suspense fallback={null}>
        <MovesIndexClient data={moves} />
      </Suspense>
    </div>
  );
}
