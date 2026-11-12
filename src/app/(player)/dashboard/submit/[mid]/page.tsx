import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { getLiveAccess } from '@/lib/auth/helpers';
import { canAdministerMatchAccess } from '@/lib/auth/match-access';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchPrepTeams } from '@/lib/supabase/queries/match-prep-teams';
import { getTournamentSubmitContext } from '@/lib/supabase/queries/tournaments';
import { selectVisibleMatchPrepRosters } from '@/lib/team/visibility';
import MatchPageBackLink from '@/components/match/MatchPageBackLink';
import MatchVersusHeader from '@/components/match/MatchVersusHeader';
import { PlateLink } from '@/components/match/PlateButton';
import SubmitResultClient from './SubmitResultClient';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import { availableMatchActions } from '@/lib/match/match-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ mid: string }>;
}

export default async function SubmitResultPage({ params }: PageProps) {
  const { mid } = await params;
  // Live roles (AGENTS.md): this page decides who sees which planned roster.
  const access = await getLiveAccess();
  const player = access?.player;
  if (!access || !player) redirect('/');
  const match = await getMatchById(mid);
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  // Live roles: a site admin, or a resource admin of this match's tournament or
  // league (the league organizer). A player with no admin role costs no lookup.
  const canAdminister =
    access.isSiteAdmin ||
    (access.isAnyAdmin && (await canAdministerMatchAccess(player, match.tournament_id)));

  if (!isParticipant && !canAdminister) {
    redirect('/dashboard');
  }

  const canSubmit = availableMatchActions(match, { playerId: player.playerId, isAdmin: canAdminister }).has('record_game');

  const [prepTeamRows, tournament] = await Promise.all([
    getMatchPrepTeams(mid),
    getTournamentSubmitContext(match.tournament_id),
  ]);
  const tournamentVisibility = tournament?.teamVisibility ?? null;
  const generation = tournament?.generation ?? 9;

  // Spec §7 per side: a participant sees only their own planned roster until
  // the match is completed (or the tournament is always_public); admins see both.
  const prepTeams = selectVisibleMatchPrepRosters(
    prepTeamRows,
    match,
    { viewerId: player.playerId, isAdmin: canAdminister },
    tournamentVisibility
  );

  const isAdmin = canAdminister && !isParticipant;

  const [tForms, tEnum] = await Promise.all([getT(matchFormsMessages), getT(enumMessages)]);
  const strong = (chunks: React.ReactNode) => <strong className="font-[550]">{chunks}</strong>;
  const matchHref = `/tournaments/${match.tournament_id}/matches/${mid}`;

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-[1008px] flex-col gap-6">
        <MatchVersusHeader
          title={tForms('submitPage.title')}
          status={match.status}
          players={[
            { name: match.player_1_name, avatarUrl: match.player_1_avatar_url },
            { name: match.player_2_name, avatarUrl: match.player_2_avatar_url },
          ]}
          viewerSide={player.playerId === match.player_1_id ? 0 : player.playerId === match.player_2_id ? 1 : null}
          labels={{ versus: tForms('versus.vs'), you: tForms('versus.you'), winner: tForms('versus.winner') }}
        />
        {isAdmin && (
          <Alert variant="info">
            {tForms.rich('submitPage.adminNote', { strong })}
          </Alert>
        )}
        {!canSubmit ? (
          <Card padding="none" className="flex flex-col items-start gap-3 p-4 sm:p-5">
            <p className="text-body text-fg-muted">
              {tForms.rich('submitPage.cannotSubmit', {
                status: enumLabel(tEnum, 'matchStatus', match.status),
                strong: (chunks) => <strong className="font-[550] text-fg">{chunks}</strong>,
              })}
            </p>
            <PlateLink href={matchHref} tone="secondary">
              {tForms('common.openMatch')}
            </PlateLink>
          </Card>
        ) : (
          <SubmitResultClient
            key={mid}
            matchId={mid}
            players={[
              { id: match.player_1_id, name: match.player_1_name },
              { id: match.player_2_id, name: match.player_2_name },
            ]}
            prepTeams={prepTeams}
            generation={generation}
            redirectTo={matchHref}
            isAdmin={canAdminister}
          />
        )}

        <MatchPageBackLink label={tForms('common.backToDashboard')} />
      </div>
    </AuthGuard>
  );
}
