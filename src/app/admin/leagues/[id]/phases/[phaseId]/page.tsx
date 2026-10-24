import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { isValidUuid } from '@/lib/utils/uuid';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonGroupMembership, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { buildLeaguePhase } from '@/lib/tournament/league-phase';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
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

/**
 * `/admin/leagues/[id]/phases/[phaseId]` — one phase's admin page. Gated per league from
 * the live `gateResourceAdmin('season', id)` before any phase read: a non-admin gets only `AdminGuard`, an admin of
 * another league a forbidden notice; site admins and this league's admins pass. Malformed ids are a 404.
 */
export default async function AdminLeaguePhasePage({ params }: PageProps) {
  const { id: seasonId, phaseId } = await params;
  // A phase id that is not a uuid names no phase: 404 before any read (it would reach Postgres and 500).
  if (!isValidUuid(phaseId)) notFound();
  // Live per-league gate before any read (a malformed league id is a 404 inside the gate): a non-admin
  // gets only `AdminGuard`, an admin of another league the notice. A tournament-only admin has no
  // season scope and so gets the notice here; the phase page is the league admin's surface.
  const gate = await gateResourceAdmin('season', seasonId);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const tForbidden = await getT(leagueAdminMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{tForbidden('phasePage.forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }
  // Phase delete is site-admin only, decided from the live gate (never the session copy).
  const { isSiteAdmin } = gate;

  const [league, tournament, rounds, rulesets, leagueHasGroups, phaseGroups, t, tEnum, tCommon] = await Promise.all([
    getSeasonById(seasonId),
    getTournamentWithDetails(phaseId),
    getRoundsByTournament(phaseId),
    listRulesets(),
    // A league with groups owns its phases' groups (the panel shows them read-only).
    seasonHasGroups(seasonId),
    getGroupsByTournament(phaseId),
    getT(leagueAdminMessages),
    getT(enumMessages),
    getT(commonMessages),
  ]);

  if (!league || !tournament || tournament.season_id !== seasonId) notFound();

  const phase = buildLeaguePhase(tournament, rounds);
  const isNewPhase = phase.participant_count > 0 && phase.rounds_total === 0;
  // Too few participants to pair: the start-up checklist sends the admin to the participants section.
  const participantsOpen = isNewPhase || phase.participant_count < 2;
  // A phase with its own groups, or one mirroring league groups, follows a server week plan.
  const groupsInUse = phaseGroups.length > 0 || leagueHasGroups;
  // Swiss and round-robin phases of a league with groups pair within those groups; ids only.
  const leagueGroupOf =
    leagueHasGroups && (tournament.bracket_type === 'swiss' || tournament.bracket_type === 'round_robin')
      ? await getSeasonGroupMembership(seasonId)
      : null;

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
          href={leagueAdminHref(seasonId, 'phases')}
          className="inline-flex min-h-11 items-center gap-1 text-sm sm:min-h-0 text-poke-text-secondary hover:text-poke-text-primary mb-2"
        >
          {t('phasePage.back', { name: league.name })}
        </Link>

        {isNewPhase && (
          <Alert variant="info" className="mb-4">
            {t('phasePage.newPhaseHint')}
          </Alert>
        )}

        <Section id="tournament-overview" title={t('phasePage.overview')} collapsible>
          <PhaseOverviewEditor seasonId={seasonId} phase={phase} rulesets={rulesets} />
        </Section>

        <Section title={t('phasePage.description')} collapsible defaultCollapsed>
          <EditableDescription
            resourceType="tournament"
            resourceId={phaseId}
            initialValue={phase.description}
          />
        </Section>

        <Section
          id="tournament-participants"
          title={t('phasePage.participants')}
          collapsible={!isNewPhase}
          defaultCollapsed={!participantsOpen}
        >
          <ParticipantManager tournamentId={phaseId} />
        </Section>

        <Section title={t('phasePage.groups')} collapsible defaultCollapsed>
          <PhaseGroupsPanel seasonId={seasonId} phaseId={phaseId} leagueManaged={leagueHasGroups} />
        </Section>

        <Section id="tournament-rounds" title={t('phasePage.rounds')} collapsible>
          <RoundManager
            tournament={tournament}
            initialRounds={rounds}
            rulesetName={tournament.ruleset_name}
            groupsInUse={groupsInUse}
            leagueGroupOf={leagueGroupOf}
            checklistLinks={{
              participants: '#tournament-participants',
              overview: '#tournament-overview',
              rounds: '#tournament-rounds',
              leagueGroups: leagueAdminHref(seasonId, 'participants'),
            }}
          />
        </Section>
      </PageContainer>
    </AdminGuard>
  );
}
