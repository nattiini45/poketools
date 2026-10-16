import PokemonSprite from '@/components/shared/PokemonSprite';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { leagueProse } from '@/i18n/content/prose';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { worldEvoligaMessages } from '@/i18n/messages/world/evoliga';
import { specialRulesTextFor } from '@/lib/draft/special-rules-text';
import { localizeLineLabel, localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvoligaLocaleProps } from './types';

interface LineFocusPanelProps extends EvoligaLocaleProps {
  entry: PointBuyListEntry;
}

export function linePanelTitle(entry: PointBuyListEntry, locale: Locale, dataLocale: Locale = locale): string {
  return createTranslator(worldEvoligaMessages, locale)('line.title', {
    name: localizeLineLabel(entry.base_pokemon, null, dataLocale),
  });
}

/**
 * Body of the `?mon=<line id>` Focus panel (ADR-0003) behind the Rotom PC
 * roster tiles, in SV-summary grammar:
 * the Pokémon in a round frame on the left, the line's rows on the right with
 * every value right-aligned. The docked `ContextOverlay` supplies the ZA teal
 * glass; the arena tokens are remapped inside it, so this body only has to
 * keep the rhythm. Server component; owned by the `#roster` station card.
 *
 * The special rule comes from `specialRulesTextFor` (authored English, else
 * the workbook German with `lang="de"`); the workbook rationale stays German
 * in both languages (`leagueProse`, i18n-core §5.4).
 */
export default function LineFocusPanel({ entry, locale, dataLocale = locale }: LineFocusPanelProps) {
  const t = createTranslator(worldEvoligaMessages, locale);
  const tc = createTranslator(worldClientMessages, locale);
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const evolution = [entry.base_pokemon, entry.stage2_pokemon, entry.stage3_pokemon]
    .filter((stage): stage is string => Boolean(stage))
    .map(species)
    .join(' → ');
  const special = specialRulesTextFor(entry, locale);
  const rationale = leagueProse(entry.rationale);

  const rows: { key: string; label: string; value: string; lead?: boolean }[] = [
    { key: 'price', label: t('line.price'), value: t('line.priceValue', { price: entry.price }), lead: true },
    { key: 'group', label: t('line.priceGroup'), value: tc(`rosterTable.priceGroup.${entry.price_group}`) },
    { key: 'kills2', label: t('line.killsToStage2'), value: String(entry.kills_to_stage2) },
    {
      key: 'kills3',
      label: t('line.additionalKills'),
      value: entry.additional_kills_to_stage3 === null
        ? '—'
        : String(entry.additional_kills_to_stage3),
    },
    {
      key: 'ratings',
      label: t('line.ratings'),
      value: `${entry.early_rating ?? '—'} / ${entry.mid_rating ?? '—'} / ${entry.late_rating ?? '—'}`,
    },
  ];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-4">
        {/* Round frame — the subject stays beside the data (SV summary). */}
        <div className="relative flex h-24 w-24 flex-none items-center justify-center rounded-full border border-arena-border bg-arena-elevated">
          <span
            aria-hidden="true"
            className="absolute inset-[6px] rounded-full border border-arena-border/60 bg-arena-surface"
          />
          <PokemonSprite name={entry.base_pokemon} size={72} />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline justify-between gap-2 rounded-lg bg-arena-elevated px-3 py-1.5">
            <span className="truncate font-heading font-bold tracking-tight text-arena-ink">
              {species(entry.base_pokemon)}
            </span>
            <span className="flex-none text-xs font-semibold text-arena-accent">
              {t('line.number', { number: String(entry.line_number).padStart(2, '0') })}
            </span>
          </div>
          <p className="rounded-lg border border-arena-border px-3 py-1.5 text-xs leading-snug text-arena-ink-secondary">
            <span className="mr-1 font-semibold text-arena-ink">{t('line.line')}</span>
            {evolution}
          </p>
        </div>
      </div>

      <dl className="space-y-1">
        {rows.map((row) => (
          <div
            key={row.key}
            className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 ${
              row.lead ? 'bg-arena-accent/20 ring-1 ring-arena-border' : 'bg-arena-elevated'
            }`}
          >
            <dt className="text-arena-ink-secondary">{row.label}</dt>
            <dd
              className={`flex-none text-right tabular-nums ${
                row.lead ? 'font-bold text-arena-ink' : 'font-medium text-arena-ink'
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {special.text && (
        <p
          lang={special.lang}
          className="rounded-lg border border-arena-border bg-arena-elevated px-3 py-2 text-xs leading-snug text-arena-ink-secondary"
        >
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
