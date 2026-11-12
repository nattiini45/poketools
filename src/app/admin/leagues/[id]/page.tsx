import AdminCrumbName from '@/components/admin/admin-crumb-names';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import LeagueStatusControl from '@/components/league/LeagueStatusControl';
import { gateResourceAdmin } from '@/lib/auth/resource-gate';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import type { SeasonStatus } from '@/types/season';
import { leaguePrimaryAction } from '@/lib/league-admin/primary-action';
import {
  LEAGUE_ADMIN_RULES_SECTION,
  LEAGUE_ADMIN_TAB_PARAM,
  availableLeagueAdminTabs,
  leagueAdminAliasSection,
  leagueAdminHref,
  leagueHasRulesSection,
  parseLeagueAdminTab,
  type LeagueAdminTab,
} from '@/lib/league-admin/tabs';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import AliasSectionScroll from './_components/AliasSectionScroll';
import LeagueAdminTabs, { LEAGUE_ADMIN_PANEL_ID, leagueAdminTabId } from './_components/LeagueAdminTabs';
import LeaguePrimaryAction from './_components/LeaguePrimaryAction';
import LeagueWorkspaceHeader from './_components/LeagueWorkspaceHeader';
import type { LeagueAdminPanelContext } from './_components/panels/context';
import { overviewPanel } from './_components/panels/OverviewPanel';
import { participantsPanel } from './_components/panels/ParticipantsPanel';
import { draftPanel } from './_components/panels/DraftPanel';
import { phasesPanel } from './_components/panels/PhasesPanel';
import { rulesPanel } from './_components/panels/RulesPanel';
import { formatPanel } from './_components/panels/FormatPanel';
import { formatLivePanel } from './_components/panels/LivePanel';
import { settingsPanel } from './_components/panels/SettingsPanel';
import { dangerPanel } from './_components/panels/DangerPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Format and rules: the format view, then the rules editors of the formats that have them (the former Rules tab,
 * `#league-rules`). Both read in one wave; a format without rules editors reads the format view only.
 */
async function formatAndRulesPanel(ctx: LeagueAdminPanelContext): Promise<ReactNode> {
  const [format, rules] = await Promise.all([
    formatPanel(ctx),
    leagueHasRulesSection(ctx.league.format_type) ? rulesPanel(ctx) : null,
  ]);
  return (
    <>
      {format}
      {rules !== null && (
        <div id={LEAGUE_ADMIN_RULES_SECTION} className="scroll-mt-4 space-y-6">
          {rules}
        </div>
      )}
    </>
  );
}

/**
 * Settings: one sheet of sections with the danger zone (the former Danger zone tab, `#danger-zone`) as the last
 * one. The danger zone reads nothing.
 */
async function settingsAndDangerPanel(ctx: LeagueAdminPanelContext): Promise<ReactNode> {
  return settingsPanel(ctx, await dangerPanel(ctx));
}

/** One renderer per tab; each performs only its own reads. */
const PANELS: Record<LeagueAdminTab, (ctx: LeagueAdminPanelContext) => Promise<ReactNode>> = {
  overview: overviewPanel,
  participants: participantsPanel,
  phases: phasesPanel,
  format: formatAndRulesPanel,
  draft: draftPanel,
  live: formatLivePanel,
  settings: settingsAndDangerPanel,
};

/** The statuses a custom league cannot take yet, with the reason; undefined once a format is attached. */
async function customBlockedStatuses(seasonId: string): Promise<Partial<Record<SeasonStatus, string>> | undefined> {
  const [attached, tAttach] = await Promise.all([getSeasonFormatSummary(seasonId), getT(formatStudioAttachMessages)]);
  return attached === null ? { active: tAttach('status.blockedNoFormat') } : undefined;
}

/**
 * `/admin/leagues/[id]?tab=` — one league's workspace (redesign A5): a header (name, format and ruleset, the status
 * control, one primary action) over seven link tabs (`src/lib/league-admin/tabs.ts`): overview (default),
 * participants, phases, format (Format and rules), draft (draft formats), live (custom leagues) and settings (with
 * the danger zone last). The format decides which tabs exist; an unknown or unavailable `?tab=` opens the
 * overview, and the earlier ids still open their tab: `schedule` phases, `rules` Format and rules at its rules
 * editors, `danger` Settings at the danger zone. The server renders, and reads for, the selected tab only: every
 * tab shares the live gate and the league row, the overview needs nothing else. The primary action is decided
 * from that row and the league machine (`leaguePrimaryAction`) and costs no read; on a phone it sits in a sticky
 * bar at the bottom of the page.
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
  const aliasSection = leagueAdminAliasSection(query[LEAGUE_ADMIN_TAB_PARAM]);
  const tabLink = (tab: LeagueAdminTab, section?: string) => (chunks: ReactNode) => (
    <Link href={leagueAdminHref(id, tab, section)} className="text-poke-blue hover:underline">
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
    phases: t('tabs.phases'),
    format: t('tabs.format'),
    draft: t('tabs.draft'),
    live: t('tabs.live'),
    settings: t('tabs.settings'),
  };
  // One primary action, from the row this page already holds and the league machine's legal moves: no read.
  const action = leaguePrimaryAction({
    id,
    status: league.status,
    archived: league.archived,
    formatType: league.format_type,
    participantCount: league.participant_count,
    phaseCount: league.tournament_count,
    activateBlocked: blockedStatuses?.active !== undefined,
  });
  const primaryAction = (block: boolean) =>
    action && (
      <LeaguePrimaryAction action={action} label={t(`action.${action.id}`)} seasonId={id} currentStatus={league.status} block={block} />
    );

  return (
    <AdminGuard>
      <div className="flex flex-col gap-6" data-admin-league-workspace>
        <AdminCrumbName href={`/admin/leagues/${id}`} name={league.name} />
        <LeagueWorkspaceHeader
          name={league.name}
          subtitle={subtitle}
          {...(league.is_test_season ? { testLabel: t('header.testBadge') } : {})}
          status={
            <LeagueStatusControl
              seasonId={id}
              currentStatus={league.status}
              {...(blockedStatuses ? { blocked: blockedStatuses } : {})}
            />
          }
          action={primaryAction(false)}
        />

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
        {aliasSection !== null && <AliasSectionScroll sectionId={aliasSection} />}

        {/* Phones: the primary action stays in reach in a bar that sticks to the bottom of the viewport. */}
        {action && (
          <div
            className="sticky bottom-0 z-20 -mx-4 border-t border-hairline bg-surface px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-8 md:hidden"
            data-admin-league-actionbar
          >
            {primaryAction(true)}
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
