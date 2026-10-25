import Section from '@/components/ui/Section';
import EvolutionTierEditor from '@/components/league/EvolutionTierEditor';
import DraftTierLimitsEditor from '@/components/league/DraftTierLimitsEditor';
import PointBuyListManager from '@/components/league/PointBuyListManager';
import FormatRulesEditor from '@/components/league/FormatRulesEditor';
import EpbImportPanel from '@/components/league/EpbImportPanel';
import { getT } from '@/i18n/server';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { isSeasonStarted } from '@/lib/season/settings-guards';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import type { LeagueAdminPanelContext } from './context';

/**
 * Rules tab. Classic draft: the evolution tiers (with wildcards) and the tier
 * slot limits; reads the participants for the wildcard picker. Evolution Point
 * Buy: the point-buy list binding, the format rules and the xlsx data import. The editors
 * load their data on the client; the one read here is the phases' start signals, which tell the
 * format rules editor whether the league has started (it then asks before saving).
 */
export async function rulesPanel({ id, league, caps, t }: LeagueAdminPanelContext) {
  // Only `{ id, name }` crosses into client components (AGENTS.md: never raw players rows).
  const [participants, phases, tGlossary] = await Promise.all([
    caps.evolutionTiers ? getSeasonParticipants(id) : [],
    caps.pointBuyList ? getSeasonPhaseStartSignals(id) : null,
    caps.pointBuyList ? getT(glossaryMessages) : null,
  ]);
  const playerRefs = participants.map(toPublicPlayerRef);
  const seasonStarted = phases ? isSeasonStarted({ status: league.status, phases }) : false;

  return (
    <>
      {caps.evolutionTiers && (
        <Section title={t('evolutionTiers.title')} subtitle={t('evolutionTiers.subtitle')}>
          <EvolutionTierEditor seasonId={id} participants={playerRefs} />
        </Section>
      )}

      {caps.tierLimits && (
        <Section title={t('draftSettings.title')} subtitle={t('draftSettings.subtitle')}>
          <DraftTierLimitsEditor seasonId={id} />
        </Section>
      )}

      {caps.pointBuyList && (
        <Section title={t('pointBuyList.title')} subtitle={t('pointBuyList.subtitle')}>
          <PointBuyListManager seasonId={id} currentListId={league.point_buy_list_id} />
        </Section>
      )}

      {tGlossary && (
        <Section
          title={t('formatRules.title')}
          subtitle={t('formatRules.subtitle', { token: tGlossary('token.draftKill') })}
        >
          <FormatRulesEditor seasonId={id} seasonStarted={seasonStarted} />
        </Section>
      )}

      {caps.pointBuyList && (
        <Section title={t('dataImport.title')} subtitle={t('dataImport.subtitle')} collapsible defaultCollapsed>
          <EpbImportPanel seasonId={id} seasonName={league.name} />
        </Section>
      )}
    </>
  );
}
