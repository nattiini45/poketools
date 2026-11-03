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
import { formatStatSpread, hasCustomIv, hasEv } from '@/lib/team/stat-spread';
import type { PokemonSet } from '@/types/team';

/**
 * One read-only set of the shared-team and library-entry pages. A server component: the names are localized here,
 * so neither page ships a name table to the browser; only the sprite is a client leaf (its fallback walk).
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
      <div className="border border-poke-border rounded-poke-md p-4 bg-poke-surface/50 text-center">
        <p className="text-xs text-poke-text-muted">{t('set.slot', { n: index + 1 })}</p>
      </div>
    );
  }

  const speciesName = localizeSpecies(set.species, dl);
  return (
    <div className="border border-poke-border rounded-poke-md p-4 bg-poke-surface hover:border-poke-blue/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <SpriteImg name={set.species} alt={speciesName} width={48} height={48} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{set.name || speciesName}</p>
          {set.item && (
            <p className="text-[10px] text-poke-text-muted">{t('set.item', { item: localizeItem(set.item, dl) })}</p>
          )}
        </div>
      </div>

      {set.ability && (
        <p className="text-[11px] text-poke-text-secondary mb-1">
          {t.rich('set.ability', {
            ability: localizeAbility(set.ability, dl),
            value: (chunks) => <span className="text-poke-text-primary">{chunks}</span>,
          })}
        </p>
      )}

      {set.tera_type && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[10px] text-poke-text-muted">{t('set.tera')}</span>
          <TypeBadgeView type={set.tera_type} label={localizeType(set.tera_type, dl)} className="!text-[9px] !px-1.5 !py-0" />
        </div>
      )}

      {set.moves && set.moves.length > 0 && (
        <div className="mb-2">
          {set.moves.filter(Boolean).map((move, i) => (
            <p key={i} className="text-[11px] text-poke-text-secondary">
              - {localizeMove(move, dl)}
            </p>
          ))}
        </div>
      )}

      {set.evs && Object.values(set.evs).some((v) => v > 0) && (
        <p className="text-[10px] text-poke-text-muted font-mono">{formatStatSpread(set.evs, hasEv, dl)}</p>
      )}

      {set.nature && (
        <p className="text-[10px] text-poke-text-muted">
          {t('set.nature', { nature: localizeNature(set.nature, dl) })}
          {showIvs && set.ivs && Object.values(set.ivs).some(hasCustomIv) && (
            <> · {t('set.ivs', { spread: formatStatSpread(set.ivs, hasCustomIv, dl) })}</>
          )}
        </p>
      )}
    </div>
  );
}