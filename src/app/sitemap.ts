import type { MetadataRoute } from 'next';
import { publicReads } from '@/lib/cache/public-reads';
import { siteUrl } from '@/lib/site-url';
import { getWikiIndexRows, getWikiTeraTypes } from '@/lib/wiki/index-rows.server';

// Read at request time: `next build` runs with a placeholder database URL, so a prerendered sitemap would be built
// from nothing (or fail). The league and tournament lists come from the 60 s tagged read cache.
export const dynamic = 'force-dynamic';

const STATIC_PATHS = [
  '/',
  '/leagues',
  '/tournaments',
  '/insights',
  '/wiki',
  '/wiki/pokemon',
  '/wiki/moves',
  '/wiki/items',
  '/wiki/abilities',
  '/wiki/tera',
] as const;

/**
 * Public pages worth announcing: the static hubs, every wiki and Pokémon detail page (local data, about 3,000 URLs,
 * far below the 50,000 limit), and the non-test, non-archived leagues and standalone tournaments. Player profiles are
 * left out on purpose (they name community members and are `noindex`), and so are test and archived leagues.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const entry = (path: string): MetadataRoute.Sitemap[number] => ({ url: new URL(path, origin).toString() });
  const detail = (prefix: string, rows: readonly { name: string }[]) =>
    rows.map((row) => entry(`${prefix}/${encodeURIComponent(row.name)}`));

  const [leagues, tournaments] = await Promise.all([publicReads.seasonList(), publicReads.tournamentList()]);

  return [
    ...STATIC_PATHS.map(entry),
    ...detail('/pokemon', getWikiIndexRows('species')),
    ...detail('/wiki/moves', getWikiIndexRows('moves')),
    ...detail('/wiki/abilities', getWikiIndexRows('abilities')),
    ...detail('/wiki/items', getWikiIndexRows('items')),
    ...getWikiTeraTypes().map((type) => entry(`/wiki/tera/${encodeURIComponent(type)}`)),
    ...leagues.filter((league) => !league.is_test_season && !league.archived).map((league) => entry(`/leagues/${league.id}`)),
    ...tournaments.filter((tournament) => !tournament.archived).map((tournament) => entry(`/tournaments/${tournament.id}`)),
  ];
}
