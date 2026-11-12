'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import { formatShortcut, useIsMac } from '@/components/ui/fluid/command-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/fluid/sidebar';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import AdminAccountMenu from './AdminAccountMenu';
import { ADMIN_BACK_TO_SITE_HREF } from './AdminCommandMenu';
import {
  ADMIN_NEW_COMPETITION_HREF,
  activeAdminNavHref,
  adminNavSections,
  type VisibleAdminNavGroup,
  type VisibleAdminNavItem,
} from './adminNav';
import { NAV_ICONS } from './nav-icons';

const RAIL_FOCUS = 'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

function NavGroup({ group, activeHref }: { group: VisibleAdminNavGroup; activeHref: string | null }) {
  const t = useT(shellMessages);
  const labelOf = (item: VisibleAdminNavItem): string => (item.labelKey === undefined ? item.label : t(`admin.items.${item.labelKey}`));
  const holdsPage = group.items.some((item) => item.href === activeHref);

  // A folded group opens when the page moves into it (a command-menu jump, a link on a page); after that the admin's
  // own toggle stands until the page moves in again.
  const [open, setOpen] = useState(!group.collapsed || holdsPage);
  const [heldPage, setHeldPage] = useState(holdsPage);
  if (heldPage !== holdsPage) {
    setHeldPage(holdsPage);
    if (holdsPage) setOpen(true);
  }

  return (
    <SidebarGroup collapsible={group.collapsed} open={open} onOpenChange={setOpen}>
      <SidebarGroupLabel>
        {group.icon && <ItemIcon item={group.icon} />}
        <span className="min-w-0 truncate">{t(`admin.groups.${group.id}`)}</span>
      </SidebarGroupLabel>
      <SidebarMenu>
        {adminNavSections(group.items).map(({ item, subs }) => {
          const inSection = item.href === activeHref || subs.some((sub) => sub.href === activeHref);
          return (
            <SidebarMenuItem key={item.labelKey ?? item.href}>
              <SidebarMenuButton
                render={<Link href={item.href} />}
                isActive={inSection}
                // The page itself is the view below when the section has views (Leagues under Competitions).
                aria-current={inSection ? (subs.length > 0 ? 'true' : 'page') : undefined}
                icon={item.icon ? NAV_ICONS[item.icon] : undefined}
                className={item.icon ? undefined : 'pl-10'}
              >
                {labelOf(item)}
                {item.deprecated && (
                  <Badge variant="gray" size="xs">
                    {t('admin.legacy')}
                  </Badge>
                )}
              </SidebarMenuButton>
              {subs.length > 0 && (
                <SidebarMenuSub open={inSection} className="ml-[19px]">
                  {subs.map((sub) => (
                    <SidebarMenuSubItem key={sub.labelKey ?? sub.href}>
                      <SidebarMenuSubButton render={<Link href={sub.href} />} aria-current={sub.href === activeHref ? 'page' : undefined}>
                        {labelOf(sub)}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The admin sidebar (redesign A1): a rail that follows the theme (the page's sand in sunlit, umber in moonlit) with the wordmark, New competition, the
 * command-menu field, the role-filtered groups of `adminNav.ts` (a gold skewed plate marks the current section) and,
 * at the foot, Back to site and the account menu. It collapses with `[`, resizes from its edge and is a drawer below
 * 768 px (@fluid sidebar).
 */
export default function AdminSidebar({ groups, onOpenCommand }: { groups: readonly VisibleAdminNavGroup[]; onOpenCommand: () => void }) {
  const pathname = usePathname();
  const t = useT(shellMessages);
  const mac = useIsMac();
  const { setOpenMobile } = useSidebar();
  // One highlighted item: the most specific href the page sits under, extension items included.
  const activeHref = activeAdminNavHref(
    pathname,
    groups.flatMap((group) => group.items.map((item) => item.href)),
  );

  // The drawer closes when its link has taken the admin to another page.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const navRegionRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  // The rail's list scrolls on short windows; while rows are hidden below the fold a chevron says so.
  useEffect(() => {
    const scroller = navRegionRef.current?.querySelector<HTMLElement>('.scroll-fade');
    if (!scroller) return;
    const update = () => setMoreBelow(scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2);
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  const scrollRailDown = useCallback(() => {
    const scroller = navRegionRef.current?.querySelector<HTMLElement>('.scroll-fade');
    scroller?.scrollBy({ top: Math.max(scroller.clientHeight * 0.8, 96), behavior: 'smooth' });
  }, []);

  return (
    <Sidebar bordered={false}>
      <div data-admin-rail="" className="admin-rail flex h-full min-h-0 w-full flex-col">
        <SidebarHeader className="gap-3 p-3">
          <Link href="/admin" className={`flex items-baseline gap-2 self-start rounded-sm px-1 ${RAIL_FOCUS}`}>
            <span className="font-heading text-xl leading-7 text-fg">PokéTools</span>
            <span className="text-xs text-fg-muted">{t('admin.brand')}</span>
          </Link>
          <Link href={ADMIN_NEW_COMPETITION_HREF} className="flex rounded-sm">
            <SkewPlate variant="button" tone="primary" className="w-full py-2 text-sm">
              <span className="flex items-center gap-2">
                <ItemIcon item="premier-ball" />
                {t('admin.newCompetition')}
              </span>
            </SkewPlate>
          </Link>
          <button
            type="button"
            onClick={onOpenCommand}
            className={`flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-hairline bg-elevated px-2.5 text-left text-sm text-fg-muted transition-colors duration-80 hover:border-hairline-strong hover:text-fg ${RAIL_FOCUS}`}
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('admin.command.trigger')}</span>
            {/* Geist has no ⌘ glyph: the key caps use the system font. */}
            <kbd aria-hidden="true" className="shrink-0 rounded border border-hairline-strong px-1 font-[system-ui] text-[11px] leading-4 text-fg-muted">
              {formatShortcut('mod+k', mac).join(mac ? '' : '+')}
            </kbd>
          </button>
        </SidebarHeader>

        <div ref={navRegionRef} className="relative flex min-h-0 w-full flex-1 flex-col">
          <SidebarContent>
            <nav aria-label={t('admin.navLabel')}>
              {groups.map((group) => (
                <NavGroup key={group.id} group={group} activeHref={activeHref} />
              ))}
            </nav>
          </SidebarContent>
          {moreBelow && (
            <button
              type="button"
              onClick={scrollRailDown}
              aria-label={t('admin.moreItems')}
              className={`absolute bottom-1 right-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-hairline-strong bg-elevated text-fg shadow-sm transition-colors duration-80 hover:bg-hover ${RAIL_FOCUS}`}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <SidebarFooter className="border-t border-hairline p-2">
          <Link
            href={ADMIN_BACK_TO_SITE_HREF}
            className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm text-fg-muted transition-colors duration-80 hover:bg-hover hover:text-fg ${RAIL_FOCUS}`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('admin.backToSite')}
          </Link>
          <AdminAccountMenu />
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
