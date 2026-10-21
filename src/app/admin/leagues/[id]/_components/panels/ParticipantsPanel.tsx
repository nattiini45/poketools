import Section from '@/components/ui/Section';
import LeagueRosterManager from '@/components/league/LeagueRosterManager';
import CoreLigaManager from '@/components/league/CoreLigaManager';
import LeagueGroupsEditor from '@/components/league/groups/LeagueGroupsEditor';
import { getT } from '@/i18n/server';
import { leagueAdminGroupsMessages } from '@/i18n/messages/league-admin/groups';
import type { LeagueAdminPanelContext } from './context';

/**
 * Participants tab: the roster, the league groups editor and, on classic formats, the Core Liga type cores.
 * No server read: the managers and the groups editor load their own data on the client
 * (`GET /api/seasons/[id]/groups` for the groups; names, seeds and lock flags only).
 */
export async function participantsPanel({ id, league, caps, t }: LeagueAdminPanelContext) {
  const tGroups = await getT(leagueAdminGroupsMessages);
  return (
    <>
      <Section title={t('participants.title')}>
        <LeagueRosterManager
          seasonId={id}
          showTypeSelector={caps.participantTypeAssignment}
          leagueState={{ status: league.status, archived: league.archived }}
        />
      </Section>

      <Section title={tGroups('editor.title')} subtitle={tGroups('editor.subtitle')}>
        <LeagueGroupsEditor seasonId={id} />
      </Section>

      {caps.typeCores && (
        <Section title={t('typeCores.title')} subtitle={t('typeCores.subtitle')} collapsible defaultCollapsed>
          <CoreLigaManager seasonId={id} />
        </Section>
      )}
    </>
  );
}
