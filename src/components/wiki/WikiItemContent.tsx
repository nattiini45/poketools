/* eslint-disable @next/next/no-img-element */
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { getItemSpriteUrl } from '@/lib/pkmn/sprites';
import type { WikiItemEntry } from '@/types/wiki';

interface WikiItemContentProps {
  /** `description` / `shortDesc` already localized by the server page (`localizeDesc`). */
  item: WikiItemEntry;
  /** UI locale (labels). */
  locale: Locale;
  /** Pokémon-data locale (the item name). */
  dataLocale: Locale;
  /** True when the page is German and the description fell back to the English Showdown text. */
  descFallback?: boolean;
}

/** Universal component (rendered from a server page): translates with `createTranslator`, no hooks. */
export default function WikiItemContent({ item, locale, dataLocale, descFallback = false }: WikiItemContentProps) {
  const t = createTranslator(wikiMessages, locale);
  const displayName = localizeItem(item.name, dataLocale);
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <img
          src={getItemSpriteUrl(item.name)}
          alt={displayName}
          width={48}
          height={48}
          className="shrink-0"
        />
        <h1 className="font-heading text-2xl font-bold text-poke-text-primary">
          {displayName}
        </h1>
      </div>

      {/* Description */}
      <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
        <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
          {t('entry.description')}
          {descFallback && <WikiDescFallbackTag className="ml-2" />}
        </h2>
        <p className="font-body text-poke-text-primary leading-relaxed">
          {item.description || item.shortDesc || t('entry.noDescription')}
        </p>
      </div>

      {/* Short description */}
      {item.shortDesc && item.shortDesc !== item.description && (
        <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
            {t('entry.summary')}
          </h2>
          <p className="font-body text-poke-text-primary">
            {item.shortDesc}
          </p>
        </div>
      )}

      {/* Generation info */}
      <p className="text-xs text-poke-text-secondary font-body">
        {t('entry.introducedIn', { gen: item.generation })}
      </p>
    </div>
  );
}
