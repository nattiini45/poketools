import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchPrepTeams } from '@/lib/supabase/queries/match-prep-teams';
import { supabase } from '@/lib/supabase/client';
import { selectVisibleMatchPrepRosters } from '@/lib/team/visibility';
import type { TeamVisibility } from '@/types/tournament';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import SubmitResultClient from './SubmitResultClient';
import PageContainer from '@/components/ui/PageContainer';
import Alert from '@/components/ui/Alert';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchMessages } from '@/i18n/messages/match';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

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
  const isSiteAdmin = access.isSiteAdmin;

  const match = await getMatchById(mid);
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  if (!isParticipant && !isSiteAdmin) {
    redirect('/dashboard');
  }

  const canSubmit = match.status === 'scheduled' || match.status === 'in_progress';

  const [prepTeamRows, tournamentResult] = await Promise.all([
    getMatchPrepTeams(mid),
    supabase
      .from('tournaments')
      .select('team_visibility, ruleset:ruleset_definition_versions ( gen )')
      .eq('id', match.tournament_id)
      .maybeSingle(),
  ]);
  if (tournamentResult.error) throw tournamentResult.error;
  const tournament = tournamentResult.data;
  const tournamentVisibility: TeamVisibility | null = tournament?.team_visibility ?? null;
  const generation = (tournament?.ruleset as { gen: number } | null)?.gen ?? 9;

  // Spec §7 per side: a participant sees only their own planned roster until
  // the match is completed (or the tournament is always_public); admins see both.
  const prepTeams = selectVisibleMatchPrepRosters(
    prepTeamRows,
    match,
    { viewerId: player.playerId, isAdmin: isSiteAdmin },
    tournamentVisibility
  );

  const isAdmin = isSiteAdmin && !isParticipant;

  const [t, tForms, tEnum] = await Promise.all([getT(matchMessages), getT(matchFormsMessages), getT(enumMessages)]);
  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <AuthGuard>
      <PageContainer
        title={tForms('submitPage.title')}
        subtitle={t('versusTitle', { p1: match.player_1_name, p2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="md"
      >
        {isAdmin && (
          <Alert variant="info">
            {tForms.rich('submitPage.adminNote', { strong })}
          </Alert>
        )}
        {!canSubmit ? (
          <Alert variant="warning">
            {tForms.rich('submitPage.cannotSubmit', {
              status: enumLabel(tEnum, 'matchStatus', match.status),
              strong,
            })}
          </Alert>
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
            redirectTo={`/tournaments/${match.tournament_id}/matches/${mid}`}
            isAdmin={isSiteAdmin}
          />
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
