import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { getSession, isAdmin } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { buildLeaguePhase } from '@/lib/tournament/league-phase';
import PhaseOverviewEditor from '@/components/league/PhaseOverviewEditor';
import ParticipantManager from '@/components/tournament/ParticipantManager';
import PhaseGroupsPanel from '@/components/league/PhaseGroupsPanel';
import RoundManager from '@/components/tournament/RoundManager';
import TournamentLifecycleActions from '@/components/tournament/TournamentLifecycleActions';
import EditableDescription from '@/components/shared/EditableDescription';
import Alert from '@/components/ui/Alert';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; phaseId: string }>;
}

export default async function AdminLeaguePhasePage({ params }: PageProps) {
  const { id: seasonId, phaseId } = await params;
  const [league, tournament, rounds, rulesets, session, t, tEnum, tCommon] = await Promise.all([
    getSeasonById(seasonId),
    getTournamentWithDetails(phaseId),
    getRoundsByTournament(phaseId),
    listRulesets(),
    getSession(),
    getT(leagueAdminMessages),
    getT(enumMessages),
    getT(commonMessages),
  ]);

  if (!league || !tournament || tournament.season_id !== seasonId) notFound();

  const phase = buildLeaguePhase(tournament, rounds);
  const isSiteAdmin = isAdmin(session);
  const isNewPhase = phase.participant_count > 0 && phase.rounds_total === 0;

  return (
    <AdminGuard>
      <PageContainer
        title={phase.name}
        subtitle={t('phasePage.subtitle', {
          league: league.name,
          order: phase.stage_order,
          bracket: enumLabel(tEnum, 'bracketType', phase.bracket_type),
          bestOf: tCommon('bestOf', { count: phase.best_of_default }),
          status: enumLabel(tEnum, 'tournamentStatus', phase.status),
        })}
        maxWidth="lg"
        action={
          <TournamentLifecycleActions
            tournamentId={phaseId}
            tournamentName={phase.name}
            seasonId={seasonId}
            status={phase.status}
            isArchived={phase.archived}
            canDelete={isSiteAdmin}
          />
        }
      >
        <Link
          href={`/admin/leagues/${seasonId}`}
          className="inline-flex items-center gap-1 text-sm text-poke-text-secondary hover:text-poke-text-primary mb-2"
        >
          {t('phasePage.back', { name: league.name })}
        </Link>

        {isNewPhase && (
          <Alert variant="info" className="mb-4">
            {t('phasePage.newPhaseHint')}
          </Alert>
        )}

        <Section title={t('phasePage.overview')} collapsible>
          <PhaseOverviewEditor seasonId={seasonId} phase={phase} rulesets={rulesets} />
        </Section>

        <Section title={t('phasePage.description')} collapsible defaultCollapsed>
          <EditableDescription
            resourceType="tournament"
            resourceId={phaseId}
            initialValue={phase.description}
          />
        </Section>

        <Section title={t('phasePage.participants')} collapsible={!isNewPhase} defaultCollapsed={!isNewPhase}>
          <ParticipantManager tournamentId={phaseId} />
        </Section>

        <Section title={t('phasePage.groups')} collapsible defaultCollapsed>
          <PhaseGroupsPanel seasonId={seasonId} phaseId={phaseId} />
        </Section>

        <Section title={t('phasePage.rounds')} collapsible>
          <RoundManager tournament={tournament} initialRounds={rounds} />
        </Section>
      </PageContainer>
    </AdminGuard>
  );
}
