'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import TypeBadge from '@/components/shared/TypeBadge';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip from '@/components/ui/SkewChip';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeNature, localizeStat } from '@/lib/pkmn/i18n/names/misc';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { PokemonSet, SetIssue } from '@/types/team';

/**
 * TeamCardPrimitive — a read-only card for a single Pokémon set.
 *
 * Shared primitive used across all team display surfaces:
 * - Teambuilder editor (3-column grid)
 * - Public team view (/teambuilder/share/[token])
 * - Library listing (/teambuilder/library)
 * - BroadcastTeam overlays
 * - Match highlight cards
 *
 * Design principles:
 * - Server-friendly: accepts pre-fetched data, no internal fetches
 * - Zero layout dependencies: renders in any container width
 * - Variants via `size` prop: 'sm' (broadcast strip), 'md' (default), 'lg' (modal)
 */

export interface TeamCardPrimitiveProps {
  /** The Pokémon set to display. Null renders an empty slot. */
  set: PokemonSet | null;
  /** Slot index (0–5), used for aria labels and click handlers */
  index: number;
  /** Pre-fetched type info for this species (e.g. ['Fire', 'Flying']) */
  types?: string[];
  /** Pre-fetched move type map { 'Flamethrower': 'Fire', ... } */
  moveTypes?: Record<string, string>;
  /** Validation issues for this specific slot (filtered by pokemon_index) */
  issues?: SetIssue[];
  /** Click handler — omitted in read-only surfaces */
  onClick?: () => void;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show the sprite (hide for broadcast overlays that use custom art) */
  showSprite?: boolean;
  /** Show detailed stats (hide for compact views like broadcast strips) */
  showStats?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export default function TeamCardPrimitive({
  set,
  index,
  types = [],
  moveTypes = {},
  issues = [],
  onClick,
  size = 'md',
  showSprite = true,
  showStats = true,
  className = '',
}: TeamCardPrimitiveProps) {
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  if (!set) {
    return (
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
        aria-label={
          onClick
            ? t('teamCard.addToSlot', { n: index + 1 })
            : t('teamCard.emptySlot', { n: index + 1 })
        }
        className={[
          'group relative rounded-xl border border-dashed border-hairline-strong',
          'flex flex-col items-center justify-center gap-2 text-fg-muted',
          'transition-[background-color,border-color,color] duration-80 ease-out',
          onClick ? 'cursor-pointer hover:border-accent-ink hover:bg-hover hover:text-fg' : '',
          size === 'sm' ? 'min-h-[80px] p-2 text-caption' : 'min-h-[180px] p-4 text-body',
          className,
        ].filter(Boolean).join(' ')}
      >
        {size !== 'sm' && (
          <SkewChip className="absolute right-3 top-3 font-mono">{index + 1}</SkewChip>
        )}
        <ItemIcon item="poke-ball" size={size === 'sm' ? 24 : 48} />
        {size !== 'sm' && <span>{t('teamCard.add')}</span>}
      </div>
    );
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.some((i) => i.severity === 'warning');

  // Size-specific class maps
  const spriteSize = size === 'sm' ? 40 : size === 'lg' ? 96 : 72;
  const nameClass = size === 'sm' ? 'text-caption' : 'text-title';

  // The nickname is the player's own text; only the species name is localized.
  const speciesName = localizeSpecies(set.species, dl);
  const displayName = set.name && set.name !== set.species
    ? t('teamCard.nickname', { nickname: set.name, species: speciesName })
    : speciesName;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      aria-label={t('teamCard.slotAria', { name: displayName, n: index + 1 })}
      className={[
        'relative overflow-hidden rounded-xl border bg-surface transition-[background-color,border-color] duration-80 ease-out',
        hasErrors ? 'border-loss' : hasWarnings ? 'border-accent-ink' : 'border-hairline',
        onClick ? 'cursor-pointer hover:border-hairline-strong hover:bg-hover' : '',
        size === 'sm' ? 'p-2' : size === 'lg' ? 'p-5' : 'p-3',
        className,
      ].filter(Boolean).join(' ')}
    >
      {/* Slot plate; it carries the validation state of the slot */}
      <span
        className="absolute right-3 top-3"
        title={hasErrors ? t('teamCard.hasErrors') : hasWarnings ? t('teamCard.hasWarnings') : undefined}
      >
        <SkewChip tone={hasErrors ? 'loss' : hasWarnings ? 'accent' : 'neutral'} className="font-mono">
          {index + 1}
        </SkewChip>
      </span>

      {/* Header: sprite + name + types + item */}
      <div className="flex items-start gap-3">
        {showSprite && (
          <div className="shrink-0">
            <PokemonSprite name={set.species} size={spriteSize} animated />
          </div>
        )}
        <div className="min-w-0 flex-1 pr-8">
          <div className="flex flex-wrap items-center gap-1">
            <PokemonLink name={set.species} className="inline-flex min-w-0">
              <span className={`font-heading ${nameClass} truncate text-fg`}>
                {displayName}
              </span>
            </PokemonLink>
          </div>
          {/* Type badges */}
          {types.length > 0 && (
            <div className="mt-1 flex gap-1">
              {types.map((t) => (
                <TypeBadge key={t} type={t} size="compact" className="px-1.5! py-0.5!" />
              ))}
            </div>
          )}
          {/* Item + Ability + Nature */}
          {!size?.startsWith('s') && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
              {set.item && (
                <span className="rounded bg-elevated px-1.5 py-0.5 text-fg">
                  @ {localizeItem(set.item, dl)}
                </span>
              )}
              {set.ability && <span>{localizeAbility(set.ability, dl)}</span>}
              {set.nature && <span className="italic">{localizeNature(set.nature, dl)}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Moves with type badges */}
      {(set.moves?.filter(Boolean).length ?? 0) > 0 && (
        <div className={`${size === 'sm' ? 'mt-1' : 'mt-3'} grid grid-cols-2 gap-x-3 gap-y-1`}>
          {set.moves.filter(Boolean).map((move, i) => (
            <div key={i} className="flex min-w-0 items-center gap-1.5">
              {moveTypes[move] && (
                <TypeBadge type={moveTypes[move]} size="compact" className="px-1.5! py-0.5!" />
              )}
              <span className="truncate text-caption text-fg">
                {localizeMove(move, dl)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* EV spread — only in md/lg: the scoreboard row of the card */}
      {showStats && size !== 'sm' && set.evs && (
        <div className="mt-3 flex justify-between gap-2 border-t border-hairline pt-2 text-caption">
          {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((stat) => (
            <span key={stat} className="flex flex-col items-center gap-0.5">
              <span className="whitespace-nowrap text-fg-muted">{localizeStat(stat, dl, 'short')}</span>
              <span className={`font-mono tabular-nums ${set.evs[stat] > 0 ? 'font-[550] text-fg' : 'text-fg-muted'}`}>{set.evs[stat]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
