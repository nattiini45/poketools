import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { getSession, isAdmin } from '@/lib/auth/helpers';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
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
}

export default async function LegacyRoundsPage({ id }: LegacyRoundsPageProps) {
  const [tournament, session] = await Promise.all([
    getTournamentById(id),
    getSession(),
  ]);
  if (!tournament) notFound();

  const [rounds, t, tc, te] = await Promise.all([
    getRoundsByTournament(id),
    getT(tournamentsAdminMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);
  const isSiteAdmin = isAdmin(session);
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

        <Section title={t('legacy.participants')} collapsible defaultCollapsed>
          <ParticipantManager tournamentId={id} />
        </Section>

        <Section title={t('legacy.rounds')} collapsible>
          <RoundManager tournament={tournament} initialRounds={rounds} />
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
