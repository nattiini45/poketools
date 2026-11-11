'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ItemIcon from '@/components/ui/ItemIcon';
import LinkTabs from '@/components/ui/LinkTabs';
import WikiSearchBar from '@/components/wiki/WikiSearchBar';
import { useT } from '@/i18n/client';
import { wikiMessages } from '@/i18n/messages/wiki';

/** The wiki sections; labels come from `wiki.home.categories.<key>.label`. A Pokémon entry lives at `/pokemon/<name>`. */
const SECTIONS = [
  { key: 'pokemon', href: '/wiki/pokemon', match: ['/wiki/pokemon', '/pokemon/'] },
  { key: 'moves', href: '/wiki/moves', match: ['/wiki/moves'] },
  { key: 'items', href: '/wiki/items', match: ['/wiki/items'] },
  { key: 'abilities', href: '/wiki/abilities', match: ['/wiki/abilities'] },
  { key: 'tera', href: '/wiki/tera', match: ['/wiki/tera'] },
] as const;

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The wiki's header on every wiki page and on `/pokemon/<name>`: the title with the Weakness Policy icon, the
 * site-wide wiki search, and the section strip as a row of skewed tabs whose amber underside glides to the
 * current section (`LinkTabs`).
 */
export default function WikiHeader() {
  const t = useT(wikiMessages);
  const pathname = usePathname() ?? '';
  const isHome = pathname === '/wiki';
  const active = SECTIONS.find((section) => section.match.some((prefix) => pathname.startsWith(prefix)))?.key;

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <ItemIcon item="weakness-policy" size={48} />
          {isHome ? (
            <h1 className="font-heading text-display text-fg">{t('chrome.title')}</h1>
          ) : (
            <Link href="/wiki" className={`rounded-poke-sm font-heading text-display text-fg hover:text-accent-ink ${FOCUS_RING}`}>
              {t('chrome.title')}
            </Link>
          )}
        </div>
        <div className="w-full sm:w-auto sm:min-w-80 sm:max-w-md sm:flex-1">
          <WikiSearchBar />
        </div>
      </div>

      <LinkTabs
        tabs={SECTIONS.map((section) => ({ key: section.key, href: section.href, label: t(`home.categories.${section.key}.label`) }))}
        activeKey={active ?? ''}
        label={t('chrome.sections')}
        glideId="wiki-sections"
      />
    </header>
  );
}
