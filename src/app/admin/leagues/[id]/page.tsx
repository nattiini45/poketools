import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Badge from '@/components/ui/Badge';
import LeagueStatusControl from '@/components/league/LeagueStatusControl';
import { getLiveAccess } from '@/lib/auth/helpers';
import { isValidUuid } from '@/lib/utils/uuid';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import {
  LEAGUE_ADMIN_TAB_PARAM,
  availableLeagueAdminTabs,
  leagueAdminHref,
  parseLeagueAdminTab,
  type LeagueAdminTab,
} from '@/lib/league-admin/tabs';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import LeagueAdminTabs, { LEAGUE_ADMIN_PANEL_ID, leagueAdminTabId } from './_components/LeagueAdminTabs';
import type { LeagueAdminPanelContext } from './_components/panels/context';
import { overviewPanel } from './_components/panels/OverviewPanel';
import { participantsPanel } from './_components/panels/ParticipantsPanel';
import { draftPanel } from './_components/panels/DraftPanel';
import { phasesPanel } from './_components/panels/PhasesPanel';
import { rulesPanel } from './_components/panels/RulesPanel';
import { settingsPanel } from './_components/panels/SettingsPanel';
import { dangerPanel } from './_components/panels/DangerPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** One renderer per tab; each performs only its own reads. */
const PANELS: Record<LeagueAdminTab, (ctx: LeagueAdminPanelContext) => Promise<ReactNode>> = {
  overview: overviewPanel,
  participants: participantsPanel,
  draft: draftPanel,
  phases: phasesPanel,
  rules: rulesPanel,
  settings: settingsPanel,
  danger: dangerPanel,
};

/**
 * `/admin/leagues/[id]?tab=` — one league's admin page, split into tabs
 * (`src/lib/league-admin/tabs.ts`): overview (default), participants, draft,
 * phases, rules, settings, danger. The format decides which tabs exist
 * (`getFormatCapabilities`); an unknown or unavailable `?tab=` opens the
 * overview, the former `?tab=schedule` opens phases. The server renders, and reads for, the selected tab only: every
 * tab shares the league row and the live access read, the overview needs
 * nothing else.
 *
 * A malformed `[id]` (not a uuid) is a 404 before any read. A resource admin of another
 * league gets a forbidden notice and no tab data: only site admins and this league's admins pass.
 *
 * Site-admin-only parts (test-league flag, league admins, phase delete, league
 * delete) are decided from `getLiveAccess()` (one memoised read shared with the
 * admin layout and `AdminGuard`), never from the session copy.
 */
export default async function AdminLeagueDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // A route id that is not a uuid names no league: 404 before any read (it would reach Postgres and 500).
  if (!isValidUuid(id)) notFound();
  const [league, access, t, tEnum] = await Promise.all([
    getSeasonWithDetails(id),
    getLiveAccess(),
    getT(leagueAdminSeasonPageMessages),
    getT(enumMessages),
  ]);

  if (!league) notFound();
  // Not an admin (or signed out): AdminGuard renders the denial or redirects; no tab data is read.
  if (!access?.isAnyAdmin) return <AdminGuard>{null}</AdminGuard>;
  // An admin, but of another league: the same per-league check as the draft control panel
  // (`gateDraftAdmin`) and the write APIs (`requireResourceAdmin('season', id)`), before any tab read.
  if (!access.isSiteAdmin && !(access.player && (await isResourceAdminFor(access.player.playerId, 'season', id)))) {
    return (
      <AdminGuard>
        <p className="p-8 text-center text-poke-text-secondary">{t('forbidden')}</p>
      </AdminGuard>
    );
  }

  const tabs = availableLeagueAdminTabs(league.format_type);
  const activeTab = parseLeagueAdminTab(query[LEAGUE_ADMIN_TAB_PARAM], tabs);
  const tabLink = (tab: LeagueAdminTab) => (chunks: ReactNode) => (
    <Link href={leagueAdminHref(id, tab)} className="text-poke-blue hover:underline">
      {chunks}
    </Link>
  );
  const ctx: LeagueAdminPanelContext = {
    id,
    league,
    caps: getFormatCapabilities(league.format_type),
    isSiteAdmin: access.isSiteAdmin,
    t,
    tabLink,
  };
  const panel = await PANELS[activeTab](ctx);

  const format = enumLabel(tEnum, 'formatType', league.format_type);
  const baseSubtitle = league.ruleset_name
    ? t('header.subtitleWithRuleset', { format, ruleset: league.ruleset_name })
    : t('header.subtitle', { format });
  const subtitle = league.archived ? t('header.archived', { subtitle: baseSubtitle }) : baseSubtitle;
  const labels: Record<LeagueAdminTab, string> = {
    overview: t('tabs.overview'),
    participants: t('tabs.participants'),
    draft: t('tabs.draft'),
    phases: t('tabs.phases'),
    rules: t('tabs.rules'),
    settings: t('tabs.settings'),
    danger: t('tabs.danger'),
  };

  return (
    <AdminGuard>
      <PageContainer title={league.name} subtitle={subtitle} maxWidth="lg">
        {/* Below the title, not in PageContainer's `action` slot: that slot does not wrap, and the
            status control plus the badge would widen the page at phone width. */}
        <div className="flex flex-wrap items-center gap-3" data-admin-league-header>
          {league.is_test_season && <Badge variant="yellow">{t('header.testBadge')}</Badge>}
          <LeagueStatusControl seasonId={id} currentStatus={league.status} />
        </div>

        <LeagueAdminTabs
          leagueId={id}
          tabs={tabs}
          activeTab={activeTab}
          labels={labels}
          navLabel={t('tabs.label')}
          unsavedConfirm={t('tabs.unsavedConfirm')}
        />

        <div
          id={LEAGUE_ADMIN_PANEL_ID}
          role="region"
          aria-labelledby={leagueAdminTabId(activeTab)}
          data-admin-panel={activeTab}
          className="space-y-6"
        >
          {panel}
        </div>
      </PageContainer>
    </AdminGuard>
  );
}
