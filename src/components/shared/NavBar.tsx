'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence, slideInRight } from '@/components/shared/motion';
import { FluidHoverHighlight } from '@/components/ui/fluid/fluid-hover-highlight';
import ItemIcon from '@/components/ui/ItemIcon';
import { FOCUS_RING } from '@/components/ui/panel';
import SkewPlate from '@/components/ui/SkewPlate';
import NotificationBell from '@/components/notifications/NotificationBell';
import { useFluidHover, useRegisterFluidHoverItem } from '@/hooks/fluid/use-fluid-hover';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { DURATION } from '@/lib/motion/tokens';
import DiscordLoginButton from './DiscordLoginButton';
import { LanguagePickerSection } from './LanguagePicker';
import PwaInstallPrompt from './PwaInstallPrompt';
import AccountMenu from './nav/AccountMenu';
import AppearanceSettings, { MENU_LEGEND } from './nav/AppearanceSettings';
import { MORE_NAV_LINKS, extensionLinkIcon, isNavPathActive, primaryNavLinks } from './nav/links';
import MoreMenu from './nav/MoreMenu';
import NavMenuLink from './nav/NavMenuLink';
import SiteSearch from './nav/SiteSearch';

/**
 * One link of a plate row: the current page sits on the gold skewed plate, which glides between the links of
 * one row (`glideId`). Exported so sub-navs (CreatorNav) share one styling source.
 */
export function NavLink({
  href,
  label,
  active,
  icon,
  glideId = 'site-nav-plate',
  hoverIndex,
  registerHover,
}: {
  href: string;
  label: string;
  active: boolean;
  icon?: ReactNode;
  glideId?: string;
  /** With `registerHover`: the link's place in its row's gliding hover highlight. */
  hoverIndex?: number;
  registerHover?: (index: number, element: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useRegisterFluidHoverItem(registerHover, hoverIndex, ref);
  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? 'page' : undefined}
      data-fluid-hover-index={hoverIndex}
      className="relative inline-flex shrink-0 whitespace-nowrap rounded-[3px] text-body"
    >
      <SkewPlate variant="nav" active={active} glideId={glideId} icon={icon}>
        {label}
      </SkewPlate>
    </Link>
  );
}

function Wordmark({ href, onClick }: { href: string; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-poke-sm font-heading text-[22px] leading-none text-fg dark:text-accent-ink ${FOCUS_RING}`}
    >
      <span aria-hidden="true" className="h-5 w-2 rounded-[2px] bg-accent-fill [transform:skewX(var(--skew))]" />
      PokéTools
    </Link>
  );
}

/** The slide-out menu the hamburger opens (aria-controls target). */
const NAV_DRAWER_ID = 'navbar-drawer';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The site bar (plan §3.1). From `lg`: the wordmark, the link row with More, then search, the bell and the
 * account menu. Below `lg` a signed-in player keeps the wordmark, search, bell and account menu up here and
 * gets the links in the bottom tab bar (`nav/BottomTabBar.tsx`); a signed-out visitor gets Sign in and the
 * drawer.
 *
 * Contract (route worlds, draft room): the `#site-nav` element is a direct child of `<body>`, 64 px tall, and
 * every menu it opens stays inside it (`nav/use-nav-disclosure.ts`).
 */
export default function NavBar({
  extraLinks = [],
}: {
  /** Public pages of the active pack extension (docs/format-packs.md), labels already localized. */
  extraLinks?: readonly { href: string; label: string }[];
} = {}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(rowRef, { axis: 'x' });

  // Escape closes the drawer; focus moves into it on open and back to the menu
  // button on close.
  useEffect(() => {
    if (mobileOpen) {
      closeButtonRef.current?.focus();
      wasOpen.current = true;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setMobileOpen(false);
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  /** Keep Tab inside the modal drawer. */
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const player = session?.player;
  const t = useT(navMessages);
  const links = primaryNavLinks(Boolean(player));
  // The six links of a player fit beside the right cluster with their icons from 1152 px (measured with German labels and an admin's long name; below it the account name truncates); a visitor's four fit from lg.
  const iconClassName = player ? 'hidden min-[1152px]:inline-block' : '';
  const closeDrawer = () => setMobileOpen(false);

  return (
    <>
      {/* `id`: the route-tier WorldNav's menu chip controls this bar over the
          3D world (D33, RouteNavReveal); inert on every other page. */}
      <nav
        id="site-nav"
        data-navbar-glass=""
        aria-label={t('mainLabel')}
        className="sticky top-0 z-40 border-b border-hairline backdrop-blur-[18px] backdrop-saturate-[1.25]"
      >
        <div className="mx-auto max-w-[1440px] px-[18px] sm:px-[27px] lg:px-[36px]">
          <div className="flex h-16 items-center justify-between gap-3">
            <div className="flex shrink-0 items-center gap-3 xl:gap-5">
              <Wordmark href={player ? '/dashboard' : '/'} />
              <div ref={rowRef} {...hover.handlers} className="relative hidden items-center gap-0.5 lg:flex">
                <FluidHoverHighlight
                  hover={hover}
                  className="bg-transparent before:absolute before:inset-0 before:rounded-[3px] before:bg-sunken before:content-[''] before:[transform:skewX(var(--skew))]"
                />
                {links.map((link, index) => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={t(`links.${link.labelKey}`)}
                    active={isNavPathActive(pathname, link.href, link.also)}
                    icon={<ItemIcon item={link.icon} className={iconClassName} />}
                    hoverIndex={index}
                    registerHover={hover.registerItem}
                  />
                ))}
                <MoreMenu
                  extraLinks={extraLinks}
                  iconClassName={iconClassName}
                  hoverIndex={links.length}
                  registerHover={hover.registerItem}
                />
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <SiteSearch signedIn={Boolean(player)} extraLinks={extraLinks} />
              {player ? <NotificationBell /> : <DiscordLoginButton />}
              <AccountMenu />
              {!player && (
                <button
                  ref={menuButtonRef}
                  type="button"
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-poke-md text-fg-muted transition-colors duration-[80ms] hover:bg-hover hover:text-fg lg:hidden ${FOCUS_RING}`}
                  aria-label={t('toggleMenu')}
                  aria-expanded={mobileOpen}
                  aria-controls={NAV_DRAWER_ID}
                >
                  <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* The signed-out drawer below lg: the links, Appearance, Language and Sign in. */}
      <AnimatePresence>
        {mobileOpen && !player && (
          <>
            <motion.div
              data-navbar-drawer=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.state }}
              className="fixed inset-0 z-40 bg-scrim lg:hidden"
              onClick={closeDrawer}
            />

            <motion.div
              id={NAV_DRAWER_ID}
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('menuLabel')}
              onKeyDown={trapTab}
              data-navbar-drawer=""
              {...slideInRight}
              className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col border-l border-hairline bg-surface shadow-poke-lg lg:hidden"
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-4">
                <Wordmark href="/" onClick={closeDrawer} />
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeDrawer}
                  className={`flex size-9 cursor-pointer items-center justify-center rounded-poke-md text-fg-muted transition-colors duration-[80ms] hover:bg-hover hover:text-fg ${FOCUS_RING}`}
                  aria-label={t('closeMenu')}
                >
                  <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* One scroll region: the links and the settings scroll together; the sign-in footer stays put. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-0.5 p-3">
                  {[...links, ...MORE_NAV_LINKS].map((link) => (
                    <NavMenuLink
                      key={link.href}
                      href={link.href}
                      icon={<ItemIcon item={link.icon} />}
                      active={isNavPathActive(pathname, link.href, link.also)}
                      onNavigate={closeDrawer}
                    >
                      {t(`links.${link.labelKey}`)}
                    </NavMenuLink>
                  ))}
                  {extraLinks.map((link) => (
                    <NavMenuLink
                      key={link.href}
                      href={link.href}
                      icon={<ItemIcon item={extensionLinkIcon(link.href)} />}
                      active={isNavPathActive(pathname, link.href)}
                      onNavigate={closeDrawer}
                    >
                      {link.label}
                    </NavMenuLink>
                  ))}
                </div>
                <div className="flex flex-col gap-4 border-t border-hairline px-4 py-4">
                  <AppearanceSettings name="site-drawer" />
                  <LanguagePickerSection name="site-drawer-language" legendClassName={MENU_LEGEND} />
                </div>
              </div>

              {/* Auth button */}
              <div className="flex shrink-0 flex-col items-start gap-3 border-t border-hairline px-4 py-4">
                <DiscordLoginButton />
                <PwaInstallPrompt />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
