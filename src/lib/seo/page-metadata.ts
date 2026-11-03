import type { Metadata } from 'next';
import { readLeague, readPlayerProfile, readTournament } from '@/lib/seo/page-reads';
import { NOINDEX } from '@/lib/seo/robots';

/**
 * Metadata of the league, tournament and player pages. A missing entity returns no title (the page calls
 * `notFound()`). A league or tournament description is never set: a league's phase gates decide what a visitor may
 * see, and `generateMetadata` runs outside the page, so it names the entity and nothing else (no roster, no
 * participants). A player profile is anonymously reachable but names a community member, so it is `noindex`.
 */

export async function leagueMetadata(id: string): Promise<Metadata> {
  const league = await readLeague(id);
  return league ? { title: league.name } : {};
}

export async function tournamentMetadata(id: string): Promise<Metadata> {
  const tournament = await readTournament(id);
  return tournament ? { title: tournament.name } : {};
}

export async function playerMetadata(id: string): Promise<Metadata> {
  const profile = await readPlayerProfile(id);
  return profile ? { title: profile.player.name, robots: NOINDEX } : { robots: NOINDEX };
}