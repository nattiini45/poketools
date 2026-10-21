import Link from 'next/link';
import SectionShell from '@/components/world/SectionShell';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { PANEL, FOCUS_RING } from '@/components/world/panel';
import { createTranslator } from '@/i18n/core';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { worldMessages } from '@/i18n/messages/world';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { displayPriceGroup } from '@/lib/evolution/point-buy-display';
import { PRICE_GROUPS, type PriceGroup } from '@/types/point-buy';
import type { ThemeRouteData, ThemeSectionCopy, WorldLocaleProps } from './types';

/**
 * #roster — every roster tile, in the viewer's language. Point-buy seasons list their lines
 * with sprite, price and price group, each linking to its `?mon=` focus
 * target; seasons without a list render the participant-derived tiles (ace and
 * gym band) instead.
 *
 * A tile's `price !== null` is what marks it point-buy-derived — the same
 * discriminator `deriveRosterTiles` uses — so a participant tile whose `name`
 * is a trainer rather than a species never gets a sprite or a line link, and
 * null roster lines can never render as an empty EPB table.
 *
 * The heading follows the same discriminator: 'Point-Buy list' only when the
 * section shows a list, the plain roster heading for the trainer fallback.
 * A line's band is shown as its displayed group, so groups that share a label
 * read the same.
 */
/** A stored price group shown as its displayed group; any other band value passes through. */
function bandGroup(band: string): string {
  return isPriceGroup(band) ? displayPriceGroup(band) : band;
}

function isPriceGroup(value: string): value is PriceGroup {
  return (PRICE_GROUPS as readonly string[]).includes(value);
}

export default function RosterSection({
  data,
  copy,
  locale = 'en',
  dataLocale = locale,
}: {
  data: ThemeRouteData;
  copy: ThemeSectionCopy;
} & WorldLocaleProps) {
  const t = createTranslator(worldMessages, locale);
  const enums = createTranslator(enumMessages, locale);
  const { rosterTiles } = data;
  const isPointBuy = data.entries.length > 0;
  /** A point-buy tile's band is its price group; a fallback tile's the gym type (or 'open'). */
  const tileDetail = (tile: ThemeRouteData['rosterTiles'][number]): string =>
    tile.price !== null
      ? t('roster.tilePrice', { price: tile.price, band: enumLabel(enums, 'priceGroup', bandGroup(tile.band)) })
      : t('roster.tileGym', {
          band: tile.band === 'open' ? t('roster.openBand') : localizeType(tile.band, dataLocale),
        });

  return (
    <SectionShell id="roster" heading={isPointBuy ? t('roster.heading') : t('roster.headingTrainers')}>
      <div className={`max-w-4xl ${PANEL} p-6`}>
        <p className="text-sm text-arena-ink-secondary">
          {isPointBuy ? copy.rosterPointBuy(rosterTiles.length) : t('roster.noList')}
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {rosterTiles.map((tile) => {
            const isLine = tile.price !== null;
            const body = (
              <>
                {isLine && <PokemonSprite name={tile.name} size={32} />}
                <span className="min-w-0">
                  <span className="font-heading text-xs font-bold text-arena-accent-strong">
                    {String(tile.line).padStart(2, '0')}
                  </span>{' '}
                  <span className="font-heading text-sm font-bold text-arena-ink">
                    {isLine ? localizeSpecies(tile.name, dataLocale) : tile.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-arena-ink-secondary">{tileDetail(tile)}</span>
                </span>
              </>
            );
            return (
              <li
                key={tile.id}
                className="rounded-lg border border-arena-border bg-arena-elevated px-3 py-2"
              >
                {isLine ? (
                  <Link
                    href={`?mon=${tile.id}`}
                    data-roster-line={tile.id}
                    className={`-mx-1 -my-1 flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-arena-surface motion-reduce:transition-none ${FOCUS_RING}`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        {rosterTiles.length === 0 && (
          <p className="mt-4 text-sm text-arena-ink-secondary">{copy.rosterEmpty}</p>
        )}
      </div>
    </SectionShell>
  );
}
