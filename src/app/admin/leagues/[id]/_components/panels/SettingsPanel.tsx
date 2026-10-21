import Section from '@/components/ui/Section';
import LeagueThemeControl from '@/components/league/LeagueThemeControl';
import LeagueTestFlagControl from '@/components/league/LeagueTestFlagControl';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import ContentLanguageControl from '../ContentLanguageControl';
import type { LeagueAdminPanelContext } from './context';

/**
 * Settings tab: 3D world theme, content language and, for site admins (live
 * check), the test-league flag and the league admins. No read of its own.
 *
 * The sections are plain (not collapsible), so a control never remounts from a
 * stale prop; each one also follows its server prop after `router.refresh()`
 * (`useServerSyncedState`).
 */
export async function settingsPanel({ id, league, isSiteAdmin, t }: LeagueAdminPanelContext) {
  return (
    <>
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
