import type { Metadata } from 'next';
import { teraMetadata } from '@/lib/seo/wiki-metadata';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth/helpers';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import {
  getWikiTeraTypes,
  getWikiTypeMatchups,
  resolveWikiTeraType,
} from '@/lib/wiki/index-rows.server';
import { getDataLocale, getT } from '@/i18n/server';
import { wikiMessages } from '@/i18n/messages/wiki';
import TypeBadge from '@/components/shared/TypeBadge';
import WikiNotesSection from '@/components/wiki/WikiNotesSection';
import { WikiBackLink, WikiHero, WikiSection } from '@/components/wiki/WikiParts';

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }): Promise<Metadata> {
  const { type } = await params;
  return teraMetadata(decodeURIComponent(type));
}

export default async function WikiTeraTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: rawType } = await params;
  // The URL segment is the English type name in any case ("fire", "Fire"); it resolves to the @pkmn name.
  const normalizedType = resolveWikiTeraType(decodeURIComponent(rawType));

  if (!normalizedType) {
    notFound();
  }

  // Locale-neutral matchups from the bounded module memo (English type names); labels are localized below.
  const matchups = getWikiTypeMatchups(normalizedType);
  const defensive = matchups?.defensive ?? null;
  const offensive = matchups?.offensive ?? null;

  const [t, dataLocale, session] = await Promise.all([getT(wikiMessages), getDataLocale(), getSession()]);
  const typeLabel = localizeType(normalizedType, dataLocale);
  const notes = session
    ? await getApprovedNotes('tera', normalizedType).catch(() => [])
    : [];

  const matchupRow = (key: string, label: string, tone: string, types: readonly string[]) =>
    types.length > 0 && (
      <div
        key={key}
        className="grid gap-2 border-b border-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-center sm:gap-4"
      >
        <dt className={`text-caption font-[550] ${tone}`}>{label}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {types.map((type) => (
            <TypeBadge key={type} type={type} locale={dataLocale} />
          ))}
        </dd>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <WikiBackLink href="/wiki/tera" label={t('back.tera')} />

      {/* Header */}
      <WikiHero className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-heading text-display text-fg">{t('tera.heading', { type: typeLabel })}</h1>
          <TypeBadge type={normalizedType} locale={dataLocale} />
        </div>
        <p className="max-w-[72ch] text-body text-fg-muted">{t('tera.explainer', { type: typeLabel })}</p>
      </WikiHero>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Defensive matchups */}
        {defensive && (
          <WikiSection title={t('tera.defensive', { type: typeLabel })}>
            <dl className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
              {matchupRow('weak', t('tera.weakTo'), 'text-loss', defensive.weakTo)}
              {matchupRow('resists', t('tera.resists'), 'text-win', defensive.resists)}
              {matchupRow('immune', t('tera.immuneTo'), 'text-fg-muted', defensive.immuneTo)}
            </dl>
          </WikiSection>
        )}

        {/* Offensive matchups */}
        {offensive && (
          <WikiSection title={t('tera.offensive', { type: typeLabel })}>
            <dl className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
              {matchupRow('super', t('tera.superEffective'), 'text-win', offensive.superEffective)}
              {matchupRow('weak', t('tera.notVeryEffective'), 'text-loss', offensive.notVeryEffective)}
              {matchupRow('none', t('tera.noEffect'), 'text-fg-muted', offensive.noEffect)}
            </dl>
          </WikiSection>
        )}
      </div>

      {/* Other Tera Types */}
      <WikiSection title={t('tera.all')}>
        <ul className="flex flex-wrap gap-2">
          {getWikiTeraTypes().map((type) => (
            <li key={type}>
              {type === normalizedType ? (
                <span aria-current="page" className="inline-flex rounded-full outline-2 outline-offset-2 outline-accent-ink">
                  <TypeBadge type={type} locale={dataLocale} />
                </span>
              ) : (
                <Link
                  href={`/wiki/tera/${encodeURIComponent(type)}`}
                  className="inline-flex rounded-full transition-opacity duration-80 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TypeBadge type={type} locale={dataLocale} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </WikiSection>

      <WikiNotesSection
        entityType="tera"
        entityName={normalizedType}
        notes={notes}
        unauthenticated={!session}
      />
    </div>
  );
}
