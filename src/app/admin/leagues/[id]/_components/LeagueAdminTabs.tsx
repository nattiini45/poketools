import Link from 'next/link';
import HubTabStripScroll from '@/components/league/hub/HubTabStripScroll';
import { leagueAdminHref, type LeagueAdminTab } from '@/lib/league-admin/tabs';
import AdminTabPending from './AdminTabPending';
import UnsavedTabGuard from './UnsavedTabGuard';

/** The DOM id of the active tab panel; the active tab points at it. */
export const LEAGUE_ADMIN_PANEL_ID = 'league-admin-panel';

/** The DOM id of one tab link (the panel region is labelled by the active one). */
export function leagueAdminTabId(tab: LeagueAdminTab): string {
  return `league-admin-tab-${tab}`;
}

interface LeagueAdminTabsProps {
  leagueId: string;
  tabs: readonly LeagueAdminTab[];
  activeTab: LeagueAdminTab;
  /** Translated tab names, keyed by tab. */
  labels: Readonly<Record<LeagueAdminTab, string>>;
  /** The `<nav>` landmark name. */
  navLabel: string;
  /** The confirm question before leaving a tab with unsaved input (`tabs.unsavedConfirm`). */
  unsavedConfirm: string;
}

/**
 * The league admin tab strip. Every tab is a link (`?tab=`), so the server
 * renders only the selected panel and the URL is shareable; the active one is
 * marked `aria-current="page"`. On a phone the strip scrolls sideways inside
 * its own box (the page never does) and `HubTabStripScroll` keeps the active
 * tab in view; labels never get a fixed width (German runs longer), and each
 * tab is at least 44 px tall below `sm`.
 *
 * A form in the panel that holds unsaved input marks itself `data-unsaved="true"`; `UnsavedTabGuard`
 * then asks before a tab switch (`src/lib/league-admin/unsaved.ts`).
 *
 * Server component; the client pieces are the pending dot, the strip scroll and the unsaved-input guard.
 */
export default function LeagueAdminTabs({ leagueId, tabs, activeTab, labels, navLabel, unsavedConfirm }: LeagueAdminTabsProps) {
  return (
    <nav aria-label={navLabel} className="min-w-0 border-b border-poke-border">
      <ul data-hub-tab-strip className="-mb-px flex gap-1 overflow-x-auto overscroll-x-contain">
        {tabs.map((tab) => {
          const active = tab === activeTab;
          return (
            <li key={tab} className="shrink-0">
              <Link
                id={leagueAdminTabId(tab)}
                href={leagueAdminHref(leagueId, tab)}
                scroll={false}
                prefetch={false}
                aria-current={active ? 'page' : undefined}
                aria-controls={active ? LEAGUE_ADMIN_PANEL_ID : undefined}
                data-admin-tab={tab}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 py-2 font-heading text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-poke-focus motion-safe:transition-colors motion-safe:duration-150 sm:min-h-0 ${
                  active
                    ? 'border-poke-accent text-poke-text-primary'
                    : 'border-transparent text-poke-text-secondary hover:border-poke-border hover:text-poke-text-primary'
                }`}
              >
                {labels[tab]}
                <AdminTabPending />
              </Link>
            </li>
          );
        })}
      </ul>
      <HubTabStripScroll activeTab={activeTab} />
      <UnsavedTabGuard panelId={LEAGUE_ADMIN_PANEL_ID} message={unsavedConfirm} />
    </nav>
  );
}
