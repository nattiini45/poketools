import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import PageContainer from '@/components/ui/PageContainer';
import Badge from '@/components/ui/Badge';
import LeagueStatusControl from '@/components/league/LeagueStatusControl';
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import type { SeasonStatus } from '@/types/season';
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
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import LeagueAdminTabs, { LEAGUE_ADMIN_PANEL_ID, leagueAdminTabId } from './_components/LeagueAdminTabs';
import type { LeagueAdminPanelContext } from './_components/panels/context';
import { overviewPanel } from './_components/panels/OverviewPanel';
import { participantsPanel } from './_components/panels/ParticipantsPanel';
import { draftPanel } from './_components/panels/DraftPanel';
import { phasesPanel } from './_components/panels/PhasesPanel';
import { rulesPanel } from './_components/panels/RulesPanel';
import { formatPanel } from './_components/panels/FormatPanel';
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
  format: formatPanel,
  settings: settingsPanel,
  danger: dangerPanel,
};

/** The statuses a custom league cannot take yet, with the reason; undefined once a format is attached. */
async function customBlockedStatuses(seasonId: string): Promise<Partial<Record<SeasonStatus, string>> | undefined> {
  const [attached, tAttach] = await Promise.all([getSeasonFormatSummary(seasonId), getT(formatStudioAttachMessages)]);
  return attached === null ? { active: tAttach('status.blockedNoFormat') } : undefined;
}

/**
 * `/admin/leagues/[id]?tab=` — one league's admin page, split into tabs
 * (`src/lib/league-admin/tabs.ts`): overview (default), participants, draft,
 * phases, rules, format, settings, danger. The format decides which tabs exist
 * (`getFormatCapabilities`); an unknown or unavailable `?tab=` opens the
 * overview, the former `?tab=schedule` opens phases. The server renders, and reads for, the selected tab only: every
 * tab shares the live gate and the league row, the overview needs
 * nothing else.
 *
 * A malformed `[id]` (not a uuid) is a 404 before any read. A resource admin of another
 * league gets a forbidden notice and no tab data: only site admins and this league's admins pass.
 *
 * Site-admin-only parts (test-league flag, league admins, phase delete, league
 * delete) are decided from the live gate (`gateResourceAdmin`, built on `getLiveAccess()`, one
 * memoised read shared with the admin layout and `AdminGuard`), never from the session copy.
 */
export default async function AdminLeagueDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Per-league live gate before any read (shared with the draft control panel's `gateDraftAdmin` and
  // the write APIs' `requireResourceAdmin('season', id)`): a route id that is not a uuid is a 404 inside
  // the gate, a non-admin gets `AdminGuard`'s denial or redirect, an admin of another league the notice.
  const gate = await gateResourceAdmin('season', id);
  if (gate.kind === 'guard') return <AdminGuard>{null}</AdminGuard>;
  if (gate.kind === 'forbidden') {
    const tForbidden = await getT(leagueAdminSeasonPageMessages);
    return (
      <AdminGuard>
        <ResourceForbidden>{tForbidden('forbidden')}</ResourceForbidden>
      </AdminGuard>
    );
  }
  const { isSiteAdmin, playerId } = gate;

  const [league, t, tEnum] = await Promise.all([
    getSeasonWithDetails(id),
    getT(leagueAdminSeasonPageMessages),
    getT(enumMessages),
  ]);

  if (!league) notFound();

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
    playerId,
    isSiteAdmin,
    t,
    tabLink,
  };
  // A custom league cannot start without an attached format (the database and the generate routes refuse it too):
  // its Active status is disabled, with the reason, until one is attached. One cheap read, custom leagues only;
  // the current status is never blocked, so a league that is already active stays editable.
  const [panel, blockedStatuses] = await Promise.all([
    PANELS[activeTab](ctx),
    league.format_type === 'custom' && league.status !== 'active' ? customBlockedStatuses(id) : undefined,
  ]);

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
    format: t('tabs.format'),
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
          <LeagueStatusControl
            seasonId={id}
            currentStatus={league.status}
            {...(blockedStatuses ? { blocked: blockedStatuses } : {})}
          />
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
