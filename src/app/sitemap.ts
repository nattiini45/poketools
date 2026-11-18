import type { MetadataRoute } from 'next';
import { publicReads } from '@/lib/cache/public-reads';
import { siteUrl } from '@/lib/site-url';
import { getWikiIndexRows, getWikiTeraTypes } from '@/lib/wiki/index-rows.server';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { phasePublicReads } from '@/lib/cache/phase-public-reads';
import { getStagesBySeasonIds } from '@/lib/supabase/queries/tournaments';
import { phaseHref } from '@/lib/league-phase/paths';

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

  const [leagues, tournaments, mode] = await Promise.all([
    publicReads.seasonList(), publicReads.tournamentList(), getPhaseRouteMode(),
  ]);
  const visibleLeagues = leagues.filter((league) => !league.is_test_season && !league.archived);
  const ids = visibleLeagues.map(league => league.id);
  const phases = mode === 'phase' ? Object.values(await phasePublicReads.bySeasonIds(ids)).flat()
    : mode === 'legacy' ? [...(await getStagesBySeasonIds(ids)).values()].flat() : [];

  return [
    ...STATIC_PATHS.map(entry),
    ...detail('/pokemon', getWikiIndexRows('species')),
    ...detail('/wiki/moves', getWikiIndexRows('moves')),
    ...detail('/wiki/abilities', getWikiIndexRows('abilities')),
    ...detail('/wiki/items', getWikiIndexRows('items')),
    ...getWikiTeraTypes().map((type) => entry(`/wiki/tera/${encodeURIComponent(type)}`)),
    ...visibleLeagues.map((league) => entry(`/leagues/${league.id}`)),
    ...phases.flatMap(phase => phase.archived || phase.season_id === null
      ? [] : [entry(phaseHref({ season_id: phase.season_id, phase_id: phase.id }))]),
    ...tournaments.filter((tournament) => !tournament.archived && !tournament.season_id).map((tournament) => entry(`/tournaments/${tournament.id}`)),
  ];
}
