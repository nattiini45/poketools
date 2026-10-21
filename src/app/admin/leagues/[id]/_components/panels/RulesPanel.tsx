import Section from '@/components/ui/Section';
import EvolutionTierEditor from '@/components/league/EvolutionTierEditor';
import DraftTierLimitsEditor from '@/components/league/DraftTierLimitsEditor';
import PointBuyListManager from '@/components/league/PointBuyListManager';
import FormatRulesEditor from '@/components/league/FormatRulesEditor';
import EpbImportPanel from '@/components/league/EpbImportPanel';
import { getT } from '@/i18n/server';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import type { LeagueAdminPanelContext } from './context';

/**
 * Rules tab. Classic draft: the evolution tiers (with wildcards) and the tier
 * slot limits; reads the participants for the wildcard picker. Evolution Point
 * Buy: the point-buy list binding, the format rules and the xlsx data import;
 * no read of its own (the editors load their data on the client).
 */
export async function rulesPanel({ id, league, caps, t }: LeagueAdminPanelContext) {
  // Only `{ id, name }` crosses into client components (AGENTS.md: never raw players rows).
  const playerRefs = caps.evolutionTiers ? (await getSeasonParticipants(id)).map(toPublicPlayerRef) : [];
  const tGlossary = caps.pointBuyList ? await getT(glossaryMessages) : null;

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
          <FormatRulesEditor seasonId={id} />
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
