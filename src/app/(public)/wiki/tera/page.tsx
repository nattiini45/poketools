import type { Metadata } from 'next';
import Link from 'next/link';
import TypeBadge from '@/components/shared/TypeBadge';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { getWikiTeraTypes } from '@/lib/wiki/index-rows.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(wikiMessages);
  return { title: t('tera.title') };
}

export default async function WikiTeraIndexPage() {
  const t = await getT(wikiMessages);
  // English `@pkmn` type names (URL keys); `TypeBadge` shows the localized label.
  const teraTypes = getWikiTeraTypes();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('tera.title')}</h1>
      <p className="max-w-2xl text-body text-fg-muted">{t('tera.intro')}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {teraTypes.map((type) => (
          <li key={type}>
            <Link
              href={`/wiki/tera/${encodeURIComponent(type)}`}
              className="flex min-h-16 items-center justify-center rounded-poke-lg border border-hairline bg-surface p-4 transition-[background-color,border-color] duration-80 ease-out hover:border-hairline-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TypeBadge type={type} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
