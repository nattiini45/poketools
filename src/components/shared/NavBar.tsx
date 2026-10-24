'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence, useReducedMotion, slideInRight } from '@/components/shared/motion';
import { SPRING } from '@/lib/motion/tokens';
import { FOCUS_RING } from '@/components/ui/panel';
import DiscordLoginButton from './DiscordLoginButton';
import PlayerAvatar from './PlayerAvatar';
import ThemeToggle from './ThemeToggle';
import PalettePicker, { PalettePickerSection } from './PalettePicker';
import LanguagePicker, { LanguagePickerSection } from './LanguagePicker';
import PwaInstallPrompt from './PwaInstallPrompt';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';

/** A key of `navMessages.links`; the label is translated where the link renders. */
export type NavLabelKey = keyof typeof navMessages.en.links;

export const publicNavLinks: readonly { href: string; labelKey: NavLabelKey }[] = [
  { href: '/tournaments', labelKey: 'tournaments' },
  { href: '/leagues', labelKey: 'leagues' },
  { href: '/replays', labelKey: 'replays' },
  { href: '/insights', labelKey: 'insights' },
  { href: '/wiki', labelKey: 'wiki' },
  { href: '/players', labelKey: 'players' },
];

/**
 * Desktop nav tab: quiet ink with an accent underline that slides between
 * tabs (same layoutId dialect as the world anchor nav). Exported so sub-navs
 * (CreatorNav) share one styling source.
 */
export function NavLink({
  href,
  label,
  active,
  layoutId = 'navbar-active-underline',
  dense = false,
}: {
  href: string;
  label: string;
  active: boolean;
  layoutId?: string;
  /** Tighter horizontal padding for the main bar, where ten links share the capped container. */
  dense?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`
        relative ${dense ? 'px-2' : 'px-3'} py-1.5 text-sm font-heading font-semibold whitespace-nowrap rounded-poke-md
        transition-colors duration-200 ${FOCUS_RING}
        ${active
          ? 'text-poke-accent'
          : 'text-poke-text-secondary hover:text-poke-text-primary hover:bg-poke-elevated'
        }
      `}
    >
      {label}
      {active && (
        <motion.span
          layoutId={layoutId}
          aria-hidden="true"
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-poke-accent"
          transition={reduced ? { duration: 0 } : SPRING.default}
        />
      )}
    </Link>
  );
}

function MobileNavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`
        block px-4 py-3 text-base font-heading font-semibold rounded-full
        transition-colors duration-200 ${FOCUS_RING}
        ${active
          ? 'text-poke-accent border border-poke-accent/30 bg-poke-accent-light'
          : 'text-poke-text-secondary border border-transparent hover:text-poke-text-primary hover:bg-poke-elevated'
        }
      `}
    >
      {label}
    </Link>
  );
}

/** The slide-out menu the hamburger opens (aria-controls target). */
const NAV_DRAWER_ID = 'navbar-drawer';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The profile caption (name + "View public profile") is visible between md and
 * xl and again from 2xl. At xl the bar carries ten links in the capped
 * container and has no room for it, so it collapses to the avatar alone (the
 * link keeps its title tooltip and the text stays available to screen readers).
 */
export const PROFILE_TEXT_VISIBILITY = 'sr-only md:not-sr-only xl:sr-only 2xl:not-sr-only';

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

  const allLinkKeys: { href: string; labelKey: NavLabelKey }[] = [
    ...publicNavLinks,
    ...(player ? [{ href: '/teambuilder', labelKey: 'teams' as const }] : []),
    ...(player?.isCreator ? [{ href: '/creator', labelKey: 'creator' as const }] : []),
    ...(player?.isAdmin || player?.isResourceAdmin ? [{ href: '/admin', labelKey: 'admin' as const }] : []),
  ];
  const builtInLinks = allLinkKeys.map((link) => ({ href: link.href, label: t(`links.${link.labelKey}`) }));
  // Extension pages follow the public links, before the signed-in and role links.
  const allLinks = [
    ...builtInLinks.slice(0, publicNavLinks.length),
    ...extraLinks,
    ...builtInLinks.slice(publicNavLinks.length),
  ];

  return (
    <>
      {/* `id`: the route-tier WorldNav's menu chip controls this bar over the
          3D world (D33, RouteNavReveal); inert on every other page. */}
      <nav
        id="site-nav"
        data-navbar-glass=""
        className="sticky top-0 z-40 border-b border-poke-border backdrop-blur-[18px] backdrop-saturate-[1.25] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(26,23,20,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.3)]"
      >
        <div className="max-w-7xl 2xl:max-w-[96rem] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-3">
            {/* Logo + Desktop nav */}
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={player ? '/dashboard' : '/'}
                className={`text-xl font-heading font-extrabold uppercase tracking-[0.04em] text-poke-accent mr-2 xl:mr-3 shrink-0 whitespace-nowrap rounded-poke-sm transition-opacity hover:opacity-80 ${FOCUS_RING}`}
              >
                PokéTools
              </Link>

              {/* Desktop links: the capped container only fits them from xl up;
                  below that the menu button carries them. */}
              <div className="hidden xl:flex items-center gap-1">
                {allLinks.map((link) => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                    active={pathname.startsWith(link.href)}
                    dense
                  />
                ))}
              </div>
            </div>

            {/* Right side: user + auth. Only the name shrinks (truncates); every
                control keeps its size so nothing is pushed out of the viewport. */}
            <div className="flex min-w-0 items-center gap-2 md:gap-3">
              {player && (
                <Link
                  href={`/players/${player.playerId}`}
                  title={player.name}
                  className={`hidden sm:flex min-w-0 items-center gap-2 rounded-poke-md transition-opacity hover:opacity-80 ${FOCUS_RING}`}
                >
                  <PlayerAvatar
                    avatarUrl={player.avatarUrl}
                    discordAvatarUrl={session?.user?.image}
                    name={player.name}
                    size={28}
                    className="shrink-0"
                  />
                  <div className={`flex min-w-0 flex-col 2xl:shrink-0 ${PROFILE_TEXT_VISIBILITY}`}>
                    <span className="truncate max-w-[10rem] text-sm font-heading font-semibold text-poke-text-primary leading-tight">
                      {player.name}
                    </span>
                    <span className="truncate max-w-[10rem] text-[10px] text-poke-text-muted leading-tight">
                      {t('viewPublicProfile')}
                    </span>
                  </div>
                </Link>
              )}
              <div className="hidden shrink-0 whitespace-nowrap sm:block">
                <DiscordLoginButton />
              </div>
              <LanguagePicker />
              <PalettePicker />
              <ThemeToggle />

              {/* Mobile hamburger */}
              <button
                ref={menuButtonRef}
                onClick={() => setMobileOpen(!mobileOpen)}
                className={`xl:hidden shrink-0 p-2 rounded-poke-md text-poke-text-secondary hover:bg-poke-elevated hover:text-poke-text-primary transition-colors ${FOCUS_RING}`}
                aria-label={t('toggleMenu')}
                aria-expanded={mobileOpen}
                aria-controls={NAV_DRAWER_ID}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {mobileOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile slide-out menu */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              data-navbar-drawer=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-poke-inverse/30 backdrop-blur-sm xl:hidden"
              onClick={() => setMobileOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              id={NAV_DRAWER_ID}
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('menuLabel')}
              onKeyDown={trapTab}
              data-navbar-drawer=""
              {...slideInRight}
              className="fixed top-0 right-0 bottom-0 z-50 w-72 border-l border-poke-border bg-poke-surface shadow-poke-lg xl:hidden"
            >
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-4 border-b border-poke-border">
                  <span className="text-lg font-heading font-extrabold uppercase tracking-[0.04em] text-poke-accent">PokéTools</span>
                  <button
                    ref={closeButtonRef}
                    onClick={() => setMobileOpen(false)}
                    className={`p-2 rounded-poke-md text-poke-text-secondary hover:bg-poke-elevated transition-colors ${FOCUS_RING}`}
                    aria-label={t('closeMenu')}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* User info (mobile) */}
                {player && (
                  <Link
                    href={`/players/${player.playerId}`}
                    onClick={() => setMobileOpen(false)}
                    className={`block px-4 py-3 border-b border-poke-border bg-poke-elevated/50 hover:bg-poke-elevated transition-colors ${FOCUS_RING}`}
                  >
                    <div className="flex items-center gap-3">
                      <PlayerAvatar
                        avatarUrl={player.avatarUrl}
                        discordAvatarUrl={session?.user?.image}
                        name={player.name}
                        size={36}
                      />
                      <div>
                        <p className="text-sm font-heading font-bold text-poke-text-primary">
                          {player.name}
                        </p>
                        <p className="text-xs text-poke-text-muted">
                          {t('viewPublicProfile')}
                        </p>
                      </div>
                    </div>
                  </Link>
                )}

                {/* Scroll region: the links and the palette section scroll
                    together; the auth footer below stays put. */}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {/* Navigation links */}
                  <nav className="px-3 py-3 space-y-1">
                    {allLinks.map((link) => (
                      <MobileNavLink
                        key={link.href}
                        href={link.href}
                        label={link.label}
                        active={pathname.startsWith(link.href)}
                        onClick={() => setMobileOpen(false)}
                      />
                    ))}
                  </nav>

                  {/* Site colour scheme (selecting keeps the drawer open) */}
                  <PalettePickerSection />
                  {/* Site language and "Keep Pokémon terms in English" */}
                  <LanguagePickerSection />
                </div>

                {/* Auth button */}
                <div className="px-4 py-4 border-t border-poke-border">
                  <DiscordLoginButton />
                  <PwaInstallPrompt className="mt-3" />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
