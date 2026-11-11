'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Languages, MessageSquare, Moon, Sun } from 'lucide-react';
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  type CommandMenuItemData,
} from '@/components/ui/fluid/command-menu';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { ADMIN_NEW_COMPETITION_HREF, adminNavSections, type VisibleAdminNavGroup } from './adminNav';
import { openAdminAssistant } from './assistant/AssistantDrawer';
import { NAV_ICONS } from './nav-icons';
import { useShellActions } from './useShellActions';

/** Where "Back to site" leads: the signed-in home. */
export const ADMIN_BACK_TO_SITE_HREF = '/dashboard';

/**
 * The admin command menu (⌘K / Ctrl+K): every page the sidebar would show this viewer, and the shell's actions. It
 * lists pages and actions only; it does not search competitions.
 */
export default function AdminCommandMenu({
  open,
  onOpenChange,
  groups,
  assistantEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly VisibleAdminNavGroup[];
  assistantEnabled: boolean;
}) {
  const t = useT(shellMessages);
  const router = useRouter();
  const pathname = usePathname();
  const { dark, themeLabel, toggleTheme, languageLabel, switchLanguage } = useShellActions();
  const onAssistantPage = pathname?.startsWith('/admin/assistant') ?? false;

  const items = useMemo<CommandMenuItemData[]>(() => {
    const pages: CommandMenuItemData[] = [];
    for (const group of groups) {
      const groupLabel = t(`admin.groups.${group.id}`);
      for (const { item, subs } of adminNavSections(group.items)) {
        // A section with views is listed by its views (Leagues, Tournaments …), not by the section itself.
        for (const entry of subs.length > 0 ? subs : [item]) {
          const label = entry.labelKey === undefined ? entry.label : t(`admin.items.${entry.labelKey}`);
          const icon = entry.icon ?? item.icon ?? group.icon;
          pages.push({
            value: `page:${entry.href}`,
            label,
            action: t('admin.command.open', { page: label }),
            group: t('admin.command.pages'),
            icon: icon ? NAV_ICONS[icon] : undefined,
            keywords: [groupLabel, ...(entry === item ? [] : [item.labelKey === undefined ? item.label : t(`admin.items.${item.labelKey}`)])],
            onSelect: () => router.push(entry.href),
          });
        }
      }
    }
    const actions: CommandMenuItemData[] = [
      {
        value: 'action:new-competition',
        label: t('admin.command.newCompetition'),
        icon: NAV_ICONS['premier-ball'],
        onSelect: () => router.push(ADMIN_NEW_COMPETITION_HREF),
      },
      ...(assistantEnabled && !onAssistantPage
        ? [{ value: 'action:assistant', label: t('admin.command.openAssistant'), icon: MessageSquare, shortcut: '.', onSelect: openAdminAssistant }]
        : []),
      { value: 'action:theme', label: themeLabel, icon: dark ? Sun : Moon, onSelect: toggleTheme },
      { value: 'action:language', label: languageLabel, icon: Languages, onSelect: switchLanguage },
      { value: 'action:back-to-site', label: t('admin.command.backToSite'), icon: ArrowLeft, onSelect: () => router.push(ADMIN_BACK_TO_SITE_HREF) },
    ].map((action) => ({ ...action, group: t('admin.command.actions') }));
    return [...pages, ...actions];
    // The switch handlers close over the current theme and language, which the labels already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, t, router, assistantEnabled, onAssistantPage, dark, themeLabel, languageLabel]);

  return (
    <CommandMenuDialog open={open} onOpenChange={onOpenChange} title={t('admin.command.title')} description={t('admin.command.description')}>
      <CommandMenu items={items}>
        <CommandMenuInput placeholder={t('admin.command.placeholder')} aria-label={t('admin.command.trigger')} className="focus:outline-0 focus-visible:outline-0" />
        <CommandMenuList>
          <CommandMenuEmpty>{t('admin.command.empty')}</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter
          hints={[
            { label: t('admin.command.select'), keys: ['up', 'down'] },
            { label: t('admin.command.close'), keys: 'esc' },
          ]}
        />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
