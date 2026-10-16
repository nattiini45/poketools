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

  return (
    <div className="space-y-8">
      <Link
        href="/wiki/tera"
        className="inline-block text-sm font-body text-poke-accent hover:underline"
      >
        {t('back.tera')}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <h1 className="font-heading text-3xl font-bold text-poke-text-primary">
          {t('tera.heading', { type: typeLabel })}
        </h1>
        <TypeBadge type={normalizedType} locale={dataLocale} />
      </div>

      <p className="font-body text-poke-text-secondary max-w-2xl">
        {t('tera.explainer', { type: typeLabel })}
      </p>

      {/* Defensive matchups */}
      {defensive && (
        <div className="bg-poke-surface rounded-poke-lg p-5 shadow-poke-sm border border-poke-border space-y-4">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide">
            {t('tera.defensive', { type: typeLabel })}
          </h2>

          {defensive.weakTo.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-red-400 uppercase mb-1.5">
                {t('tera.weakTo')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {defensive.weakTo.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}

          {defensive.resists.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-green-400 uppercase mb-1.5">
                {t('tera.resists')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {defensive.resists.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}

          {defensive.immuneTo.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-poke-text-secondary uppercase mb-1.5">
                {t('tera.immuneTo')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {defensive.immuneTo.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Offensive matchups */}
      {offensive && (
        <div className="bg-poke-surface rounded-poke-lg p-5 shadow-poke-sm border border-poke-border space-y-4">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide">
            {t('tera.offensive', { type: typeLabel })}
          </h2>

          {offensive.superEffective.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-green-400 uppercase mb-1.5">
                {t('tera.superEffective')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {offensive.superEffective.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}

          {offensive.notVeryEffective.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-orange-400 uppercase mb-1.5">
                {t('tera.notVeryEffective')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {offensive.notVeryEffective.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}

          {offensive.noEffect.length > 0 && (
            <div>
              <h3 className="font-heading text-xs font-semibold text-red-400 uppercase mb-1.5">
                {t('tera.noEffect')}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {offensive.noEffect.map((type) => (
                  <TypeBadge key={type} type={type} locale={dataLocale} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Other Tera Types */}
      <div className="bg-poke-surface rounded-poke-lg p-5 shadow-poke-sm border border-poke-border">
        <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
          {t('tera.all')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {getWikiTeraTypes().map((type) => (
            <Link
              key={type}
              href={`/wiki/tera/${encodeURIComponent(type)}`}
              className={type === normalizedType ? 'opacity-50 pointer-events-none' : ''}
            >
              <TypeBadge type={type} locale={dataLocale} />
            </Link>
          ))}
        </div>
      </div>

      <hr className="border-poke-border" />

      <WikiNotesSection
        entityType="tera"
        entityName={normalizedType}
        notes={notes}
        unauthenticated={!session}
      />
    </div>
  );
}
