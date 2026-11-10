import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import PlayerFormatView from '@/components/format-runtime/player/PlayerFormatView';
import { getLiveAccess } from '@/lib/auth/helpers';
import { loadPlayerView } from '@/lib/format-engine/runtime/views-server';
import { getSeasonWithDetails, isSeasonPlayer } from '@/lib/supabase/queries/seasons';
import { isValidUuid } from '@/lib/utils/uuid';
import { getT } from '@/i18n/server';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { isSeasonClosed } from '@/lib/season/season-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

const LINK = 'text-sm font-medium text-poke-blue hover:underline';

/**
 * `/dashboard/leagues/[id]/play`: the player's page of a running custom league (the format's actions, pairings, items
 * and challenge ladders). The `(player)` layout has already sent a signed-out visitor to sign-in.
 *
 * The server decides what the page is: not a custom league, not a member (a banned or suspended player counts as no
 * member, as `GET format/me` refuses them: a site admin keeps the standing the guards give them), or a format that is
 * not running each get a notice instead of the view; a completed or archived league renders the view read-only. The view is loaded for the
 * session player and nobody else, and only plain data reaches the client island (names, ids and labels: no `players`
 * row, no seed, no other player's picks; hidden relation sides are already `null` in the view).
 */
export default async function PlayPage({ params }: PageProps) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const seasonId = id.toLowerCase();

  // The live gate, not the layout's session: a ban or suspension that landed after sign-in counts now.
  const access = await getLiveAccess();
  const player = access?.player ?? null;
  if (!player) redirect('/dashboard');
  const inGoodStanding = access?.isSiteAdmin === true || (player.status !== 'banned' && player.status !== 'suspended');

  const [league, t] = await Promise.all([getSeasonWithDetails(seasonId), getT(formatRuntimePlayerMessages)]);
  if (!league) notFound();

  const back = (
    <Link href={`/leagues/${seasonId}`} className={LINK}>
      {t('page.back')}
    </Link>
  );
  const heading = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
      {back}
    </div>
  );
  const shell = (children: ReactNode) => (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {heading}
      {children}
    </div>
  );

  if (league.format_type !== 'custom') return shell(<Alert variant="info">{t('page.notCustom')}</Alert>);

  // Same rule as requireSeasonMember: a player out of good standing is refused before the participant read.
  const isMember = inGoodStanding && (await isSeasonPlayer(seasonId, player.playerId));
  if (!isMember) return shell(<Alert variant="info">{t('page.notMember')}</Alert>);

  const view = await loadPlayerView(seasonId, player.playerId);
  if (!view.running) return shell(<Alert variant="info">{t('page.notRunning')}</Alert>);

  const closed = isSeasonClosed(league);
  return shell(
    <>
      {closed && <Alert variant="info">{t('page.closed')}</Alert>}
      <PlayerFormatView seasonId={seasonId} viewerId={player.playerId} initialView={view} closed={closed} />
    </>,
  );
}
