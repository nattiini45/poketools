import Section from '@/components/ui/Section';
import PhaseTimeline from '@/components/league/PhaseTimeline';
import EvolutionPointRecalcButton from '@/components/league/EvolutionPointRecalcButton';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import type { LeagueAdminPanelContext } from './context';

/**
 * Phases tab ("Phases" / "Phasen"): the league's phases (there is no
 * league-scoped match list) and, for Evolution Point Buy, the evolution point
 * recalculation. Reads the rulesets for the phase form (the league's own pin included). The tab was formerly
 * called "schedule"; `?tab=schedule` still opens it (`LEAGUE_ADMIN_TAB_ALIASES`).
 */
export async function phasesPanel({ id, league, caps, playerId, isSiteAdmin, t }: LeagueAdminPanelContext) {
  const rulesets = await listRulesetOptionsFor({ actor: { playerId, isAdmin: isSiteAdmin }, seasonId: id, keep: [league.ruleset_id] });
  return (
    <>
      <Section title={t('phases.title')}>
        <PhaseTimeline
          seasonId={id}
          rulesets={rulesets}
          canDelete={isSiteAdmin}
          isSiteAdmin={isSiteAdmin}
          defaultRulesetId={league.ruleset_id}
        />
      </Section>

      {caps.evolutionPoints && (
        <Section title={t('evolutionPoints.title')} subtitle={t('evolutionPoints.subtitle')}>
          <EvolutionPointRecalcButton seasonId={id} />
        </Section>
      )}
    </>
  );
}
