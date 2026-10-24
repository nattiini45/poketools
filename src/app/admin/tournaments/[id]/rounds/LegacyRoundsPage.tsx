import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import RoundManager from '@/components/tournament/RoundManager';
import ParticipantManager from '@/components/tournament/ParticipantManager';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import TournamentLifecycleActions from '@/components/tournament/TournamentLifecycleActions';
import EditableDescription from '@/components/shared/EditableDescription';
import { notFound } from 'next/navigation';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

export const dynamic = 'force-dynamic';

interface LegacyRoundsPageProps {
  id: string;
  /** Live site-admin flag from the page's resource gate (not the session copy). */
  isSiteAdmin: boolean;
}

export default async function LegacyRoundsPage({ id, isSiteAdmin }: LegacyRoundsPageProps) {
  const tournament = await getTournamentWithDetails(id);
  if (!tournament) notFound();

  const [rounds, groups, t, tc, te] = await Promise.all([
    getRoundsByTournament(id),
    getGroupsByTournament(id),
    getT(tournamentsAdminMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);
  const subtitle = [
    enumLabel(te, 'bracketType', tournament.bracket_type),
    tc('bestOf', { count: tournament.best_of_default }),
    enumLabel(te, 'tournamentStatus', tournament.status),
    ...(tournament.archived ? [t('legacy.archived')] : []),
  ].join(' · ');

  return (
    <AdminGuard>
      <PageContainer
        title={tournament.name}
        subtitle={subtitle}
        action={
          <TournamentLifecycleActions
            tournamentId={id}
            tournamentName={tournament.name}
            seasonId={tournament.season_id}
            status={tournament.status}
            isArchived={tournament.archived}
            canDelete={isSiteAdmin}
          />
        }
      >
        <Section title={t('legacy.description')} subtitle={t('legacy.descriptionHint')} collapsible defaultCollapsed>
          <EditableDescription
            resourceType="tournament"
            resourceId={id}
            initialValue={tournament.description}
          />
        </Section>

        {/* Open while the tournament has too few participants to pair: the start-up checklist sends the admin here. */}
        <Section
          id="tournament-participants"
          title={t('legacy.participants')}
          collapsible
          defaultCollapsed={tournament.participant_count >= 2}
        >
          <ParticipantManager tournamentId={id} />
        </Section>

        <Section id="tournament-rounds" title={t('legacy.rounds')} collapsible>
          <RoundManager
            tournament={tournament}
            initialRounds={rounds}
            rulesetName={tournament.ruleset_name}
            groupsInUse={groups.length > 0}
            checklistLinks={{ participants: '#tournament-participants', rounds: '#tournament-rounds' }}
          />
        </Section>

        {isSiteAdmin && (
          <Section title={t('legacy.admins')} collapsible>
            <ResourceAdminManager resourceType="tournament" resourceId={id} />
          </Section>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
