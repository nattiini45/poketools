'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
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
 * current section. On a phone the strip scrolls sideways and brings the current tab into view.
 */
export default function WikiHeader() {
  const t = useT(wikiMessages);
  const pathname = usePathname() ?? '';
  const isHome = pathname === '/wiki';
  const active = SECTIONS.find((section) => section.match.some((prefix) => pathname.startsWith(prefix)))?.key;
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

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

      <nav aria-label={t('chrome.sections')} className="scrollbar-hide -mx-[18px] overflow-x-auto px-[18px] sm:-mx-1.5 sm:px-1.5">
        <ul className="flex w-max gap-2 py-1">
          {SECTIONS.map((section) => {
            const isActive = section.key === active;
            return (
              <li key={section.key}>
                <Link
                  ref={isActive ? activeRef : undefined}
                  href={section.href}
                  aria-current={isActive ? 'page' : undefined}
                  className="block rounded-poke-sm"
                >
                  <SkewPlate variant="tab" active={isActive} glideId="wiki-sections" className="min-h-11 px-4 text-body">
                    {t(`home.categories.${section.key}.label`)}
                  </SkewPlate>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
