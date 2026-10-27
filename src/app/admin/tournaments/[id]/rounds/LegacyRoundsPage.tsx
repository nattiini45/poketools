import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import { getRulesetPinInfo } from '@/lib/ruleset-studio/pin-info.server';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import RoundManager from '@/components/tournament/RoundManager';
import ParticipantManager from '@/components/tournament/ParticipantManager';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import TournamentLifecycleActions from '@/components/tournament/TournamentLifecycleActions';
import TournamentSettingsEditor from '@/components/tournament/TournamentSettingsEditor';
import RulesetPinCard from '@/components/ruleset/RulesetPinCard';
import EditableDescription from '@/components/shared/EditableDescription';
import { notFound } from 'next/navigation';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { isTournamentStarted, tournamentLockReason } from '@/lib/tournament/standalone-lock';

export const dynamic = 'force-dynamic';

interface LegacyRoundsPageProps {
  id: string;
  /** The viewing admin's player id, from the page's resource gate. */
  playerId: string;
  /** Live site-admin flag from the page's resource gate (not the session copy). */
  isSiteAdmin: boolean;
}

export default async function LegacyRoundsPage({ id, playerId, isSiteAdmin }: LegacyRoundsPageProps) {
  const tournament = await getTournamentWithDetails(id);
  if (!tournament) notFound();

  const viewer = { playerId, isAdmin: isSiteAdmin };
  const [rounds, rulesets, pin, groups, t, tc, te] = await Promise.all([
    getRoundsByTournament(id),
    // A standalone tournament's own pin stays selectable even when it is not the newest version.
    listRulesetOptionsFor({ actor: viewer, seasonId: null, keep: [tournament.ruleset_id] }),
    getRulesetPinInfo(tournament.ruleset_id, viewer),
    getGroupsByTournament(id),
    getT(tournamentsAdminMessages),
    getT(commonMessages),
    getT(enumMessages),
  ]);
  const startSignals = { status: tournament.status, rounds_total: rounds.length };
  const started = isTournamentStarted(startSignals);
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
        <Section title={t('legacy.settings')} subtitle={t('legacy.settingsHint')} collapsible={false}>
          <TournamentSettingsEditor
            tournament={{
              id: tournament.id,
              name: tournament.name,
              bracket_type: tournament.bracket_type,
              ruleset_id: tournament.ruleset_id,
              best_of_default: tournament.best_of_default,
              bo_overrides: tournament.bo_overrides,
              is_doubles: tournament.is_doubles,
              team_visibility: tournament.team_visibility,
              bracket_reset_enabled: tournament.bracket_reset_enabled,
            }}
            rulesets={rulesets}
            started={started}
            lockReason={tournamentLockReason(startSignals)}
          />
          {pin !== null && (
            <div className="mt-4">
              <RulesetPinCard
                kind="standalone"
                target={{ kind: 'tournament', id, name: tournament.name, status: tournament.status }}
                pin={pin}
              />
            </div>
          )}
        </Section>

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
