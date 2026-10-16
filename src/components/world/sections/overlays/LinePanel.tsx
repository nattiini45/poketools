import PokemonSprite from '@/components/shared/PokemonSprite';
import { PANEL_INSET } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { leagueProse } from '@/i18n/content/prose';
import { worldMessages } from '@/i18n/messages/world';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { specialRulesTextFor } from '@/lib/draft/special-rules-text';
import { localizeLineLabel, localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { WorldLocaleProps } from '../types';

interface LinePanelProps extends WorldLocaleProps {
  entry: PointBuyListEntry;
}

export function linePanelTitle(entry: PointBuyListEntry, locale: Locale = 'en', dataLocale: Locale = locale): string {
  return createTranslator(worldMessages, locale)('line.title', { name: localizeLineLabel(entry.base_pokemon, null, dataLocale) });
}

/**
 * Body of the `?mon=<line id>` overlay for the isle route themes: one
 * point-buy line — base species, evolution path, price and price group, KO
 * thresholds and the early/mid/late ratings, then the line's special rule
 * (`specialRulesTextFor`: authored English, else the workbook German) and the
 * workbook rationale, which stays German in both languages (`leagueProse`,
 * i18n-core §5.4) and carries `lang` so it is read as German.
 *
 * Server component; pure props-in, no data fetching.
 */
export default function LinePanel({ entry, locale = 'en', dataLocale = locale }: LinePanelProps) {
  const t = createTranslator(worldMessages, locale);
  const tc = createTranslator(worldClientMessages, locale);
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const path = [entry.base_pokemon, entry.stage2_pokemon, entry.stage3_pokemon]
    .filter((stage): stage is string => Boolean(stage))
    .map(species)
    .join(' → ');
  const finalForm = entry.stage3_pokemon ?? entry.stage2_pokemon;
  const special = specialRulesTextFor(entry, locale);
  const rationale = leagueProse(entry.rationale);

  const rows: [string, string][] = [
    [t('line.price'), t('line.priceValue', { price: entry.price })],
    [t('line.priceGroup'), tc(`rosterTable.priceGroup.${entry.price_group}`)],
    [t('line.killsToStage2'), String(entry.kills_to_stage2)],
    [
      t('line.additionalKills'),
      entry.additional_kills_to_stage3 === null ? '—' : String(entry.additional_kills_to_stage3),
    ],
    [
      t('line.rating'),
      `${entry.early_rating ?? '—'} / ${entry.mid_rating ?? '—'} / ${entry.late_rating ?? '—'}`,
    ],
  ];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-4">
        <PokemonSprite name={entry.base_pokemon} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-heading font-bold tracking-tight text-arena-ink">
              {species(entry.base_pokemon)}
            </span>
            <span className="flex-none text-xs font-semibold text-arena-accent-strong">
              {t('line.number', { number: String(entry.line_number).padStart(2, '0') })}
            </span>
          </div>
          <p className={`mt-1.5 px-3 py-1.5 text-xs leading-snug text-arena-ink-secondary ${PANEL_INSET}`}>
            <span className="mr-1 font-semibold text-arena-ink">{t('line.line')}</span>
            {path}
          </p>
          <p className="mt-1 text-xs text-arena-ink-secondary">
            {t('line.finalEvolution')}{' '}
            <span className="font-semibold text-arena-ink">{species(finalForm)}</span>
          </p>
        </div>
      </div>

      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${PANEL_INSET}`}
          >
            <dt className="text-arena-ink-secondary">{label}</dt>
            <dd className="flex-none text-right font-medium tabular-nums text-arena-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {special.text && (
        <p lang={special.lang} className={`px-3 py-2 text-xs leading-snug text-arena-ink-secondary ${PANEL_INSET}`}>
          {special.text}
        </p>
      )}
      {rationale.text && (
        <p lang={rationale.lang} className="px-1 text-xs leading-snug text-arena-ink-secondary">
          {rationale.text}
        </p>
      )}
    </div>
  );
}
