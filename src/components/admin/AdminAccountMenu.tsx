'use client';

import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ChevronsUpDown, Languages, LogOut, Moon, Settings, Sun, User } from 'lucide-react';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/fluid/dropdown';
import { MenuItem } from '@/components/ui/fluid/menu-item';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { clearPwaCaches } from '@/lib/pwa/caches';
import { useShellActions } from './useShellActions';

/**
 * The signed-in admin at the foot of the sidebar: profile, settings, theme, language and sign-out. The name and
 * avatar come from the session copy (display only); every admin page keeps its live guard.
 */
export default function AdminAccountMenu() {
  const t = useT(shellMessages);
  const router = useRouter();
  const { data: session } = useSession();
  const { dark, themeLabel, toggleTheme, languageLabel, switchLanguage } = useShellActions();
  const player = session?.player;
  if (!player) return null;

  return (
    <DropdownMenu>
      <DropdownTrigger
        render={
          <button
            type="button"
            aria-label={t('admin.account.menu')}
            className="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none transition-colors duration-80 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <PlayerAvatar avatarUrl={player.avatarUrl} discordAvatarUrl={session?.user?.image} name={player.name} size={24} />
            <span className="min-w-0 flex-1 truncate">{player.name}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
          </button>
        }
      />
      <DropdownContent side="top" align="start" className="min-w-52">
        <MenuItem index={0} icon={User} label={t('admin.account.profile')} onSelect={() => router.push(`/players/${player.playerId}`)} />
        <MenuItem index={1} icon={Settings} label={t('admin.account.settings')} onSelect={() => router.push('/dashboard/settings')} />
        <DropdownSeparator />
        <MenuItem index={2} icon={dark ? Sun : Moon} label={themeLabel} onSelect={toggleTheme} />
        <MenuItem index={3} icon={Languages} label={languageLabel} onSelect={switchLanguage} />
        <DropdownSeparator />
        <MenuItem
          index={4}
          icon={LogOut}
          label={t('admin.account.signOut')}
          // The worker's caches can hold what this session saw; they go before the session does.
          onSelect={() => void clearPwaCaches().then(() => signOut())}
        />
      </DropdownContent>
    </DropdownMenu>
  );
}
