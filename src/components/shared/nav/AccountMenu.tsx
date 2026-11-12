'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, Clapperboard, Languages, LogOut, Palette, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { FOCUS_RING } from '@/components/ui/panel';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { shellMessages } from '@/i18n/messages/shell';
import { clearInvalidStoredSitePalette } from '@/lib/design/site-palette-store';
import { cn } from '@/lib/utils/cn';
import { signOutAndClearCaches } from '../DiscordLoginButton';
import { LanguagePickerSection } from '../LanguagePicker';
import PlayerAvatar from '../PlayerAvatar';
import PwaInstallPrompt from '../PwaInstallPrompt';
import AppearanceSettings, { MENU_LEGEND } from './AppearanceSettings';
import NavMenuLink from './NavMenuLink';
import { useNavDisclosure } from './use-nav-disclosure';

const ROW =
  'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-poke-md px-2.5 text-left text-body text-fg ' +
  `transition-colors duration-[80ms] hover:bg-hover lg:min-h-9 ${FOCUS_RING}`;

const ICON = 'size-[18px]';

/** A row that opens its group in place (Appearance, Language). */
function MenuGroup({
  icon,
  label,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={onToggle} className={ROW}>
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-fg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDown aria-hidden="true" className={cn('size-4 text-fg-muted transition-transform duration-[160ms]', open && 'rotate-180')} />
      </button>
      {open && <div className="mb-1 mt-1 rounded-poke-md bg-elevated p-2.5">{children}</div>}
    </div>
  );
}

/**
 * The account menu at the end of the bar (plan §3.1): profile, settings, Appearance (theme, palette, sprite
 * style), Language, Creator Hub, Admin and sign out. A signed-out visitor gets Appearance and Language alone,
 * from `lg` up (below that the drawer carries them). Creator Hub and Admin show from the session copy, which is
 * display only: their pages keep their live guards.
 *
 * A disclosure inside `#site-nav`, never portalled (`use-nav-disclosure.ts`).
 */
export default function AccountMenu() {
  const { data: session } = useSession();
  const player = session?.player;
  const t = useT(navMessages);
  const tShell = useT(shellMessages);
  const { open, setOpen, panelId, wrapperRef, triggerRef } = useNavDisclosure();
  const [group, setGroup] = useState<'appearance' | 'language' | null>(null);
  const toggle = (next: 'appearance' | 'language') => setGroup(group === next ? null : next);
  const close = () => setOpen(false);

  // One cleanup of hand-edited or retired stored palette values. Side effect only, no setState.
  useEffect(() => {
    clearInvalidStoredSitePalette();
  }, []);

  return (
    <div ref={wrapperRef} className={cn('relative', player ? 'min-w-0 shrink' : 'shrink-0 hidden lg:block')}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={player ? t('account.trigger') : t('account.guestTrigger')}
        title={player?.name}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-poke-md text-body text-fg transition-colors duration-[80ms] hover:bg-hover',
          player ? 'border border-hairline bg-surface pl-1 pr-1.5' : 'w-9 justify-center text-fg-muted hover:text-fg',
          FOCUS_RING,
        )}
      >
        {player ? (
          <>
            <PlayerAvatar
              avatarUrl={player.avatarUrl}
              discordAvatarUrl={session?.user?.image}
              name={player.name}
              size={26}
              className="shrink-0"
            />
            <span aria-hidden="true" className="hidden min-w-0 max-w-[9rem] truncate font-[550] 2xl:block">
              {player.name}
            </span>
            <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-fg-muted transition-transform duration-[160ms]', open && 'rotate-180')} />
          </>
        ) : (
          <SlidersHorizontal aria-hidden="true" className="size-5" />
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[calc(100dvh-5.5rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-0.5 overflow-y-auto rounded-poke-lg border border-hairline bg-surface p-1.5 shadow-poke-lg"
        >
          {player && (
            <>
              <Link
                href={`/players/${player.playerId}`}
                onClick={close}
                className={`flex items-center gap-3 rounded-poke-md p-2.5 transition-colors duration-[80ms] hover:bg-hover ${FOCUS_RING}`}
              >
                <PlayerAvatar
                  avatarUrl={player.avatarUrl}
                  discordAvatarUrl={session?.user?.image}
                  name={player.name}
                  size={40}
                  className="shrink-0"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-heading text-title text-fg">{player.name}</span>
                  <span className="truncate text-caption text-fg-muted">{t('viewPublicProfile')}</span>
                </span>
              </Link>
              <div aria-hidden="true" className="mx-2.5 my-1 h-px bg-hairline" />
              <NavMenuLink href="/dashboard/settings" icon={<Settings className={ICON} />} onNavigate={close}>
                {t('account.settings')}
              </NavMenuLink>
            </>
          )}
          <MenuGroup
            icon={<Palette className={ICON} />}
            label={t('account.appearance')}
            open={group === 'appearance'}
            onToggle={() => toggle('appearance')}
          >
            <AppearanceSettings name="site-menu" />
          </MenuGroup>
          <MenuGroup
            icon={<Languages className={ICON} />}
            label={t('account.language')}
            open={group === 'language'}
            onToggle={() => toggle('language')}
          >
            <LanguagePickerSection name="site-menu-language" legendClassName={MENU_LEGEND} />
          </MenuGroup>
          {player && (
            <>
              {(player.isCreator || player.isAdmin || player.isResourceAdmin) && (
                <div aria-hidden="true" className="mx-2.5 my-1 h-px bg-hairline" />
              )}
              {player.isCreator && (
                <NavMenuLink href="/creator" icon={<Clapperboard className={ICON} />} onNavigate={close}>
                  {t('links.creator')}
                </NavMenuLink>
              )}
              {(player.isAdmin || player.isResourceAdmin) && (
                <NavMenuLink href="/admin" icon={<ShieldCheck className={ICON} />} onNavigate={close}>
                  {t('links.admin')}
                </NavMenuLink>
              )}
              <div aria-hidden="true" className="mx-2.5 my-1 h-px bg-hairline" />
              <button type="button" onClick={() => void signOutAndClearCaches()} className={ROW}>
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-fg-muted">
                  <LogOut className={ICON} />
                </span>
                {tShell('session.signOut')}
              </button>
              <PwaInstallPrompt className="mt-1.5" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
