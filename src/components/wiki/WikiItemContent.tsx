/* eslint-disable @next/next/no-img-element */
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { WikiDefinitionList, WikiHero, type WikiDefinition } from '@/components/wiki/WikiParts';
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

  const rows: WikiDefinition[] = [
    {
      key: 'description',
      term: (
        <>
          {t('entry.description')}
          {descFallback && <WikiDescFallbackTag className="ml-2" />}
        </>
      ),
      children: item.description || item.shortDesc || t('entry.noDescription'),
    },
  ];
  // Short description
  if (item.shortDesc && item.shortDesc !== item.description) {
    rows.push({ key: 'summary', term: t('entry.summary'), children: item.shortDesc });
  }

  return (
    <div className="flex flex-col gap-4">
      <WikiHero className="flex items-center gap-4">
        <span className="skew-plate h-16 w-[4.5rem] shrink-0">
          <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-surface" />
          <img
            src={getItemSpriteUrl(item.name)}
            alt={displayName}
            width={48}
            height={48}
            className="shrink-0 [image-rendering:pixelated]"
          />
        </span>
        <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">{displayName}</h1>
      </WikiHero>

      <WikiDefinitionList rows={rows} />

      {/* Generation info */}
      <p className="text-caption text-fg-muted">{t('entry.introducedIn', { gen: item.generation })}</p>
    </div>
  );
}
