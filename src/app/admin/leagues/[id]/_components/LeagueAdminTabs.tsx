import Link from 'next/link';
import HubTabStripScroll from '@/components/league/hub/HubTabStripScroll';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import { leagueAdminHref, type LeagueAdminTab } from '@/lib/league-admin/tabs';
import { cn } from '@/lib/utils/cn';
import AdminTabPending from './AdminTabPending';
import UnsavedTabGuard from './UnsavedTabGuard';
import { LEAGUE_ADMIN_TAB_ICONS } from './tab-icons';

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
 * The league workspace tab strip. Every tab is a link (`?tab=`), so the server
 * renders only the selected panel and the URL is shareable; the active one is
 * marked `aria-current="page"`. Each tab sits on a skewed plate with its item icon; the active plate carries the
 * accent underside, which glides to the next tab. On a phone the strip scrolls sideways inside
 * its own box (the page never does) and `HubTabStripScroll` keeps the active
 * tab in view; from `md` up it wraps instead. Labels never get a fixed width (German runs longer), and each
 * tab is at least 44 px tall below `sm`.
 *
 * A form in the panel that holds unsaved input marks itself `data-unsaved="true"`; `UnsavedTabGuard`
 * then asks before a tab switch (`src/lib/league-admin/unsaved.ts`).
 *
 * Server component; the client pieces are the plate, the pending dot, the strip scroll and the unsaved-input guard.
 */
export default function LeagueAdminTabs({ leagueId, tabs, activeTab, labels, navLabel, unsavedConfirm }: LeagueAdminTabsProps) {
  return (
    <nav aria-label={navLabel} className="min-w-0 border-b border-hairline">
      <ul data-hub-tab-strip className="flex gap-2 overflow-x-auto overscroll-x-contain px-1.5 pb-2 pt-1 md:flex-wrap md:overflow-x-visible">
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
                className="group relative inline-flex whitespace-nowrap text-body"
              >
                <SkewPlate
                  variant="tab"
                  active={active}
                  glideId="league-admin-tab"
                  className={cn(
                    'min-h-11 py-1.5 pl-2 pr-3.5 sm:min-h-0',
                    !active && 'text-fg-muted group-hover:text-fg motion-safe:transition-colors motion-safe:duration-80',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <ItemIcon item={LEAGUE_ADMIN_TAB_ICONS[tab]} />
                    {labels[tab]}
                  </span>
                </SkewPlate>
                <span className="pointer-events-none absolute right-1.5 top-1 flex">
                  <AdminTabPending />
                </span>
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
