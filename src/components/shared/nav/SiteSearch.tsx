'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuList,
  CommandMenuShortcut,
  defaultCommandMenuFilter,
  type CommandMenuItemData,
} from '@/components/ui/fluid/command-menu';
import ItemIcon from '@/components/ui/ItemIcon';
import { FOCUS_RING } from '@/components/ui/panel';
import { getWikiPath, RESULT_KIND } from '@/components/wiki/WikiSearchBar';
import { useDataLocale, useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { wikiMessages } from '@/i18n/messages/wiki';
import type { IconComponent } from '@/lib/fluid/icon-context';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { localizeName } from '@/lib/pkmn/i18n/names';
import type { WikiSearchResult } from '@/types/wiki';
import { ALL_NAV_LINKS, extensionLinkIcon } from './links';

function itemIcon(item: ItemIconId): IconComponent {
  const Icon = () => <ItemIcon item={item} />;
  Icon.displayName = `ItemIcon(${item})`;
  return Icon;
}

const PAGE_ICONS = new Map(ALL_NAV_LINKS.map((link) => [link.href, itemIcon(link.icon)]));
const EXTENSION_ICONS = { 'old-amber': itemIcon('old-amber'), 'town-map': itemIcon('town-map') } as const;
const WIKI_ICON = itemIcon('weakness-policy');
const PLAYERS_ICON = itemIcon('lucky-egg');
const REPLAYS_ICON = itemIcon('dubious-disc');

/** Rows the query produced are already matches; only the page list is filtered here. */
const filter = (item: CommandMenuItemData, query: string) =>
  item.value.startsWith('wiki:') || item.value.startsWith('find:') || defaultCommandMenuFilter(item, query);

/**
 * The search trigger of the bar and its dialog (⌘K / Ctrl+K). It reads no new endpoint: pages come from the
 * nav's own link list, Pokémon, moves, items, abilities and tera types from the wiki search
 * (`/api/wiki/search`, the dex in memory, no database), and a typed name hands over to the players directory
 * and the replay library, which search on their own pages.
 */
export default function SiteSearch({
  signedIn,
  extraLinks,
}: {
  signedIn: boolean;
  extraLinks: readonly { href: string; label: string }[];
}) {
  const t = useT(navMessages);
  const tWiki = useT(wikiMessages);
  const dataLocale = useDataLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const term = query.trim();
  const [answer, setAnswer] = useState<WikiSearchResult[]>([]);

  useEffect(() => {
    if (!open || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const json = (await res.json()) as { success: boolean; data?: WikiSearchResult[] };
        if (json.success && json.data) setAnswer(json.data);
      } catch {
        // Aborted by the next keystroke, or offline: the page rows and the hand-overs still answer.
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term]);

  const items = useMemo<CommandMenuItemData[]>(() => {
    const pages = [
      ...ALL_NAV_LINKS.filter((link) => signedIn || (link.href !== '/dashboard' && link.href !== '/teambuilder')).map((link) => ({
        href: link.href,
        label: t(`links.${link.labelKey}`),
        icon: PAGE_ICONS.get(link.href),
      })),
      ...extraLinks.map((link) => ({ href: link.href, label: link.label, icon: EXTENSION_ICONS[extensionLinkIcon(link.href) === 'old-amber' ? 'old-amber' : 'town-map'] })),
    ].map((page) => ({
      value: `page:${page.href}`,
      label: page.label,
      icon: page.icon,
      group: t('search.pages'),
      onSelect: () => router.push(page.href),
    }));
    if (term.length < 2) return pages;
    const wiki = answer.map((result) => ({
      value: `wiki:${result.type}:${result.name}`,
      label: localizeName(RESULT_KIND[result.type], result.name, dataLocale),
      description: tWiki(`search.kind.${result.type}`),
      icon: WIKI_ICON,
      group: t('search.wiki'),
      onSelect: () => router.push(getWikiPath(result)),
    }));
    const encoded = encodeURIComponent(term);
    const elsewhere = [
      { value: 'find:players', label: t('search.inPlayers', { query: term }), icon: PLAYERS_ICON, href: `/players?q=${encoded}` },
      { value: 'find:replays', label: t('search.inReplays', { query: term }), icon: REPLAYS_ICON, href: `/replays?q=${encoded}` },
    ].map(({ href, ...row }) => ({ ...row, group: t('search.elsewhere', { query: term }), onSelect: () => router.push(href) }));
    return [...pages, ...wiki, ...elsewhere];
  }, [answer, dataLocale, extraLinks, router, signedIn, t, tWiki, term]);

  return (
    <>
      <button
        type="button"
        aria-label={t('search.trigger')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`flex h-9 w-9 min-w-9 shrink cursor-pointer items-center justify-center gap-2 rounded-poke-md text-fg-muted transition-colors duration-[80ms] hover:bg-hover hover:text-fg min-[1400px]:w-60 min-[1400px]:min-w-36 min-[1400px]:justify-start min-[1400px]:border min-[1400px]:border-hairline min-[1400px]:bg-elevated min-[1400px]:px-2.5 ${FOCUS_RING}`}
      >
        <Search aria-hidden="true" className="size-[18px] shrink-0" />
        <span aria-hidden="true" className="hidden min-w-0 flex-1 truncate text-left text-body min-[1400px]:block">
          {t('search.placeholder')}
        </span>
        <CommandMenuShortcut keys="mod+k" className="ml-0 hidden min-[1400px]:flex" />
      </button>
      <CommandMenuDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
        title={t('search.title')}
        description={t('search.description')}
      >
        <CommandMenu items={items} filter={filter} query={query} onQueryChange={setQuery}>
          <CommandMenuInput placeholder={t('search.placeholder')} />
          <CommandMenuList>
            <CommandMenuEmpty>{t('search.empty')}</CommandMenuEmpty>
          </CommandMenuList>
          <CommandMenuFooter
            hints={[
              { label: t('search.navigate'), keys: ['up', 'down'] },
              { label: t('search.open'), keys: 'enter' },
              { label: t('search.close'), keys: 'esc' },
            ]}
          />
        </CommandMenu>
      </CommandMenuDialog>
    </>
  );
}
