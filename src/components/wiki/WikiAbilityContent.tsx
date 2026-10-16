import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { DEFAULT_TIME_ZONE, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import type { WikiAbilityEntry } from '@/types/wiki';

interface WikiAbilityContentProps {
  /** `description` / `shortDesc` already localized by the server page (`localizeDesc`). */
  ability: WikiAbilityEntry;
  /** UI locale (labels, numbers). */
  locale: Locale;
  /** Pokémon-data locale (the ability name). */
  dataLocale: Locale;
  /** True when the page is German and the description fell back to the English Showdown text. */
  descFallback?: boolean;
}

/** Universal component (rendered from a server page): translates with `createTranslator`, no hooks. */
export default function WikiAbilityContent({
  ability,
  locale,
  dataLocale,
  descFallback = false,
}: WikiAbilityContentProps) {
  const t = createTranslator(wikiMessages, locale);
  const formatter = createFormatter({ locale, timeZone: DEFAULT_TIME_ZONE });
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="inline-block w-3 h-3 rounded-full bg-poke-blue shrink-0"
          aria-hidden="true"
        />
        <h1 className="font-heading text-2xl font-bold text-poke-text-primary">
          {localizeAbility(ability.name, dataLocale)}
        </h1>
      </div>

      {/* Description */}
      <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
        <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
          {t('entry.description')}
          {descFallback && <WikiDescFallbackTag className="ml-2" />}
        </h2>
        <p className="font-body text-poke-text-primary leading-relaxed">
          {ability.description || ability.shortDesc || t('entry.noDescription')}
        </p>
      </div>

      {/* Short description */}
      {ability.shortDesc && ability.shortDesc !== ability.description && (
        <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
            {t('entry.summary')}
          </h2>
          <p className="font-body text-poke-text-primary">
            {ability.shortDesc}
          </p>
        </div>
      )}

      {/* Rating */}
      {ability.rating > 0 && (
        <div className="bg-poke-surface rounded-poke-md p-3 shadow-poke-sm border border-poke-border inline-block">
          <span className="font-heading text-xs font-semibold text-poke-text-secondary uppercase tracking-wide">
            {t('entry.competitiveRating')}{' '}
          </span>
          <span className="font-heading text-sm font-bold text-poke-accent">
            {formatter.number(ability.rating)}/5
          </span>
        </div>
      )}

      {/* Generation info */}
      <p className="text-xs text-poke-text-secondary font-body">
        {t('entry.introducedIn', { gen: ability.generation })}
      </p>
    </div>
  );
}
