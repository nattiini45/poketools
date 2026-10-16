import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import GameList from '@/components/match/GameList';
import ConfirmMatchClient from './ConfirmMatchClient';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchMessages } from '@/i18n/messages/match';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ mid: string }>;
}

export default async function ConfirmMatchPage({ params }: PageProps) {
  const { mid } = await params;
  const player = await getSessionPlayer();
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
  const isSubmitter = match.submitter_id === player.playerId;

  const canConfirm = isPending && (!isSubmitter || player.isAdmin);
  const canDispute = isPending && isParticipant;

  const [t, tForms, tEnum] = await Promise.all([getT(matchMessages), getT(matchFormsMessages), getT(enumMessages)]);

  return (
    <AuthGuard>
      <PageContainer
        title={tForms('confirm.title')}
        subtitle={t('versusTitle', { p1: match.player_1_name, p2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="sm"
      >
        {/* Match Summary */}
        {match.winner_id && (
          <Card variant="muted" padding="sm">
            <p className="text-sm font-medium text-poke-text-primary">
              {tForms('confirm.proposedWinner')}{' '}
              <span className="text-poke-green font-semibold">
                {match.winner_id === match.player_1_id
                  ? match.player_1_name
                  : match.player_2_name}
              </span>
            </p>
          </Card>
        )}

        {/* Game History */}
        {match.games.length > 0 && (
          <div>
            <GameList
              games={match.games}
              player1Name={match.player_1_name}
              player2Name={match.player_2_name}
              player1Id={match.player_1_id}
              player2Id={match.player_2_id}
            />
          </div>
        )}

        {/* Action Buttons */}
        {isPending ? (
          <ConfirmMatchClient
            matchId={mid}
            canConfirm={canConfirm}
            canDispute={canDispute}
            redirectTo={`/tournaments/${match.tournament_id}/matches/${mid}`}
          />
        ) : (
          <Card variant="muted" padding="md">
            <p className="text-sm text-poke-text-muted">
              {tForms.rich('confirm.notNeeded', {
                status: enumLabel(tEnum, 'matchStatus', match.status),
                strong: (chunks) => <strong className="text-poke-text-primary">{chunks}</strong>,
              })}
            </p>
          </Card>
        )}

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          &larr; {tForms('common.backToDashboard')}
        </Link>
      </PageContainer>
    </AuthGuard>
  );
}
