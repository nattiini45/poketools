import Section from '@/components/ui/Section';
import LeagueSettingsForm from '@/components/league/LeagueSettingsForm';
import RulesetPinCard from '@/components/ruleset/RulesetPinCard';
import LeagueThemeControl from '@/components/league/LeagueThemeControl';
import LeagueTestFlagControl from '@/components/league/LeagueTestFlagControl';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import type { LeagueSettingsValues } from '@/lib/league-admin/settings-patch';
import { formatChangeLock, isRulesetPinLocked } from '@/lib/season/settings-guards';
import { getRulesetPinInfo } from '@/lib/ruleset-studio/pin-info.server';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import ContentLanguageControl from '../ContentLanguageControl';
import type { LeagueAdminPanelContext } from './context';

/**
 * Settings tab: the league details form (name, league type, battle ruleset, dates) with the pin card of
 * the league's ruleset (the explicit update to a newer version; once the league has started the select is read-only and
 * the card is the way to a newer version), 3D world theme, content language and,
 * for site admins (live check), the test-league flag and the league admins. Reads the rulesets for the
 * details form (the league's own pin included, even when it is not the newest version), the pin and
 * the phases' start signals that decide whether the league type can still change.
 *
 * The sections are plain (not collapsible), so a control never remounts from a
 * stale prop; each one also follows its server prop after `router.refresh()`
 * (`useServerSyncedState`). The details form takes new stored values over as its baseline without
 * remounting, so its "saved" notice survives the refresh and unsaved input is kept.
 */
export async function settingsPanel({ id, league, playerId, isSiteAdmin, t }: LeagueAdminPanelContext) {
  const viewer = { playerId, isAdmin: isSiteAdmin };
  const [rulesets, pin, phases] = await Promise.all([
    listRulesetOptionsFor({ actor: viewer, seasonId: id, keep: [league.ruleset_id] }),
    getRulesetPinInfo(league.ruleset_id, viewer),
    getSeasonPhaseStartSignals(id),
  ]);
  const formatLock = formatChangeLock(league.format_type, { status: league.status, phases });
  const rulesetLocked = isRulesetPinLocked(league.ruleset_id, { status: league.status, phases });
  const initial: LeagueSettingsValues = {
    name: league.name,
    formatType: league.format_type,
    rulesetId: league.ruleset_id ?? '',
    startDate: league.start_date?.slice(0, 10) ?? '',
    endDate: league.end_date?.slice(0, 10) ?? '',
  };

  return (
    <>
      <Section title={t('settings.details.title')} subtitle={t('settings.details.subtitle')}>
        <LeagueSettingsForm
          seasonId={id}
          initial={initial}
          rulesets={rulesets}
          formatLock={formatLock}
          rulesetLocked={rulesetLocked}
        />
        {pin !== null && (
          <div className="mt-4">
            <RulesetPinCard kind="season" target={{ kind: 'season', id, name: league.name, status: league.status }} pin={pin} />
          </div>
        )}
      </Section>

      <Section title={t('theme.title')} subtitle={t('theme.subtitle')}>
        <LeagueThemeControl seasonId={id} currentTheme={league.route_theme} />
      </Section>

      <Section title={t('language.title')} subtitle={t('language.subtitle')}>
        <ContentLanguageControl seasonId={id} currentLanguage={league.language ?? DEFAULT_CONTENT_LOCALE} />
      </Section>

      {isSiteAdmin && (
        <Section title={t('testLeague.title')} subtitle={t('testLeague.subtitle')}>
          <LeagueTestFlagControl seasonId={id} isTestSeason={league.is_test_season} />
        </Section>
      )}

      {isSiteAdmin && (
        <Section title={t('leagueAdmins.title')} subtitle={t('leagueAdmins.subtitle')}>
          <ResourceAdminManager resourceType="season" resourceId={id} />
        </Section>
      )}
    </>
  );
}
