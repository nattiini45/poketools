import type { Metadata } from 'next';
import Link from 'next/link';
import { Backpack, ChevronRight, Gem, PawPrint, Sparkles, Swords, type LucideIcon } from 'lucide-react';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';

/** The wiki sections; labels and descriptions come from `wiki.home.categories.<key>`. */
const CATEGORIES: readonly { key: 'pokemon' | 'moves' | 'items' | 'abilities' | 'tera'; href: string; Icon: LucideIcon }[] = [
  { key: 'pokemon', href: '/wiki/pokemon', Icon: PawPrint },
  { key: 'moves', href: '/wiki/moves', Icon: Swords },
  { key: 'items', href: '/wiki/items', Icon: Backpack },
  { key: 'abilities', href: '/wiki/abilities', Icon: Sparkles },
  { key: 'tera', href: '/wiki/tera', Icon: Gem },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('home.title') };
}

export default async function WikiBrowserPage() {
  const t = await getT(wikiMessages);
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-body text-fg-muted">{t('home.intro')}</p>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CATEGORIES.map(({ key, href, Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="group flex h-full items-start gap-4 rounded-poke-lg border border-hairline bg-surface p-4 transition-[background-color,border-color] duration-80 ease-out hover:border-hairline-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring lg:flex-col lg:p-5"
            >
              <span className="skew-plate h-12 w-14 shrink-0 text-accent-ink">
                <span aria-hidden="true" className="skew-plate-bg bg-sunken" />
                <span aria-hidden="true" className="skew-plate-underside" />
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <h2 className="font-heading text-title text-fg">{t(`home.categories.${key}.label`)}</h2>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted group-hover:text-accent-ink" aria-hidden="true" />
                </span>
                <span className="text-body text-fg-muted">{t(`home.categories.${key}.description`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
