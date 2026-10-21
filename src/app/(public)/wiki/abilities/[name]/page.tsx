import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth/helpers';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { getWikiAbilityDetail } from '@/lib/wiki/index-rows.server';
import { localizeWikiEntry } from '@/lib/wiki/localize-entry.server';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import WikiAbilityContent from '@/components/wiki/WikiAbilityContent';
import WikiNotesSection from '@/components/wiki/WikiNotesSection';

export default async function WikiAbilityPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  // Locale-neutral entry from the bounded module memo; translated below, after the lookup.
  const ability = getWikiAbilityDetail(decodedName);

  if (!ability) {
    notFound();
  }

  const [t, locale, dataLocale, session] = await Promise.all([
    getT(wikiMessages),
    getLocale(),
    getDataLocale(),
    getSession(),
  ]);
  const { entry, descFallback } = localizeWikiEntry('ability', ability, locale);
  const notes = session
    ? await getApprovedNotes('ability', ability.name).catch(() => [])
    : [];

  return (
    <div className="space-y-8">
      <Link
        href="/wiki/abilities"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.abilities')}
      </Link>

      <WikiAbilityContent ability={entry} locale={locale} dataLocale={dataLocale} descFallback={descFallback} />

      <hr className="border-poke-border" />

      <WikiNotesSection
        entityType="ability"
        entityName={ability.name}
        notes={notes}
        unauthenticated={!session}
      />
    </div>
  );
}
