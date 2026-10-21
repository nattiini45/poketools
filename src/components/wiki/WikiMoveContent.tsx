/* eslint-disable @next/next/no-img-element */
import TypeBadge from '@/components/shared/TypeBadge';
import WikiDescFallbackTag from '@/components/wiki/WikiDescFallbackTag';
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
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-bold text-poke-text-primary">
          {localizeMove(move.name, dataLocale)}
        </h1>
        <TypeBadge type={move.type} locale={dataLocale} />
        <img
          src={getCategorySpriteUrl(move.category)}
          alt={localizeMoveCategory(move.category, dataLocale)}
          width={32}
          height={14}
          className="inline-block shrink-0"
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatBlock label={t('entry.basePower')} value={move.basePower > 0 ? String(move.basePower) : '--'} />
        <StatBlock
          label={t('entry.accuracy')}
          value={move.accuracy !== null ? formatter.percentOf(move.accuracy, 0) : '--'}
        />
        <StatBlock label={t('entry.pp')} value={String(move.pp)} />
        <StatBlock label={t('entry.priority')} value={move.priority !== 0 ? String(move.priority) : '0'} />
      </div>

      {/* Description */}
      <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
        <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
          {t('entry.description')}
          {descFallback && <WikiDescFallbackTag className="ml-2" />}
        </h2>
        <p className="font-body text-poke-text-primary leading-relaxed">
          {move.description || move.shortDesc || t('entry.noDescription')}
        </p>
      </div>

      {/* Short description (if different from description) */}
      {move.shortDesc && move.shortDesc !== move.description && (
        <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
            {t('entry.summary')}
          </h2>
          <p className="font-body text-poke-text-primary">
            {move.shortDesc}
          </p>
        </div>
      )}

      {/* Flags (Showdown flag ids, shown as-is) */}
      {move.flags.length > 0 && (
        <div className="bg-poke-surface rounded-poke-lg p-4 shadow-poke-sm border border-poke-border">
          <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-2">
            {t('entry.flags')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {move.flags.map((flag) => (
              <span
                key={flag}
                lang="en"
                className="inline-block px-2 py-0.5 rounded-poke-md bg-poke-muted text-poke-text-secondary text-xs font-body"
              >
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Generation info */}
      <p className="text-xs text-poke-text-secondary font-body">
        {t('entry.introducedIn', { gen: move.generation })}
      </p>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-poke-surface rounded-poke-md p-3 shadow-poke-sm border border-poke-border text-center">
      <div className="font-heading text-xs font-semibold text-poke-text-secondary uppercase tracking-wide">
        {label}
      </div>
      <div className="font-heading text-lg font-bold text-poke-text-primary mt-1">
        {value}
      </div>
    </div>
  );
}
