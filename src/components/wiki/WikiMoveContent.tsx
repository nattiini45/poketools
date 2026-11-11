/* eslint-disable @next/next/no-img-element */
import TypeBadge from '@/components/shared/TypeBadge';
import SkewChip from '@/components/ui/SkewChip';
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
import { WikiDefinitionList, WikiHero, WikiStatStrip, type WikiDefinition } from '@/components/wiki/WikiParts';
import { DEFAULT_TIME_ZONE, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { wikiMessages } from '@/i18n/messages/wiki';
import { localizeMoveCategory } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { getCategorySpriteUrl } from '@/lib/pkmn/sprites';
import type { WikiMoveEntry } from '@/types/wiki';

interface WikiMoveContentProps {
  /** `description` / `shortDesc` already localized by the server page (`localizeDesc`). */
  move: WikiMoveEntry;
  /** UI locale (labels, numbers). */
  locale: Locale;
  /** Pokémon-data locale (move, type and category names). */
  dataLocale: Locale;
  /** True when the page is German and the description fell back to the English Showdown text. */
  descFallback?: boolean;
}

/** Universal component (rendered from a server page): translates with `createTranslator`, no hooks. */
export default function WikiMoveContent({ move, locale, dataLocale, descFallback = false }: WikiMoveContentProps) {
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
      children: move.description || move.shortDesc || t('entry.noDescription'),
    },
  ];
  // Short description (if different from description)
  if (move.shortDesc && move.shortDesc !== move.description) {
    rows.push({ key: 'summary', term: t('entry.summary'), children: move.shortDesc });
  }
  // Flags (Showdown flag ids, shown as-is)
  if (move.flags.length > 0) {
    rows.push({
      key: 'flags',
      term: t('entry.flags'),
      children: (
        <span className="flex flex-wrap gap-2">
          {move.flags.map((flag) => (
            <span key={flag} lang="en">
              <SkewChip>{flag}</SkewChip>
            </span>
          ))}
        </span>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <WikiHero className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">
            {localizeMove(move.name, dataLocale)}
          </h1>
          <TypeBadge type={move.type} locale={dataLocale} />
          <span className="inline-flex items-center gap-2">
            <img src={getCategorySpriteUrl(move.category)} alt="" width={32} height={14} className="inline-block shrink-0" />
            <SkewChip>{localizeMoveCategory(move.category, dataLocale)}</SkewChip>
          </span>
        </div>

        <WikiStatStrip
          className="grid-cols-2 sm:grid-cols-4"
          stats={[
            { label: t('entry.basePower'), value: move.basePower > 0 ? String(move.basePower) : '--' },
            { label: t('entry.accuracy'), value: move.accuracy !== null ? formatter.percentOf(move.accuracy, 0) : '--' },
            { label: t('entry.pp'), value: String(move.pp) },
            { label: t('entry.priority'), value: move.priority !== 0 ? String(move.priority) : '0' },
          ]}
        />
      </WikiHero>

      <WikiDefinitionList rows={rows} />

      {/* Generation info */}
      <p className="text-caption text-fg-muted">{t('entry.introducedIn', { gen: move.generation })}</p>
    </div>
  );
}
