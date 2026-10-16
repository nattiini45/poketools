import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getMatchPrepTeams } from '@/lib/supabase/queries/match-prep-teams';
import { supabase } from '@/lib/supabase/client';
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

  const canSubmit = match.status === 'scheduled' || match.status === 'in_progress';

  const prepTeamRows = await getMatchPrepTeams(mid).catch(() => []);
  const p1Prep = prepTeamRows.find((pt) => pt.player_id === match.player_1_id);
  const p2Prep = prepTeamRows.find((pt) => pt.player_id === match.player_2_id);
  const prepTeams =
    p1Prep || p2Prep
      ? { player1: p1Prep?.pokemon ?? [], player2: p2Prep?.pokemon ?? [] }
      : undefined;

  const isAdmin = player.isAdmin && !isParticipant;

  let generation = 9;
  try {
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('rulesets(base_format)')
      .eq('id', match.tournament_id)
      .single();
    const baseFormat = (tournament?.rulesets as { base_format: string } | null)?.base_format;
    if (baseFormat) {
      const genMatch = /^gen(\d+)/.exec(baseFormat);
      if (genMatch) {
        const parsed = parseInt(genMatch[1], 10);
        if (parsed >= 1 && parsed <= 9) generation = parsed;
      }
    }
  } catch {
    generation = 9;
  }

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
            isAdmin={player.isAdmin}
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
