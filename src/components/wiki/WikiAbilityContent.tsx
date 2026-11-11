import SkewChip from '@/components/ui/SkewChip';
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { WikiDefinitionList, WikiHero, type WikiDefinition } from '@/components/wiki/WikiParts';
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

  const rows: WikiDefinition[] = [
    {
      key: 'description',
      term: (
        <>
          {t('entry.description')}
          {descFallback && <WikiDescFallbackTag className="ml-2" />}
        </>
      ),
      children: ability.description || ability.shortDesc || t('entry.noDescription'),
    },
  ];
  // Short description
  if (ability.shortDesc && ability.shortDesc !== ability.description) {
    rows.push({ key: 'summary', term: t('entry.summary'), children: ability.shortDesc });
  }

  return (
    <div className="flex flex-col gap-4">
      <WikiHero className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">
          {localizeAbility(ability.name, dataLocale)}
        </h1>

        {/* Rating */}
        {ability.rating > 0 && (
          <p className="inline-flex items-center gap-2 text-body text-fg-muted">
            <span>{t('entry.competitiveRating')}</span>
            <SkewChip tone="accent" className="px-3 py-1 font-heading text-title">
              {formatter.number(ability.rating)}/5
            </SkewChip>
          </p>
        )}
      </WikiHero>

      <WikiDefinitionList rows={rows} />

      {/* Generation info */}
      <p className="text-caption text-fg-muted">{t('entry.introducedIn', { gen: ability.generation })}</p>
    </div>
  );
}
