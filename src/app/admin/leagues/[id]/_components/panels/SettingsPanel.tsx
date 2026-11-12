import type { ReactNode } from 'react';
import SettingsIndex, { type SettingsIndexItem } from '@/components/admin/SettingsIndex';
import SettingsSection from '@/components/admin/SettingsSection';
import SkewChip from '@/components/ui/SkewChip';
import LeagueSettingsForm from '@/components/league/LeagueSettingsForm';
import RulesetPinCard from '@/components/ruleset/RulesetPinCard';
import LeagueThemeControl from '@/components/league/LeagueThemeControl';
import LeagueTestFlagControl from '@/components/league/LeagueTestFlagControl';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import { getT } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import type { LeagueSettingsValues } from '@/lib/league-admin/settings-patch';
import { LEAGUE_ADMIN_DANGER_SECTION } from '@/lib/league-admin/tabs';
import { formatChangeLock, isRulesetPinLocked } from '@/lib/season/settings-guards';
import { getRulesetPinInfo } from '@/lib/ruleset-studio/pin-info.server';
import { listRulesetOptionsFor } from '@/lib/supabase/queries/rulesets';
import { getSeasonPhaseStartSignals } from '@/lib/supabase/queries/season-start';
import ContentLanguageControl from '../ContentLanguageControl';
import type { LeagueAdminPanelContext } from './context';

/**
 * Settings tab (redesign A6): one sheet of sections with a section index beside it and one save bar below.
 *
 * In reading order: the league details form (name, league type, battle ruleset, dates) with the pin card of the
 * league's ruleset (the explicit update to a newer version; once the league has started the select is read-only and
 * the card is the way to a newer version), content language, 3D world theme and, for site admins (live check), the
 * league admins and the test-league flag. `danger` is the danger zone (`dangerPanel`), the last section. Reads the
 * rulesets for the details form (the league's own pin included, even when it is not the newest version), the pin
 * and the phases' start signals that decide whether the league type can still change.
 *
 * `LeagueSettingsForm` draws the frame: the sheet, the index and the save bar, which belongs to the details form
 * and names what changed. Every other control keeps its own request and saves on change; its section says so with
 * a chip.
 *
 * The sections are plain (not collapsible), so a control never remounts from a
 * stale prop; each one also follows its server prop after `router.refresh()`
 * (`useServerSyncedState`). The details form takes new stored values over as its baseline without
 * remounting, so its "saved" notice survives the refresh and unsaved input is kept.
 */
export async function settingsPanel({ id, league, playerId, isSiteAdmin, t }: LeagueAdminPanelContext, danger: ReactNode) {
  const viewer = { playerId, isAdmin: isSiteAdmin };
  const [rulesets, pin, phases, tForm] = await Promise.all([
    listRulesetOptionsFor({ actor: viewer, seasonId: id, keep: [league.ruleset_id] }),
    getRulesetPinInfo(league.ruleset_id, viewer),
    getSeasonPhaseStartSignals(id),
    getT(leagueAdminMessages),
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

  const savesOnChange = <SkewChip>{tForm('settingsBar.savesOnChange')}</SkewChip>;
  const index: SettingsIndexItem[] = [
    { id: 'settings-details', icon: 'everstone', label: t('settings.details.title'), marksUnsaved: true },
    { id: 'settings-language', icon: 'poke-flute', label: t('language.title') },
    { id: 'settings-theme', icon: 'town-map', label: t('theme.title') },
    ...(isSiteAdmin
      ? ([
          { id: 'settings-admins', icon: 'kings-rock', label: t('leagueAdmins.title') },
          { id: 'settings-test', icon: 'dubious-disc', label: t('testLeague.title') },
        ] satisfies SettingsIndexItem[])
      : []),
    { id: LEAGUE_ADMIN_DANGER_SECTION, icon: 'rocky-helmet', label: t('danger.title'), danger: true },
  ];

  return (
    <LeagueSettingsForm
      seasonId={id}
      initial={initial}
      rulesets={rulesets}
      formatLock={formatLock}
      rulesetLocked={rulesetLocked}
      title={t('settings.details.title')}
      subtitle={t('settings.details.subtitle')}
      aside={<SettingsIndex label={tForm('settingsBar.sections')} items={index} />}
      pinCard={
        pin !== null && (
          <RulesetPinCard kind="season" target={{ kind: 'season', id, name: league.name, status: league.status }} pin={pin} />
        )
      }
    >
      <SettingsSection id="settings-language" icon="poke-flute" title={t('language.title')} subtitle={t('language.subtitle')} aside={savesOnChange}>
        <ContentLanguageControl seasonId={id} currentLanguage={league.language ?? DEFAULT_CONTENT_LOCALE} />
      </SettingsSection>

      <SettingsSection id="settings-theme" icon="town-map" title={t('theme.title')} subtitle={t('theme.subtitle')} aside={savesOnChange}>
        <LeagueThemeControl seasonId={id} currentTheme={league.route_theme} />
      </SettingsSection>

      {isSiteAdmin && (
        <SettingsSection id="settings-admins" icon="kings-rock" title={t('leagueAdmins.title')} subtitle={t('leagueAdmins.subtitle')} aside={savesOnChange}>
          <ResourceAdminManager resourceType="season" resourceId={id} />
        </SettingsSection>
      )}

      {isSiteAdmin && (
        <SettingsSection id="settings-test" icon="dubious-disc" title={t('testLeague.title')} subtitle={t('testLeague.subtitle')} aside={savesOnChange}>
          <LeagueTestFlagControl seasonId={id} isTestSeason={league.is_test_season} />
        </SettingsSection>
      )}

      {danger}
    </LeagueSettingsForm>
  );
}
