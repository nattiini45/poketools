import Link from 'next/link';
import { FOCUS_RING, PANEL } from '@/components/world/panel';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { isEvolutionPointBuy, leagueDraftHref } from '@/lib/season/format-utils';
import { LEAGUE_TIME_ZONE, type Locale } from '@/i18n/config';
import { createFormatter } from '@/i18n/format';
import { hubSharedLabels, leagueHubCopy, type HubSharedLabels, type LeagueHubCopy } from '@/lib/league-hub/copy';
import { leagueHubHref, type LeagueHubTab } from '@/lib/league-hub/tabs';
import type { LeagueHubPanelData } from '@/lib/league-hub/load';
import type { PublicSeasonParticipant } from '@/lib/players/public-player';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import { HubNotice, HubStatusChip } from './HubBits';
import HubTabPending from './HubTabPending';
import HubTabStripScroll from './HubTabStripScroll';
import HubStandingsTable from './HubStandingsTable';
import HubMatchesPanel from './HubMatchesPanel';
import HubGroupsPanel from './HubGroupsPanel';
import HubPlayoffsPanel from './HubPlayoffsPanel';
import HubPhasesPanel from './HubPhasesPanel';
import HubInsightsPanel from './HubInsightsPanel';
import HubRulesPanel from './HubRulesPanel';
import HubReportsPanel from './HubReportsPanel';

export interface LeagueHubProps {
  league: SeasonWithDetails;
  stages: readonly TournamentWithDetails[];
  participants: readonly PublicSeasonParticipant[];
  /** The viewer's UI language (`getLocale()`); the hub no longer follows the world. */
  locale: Locale;
  /** The request's query, so tab links keep every other param (`?world=`, focus params). */
  query: Readonly<Record<string, string | string[] | undefined>>;
  tabs: readonly LeagueHubTab[];
  activeTab: LeagueHubTab;
  panel: LeagueHubPanelData;
}

/** The DOM id of the active panel; the active tab points at it. */
export const LEAGUE_HUB_PANEL_ID = 'league-hub-panel';

function tabLabel(tab: LeagueHubTab, stages: readonly TournamentWithDetails[], copy: LeagueHubCopy): string {
  if (tab === 'groups' && !stages.some((stage) => stage.bracket_type === 'round_robin')) return copy.swissTab;
  return copy.tabs[tab];
}

function Panel({
  panel,
  league,
  participants,
  copy,
  shared,
}: {
  panel: LeagueHubPanelData;
  league: SeasonWithDetails;
  participants: readonly PublicSeasonParticipant[];
  copy: LeagueHubCopy;
  /** German labels for the shared components the panels embed; null in English (their defaults). */
  shared: HubSharedLabels | null;
}) {
  switch (panel.tab) {
    case 'standings':
      // The tiebreak column the note names is shown, so tied rows read in
      // order: Buchholz for the generic table, evolution points for EPB.
      return (
        <div className="space-y-2">
          <p className="text-xs text-arena-ink-secondary">
            {copy.standingsNote} {panel.isEvolutionPointBuy ? copy.seasonEvolutionScoring : copy.seasonScoring}
          </p>
          <HubStandingsTable
            rows={panel.standings}
            copy={copy}
            caption={copy.tabs.standings}
            gymTypes={Object.fromEntries(participants.map((participant) => [participant.id, participant.gym_type]))}
            columns={{
              movement: true,
              evolution: panel.isEvolutionPointBuy,
              buchholz: !panel.isEvolutionPointBuy,
            }}
          />
        </div>
      );
    case 'matches':
      return <HubMatchesPanel stages={panel.stages} copy={copy} />;
    case 'groups':
      return (
        <HubGroupsPanel
          stages={panel.stages}
          isEvolutionPointBuy={panel.isEvolutionPointBuy}
          copy={copy}
          gridLabels={shared?.resultsGrid}
        />
      );
    case 'playoffs':
      return <HubPlayoffsPanel stages={panel.stages} copy={copy} bracketCopy={shared?.bracket} />;
    case 'phases':
      return <HubPhasesPanel phases={panel.phases} copy={copy} />;
    case 'insights':
      return (
        <HubInsightsPanel
          leagueId={league.id}
          usageRows={panel.usageRows}
          killRanking={panel.killRanking}
          isDoubles={panel.isDoubles}
          copy={copy}
          labels={shared?.insights}
        />
      );
    case 'rules':
      return (
        <HubRulesPanel
          description={league.description}
          ruleset={panel.ruleset}
          coreParticipants={
            getFormatCapabilities(league.format_type).typeCores
              ? participants.map((participant) => ({
                  id: participant.id,
                  name: participant.name,
                  coreTypes: participant.core_types,
                }))
              : undefined
          }
          formatRulesHref={isEvolutionPointBuy(league.format_type) ? '#rules' : undefined}
          copy={copy}
          rulesetLabels={shared?.ruleset}
        />
      );
    case 'reports':
      return <HubReportsPanel reports={panel.reports} copy={copy} />;
    case 'unavailable':
      // The tab's reads failed (logged server-side by the loader); the rest
      // of the league page still renders.
      return (
        <div data-hub-unavailable={panel.requested}>
          <HubNotice>{copy.tabUnavailable}</HubNotice>
        </div>
      );
  }
}

/**
 * The league hub: everything about a league one click away, at the top of
 * the league page (inside the world's #pulse section, so it takes the
 * world's palette and hides with the other sections while the 3D scene runs).
 *
 * A header strip (format, ruleset, trainers, status, dates, league links),
 * a tab bar, and the active panel. Tabs are links (`?tab=`): the server
 * renders only the selected panel, reading only its data, and the switch
 * keeps the scroll position and every client state on the page. Server
 * component; the client pieces are the pending mark on a clicked tab and the
 * kickoff times (`<LocalTime>`, the viewer's zone). The words follow the
 * viewer's language (`locale`, from the page's `getLocale()`).
 */
export default function LeagueHub({
  league,
  stages,
  participants,
  locale,
  query,
  tabs,
  activeTab,
  panel,
}: LeagueHubProps) {
  const copy = leagueHubCopy(locale);
  const caps = getFormatCapabilities(league.format_type);
  // The format's own draft page: the arena (`/draft-room`) for Evolution
  // Point Buy, `/draft` for the plain draft format, as the Pulse CTA links.
  const draftHref = leagueDraftHref(league.id, league.format_type);
  const links = [
    { href: `/insights?scope=league&id=${league.id}&tab=usage`, label: copy.links.insights },
    ...(draftHref ? [{ href: draftHref, label: copy.links.draft }] : []),
    ...(caps.matchupRoles ? [{ href: `/leagues/${league.id}/matchup`, label: copy.links.matchup }] : []),
  ];
  const facts = [
    copy.formatType[league.format_type] ?? league.format_type,
    league.ruleset_name,
    copy.trainers(league.participant_count),
  ].filter((fact): fact is string => typeof fact === 'string' && fact.length > 0);
  // Calendar days (Postgres `date`): zone-free, so the server may format them (rule T2).
  const formatter = createFormatter({ locale, timeZone: LEAGUE_TIME_ZONE });
  const dates = [
    league.start_date ? copy.startDate(formatter.calendarDate(league.start_date)) : null,
    league.end_date ? copy.endDate(formatter.calendarDate(league.end_date)) : null,
  ].filter((date): date is string => date !== null);
  const activeTabId = `league-hub-tab-${activeTab}`;

  // `scroll-mt-24` clears the sticky site and anchor navs (as SectionShell
  // does for the world sections), so a `#league-hub` landing shows the
  // heading, not just the tab bar.
  return (
    <div
      id="league-hub"
      role="region"
      aria-labelledby="league-hub-heading"
      data-league-hub={activeTab}
      className={`league-hub mt-8 scroll-mt-24 ${PANEL} p-4 sm:p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h3 id="league-hub-heading" className="font-heading text-xl font-bold tracking-tight text-arena-ink">
            {copy.heading}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-arena-ink-secondary">
            {facts.map((fact, index) => (
              <span key={fact} className="inline-flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">·</span>}
                {fact}
              </span>
            ))}
            <HubStatusChip status={league.status} label={copy.status[league.status] ?? league.status} />
          </p>
          {dates.length > 0 && <p className="text-xs text-arena-ink-secondary">{dates.join(' — ')}</p>}
        </div>
        <ul className="flex flex-wrap gap-2">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`inline-flex items-center rounded-lg border border-arena-border bg-arena-elevated px-3 py-1.5 text-sm font-semibold text-arena-ink transition-colors duration-150 hover:border-arena-accent motion-reduce:transition-none ${FOCUS_RING}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <nav aria-label={copy.tablistLabel} className="mt-5 border-b border-arena-border">
        <ul data-hub-tab-strip className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab === activeTab;
            return (
              <li key={tab} className="shrink-0">
                <Link
                  id={`league-hub-tab-${tab}`}
                  href={leagueHubHref(league.id, query, tab)}
                  scroll={false}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  aria-controls={active ? LEAGUE_HUB_PANEL_ID : undefined}
                  data-hub-tab={tab}
                  className={`inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2 font-heading text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${FOCUS_RING} focus-visible:outline-offset-[-2px] ${
                    active
                      ? 'border-arena-accent text-arena-ink'
                      : 'border-transparent text-arena-ink-secondary hover:border-arena-border hover:text-arena-ink'
                  }`}
                >
                  {tabLabel(tab, stages, copy)}
                  <HubTabPending />
                </Link>
              </li>
            );
          })}
        </ul>
        <HubTabStripScroll activeTab={activeTab} />
      </nav>

      <div id={LEAGUE_HUB_PANEL_ID} role="region" aria-labelledby={activeTabId} className="pt-5">
        <Panel
          panel={panel}
          league={league}
          participants={participants}
          copy={copy}
          shared={hubSharedLabels(locale)}
        />
      </div>
    </div>
  );
}
