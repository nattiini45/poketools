import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getMatchById } from '@/lib/supabase/queries/matches';
import GameList from '@/components/match/GameList';
import MatchPageBackLink from '@/components/match/MatchPageBackLink';
import MatchVersusHeader from '@/components/match/MatchVersusHeader';
import { PlateLink } from '@/components/match/PlateButton';
import ConfirmMatchClient from './ConfirmMatchClient';
import { availableMatchActions } from '@/lib/match/match-actions';
import Card from '@/components/ui/Card';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ mid: string }>;
}

export default async function ConfirmMatchPage({ params }: PageProps) {
  const { mid } = await params;
  const { player } = await requireLiveIdentityOrSignIn();
  if (!player) redirect('/');

  const match = await getMatchById(mid);
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  if (!isParticipant && !player.isAdmin) {
    redirect('/dashboard');
  }

  const isPending = match.status === 'pending_confirmation';
  const actions = availableMatchActions(match, { playerId: player.playerId, isAdmin: player.isAdmin });

  const canConfirm = actions.has('confirm');
  // An admin who does not play is not offered the dispute here (the admin match page has it).
  const canDispute = isParticipant && actions.has('dispute');

  const [tForms, tEnum] = await Promise.all([getT(matchFormsMessages), getT(enumMessages)]);

  const matchHref = `/tournaments/${match.tournament_id}/matches/${mid}`;
  const score: [number, number] | null =
    match.games.length > 0
      ? [
          match.games.filter((game) => game.winner_id === match.player_1_id).length,
          match.games.filter((game) => game.winner_id === match.player_2_id).length,
        ]
      : null;
  const winnerName =
    match.winner_id === match.player_1_id ? match.player_1_name : match.winner_id === match.player_2_id ? match.player_2_name : null;

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-[756px] flex-col gap-6">
        <MatchVersusHeader
          title={tForms('confirm.title')}
          status={match.status}
          players={[
            { name: match.player_1_name, avatarUrl: match.player_1_avatar_url },
            { name: match.player_2_name, avatarUrl: match.player_2_avatar_url },
          ]}
          viewerSide={player.playerId === match.player_1_id ? 0 : player.playerId === match.player_2_id ? 1 : null}
          score={score}
          winnerSide={match.status === 'completed' ? (match.winner_id === match.player_1_id ? 0 : match.winner_id === match.player_2_id ? 1 : null) : null}
          labels={{
            versus: tForms('versus.vs'),
            you: tForms('versus.you'),
            winner: tForms('versus.winner'),
            score: score
              ? tForms('versus.score', { p1: match.player_1_name, s1: score[0], p2: match.player_2_name, s2: score[1] })
              : undefined,
          }}
        />

        {/* The reported result, to check before confirming */}
        <Card padding="none">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 sm:px-5">
            <h2 className="font-heading text-title text-fg">{tForms('confirm.resultTitle')}</h2>
            {winnerName && (
              <p className="text-body text-fg-muted">
                {tForms('confirm.proposedWinner')}{' '}
                <span className="font-[550] text-win">{winnerName}</span>
              </p>
            )}
          </div>
          <div className="p-4 sm:p-5">
            {match.games.length > 0 ? (
              <GameList
                games={match.games}
                player1Name={match.player_1_name}
                player2Name={match.player_2_name}
                player1Id={match.player_1_id}
                player2Id={match.player_2_id}
              />
            ) : (
              <p className="text-body text-fg-muted">{tForms('confirm.noGames')}</p>
            )}
          </div>
        </Card>

        {/* Action Buttons */}
        {isPending ? (
          <ConfirmMatchClient
            matchId={mid}
            canConfirm={canConfirm}
            canDispute={canDispute}
            redirectTo={matchHref}
          />
        ) : (
          <Card padding="none" className="flex flex-col items-start gap-3 p-4 sm:p-5">
            <p className="text-body text-fg-muted">
              {tForms.rich('confirm.notNeeded', {
                status: enumLabel(tEnum, 'matchStatus', match.status),
                strong: (chunks) => <strong className="font-[550] text-fg">{chunks}</strong>,
              })}
            </p>
            <PlateLink href={matchHref} tone="secondary">
              {tForms('common.openMatch')}
            </PlateLink>
          </Card>
        )}

        <MatchPageBackLink label={tForms('common.backToDashboard')} />
      </div>
    </AuthGuard>
  );
}
