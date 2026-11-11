'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Languages, MessageSquare, Moon, Sun } from 'lucide-react';
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  defaultCommandMenuFilter,
  type CommandMenuItemData,
} from '@/components/ui/fluid/command-menu';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { shellMessages } from '@/i18n/messages/shell';
import { commandIndexHref, type CommandIndexEntry } from '@/lib/admin/command-index';
import type { ApiResult } from '@/types/api';
import { ADMIN_NEW_COMPETITION_HREF, adminNavSections, type VisibleAdminNavGroup } from './adminNav';
import { openAdminAssistant } from './assistant/AssistantDrawer';
import { NAV_ICONS } from './nav-icons';
import { useShellActions } from './useShellActions';

/** Where "Back to site" leads: the signed-in home. */
export const ADMIN_BACK_TO_SITE_HREF = '/dashboard';

const JUMP_ERROR_VALUE = 'jump:error';

/** The competitions index: not asked for before the first open, and asked again only after a failed load. */
type CompetitionIndex =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; entries: readonly CommandIndexEntry[] }
  | { status: 'failed'; error: ApiErrorLike | null };

/**
 * The admin command menu (⌘K / Ctrl+K): every page the sidebar would show this viewer, the shell's actions and a
 * Jump to group with the viewer's competitions. The competitions come from `GET /api/admin/command-index` on the
 * first open of the menu (never on page load, never polled); until they arrive, and if they never do, the pages and
 * actions work as usual.
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
  const errorText = useApiErrorText(errorsAdmin);

  const [index, setIndex] = useState<CompetitionIndex>({ status: 'idle' });
  const statusRef = useRef<CompetitionIndex['status']>('idle');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const loadIndex = useCallback(async () => {
    statusRef.current = 'loading';
    setIndex({ status: 'loading' });
    let next: CompetitionIndex;
    try {
      const res = await fetch('/api/admin/command-index');
      const json = (await res.json()) as ApiResult<CommandIndexEntry[]>;
      next = json.success ? { status: 'ready', entries: json.data } : { status: 'failed', error: json };
    } catch (err) {
      next = { status: 'failed', error: toApiErrorLike(err) };
    }
    statusRef.current = next.status;
    if (mountedRef.current) setIndex(next);
  }, []);
  // Keyed on `open` alone: a failed load is retried by the next open, not at once while the menu stays open.
  useEffect(() => {
    if (open && (statusRef.current === 'idle' || statusRef.current === 'failed')) void loadIndex();
  }, [open, loadIndex]);

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
    const jumpGroup = t('admin.command.jumpTo');
    const jump: CommandMenuItemData[] = [];
    if (index.status === 'ready') {
      for (const entry of index.entries) {
        const kind = t(`admin.command.kind${entry.kind === 'league' ? 'League' : 'Tournament'}${entry.archived ? 'Archived' : ''}`);
        jump.push({
          value: `jump:${entry.kind}:${entry.id}`,
          label: entry.name,
          action: t('admin.command.open', { page: entry.name }),
          description: kind,
          icon: NAV_ICONS['poke-ball'],
          group: jumpGroup,
          onSelect: () => router.push(commandIndexHref(entry)),
        });
      }
    }
    if (index.status === 'failed') {
      // A code the server sent is worded by its catalog; a bare failure gets the shell's own line.
      jump.push({
        value: JUMP_ERROR_VALUE,
        label: index.error?.code ? errorText(index.error) : t('admin.command.jumpFailed'),
        group: jumpGroup,
        disabled: true,
      });
    }
    return [...pages, ...actions, ...jump];
    // The switch handlers close over the current theme and language, which the labels already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, t, router, assistantEnabled, onAssistantPage, dark, themeLabel, languageLabel, index, errorText]);
  // The failure line explains why a competition is missing, so it stays listed while the admin types.
  const filter = useCallback(
    (item: CommandMenuItemData, query: string) => item.value === JUMP_ERROR_VALUE || defaultCommandMenuFilter(item, query),
    [],
  );

  return (
    <CommandMenuDialog open={open} onOpenChange={onOpenChange} title={t('admin.command.title')} description={t('admin.command.description')}>
      <CommandMenu items={items} filter={filter}>
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
