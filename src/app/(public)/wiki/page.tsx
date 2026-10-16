import Link from 'next/link';
import WikiSearchBar from '@/components/wiki/WikiSearchBar';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';

/** The wiki sections; labels and descriptions come from `wiki.home.categories.<key>`. */
const CATEGORIES = [
  { key: 'pokemon', href: '/wiki/pokemon' },
  { key: 'moves', href: '/wiki/moves' },
  { key: 'items', href: '/wiki/items' },
  { key: 'abilities', href: '/wiki/abilities' },
  { key: 'tera', href: '/wiki/tera' },
] as const;

export default async function WikiBrowserPage() {
  const t = await getT(wikiMessages);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-bold text-poke-text-primary mb-2">
          {t('home.title')}
        </h1>
        <p className="font-body text-poke-text-secondary max-w-2xl">{t('home.intro')}</p>
      </div>

      <WikiSearchBar />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.key}
            href={cat.href}
            className="bg-poke-surface rounded-poke-lg p-5 shadow-poke-sm border border-poke-border
                       hover:border-poke-accent hover:shadow-md transition-all group"
          >
            <h2 className="font-heading text-lg font-bold text-poke-text-primary group-hover:text-poke-accent transition-colors">
              {t(`home.categories.${cat.key}.label`)}
            </h2>
            <p className="font-body text-sm text-poke-text-secondary mt-1">
              {t(`home.categories.${cat.key}.description`)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
