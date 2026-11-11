import SheetIcon from '@/components/shared/SheetIcon';
import SpriteImg from '@/components/shared/SpriteImg';
import TypeBadgeView from '@/components/shared/TypeBadgeView';
import type { Translator } from '@/i18n/core';
import type { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeNature, localizeType } from '@/lib/pkmn/i18n/names/misc';
import { itemIconCell } from '@/lib/pkmn/sheet-cells.server';
import { formatStatSpread, hasCustomIv, hasEv } from '@/lib/team/stat-spread';
import type { PokemonSet } from '@/types/team';

/**
 * One member panel of the team sheet (the shared-team and library-entry pages). A server component: the names are
 * localized here and the held item's icon cell is resolved here, so neither page ships a name table or `@pkmn/img`
 * to the browser; only the sprite is a client leaf (its fallback walk).
 */
export default function TeamSetCard({
  set,
  index,
  t,
  dl,
  showIvs = false,
}: {
  set: PokemonSet;
  index: number;
  /** The page's translator and data locale: the card is a pure function of its props. */
  t: Translator<typeof teamsLibraryMessages.en>;
  dl: DataLocale;
  /** The shared page lists a custom IV spread; the library card never did. */
  showIvs?: boolean;
}) {
  if (!set.species || set.species === 'hidden') {
    return (
      <li className="flex min-h-24 items-center justify-center rounded-poke-lg border border-dashed border-hairline-strong">
        <p className="text-caption text-fg-muted">{t('set.slot', { n: index + 1 })}</p>
      </li>
    );
  }

  const speciesName = localizeSpecies(set.species, dl);
  const moves = (set.moves ?? []).filter(Boolean);
  const itemCell = set.item ? itemIconCell(set.item) : null;
  const hasEvs = set.evs && Object.values(set.evs).some((v) => v > 0);
  return (
    <li className="flex flex-col overflow-hidden rounded-poke-lg border border-hairline bg-surface">
      <div className="flex items-center gap-3 border-b border-hairline bg-elevated px-4 py-3">
        <SpriteImg name={set.species} alt={speciesName} width={56} height={56} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-title text-fg">{set.name || speciesName}</h2>
          {set.item && (
            <p className="mt-0.5 flex items-center gap-1 text-caption text-fg-muted">
              {itemCell !== null && <SheetIcon sheet="item" cell={itemCell} />}
              <span className="min-w-0 truncate">{t('set.item', { item: localizeItem(set.item, dl) })}</span>
            </p>
          )}
        </div>
        <span aria-hidden="true" className="self-start font-heading text-title tabular-nums text-fg-muted">
          {index + 1}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        {(set.ability || set.tera_type) && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {set.ability && (
              <p className="text-caption text-fg-muted">
                {t.rich('set.ability', {
                  ability: localizeAbility(set.ability, dl),
                  value: (chunks) => <span className="font-[550] text-fg">{chunks}</span>,
                })}
              </p>
            )}
            {set.tera_type && (
              <p className="flex items-center gap-1.5 text-caption text-fg-muted">
                {t('set.tera')}
                <TypeBadgeView type={set.tera_type} label={localizeType(set.tera_type, dl)} />
              </p>
            )}
          </div>
        )}

        {moves.length > 0 && (
          <ul aria-label={t('set.moves')} className="grid grid-cols-2 gap-1.5">
            {moves.map((move, i) => (
              <li key={i} className="truncate rounded-poke-sm bg-sunken px-2 py-1.5 text-caption text-fg">
                {localizeMove(move, dl)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(hasEvs || set.nature) && (
        <div className="flex flex-col gap-0.5 border-t border-hairline px-4 py-2.5 text-micro text-fg-muted">
          {hasEvs && <p className="font-mono tabular-nums">{formatStatSpread(set.evs, hasEv, dl)}</p>}
          {set.nature && (
            <p>
              {t('set.nature', { nature: localizeNature(set.nature, dl) })}
              {showIvs && set.ivs && Object.values(set.ivs).some(hasCustomIv) && (
                <> · {t('set.ivs', { spread: formatStatSpread(set.ivs, hasCustomIv, dl) })}</>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
