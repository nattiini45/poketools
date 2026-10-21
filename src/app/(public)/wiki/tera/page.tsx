import Link from 'next/link';
import TypeBadge from '@/components/shared/TypeBadge';
import { getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import { getWikiTeraTypes } from '@/lib/wiki/index-rows.server';

export default async function WikiTeraIndexPage() {
  const t = await getT(wikiMessages);
  // English `@pkmn` type names (URL keys); `TypeBadge` shows the localized label.
  const teraTypes = getWikiTeraTypes();
  return (
    <div className="space-y-6">
      <Link
        href="/wiki"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.wiki')}
      </Link>
      <h1 className="font-heading text-3xl font-bold text-poke-text-primary">
        {t('tera.title')}
      </h1>
      <p className="font-body text-poke-text-secondary max-w-2xl">
        {t('tera.intro')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {teraTypes.map((type) => (
          <Link
            key={type}
            href={`/wiki/tera/${encodeURIComponent(type)}`}
            className="bg-poke-surface rounded-poke-lg p-4 border border-poke-border
                       hover:border-poke-accent hover:shadow-md transition-all text-center"
          >
            <TypeBadge type={type} />
          </Link>
        ))}
      </div>
    </div>
  );
}
