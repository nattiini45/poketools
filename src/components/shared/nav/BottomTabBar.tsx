'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import BottomSheet from '@/components/shared/BottomSheet';
import { motion } from '@/components/shared/motion';
import ItemIcon from '@/components/ui/ItemIcon';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { SPRING } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils/cn';
import { BOTTOM_BAR_LINKS, BOTTOM_SHEET_LINKS, extensionLinkIcon, isNavPathActive } from './links';
import NavMenuLink from './NavMenuLink';

const TAB =
  'relative flex min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 text-micro ' +
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink';

/** The gold tick over the current tab; it glides between tabs. */
function Tick() {
  return (
    <motion.span
      layoutId="site-bottom-bar-tick"
      transition={SPRING.moderate}
      aria-hidden="true"
      className="absolute top-0 h-[3px] w-9 rounded-b-[2px] bg-tier-1"
    />
  );
}

/**
 * The phone bottom tab bar of a signed-in player (plan §3.1, D7-c): Home, Leagues, Teams, Wiki and More (a
 * sheet with Tournaments, Insights, Replays, Players and the pack's extension pages). Below `lg` only; the
 * desktop link row takes over there.
 *
 * Mounted by the (public), (player) and creator layouts, so never on a broadcast, auth or admin page.
 * globals.css ("Phone bottom tab bar") pads `main` while it is mounted, takes it away on a draft-room page
 * (the pick dock owns that edge) and parks it with the NavBar while a 3D route world is the page. The
 * wrapper is not a `body > nav` (the route chrome's selector) and counts as "inside the bar" for
 * RouteNavReveal through `data-navbar-drawer`.
 */
export default function BottomTabBar({ extraLinks = [] }: { extraLinks?: readonly { href: string; label: string }[] }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const t = useT(navMessages);
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!session?.player) return null;

  const sheetLinks = [
    ...BOTTOM_SHEET_LINKS.map((link) => ({ href: link.href, label: t(`links.${link.labelKey}`), icon: link.icon, also: link.also })),
    ...extraLinks.map((link) => ({ href: link.href, label: link.label, icon: extensionLinkIcon(link.href), also: undefined })),
  ];
  const moreActive = sheetLinks.some((link) => isNavPathActive(pathname, link.href, link.also));

  return (
    <>
      <div
        data-site-bottom-bar=""
        data-navbar-drawer=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <nav aria-label={t('bottomLabel')} className="mx-auto grid h-[56px] max-w-xl grid-cols-5">
          {BOTTOM_BAR_LINKS.map((link) => {
            const active = isNavPathActive(pathname, link.href, link.also);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(TAB, active ? 'font-[550] text-fg' : 'text-fg-muted')}
              >
                {active && <Tick />}
                <ItemIcon item={link.icon} />
                <span className="max-w-full truncate">{t(`links.${link.labelKey}`)}</span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className={cn(TAB, moreActive ? 'font-[550] text-fg' : 'text-fg-muted')}
          >
            {moreActive && <Tick />}
            <ItemIcon item="poke-doll" />
            <span className="max-w-full truncate">{t('links.more')}</span>
          </button>
        </nav>
      </div>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('links.more')}>
        <div className="flex flex-col gap-0.5 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {sheetLinks.map((link) => (
            <NavMenuLink
              key={link.href}
              href={link.href}
              icon={<ItemIcon item={link.icon} />}
              active={isNavPathActive(pathname, link.href, link.also)}
              onNavigate={() => setSheetOpen(false)}
            >
              {link.label}
            </NavMenuLink>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
